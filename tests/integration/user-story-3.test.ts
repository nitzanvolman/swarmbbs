/**
 * Integration Tests for User Story 3: Multi-Thread Polling with Timeout
 *
 * Goal: Enable agents to poll multiple threads simultaneously with blocking timeout for efficient message retrieval.
 *
 * Test: Agent starts polling with 5-second timeout on three threads, a message arrives in one thread after 2 seconds,
 * and poll returns immediately (not waiting full timeout).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { registerMessagingTools } from '../../src/tools/messaging.js';
import type { ToolDefinition, ServerConfig } from '../../src/server/mcp-server.js';
import { clearThreadMetadataCache } from '../../src/storage/thread-ops.js';

describe('User Story 3: Multi-Thread Polling with Timeout', () => {
  let testRoot: string;
  let agentConfig: ServerConfig;
  let tools: Map<string, ToolDefinition>;

  beforeEach(async () => {
    // Create temporary test directory
    testRoot = await mkdtemp(join(tmpdir(), 'swarmbbs-us3-'));

    agentConfig = {
      rootDir: testRoot,
      handle: 'agent-poller',
      defaultSpace: 'test-space',
      presenceTTL: 60,
    };

    tools = new Map();
    registerMessagingTools(tools);
  });

  afterEach(async () => {
    // Clear thread metadata cache
    clearThreadMetadataCache();

    // Cleanup test directory
    await rm(testRoot, { recursive: true, force: true });
  });

  it('should poll three threads with timeout and return early when message arrives', async () => {
    const sendTool = tools.get('swarmbbs.send_message')!;
    const pollTool = tools.get('swarmbbs.poll_messages')!;

    // Create a second agent to send messages
    const senderConfig: ServerConfig = {
      ...agentConfig,
      handle: 'agent-sender',
    };

    // Start polling three threads with 5 second timeout
    const pollStartTime = Date.now();
    const pollPromise = pollTool.handler(
      {
        threads: ['coordination', 'alerts', 'status'],
        timeout_ms: 5000,
      },
      agentConfig
    );

    // Wait 2 seconds, then send a message to one thread
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await sendTool.handler(
      {
        thread: 'alerts',
        text: 'Important alert: System update required',
      },
      senderConfig
    );

    // Poll should return early (not wait full 5 seconds)
    const result = await pollPromise;
    const elapsed = Date.now() - pollStartTime;

    // Verify early return
    expect(elapsed).toBeLessThan(4500); // Should return ~2 seconds, not 5 seconds
    expect(elapsed).toBeGreaterThanOrEqual(1800); // Should wait at least ~2 seconds

    // Verify result structure
    expect((result as any).success).toBe(true);
    expect((result as any).timed_out).toBe(false);
    expect((result as any).space).toBe('test-space');

    // Verify messages
    const messages = (result as any).messages;
    expect(messages['coordination']).toHaveLength(0);
    expect(messages['alerts']).toHaveLength(1);
    expect(messages['alerts'][0]).toMatchObject({
      seq: 1,
      from: 'agent-sender',
      text: 'Important alert: System update required',
    });
    expect(messages['status']).toHaveLength(0);

    // Verify cursors advanced
    const cursors = (result as any).cursors;
    expect(cursors['coordination']).toMatchObject({
      last_seq: 0,
      epoch: 0,
      advanced_from: 0,
      advanced_to: 0,
    });
    expect(cursors['alerts']).toMatchObject({
      last_seq: 1,
      epoch: 0,
      advanced_from: 0,
      advanced_to: 1,
    });
    expect(cursors['status']).toMatchObject({
      last_seq: 0,
      epoch: 0,
      advanced_from: 0,
      advanced_to: 0,
    });
  });

  it('should timeout when no messages arrive within timeout period', async () => {
    const pollTool = tools.get('swarmbbs.poll_messages')!;

    // Poll with short timeout, no messages will be sent
    const startTime = Date.now();
    const result = await pollTool.handler(
      {
        threads: ['coordination', 'alerts', 'status'],
        timeout_ms: 2000,
      },
      agentConfig
    );
    const elapsed = Date.now() - startTime;

    // Verify timeout behavior
    expect(elapsed).toBeGreaterThanOrEqual(1800); // Should wait approximately full timeout
    expect(elapsed).toBeLessThan(2500);

    // Verify result
    expect((result as any).success).toBe(true);
    expect((result as any).timed_out).toBe(true);

    // Verify no messages
    const messages = (result as any).messages;
    expect(messages['coordination']).toHaveLength(0);
    expect(messages['alerts']).toHaveLength(0);
    expect(messages['status']).toHaveLength(0);
  });

  it('should return immediately when messages already exist (no blocking)', async () => {
    const sendTool = tools.get('swarmbbs.send_message')!;
    const pollTool = tools.get('swarmbbs.poll_messages')!;

    const senderConfig: ServerConfig = {
      ...agentConfig,
      handle: 'agent-sender',
    };

    // Pre-populate threads with messages
    await sendTool.handler({ thread: 'coordination', text: 'Message 1' }, senderConfig);
    await sendTool.handler({ thread: 'alerts', text: 'Alert 1' }, senderConfig);

    // Poll with timeout should return immediately
    const startTime = Date.now();
    const result = await pollTool.handler(
      {
        threads: ['coordination', 'alerts', 'status'],
        timeout_ms: 5000,
      },
      agentConfig
    );
    const elapsed = Date.now() - startTime;

    // Should return immediately since messages are available
    expect(elapsed).toBeLessThan(1000);
    expect((result as any).timed_out).toBe(false);

    // Verify messages
    const messages = (result as any).messages;
    expect(messages['coordination']).toHaveLength(1);
    expect(messages['alerts']).toHaveLength(1);
    expect(messages['status']).toHaveLength(0);
  });

  it('should handle multiple concurrent pollers on same threads', async () => {
    const sendTool = tools.get('swarmbbs.send_message')!;
    const pollTool = tools.get('swarmbbs.poll_messages')!;

    // Create two polling agents
    const poller1Config: ServerConfig = {
      ...agentConfig,
      handle: 'agent-poller-1',
    };

    const poller2Config: ServerConfig = {
      ...agentConfig,
      handle: 'agent-poller-2',
    };

    const senderConfig: ServerConfig = {
      ...agentConfig,
      handle: 'agent-sender',
    };

    // Start both pollers with timeout
    const poll1Promise = pollTool.handler(
      { threads: ['coordination'], timeout_ms: 5000 },
      poller1Config
    );

    const poll2Promise = pollTool.handler(
      { threads: ['coordination'], timeout_ms: 5000 },
      poller2Config
    );

    // Wait 1 second, then send message
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await sendTool.handler({ thread: 'coordination', text: 'Broadcast message' }, senderConfig);

    // Both pollers should receive the message
    const [result1, result2] = await Promise.all([poll1Promise, poll2Promise]);

    // Both should receive the message
    expect((result1 as any).timed_out).toBe(false);
    expect((result1 as any).messages['coordination']).toHaveLength(1);
    expect((result1 as any).messages['coordination'][0].text).toBe('Broadcast message');

    expect((result2 as any).timed_out).toBe(false);
    expect((result2 as any).messages['coordination']).toHaveLength(1);
    expect((result2 as any).messages['coordination'][0].text).toBe('Broadcast message');

    // Cursors should be independent
    expect((result1 as any).cursors['coordination'].advanced_to).toBe(1);
    expect((result2 as any).cursors['coordination'].advanced_to).toBe(1);
  });

  it('should handle rapid message arrival during blocking poll', async () => {
    const sendTool = tools.get('swarmbbs.send_message')!;
    const pollTool = tools.get('swarmbbs.poll_messages')!;

    const senderConfig: ServerConfig = {
      ...agentConfig,
      handle: 'agent-sender',
    };

    // Start poll
    const pollPromise = pollTool.handler(
      { threads: ['coordination'], timeout_ms: 5000 },
      agentConfig
    );

    // Wait 500ms, then send multiple messages rapidly
    await new Promise((resolve) => setTimeout(resolve, 500));
    await sendTool.handler({ thread: 'coordination', text: 'Message 1' }, senderConfig);
    await sendTool.handler({ thread: 'coordination', text: 'Message 2' }, senderConfig);
    await sendTool.handler({ thread: 'coordination', text: 'Message 3' }, senderConfig);

    // Poll should return with all messages
    const result = await pollPromise;

    expect((result as any).timed_out).toBe(false);
    expect((result as any).messages['coordination'].length).toBeGreaterThanOrEqual(1);
    // Note: Due to timing, we might get 1-3 messages depending on when the poll wakes up
  });

  it('should support max_per_thread limit with blocking poll', async () => {
    const sendTool = tools.get('swarmbbs.send_message')!;
    const pollTool = tools.get('swarmbbs.poll_messages')!;

    const senderConfig: ServerConfig = {
      ...agentConfig,
      handle: 'agent-sender',
    };

    // Pre-send many messages
    for (let i = 1; i <= 10; i++) {
      await sendTool.handler({ thread: 'coordination', text: `Message ${i}` }, senderConfig);
    }

    // Poll with limit
    const result = await pollTool.handler(
      {
        threads: ['coordination'],
        timeout_ms: 1000,
        max_per_thread: 5,
      },
      agentConfig
    );

    // Should return immediately with limited messages
    expect((result as any).timed_out).toBe(false);
    expect((result as any).messages['coordination'].length).toBeLessThanOrEqual(5);
  });

  it('should work with timeout_ms=0 for immediate non-blocking poll', async () => {
    const sendTool = tools.get('swarmbbs.send_message')!;
    const pollTool = tools.get('swarmbbs.poll_messages')!;

    const senderConfig: ServerConfig = {
      ...agentConfig,
      handle: 'agent-sender',
    };

    // Send message
    await sendTool.handler({ thread: 'coordination', text: 'Quick message' }, senderConfig);

    // Poll with timeout=0
    const startTime = Date.now();
    const result = await pollTool.handler(
      {
        threads: ['coordination'],
        timeout_ms: 0,
      },
      agentConfig
    );
    const elapsed = Date.now() - startTime;

    // Should be very fast
    expect(elapsed).toBeLessThan(500);
    expect((result as any).timed_out).toBe(false);
    expect((result as any).messages['coordination']).toHaveLength(1);
  });
});
