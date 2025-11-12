/**
 * Contract Tests for P2P Communication Tools
 *
 * Tests open_p2p and send_p2p tool contracts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { openP2P, sendP2P } from '../../src/tools/p2p.js';
import { getThreadPath, readThreadAll, clearThreadMetadataCache } from '../../src/storage/thread-ops.js';
import { existsSync } from 'fs';
import { SwarmBBSError } from '../../src/utils/errors.js';

describe('P2P Communication - Contract Tests', () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), 'swarmbbs-p2p-test-'));
    clearThreadMetadataCache();
  });

  afterEach(() => {
    if (testRoot && existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
    clearThreadMetadataCache();
  });

  describe('open_p2p', () => {
    it('should create canonical P2P thread name (alice -> bob)', async () => {
      const result = await openP2P(testRoot, 'alice', 'default', {
        peer_handle: 'bob',
      });

      expect(result.success).toBe(true);
      expect(result.space).toBe('default');
      expect(result.thread).toBe('p2p/alice__bob');
      expect(result.your_handle).toBe('alice');
      expect(result.peer_handle).toBe('bob');
      expect(result.created).toBe(true);
    });

    it('should create canonical P2P thread name (bob -> alice)', async () => {
      const result = await openP2P(testRoot, 'bob', 'default', {
        peer_handle: 'alice',
      });

      expect(result.success).toBe(true);
      expect(result.space).toBe('default');
      expect(result.thread).toBe('p2p/alice__bob'); // Same as alice -> bob
      expect(result.your_handle).toBe('bob');
      expect(result.peer_handle).toBe('alice');
      expect(result.created).toBe(true);
    });

    it('should handle uppercase handles by lowercasing', async () => {
      const result = await openP2P(testRoot, 'ALICE', 'default', {
        peer_handle: 'BOB',
      });

      expect(result.thread).toBe('p2p/alice__bob');
    });

    it('should handle mixed case handles', async () => {
      const result = await openP2P(testRoot, 'Agent-A', 'default', {
        peer_handle: 'Agent-B',
      });

      expect(result.thread).toBe('p2p/agent-a__agent-b');
    });

    it('should indicate created=false when thread already exists', async () => {
      // First call creates the thread
      await sendP2P(testRoot, 'alice', 'default', {
        peer_handle: 'bob',
        text: 'First message',
      });

      // Second call should show created=false
      const result = await openP2P(testRoot, 'alice', 'default', {
        peer_handle: 'bob',
      });

      expect(result.created).toBe(false);
    });

    it('should use custom space when specified', async () => {
      const result = await openP2P(testRoot, 'alice', 'default', {
        space: 'project-x',
        peer_handle: 'bob',
      });

      expect(result.space).toBe('project-x');
      expect(result.thread).toBe('p2p/alice__bob');
    });

    it('should reject P2P with self (same handle)', async () => {
      await expect(async () => {
        await openP2P(testRoot, 'alice', 'default', {
          peer_handle: 'alice',
        });
      }).rejects.toThrow('Cannot open P2P channel with yourself');
    });

    it('should reject P2P with self (case-insensitive)', async () => {
      await expect(async () => {
        await openP2P(testRoot, 'alice', 'default', {
          peer_handle: 'ALICE',
        });
      }).rejects.toThrow('Cannot open P2P channel with yourself');
    });

    it('should return SwarmBBSError with context for P2P with self', async () => {
      try {
        await openP2P(testRoot, 'agent-worker', 'default', {
          peer_handle: 'agent-worker',
        });
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).toBeInstanceOf(SwarmBBSError);
        const err = error as SwarmBBSError;
        expect(err.code).toBe(400);
        expect(err.context).toMatchObject({
          your_handle: 'agent-worker',
          peer_handle: 'agent-worker',
        });
        expect(err.nextSteps).toContain('different peer_handle');
      }
    });

    it('should handle handles with numbers and special chars', async () => {
      const result = await openP2P(testRoot, 'agent-1', 'default', {
        peer_handle: 'agent_2',
      });

      expect(result.thread).toBe('p2p/agent-1__agent_2');
    });

    it('should alphabetically sort handles correctly', async () => {
      // Test various sorting scenarios
      const tests = [
        { from: 'zebra', to: 'alice', expected: 'p2p/alice__zebra' },
        { from: 'bob', to: 'alice', expected: 'p2p/alice__bob' },
        { from: 'agent-a', to: 'agent-z', expected: 'p2p/agent-a__agent-z' },
        { from: 'charlie', to: 'bob', expected: 'p2p/bob__charlie' },
      ];

      for (const test of tests) {
        const result = await openP2P(testRoot, test.from, 'default', {
          peer_handle: test.to,
        });
        expect(result.thread).toBe(test.expected);
      }
    });
  });

  describe('send_p2p', () => {
    it('should send message to P2P thread', async () => {
      const result = await sendP2P(testRoot, 'alice', 'default', {
        peer_handle: 'bob',
        text: 'Hello Bob!',
      });

      expect(result.success).toBe(true);
      expect(result.space).toBe('default');
      expect(result.thread).toBe('p2p/alice__bob');
      expect(result.seq).toBe(1);
      expect(result.from).toBe('alice');
      expect(result.text).toBe('Hello Bob!');
      expect(result.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO 8601 format
    });

    it('should create P2P thread on first send', async () => {
      const threadPath = getThreadPath(testRoot, 'default', 'p2p/alice__bob');
      expect(existsSync(threadPath)).toBe(false);

      await sendP2P(testRoot, 'alice', 'default', {
        peer_handle: 'bob',
        text: 'First message',
      });

      expect(existsSync(threadPath)).toBe(true);
    });

    it('should increment sequence numbers', async () => {
      const result1 = await sendP2P(testRoot, 'alice', 'default', {
        peer_handle: 'bob',
        text: 'Message 1',
      });

      const result2 = await sendP2P(testRoot, 'alice', 'default', {
        peer_handle: 'bob',
        text: 'Message 2',
      });

      expect(result1.seq).toBe(1);
      expect(result2.seq).toBe(2);
    });

    it('should sanitize text (replace newlines with spaces)', async () => {
      const result = await sendP2P(testRoot, 'alice', 'default', {
        peer_handle: 'bob',
        text: 'Line 1\nLine 2\nLine 3',
      });

      expect(result.text).toBe('Line 1 Line 2 Line 3');
    });

    it('should accept messages up to 8 KiB', async () => {
      const text = 'a'.repeat(8192);
      const result = await sendP2P(testRoot, 'alice', 'default', {
        peer_handle: 'bob',
        text,
      });

      expect(result.success).toBe(true);
      expect(result.text).toHaveLength(8192);
    });

    it('should reject messages over 8 KiB', async () => {
      const text = 'a'.repeat(8193);

      await expect(async () => {
        await sendP2P(testRoot, 'alice', 'default', {
          peer_handle: 'bob',
          text,
        });
      }).rejects.toThrow('exceeds 8192 byte limit');
    });

    it('should return SwarmBBSError for oversized messages', async () => {
      const text = 'a'.repeat(9000);

      try {
        await sendP2P(testRoot, 'alice', 'default', {
          peer_handle: 'bob',
          text,
        });
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).toBeInstanceOf(SwarmBBSError);
        const err = error as SwarmBBSError;
        expect(err.code).toBe(413);
        expect(err.context).toMatchObject({
          limit_bytes: 8192,
        });
        expect(err.nextSteps).toContain('smaller messages');
      }
    });

    it('should reject P2P with self', async () => {
      await expect(async () => {
        await sendP2P(testRoot, 'alice', 'default', {
          peer_handle: 'alice',
          text: 'Note to self',
        });
      }).rejects.toThrow('Cannot open P2P channel with yourself');
    });

    it('should use custom space when specified', async () => {
      const result = await sendP2P(testRoot, 'alice', 'default', {
        space: 'project-x',
        peer_handle: 'bob',
        text: 'Hello from project-x',
      });

      expect(result.space).toBe('project-x');
    });

    it('should persist messages to disk', async () => {
      await sendP2P(testRoot, 'alice', 'default', {
        peer_handle: 'bob',
        text: 'Persisted message',
      });

      const events = await readThreadAll(testRoot, 'default', 'p2p/alice__bob');
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('msg');
      if (events[0].type === 'msg') {
        expect(events[0].text).toBe('Persisted message');
        expect(events[0].from).toBe('alice');
      }
    });

    it('should handle bidirectional communication', async () => {
      // Alice sends to Bob
      const msg1 = await sendP2P(testRoot, 'alice', 'default', {
        peer_handle: 'bob',
        text: 'Hello Bob',
      });

      // Bob sends to Alice (same thread)
      const msg2 = await sendP2P(testRoot, 'bob', 'default', {
        peer_handle: 'alice',
        text: 'Hello Alice',
      });

      expect(msg1.thread).toBe('p2p/alice__bob');
      expect(msg2.thread).toBe('p2p/alice__bob'); // Same thread
      expect(msg1.seq).toBe(1);
      expect(msg2.seq).toBe(2);
    });

    it('should handle multibyte characters correctly', async () => {
      const text = '🚀 Rocket emoji and text';
      const result = await sendP2P(testRoot, 'alice', 'default', {
        peer_handle: 'bob',
        text,
      });

      expect(result.text).toBe(text);
    });

    it('should enforce byte size limit for multibyte chars', async () => {
      // Emoji are 4 bytes each
      const text = '🚀'.repeat(2049); // 2049 * 4 = 8196 bytes (over 8 KiB)

      await expect(async () => {
        await sendP2P(testRoot, 'alice', 'default', {
          peer_handle: 'bob',
          text,
        });
      }).rejects.toThrow('exceeds 8192 byte limit');
    });
  });

  describe('Canonical naming bidirectionality', () => {
    it('should resolve to same thread regardless of direction', async () => {
      // Alice opens with Bob
      const open1 = await openP2P(testRoot, 'alice', 'default', {
        peer_handle: 'bob',
      });

      // Bob opens with Alice
      const open2 = await openP2P(testRoot, 'bob', 'default', {
        peer_handle: 'alice',
      });

      expect(open1.thread).toBe(open2.thread);
      expect(open1.thread).toBe('p2p/alice__bob');
    });

    it('should allow messages in both directions to same thread', async () => {
      // Alice sends to Bob
      await sendP2P(testRoot, 'alice', 'default', {
        peer_handle: 'bob',
        text: 'Message from Alice',
      });

      // Bob sends to Alice
      await sendP2P(testRoot, 'bob', 'default', {
        peer_handle: 'alice',
        text: 'Message from Bob',
      });

      // Verify both messages are in the same thread
      const events = await readThreadAll(testRoot, 'default', 'p2p/alice__bob');
      expect(events).toHaveLength(2);

      if (events[0].type === 'msg' && events[1].type === 'msg') {
        expect(events[0].from).toBe('alice');
        expect(events[0].text).toBe('Message from Alice');
        expect(events[1].from).toBe('bob');
        expect(events[1].text).toBe('Message from Bob');
      }
    });

    it('should handle reverse alphabetical order correctly', async () => {
      // Zebra opens with Alice
      const result1 = await openP2P(testRoot, 'zebra', 'default', {
        peer_handle: 'alice',
      });

      // Alice opens with Zebra
      const result2 = await openP2P(testRoot, 'alice', 'default', {
        peer_handle: 'zebra',
      });

      expect(result1.thread).toBe('p2p/alice__zebra');
      expect(result2.thread).toBe('p2p/alice__zebra');
    });
  });

  describe('Error context and next steps', () => {
    it('should provide helpful next steps for P2P with self', async () => {
      try {
        await sendP2P(testRoot, 'agent-worker', 'default', {
          peer_handle: 'agent-worker',
          text: 'Note to self',
        });
        expect.fail('Should have thrown');
      } catch (error) {
        const err = error as SwarmBBSError;
        expect(err.nextSteps).toContain('regular thread');
      }
    });

    it('should provide helpful next steps for oversized messages', async () => {
      try {
        await sendP2P(testRoot, 'alice', 'default', {
          peer_handle: 'bob',
          text: 'a'.repeat(9000),
        });
        expect.fail('Should have thrown');
      } catch (error) {
        const err = error as SwarmBBSError;
        expect(err.nextSteps).toContain('Split the message');
      }
    });
  });
});
