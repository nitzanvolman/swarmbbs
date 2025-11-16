/**
 * Tail Reading Optimization for Thread Logs
 *
 * Efficiently read the last N lines of a JSONL file without loading the entire file.
 * Uses binary search to find the approximate starting position.
 */

import { open, stat } from 'fs/promises';
import type { ThreadEvent } from '../types/events.js';

/**
 * Read the last N lines from a JSONL file
 *
 * @param filePath - Path to the JSONL file
 * @param maxLines - Maximum number of lines to read from the end
 * @returns Array of parsed events (oldest first)
 */
export async function readTail(filePath: string, maxLines: number): Promise<ThreadEvent[]> {
  // Check if file exists
  try {
    await stat(filePath);
  } catch (err) {
    // File doesn't exist, return empty array
    return [];
  }

  const fileHandle = await open(filePath, 'r');

  try {
    const stats = await fileHandle.stat();
    const fileSize = stats.size;

    if (fileSize === 0) {
      return [];
    }

    // For small files, just read the whole thing
    if (fileSize < 64 * 1024) {
      const buffer = Buffer.allocUnsafe(fileSize);
      await fileHandle.read(buffer, 0, fileSize, 0);
      const content = buffer.toString('utf8');
      return parseLines(content, maxLines);
    }

    // For large files, estimate position and seek
    // Average line length estimate: 150 bytes (adjust based on usage patterns)
    const estimatedBytesNeeded = maxLines * 150;
    const bufferSize = Math.min(fileSize, Math.max(estimatedBytesNeeded * 2, 16 * 1024));
    const startPos = Math.max(0, fileSize - bufferSize);

    const buffer = Buffer.allocUnsafe(bufferSize);
    const { bytesRead } = await fileHandle.read(buffer, 0, bufferSize, startPos);

    const content = buffer.slice(0, bytesRead).toString('utf8');

    // Find the first complete line (skip partial line at start if we didn't start at file beginning)
    let textToProcess = content;
    if (startPos > 0) {
      const firstNewline = content.indexOf('\n');
      if (firstNewline !== -1) {
        textToProcess = content.slice(firstNewline + 1);
      }
    }

    return parseLines(textToProcess, maxLines);
  } finally {
    await fileHandle.close();
  }
}

/**
 * Read messages after a specific sequence number
 *
 * @param filePath - Path to the JSONL file
 * @param afterSeq - Only return messages with seq > afterSeq
 * @param maxLines - Maximum number of lines to read
 * @returns Array of parsed events (oldest first)
 */
export async function readAfterSeq(
  filePath: string,
  afterSeq: number,
  maxLines: number = 1000
): Promise<ThreadEvent[]> {
  // For now, read tail and filter
  // In production, could optimize with indexing or binary search on seq numbers
  const events = await readTail(filePath, maxLines);
  return events.filter(event => event.seq > afterSeq);
}

/**
 * Get the current maximum sequence number in a thread
 *
 * @param filePath - Path to the JSONL file
 * @returns Current max seq number, or 0 if file is empty/doesn't exist
 */
export async function getCurrentSeq(filePath: string): Promise<number> {
  try {
    // Read just the last line to get current seq
    const events = await readTail(filePath, 1);
    if (events.length === 0) {
      return 0;
    }
    return events[events.length - 1].seq;
  } catch {
    return 0;
  }
}

/**
 * Parse JSONL lines and return last N events
 *
 * @param content - JSONL content
 * @param maxLines - Maximum number of lines to return
 * @returns Array of parsed events (oldest first)
 */
function parseLines(content: string, maxLines: number): ThreadEvent[] {
  const lines = content.split('\n').filter(line => line.trim().length > 0);

  // Take last N lines
  const relevantLines = lines.slice(-maxLines);

  const events: ThreadEvent[] = [];
  for (const line of relevantLines) {
    try {
      const event = JSON.parse(line) as ThreadEvent;
      events.push(event);
    } catch (err) {
      // Skip malformed lines
      console.error('Failed to parse JSONL line:', err);
    }
  }

  return events;
}

/**
 * Read all events from a JSONL file (use with caution on large files)
 *
 * @param filePath - Path to the JSONL file
 * @returns Array of all events in the file
 */
export async function readAll(filePath: string): Promise<ThreadEvent[]> {
  try {
    await stat(filePath);
  } catch {
    return [];
  }

  const fileHandle = await open(filePath, 'r');

  try {
    const stats = await fileHandle.stat();
    const fileSize = stats.size;

    if (fileSize === 0) {
      return [];
    }

    const buffer = Buffer.allocUnsafe(fileSize);
    await fileHandle.read(buffer, 0, fileSize, 0);
    const content = buffer.toString('utf8');

    return parseLines(content, Number.MAX_SAFE_INTEGER);
  } finally {
    await fileHandle.close();
  }
}
