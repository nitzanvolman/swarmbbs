/**
 * Unit Tests for Tail Reader
 *
 * Tests efficient tail reading of large JSONL files
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { readTail, readAfterSeq, getCurrentSeq } from '../../src/storage/tail-reader.js';
import type { MessageEvent } from '../../src/types/events.js';

const TEST_DIR = join(process.cwd(), 'test-data', 'tail-reader-test');

describe('Tail Reader', () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  describe('readTail', () => {
    it('should return empty array for non-existent file', async () => {
      const events = await readTail(join(TEST_DIR, 'nonexistent.log'), 10);
      expect(events).toEqual([]);
    });

    it('should return empty array for empty file', async () => {
      const filePath = join(TEST_DIR, 'empty.log');
      await writeFile(filePath, '', 'utf8');

      const events = await readTail(filePath, 10);
      expect(events).toEqual([]);
    });

    it('should read last N lines from small file', async () => {
      const filePath = join(TEST_DIR, 'small.log');
      const lines = [
        { type: 'msg', ts: '2025-01-01T00:00:00.000Z', seq: 1, from: 'a', text: 'msg1' },
        { type: 'msg', ts: '2025-01-01T00:00:01.000Z', seq: 2, from: 'b', text: 'msg2' },
        { type: 'msg', ts: '2025-01-01T00:00:02.000Z', seq: 3, from: 'c', text: 'msg3' },
        { type: 'msg', ts: '2025-01-01T00:00:03.000Z', seq: 4, from: 'd', text: 'msg4' },
        { type: 'msg', ts: '2025-01-01T00:00:04.000Z', seq: 5, from: 'e', text: 'msg5' },
      ];

      const content = lines.map(l => JSON.stringify(l)).join('\n') + '\n';
      await writeFile(filePath, content, 'utf8');

      const events = await readTail(filePath, 3);
      expect(events).toHaveLength(3);
      expect(events[0].seq).toBe(3);
      expect(events[1].seq).toBe(4);
      expect(events[2].seq).toBe(5);
    });

    it('should handle requesting more lines than exist', async () => {
      const filePath = join(TEST_DIR, 'small2.log');
      const lines = [
        { type: 'msg', ts: '2025-01-01T00:00:00.000Z', seq: 1, from: 'a', text: 'msg1' },
        { type: 'msg', ts: '2025-01-01T00:00:01.000Z', seq: 2, from: 'b', text: 'msg2' },
      ];

      const content = lines.map(l => JSON.stringify(l)).join('\n') + '\n';
      await writeFile(filePath, content, 'utf8');

      const events = await readTail(filePath, 100);
      expect(events).toHaveLength(2);
      expect(events[0].seq).toBe(1);
      expect(events[1].seq).toBe(2);
    });

    it('should efficiently read tail of large file', async () => {
      const filePath = join(TEST_DIR, 'large.log');

      // Create file with 1000 messages
      const lines: string[] = [];
      for (let i = 1; i <= 1000; i++) {
        const event: MessageEvent = {
          type: 'msg',
          ts: new Date(2025, 0, 1, 0, 0, i).toISOString(),
          seq: i,
          from: 'agent-a',
          text: `Message ${i}`,
        };
        lines.push(JSON.stringify(event));
      }

      await writeFile(filePath, lines.join('\n') + '\n', 'utf8');

      // Read last 10 lines
      const events = await readTail(filePath, 10);
      expect(events).toHaveLength(10);
      expect(events[0].seq).toBe(991);
      expect(events[9].seq).toBe(1000);
      expect((events[9] as MessageEvent).text).toBe('Message 1000');
    });

    it('should skip malformed lines', async () => {
      const filePath = join(TEST_DIR, 'malformed.log');
      const content = [
        '{"type":"msg","ts":"2025-01-01T00:00:00.000Z","seq":1,"from":"a","text":"msg1"}',
        'invalid json line',
        '{"type":"msg","ts":"2025-01-01T00:00:02.000Z","seq":3,"from":"c","text":"msg3"}',
      ].join('\n') + '\n';

      await writeFile(filePath, content, 'utf8');

      const events = await readTail(filePath, 10);
      expect(events).toHaveLength(2);
      expect(events[0].seq).toBe(1);
      expect(events[1].seq).toBe(3);
    });
  });

  describe('readAfterSeq', () => {
    it('should return only events with seq > afterSeq', async () => {
      const filePath = join(TEST_DIR, 'filter.log');
      const lines = [
        { type: 'msg', ts: '2025-01-01T00:00:00.000Z', seq: 1, from: 'a', text: 'msg1' },
        { type: 'msg', ts: '2025-01-01T00:00:01.000Z', seq: 2, from: 'b', text: 'msg2' },
        { type: 'msg', ts: '2025-01-01T00:00:02.000Z', seq: 3, from: 'c', text: 'msg3' },
        { type: 'msg', ts: '2025-01-01T00:00:03.000Z', seq: 4, from: 'd', text: 'msg4' },
        { type: 'msg', ts: '2025-01-01T00:00:04.000Z', seq: 5, from: 'e', text: 'msg5' },
      ];

      const content = lines.map(l => JSON.stringify(l)).join('\n') + '\n';
      await writeFile(filePath, content, 'utf8');

      const events = await readAfterSeq(filePath, 2, 100);
      expect(events).toHaveLength(3);
      expect(events[0].seq).toBe(3);
      expect(events[1].seq).toBe(4);
      expect(events[2].seq).toBe(5);
    });

    it('should return empty array if all events are before afterSeq', async () => {
      const filePath = join(TEST_DIR, 'filter2.log');
      const lines = [
        { type: 'msg', ts: '2025-01-01T00:00:00.000Z', seq: 1, from: 'a', text: 'msg1' },
        { type: 'msg', ts: '2025-01-01T00:00:01.000Z', seq: 2, from: 'b', text: 'msg2' },
      ];

      const content = lines.map(l => JSON.stringify(l)).join('\n') + '\n';
      await writeFile(filePath, content, 'utf8');

      const events = await readAfterSeq(filePath, 10, 100);
      expect(events).toEqual([]);
    });
  });

  describe('getCurrentSeq', () => {
    it('should return 0 for non-existent file', async () => {
      const seq = await getCurrentSeq(join(TEST_DIR, 'nonexistent.log'));
      expect(seq).toBe(0);
    });

    it('should return 0 for empty file', async () => {
      const filePath = join(TEST_DIR, 'empty2.log');
      await writeFile(filePath, '', 'utf8');

      const seq = await getCurrentSeq(filePath);
      expect(seq).toBe(0);
    });

    it('should return seq of last event', async () => {
      const filePath = join(TEST_DIR, 'seq.log');
      const lines = [
        { type: 'msg', ts: '2025-01-01T00:00:00.000Z', seq: 1, from: 'a', text: 'msg1' },
        { type: 'msg', ts: '2025-01-01T00:00:01.000Z', seq: 2, from: 'b', text: 'msg2' },
        { type: 'read', ts: '2025-01-01T00:00:02.000Z', seq: 3, who: 'a', up_to_seq: 2 },
        { type: 'msg', ts: '2025-01-01T00:00:03.000Z', seq: 4, from: 'c', text: 'msg4' },
      ];

      const content = lines.map(l => JSON.stringify(l)).join('\n') + '\n';
      await writeFile(filePath, content, 'utf8');

      const seq = await getCurrentSeq(filePath);
      expect(seq).toBe(4);
    });

    it('should handle large files efficiently', async () => {
      const filePath = join(TEST_DIR, 'large-seq.log');

      // Create file with 10000 messages
      const lines: string[] = [];
      for (let i = 1; i <= 10000; i++) {
        const event: MessageEvent = {
          type: 'msg',
          ts: new Date(2025, 0, 1, 0, 0, i).toISOString(),
          seq: i,
          from: 'agent-a',
          text: `Message ${i}`,
        };
        lines.push(JSON.stringify(event));
      }

      await writeFile(filePath, lines.join('\n') + '\n', 'utf8');

      const seq = await getCurrentSeq(filePath);
      expect(seq).toBe(10000);
    });
  });
});
