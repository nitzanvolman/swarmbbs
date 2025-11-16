/**
 * Test for sequence number collision bug when multiple processes
 * write to the same thread concurrently
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { appendMessage, clearThreadMetadataCache } from '../../src/storage/thread-ops.js';

describe('Sequence Number Collision Bug', () => {
  const testRoot = join(process.cwd(), 'test-data', 'seq-collision');
  const space = 'test-space';
  const thread = 'test-thread';

  beforeEach(async () => {
    await rm(testRoot, { recursive: true, force: true });
    await mkdir(testRoot, { recursive: true });
    // Clear cache to simulate fresh process state
    clearThreadMetadataCache();
  });

  afterEach(async () => {
    await rm(testRoot, { recursive: true, force: true });
    clearThreadMetadataCache();
  });

  it('should NOT produce duplicate sequence numbers when metadata cache is stale', async () => {
    // Write first message
    const msg1 = await appendMessage(testRoot, space, thread, 'AgentA', 'Message 1');
    expect(msg1.seq).toBe(1);

    // Clear cache to simulate stale metadata (like when a different process writes)
    clearThreadMetadataCache();

    // Write second message - this simulates what happens when another process
    // writes to the same thread without seeing the first process's update
    const msg2 = await appendMessage(testRoot, space, thread, 'AgentB', 'Message 2');

    // BUG: If metadata is cached incorrectly, msg2 might get seq=1 or seq=2
    // After fix, msg2 should get seq=2 (reads latest from disk)
    console.log('Message 1:', msg1);
    console.log('Message 2:', msg2);

    // msg2 should have seq=2, not seq=1
    expect(msg2.seq).toBe(2);
    expect(msg1.seq).not.toBe(msg2.seq);
  });

  it('should maintain correct sequence ordering even with cache clears between writes', async () => {
    // Simulate sequential writes with cache clears (like different processes writing)
    const messages = [];

    for (let i = 0; i < 5; i++) {
      clearThreadMetadataCache(); // Simulate stale cache from different process
      const msg = await appendMessage(testRoot, space, thread, `Agent${i}`, `Message ${i}`);
      messages.push(msg);
    }

    // Extract sequence numbers
    const seqNumbers = messages.map(m => m.seq);

    // All sequence numbers should be unique and sequential
    const uniqueSeqs = new Set(seqNumbers);
    expect(uniqueSeqs.size).toBe(5);

    // Should be [1, 2, 3, 4, 5]
    expect(seqNumbers).toEqual([1, 2, 3, 4, 5]);
  });
});
