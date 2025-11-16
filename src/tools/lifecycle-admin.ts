/**
 * Space Lifecycle - Admin Operations
 *
 * Tools for archiving and clearing spaces (destructive operations)
 */

import { stat, rename, rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { assertValidName } from '../utils/validation.js';
import { badRequest, notFound, locked, insufficientStorage } from '../utils/errors.js';
import { listThreads } from './lifecycle-list.js';

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
