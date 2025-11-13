/**
 * Integration Tests for User Story 1: Core Messaging
 *
 * Tests end-to-end messaging workflow between multiple agents
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { registerMessagingTools } from '../../src/tools/messaging.js';
import type { ToolDefinition, ServerConfig } from '../../src/server/mcp-server.js';
import { clearThreadMetadataCache } from '../../src/storage/thread-ops.js';

describe('User Story 1: Core Messaging - Integration Tests', () => {
  let testRoot: string;
  let agentAConfig: ServerConfig;
  let agentBConfig: ServerConfig;
  let tools: Map<string, ToolDefinition>;

  beforeEach(async () => {
    // Create temporary test directory
    testRoot = await mkdtemp(join(tmpdir(), 'swarmbbs-test-'));

    // Create configs for two agents sharing the same root
    agentAConfig = {
      rootDir: testRoot,
      handle: 'agent-a',
      defaultSpace: 'default',
      presenceTTL: 60,
    };

    agentBConfig = {
      rootDir: testRoot,
      handle: 'agent-b',
      defaultSpace: 'default',
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

  describe('Agent-to-Agent Messaging', () => {
    it('should allow agent-a to send and agent-b to receive', async () => {
      const sendTool = tools.get('swarmbbs.send_message')!;
      const pollTool = tools.get('swarmbbs.poll_messages')!;

      // Agent A sends a message
      const sendResult = await sendTool.handler(
        {
          thread: 'coordination',
          text: 'Hello from Agent A',
        },
        agentAConfig
      );

      expect((sendResult as any).success).toBe(true);
      expect((sendResult as any).seq).toBe(1);
      expect((sendResult as any).from).toBe('agent-a');

      // Agent B polls for messages
      const pollResult = await pollTool.handler(
        {
          threads: ['coordination'],
        },
        agentBConfig
      );

      const messages = (pollResult as any).messages['coordination'];
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({
        seq: 1,
        from: 'agent-a',
        text: 'Hello from Agent A',
      });
    });

    it('should support bidirectional communication', async () => {
      const sendTool = tools.get('swarmbbs.send_message')!;
      const pollTool = tools.get('swarmbbs.poll_messages')!;

      // Agent A sends message
      await sendTool.handler(
        { thread: 'chat', text: 'Hi Agent B!' },
        agentAConfig
      );

      // Agent B polls (gets Agent A's message)
      const pollB1 = await pollTool.handler({ threads: ['chat'] }, agentBConfig);
      expect((pollB1 as any).messages['chat']).toHaveLength(1);

      // Agent B responds
      await sendTool.handler(
        { thread: 'chat', text: 'Hi Agent A, how are you?' },
        agentBConfig
      );

      // Agent A polls for response (should only get Agent B's new message, not their own)
      const pollResult = await pollTool.handler({ threads: ['chat'] }, agentAConfig);

      const messages = (pollResult as any).messages['chat'];
      expect(messages.length).toBeGreaterThanOrEqual(1);

      // Find Agent B's message
      const agentBMessage = messages.find((m: any) => m.from === 'agent-b');
      expect(agentBMessage).toBeDefined();
      expect(agentBMessage.text).toBe('Hi Agent A, how are you?');
    });

    it('should maintain independent cursors for each agent', async () => {
      const sendTool = tools.get('swarmbbs.send_message')!;
      const pollTool = tools.get('swarmbbs.poll_messages')!;

      // Send 3 messages as agent A
      await sendTool.handler({ thread: 'test', text: 'Message 1' }, agentAConfig);
      await sendTool.handler({ thread: 'test', text: 'Message 2' }, agentAConfig);
      await sendTool.handler({ thread: 'test', text: 'Message 3' }, agentAConfig);

      // Agent A polls once (gets all 3 messages)
      const pollA1 = await pollTool.handler({ threads: ['test'] }, agentAConfig);
      expect((pollA1 as any).messages['test']).toHaveLength(3);

      // Agent B polls (should also get all 3 messages - independent cursor)
      const pollB1 = await pollTool.handler({ threads: ['test'] }, agentBConfig);
      expect((pollB1 as any).messages['test']).toHaveLength(3);

      // Agent A polls again (should get no new messages)
      const pollA2 = await pollTool.handler({ threads: ['test'] }, agentAConfig);
      expect((pollA2 as any).messages['test']).toHaveLength(0);

      // Agent B can reset and re-read
      const resetTool = tools.get('swarmbbs.reset_cursor')!;
      await resetTool.handler({ thread: 'test', to_seq: 0 }, agentBConfig);

      const pollB2 = await pollTool.handler({ threads: ['test'] }, agentBConfig);
      expect((pollB2 as any).messages['test']).toHaveLength(3);
    });
  });

  describe('Multi-Thread Polling', () => {
    it('should poll multiple threads simultaneously', async () => {
      const sendTool = tools.get('swarmbbs.send_message')!;
      const pollTool = tools.get('swarmbbs.poll_messages')!;

      // Send messages to different threads
      await sendTool.handler({ thread: 'thread-1', text: 'Message in thread 1' }, agentAConfig);
      await sendTool.handler({ thread: 'thread-2', text: 'Message in thread 2' }, agentAConfig);
      await sendTool.handler({ thread: 'thread-3', text: 'Message in thread 3' }, agentAConfig);

      // Poll all three threads at once
      const pollResult = await pollTool.handler(
        { threads: ['thread-1', 'thread-2', 'thread-3'] },
        agentBConfig
      );

      const messages = (pollResult as any).messages;
      expect(messages['thread-1']).toHaveLength(1);
      expect(messages['thread-1'][0].text).toBe('Message in thread 1');
      expect(messages['thread-2']).toHaveLength(1);
      expect(messages['thread-2'][0].text).toBe('Message in thread 2');
      expect(messages['thread-3']).toHaveLength(1);
      expect(messages['thread-3'][0].text).toBe('Message in thread 3');
    });
  });

  describe('Concurrent Writes', () => {
    it('should handle concurrent writes from multiple agents', async () => {
      const sendTool = tools.get('swarmbbs.send_message')!;
      const pollTool = tools.get('swarmbbs.poll_messages')!;

      // Both agents send messages concurrently to the same thread
      const promises = [];
      for (let i = 1; i <= 10; i++) {
        promises.push(
          sendTool.handler(
            { thread: 'concurrent', text: `Agent A - Message ${i}` },
            agentAConfig
          )
        );
        promises.push(
          sendTool.handler(
            { thread: 'concurrent', text: `Agent B - Message ${i}` },
            agentBConfig
          )
        );
      }

      const results = await Promise.all(promises);

      // All seq numbers should be unique
      const seqs = results.map((r: any) => r.seq);
      const uniqueSeqs = new Set(seqs);
      expect(uniqueSeqs.size).toBe(20);

      // Poll to verify all messages are stored
      const pollResult = await pollTool.handler({ threads: ['concurrent'] }, agentAConfig);
      const messages = (pollResult as any).messages['concurrent'];
      expect(messages).toHaveLength(20);

      // Verify messages from both agents are present
      const agentAMessages = messages.filter((m: any) => m.from === 'agent-a');
      const agentBMessages = messages.filter((m: any) => m.from === 'agent-b');
      expect(agentAMessages.length).toBe(10);
      expect(agentBMessages.length).toBe(10);
    });

    it('should maintain sequence monotonicity under load', async () => {
      const sendTool = tools.get('swarmbbs.send_message')!;
      const pollTool = tools.get('swarmbbs.poll_messages')!;

      // Send 50 messages concurrently
      const promises = [];
      for (let i = 1; i <= 50; i++) {
        const agent = i % 2 === 0 ? agentAConfig : agentBConfig;
        promises.push(
          sendTool.handler({ thread: 'stress', text: `Message ${i}` }, agent)
        );
      }

      await Promise.all(promises);

      // Poll all messages
      const pollResult = await pollTool.handler({ threads: ['stress'] }, agentAConfig);
      const messages = (pollResult as any).messages['stress'];

      expect(messages).toHaveLength(50);

      // Verify sequence numbers are monotonically increasing
      for (let i = 0; i < messages.length - 1; i++) {
        expect(messages[i].seq).toBeLessThan(messages[i + 1].seq);
      }

      // Verify all seq numbers from 1 to 50 are present
      const seqs = messages.map((m: any) => m.seq).sort((a: number, b: number) => a - b);
      for (let i = 0; i < 50; i++) {
        expect(seqs[i]).toBe(i + 1);
      }
    });
  });

  describe('Cursor Management', () => {
    it('should only deliver new messages after cursor position', async () => {
      const sendTool = tools.get('swarmbbs.send_message')!;
      const pollTool = tools.get('swarmbbs.poll_messages')!;

      // Send 5 messages
      for (let i = 1; i <= 5; i++) {
        await sendTool.handler({ thread: 'incremental', text: `Message ${i}` }, agentAConfig);
      }

      // Agent B polls (gets all 5)
      const poll1 = await pollTool.handler({ threads: ['incremental'] }, agentBConfig);
      expect((poll1 as any).messages['incremental']).toHaveLength(5);

      // Send 3 more messages
      for (let i = 6; i <= 8; i++) {
        await sendTool.handler({ thread: 'incremental', text: `Message ${i}` }, agentAConfig);
      }

      // Agent B polls again (should only get the 3 new messages)
      const poll2 = await pollTool.handler({ threads: ['incremental'] }, agentBConfig);
      const messages = (poll2 as any).messages['incremental'];
      expect(messages).toHaveLength(3);

      // Verify the messages are 6, 7, 8
      const texts = messages.map((m: any) => m.text);
      expect(texts).toContain('Message 6');
      expect(texts).toContain('Message 7');
      expect(texts).toContain('Message 8');
    });

    it('should handle reset_cursor correctly', async () => {
      const sendTool = tools.get('swarmbbs.send_message')!;
      const pollTool = tools.get('swarmbbs.poll_messages')!;
      const resetTool = tools.get('swarmbbs.reset_cursor')!;

      // Send messages and poll
      await sendTool.handler({ thread: 'replay', text: 'Message 1' }, agentAConfig);
      await sendTool.handler({ thread: 'replay', text: 'Message 2' }, agentAConfig);
      await sendTool.handler({ thread: 'replay', text: 'Message 3' }, agentAConfig);

      await pollTool.handler({ threads: ['replay'] }, agentBConfig);

      // Reset cursor to seq 1
      await resetTool.handler({ thread: 'replay', to_seq: 1 }, agentBConfig);

      // Poll should return messages 2 and 3
      const pollResult = await pollTool.handler({ threads: ['replay'] }, agentBConfig);
      const messages = (pollResult as any).messages['replay'];
      expect(messages).toHaveLength(2);
      expect(messages[0].text).toBe('Message 2');
      expect(messages[1].text).toBe('Message 3');
    });
  });

  describe('Empty Thread Handling', () => {
    it('should handle polling non-existent thread gracefully', async () => {
      const pollTool = tools.get('swarmbbs.poll_messages')!;

      const pollResult = await pollTool.handler(
        { threads: ['does-not-exist'] },
        agentAConfig
      );

      expect((pollResult as any).success).toBe(true);
      expect((pollResult as any).messages['does-not-exist']).toHaveLength(0);
    });

    it('should handle mixed existent and non-existent threads', async () => {
      const sendTool = tools.get('swarmbbs.send_message')!;
      const pollTool = tools.get('swarmbbs.poll_messages')!;

      // Send to only one thread
      await sendTool.handler({ thread: 'exists', text: 'Hello' }, agentAConfig);

      // Poll both existent and non-existent
      const pollResult = await pollTool.handler(
        { threads: ['exists', 'does-not-exist'] },
        agentBConfig
      );

      const messages = (pollResult as any).messages;
      expect(messages['exists']).toHaveLength(1);
      expect(messages['does-not-exist']).toHaveLength(0);
    });
  });
});
