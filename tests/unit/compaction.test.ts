/**
 * Unit Tests for Compaction Protocol Edge Cases
 *
 * Tests concurrent writes during compaction, epoch tracking, and data integrity
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'fs/promises';
import { join } from 'path';
import {
  beginCompaction,
  commitCompaction,
  abortCompaction,
  getActiveCompaction,
} from '../../src/storage/compaction-impl.js';
import {
  appendMessage,
  clearThreadMetadataCache,
  readThreadAll,
  getThreadEpoch,
  getThreadMetadata,
} from '../../src/storage/thread-ops.js';
import { isMessageEvent, isSnapshotEvent } from '../../src/types/events.js';

const TEST_DIR = join(process.cwd(), 'test-data', 'compaction-unit-test');

describe('Compaction Protocol Unit Tests', () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
    clearThreadMetadataCache();
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
    clearThreadMetadataCache();
  });

  describe('Concurrent Writes During Compaction', () => {
    it('should write new messages to delta file during compaction', async () => {
      // Create base messages
      await appendMessage(TEST_DIR, 'space1', 'thread1', 'agent-a', 'Base 1');
      await appendMessage(TEST_DIR, 'space1', 'thread1', 'agent-b', 'Base 2');
      await appendMessage(TEST_DIR, 'space1', 'thread1', 'agent-c', 'Base 3');

      // Start compaction
      const beginResult = await beginCompaction(TEST_DIR, 'space1', 'thread1');
      expect(beginResult.base_seq).toBe(3);

      // Send messages during compaction
      const delta1 = await appendMessage(TEST_DIR, 'space1', 'thread1', 'agent-d', 'Delta 1');
      const delta2 = await appendMessage(TEST_DIR, 'space1', 'thread1', 'agent-e', 'Delta 2');
      const delta3 = await appendMessage(TEST_DIR, 'space1', 'thread1', 'agent-f', 'Delta 3');

      // Verify seq numbers continue from base
      expect(delta1.seq).toBe(4);
      expect(delta2.seq).toBe(5);
      expect(delta3.seq).toBe(6);

      // Commit compaction
      const commitResult = await commitCompaction(
        TEST_DIR,
        'space1',
        'thread1',
        beginResult.compaction_id,
        {
          covers_from_seq: 1,
          covers_to_seq: 3,
          summary: 'Summary of base messages',
        }
      );

      expect(commitResult.delta_replayed).toBe(3);

      // Verify all delta messages are in final thread
      const allEvents = await readThreadAll(TEST_DIR, 'space1', 'thread1');
      const messages = allEvents.filter(isMessageEvent);

      // Should have delta messages with correct seq
      expect(messages.some(m => m.seq === 4 && m.text === 'Delta 1')).toBe(true);
      expect(messages.some(m => m.seq === 5 && m.text === 'Delta 2')).toBe(true);
      expect(messages.some(m => m.seq === 6 && m.text === 'Delta 3')).toBe(true);
    });

    it('should handle rapid concurrent writes during compaction', async () => {
      // Create base
      await appendMessage(TEST_DIR, 'space1', 'thread1', 'agent-a', 'Base');

      // Start compaction
      const beginResult = await beginCompaction(TEST_DIR, 'space1', 'thread1');

      // Rapidly send many messages
      const deltaPromises = [];
      for (let i = 0; i < 20; i++) {
        deltaPromises.push(
          appendMessage(TEST_DIR, 'space1', 'thread1', `agent-${i}`, `Concurrent message ${i}`)
        );
      }

      const deltaMessages = await Promise.all(deltaPromises);

      // Verify all have unique seq numbers
      const seqs = deltaMessages.map(m => m.seq);
      const uniqueSeqs = new Set(seqs);
      expect(uniqueSeqs.size).toBe(20); // All unique

      // Verify sequential from base_seq + 1
      expect(Math.min(...seqs)).toBe(2);
      expect(Math.max(...seqs)).toBe(21);

      // Commit
      const commitResult = await commitCompaction(
        TEST_DIR,
        'space1',
        'thread1',
        beginResult.compaction_id,
        {
          covers_from_seq: 1,
          covers_to_seq: 1,
          summary: 'Summary',
        }
      );

      expect(commitResult.delta_replayed).toBe(20);
    });
  });

  describe('Epoch Tracking', () => {
    it('should increment epoch on commit', async () => {
      // Create thread
      await appendMessage(TEST_DIR, 'space1', 'thread1', 'agent-a', 'Message');

      // Check initial epoch
      let epoch = await getThreadEpoch(TEST_DIR, 'space1', 'thread1');
      expect(epoch).toBe(0);

      // Compact and commit
      const beginResult = await beginCompaction(TEST_DIR, 'space1', 'thread1');
      await commitCompaction(
        TEST_DIR,
        'space1',
        'thread1',
        beginResult.compaction_id,
        {
          covers_from_seq: 1,
          covers_to_seq: 1,
          summary: 'First compaction',
        }
      );

      // Check epoch incremented
      epoch = await getThreadEpoch(TEST_DIR, 'space1', 'thread1');
      expect(epoch).toBe(1);

      // Second compaction
      await appendMessage(TEST_DIR, 'space1', 'thread1', 'agent-b', 'After first compact');
      const beginResult2 = await beginCompaction(TEST_DIR, 'space1', 'thread1');
      await commitCompaction(
        TEST_DIR,
        'space1',
        'thread1',
        beginResult2.compaction_id,
        {
          covers_from_seq: 1,
          covers_to_seq: 2,
          summary: 'Second compaction',
        }
      );

      // Check epoch incremented again
      epoch = await getThreadEpoch(TEST_DIR, 'space1', 'thread1');
      expect(epoch).toBe(2);
    });

    it('should not increment epoch on abort', async () => {
      // Create thread
      await appendMessage(TEST_DIR, 'space1', 'thread1', 'agent-a', 'Message');

      // Check initial epoch
      let epoch = await getThreadEpoch(TEST_DIR, 'space1', 'thread1');
      expect(epoch).toBe(0);

      // Compact and abort
      const beginResult = await beginCompaction(TEST_DIR, 'space1', 'thread1');
      await abortCompaction(TEST_DIR, 'space1', 'thread1', beginResult.compaction_id);

      // Check epoch unchanged
      epoch = await getThreadEpoch(TEST_DIR, 'space1', 'thread1');
      expect(epoch).toBe(0);
    });

    it('should update min_available_seq on commit', async () => {
      // Create messages
      for (let i = 1; i <= 100; i++) {
        await appendMessage(TEST_DIR, 'space1', 'thread1', 'agent-a', `Message ${i}`);
      }

      // Check initial min_available_seq
      let metadata = await getThreadMetadata(TEST_DIR, 'space1', 'thread1');
      expect(metadata.min_available_seq).toBe(0); // No compaction yet

      // Compact
      const beginResult = await beginCompaction(TEST_DIR, 'space1', 'thread1');
      await commitCompaction(
        TEST_DIR,
        'space1',
        'thread1',
        beginResult.compaction_id,
        {
          covers_from_seq: 1,
          covers_to_seq: 100,
          summary: 'Compacted 100 messages',
        }
      );

      // Check min_available_seq updated
      metadata = await getThreadMetadata(TEST_DIR, 'space1', 'thread1');
      expect(metadata.min_available_seq).toBe(101);
    });
  });

  describe('Snapshot Event Format', () => {
    it('should create snapshot as first event with seq 1', async () => {
      // Create messages
      await appendMessage(TEST_DIR, 'space1', 'thread1', 'agent-a', 'Message 1');
      await appendMessage(TEST_DIR, 'space1', 'thread1', 'agent-b', 'Message 2');

      // Compact
      const beginResult = await beginCompaction(TEST_DIR, 'space1', 'thread1');
      await commitCompaction(
        TEST_DIR,
        'space1',
        'thread1',
        beginResult.compaction_id,
        {
          covers_from_seq: 1,
          covers_to_seq: 2,
          summary: 'Test summary',
          meta: { test: 'metadata' },
        }
      );

      // Read thread
      const events = await readThreadAll(TEST_DIR, 'space1', 'thread1');

      // First event should be snapshot with seq 1
      expect(events.length).toBeGreaterThan(0);
      const firstEvent = events[0];
      expect(isSnapshotEvent(firstEvent)).toBe(true);
      expect(firstEvent.seq).toBe(1);

      if (isSnapshotEvent(firstEvent)) {
        expect(firstEvent.covers.from_seq).toBe(1);
        expect(firstEvent.covers.to_seq).toBe(2);
        expect(firstEvent.summary).toBe('Test summary');
        expect(firstEvent.meta.test).toBe('metadata');
      }
    });

    it('should preserve kept messages with original seq numbers', async () => {
      // Create messages
      await appendMessage(TEST_DIR, 'space1', 'thread1', 'agent-a', 'Message 1');
      const msg2 = await appendMessage(TEST_DIR, 'space1', 'thread1', 'agent-b', 'IMPORTANT');
      await appendMessage(TEST_DIR, 'space1', 'thread1', 'agent-c', 'Message 3');

      // Compact with kept message
      const beginResult = await beginCompaction(TEST_DIR, 'space1', 'thread1');
      await commitCompaction(
        TEST_DIR,
        'space1',
        'thread1',
        beginResult.compaction_id,
        {
          covers_from_seq: 1,
          covers_to_seq: 3,
          summary: 'Summary',
        },
        [msg2] // Keep message 2
      );

      // Read thread
      const events = await readThreadAll(TEST_DIR, 'space1', 'thread1');
      const messages = events.filter(isMessageEvent);

      // Should have kept message with original seq
      const keptMessage = messages.find(m => m.text === 'IMPORTANT');
      expect(keptMessage).toBeDefined();
      expect(keptMessage?.seq).toBe(2); // Original seq preserved
    });
  });

  describe('Zero Message Loss Guarantee', () => {
    it('should preserve all messages on commit', async () => {
      // Create base messages
      const baseCount = 50;
      for (let i = 1; i <= baseCount; i++) {
        await appendMessage(TEST_DIR, 'space1', 'thread1', 'agent-a', `Base ${i}`);
      }

      // Start compaction
      const beginResult = await beginCompaction(TEST_DIR, 'space1', 'thread1');

      // Send delta messages
      const deltaCount = 10;
      for (let i = 1; i <= deltaCount; i++) {
        await appendMessage(TEST_DIR, 'space1', 'thread1', 'agent-b', `Delta ${i}`);
      }

      // Commit with some kept messages
      const keepCount = 5;
      const keepMessages = [];
      for (let i = 1; i <= keepCount; i++) {
        keepMessages.push({
          type: 'msg' as const,
          seq: i * 10,
          ts: new Date().toISOString(),
          from: 'agent-a',
          text: `Base ${i * 10}`,
        });
      }

      await commitCompaction(
        TEST_DIR,
        'space1',
        'thread1',
        beginResult.compaction_id,
        {
          covers_from_seq: 1,
          covers_to_seq: baseCount,
          summary: `Compacted ${baseCount} messages`,
        },
        keepMessages
      );

      // Verify all delta and kept messages are present
      const events = await readThreadAll(TEST_DIR, 'space1', 'thread1');
      const messages = events.filter(isMessageEvent);

      // Should have: keepCount kept messages + deltaCount delta messages
      expect(messages.length).toBe(keepCount + deltaCount);

      // Verify delta messages
      for (let i = 1; i <= deltaCount; i++) {
        const deltaMsg = messages.find(m => m.text === `Delta ${i}`);
        expect(deltaMsg).toBeDefined();
        expect(deltaMsg?.seq).toBe(baseCount + i);
      }
    });

    it('should preserve all messages on abort', async () => {
      // Create base messages
      const baseMessages = [];
      for (let i = 1; i <= 10; i++) {
        baseMessages.push(await appendMessage(TEST_DIR, 'space1', 'thread1', 'agent-a', `Base ${i}`));
      }

      // Start compaction
      const beginResult = await beginCompaction(TEST_DIR, 'space1', 'thread1');

      // Send delta messages
      const deltaMessages = [];
      for (let i = 1; i <= 5; i++) {
        deltaMessages.push(await appendMessage(TEST_DIR, 'space1', 'thread1', 'agent-b', `Delta ${i}`));
      }

      // Abort compaction
      await abortCompaction(TEST_DIR, 'space1', 'thread1', beginResult.compaction_id);

      // Verify all messages are present
      const events = await readThreadAll(TEST_DIR, 'space1', 'thread1');
      const messages = events.filter(isMessageEvent);

      expect(messages.length).toBe(15); // 10 base + 5 delta

      // Verify all base messages
      for (let i = 1; i <= 10; i++) {
        const baseMsg = messages.find(m => m.text === `Base ${i}`);
        expect(baseMsg).toBeDefined();
        expect(baseMsg?.seq).toBe(i);
      }

      // Verify all delta messages
      for (let i = 1; i <= 5; i++) {
        const deltaMsg = messages.find(m => m.text === `Delta ${i}`);
        expect(deltaMsg).toBeDefined();
        expect(deltaMsg?.seq).toBe(10 + i);
      }
    });
  });

  describe('Compaction State Management', () => {
    it('should track active compaction session', async () => {
      // Create thread
      await appendMessage(TEST_DIR, 'space1', 'thread1', 'agent-a', 'Message');

      // No active compaction initially
      let session = await getActiveCompaction(TEST_DIR, 'space1', 'thread1');
      expect(session).toBeNull();

      // Start compaction
      const beginResult = await beginCompaction(TEST_DIR, 'space1', 'thread1');

      // Should have active session
      session = await getActiveCompaction(TEST_DIR, 'space1', 'thread1');
      expect(session).not.toBeNull();
      expect(session?.compaction_id).toBe(beginResult.compaction_id);
      expect(session?.base_seq).toBe(1);

      // Commit compaction
      await commitCompaction(
        TEST_DIR,
        'space1',
        'thread1',
        beginResult.compaction_id,
        {
          covers_from_seq: 1,
          covers_to_seq: 1,
          summary: 'Summary',
        }
      );

      // Session should be cleared
      session = await getActiveCompaction(TEST_DIR, 'space1', 'thread1');
      expect(session).toBeNull();
    });

    it('should clear compaction state on abort', async () => {
      // Create thread
      await appendMessage(TEST_DIR, 'space1', 'thread1', 'agent-a', 'Message');

      // Start compaction
      const beginResult = await beginCompaction(TEST_DIR, 'space1', 'thread1');

      // Verify active
      let session = await getActiveCompaction(TEST_DIR, 'space1', 'thread1');
      expect(session).not.toBeNull();

      // Abort
      await abortCompaction(TEST_DIR, 'space1', 'thread1', beginResult.compaction_id);

      // Should be cleared
      session = await getActiveCompaction(TEST_DIR, 'space1', 'thread1');
      expect(session).toBeNull();
    });
  });

  describe('Edge Cases', () => {
    it('should handle compaction with no delta messages', async () => {
      // Create messages
      await appendMessage(TEST_DIR, 'space1', 'thread1', 'agent-a', 'Message 1');
      await appendMessage(TEST_DIR, 'space1', 'thread1', 'agent-b', 'Message 2');

      // Start and immediately commit (no delta)
      const beginResult = await beginCompaction(TEST_DIR, 'space1', 'thread1');
      const commitResult = await commitCompaction(
        TEST_DIR,
        'space1',
        'thread1',
        beginResult.compaction_id,
        {
          covers_from_seq: 1,
          covers_to_seq: 2,
          summary: 'Summary',
        }
      );

      expect(commitResult.delta_replayed).toBe(0);
      // commitCompaction returns storage result without success field
      expect(commitResult.new_epoch).toBe(1);
      expect(commitResult.message_count).toBeGreaterThan(0);
    });

    it('should handle compaction with only snapshot (no kept messages)', async () => {
      // Create messages
      for (let i = 1; i <= 100; i++) {
        await appendMessage(TEST_DIR, 'space1', 'thread1', 'agent-a', `Message ${i}`);
      }

      // Compact without kept messages
      const beginResult = await beginCompaction(TEST_DIR, 'space1', 'thread1');
      await commitCompaction(
        TEST_DIR,
        'space1',
        'thread1',
        beginResult.compaction_id,
        {
          covers_from_seq: 1,
          covers_to_seq: 100,
          summary: 'Everything summarized',
        }
      );

      // Should have just snapshot
      const events = await readThreadAll(TEST_DIR, 'space1', 'thread1');
      const snapshots = events.filter(isSnapshotEvent);
      const messages = events.filter(isMessageEvent);

      expect(snapshots.length).toBe(1);
      expect(messages.length).toBe(0);
    });

    it('should handle large delta file during compaction', async () => {
      // Create base
      await appendMessage(TEST_DIR, 'space1', 'thread1', 'agent-a', 'Base');

      // Start compaction
      const beginResult = await beginCompaction(TEST_DIR, 'space1', 'thread1');

      // Send large number of delta messages
      for (let i = 1; i <= 1000; i++) {
        await appendMessage(TEST_DIR, 'space1', 'thread1', `agent-${i % 10}`, `Delta ${i}`);
      }

      // Commit
      const commitResult = await commitCompaction(
        TEST_DIR,
        'space1',
        'thread1',
        beginResult.compaction_id,
        {
          covers_from_seq: 1,
          covers_to_seq: 1,
          summary: 'Summary',
        }
      );

      expect(commitResult.delta_replayed).toBe(1000);

      // Verify all delta messages present
      const events = await readThreadAll(TEST_DIR, 'space1', 'thread1');
      const messages = events.filter(isMessageEvent);
      expect(messages.length).toBe(1000);
    });
  });
});
