/**
 * Cross-Process Blocking Poll Test
 *
 * Tests that blocking polls wake immediately when messages are written
 * from a DIFFERENT process (simulated by clearing the EventEmitter).
 *
 * This test exposes FR-064: cross-process notification requirement.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { appendMessage } from '../../src/storage/thread-ops.js';
import { pollMessages } from '../../src/tools/messaging.js';

describe('Cross-Process Blocking Poll (FR-064)', () => {
  const testRoot = join(process.cwd(), 'test-data', 'cross-process-poll');
  const space = 'test-space';
  const thread = 'test-thread';

  const config = {
    rootDir: testRoot,
    handle: 'agent-poller',
    defaultSpace: space,
    presenceTTL: 60,
  };

  beforeEach(async () => {
    await rm(testRoot, { recursive: true, force: true });
    await mkdir(testRoot, { recursive: true });
  });

  afterEach(async () => {
    await rm(testRoot, { recursive: true, force: true });
  });

  it('should wake blocking poll when message written by same process', async () => {
    // This test verifies the CURRENT behavior works within same process
    const pollPromise = pollMessages(
      { threads: [thread], timeout_ms: 5000 },
      config
    );

    // Wait a bit to ensure poll is blocking
    await new Promise(resolve => setTimeout(resolve, 100));

    // Write message from same process - EventEmitter will wake the poll
    await appendMessage(testRoot, space, thread, 'agent-writer', 'Test message');

    // Poll should return immediately (not wait 5 seconds)
    const startTime = Date.now();
    const result = await pollPromise;
    const elapsed = Date.now() - startTime;

    expect(elapsed).toBeLessThan(1000); // Should wake immediately, not wait 5s
    expect(result.timed_out).toBe(false);
    expect(result.messages[thread]).toHaveLength(1);
    expect(result.messages[thread][0].text).toBe('Test message');
  });

  it('should wake blocking poll when message written by different process (FR-064)', async () => {
    // Start blocking poll
    const pollPromise = pollMessages(
      { threads: [thread], timeout_ms: 5000 },
      config
    );

    // Wait to ensure poll is blocking
    await new Promise(resolve => setTimeout(resolve, 200));

    // Simulate a message written by DIFFERENT process:
    // We'll directly write to the file bypassing the EventEmitter
    // (In real scenario, this would be another MCP server process)
    const threadPath = join(testRoot, 'spaces', space, 'threads', `${thread}.log`);
    await mkdir(join(testRoot, 'spaces', space, 'threads'), { recursive: true });

    const event = {
      type: 'msg',
      ts: new Date().toISOString(),
      seq: 1,
      from: 'agent-from-other-process',
      text: 'Message from different process'
    };
    await writeFile(threadPath, JSON.stringify(event) + '\n', { flag: 'a' });

    // Poll should wake up via fs.watch (if implemented)
    // If NOT implemented, this will timeout after 5 seconds
    const startTime = Date.now();
    const result = await pollPromise;
    const elapsed = Date.now() - startTime;

    // CRITICAL: Should wake immediately, not wait for full timeout
    expect(elapsed).toBeLessThan(1000);
    expect(result.timed_out).toBe(false);
    expect(result.messages[thread]).toHaveLength(1);
    expect(result.messages[thread][0].text).toBe('Message from different process');
  }, 10000); // 10s timeout for the test itself

  it('should wake when ANY monitored thread receives message from different process', async () => {
    const threads = ['thread1', 'thread2', 'thread3'];

    // Start blocking poll on multiple threads
    const pollPromise = pollMessages(
      { threads, timeout_ms: 5000 },
      config
    );

    // Wait to ensure poll is blocking
    await new Promise(resolve => setTimeout(resolve, 200));

    // Write to thread2 from "different process"
    const threadPath = join(testRoot, 'spaces', space, 'threads', 'thread2.log');
    await mkdir(join(testRoot, 'spaces', space, 'threads'), { recursive: true });

    const event = {
      type: 'msg',
      ts: new Date().toISOString(),
      seq: 1,
      from: 'external-agent',
      text: 'Wake up!'
    };
    await writeFile(threadPath, JSON.stringify(event) + '\n', { flag: 'a' });

    // Should wake immediately
    const startTime = Date.now();
    const result = await pollPromise;
    const elapsed = Date.now() - startTime;

    expect(elapsed).toBeLessThan(1000);
    expect(result.timed_out).toBe(false);
    expect(result.messages.thread2).toHaveLength(1);
    expect(result.messages.thread2[0].text).toBe('Wake up!');
  }, 10000);
});

/**
 * Helper to access poll_messages handler for testing
 * We need to extract the handler function from the tool definition
 */
async function pollMessages(args: Record<string, unknown>, config: any): Promise<any> {
  // Import the messaging module
  const messaging = await import('../../src/tools/messaging.js');

  // Create a temporary registry to get the tool
  const registry = new Map();
  messaging.registerMessagingTools(registry);

  const pollTool = registry.get('swarmbbs.poll_messages');
  if (!pollTool) {
    throw new Error('poll_messages tool not found');
  }

  return pollTool.handler(args, config);
}
