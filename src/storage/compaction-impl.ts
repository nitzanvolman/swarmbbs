/**
 * Thread Compaction Implementation - Two-Phase Protocol
 *
 * Provides compaction operations: begin (freeze + delta), commit (snapshot + replay), abort (merge)
 */

import { mkdir, rename, unlink, writeFile, appendFile, readFile } from 'fs/promises';
import { dirname, join } from 'path';
import type { SnapshotEvent, MessageEvent, ThreadEvent } from '../types/events.js';
import type { CompactionSession } from '../types/state.js';
import { globalLockManager, getThreadKey } from '../utils/locking.js';
import { conflict, notFound, badRequest, internalError } from '../utils/errors.js';
import {
  getThreadPath,
  getThreadMetadata,
  updateThreadMetadata,
} from './thread-ops.js';
import { readAll } from './tail-reader.js';
import { existsSync } from 'fs';

/**
 * Generate unique compaction ID
 */
function generateCompactionId(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const random = Math.random().toString(36).substring(2, 8);
  return `comp-${timestamp}-${random}`;
}

/**
 * Get delta file path for a compaction session
 */
function getDeltaFilePath(threadPath: string, compactionId: string): string {
  return `${threadPath}.delta-${compactionId}`;
}

/**
 * Begin compaction - freeze base file and create delta file
 *
 * @param rootDir - Root directory for storage
 * @param space - Space name
 * @param thread - Thread name
 * @returns Compaction session info
 */
export async function beginCompaction(
  rootDir: string,
  space: string,
  thread: string
): Promise<{
  compaction_id: string;
  base_seq: number;
  epoch: number;
}> {
  const key = getThreadKey(space, thread);

  return globalLockManager.withLock(key, async () => {
    const threadPath = getThreadPath(rootDir, space, thread);

    // Check if thread exists
    if (!existsSync(threadPath)) {
      throw notFound('Thread', `${space}/${thread}`, 'Check thread name or send a message to create it');
    }

    // Get metadata
    const metadata = await getThreadMetadata(rootDir, space, thread);

    // Check if compaction already in progress
    if (metadata.compaction_state) {
      throw conflict(
        `Compaction already in progress for thread '${thread}'`,
        {
          thread,
          existing_compaction_id: metadata.compaction_state.compaction_id,
          started_at: metadata.compaction_state.compaction_id.split('-')[1] + ':' + metadata.compaction_state.compaction_id.split('-')[2],
        },
        'Wait for the current compaction to complete, or abort it using compact_abort with the existing compaction_id.'
      );
    }

    // Generate compaction ID
    const compactionId = generateCompactionId();
    const deltaFilePath = getDeltaFilePath(threadPath, compactionId);

    // Ensure delta directory exists
    await mkdir(dirname(deltaFilePath), { recursive: true });

    // Create empty delta file
    await writeFile(deltaFilePath, '', { encoding: 'utf8' });

    // Create compaction session
    const session: CompactionSession = {
      compaction_id: compactionId,
      base_seq: metadata.current_seq,
      epoch: metadata.epoch,
      delta_file_path: deltaFilePath,
    };

    // Update metadata to enter compaction mode
    updateThreadMetadata(space, thread, {
      compaction_state: session,
    });

    return {
      compaction_id: compactionId,
      base_seq: session.base_seq,
      epoch: session.epoch,
    };
  });
}

/**
 * Commit compaction - create new file with snapshot + kept messages + delta replay
 *
 * @param rootDir - Root directory for storage
 * @param space - Space name
 * @param thread - Thread name
 * @param compactionId - ID from begin
 * @param snapshot - Snapshot covering compacted range
 * @param keepMessages - Messages to preserve (optional)
 * @returns Compaction result
 */
export async function commitCompaction(
  rootDir: string,
  space: string,
  thread: string,
  compactionId: string,
  snapshot: {
    covers_from_seq: number;
    covers_to_seq: number;
    summary: string | Record<string, unknown>;
    meta?: Record<string, unknown>;
  },
  keepMessages?: MessageEvent[]
): Promise<{
  new_epoch: number;
  min_available_seq: number;
  message_count: number;
  delta_replayed: number;
}> {
  const key = getThreadKey(space, thread);

  return globalLockManager.withLock(key, async () => {
    const threadPath = getThreadPath(rootDir, space, thread);

    // Get metadata
    const metadata = await getThreadMetadata(rootDir, space, thread);

    // Verify compaction session
    if (!metadata.compaction_state || metadata.compaction_state.compaction_id !== compactionId) {
      throw notFound(
        'Compaction session',
        compactionId,
        'Verify the compaction_id matches the one returned from compact_begin. The compaction may have already been committed or aborted.'
      );
    }

    const session = metadata.compaction_state;

    // Validate kept messages are within compacted range
    if (keepMessages) {
      for (const msg of keepMessages) {
        if (msg.seq < snapshot.covers_from_seq || msg.seq > snapshot.covers_to_seq) {
          throw badRequest(
            `keep_messages contains seq ${msg.seq} which is outside the compacted range ${snapshot.covers_from_seq}-${snapshot.covers_to_seq}`,
            {
              invalid_seq: msg.seq,
              valid_range: `${snapshot.covers_from_seq}-${snapshot.covers_to_seq}`,
            },
            'Ensure all kept messages have seq numbers within the compacted range (covers_from_seq to covers_to_seq).'
          );
        }
      }
    }

    // Read delta file
    const deltaFilePath = session.delta_file_path;
    let deltaEvents: ThreadEvent[] = [];
    if (existsSync(deltaFilePath)) {
      const deltaContent = await readFile(deltaFilePath, 'utf8');
      if (deltaContent.trim().length > 0) {
        deltaEvents = deltaContent
          .split('\n')
          .filter(line => line.trim().length > 0)
          .map(line => JSON.parse(line) as ThreadEvent);
      }
    }

    // Build new file content
    const newThreadPath = `${threadPath}.new`;
    const lines: string[] = [];

    // 1. Snapshot event (seq 1)
    const snapshotEvent: SnapshotEvent = {
      type: 'snapshot',
      ts: new Date().toISOString(),
      seq: 1,
      covers: {
        from_seq: snapshot.covers_from_seq,
        to_seq: snapshot.covers_to_seq,
      },
      summary: snapshot.summary,
      meta: snapshot.meta || {},
    };
    lines.push(JSON.stringify(snapshotEvent));

    // 2. Kept messages (with original seq numbers)
    if (keepMessages) {
      for (const msg of keepMessages) {
        lines.push(JSON.stringify(msg));
      }
    }

    // 3. Delta events (replayed with original seq numbers)
    for (const event of deltaEvents) {
      lines.push(JSON.stringify(event));
    }

    // Write new file
    const content = lines.join('\n') + '\n';
    await writeFile(newThreadPath, content, { encoding: 'utf8' });

    // fsync equivalent: Node.js writeFile with flag 'w' already flushes to disk
    // For extra safety, we could use fs.fdatasync but writeFile is typically sufficient

    // Atomic rename to replace old file
    await rename(newThreadPath, threadPath);

    // Clean up delta file
    await unlink(deltaFilePath).catch(() => {
      // Ignore errors if delta file already removed
    });

    // Calculate new epoch and min_available_seq
    const newEpoch = session.epoch + 1;
    const minAvailableSeq = snapshot.covers_to_seq + 1;

    // Update metadata
    const newCurrentSeq = deltaEvents.length > 0
      ? Math.max(...deltaEvents.map(e => e.seq))
      : (keepMessages && keepMessages.length > 0
        ? Math.max(...keepMessages.map(m => m.seq))
        : 1); // Snapshot is seq 1

    updateThreadMetadata(space, thread, {
      epoch: newEpoch,
      min_available_seq: minAvailableSeq,
      current_seq: newCurrentSeq,
      compaction_state: null,
    });

    return {
      new_epoch: newEpoch,
      min_available_seq: minAvailableSeq,
      message_count: lines.length,
      delta_replayed: deltaEvents.length,
    };
  });
}

/**
 * Abort compaction - merge delta back into base file
 *
 * @param rootDir - Root directory for storage
 * @param space - Space name
 * @param thread - Thread name
 * @param compactionId - ID from begin
 * @returns Number of delta messages merged
 */
export async function abortCompaction(
  rootDir: string,
  space: string,
  thread: string,
  compactionId: string
): Promise<{
  delta_messages_merged: number;
}> {
  const key = getThreadKey(space, thread);

  return globalLockManager.withLock(key, async () => {
    const threadPath = getThreadPath(rootDir, space, thread);

    // Get metadata
    const metadata = await getThreadMetadata(rootDir, space, thread);

    // Verify compaction session
    if (!metadata.compaction_state || metadata.compaction_state.compaction_id !== compactionId) {
      throw notFound(
        'Compaction session',
        compactionId,
        'Verify the compaction_id. The compaction may have already been committed or aborted'
      );
    }

    const session = metadata.compaction_state;
    const deltaFilePath = session.delta_file_path;

    // Read delta file if it exists
    let deltaCount = 0;
    if (existsSync(deltaFilePath)) {
      const deltaContent = await readFile(deltaFilePath, 'utf8');
      if (deltaContent.trim().length > 0) {
        // Append delta content to base file
        await appendFile(threadPath, deltaContent, { encoding: 'utf8' });

        // Count lines
        deltaCount = deltaContent.split('\n').filter(line => line.trim().length > 0).length;
      }

      // Remove delta file
      await unlink(deltaFilePath).catch(() => {
        // Ignore errors
      });
    }

    // Clear compaction state
    updateThreadMetadata(space, thread, {
      compaction_state: null,
    });

    return {
      delta_messages_merged: deltaCount,
    };
  });
}

/**
 * Get active compaction session for a thread (if any)
 *
 * @param rootDir - Root directory
 * @param space - Space name
 * @param thread - Thread name
 * @returns Compaction session or null
 */
export async function getActiveCompaction(
  rootDir: string,
  space: string,
  thread: string
): Promise<CompactionSession | null> {
  const metadata = await getThreadMetadata(rootDir, space, thread);
  return metadata.compaction_state;
}
