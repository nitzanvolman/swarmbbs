/**
 * Messaging Tools for SwarmBBS
 *
 * Implements send_message, poll_messages, and reset_cursor tools
 */

import { EventEmitter } from 'events';
import type { ToolDefinition, ServerConfig } from '../server/mcp-server.js';
import { appendMessage, readThreadAfterSeq, getThreadMetadata } from '../storage/thread-ops.js';
import {
  getCursor,
  getEffectiveCursor,
  advanceCursorWithReceipt,
  resetCursor as resetCursorOp,
} from '../storage/cursor-ops.js';
import { getAnnouncement, getAnnouncementSeen, markAnnouncementSeen, getWhoIsOnline } from '../storage/state-ops.js';
import { sanitizeText, validateMessageSize, validateName, getByteLength } from '../utils/validation.js';
import { badRequest, payloadTooLarge } from '../utils/errors.js';
import { isMessageEvent } from '../types/events.js';

/**
 * Global event emitter for message notifications
 * Event format: 'message:${space}:${thread}'
 */
const messageNotifier = new EventEmitter();
messageNotifier.setMaxListeners(1000); // Allow many concurrent polls

/**
 * send_message tool
 */
const sendMessageTool: ToolDefinition = {
  definition: {
    name: 'swarmbbs.send_message',
    description: 'Appends a message to a thread, creating the thread if it doesn\'t exist',
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
          description: 'Target thread name',
        },
        text: {
          type: 'string',
          minLength: 1,
          maxLength: 8192,
          description: 'Message content (newlines will be sanitized)',
        },
      },
      required: ['thread', 'text'],
      additionalProperties: false,
    },
  },
  handler: async (args: Record<string, unknown>, config: ServerConfig) => {
    // Validate input
    const thread = args.thread as string;
    const text = args.text as string;
    const space = (args.space as string) || config.defaultSpace;

    if (!thread || typeof thread !== 'string') {
      throw badRequest(
        'Missing or invalid "thread" parameter',
        { field: 'thread' },
        'Provide a valid thread name matching ^[A-Za-z0-9._-]+$'
      );
    }

    if (!text || typeof text !== 'string') {
      throw badRequest(
        'Missing or invalid "text" parameter',
        { field: 'text' },
        'Provide non-empty message text'
      );
    }

    // Validate names
    if (!validateName(space)) {
      throw badRequest(
        `Invalid space name '${space}': must match ^[A-Za-z0-9._-]+$`,
        { field: 'space', provided: space, pattern: '^[A-Za-z0-9._-]+$' },
        'Use only alphanumeric characters, dots, underscores, and hyphens in space names'
      );
    }

    if (!validateName(thread)) {
      throw badRequest(
        `Invalid thread name '${thread}': must match ^[A-Za-z0-9._-]+$`,
        { field: 'thread', provided: thread, pattern: '^[A-Za-z0-9._-]+$' },
        'Use only alphanumeric characters, dots, underscores, and hyphens in thread names. Avoid path traversal patterns.'
      );
    }

    // Sanitize text
    const sanitized = sanitizeText(text);

    // Validate size
    if (!validateMessageSize(sanitized)) {
      const byteLength = getByteLength(sanitized);
      throw payloadTooLarge(
        'Message text',
        8192,
        byteLength,
        'Split the message into multiple smaller messages (< 8 KiB each), or summarize the content before sending.'
      );
    }

    // Append message
    const event = await appendMessage(config.rootDir, space, thread, config.handle, sanitized);

    // Emit notification for blocking polls
    const eventName = `message:${space}:${thread}`;
    messageNotifier.emit(eventName, event);

    return {
      success: true,
      space,
      thread,
      seq: event.seq,
      ts: event.ts,
      from: event.from,
      text: event.text,
    };
  },
};

/**
 * poll_messages tool
 */
const pollMessagesTool: ToolDefinition = {
  definition: {
    name: 'swarmbbs.poll_messages',
    description: 'Polls one or more threads for new messages. Returns messages with seq > cursor position.',
    inputSchema: {
      type: 'object',
      properties: {
        space: {
          type: 'string',
          pattern: '^[A-Za-z0-9._-]+$',
          description: 'Target space (defaults to server-configured space)',
        },
        threads: {
          type: 'array',
          items: {
            type: 'string',
            pattern: '^[A-Za-z0-9._-]+$',
          },
          minItems: 1,
          maxItems: 100,
          description: 'List of thread names to poll',
        },
        timeout_ms: {
          type: 'integer',
          minimum: 0,
          maximum: 300000,
          default: 0,
          description: 'Timeout in milliseconds (0 = non-blocking, returns immediately)',
        },
        max_per_thread: {
          type: 'integer',
          minimum: 1,
          maximum: 10000,
          default: 1000,
          description: 'Maximum messages to return per thread',
        },
      },
      required: ['threads'],
      additionalProperties: false,
    },
  },
  handler: async (args: Record<string, unknown>, config: ServerConfig) => {
    // Validate input
    const threads = args.threads as string[];
    const space = (args.space as string) || config.defaultSpace;
    const timeoutMs = (args.timeout_ms as number) || 0;
    const maxPerThread = (args.max_per_thread as number) || 1000;

    if (!Array.isArray(threads) || threads.length === 0) {
      throw badRequest(
        'Missing or invalid "threads" parameter',
        { field: 'threads' },
        'Provide an array of thread names to poll'
      );
    }

    // Validate space name
    if (!validateName(space)) {
      throw badRequest(
        `Invalid space name '${space}': must match ^[A-Za-z0-9._-]+$`,
        { field: 'space', provided: space, pattern: '^[A-Za-z0-9._-]+$' },
        'Use only alphanumeric characters, dots, underscores, and hyphens in space names'
      );
    }

    // Validate thread names
    for (const thread of threads) {
      if (!validateName(thread)) {
        throw badRequest(
          `Invalid thread name in poll list: '${thread}'`,
          { field: 'threads', invalid_thread: thread, pattern: '^[A-Za-z0-9._-]+$' },
          'Ensure all thread names match ^[A-Za-z0-9._-]+$'
        );
      }
    }

    /**
     * Helper function to poll all threads and check for new messages
     */
    const pollAllThreads = async (): Promise<{
      messages: Record<string, unknown[]>;
      cursors: Record<string, unknown>;
      hasNewMessages: boolean;
    }> => {
      const messages: Record<string, unknown[]> = {};
      const cursors: Record<string, unknown> = {};
      let hasNewMessages = false;

      // Poll threads in parallel for efficiency
      await Promise.all(
        threads.map(async (thread) => {
          // Get effective cursor position
          const effectiveCursor = await getEffectiveCursor(config.rootDir, space, config.handle, thread);

          // Read messages after cursor
          const events = await readThreadAfterSeq(
            config.rootDir,
            space,
            thread,
            effectiveCursor.last_seq,
            maxPerThread
          );

          // Filter only message events
          const messageEvents = events.filter(isMessageEvent);

          // Store messages
          messages[thread] = messageEvents.map((e) => ({
            seq: e.seq,
            ts: e.ts,
            from: e.from,
            text: e.text,
          }));

          // Determine new cursor position
          let newLastSeq = effectiveCursor.last_seq;
          if (messageEvents.length > 0) {
            newLastSeq = messageEvents[messageEvents.length - 1].seq;
            hasNewMessages = true;
          }

          // Advance cursor if we delivered messages
          if (newLastSeq > effectiveCursor.last_seq) {
            await advanceCursorWithReceipt(config.rootDir, space, config.handle, thread, newLastSeq);
          }

          // Get updated cursor
          const updatedCursor = await getCursor(config.rootDir, space, config.handle, thread);

          cursors[thread] = {
            last_seq: updatedCursor?.last_seq || 0,
            epoch: updatedCursor?.epoch || 0,
            advanced_from: effectiveCursor.last_seq,
            advanced_to: newLastSeq,
          };
        })
      );

      return { messages, cursors, hasNewMessages };
    };

    // First, do an immediate poll to check for existing messages
    let pollResult = await pollAllThreads();

    // If no messages and timeout > 0, set up blocking poll
    let timedOut = false;
    if (!pollResult.hasNewMessages && timeoutMs > 0) {
      // Set up event listeners for all threads
      const eventNames = threads.map((thread) => `message:${space}:${thread}`);

      // Wait for either a message or timeout
      timedOut = await new Promise<boolean>((resolve) => {
        let timeoutHandle: NodeJS.Timeout | null = null;
        let resolved = false;

        const cleanup = () => {
          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
          }
          // Remove all event listeners
          for (const eventName of eventNames) {
            messageNotifier.removeAllListeners(eventName);
          }
        };

        const onMessage = () => {
          if (!resolved) {
            resolved = true;
            cleanup();
            resolve(false); // Not timed out - got a message
          }
        };

        // Set up listeners for all threads
        for (const eventName of eventNames) {
          messageNotifier.once(eventName, onMessage);
        }

        // Set up timeout
        timeoutHandle = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            cleanup();
            resolve(true); // Timed out
          }
        }, timeoutMs);
      });

      // If we got a message notification, re-poll to get the actual messages
      if (!timedOut) {
        pollResult = await pollAllThreads();
      }
    }

    // Check for announcement updates
    let announcement: unknown = undefined;
    const currentAnnouncement = await getAnnouncement(config.rootDir, space);
    if (currentAnnouncement) {
      const lastSeenVersion = await getAnnouncementSeen(config.rootDir, space, config.handle);
      if (currentAnnouncement.version > lastSeenVersion) {
        // Append "Who's online" section
        const onlineAgents = await getWhoIsOnline(config.rootDir, space, config.presenceTTL);
        let content = currentAnnouncement.content;

        if (onlineAgents.length > 0) {
          content += '\n\n---\n\n## Who\'s Online\n\n';
          for (const agent of onlineAgents) {
            const role = agent.profile?.role || 'agent';
            const status = agent.presence.status || 'available';
            content += `- ${agent.handle} (${status}) - Role: ${role}\n`;
          }
        }

        announcement = {
          version: currentAnnouncement.version,
          ts: currentAnnouncement.ts,
          content_type: currentAnnouncement.content_type,
          content,
        };

        // Mark as seen
        await markAnnouncementSeen(config.rootDir, space, config.handle, currentAnnouncement.version);
      }
    }

    const result: Record<string, unknown> = {
      success: true,
      space,
      timed_out: timedOut,
      messages: pollResult.messages,
      cursors: pollResult.cursors,
    };

    if (announcement !== undefined) {
      result.announcement = announcement;
    }

    return result;
  },
};

/**
 * reset_cursor tool
 */
const resetCursorTool: ToolDefinition = {
  definition: {
    name: 'swarmbbs.reset_cursor',
    description: 'Resets the caller\'s cursor position in a thread, allowing re-reading of messages',
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
          description: 'Thread to reset cursor for',
        },
        to_seq: {
          type: 'integer',
          minimum: 0,
          default: 0,
          description: 'Sequence number to reset to (0 = beginning, omit = use min_available_seq)',
        },
      },
      required: ['thread'],
      additionalProperties: false,
    },
  },
  handler: async (args: Record<string, unknown>, config: ServerConfig) => {
    // Validate input
    const thread = args.thread as string;
    const space = (args.space as string) || config.defaultSpace;
    const toSeq = (args.to_seq as number) ?? 0;

    if (!thread || typeof thread !== 'string') {
      throw badRequest(
        'Missing or invalid "thread" parameter',
        { field: 'thread' },
        'Provide a valid thread name'
      );
    }

    // Validate names
    if (!validateName(space)) {
      throw badRequest(
        `Invalid space name '${space}': must match ^[A-Za-z0-9._-]+$`,
        { field: 'space', provided: space, pattern: '^[A-Za-z0-9._-]+$' },
        'Use only alphanumeric characters, dots, underscores, and hyphens in space names'
      );
    }

    if (!validateName(thread)) {
      throw badRequest(
        `Invalid thread name '${thread}': must match ^[A-Za-z0-9._-]+$`,
        { field: 'thread', provided: thread, pattern: '^[A-Za-z0-9._-]+$' },
        'Use only alphanumeric characters, dots, underscores, and hyphens in thread names'
      );
    }

    // Get old cursor
    const oldCursor = await getCursor(config.rootDir, space, config.handle, thread);
    const threadMetadata = await getThreadMetadata(config.rootDir, space, thread);

    // Reset cursor
    const newCursor = await resetCursorOp(config.rootDir, space, config.handle, thread, toSeq);

    // Check if clamped
    let note: string | undefined;
    if (toSeq < threadMetadata.min_available_seq) {
      note = `Requested seq=${toSeq} was clamped to min_available_seq=${threadMetadata.min_available_seq} due to thread compaction`;
    }

    const result: Record<string, unknown> = {
      success: true,
      space,
      thread,
      old_cursor: {
        last_seq: oldCursor?.last_seq || 0,
        epoch: oldCursor?.epoch || 0,
      },
      new_cursor: {
        last_seq: newCursor.last_seq,
        epoch: newCursor.epoch,
      },
    };

    if (note) {
      result.note = note;
    }

    return result;
  },
};

/**
 * Register all messaging tools
 */
export function registerMessagingTools(registry: Map<string, ToolDefinition>): void {
  registry.set('swarmbbs.send_message', sendMessageTool);
  registry.set('swarmbbs.poll_messages', pollMessagesTool);
  registry.set('swarmbbs.reset_cursor', resetCursorTool);
}
