/**
 * Space Lifecycle Management Tools
 *
 * Re-exports from lifecycle-list and lifecycle-admin for backward compatibility
 */

import type { ToolDefinition, ServerConfig } from '../server/mcp-server.js';

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

// Import functions for MCP tool handlers
import { listSpaces, listThreads } from './lifecycle-list.js';
import { archiveSpace, clearSpace } from './lifecycle-admin.js';

// ============================================================================
// MCP Tool Definitions
// ============================================================================

/**
 * list_spaces tool
 */
const listSpacesTool: ToolDefinition = {
  definition: {
    name: 'swarmbbs.list_spaces',
    description: 'List all available spaces with thread counts and sizes',
    inputSchema: {
      type: 'object',
      properties: {
        include_archived: {
          type: 'boolean',
          description: 'Include archived spaces in the results (defaults to false)',
        },
      },
      additionalProperties: false,
    },
  },
  handler: async (args: Record<string, unknown>, config: ServerConfig) => {
    const includeArchived = (args.include_archived as boolean) || false;

    return listSpaces(config.rootDir, { include_archived: includeArchived });
  },
};

/**
 * list_threads tool
 */
const listThreadsTool: ToolDefinition = {
  definition: {
    name: 'swarmbbs.list_threads',
    description: 'List threads in a space with message counts, sizes, and metadata',
    inputSchema: {
      type: 'object',
      properties: {
        space: {
          type: 'string',
          pattern: '^[A-Za-z0-9._-]+$',
          description: 'Target space (defaults to server-configured space)',
        },
        include_p2p: {
          type: 'boolean',
          description: 'Include P2P threads in the results (defaults to false)',
        },
      },
      additionalProperties: false,
    },
  },
  handler: async (args: Record<string, unknown>, config: ServerConfig) => {
    const space = (args.space as string) || config.defaultSpace;
    const includeP2p = (args.include_p2p as boolean) || false;

    return listThreads(config.rootDir, space, { space, include_p2p: includeP2p });
  },
};

/**
 * archive_space tool
 */
const archiveSpaceTool: ToolDefinition = {
  definition: {
    name: 'swarmbbs.archive_space',
    description: 'Archive a space by moving it to archives directory with timestamp (reversible)',
    inputSchema: {
      type: 'object',
      properties: {
        space: {
          type: 'string',
          pattern: '^[A-Za-z0-9._-]+$',
          description: 'Space to archive',
        },
      },
      required: ['space'],
      additionalProperties: false,
    },
  },
  handler: async (args: Record<string, unknown>, config: ServerConfig) => {
    const space = args.space as string;

    return archiveSpace(config.rootDir, { space });
  },
};

/**
 * clear_space tool
 */
const clearSpaceTool: ToolDefinition = {
  definition: {
    name: 'swarmbbs.clear_space',
    description: 'Permanently delete a space and all its threads (IRREVERSIBLE - requires explicit confirmation)',
    inputSchema: {
      type: 'object',
      properties: {
        space: {
          type: 'string',
          pattern: '^[A-Za-z0-9._-]+$',
          description: 'Space to delete',
        },
        confirm: {
          type: 'boolean',
          description: 'Must be set to true to proceed with deletion (required)',
        },
      },
      required: ['space', 'confirm'],
      additionalProperties: false,
    },
  },
  handler: async (args: Record<string, unknown>, config: ServerConfig) => {
    const space = args.space as string;
    const confirm = args.confirm as boolean;

    return clearSpace(config.rootDir, { space, confirm });
  },
};

/**
 * Register all lifecycle tools
 */
export function registerLifecycleTools(registry: Map<string, ToolDefinition>): void {
  registry.set('swarmbbs.list_spaces', listSpacesTool);
  registry.set('swarmbbs.list_threads', listThreadsTool);
  registry.set('swarmbbs.archive_space', archiveSpaceTool);
  registry.set('swarmbbs.clear_space', clearSpaceTool);
}
