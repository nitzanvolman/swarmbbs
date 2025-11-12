/**
 * Space Lifecycle Management Tools
 *
 * Tools for managing spaces, threads, and administrative operations
 */

import { readdir, stat, rename, rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { assertValidName } from '../utils/validation.js';
import { badRequest, notFound, locked, insufficientStorage } from '../utils/errors.js';
import { readTail } from '../storage/tail-reader.js';
import { getThreadMetadata } from '../storage/thread-ops.js';

// ============================================================================
// Tool: swarmbbs.list_spaces
// ============================================================================

export interface ListSpacesInput {
  include_archived?: boolean;
}

export interface SpaceInfo {
  name: string;
  thread_count: number;
  size_bytes: number;
  created_at?: string;
  last_modified: string;
}

export interface ArchivedSpaceInfo {
  name: string;
  archive_path: string;
  archived_at: string;
  size_bytes: number;
}

export interface ListSpacesOutput {
  success: boolean;
  spaces: SpaceInfo[];
  archived_spaces?: ArchivedSpaceInfo[];
}

/**
 * List all available spaces
 *
 * @param rootDir - Root directory for storage
 * @param input - Tool input
 * @returns List of spaces with metadata
 */
export async function listSpaces(
  rootDir: string,
  input: ListSpacesInput
): Promise<ListSpacesOutput> {
  const spacesDir = join(rootDir, 'spaces');
  const archivesDir = join(rootDir, 'archives');

  // Get active spaces
  const spaces: SpaceInfo[] = [];

  try {
    const entries = await readdir(spacesDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const spacePath = join(spacesDir, entry.name);
      const threadsDir = join(spacePath, 'threads');

      // Count threads and calculate size
      let threadCount = 0;
      let totalSize = 0;
      let lastModified = new Date(0);

      try {
        const threadEntries = await readdir(threadsDir, { withFileTypes: true });

        for (const threadEntry of threadEntries) {
          if (threadEntry.isFile() && threadEntry.name.endsWith('.log')) {
            threadCount++;
            const threadPath = join(threadsDir, threadEntry.name);
            const stats = await stat(threadPath);
            totalSize += stats.size;
            if (stats.mtime > lastModified) {
              lastModified = stats.mtime;
            }
          } else if (threadEntry.isDirectory() && threadEntry.name === 'p2p') {
            // Count P2P threads
            const p2pDir = join(threadsDir, 'p2p');
            try {
              const p2pEntries = await readdir(p2pDir, { withFileTypes: true });
              for (const p2pEntry of p2pEntries) {
                if (p2pEntry.isFile() && p2pEntry.name.endsWith('.log')) {
                  threadCount++;
                  const p2pPath = join(p2pDir, p2pEntry.name);
                  const stats = await stat(p2pPath);
                  totalSize += stats.size;
                  if (stats.mtime > lastModified) {
                    lastModified = stats.mtime;
                  }
                }
              }
            } catch {
              // P2P directory might not exist or be accessible
            }
          }
        }
      } catch {
        // Threads directory might not exist yet
      }

      // Get created_at from meta.json if available
      let createdAt: string | undefined;
      try {
        const metaPath = join(spacePath, 'meta.json');
        const metaStats = await stat(metaPath);
        createdAt = metaStats.birthtime.toISOString();
      } catch {
        // meta.json might not exist
      }

      spaces.push({
        name: entry.name,
        thread_count: threadCount,
        size_bytes: totalSize,
        created_at: createdAt,
        last_modified: lastModified.toISOString(),
      });
    }
  } catch (err: any) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
    // Spaces directory doesn't exist yet - return empty list
  }

  const output: ListSpacesOutput = {
    success: true,
    spaces,
  };

  // Include archived spaces if requested
  if (input.include_archived) {
    const archivedSpaces: ArchivedSpaceInfo[] = [];

    try {
      const archiveEntries = await readdir(archivesDir, { withFileTypes: true });

      for (const entry of archiveEntries) {
        if (!entry.isDirectory()) continue;

        // Parse archive directory name: {space}-{timestamp}
        const match = entry.name.match(/^(.+)-(\d{8}-\d{6})$/);
        if (!match) continue;

        const [, spaceName, timestamp] = match;
        const archivePath = join(archivesDir, entry.name);

        // Calculate archive size
        let totalSize = 0;
        const archiveStats = await stat(archivePath);

        try {
          const threadsDir = join(archivePath, 'threads');
          const threadEntries = await readdir(threadsDir, { withFileTypes: true });

          for (const threadEntry of threadEntries) {
            if (threadEntry.isFile() && threadEntry.name.endsWith('.log')) {
              const threadPath = join(threadsDir, threadEntry.name);
              const stats = await stat(threadPath);
              totalSize += stats.size;
            } else if (threadEntry.isDirectory() && threadEntry.name === 'p2p') {
              const p2pDir = join(threadsDir, 'p2p');
              try {
                const p2pEntries = await readdir(p2pDir, { withFileTypes: true });
                for (const p2pEntry of p2pEntries) {
                  if (p2pEntry.isFile() && p2pEntry.name.endsWith('.log')) {
                    const p2pPath = join(p2pDir, p2pEntry.name);
                    const stats = await stat(p2pPath);
                    totalSize += stats.size;
                  }
                }
              } catch {
                // Ignore P2P errors
              }
            }
          }
        } catch {
          // Use directory size if we can't calculate thread sizes
          totalSize = archiveStats.size;
        }

        // Parse archived_at from timestamp
        const year = timestamp.slice(0, 4);
        const month = timestamp.slice(4, 6);
        const day = timestamp.slice(6, 8);
        const hour = timestamp.slice(9, 11);
        const minute = timestamp.slice(11, 13);
        const second = timestamp.slice(13, 15);
        const archivedAt = `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;

        archivedSpaces.push({
          name: spaceName,
          archive_path: archivePath,
          archived_at: archivedAt,
          size_bytes: totalSize,
        });
      }
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        throw err;
      }
      // Archives directory doesn't exist yet
    }

    output.archived_spaces = archivedSpaces;
  }

  return output;
}

// ============================================================================
// Tool: swarmbbs.list_threads
// ============================================================================

export interface ListThreadsInput {
  space?: string;
  include_p2p?: boolean;
}

export interface ThreadInfo {
  name: string;
  message_count: number;
  size_bytes: number;
  epoch: number;
  min_available_seq: number;
  last_message_ts?: string;
  is_p2p: boolean;
  participants?: string[];
}

export interface ListThreadsOutput {
  success: boolean;
  space: string;
  threads: ThreadInfo[];
}

/**
 * Parse P2P thread name to extract participants
 *
 * @param threadName - Thread name (e.g., "p2p/agent-a__agent-b")
 * @returns Array of participants or null if not P2P
 */
function parseP2PThread(threadName: string): string[] | null {
  if (!threadName.startsWith('p2p/')) return null;

  const p2pName = threadName.slice(4); // Remove 'p2p/' prefix
  const match = p2pName.match(/^([^_]+)__([^_]+)$/);
  if (!match) return null;

  return [match[1], match[2]];
}

/**
 * List threads in a space
 *
 * @param rootDir - Root directory for storage
 * @param defaultSpace - Default space from server config
 * @param input - Tool input
 * @returns List of threads with metadata
 */
export async function listThreads(
  rootDir: string,
  defaultSpace: string,
  input: ListThreadsInput
): Promise<ListThreadsOutput> {
  const space = input.space || defaultSpace;
  assertValidName(space, 'space');

  const spacePath = join(rootDir, 'spaces', space);
  const threadsDir = join(spacePath, 'threads');

  // Check if space exists
  try {
    await stat(spacePath);
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      throw notFound('Space', space, 'Check space name or create space by sending a message');
    }
    throw err;
  }

  const threads: ThreadInfo[] = [];

  try {
    const entries = await readdir(threadsDir, { withFileTypes: true });

    // Process regular threads
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.log')) {
        const threadName = entry.name.slice(0, -4); // Remove .log extension
        const threadPath = join(threadsDir, entry.name);

        // Get file stats
        const stats = await stat(threadPath);

        // Get metadata
        let metadata;
        try {
          metadata = await getThreadMetadata(rootDir, space, threadName);
        } catch {
          // If metadata fails, use defaults
          metadata = {
            current_seq: 0,
            epoch: 0,
            min_available_seq: 0,
            compaction_state: null,
          };
        }

        // Get last message timestamp
        let lastMessageTs: string | undefined;
        try {
          const lastEvents = await readTail(threadPath, 1);
          if (lastEvents.length > 0) {
            lastMessageTs = lastEvents[0].ts;
          }
        } catch {
          // Ignore read errors
        }

        threads.push({
          name: threadName,
          message_count: metadata.current_seq,
          size_bytes: stats.size,
          epoch: metadata.epoch,
          min_available_seq: metadata.min_available_seq,
          last_message_ts: lastMessageTs,
          is_p2p: false,
        });
      }

      // Process P2P directory if requested
      if (entry.isDirectory() && entry.name === 'p2p' && input.include_p2p) {
        const p2pDir = join(threadsDir, 'p2p');

        try {
          const p2pEntries = await readdir(p2pDir, { withFileTypes: true });

          for (const p2pEntry of p2pEntries) {
            if (p2pEntry.isFile() && p2pEntry.name.endsWith('.log')) {
              const p2pName = p2pEntry.name.slice(0, -4); // Remove .log extension
              const threadName = `p2p/${p2pName}`;
              const threadPath = join(p2pDir, p2pEntry.name);

              // Get file stats
              const stats = await stat(threadPath);

              // Get metadata
              let metadata;
              try {
                metadata = await getThreadMetadata(rootDir, space, threadName);
              } catch {
                metadata = {
                  current_seq: 0,
                  epoch: 0,
                  min_available_seq: 0,
                  compaction_state: null,
                };
              }

              // Get last message timestamp
              let lastMessageTs: string | undefined;
              try {
                const lastEvents = await readTail(threadPath, 1);
                if (lastEvents.length > 0) {
                  lastMessageTs = lastEvents[0].ts;
                }
              } catch {
                // Ignore read errors
              }

              // Parse participants
              const participants = parseP2PThread(threadName);

              threads.push({
                name: threadName,
                message_count: metadata.current_seq,
                size_bytes: stats.size,
                epoch: metadata.epoch,
                min_available_seq: metadata.min_available_seq,
                last_message_ts: lastMessageTs,
                is_p2p: true,
                participants: participants || undefined,
              });
            }
          }
        } catch {
          // P2P directory might not exist
        }
      }
    }
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      // Threads directory doesn't exist yet - return empty list
      return {
        success: true,
        space,
        threads: [],
      };
    }
    throw err;
  }

  return {
    success: true,
    space,
    threads,
  };
}

// ============================================================================
// Tool: swarmbbs.archive_space
// ============================================================================

export interface ArchiveSpaceInput {
  space: string;
}

export interface ArchiveSpaceOutput {
  success: boolean;
  space: string;
  archive_path: string;
  archived_at: string;
  threads_archived: number;
  size_bytes: number;
}

/**
 * Archive a space by moving it to archives directory with timestamp
 *
 * @param rootDir - Root directory for storage
 * @param input - Tool input
 * @returns Archive confirmation
 */
export async function archiveSpace(
  rootDir: string,
  input: ArchiveSpaceInput
): Promise<ArchiveSpaceOutput> {
  const { space } = input;
  assertValidName(space, 'space');

  const spacePath = join(rootDir, 'spaces', space);

  // Check if space exists
  try {
    await stat(spacePath);
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      throw notFound('Space', space, 'Check space name spelling');
    }
    throw err;
  }

  // Get space metadata
  const listResult = await listThreads(rootDir, space, { include_p2p: true });
  const threadCount = listResult.threads.length;

  // Calculate total size
  let totalSize = 0;
  for (const thread of listResult.threads) {
    totalSize += thread.size_bytes;
  }

  // Create timestamp for archive directory
  const now = new Date();
  const isoString = now.toISOString();
  // Format: YYYYMMDD-HHMMSS
  const year = isoString.slice(0, 4);
  const month = isoString.slice(5, 7);
  const day = isoString.slice(8, 10);
  const hour = isoString.slice(11, 13);
  const minute = isoString.slice(14, 16);
  const second = isoString.slice(17, 19);
  const timestamp = `${year}${month}${day}-${hour}${minute}${second}`;

  const archivesDir = join(rootDir, 'archives');
  const archivePath = join(archivesDir, `${space}-${timestamp}`);

  try {
    // Ensure archives directory exists
    await mkdir(archivesDir, { recursive: true });

    // Move space to archives
    await rename(spacePath, archivePath);
  } catch (err: any) {
    if (err.code === 'ENOSPC') {
      throw insufficientStorage(
        `Insufficient storage to archive space (requires ${Math.ceil(totalSize / (1024 * 1024))} MB)`,
        { space, required_bytes: totalSize }
      );
    }
    if (err.code === 'EBUSY' || err.code === 'EPERM') {
      throw locked(
        `space '${space}' - may be in use`,
        { space, error: err.message }
      );
    }
    throw err;
  }

  return {
    success: true,
    space,
    archive_path: archivePath,
    archived_at: now.toISOString(),
    threads_archived: threadCount,
    size_bytes: totalSize,
  };
}

// ============================================================================
// Tool: swarmbbs.clear_space
// ============================================================================

export interface ClearSpaceInput {
  space: string;
  confirm: boolean;
}

export interface ClearSpaceOutput {
  success: boolean;
  space: string;
  deleted_threads: number;
  deleted_bytes: number;
  ts: string;
}

/**
 * Permanently delete a space
 *
 * @param rootDir - Root directory for storage
 * @param input - Tool input
 * @returns Deletion confirmation
 */
export async function clearSpace(
  rootDir: string,
  input: ClearSpaceInput
): Promise<ClearSpaceOutput> {
  const { space, confirm } = input;
  assertValidName(space, 'space');

  // Require explicit confirmation
  if (confirm !== true) {
    throw badRequest(
      'Must provide confirm: true to delete space',
      { field: 'confirm', required: true, provided: confirm },
      "Set 'confirm: true' to proceed with deletion. Use 'archive_space' for reversible removal."
    );
  }

  const spacePath = join(rootDir, 'spaces', space);

  // Check if space exists
  try {
    await stat(spacePath);
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      throw notFound('Space', space, 'Check space name spelling');
    }
    throw err;
  }

  // Get space metadata before deletion
  const listResult = await listThreads(rootDir, space, { include_p2p: true });
  const threadCount = listResult.threads.length;

  // Calculate total size
  let totalSize = 0;
  for (const thread of listResult.threads) {
    totalSize += thread.size_bytes;
  }

  // Delete space directory recursively
  try {
    await rm(spacePath, { recursive: true, force: true });
  } catch (err: any) {
    if (err.code === 'EBUSY' || err.code === 'EPERM') {
      throw locked(
        `space '${space}' - may be in use`,
        { space, error: err.message }
      );
    }
    throw err;
  }

  return {
    success: true,
    space,
    deleted_threads: threadCount,
    deleted_bytes: totalSize,
    ts: new Date().toISOString(),
  };
}
