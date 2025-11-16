/**
 * Integration Test for User Story 6: Thread Compaction
 *
 * Goal: Enable agents to compact long threads without data loss using two-phase protocol.
 *
 * Independent Test: Start compaction on thread with 1000 messages, send 10 new messages
 * during compaction, commit, and verify all 10 delta messages are preserved along with snapshot.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { compactBegin, compactCommit, compactAbort } from '../../src/tools/compaction.js';
import {
  appendMessage,
  clearThreadMetadataCache,
  readThreadAll,
  getThreadEpoch,
  getThreadMetadata,
} from '../../src/storage/thread-ops.js';
import {
  getCursor,
  advanceCursorWithReceipt,
  getEffectiveCursor,
} from '../../src/storage/cursor-ops.js';
import { isMessageEvent, isSnapshotEvent } from '../../src/types/events.js';

const TEST_DIR = join(process.cwd(), 'test-data', 'user-story-6-test');
const SPACE = 'project-coordination';

describe('User Story 6: Thread Compaction', () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
    clearThreadMetadataCache();
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
    clearThreadMetadataCache();
  });

  it('should compact thread with 1000 messages and preserve 10 delta messages', async () => {
    // Create thread with 1000 messages
    console.log('Creating 1000 messages...');
    for (let i = 1; i <= 1000; i++) {
      await appendMessage(TEST_DIR, SPACE, 'main', `agent-${i % 5}`, `Message ${i}`);
    }

    // Verify initial state
    const initialEvents = await readThreadAll(TEST_DIR, SPACE, 'main');
    expect(initialEvents.length).toBe(1000);

    // Start compaction
    console.log('Starting compaction...');
    const beginResult = await compactBegin(TEST_DIR, SPACE, {
      thread: 'main',
    });

    expect(beginResult.success).toBe(true);
    expect(beginResult.base_seq).toBe(1000);
    expect(beginResult.epoch).toBe(0);
    expect(beginResult.compaction_id).toMatch(/^comp-/);

    // Send 10 new messages during compaction
    console.log('Sending 10 messages during compaction...');
    const deltaMessages = [];
    for (let i = 1; i <= 10; i++) {
      const msg = await appendMessage(
        TEST_DIR,
        SPACE,
        'main',
        'agent-archiver',
        `Delta message ${i} during compaction`
      );
      deltaMessages.push(msg);
    }

    // Verify delta messages have correct seq numbers
    expect(deltaMessages[0].seq).toBe(1001);
    expect(deltaMessages[9].seq).toBe(1010);

    // Commit compaction with snapshot
    console.log('Committing compaction...');
    const commitResult = await compactCommit(TEST_DIR, SPACE, {
      thread: 'main',
      compaction_id: beginResult.compaction_id,
      snapshot: {
        covers_from_seq: 1,
        covers_to_seq: 1000,
        summary: 'Thread contained 1000 coordination messages spanning the project. Key discussions covered architecture decisions, task assignments, and progress tracking.',
        meta: {
          compacted_by: 'agent-archiver',
          compacted_at: new Date().toISOString(),
          original_message_count: 1000,
        },
      },
    });

    expect(commitResult.success).toBe(true);
    expect(commitResult.new_epoch).toBe(1);
    expect(commitResult.min_available_seq).toBe(1001);
    expect(commitResult.delta_replayed).toBe(10);

    // Verify all 10 delta messages are preserved
    const finalEvents = await readThreadAll(TEST_DIR, SPACE, 'main');
    const finalMessages = finalEvents.filter(isMessageEvent);
    const snapshots = finalEvents.filter(isSnapshotEvent);

    expect(snapshots.length).toBe(1);
    expect(snapshots[0].seq).toBe(1);
    expect(snapshots[0].covers.from_seq).toBe(1);
    expect(snapshots[0].covers.to_seq).toBe(1000);

    // Should have exactly 10 delta messages
    expect(finalMessages.length).toBe(10);

    // Verify each delta message
    for (let i = 1; i <= 10; i++) {
      const msg = finalMessages.find(m => m.text === `Delta message ${i} during compaction`);
      expect(msg).toBeDefined();
      expect(msg?.seq).toBe(1000 + i);
      expect(msg?.from).toBe('agent-archiver');
    }

    console.log('User Story 6: Thread Compaction ✓');
  });

  it('should handle cursor clamping after compaction', async () => {
    // Create messages
    for (let i = 1; i <= 100; i++) {
      await appendMessage(TEST_DIR, SPACE, 'thread1', 'agent-a', `Message ${i}`);
    }

    // Agent-reader reads first 50 messages
    await advanceCursorWithReceipt(TEST_DIR, SPACE, 'agent-reader', 'thread1', 50);

    // Verify cursor
    let cursor = await getCursor(TEST_DIR, SPACE, 'agent-reader', 'thread1');
    expect(cursor?.last_seq).toBe(50);
    expect(cursor?.epoch).toBe(0);

    // Compact thread (covers 1-100)
    const beginResult = await compactBegin(TEST_DIR, SPACE, {
      thread: 'thread1',
    });

    await compactCommit(TEST_DIR, SPACE, {
      thread: 'thread1',
      compaction_id: beginResult.compaction_id,
      snapshot: {
        covers_from_seq: 1,
        covers_to_seq: 100,
        summary: 'Compacted 100 messages',
      },
    });

    // Get effective cursor - should be clamped to min_available_seq
    const metadata = await getThreadMetadata(TEST_DIR, SPACE, 'thread1');
    expect(metadata.epoch).toBe(1);
    expect(metadata.min_available_seq).toBe(101);

    // Effective cursor should be clamped
    const effectiveCursor = await getEffectiveCursor(
      TEST_DIR,
      SPACE,
      'agent-reader',
      'thread1'
    );

    expect(effectiveCursor.last_seq).toBe(101); // Clamped to min_available_seq
    expect(effectiveCursor.epoch).toBe(1); // Updated to current epoch
  });

  it('should handle compaction abort with zero message loss', async () => {
    // Create base messages
    for (let i = 1; i <= 50; i++) {
      await appendMessage(TEST_DIR, SPACE, 'thread1', 'agent-a', `Base ${i}`);
    }

    // Start compaction
    const beginResult = await compactBegin(TEST_DIR, SPACE, {
      thread: 'thread1',
    });

    // Send messages during compaction
    for (let i = 1; i <= 20; i++) {
      await appendMessage(TEST_DIR, SPACE, 'thread1', 'agent-b', `Delta ${i}`);
    }

    // Abort compaction
    const abortResult = await compactAbort(TEST_DIR, SPACE, {
      thread: 'thread1',
      compaction_id: beginResult.compaction_id,
    });

    expect(abortResult.success).toBe(true);
    expect(abortResult.delta_messages_merged).toBe(20);

    // Verify zero message loss
    const events = await readThreadAll(TEST_DIR, SPACE, 'thread1');
    const messages = events.filter(isMessageEvent);

    expect(messages.length).toBe(70); // 50 base + 20 delta

    // Verify all messages present
    for (let i = 1; i <= 50; i++) {
      expect(messages.some(m => m.text === `Base ${i}`)).toBe(true);
    }
    for (let i = 1; i <= 20; i++) {
      expect(messages.some(m => m.text === `Delta ${i}`)).toBe(true);
    }

    // Verify epoch unchanged
    const epoch = await getThreadEpoch(TEST_DIR, SPACE, 'thread1');
    expect(epoch).toBe(0);
  });

  it('should handle compaction with kept messages', async () => {
    // Create messages
    const messages = [];
    for (let i = 1; i <= 100; i++) {
      messages.push(
        await appendMessage(TEST_DIR, SPACE, 'thread1', `agent-${i % 3}`, `Message ${i}`)
      );
    }

    // Start compaction
    const beginResult = await compactBegin(TEST_DIR, SPACE, {
      thread: 'thread1',
    });

    // Send delta messages
    for (let i = 1; i <= 5; i++) {
      await appendMessage(TEST_DIR, SPACE, 'thread1', 'agent-new', `Delta ${i}`);
    }

    // Commit with important messages preserved
    const importantMessages = [
      messages[9], // Message 10
      messages[24], // Message 25
      messages[49], // Message 50
      messages[74], // Message 75
      messages[99], // Message 100
    ];

    await compactCommit(TEST_DIR, SPACE, {
      thread: 'thread1',
      compaction_id: beginResult.compaction_id,
      snapshot: {
        covers_from_seq: 1,
        covers_to_seq: 100,
        summary: 'Compacted 100 messages, preserved 5 important ones',
      },
      keep_messages: importantMessages.map(m => ({
        seq: m.seq,
        ts: m.ts,
        from: m.from,
        text: m.text,
      })),
    });

    // Verify kept messages and delta messages both present
    const events = await readThreadAll(TEST_DIR, SPACE, 'thread1');
    const finalMessages = events.filter(isMessageEvent);

    // Should have 5 kept + 5 delta = 10 messages
    expect(finalMessages.length).toBe(10);

    // Verify kept messages
    expect(finalMessages.some(m => m.seq === 10 && m.text === 'Message 10')).toBe(true);
    expect(finalMessages.some(m => m.seq === 25 && m.text === 'Message 25')).toBe(true);
    expect(finalMessages.some(m => m.seq === 50 && m.text === 'Message 50')).toBe(true);
    expect(finalMessages.some(m => m.seq === 75 && m.text === 'Message 75')).toBe(true);
    expect(finalMessages.some(m => m.seq === 100 && m.text === 'Message 100')).toBe(true);

    // Verify delta messages
    for (let i = 1; i <= 5; i++) {
      expect(finalMessages.some(m => m.text === `Delta ${i}` && m.seq === 100 + i)).toBe(true);
    }
  });

  it('should handle multiple sequential compactions', async () => {
    // First batch of messages
    for (let i = 1; i <= 100; i++) {
      await appendMessage(TEST_DIR, SPACE, 'thread1', 'agent-a', `Batch 1 Message ${i}`);
    }

    // First compaction
    let beginResult = await compactBegin(TEST_DIR, SPACE, {
      thread: 'thread1',
    });

    await compactCommit(TEST_DIR, SPACE, {
      thread: 'thread1',
      compaction_id: beginResult.compaction_id,
      snapshot: {
        covers_from_seq: 1,
        covers_to_seq: 100,
        summary: 'First compaction: 100 messages',
      },
    });

    let epoch = await getThreadEpoch(TEST_DIR, SPACE, 'thread1');
    expect(epoch).toBe(1);

    // Second batch of messages
    for (let i = 1; i <= 50; i++) {
      await appendMessage(TEST_DIR, SPACE, 'thread1', 'agent-b', `Batch 2 Message ${i}`);
    }

    // Second compaction
    beginResult = await compactBegin(TEST_DIR, SPACE, {
      thread: 'thread1',
    });

    expect(beginResult.epoch).toBe(1);

    await compactCommit(TEST_DIR, SPACE, {
      thread: 'thread1',
      compaction_id: beginResult.compaction_id,
      snapshot: {
        covers_from_seq: 1,
        covers_to_seq: 50,
        summary: 'Second compaction: snapshot + 50 messages',
      },
    });

    epoch = await getThreadEpoch(TEST_DIR, SPACE, 'thread1');
    expect(epoch).toBe(2);

    // Verify final state
    const events = await readThreadAll(TEST_DIR, SPACE, 'thread1');
    const snapshots = events.filter(isSnapshotEvent);

    expect(snapshots.length).toBe(1);
    expect(snapshots[0].covers.to_seq).toBe(50);
  });

  it('should handle concurrent read operations during compaction', async () => {
    // Create messages
    for (let i = 1; i <= 100; i++) {
      await appendMessage(TEST_DIR, SPACE, 'thread1', 'agent-a', `Message ${i}`);
    }

    // Multiple agents read before compaction
    await advanceCursorWithReceipt(TEST_DIR, SPACE, 'agent-reader-1', 'thread1', 50);
    await advanceCursorWithReceipt(TEST_DIR, SPACE, 'agent-reader-2', 'thread1', 75);
    await advanceCursorWithReceipt(TEST_DIR, SPACE, 'agent-reader-3', 'thread1', 100);

    // Start compaction
    const beginResult = await compactBegin(TEST_DIR, SPACE, {
      thread: 'thread1',
    });

    // Agents continue reading during compaction
    // (reading from base file, which is frozen)
    const events = await readThreadAll(TEST_DIR, SPACE, 'thread1');
    // Should have 100 messages + 3 read receipts from cursor advances
    expect(events.length).toBeGreaterThanOrEqual(100);

    // Send new messages during compaction
    for (let i = 1; i <= 10; i++) {
      await appendMessage(TEST_DIR, SPACE, 'thread1', 'agent-writer', `New ${i}`);
    }

    // Commit compaction
    await compactCommit(TEST_DIR, SPACE, {
      thread: 'thread1',
      compaction_id: beginResult.compaction_id,
      snapshot: {
        covers_from_seq: 1,
        covers_to_seq: 100,
        summary: 'Compacted',
      },
    });

    // Verify all agents can still read with cursor clamping
    const cursor1 = await getEffectiveCursor(TEST_DIR, SPACE, 'agent-reader-1', 'thread1');
    const cursor2 = await getEffectiveCursor(TEST_DIR, SPACE, 'agent-reader-2', 'thread1');
    const cursor3 = await getEffectiveCursor(TEST_DIR, SPACE, 'agent-reader-3', 'thread1');

    // All cursors should be clamped to min_available_seq (101)
    expect(cursor1.last_seq).toBe(101);
    expect(cursor2.last_seq).toBe(101);
    expect(cursor3.last_seq).toBe(101);

    // All epochs updated
    expect(cursor1.epoch).toBe(1);
    expect(cursor2.epoch).toBe(1);
    expect(cursor3.epoch).toBe(1);
  });

  it('should verify zero message loss under stress', async () => {
    // Create base
    for (let i = 1; i <= 500; i++) {
      await appendMessage(TEST_DIR, SPACE, 'stress-thread', `agent-${i % 10}`, `Base ${i}`);
    }

    // Start compaction
    const beginResult = await compactBegin(TEST_DIR, SPACE, {
      thread: 'stress-thread',
    });

    // Rapidly send messages during compaction
    const deltaPromises = [];
    for (let i = 1; i <= 100; i++) {
      deltaPromises.push(
        appendMessage(TEST_DIR, SPACE, 'stress-thread', `agent-stress-${i % 5}`, `Stress ${i}`)
      );
    }

    await Promise.all(deltaPromises);

    // Commit with some kept messages
    const keepMessages = [];
    for (let seq = 100; seq <= 500; seq += 100) {
      keepMessages.push({
        seq,
        ts: new Date().toISOString(),
        from: `agent-${seq % 10}`,
        text: `Base ${seq}`,
      });
    }

    await compactCommit(TEST_DIR, SPACE, {
      thread: 'stress-thread',
      compaction_id: beginResult.compaction_id,
      snapshot: {
        covers_from_seq: 1,
        covers_to_seq: 500,
        summary: 'Stress test compaction',
      },
      keep_messages: keepMessages,
    });

    // Verify all messages accounted for
    const events = await readThreadAll(TEST_DIR, SPACE, 'stress-thread');
    const messages = events.filter(isMessageEvent);
    const snapshots = events.filter(isSnapshotEvent);

    expect(snapshots.length).toBe(1);
    expect(messages.length).toBe(105); // 5 kept + 100 delta

    // Verify kept messages
    for (let seq = 100; seq <= 500; seq += 100) {
      expect(messages.some(m => m.seq === seq)).toBe(true);
    }

    // Verify all delta messages
    for (let i = 1; i <= 100; i++) {
      expect(messages.some(m => m.text === `Stress ${i}`)).toBe(true);
    }

    console.log('Zero message loss verified under stress ✓');
  });
});
