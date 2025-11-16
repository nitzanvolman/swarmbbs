/**
 * Test for FR-012a: No Read Receipt Spam in Thread Logs
 *
 * Verifies that:
 * 1. Thread logs do NOT contain separate "read" events
 * 2. Message events include up_to_seq field (FR-007)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { appendMessage } from '../../src/storage/thread-ops.js';

describe('Read Receipt Removal (FR-012a)', () => {
  const testRoot = join(process.cwd(), 'test-data', 'read-receipt-removal');
  const space = 'test-space';
  const thread = 'test-thread';

  beforeEach(async () => {
    await rm(testRoot, { recursive: true, force: true });
    await mkdir(testRoot, { recursive: true });
  });

  afterEach(async () => {
    await rm(testRoot, { recursive: true, force: true });
  });

  it('should NOT write "read" events to thread logs', async () => {
    // Create a registry and get poll_messages tool
    const messaging = await import('../../src/tools/messaging.js');
    const registry = new Map();
    messaging.registerMessagingTools(registry);
    const pollTool = registry.get('swarmbbs.poll_messages');
    if (!pollTool) {
      throw new Error('poll_messages tool not found');
    }

    const config = {
      rootDir: testRoot,
      handle: 'agent-a',
      defaultSpace: space,
      presenceTTL: 60,
    };

    // Agent A sends a message
    await appendMessage(testRoot, space, thread, 'agent-a', 'First message');

    // Agent B polls and receives the message (this triggers cursor update)
    const configB = { ...config, handle: 'agent-b' };
    await pollTool.handler({ threads: [thread] }, configB);

    // Read the thread log file
    const threadPath = join(testRoot, 'spaces', space, 'threads', `${thread}.log`);
    const content = await readFile(threadPath, 'utf8');
    const lines = content.trim().split('\n');

    // Parse all events
    const events = lines.map(line => JSON.parse(line));

    // CRITICAL: Should have ONLY message events, NO read events
    const readEvents = events.filter(e => e.type === 'read');
    expect(readEvents).toHaveLength(0);

    // Verify we only have message events
    const messageEvents = events.filter(e => e.type === 'msg');
    expect(messageEvents).toHaveLength(1);
    expect(events).toHaveLength(1); // Only the message, no read events
  });

  it('should include up_to_seq in message events (FR-007)', async () => {
    // Agent A sends first message (hasn't read anything yet)
    const msg1 = await appendMessage(testRoot, space, thread, 'agent-a', 'Message 1');

    // Read the thread log
    const threadPath = join(testRoot, 'spaces', space, 'threads', `${thread}.log`);
    const content = await readFile(threadPath, 'utf8');
    const lines = content.trim().split('\n');
    const event1 = JSON.parse(lines[0]);

    // CRITICAL: Message must include up_to_seq field
    expect(event1).toHaveProperty('up_to_seq');
    expect(event1.up_to_seq).toBe(0); // Agent A hasn't read anything yet

    // Agent B reads message 1, then sends message 2
    const messaging = await import('../../src/tools/messaging.js');
    const registry = new Map();
    messaging.registerMessagingTools(registry);
    const pollTool = registry.get('swarmbbs.poll_messages');
    if (!pollTool) {
      throw new Error('poll_messages tool not found');
    }

    const configB = {
      rootDir: testRoot,
      handle: 'agent-b',
      defaultSpace: space,
      presenceTTL: 60,
    };

    // Agent B polls (reads message 1)
    await pollTool.handler({ threads: [thread] }, configB);

    // Agent B sends message 2
    const msg2 = await appendMessage(testRoot, space, thread, 'agent-b', 'Message 2');

    // Read the updated thread log
    const content2 = await readFile(threadPath, 'utf8');
    const lines2 = content2.trim().split('\n');
    const event2 = JSON.parse(lines2[1]);

    // Agent B's message should show up_to_seq=1 (read message 1)
    expect(event2).toHaveProperty('up_to_seq');
    expect(event2.up_to_seq).toBe(1); // Agent B had read up to seq 1
    expect(event2.from).toBe('agent-b');
    expect(event2.seq).toBe(2);
  });

  it('should show conversation flow via up_to_seq fields', async () => {
    const messaging = await import('../../src/tools/messaging.js');
    const registry = new Map();
    messaging.registerMessagingTools(registry);
    const pollTool = registry.get('swarmbbs.poll_messages');
    if (!pollTool) {
      throw new Error('poll_messages tool not found');
    }

    const configA = {
      rootDir: testRoot,
      handle: 'agent-a',
      defaultSpace: space,
      presenceTTL: 60,
    };

    const configB = {
      rootDir: testRoot,
      handle: 'agent-b',
      defaultSpace: space,
      presenceTTL: 60,
    };

    // Agent A posts (hasn't read anything)
    await appendMessage(testRoot, space, thread, 'agent-a', 'A: Hello');

    // Agent B polls and reads A's message
    await pollTool.handler({ threads: [thread] }, configB);

    // Agent B posts (has read seq 1)
    await appendMessage(testRoot, space, thread, 'agent-b', 'B: Hi there');

    // Agent A polls and reads B's message
    await pollTool.handler({ threads: [thread] }, configA);

    // Agent A posts again (has read seq 2)
    await appendMessage(testRoot, space, thread, 'agent-a', 'A: How are you?');

    // Read and verify thread log
    const threadPath = join(testRoot, 'spaces', space, 'threads', `${thread}.log`);
    const content = await readFile(threadPath, 'utf8');
    const lines = content.trim().split('\n');
    const events = lines.map(line => JSON.parse(line));

    // Should have exactly 3 messages, no read events
    expect(events).toHaveLength(3);
    expect(events.every(e => e.type === 'msg')).toBe(true);

    // Check up_to_seq progression
    expect(events[0].from).toBe('agent-a');
    expect(events[0].up_to_seq).toBe(0); // A hadn't read anything

    expect(events[1].from).toBe('agent-b');
    expect(events[1].up_to_seq).toBe(1); // B read message 1

    expect(events[2].from).toBe('agent-a');
    expect(events[2].up_to_seq).toBe(2); // A read message 2
  });
});
