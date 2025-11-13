/**
 * Validation Utilities for SwarmBBS
 *
 * Includes name validation and text sanitization
 */

/**
 * Validate space/thread name pattern
 * Must match: ^[A-Za-z0-9._-]+$
 */
export function validateName(name: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(name);
}

/**
 * Validate and throw if name is invalid
 */
export function assertValidName(name: string, context: string): void {
  if (!validateName(name)) {
    throw new Error(
      `Invalid ${context} name '${name}': must match pattern ^[A-Za-z0-9._-]+$`
    );
  }
}

/**
 * Sanitize text to prevent JSONL corruption
 * Replaces newlines with spaces to ensure one-line-per-event format
 */
export function sanitizeText(text: string): string {
  return text.replace(/\r?\n/g, ' ').trim();
}

/**
 * Validate message text size
 * Max: 8 KiB (8192 bytes)
 */
export function validateMessageSize(text: string): boolean {
  return Buffer.byteLength(text, 'utf8') <= 8192;
}

/**
 * Validate announcement content size
 * Max: 64 KiB (65536 bytes)
 */
export function validateAnnouncementSize(content: string): boolean {
  return Buffer.byteLength(content, 'utf8') <= 65536;
}

/**
 * Get byte length of text
 */
export function getByteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

/**
 * Generate canonical P2P thread name
 * Format: p2p/<handle-a>__<handle-b> where handles are lowercase and alphabetically sorted
 */
export function canonicalP2PName(handleA: string, handleB: string): string {
  const a = handleA.toLowerCase();
  const b = handleB.toLowerCase();
  const [first, second] = a < b ? [a, b] : [b, a];
  return `p2p/${first}__${second}`;
}

/**
 * Check if a thread name is a P2P thread
 */
export function isP2PThread(threadName: string): boolean {
  return threadName.startsWith('p2p/');
}

/**
 * Extract handles from P2P thread name
 * Returns null if not a valid P2P thread name
 */
export function parseP2PThread(threadName: string): { handleA: string; handleB: string } | null {
  if (!threadName.startsWith('p2p/')) {
    return null;
  }

  const parts = threadName.slice(4).split('__');
  if (parts.length !== 2) {
    return null;
  }

  return {
    handleA: parts[0],
    handleB: parts[1]
  };
}
