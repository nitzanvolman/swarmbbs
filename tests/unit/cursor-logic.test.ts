/**
 * Unit Tests for Cursor Logic
 *
 * Tests cursor advancement, epoch clamping, and read position tracking
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'fs/promises';
import { join } from 'path';
import {
  getCursor,
  writeCursor,
  updateCursor,
  getEffectiveCursor,
  resetCursor,
  advanceCursorWithReceipt,
} from '../../src/storage/cursor-ops.js';
import {
  appendMessage,
  getThreadMetadata,
  updateThreadMetadata,
  clearThreadMetadataCache,
  readThreadAll,
} from '../../src/storage/thread-ops.js';
import type { Cursor } from '../../src/types/state.js';
import { isReadReceiptEvent } from '../../src/types/events.js';

const TEST_DIR = join(process.cwd(), 'test-data', 'cursor-logic-test');

describe('Cursor Logic', () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
    clearThreadMetadataCache();
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
    clearThreadMetadataCache();
  });

  describe('Basic Cursor Operations', () => {
    it('should return null for non-existent cursor', async () => {
      const cursor = await getCursor(TEST_DIR, 'space1', 'agent-a', 'main');
      expect(cursor).toBeNull();
    });

    it('should write and read cursor', async () => {
      const cursorData: Cursor = {
        last_seq: 42,
        epoch: 0,
        updated_ts: new Date().toISOString(),
      };

      await writeCursor(TEST_DIR, 'space1', 'agent-a', 'main', cursorData);

      const retrieved = await getCursor(TEST_DIR, 'space1', 'agent-a', 'main');
      expect(retrieved).not.toBeNull();
      expect(retrieved!.last_seq).toBe(42);
      expect(retrieved!.epoch).toBe(0);
    });

    it('should update cursor with new last_seq', async () => {
      // Initialize thread metadata
      await getThreadMetadata(TEST_DIR, 'space1', 'main');

      // Update cursor
      const updated = await updateCursor(TEST_DIR, 'space1', 'agent-a', 'main', 10);
      expect(updated.last_seq).toBe(10);
      expect(updated.epoch).toBe(0);

      // Verify persistence
      const retrieved = await getCursor(TEST_DIR, 'space1', 'agent-a', 'main');
      expect(retrieved!.last_seq).toBe(10);
    });
  });

  describe('Epoch Clamping', () => {
    it('should clamp cursor when epoch mismatch detected', async () => {
      // Initialize thread with epoch 0
      await getThreadMetadata(TEST_DIR, 'space1', 'main');

      // Create cursor at seq 50, epoch 0
      await writeCursor(TEST_DIR, 'space1', 'agent-a', 'main', {
        last_seq: 50,
        epoch: 0,
        updated_ts: new Date().toISOString(),
      });

      // Simulate compaction: bump epoch and set min_available_seq
      updateThreadMetadata('space1', 'main', {
        epoch: 1,
        min_available_seq: 100,
        current_seq: 150,
      });

      // Get effective cursor - should be clamped to min_available_seq
      const effective = await getEffectiveCursor(TEST_DIR, 'space1', 'agent-a', 'main');
      expect(effective.last_seq).toBe(100);
      expect(effective.epoch).toBe(1);
    });

    it('should not clamp cursor when epochs match', async () => {
      // Initialize thread
      await getThreadMetadata(TEST_DIR, 'space1', 'main');

      // Create cursor at seq 50, epoch 0
      await writeCursor(TEST_DIR, 'space1', 'agent-a', 'main', {
        last_seq: 50,
        epoch: 0,
        updated_ts: new Date().toISOString(),
      });

      // Get effective cursor - should use cursor as-is
      const effective = await getEffectiveCursor(TEST_DIR, 'space1', 'agent-a', 'main');
      expect(effective.last_seq).toBe(50);
      expect(effective.epoch).toBe(0);
    });

    it('should update cursor epoch after clamping', async () => {
      // Initialize thread
      await getThreadMetadata(TEST_DIR, 'space1', 'main');

      // Create cursor at seq 50, epoch 0
      await writeCursor(TEST_DIR, 'space1', 'agent-a', 'main', {
        last_seq: 50,
        epoch: 0,
        updated_ts: new Date().toISOString(),
      });

      // Simulate compaction
      updateThreadMetadata('space1', 'main', {
        epoch: 1,
        min_available_seq: 100,
        current_seq: 150,
      });

      // Update cursor - should clamp and update epoch
      const updated = await updateCursor(TEST_DIR, 'space1', 'agent-a', 'main', 120);
      expect(updated.last_seq).toBe(120);
      expect(updated.epoch).toBe(1);
    });

    it('should handle multiple epoch increments', async () => {
      // Initialize thread
      await getThreadMetadata(TEST_DIR, 'space1', 'main');

      // Create cursor at seq 10, epoch 0
      await writeCursor(TEST_DIR, 'space1', 'agent-a', 'main', {
        last_seq: 10,
        epoch: 0,
        updated_ts: new Date().toISOString(),
      });

      // Multiple compactions
      updateThreadMetadata('space1', 'main', {
        epoch: 3,
        min_available_seq: 500,
        current_seq: 600,
      });

      // Get effective cursor
      const effective = await getEffectiveCursor(TEST_DIR, 'space1', 'agent-a', 'main');
      expect(effective.last_seq).toBe(500);
      expect(effective.epoch).toBe(3);
    });
  });

  describe('Reset Cursor', () => {
    it('should reset cursor to specified position', async () => {
      // Initialize thread
      await getThreadMetadata(TEST_DIR, 'space1', 'main');
      updateThreadMetadata('space1', 'main', { current_seq: 100 });

      // Create cursor at seq 50
      await writeCursor(TEST_DIR, 'space1', 'agent-a', 'main', {
        last_seq: 50,
        epoch: 0,
        updated_ts: new Date().toISOString(),
      });

      // Reset to seq 0
      const reset = await resetCursor(TEST_DIR, 'space1', 'agent-a', 'main', 0);
      expect(reset.last_seq).toBe(0);
      expect(reset.epoch).toBe(0);
    });

    it('should clamp reset position to min_available_seq', async () => {
      // Initialize thread with compaction state
      await getThreadMetadata(TEST_DIR, 'space1', 'main');
      updateThreadMetadata('space1', 'main', {
        epoch: 1,
        min_available_seq: 100,
        current_seq: 200,
      });

      // Reset to seq 0 - should be clamped to 100
      const reset = await resetCursor(TEST_DIR, 'space1', 'agent-a', 'main', 0);
      expect(reset.last_seq).toBe(100);
      expect(reset.epoch).toBe(1);
    });
  });

  describe('Advance Cursor (FR-012: No Read Receipt Events)', () => {
    it('should advance cursor without appending read receipt event', async () => {
      // Create some messages
      await appendMessage(TEST_DIR, 'space1', 'main', 'agent-b', 'Hello');
      await appendMessage(TEST_DIR, 'space1', 'main', 'agent-b', 'World');

      // Advance cursor (FR-012a: no read receipt written to thread log)
      await advanceCursorWithReceipt(TEST_DIR, 'space1', 'agent-a', 'main', 2);

      // Check cursor was updated in presence directory
      const cursor = await getCursor(TEST_DIR, 'space1', 'agent-a', 'main');
      expect(cursor).not.toBeNull();
      expect(cursor!.last_seq).toBe(2);

      // Check NO read receipt events in thread log (FR-012a)
      const events = await readThreadAll(TEST_DIR, 'space1', 'main');
      const readReceipts = events.filter(isReadReceiptEvent);
      expect(readReceipts).toHaveLength(0); // No read receipts in thread logs anymore

      // Verify only message events exist
      const messages = events.filter(e => e.type === 'msg');
      expect(messages).toHaveLength(2);
    });

    it('should handle multiple cursor advancements without creating read receipt events', async () => {
      // Create messages
      for (let i = 1; i <= 10; i++) {
        await appendMessage(TEST_DIR, 'space1', 'main', 'agent-b', `Message ${i}`);
      }

      // Advance cursor multiple times
      await advanceCursorWithReceipt(TEST_DIR, 'space1', 'agent-a', 'main', 5);
      await advanceCursorWithReceipt(TEST_DIR, 'space1', 'agent-a', 'main', 10);

      // Check final cursor position in presence directory
      const cursor = await getCursor(TEST_DIR, 'space1', 'agent-a', 'main');
      expect(cursor!.last_seq).toBe(10);

      // Check NO read receipt events in thread log (FR-012a)
      const events = await readThreadAll(TEST_DIR, 'space1', 'main');
      const readReceipts = events.filter(isReadReceiptEvent);
      expect(readReceipts).toHaveLength(0); // No read receipts anymore

      // Verify only message events
      const messages = events.filter(e => e.type === 'msg');
      expect(messages).toHaveLength(10);
    });
  });

  describe('Effective Cursor with No Initial Cursor', () => {
    it('should return seq 0 for non-existent cursor', async () => {
      // Initialize thread
      await getThreadMetadata(TEST_DIR, 'space1', 'main');

      const effective = await getEffectiveCursor(TEST_DIR, 'space1', 'agent-a', 'main');
      expect(effective.last_seq).toBe(0);
      expect(effective.epoch).toBe(0);
    });

    it('should respect min_available_seq even with no cursor', async () => {
      // Initialize thread with compaction state
      await getThreadMetadata(TEST_DIR, 'space1', 'main');
      updateThreadMetadata('space1', 'main', {
        epoch: 1,
        min_available_seq: 100,
        current_seq: 200,
      });

      // No cursor exists, but min_available_seq should be respected
      const effective = await getEffectiveCursor(TEST_DIR, 'space1', 'agent-a', 'main');
      expect(effective.last_seq).toBe(0);
      expect(effective.epoch).toBe(1);
    });
  });

  describe('Cursor Isolation Between Handles', () => {
    it('should maintain separate cursors for different handles', async () => {
      // Initialize thread
      await getThreadMetadata(TEST_DIR, 'space1', 'main');

      // Create messages
      await appendMessage(TEST_DIR, 'space1', 'main', 'agent-c', 'Message 1');
      await appendMessage(TEST_DIR, 'space1', 'main', 'agent-c', 'Message 2');
      await appendMessage(TEST_DIR, 'space1', 'main', 'agent-c', 'Message 3');

      // Advance cursors for different handles
      await updateCursor(TEST_DIR, 'space1', 'agent-a', 'main', 1);
      await updateCursor(TEST_DIR, 'space1', 'agent-b', 'main', 3);

      // Check cursors are independent
      const cursorA = await getCursor(TEST_DIR, 'space1', 'agent-a', 'main');
      const cursorB = await getCursor(TEST_DIR, 'space1', 'agent-b', 'main');

      expect(cursorA!.last_seq).toBe(1);
      expect(cursorB!.last_seq).toBe(3);
    });
  });
});
