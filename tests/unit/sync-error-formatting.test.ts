/**
 * Unit Tests for Sync Error Formatting
 *
 * Tests the syncConflict error factory function to ensure
 * it creates properly formatted error responses (T007)
 */

import { describe, it, expect } from 'vitest';
import { syncConflict } from '../../src/utils/errors.js';
import type { MessageEvent } from '../../src/types/events.js';

describe('Sync Error Formatting - Unit Tests', () => {
  describe('syncConflict error factory', () => {
    it('should create error with code 409', () => {
      const missingMessages: MessageEvent[] = [
        {
          type: 'msg',
          seq: 2,
          from: 'agent-b',
          ts: '2025-11-14T10:00:00.000Z',
          text: 'Test message',
          up_to_seq: 1,
        },
      ];

      const error = syncConflict('test-thread', missingMessages, {
        last_seq: 2,
        epoch: 0,
      });

      expect(error.code).toBe(409);
      expect(error.name).toBe('SwarmBBSError');
    });

    it('should include standard error message', () => {
      const missingMessages: MessageEvent[] = [
        {
          type: 'msg',
          seq: 2,
          from: 'agent-b',
          ts: '2025-11-14T10:00:00.000Z',
          text: 'Test message',
          up_to_seq: 1,
        },
      ];

      const error = syncConflict('test-thread', missingMessages, {
        last_seq: 2,
        epoch: 0,
      });

      expect(error.message).toBe(
        'Cannot send: you have unread messages in this thread. Your cursor has been advanced. Please review the messages below and retry if still relevant.'
      );
    });

    it('should include thread name in context', () => {
      const missingMessages: MessageEvent[] = [
        {
          type: 'msg',
          seq: 2,
          from: 'agent-b',
          ts: '2025-11-14T10:00:00.000Z',
          text: 'Test message',
          up_to_seq: 1,
        },
      ];

      const error = syncConflict('coordination', missingMessages, {
        last_seq: 2,
        epoch: 0,
      });

      expect(error.context).toHaveProperty('thread', 'coordination');
    });

    it('should include missing_messages array in context', () => {
      const missingMessages: MessageEvent[] = [
        {
          type: 'msg',
          seq: 2,
          from: 'agent-b',
          ts: '2025-11-14T10:00:00.000Z',
          text: 'Test message',
          up_to_seq: 1,
        },
        {
          type: 'msg',
          seq: 3,
          from: 'agent-c',
          ts: '2025-11-14T10:00:05.000Z',
          text: 'Another message',
          up_to_seq: 2,
        },
      ];

      const error = syncConflict('test-thread', missingMessages, {
        last_seq: 3,
        epoch: 0,
      });

      expect(error.context).toHaveProperty('missing_messages');
      expect(error.context!.missing_messages).toEqual(missingMessages);
      expect(error.context!.missing_messages).toHaveLength(2);
    });

    it('should include cursor_advanced in context', () => {
      const missingMessages: MessageEvent[] = [
        {
          type: 'msg',
          seq: 2,
          from: 'agent-b',
          ts: '2025-11-14T10:00:00.000Z',
          text: 'Test message',
          up_to_seq: 1,
        },
      ];

      const cursorAdvanced = {
        last_seq: 5,
        epoch: 2,
      };

      const error = syncConflict('test-thread', missingMessages, cursorAdvanced);

      expect(error.context).toHaveProperty('cursor_advanced');
      expect(error.context!.cursor_advanced).toEqual({
        last_seq: 5,
        epoch: 2,
      });
    });

    it('should include nextSteps guidance', () => {
      const missingMessages: MessageEvent[] = [
        {
          type: 'msg',
          seq: 2,
          from: 'agent-b',
          ts: '2025-11-14T10:00:00.000Z',
          text: 'Test message',
          up_to_seq: 1,
        },
      ];

      const error = syncConflict('test-thread', missingMessages, {
        last_seq: 2,
        epoch: 0,
      });

      expect(error.nextSteps).toBe(
        'Review the missing messages and retry your send operation if still appropriate given the new context.'
      );
    });

    it('should serialize to JSON correctly', () => {
      const missingMessages: MessageEvent[] = [
        {
          type: 'msg',
          seq: 2,
          from: 'agent-b',
          ts: '2025-11-14T10:00:00.000Z',
          text: 'Test message',
          up_to_seq: 1,
        },
      ];

      const error = syncConflict('test-thread', missingMessages, {
        last_seq: 2,
        epoch: 0,
      });

      const json = error.toJSON();

      expect(json).toMatchObject({
        error: 'SwarmBBSError',
        code: 409,
        message: 'Cannot send: you have unread messages in this thread. Your cursor has been advanced. Please review the messages below and retry if still relevant.',
        context: {
          thread: 'test-thread',
          missing_messages: missingMessages,
          cursor_advanced: {
            last_seq: 2,
            epoch: 0,
          },
        },
        nextSteps: 'Review the missing messages and retry your send operation if still appropriate given the new context.',
      });
    });

    it('should handle P2P thread names', () => {
      const missingMessages: MessageEvent[] = [
        {
          type: 'msg',
          seq: 1,
          from: 'agent-b',
          ts: '2025-11-14T09:00:00.000Z',
          text: 'P2P message',
          up_to_seq: 0,
        },
      ];

      const error = syncConflict('p2p/agent-a__agent-b', missingMessages, {
        last_seq: 1,
        epoch: 0,
      });

      expect(error.context).toHaveProperty('thread', 'p2p/agent-a__agent-b');
    });

    it('should handle single missing message', () => {
      const missingMessages: MessageEvent[] = [
        {
          type: 'msg',
          seq: 10,
          from: 'agent-x',
          ts: '2025-11-14T12:00:00.000Z',
          text: 'Only message',
          up_to_seq: 9,
        },
      ];

      const error = syncConflict('thread-123', missingMessages, {
        last_seq: 10,
        epoch: 0,
      });

      const json = error.toJSON();

      expect(json.context.missing_messages).toHaveLength(1);
      expect(json.context.missing_messages[0]).toMatchObject({
        type: 'msg',
        seq: 10,
        from: 'agent-x',
        text: 'Only message',
        up_to_seq: 9,
      });
    });

    it('should handle many missing messages', () => {
      const missingMessages: MessageEvent[] = [];
      for (let i = 1; i <= 50; i++) {
        missingMessages.push({
          type: 'msg',
          seq: i,
          from: 'agent-sender',
          ts: `2025-11-14T10:00:${String(i).padStart(2, '0')}.000Z`,
          text: `Message ${i}`,
          up_to_seq: i - 1,
        });
      }

      const error = syncConflict('busy-thread', missingMessages, {
        last_seq: 50,
        epoch: 0,
      });

      const json = error.toJSON();

      expect(json.context.missing_messages).toHaveLength(50);
      expect(json.context.cursor_advanced.last_seq).toBe(50);
    });

    it('should preserve message order in missing_messages', () => {
      const missingMessages: MessageEvent[] = [
        {
          type: 'msg',
          seq: 5,
          from: 'agent-b',
          ts: '2025-11-14T10:00:05.000Z',
          text: 'Message 5',
          up_to_seq: 4,
        },
        {
          type: 'msg',
          seq: 6,
          from: 'agent-c',
          ts: '2025-11-14T10:00:06.000Z',
          text: 'Message 6',
          up_to_seq: 5,
        },
        {
          type: 'msg',
          seq: 7,
          from: 'agent-b',
          ts: '2025-11-14T10:00:07.000Z',
          text: 'Message 7',
          up_to_seq: 6,
        },
      ];

      const error = syncConflict('test-thread', missingMessages, {
        last_seq: 7,
        epoch: 0,
      });

      const json = error.toJSON();

      // Check messages are in same order
      expect(json.context.missing_messages[0].seq).toBe(5);
      expect(json.context.missing_messages[1].seq).toBe(6);
      expect(json.context.missing_messages[2].seq).toBe(7);
    });

    it('should handle epoch advancement', () => {
      const missingMessages: MessageEvent[] = [
        {
          type: 'msg',
          seq: 100,
          from: 'agent-b',
          ts: '2025-11-14T10:00:00.000Z',
          text: 'Post-compaction message',
          up_to_seq: 99,
        },
      ];

      const error = syncConflict('test-thread', missingMessages, {
        last_seq: 100,
        epoch: 3, // Thread has been compacted
      });

      const json = error.toJSON();

      expect(json.context.cursor_advanced.epoch).toBe(3);
      expect(json.context.cursor_advanced.last_seq).toBe(100);
    });

    it('should preserve all message metadata fields', () => {
      const missingMessages: MessageEvent[] = [
        {
          type: 'msg',
          seq: 42,
          from: 'test-agent',
          ts: '2025-11-14T15:30:45.123Z',
          text: 'Detailed message with metadata',
          up_to_seq: 41,
        },
      ];

      const error = syncConflict('test-thread', missingMessages, {
        last_seq: 42,
        epoch: 0,
      });

      const json = error.toJSON();
      const msg = json.context.missing_messages[0];

      // All fields should be preserved exactly
      expect(msg.type).toBe('msg');
      expect(msg.seq).toBe(42);
      expect(msg.from).toBe('test-agent');
      expect(msg.ts).toBe('2025-11-14T15:30:45.123Z');
      expect(msg.text).toBe('Detailed message with metadata');
      expect(msg.up_to_seq).toBe(41);
    });
  });
});
