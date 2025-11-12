/**
 * Space Lifecycle Management Tools
 *
 * Re-exports from lifecycle-list and lifecycle-admin for backward compatibility
 */

// List operations
export {
  listSpaces,
  listThreads,
  type ListSpacesInput,
  type ListSpacesOutput,
  type SpaceInfo,
  type ArchivedSpaceInfo,
  type ListThreadsInput,
  type ListThreadsOutput,
  type ThreadInfo,
} from './lifecycle-list.js';

// Admin operations
export {
  archiveSpace,
  clearSpace,
  type ArchiveSpaceInput,
  type ArchiveSpaceOutput,
  type ClearSpaceInput,
  type ClearSpaceOutput,
} from './lifecycle-admin.js';
