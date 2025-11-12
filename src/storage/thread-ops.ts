/**
 * Thread Operations - Atomic JSONL Append and Thread Management
 *
 * Provides atomic message appending and thread metadata tracking
 */

import { mkdir, appendFile } from 'fs/promises';
import { dirname, join } from 'path';
import type { MessageEvent, ReadReceiptEvent, SnapshotEvent, ThreadEvent } from '../types/events.js';
import type { ThreadMetadata } from '../types/state.js';
import { globalLockManager, getThreadKey } from '../utils/locking.js';
import { readTail, readAfterSeq, getCurrentSeq, readAll } from './tail-reader.js';
import { assertValidName } from '../utils/validation.js';

/**
 * In-memory thread metadata cache
 * Key: space/thread
 */
const threadMetadataCache = new Map<string, ThreadMetadata>();

/**
 * Get thread file path
 */
export function getThreadPath(rootDir: string, space: string, thread: string): string {
  assertValidName(space, 'space');
  assertValidName(thread, 'thread');
  return join(rootDir, 'spaces', space, 'threads', `${thread}.log`);
}

/**
 * Get or initialize thread metadata
 */
export async function getThreadMetadata(
  rootDir: string,
  space: string,
  thread: string
): Promise<ThreadMetadata> {
  const key = getThreadKey(space, thread);

  // Check cache
  if (threadMetadataCache.has(key)) {
    return threadMetadataCache.get(key)!;
  }

  // Load from disk
  const threadPath = getThreadPath(rootDir, space, thread);
  const currentSeq = await getCurrentSeq(threadPath);

  const metadata: ThreadMetadata = {
    current_seq: currentSeq,
    epoch: 0,
    min_available_seq: 0,
    compaction_state: null,
  };

  threadMetadataCache.set(key, metadata);
  return metadata;
}

/**
 * Update thread metadata in cache
 */
export function updateThreadMetadata(
  space: string,
  thread: string,
  updates: Partial<ThreadMetadata>
): void {
  const key = getThreadKey(space, thread);
  const current = threadMetadataCache.get(key);

  if (current) {
    threadMetadataCache.set(key, { ...current, ...updates });
  }
}

/**
 * Append a message event to a thread with atomic locking
 *
 * @param rootDir - Root directory for storage
 * @param space - Space name
 * @param thread - Thread name
 * @param from - Handle of sender
 * @param text - Message text (already sanitized)
 * @returns The created MessageEvent
 */
export async function appendMessage(
  rootDir: string,
  space: string,
  thread: string,
  from: string,
  text: string
): Promise<MessageEvent> {
  const key = getThreadKey(space, thread);

  return globalLockManager.withLock(key, async () => {
    const threadPath = getThreadPath(rootDir, space, thread);

    // Ensure directory exists
    await mkdir(dirname(threadPath), { recursive: true });

    // Get current metadata
    const metadata = await getThreadMetadata(rootDir, space, thread);

    // Check if compaction is in progress
    const targetPath = metadata.compaction_state
      ? metadata.compaction_state.delta_file_path
      : threadPath;

    // Assign next sequence number
    const seq = metadata.current_seq + 1;
    const ts = new Date().toISOString();

    const event: MessageEvent = {
      type: 'msg',
      ts,
      seq,
      from,
      text,
    };

    // Append to file (atomic operation)
    const line = JSON.stringify(event) + '\n';
    await appendFile(targetPath, line, { encoding: 'utf8', flag: 'a' });

    // Update metadata
    updateThreadMetadata(space, thread, { current_seq: seq });

    return event;
  });
}

/**
 * Append a read receipt to a thread
 *
 * @param rootDir - Root directory for storage
 * @param space - Space name
 * @param thread - Thread name
 * @param who - Handle that read messages
 * @param upToSeq - Highest message seq read
 * @returns The created ReadReceiptEvent
 */
export async function appendReadReceipt(
  rootDir: string,
  space: string,
  thread: string,
  who: string,
  upToSeq: number
): Promise<ReadReceiptEvent> {
  const key = getThreadKey(space, thread);

  return globalLockManager.withLock(key, async () => {
    const threadPath = getThreadPath(rootDir, space, thread);

    // Get current metadata
    const metadata = await getThreadMetadata(rootDir, space, thread);

    // Check if compaction is in progress
    const targetPath = metadata.compaction_state
      ? metadata.compaction_state.delta_file_path
      : threadPath;

    // Assign next sequence number
    const seq = metadata.current_seq + 1;
    const ts = new Date().toISOString();

    const event: ReadReceiptEvent = {
      type: 'read',
      ts,
      seq,
      who,
      up_to_seq: upToSeq,
    };

    // Append to file (atomic operation)
    const line = JSON.stringify(event) + '\n';
    await appendFile(targetPath, line, { encoding: 'utf8', flag: 'a' });

    // Update metadata
    updateThreadMetadata(space, thread, { current_seq: seq });

    return event;
  });
}

/**
 * Append a snapshot event to a thread (used during compaction)
 *
 * @param rootDir - Root directory for storage
 * @param space - Space name
 * @param thread - Thread name
 * @param snapshot - Snapshot event to append
 * @returns The snapshot event with assigned seq
 */
export async function appendSnapshot(
  rootDir: string,
  space: string,
  thread: string,
  snapshot: Omit<SnapshotEvent, 'seq' | 'ts'>
): Promise<SnapshotEvent> {
  const key = getThreadKey(space, thread);

  return globalLockManager.withLock(key, async () => {
    const threadPath = getThreadPath(rootDir, space, thread);

    // Get current metadata
    const metadata = await getThreadMetadata(rootDir, space, thread);

    // Assign sequence number
    const seq = metadata.current_seq + 1;
    const ts = new Date().toISOString();

    const event: SnapshotEvent = {
      ...snapshot,
      seq,
      ts,
    };

    // Append to file
    const line = JSON.stringify(event) + '\n';
    await appendFile(threadPath, line, { encoding: 'utf8', flag: 'a' });

    // Update metadata
    updateThreadMetadata(space, thread, { current_seq: seq });

    return event;
  });
}

/**
 * Read thread tail (last N events)
 *
 * @param rootDir - Root directory for storage
 * @param space - Space name
 * @param thread - Thread name
 * @param maxLines - Maximum number of lines to read
 * @returns Array of events (oldest first)
 */
export async function readThreadTail(
  rootDir: string,
  space: string,
  thread: string,
  maxLines: number = 100
): Promise<ThreadEvent[]> {
  const threadPath = getThreadPath(rootDir, space, thread);
  return readTail(threadPath, maxLines);
}

/**
 * Read messages after a specific sequence number
 *
 * @param rootDir - Root directory for storage
 * @param space - Space name
 * @param thread - Thread name
 * @param afterSeq - Only return events with seq > afterSeq
 * @param maxLines - Maximum number of lines to read
 * @returns Array of events (oldest first)
 */
export async function readThreadAfterSeq(
  rootDir: string,
  space: string,
  thread: string,
  afterSeq: number,
  maxLines: number = 1000
): Promise<ThreadEvent[]> {
  const threadPath = getThreadPath(rootDir, space, thread);
  return readAfterSeq(threadPath, afterSeq, maxLines);
}

/**
 * Get current sequence number for a thread
 *
 * @param rootDir - Root directory for storage
 * @param space - Space name
 * @param thread - Thread name
 * @returns Current max seq, or 0 if thread doesn't exist
 */
export async function getThreadCurrentSeq(
  rootDir: string,
  space: string,
  thread: string
): Promise<number> {
  const metadata = await getThreadMetadata(rootDir, space, thread);
  return metadata.current_seq;
}

/**
 * Get thread epoch
 *
 * @param rootDir - Root directory for storage
 * @param space - Space name
 * @param thread - Thread name
 * @returns Current epoch
 */
export async function getThreadEpoch(
  rootDir: string,
  space: string,
  thread: string
): Promise<number> {
  const metadata = await getThreadMetadata(rootDir, space, thread);
  return metadata.epoch;
}

/**
 * Read all events from a thread (use with caution on large threads)
 *
 * @param rootDir - Root directory for storage
 * @param space - Space name
 * @param thread - Thread name
 * @returns All events in the thread
 */
export async function readThreadAll(
  rootDir: string,
  space: string,
  thread: string
): Promise<ThreadEvent[]> {
  const threadPath = getThreadPath(rootDir, space, thread);
  return readAll(threadPath);
}

/**
 * Clear thread metadata cache (useful for testing)
 */
export function clearThreadMetadataCache(): void {
  threadMetadataCache.clear();
}
