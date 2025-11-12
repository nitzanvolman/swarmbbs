/**
 * Contract Tests for Compaction Tools
 *
 * Tests the three compaction tools: compact_begin, compact_commit, compact_abort
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { compactBegin, compactCommit, compactAbort } from '../../src/tools/compaction.js';
import { appendMessage, clearThreadMetadataCache } from '../../src/storage/thread-ops.js';
import { SwarmBBSError } from '../../src/utils/errors.js';

const TEST_DIR = join(process.cwd(), 'test-data', 'compaction-contract-test');
const DEFAULT_SPACE = 'test-space';

describe('Compaction Contract Tests', () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
    clearThreadMetadataCache();
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
    clearThreadMetadataCache();
  });

  describe('compact_begin', () => {
    it('should start compaction on existing thread', async () => {
      // Create thread with messages
      await appendMessage(TEST_DIR, DEFAULT_SPACE, 'thread1', 'agent-a', 'Message 1');
      await appendMessage(TEST_DIR, DEFAULT_SPACE, 'thread1', 'agent-b', 'Message 2');
      await appendMessage(TEST_DIR, DEFAULT_SPACE, 'thread1', 'agent-c', 'Message 3');

      const result = await compactBegin(TEST_DIR, DEFAULT_SPACE, {
        thread: 'thread1',
      });

      expect(result.success).toBe(true);
      expect(result.space).toBe(DEFAULT_SPACE);
      expect(result.thread).toBe('thread1');
      expect(result.compaction_id).toMatch(/^comp-/);
      expect(result.base_seq).toBe(3);
      expect(result.epoch).toBe(0);
      expect(result.note).toContain('Compaction started');
      expect(result.note).toContain('1-3');
    });

    it('should reject invalid thread name', async () => {
      await expect(
        compactBegin(TEST_DIR, DEFAULT_SPACE, {
          thread: '.invalid',
        })
      ).rejects.toThrow();
    });

    it('should reject if thread does not exist', async () => {
      await expect(
        compactBegin(TEST_DIR, DEFAULT_SPACE, {
          thread: 'nonexistent',
        })
      ).rejects.toThrow(SwarmBBSError);

      try {
        await compactBegin(TEST_DIR, DEFAULT_SPACE, {
          thread: 'nonexistent',
        });
      } catch (err) {
        expect(err).toBeInstanceOf(SwarmBBSError);
        const error = err as SwarmBBSError;
        expect(error.code).toBe(404);
        expect(error.message).toContain('Thread');
        expect(error.message).toContain('nonexistent');
      }
    });

    it('should reject if compaction already in progress', async () => {
      // Create thread
      await appendMessage(TEST_DIR, DEFAULT_SPACE, 'thread1', 'agent-a', 'Message 1');

      // Start first compaction
      const result1 = await compactBegin(TEST_DIR, DEFAULT_SPACE, {
        thread: 'thread1',
      });

      expect(result1.success).toBe(true);

      // Try to start second compaction
      await expect(
        compactBegin(TEST_DIR, DEFAULT_SPACE, {
          thread: 'thread1',
        })
      ).rejects.toThrow(SwarmBBSError);

      try {
        await compactBegin(TEST_DIR, DEFAULT_SPACE, {
          thread: 'thread1',
        });
      } catch (err) {
        expect(err).toBeInstanceOf(SwarmBBSError);
        const error = err as SwarmBBSError;
        expect(error.code).toBe(409);
        expect(error.message).toContain('already in progress');
        expect(error.context?.existing_compaction_id).toBe(result1.compaction_id);
      }
    });
  });

  describe('compact_commit', () => {
    it('should commit compaction with text summary', async () => {
      // Create thread with messages
      await appendMessage(TEST_DIR, DEFAULT_SPACE, 'thread1', 'agent-a', 'Message 1');
      await appendMessage(TEST_DIR, DEFAULT_SPACE, 'thread1', 'agent-b', 'Message 2');
      await appendMessage(TEST_DIR, DEFAULT_SPACE, 'thread1', 'agent-c', 'Message 3');

      // Start compaction
      const beginResult = await compactBegin(TEST_DIR, DEFAULT_SPACE, {
        thread: 'thread1',
      });

      // Commit with snapshot
      const commitResult = await compactCommit(TEST_DIR, DEFAULT_SPACE, {
        thread: 'thread1',
        compaction_id: beginResult.compaction_id,
        snapshot: {
          covers_from_seq: 1,
          covers_to_seq: 3,
          summary: 'Thread contained 3 coordination messages.',
          meta: {
            compacted_by: 'test-agent',
            compacted_at: new Date().toISOString(),
          },
        },
      });

      expect(commitResult.success).toBe(true);
      expect(commitResult.space).toBe(DEFAULT_SPACE);
      expect(commitResult.thread).toBe('thread1');
      expect(commitResult.new_epoch).toBe(1);
      expect(commitResult.min_available_seq).toBe(4);
      expect(commitResult.message_count).toBeGreaterThan(0);
      expect(commitResult.delta_replayed).toBe(0);
    });

    it('should commit compaction with structured summary', async () => {
      // Create thread
      await appendMessage(TEST_DIR, DEFAULT_SPACE, 'thread1', 'agent-a', 'Message 1');

      // Start compaction
      const beginResult = await compactBegin(TEST_DIR, DEFAULT_SPACE, {
        thread: 'thread1',
      });

      // Commit with structured summary
      const commitResult = await compactCommit(TEST_DIR, DEFAULT_SPACE, {
        thread: 'thread1',
        compaction_id: beginResult.compaction_id,
        snapshot: {
          covers_from_seq: 1,
          covers_to_seq: 1,
          summary: {
            period: '2025-11-01 to 2025-11-10',
            message_count: 1,
            participants: ['agent-a'],
            topics: ['testing'],
          },
        },
      });

      expect(commitResult.success).toBe(true);
      expect(commitResult.new_epoch).toBe(1);
    });

    it('should commit with kept messages', async () => {
      // Create thread with messages
      await appendMessage(TEST_DIR, DEFAULT_SPACE, 'thread1', 'agent-a', 'Message 1');
      const msg2 = await appendMessage(TEST_DIR, DEFAULT_SPACE, 'thread1', 'agent-b', 'IMPORTANT: Message 2');
      await appendMessage(TEST_DIR, DEFAULT_SPACE, 'thread1', 'agent-c', 'Message 3');

      // Start compaction
      const beginResult = await compactBegin(TEST_DIR, DEFAULT_SPACE, {
        thread: 'thread1',
      });

      // Commit with kept message
      const commitResult = await compactCommit(TEST_DIR, DEFAULT_SPACE, {
        thread: 'thread1',
        compaction_id: beginResult.compaction_id,
        snapshot: {
          covers_from_seq: 1,
          covers_to_seq: 3,
          summary: 'Summary of 3 messages',
        },
        keep_messages: [
          {
            seq: msg2.seq,
            ts: msg2.ts,
            from: msg2.from,
            text: msg2.text,
          },
        ],
      });

      expect(commitResult.success).toBe(true);
      expect(commitResult.message_count).toBeGreaterThanOrEqual(2); // snapshot + kept message
    });

    it('should replay delta messages on commit', async () => {
      // Create thread
      await appendMessage(TEST_DIR, DEFAULT_SPACE, 'thread1', 'agent-a', 'Message 1');

      // Start compaction
      const beginResult = await compactBegin(TEST_DIR, DEFAULT_SPACE, {
        thread: 'thread1',
      });

      // Send messages during compaction (should go to delta)
      await appendMessage(TEST_DIR, DEFAULT_SPACE, 'thread1', 'agent-b', 'Delta message 1');
      await appendMessage(TEST_DIR, DEFAULT_SPACE, 'thread1', 'agent-c', 'Delta message 2');

      // Commit
      const commitResult = await compactCommit(TEST_DIR, DEFAULT_SPACE, {
        thread: 'thread1',
        compaction_id: beginResult.compaction_id,
        snapshot: {
          covers_from_seq: 1,
          covers_to_seq: 1,
          summary: 'Summary',
        },
      });

      expect(commitResult.success).toBe(true);
      expect(commitResult.delta_replayed).toBe(2);
      expect(commitResult.message_count).toBeGreaterThanOrEqual(3); // snapshot + 2 delta
    });

    it('should reject invalid compaction_id', async () => {
      await expect(
        compactCommit(TEST_DIR, DEFAULT_SPACE, {
          thread: 'thread1',
          compaction_id: 'invalid-id',
          snapshot: {
            covers_from_seq: 1,
            covers_to_seq: 1,
            summary: 'Summary',
          },
        })
      ).rejects.toThrow(SwarmBBSError);

      try {
        await compactCommit(TEST_DIR, DEFAULT_SPACE, {
          thread: 'thread1',
          compaction_id: 'invalid-id',
          snapshot: {
            covers_from_seq: 1,
            covers_to_seq: 1,
            summary: 'Summary',
          },
        });
      } catch (err) {
        expect(err).toBeInstanceOf(SwarmBBSError);
        const error = err as SwarmBBSError;
        expect(error.code).toBe(404);
        expect(error.message).toContain('Compaction session');
      }
    });

    it('should reject kept message outside compacted range', async () => {
      // Create thread
      await appendMessage(TEST_DIR, DEFAULT_SPACE, 'thread1', 'agent-a', 'Message 1');
      await appendMessage(TEST_DIR, DEFAULT_SPACE, 'thread1', 'agent-b', 'Message 2');

      // Start compaction
      const beginResult = await compactBegin(TEST_DIR, DEFAULT_SPACE, {
        thread: 'thread1',
      });

      // Try to commit with kept message outside range
      await expect(
        compactCommit(TEST_DIR, DEFAULT_SPACE, {
          thread: 'thread1',
          compaction_id: beginResult.compaction_id,
          snapshot: {
            covers_from_seq: 1,
            covers_to_seq: 2,
          summary: 'Summary',
          },
          keep_messages: [
            {
              seq: 99, // Outside range
              ts: new Date().toISOString(),
              from: 'agent-x',
              text: 'Invalid',
            },
          ],
        })
      ).rejects.toThrow(SwarmBBSError);

      try {
        await compactCommit(TEST_DIR, DEFAULT_SPACE, {
          thread: 'thread1',
          compaction_id: beginResult.compaction_id,
          snapshot: {
            covers_from_seq: 1,
            covers_to_seq: 2,
            summary: 'Summary',
          },
          keep_messages: [
            {
              seq: 99,
              ts: new Date().toISOString(),
              from: 'agent-x',
              text: 'Invalid',
            },
          ],
        });
      } catch (err) {
        expect(err).toBeInstanceOf(SwarmBBSError);
        const error = err as SwarmBBSError;
        expect(error.code).toBe(400);
        expect(error.message).toContain('outside the compacted range');
      }
    });
  });

  describe('compact_abort', () => {
    it('should abort compaction with no delta messages', async () => {
      // Create thread
      await appendMessage(TEST_DIR, DEFAULT_SPACE, 'thread1', 'agent-a', 'Message 1');

      // Start compaction
      const beginResult = await compactBegin(TEST_DIR, DEFAULT_SPACE, {
        thread: 'thread1',
      });

      // Abort immediately (no delta messages)
      const abortResult = await compactAbort(TEST_DIR, DEFAULT_SPACE, {
        thread: 'thread1',
        compaction_id: beginResult.compaction_id,
      });

      expect(abortResult.success).toBe(true);
      expect(abortResult.space).toBe(DEFAULT_SPACE);
      expect(abortResult.thread).toBe('thread1');
      expect(abortResult.delta_messages_merged).toBe(0);
      expect(abortResult.note).toContain('No delta messages');
    });

    it('should abort compaction and merge delta messages', async () => {
      // Create thread
      await appendMessage(TEST_DIR, DEFAULT_SPACE, 'thread1', 'agent-a', 'Message 1');

      // Start compaction
      const beginResult = await compactBegin(TEST_DIR, DEFAULT_SPACE, {
        thread: 'thread1',
      });

      // Send messages during compaction
      await appendMessage(TEST_DIR, DEFAULT_SPACE, 'thread1', 'agent-b', 'Delta 1');
      await appendMessage(TEST_DIR, DEFAULT_SPACE, 'thread1', 'agent-c', 'Delta 2');
      await appendMessage(TEST_DIR, DEFAULT_SPACE, 'thread1', 'agent-d', 'Delta 3');

      // Abort
      const abortResult = await compactAbort(TEST_DIR, DEFAULT_SPACE, {
        thread: 'thread1',
        compaction_id: beginResult.compaction_id,
      });

      expect(abortResult.success).toBe(true);
      expect(abortResult.delta_messages_merged).toBe(3);
      expect(abortResult.note).toContain('3 delta messages merged');
    });

    it('should reject invalid compaction_id', async () => {
      await expect(
        compactAbort(TEST_DIR, DEFAULT_SPACE, {
          thread: 'thread1',
          compaction_id: 'invalid-id',
        })
      ).rejects.toThrow(SwarmBBSError);

      try {
        await compactAbort(TEST_DIR, DEFAULT_SPACE, {
          thread: 'thread1',
          compaction_id: 'invalid-id',
        });
      } catch (err) {
        expect(err).toBeInstanceOf(SwarmBBSError);
        const error = err as SwarmBBSError;
        expect(error.code).toBe(404);
        expect(error.message).toContain('Compaction session');
      }
    });

    it('should be idempotent (aborting already aborted compaction)', async () => {
      // Create thread
      await appendMessage(TEST_DIR, DEFAULT_SPACE, 'thread1', 'agent-a', 'Message 1');

      // Start compaction
      const beginResult = await compactBegin(TEST_DIR, DEFAULT_SPACE, {
        thread: 'thread1',
      });

      // Abort once
      const abortResult1 = await compactAbort(TEST_DIR, DEFAULT_SPACE, {
        thread: 'thread1',
        compaction_id: beginResult.compaction_id,
      });

      expect(abortResult1.success).toBe(true);

      // Try to abort again - should fail with 404
      await expect(
        compactAbort(TEST_DIR, DEFAULT_SPACE, {
          thread: 'thread1',
          compaction_id: beginResult.compaction_id,
        })
      ).rejects.toThrow(SwarmBBSError);
    });
  });

  describe('Compaction Workflow Integration', () => {
    it('should handle complete compaction workflow', async () => {
      // Create thread with many messages
      for (let i = 1; i <= 10; i++) {
        await appendMessage(TEST_DIR, DEFAULT_SPACE, 'thread1', `agent-${i % 3}`, `Message ${i}`);
      }

      // Begin compaction
      const beginResult = await compactBegin(TEST_DIR, DEFAULT_SPACE, {
        thread: 'thread1',
      });

      expect(beginResult.base_seq).toBe(10);
      expect(beginResult.epoch).toBe(0);

      // Send new messages during compaction
      await appendMessage(TEST_DIR, DEFAULT_SPACE, 'thread1', 'agent-new', 'New message 1');
      await appendMessage(TEST_DIR, DEFAULT_SPACE, 'thread1', 'agent-new', 'New message 2');

      // Commit with snapshot and kept messages
      const commitResult = await compactCommit(TEST_DIR, DEFAULT_SPACE, {
        thread: 'thread1',
        compaction_id: beginResult.compaction_id,
        snapshot: {
          covers_from_seq: 1,
          covers_to_seq: 10,
          summary: 'Compacted 10 messages from 3 agents',
          meta: {
            compacted_by: 'test-workflow',
          },
        },
        keep_messages: [
          {
            seq: 5,
            ts: new Date().toISOString(),
            from: 'agent-2',
            text: 'Message 5',
          },
        ],
      });

      expect(commitResult.success).toBe(true);
      expect(commitResult.new_epoch).toBe(1);
      expect(commitResult.min_available_seq).toBe(11);
      expect(commitResult.delta_replayed).toBe(2);

      // Verify can start new compaction after commit
      await appendMessage(TEST_DIR, DEFAULT_SPACE, 'thread1', 'agent-a', 'After compaction');

      const beginResult2 = await compactBegin(TEST_DIR, DEFAULT_SPACE, {
        thread: 'thread1',
      });

      expect(beginResult2.success).toBe(true);
      expect(beginResult2.epoch).toBe(1); // Incremented
    });
  });
});
