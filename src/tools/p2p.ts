/**
 * P2P Communication Tools
 *
 * Private agent-to-agent messaging with canonical thread naming
 */

import { canonicalP2PName, sanitizeText, validateMessageSize, getByteLength } from '../utils/validation.js';
import { badRequest, payloadTooLarge } from '../utils/errors.js';
import { appendMessage, getThreadPath } from '../storage/thread-ops.js';
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
