/**
 * Thread Compaction Tools for MCP
 *
 * Provides compact_begin, compact_commit, and compact_abort tools
 */

import type { ToolDefinition, ServerConfig } from '../server/mcp-server.js';
import type { MessageEvent } from '../types/events.js';
import { beginCompaction, commitCompaction, abortCompaction } from '../storage/compaction-impl.js';
import { assertValidName } from '../utils/validation.js';

/**
 * compact_begin tool - Start two-phase compaction
 */
export async function compactBegin(
  rootDir: string,
  defaultSpace: string,
  input: {
    space?: string;
    thread: string;
  }
): Promise<{
  success: boolean;
  space: string;
  thread: string;
  compaction_id: string;
  base_seq: number;
  epoch: number;
  note: string;
}> {
  const space = input.space || defaultSpace;

  // Validate names
  assertValidName(space, 'space');
  assertValidName(input.thread, 'thread');

  const result = await beginCompaction(rootDir, space, input.thread);

  return {
    success: true,
    space,
    thread: input.thread,
    compaction_id: result.compaction_id,
    base_seq: result.base_seq,
    epoch: result.epoch,
    note: `Compaction started. Read messages 1-${result.base_seq}, generate summary, then call compact_commit or compact_abort. New messages are being written to delta file.`,
  };
}

/**
 * compact_commit tool - Commit compaction with snapshot
 */
export async function compactCommit(
  rootDir: string,
  defaultSpace: string,
  input: {
    space?: string;
    thread: string;
    compaction_id: string;
    snapshot: {
      covers_from_seq: number;
      covers_to_seq: number;
      summary: string | Record<string, unknown>;
      meta?: Record<string, unknown>;
    };
    keep_messages?: Array<{
      seq: number;
      ts: string;
      from: string;
      text: string;
      up_to_seq?: number; // Optional: sender's read position (defaults to 0 if not provided)
    }>;
  }
): Promise<{
  success: boolean;
  space: string;
  thread: string;
  new_epoch: number;
  min_available_seq: number;
  message_count: number;
  delta_replayed: number;
}> {
  const space = input.space || defaultSpace;

  // Validate names
  assertValidName(space, 'space');
  assertValidName(input.thread, 'thread');

  // Convert keep_messages to MessageEvent format if provided
  const keepMessages: MessageEvent[] | undefined = input.keep_messages?.map(msg => ({
    type: 'msg' as const,
    seq: msg.seq,
    ts: msg.ts,
    from: msg.from,
    text: msg.text,
    up_to_seq: msg.up_to_seq ?? 0, // Default to 0 if not provided (historical data)
  }));

  const result = await commitCompaction(
    rootDir,
    space,
    input.thread,
    input.compaction_id,
    input.snapshot,
    keepMessages
  );

  return {
    success: true,
    space,
    thread: input.thread,
    new_epoch: result.new_epoch,
    min_available_seq: result.min_available_seq,
    message_count: result.message_count,
    delta_replayed: result.delta_replayed,
  };
}

/**
 * compact_abort tool - Abort compaction and merge delta
 */
export async function compactAbort(
  rootDir: string,
  defaultSpace: string,
  input: {
    space?: string;
    thread: string;
    compaction_id: string;
  }
): Promise<{
  success: boolean;
  space: string;
  thread: string;
  delta_messages_merged: number;
  note: string;
}> {
  const space = input.space || defaultSpace;

  // Validate names
  assertValidName(space, 'space');
  assertValidName(input.thread, 'thread');

  const result = await abortCompaction(rootDir, space, input.thread, input.compaction_id);

  const note = result.delta_messages_merged > 0
    ? `Compaction aborted successfully. All ${result.delta_messages_merged} delta messages merged back to main thread. Thread state is unchanged from user perspective.`
    : 'Compaction aborted successfully. No delta messages to merge. Thread state is unchanged.';

  return {
    success: true,
    space,
    thread: input.thread,
    delta_messages_merged: result.delta_messages_merged,
    note,
  };
}

// ============================================================================
// MCP Tool Definitions
// ============================================================================

/**
 * compact_begin tool
 */
const compactBeginTool: ToolDefinition = {
  definition: {
    name: 'swarmbbs.compact_begin',
    description: 'Begin two-phase compaction on a thread (creates delta file for new messages during compaction)',
    inputSchema: {
      type: 'object',
      properties: {
        space: {
          type: 'string',
          pattern: '^[A-Za-z0-9._-]+$',
          description: 'Target space (defaults to server-configured space)',
        },
        thread: {
          type: 'string',
          pattern: '^[A-Za-z0-9._-]+$',
          description: 'Thread to compact',
        },
      },
      required: ['thread'],
      additionalProperties: false,
    },
  },
  handler: async (args: Record<string, unknown>, config: ServerConfig) => {
    const thread = args.thread as string;
    const space = (args.space as string) || config.defaultSpace;

    return compactBegin(config.rootDir, space, { thread, space });
  },
};

/**
 * compact_commit tool
 */
const compactCommitTool: ToolDefinition = {
  definition: {
    name: 'swarmbbs.compact_commit',
    description: 'Commit compaction with snapshot summary (bumps epoch, clears old messages, merges delta)',
    inputSchema: {
      type: 'object',
      properties: {
        space: {
          type: 'string',
          pattern: '^[A-Za-z0-9._-]+$',
          description: 'Target space (defaults to server-configured space)',
        },
        thread: {
          type: 'string',
          pattern: '^[A-Za-z0-9._-]+$',
          description: 'Thread being compacted',
        },
        compaction_id: {
          type: 'string',
          description: 'Compaction ID from compact_begin',
        },
        snapshot: {
          type: 'object',
          properties: {
            covers_from_seq: { type: 'number' },
            covers_to_seq: { type: 'number' },
            summary: {
              description: 'Summary of compacted messages (string or structured object)',
            },
            meta: {
              type: 'object',
              description: 'Optional metadata',
            },
          },
          required: ['covers_from_seq', 'covers_to_seq', 'summary'],
        },
        keep_messages: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              seq: { type: 'number' },
              ts: { type: 'string' },
              from: { type: 'string' },
              text: { type: 'string' },
            },
            required: ['seq', 'ts', 'from', 'text'],
          },
          description: 'Optional messages to preserve from the compacted range',
        },
      },
      required: ['thread', 'compaction_id', 'snapshot'],
      additionalProperties: false,
    },
  },
  handler: async (args: Record<string, unknown>, config: ServerConfig) => {
    const thread = args.thread as string;
    const compactionId = args.compaction_id as string;
    const snapshot = args.snapshot as {
      covers_from_seq: number;
      covers_to_seq: number;
      summary: string | Record<string, unknown>;
      meta?: Record<string, unknown>;
    };
    const keepMessages = args.keep_messages as Array<{
      seq: number;
      ts: string;
      from: string;
      text: string;
    }> | undefined;
    const space = (args.space as string) || config.defaultSpace;

    return compactCommit(config.rootDir, space, {
      thread,
      compaction_id: compactionId,
      snapshot,
      keep_messages: keepMessages,
      space,
    });
  },
};

/**
 * compact_abort tool
 */
const compactAbortTool: ToolDefinition = {
  definition: {
    name: 'swarmbbs.compact_abort',
    description: 'Abort compaction and merge delta messages back to main thread (no epoch change)',
    inputSchema: {
      type: 'object',
      properties: {
        space: {
          type: 'string',
          pattern: '^[A-Za-z0-9._-]+$',
          description: 'Target space (defaults to server-configured space)',
        },
        thread: {
          type: 'string',
          pattern: '^[A-Za-z0-9._-]+$',
          description: 'Thread being compacted',
        },
        compaction_id: {
          type: 'string',
          description: 'Compaction ID from compact_begin',
        },
      },
      required: ['thread', 'compaction_id'],
      additionalProperties: false,
    },
  },
  handler: async (args: Record<string, unknown>, config: ServerConfig) => {
    const thread = args.thread as string;
    const compactionId = args.compaction_id as string;
    const space = (args.space as string) || config.defaultSpace;

    return compactAbort(config.rootDir, space, { thread, compaction_id: compactionId, space });
  },
};

/**
 * Register all compaction tools
 */
export function registerCompactionTools(registry: Map<string, ToolDefinition>): void {
  registry.set('swarmbbs.compact_begin', compactBeginTool);
  registry.set('swarmbbs.compact_commit', compactCommitTool);
  registry.set('swarmbbs.compact_abort', compactAbortTool);
}

