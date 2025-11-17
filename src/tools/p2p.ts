/**
 * P2P Communication Tools
 *
 * Private agent-to-agent messaging with canonical thread naming
 */

import type { ToolDefinition, ServerConfig } from '../server/mcp-server.js';
import { canonicalP2PName, sanitizeText, validateMessageSize, getByteLength } from '../utils/validation.js';
import { badRequest, payloadTooLarge, syncConflict } from '../utils/errors.js';
import { appendMessage, getThreadPath } from '../storage/thread-ops.js';
import { validateCursorSync, writeCursor } from '../storage/cursor-ops.js';
import { existsSync } from 'fs';

/**
 * Tool input/output types
 */
export interface OpenP2PInput {
  space?: string;
  peer_handle: string;
}

export interface OpenP2POutput {
  success: boolean;
  space: string;
  thread: string;
  your_handle: string;
  peer_handle: string;
  created: boolean;
}

export interface SendP2PInput {
  space?: string;
  peer_handle: string;
  text: string;
}

export interface SendP2POutput {
  success: boolean;
  space: string;
  thread: string;
  seq: number;
  ts: string;
  from: string;
  text: string;
}

/**
 * Open or retrieve a P2P thread between caller and peer
 *
 * Thread name is canonical: handles are lowercased and alphabetically sorted.
 * Format: p2p/<handle-a>__<handle-b>
 *
 * @param rootDir - Root directory for storage
 * @param myHandle - Caller's handle (inferred from server context)
 * @param defaultSpace - Default space if not specified
 * @param input - Tool input
 * @returns P2P thread information
 */
export async function openP2P(
  rootDir: string,
  myHandle: string,
  defaultSpace: string,
  input: OpenP2PInput
): Promise<OpenP2POutput> {
  const space = input.space || defaultSpace;
  const peerHandle = input.peer_handle;

  // Validate: cannot open P2P with self
  if (myHandle.toLowerCase() === peerHandle.toLowerCase()) {
    throw badRequest(
      'Cannot open P2P channel with yourself',
      { your_handle: myHandle, peer_handle: peerHandle },
      'Specify a different peer_handle. P2P channels are for communication between two different agents.'
    );
  }

  // Generate canonical thread name
  const threadName = canonicalP2PName(myHandle, peerHandle);

  // Check if thread already exists
  const threadPath = getThreadPath(rootDir, space, threadName);
  const created = !existsSync(threadPath);

  return {
    success: true,
    space,
    thread: threadName,
    your_handle: myHandle,
    peer_handle: peerHandle,
    created,
  };
}

/**
 * Convenience tool: open P2P channel and send message in one call
 *
 * Combines open_p2p + send_message functionality
 *
 * @param rootDir - Root directory for storage
 * @param myHandle - Caller's handle (inferred from server context)
 * @param defaultSpace - Default space if not specified
 * @param input - Tool input
 * @returns Message confirmation
 */
export async function sendP2P(
  rootDir: string,
  myHandle: string,
  defaultSpace: string,
  input: SendP2PInput
): Promise<SendP2POutput> {
  const space = input.space || defaultSpace;
  const peerHandle = input.peer_handle;
  const rawText = input.text;

  // Validate: cannot send P2P to self
  if (myHandle.toLowerCase() === peerHandle.toLowerCase()) {
    throw badRequest(
      'Cannot open P2P channel with yourself',
      { your_handle: myHandle, peer_handle: peerHandle },
      'Specify a different peer_handle. For notes to self, use a regular thread instead.'
    );
  }

  // Validate message size
  const textBytes = getByteLength(rawText);
  if (!validateMessageSize(rawText)) {
    throw payloadTooLarge(
      'Message text',
      8192,
      textBytes,
      'Split the message into multiple smaller messages (< 8 KiB each), or summarize the content before sending.'
    );
  }

  // Sanitize text
  const text = sanitizeText(rawText);

  // Generate canonical thread name
  const threadName = canonicalP2PName(myHandle, peerHandle);

  // Validate cursor synchronization before sending (FR-001, FR-002, FR-006)
  const syncResult = await validateCursorSync(rootDir, space, myHandle, threadName);

  if (!syncResult.isSync) {
    // Agent is out of sync - advance cursor and throw sync error (FR-004, FR-005)
    const cursorToWrite = {
      last_seq: syncResult.cursorState!.last_seq,
      epoch: syncResult.cursorState!.epoch,
      updated_ts: new Date().toISOString(),
    };
    await writeCursor(rootDir, space, myHandle, threadName, cursorToWrite);

    // Throw sync conflict error with missing messages (FR-003, FR-007, FR-008)
    throw syncConflict(threadName, syncResult.missingMessages || [], syncResult.cursorState!);
  }

  // Append message to P2P thread
  const event = await appendMessage(rootDir, space, threadName, myHandle, text);

  return {
    success: true,
    space,
    thread: threadName,
    seq: event.seq,
    ts: event.ts,
    from: event.from,
    text: event.text,
  };
}

// ============================================================================
// MCP Tool Definitions
// ============================================================================

/**
 * open_p2p tool
 */
const openP2PTool: ToolDefinition = {
  definition: {
    name: 'swarmbbs.open_p2p',
    description: 'Open or retrieve a P2P thread between caller and peer. Thread names are canonical (handles lowercased and alphabetically sorted).',
    inputSchema: {
      type: 'object',
      properties: {
        space: {
          type: 'string',
          pattern: '^[A-Za-z0-9._-]+$',
          description: 'Target space (defaults to server-configured space)',
        },
        peer_handle: {
          type: 'string',
          description: 'Handle of the peer agent to open P2P channel with',
        },
      },
      required: ['peer_handle'],
      additionalProperties: false,
    },
  },
  handler: async (args: Record<string, unknown>, config: ServerConfig) => {
    const peerHandle = args.peer_handle as string;
    const space = (args.space as string) || config.defaultSpace;

    if (!peerHandle || typeof peerHandle !== 'string') {
      throw badRequest(
        'Missing or invalid "peer_handle" parameter',
        { field: 'peer_handle' },
        'Provide the handle of the peer agent'
      );
    }

    return openP2P(config.rootDir, config.handle, space, { peer_handle: peerHandle, space });
  },
};

/**
 * send_p2p tool
 */
const sendP2PTool: ToolDefinition = {
  definition: {
    name: 'swarmbbs.send_p2p',
    description: 'Send a P2P message to a peer agent (combines open_p2p and send_message in one call)',
    inputSchema: {
      type: 'object',
      properties: {
        space: {
          type: 'string',
          pattern: '^[A-Za-z0-9._-]+$',
          description: 'Target space (defaults to server-configured space)',
        },
        peer_handle: {
          type: 'string',
          description: 'Handle of the peer agent to send message to',
        },
        text: {
          type: 'string',
          minLength: 1,
          maxLength: 8192,
          description: 'Message content (newlines will be sanitized)',
        },
      },
      required: ['peer_handle', 'text'],
      additionalProperties: false,
    },
  },
  handler: async (args: Record<string, unknown>, config: ServerConfig) => {
    const peerHandle = args.peer_handle as string;
    const text = args.text as string;
    const space = (args.space as string) || config.defaultSpace;

    if (!peerHandle || typeof peerHandle !== 'string') {
      throw badRequest(
        'Missing or invalid "peer_handle" parameter',
        { field: 'peer_handle' },
        'Provide the handle of the peer agent'
      );
    }

    if (!text || typeof text !== 'string') {
      throw badRequest(
        'Missing or invalid "text" parameter',
        { field: 'text' },
        'Provide non-empty message text'
      );
    }

    return sendP2P(config.rootDir, config.handle, space, { peer_handle: peerHandle, text, space });
  },
};

/**
 * Register all P2P tools
 */
export function registerP2PTools(registry: Map<string, ToolDefinition>): void {
  registry.set('swarmbbs.open_p2p', openP2PTool);
  registry.set('swarmbbs.send_p2p', sendP2PTool);
}

