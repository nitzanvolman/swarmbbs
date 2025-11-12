/**
 * Contract Tests for Messaging Tools
 *
 * Tests send_message, poll_messages, and reset_cursor tool contracts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { registerMessagingTools } from '../../src/tools/messaging.js';
import type { ToolDefinition, ServerConfig } from '../../src/server/mcp-server.js';
import { clearThreadMetadataCache } from '../../src/storage/thread-ops.js';

describe('Messaging Tools - Contract Tests', () => {
  let testRoot: string;
  let config: ServerConfig;
  let tools: Map<string, ToolDefinition>;

  beforeEach(async () => {
    // Create temporary test directory
    testRoot = await mkdtemp(join(tmpdir(), 'swarmbbs-test-'));

    config = {
      rootDir: testRoot,
      handle: 'test-agent',
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

  describe('send_message', () => {
    it('should send a valid message successfully', async () => {
      const tool = tools.get('swarmbbs.send_message')!;
      expect(tool).toBeDefined();

      const result = await tool.handler(
        {
          thread: 'test-thread',
          text: 'Hello, world!',
        },
        config
      );

      expect(result).toMatchObject({
        success: true,
        space: 'test-space',
        thread: 'test-thread',
        seq: 1,
        from: 'test-agent',
        text: 'Hello, world!',
      });
      expect((result as any).ts).toBeDefined();
    });

    it('should sanitize newlines in message text', async () => {
      const tool = tools.get('swarmbbs.send_message')!;

      const result = await tool.handler(
        {
          thread: 'test-thread',
          text: 'Line 1\nLine 2\r\nLine 3',
        },
        config
      );

      expect((result as any).text).toBe('Line 1 Line 2 Line 3');
    });

    it('should reject message exceeding 8 KiB', async () => {
      const tool = tools.get('swarmbbs.send_message')!;

      // Create message larger than 8192 bytes
      const largeText = 'x'.repeat(9000);

      await expect(
        tool.handler(
          {
            thread: 'test-thread',
            text: largeText,
          },
          config
        )
      ).rejects.toThrow();
    });

    it('should reject invalid thread name with path traversal', async () => {
      const tool = tools.get('swarmbbs.send_message')!;

      await expect(
        tool.handler(
          {
            thread: '../etc/passwd',
            text: 'Hello',
          },
          config
        )
      ).rejects.toThrow();
    });

    it('should reject invalid thread name with special characters', async () => {
      const tool = tools.get('swarmbbs.send_message')!;

      await expect(
        tool.handler(
          {
            thread: 'test@thread',
            text: 'Hello',
          },
          config
        )
      ).rejects.toThrow();
    });

    it('should increment sequence numbers for multiple messages', async () => {
      const tool = tools.get('swarmbbs.send_message')!;

      const result1 = await tool.handler(
        { thread: 'test-thread', text: 'Message 1' },
        config
      );
      const result2 = await tool.handler(
        { thread: 'test-thread', text: 'Message 2' },
        config
      );
      const result3 = await tool.handler(
        { thread: 'test-thread', text: 'Message 3' },
        config
      );

      expect((result1 as any).seq).toBe(1);
      expect((result2 as any).seq).toBe(2);
      expect((result3 as any).seq).toBe(3);
    });
  });

  describe('poll_messages', () => {
    it('should poll messages from a single thread', async () => {
      const sendTool = tools.get('swarmbbs.send_message')!;
      const pollTool = tools.get('swarmbbs.poll_messages')!;

      // Send a message
      await sendTool.handler({ thread: 'test-thread', text: 'Message 1' }, config);

      // Poll for messages
      const result = await pollTool.handler({ threads: ['test-thread'] }, config);

      expect(result).toMatchObject({
        success: true,
        space: 'test-space',
        timed_out: false,
      });

      const messages = (result as any).messages;
      expect(messages['test-thread']).toHaveLength(1);
      expect(messages['test-thread'][0]).toMatchObject({
        seq: 1,
        from: 'test-agent',
        text: 'Message 1',
      });
    });

    it('should poll messages from multiple threads', async () => {
      const sendTool = tools.get('swarmbbs.send_message')!;
      const pollTool = tools.get('swarmbbs.poll_messages')!;

      // Send messages to different threads
      await sendTool.handler({ thread: 'thread-1', text: 'Message A' }, config);
      await sendTool.handler({ thread: 'thread-2', text: 'Message B' }, config);

      // Poll both threads
      const result = await pollTool.handler({ threads: ['thread-1', 'thread-2'] }, config);

      const messages = (result as any).messages;
      expect(messages['thread-1']).toHaveLength(1);
      expect(messages['thread-1'][0].text).toBe('Message A');
      expect(messages['thread-2']).toHaveLength(1);
      expect(messages['thread-2'][0].text).toBe('Message B');
    });

    it('should advance cursor after polling', async () => {
      const sendTool = tools.get('swarmbbs.send_message')!;
      const pollTool = tools.get('swarmbbs.poll_messages')!;

      // Send messages
      await sendTool.handler({ thread: 'test-thread', text: 'Message 1' }, config);
      await sendTool.handler({ thread: 'test-thread', text: 'Message 2' }, config);

      // First poll
      const result1 = await pollTool.handler({ threads: ['test-thread'] }, config);
      const messages1 = (result1 as any).messages['test-thread'];
      expect(messages1).toHaveLength(2);

      // Second poll (should return no new messages)
      const result2 = await pollTool.handler({ threads: ['test-thread'] }, config);
      const messages2 = (result2 as any).messages['test-thread'];
      expect(messages2).toHaveLength(0);
    });

    it('should respect max_per_thread limit', async () => {
      const sendTool = tools.get('swarmbbs.send_message')!;
      const pollTool = tools.get('swarmbbs.poll_messages')!;

      // Send 10 messages
      for (let i = 1; i <= 10; i++) {
        await sendTool.handler({ thread: 'test-thread', text: `Message ${i}` }, config);
      }

      // Poll with limit of 5
      const result = await pollTool.handler(
        { threads: ['test-thread'], max_per_thread: 5 },
        config
      );

      const messages = (result as any).messages['test-thread'];
      expect(messages.length).toBeLessThanOrEqual(5);
    });

    it('should return empty messages array for non-existent thread', async () => {
      const pollTool = tools.get('swarmbbs.poll_messages')!;

      const result = await pollTool.handler({ threads: ['nonexistent'] }, config);

      const messages = (result as any).messages;
      expect(messages['nonexistent']).toHaveLength(0);
    });

    it('should reject invalid thread name in poll list', async () => {
      const pollTool = tools.get('swarmbbs.poll_messages')!;

      await expect(
        pollTool.handler({ threads: ['valid-thread', '../etc/passwd'] }, config)
      ).rejects.toThrow();
    });

    it('should include cursor advancement information', async () => {
      const sendTool = tools.get('swarmbbs.send_message')!;
      const pollTool = tools.get('swarmbbs.poll_messages')!;

      await sendTool.handler({ thread: 'test-thread', text: 'Message 1' }, config);
      await sendTool.handler({ thread: 'test-thread', text: 'Message 2' }, config);

      const result = await pollTool.handler({ threads: ['test-thread'] }, config);

      const cursors = (result as any).cursors;
      expect(cursors['test-thread']).toMatchObject({
        last_seq: 2,
        epoch: 0,
        advanced_from: 0,
        advanced_to: 2,
      });
    });
  });

  describe('reset_cursor', () => {
    it('should reset cursor to beginning', async () => {
      const sendTool = tools.get('swarmbbs.send_message')!;
      const pollTool = tools.get('swarmbbs.poll_messages')!;
      const resetTool = tools.get('swarmbbs.reset_cursor')!;

      // Send messages and poll
      await sendTool.handler({ thread: 'test-thread', text: 'Message 1' }, config);
      await sendTool.handler({ thread: 'test-thread', text: 'Message 2' }, config);
      await pollTool.handler({ threads: ['test-thread'] }, config);

      // Reset cursor to beginning
      const result = await resetTool.handler({ thread: 'test-thread', to_seq: 0 }, config);

      expect(result).toMatchObject({
        success: true,
        space: 'test-space',
        thread: 'test-thread',
        old_cursor: { last_seq: 2, epoch: 0 },
        new_cursor: { last_seq: 0, epoch: 0 },
      });

      // Poll again should return all messages
      const pollResult = await pollTool.handler({ threads: ['test-thread'] }, config);
      const messages = (pollResult as any).messages['test-thread'];
      expect(messages).toHaveLength(2);
    });

    it('should reset cursor to specific sequence', async () => {
      const sendTool = tools.get('swarmbbs.send_message')!;
      const pollTool = tools.get('swarmbbs.poll_messages')!;
      const resetTool = tools.get('swarmbbs.reset_cursor')!;

      // Send messages and poll
      await sendTool.handler({ thread: 'test-thread', text: 'Message 1' }, config);
      await sendTool.handler({ thread: 'test-thread', text: 'Message 2' }, config);
      await sendTool.handler({ thread: 'test-thread', text: 'Message 3' }, config);
      await pollTool.handler({ threads: ['test-thread'] }, config);

      // Reset cursor to seq 1
      const result = await resetTool.handler({ thread: 'test-thread', to_seq: 1 }, config);

      expect((result as any).new_cursor.last_seq).toBe(1);

      // Poll should return messages 2 and 3
      const pollResult = await pollTool.handler({ threads: ['test-thread'] }, config);
      const messages = (pollResult as any).messages['test-thread'];
      expect(messages).toHaveLength(2);
      expect(messages[0].seq).toBe(2);
      expect(messages[1].seq).toBe(3);
    });

    it('should reject invalid thread name', async () => {
      const resetTool = tools.get('swarmbbs.reset_cursor')!;

      await expect(
        resetTool.handler({ thread: '../etc/passwd', to_seq: 0 }, config)
      ).rejects.toThrow();
    });

    it('should handle reset on non-existent thread', async () => {
      const resetTool = tools.get('swarmbbs.reset_cursor')!;

      // Should not throw, just reset to 0
      const result = await resetTool.handler({ thread: 'nonexistent', to_seq: 0 }, config);

      expect(result).toMatchObject({
        success: true,
        thread: 'nonexistent',
        new_cursor: { last_seq: 0, epoch: 0 },
      });
    });
  });

  describe('concurrent writes', () => {
    it('should assign unique sequence numbers under concurrent load', async () => {
      const sendTool = tools.get('swarmbbs.send_message')!;

      // Send 20 messages concurrently
      const promises = [];
      for (let i = 1; i <= 20; i++) {
        promises.push(
          sendTool.handler({ thread: 'concurrent-thread', text: `Message ${i}` }, config)
        );
      }

      const results = await Promise.all(promises);

      // Extract sequence numbers
      const seqs = results.map((r: any) => r.seq);

      // Check all seq numbers are unique
      const uniqueSeqs = new Set(seqs);
      expect(uniqueSeqs.size).toBe(20);

      // Check seq numbers are in range 1-20
      expect(Math.min(...seqs)).toBe(1);
      expect(Math.max(...seqs)).toBe(20);
    });
  });
});
