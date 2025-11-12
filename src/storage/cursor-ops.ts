/**
 * Cursor Operations - Read Position Tracking and Management
 *
 * Manages per-handle, per-thread read positions with epoch tracking
 */

import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import type { Cursor } from '../types/state.js';
import { getThreadMetadata } from './thread-ops.js';
import { appendReadReceipt } from './thread-ops.js';
import { assertValidName } from '../utils/validation.js';

/**
 * Get cursor file path
 * Supports both regular threads and P2P threads (p2p/<handle-a>__<handle-b>)
 */
export function getCursorPath(
  rootDir: string,
  space: string,
  handle: string,
  thread: string
): string {
  assertValidName(space, 'space');

  // P2P threads have format p2p/<handle-a>__<handle-b>
  // They are stored in cursors/<handle>/p2p/<handle-a>__<handle-b>.json
  if (thread.startsWith('p2p/')) {
    const p2pName = thread.slice(4); // Remove 'p2p/' prefix
    assertValidName(p2pName, 'P2P thread');
    return join(rootDir, 'spaces', space, 'state', 'cursors', handle, 'p2p', `${p2pName}.json`);
  }

  // Regular threads are stored in cursors/<handle>/<thread>.json
  assertValidName(thread, 'thread');
  return join(rootDir, 'spaces', space, 'state', 'cursors', handle, `${thread}.json`);
}

/**
 * Read cursor for a handle and thread
 *
 * @param rootDir - Root directory for storage
 * @param space - Space name
 * @param handle - Handle identifier
 * @param thread - Thread name
 * @returns Cursor or null if not exists (implies last_seq=0, epoch=0)
 */
export async function getCursor(
  rootDir: string,
  space: string,
  handle: string,
  thread: string
): Promise<Cursor | null> {
  const cursorPath = getCursorPath(rootDir, space, handle, thread);

  try {
    const content = await readFile(cursorPath, 'utf8');
    return JSON.parse(content) as Cursor;
  } catch {
    // Cursor doesn't exist yet
    return null;
  }
}

/**
 * Write cursor to disk
 *
 * @param rootDir - Root directory for storage
 * @param space - Space name
 * @param handle - Handle identifier
 * @param thread - Thread name
 * @param cursor - Cursor data to write
 */
export async function writeCursor(
  rootDir: string,
  space: string,
  handle: string,
  thread: string,
  cursor: Cursor
): Promise<void> {
  const cursorPath = getCursorPath(rootDir, space, handle, thread);

  // Ensure directory exists
  await mkdir(dirname(cursorPath), { recursive: true });

  // Write cursor atomically
  const content = JSON.stringify(cursor, null, 2);
  await writeFile(cursorPath, content, 'utf8');
}

/**
 * Update cursor after delivering messages
 *
 * Handles epoch clamping logic:
 * - If cursor epoch < thread epoch, clamp to min_available_seq
 * - Otherwise, advance to new last_seq
 *
 * @param rootDir - Root directory for storage
 * @param space - Space name
 * @param handle - Handle identifier
 * @param thread - Thread name
 * @param newLastSeq - New last_seq value (highest delivered message seq)
 * @returns Updated cursor
 */
export async function updateCursor(
  rootDir: string,
  space: string,
  handle: string,
  thread: string,
  newLastSeq: number
): Promise<Cursor> {
  // Get current cursor
  const currentCursor = await getCursor(rootDir, space, handle, thread);

  // Get thread metadata
  const threadMetadata = await getThreadMetadata(rootDir, space, thread);

  let lastSeq = newLastSeq;
  let epoch = threadMetadata.epoch;

  // Handle epoch mismatch (thread was compacted)
  if (currentCursor && currentCursor.epoch < threadMetadata.epoch) {
    // Clamp to min_available_seq
    lastSeq = Math.max(threadMetadata.min_available_seq, newLastSeq);
  }

  const updatedCursor: Cursor = {
    last_seq: lastSeq,
    epoch,
    updated_ts: new Date().toISOString(),
  };

  await writeCursor(rootDir, space, handle, thread, updatedCursor);

  return updatedCursor;
}

/**
 * Advance cursor after message delivery and append read receipt
 *
 * This is the main function used after delivering messages to a handle.
 * It updates the cursor and appends a read receipt to the thread.
 *
 * @param rootDir - Root directory for storage
 * @param space - Space name
 * @param handle - Handle identifier
 * @param thread - Thread name
 * @param upToSeq - Highest message seq delivered
 */
export async function advanceCursorWithReceipt(
  rootDir: string,
  space: string,
  handle: string,
  thread: string,
  upToSeq: number
): Promise<void> {
  // Update cursor
  await updateCursor(rootDir, space, handle, thread, upToSeq);

  // Append read receipt
  await appendReadReceipt(rootDir, space, thread, handle, upToSeq);
}

/**
 * Get effective cursor position with epoch clamping
 *
 * Returns the actual read position to use, taking into account
 * epoch mismatches and clamping to min_available_seq.
 *
 * @param rootDir - Root directory for storage
 * @param space - Space name
 * @param handle - Handle identifier
 * @param thread - Thread name
 * @returns Object with last_seq and epoch to use for reading
 */
export async function getEffectiveCursor(
  rootDir: string,
  space: string,
  handle: string,
  thread: string
): Promise<{ last_seq: number; epoch: number }> {
  const cursor = await getCursor(rootDir, space, handle, thread);
  const threadMetadata = await getThreadMetadata(rootDir, space, thread);

  // No cursor exists, start from beginning
  if (!cursor) {
    return { last_seq: 0, epoch: threadMetadata.epoch };
  }

  // Cursor epoch matches thread epoch, use as-is
  if (cursor.epoch === threadMetadata.epoch) {
    return { last_seq: cursor.last_seq, epoch: cursor.epoch };
  }

  // Epoch mismatch: cursor is stale (thread was compacted)
  // Clamp to min_available_seq
  return {
    last_seq: Math.max(cursor.last_seq, threadMetadata.min_available_seq),
    epoch: threadMetadata.epoch,
  };
}

/**
 * Reset cursor to a specific position
 *
 * Used by the reset_cursor tool to allow agents to replay messages.
 *
 * @param rootDir - Root directory for storage
 * @param space - Space name
 * @param handle - Handle identifier
 * @param thread - Thread name
 * @param resetToSeq - New last_seq value (or 0 to reset to start)
 */
export async function resetCursor(
  rootDir: string,
  space: string,
  handle: string,
  thread: string,
  resetToSeq: number = 0
): Promise<Cursor> {
  const threadMetadata = await getThreadMetadata(rootDir, space, thread);

  // Ensure reset position is valid
  let lastSeq = resetToSeq;
  if (lastSeq < threadMetadata.min_available_seq) {
    lastSeq = threadMetadata.min_available_seq;
  }

  const cursor: Cursor = {
    last_seq: lastSeq,
    epoch: threadMetadata.epoch,
    updated_ts: new Date().toISOString(),
  };

  await writeCursor(rootDir, space, handle, thread, cursor);

  return cursor;
}
