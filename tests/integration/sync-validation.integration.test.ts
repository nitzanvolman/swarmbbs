/**
 * Integration Tests for Sync Validation
 *
 * Tests validateCursorSync function and cursor advancement logic
 * during sync error scenarios (T008, T009, T010)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { validateCursorSync, getCursor, writeCursor } from '../../src/storage/cursor-ops.js';
import { appendMessage, clearThreadMetadataCache, getThreadMetadata } from '../../src/storage/thread-ops.js';
import { registerMessagingTools } from '../../src/tools/messaging.js';
import { registerP2PTools } from '../../src/tools/p2p.js';
import type { ToolDefinition, ServerConfig } from '../../src/server/mcp-server.js';
import type { Cursor } from '../../src/types/state.js';

describe('Sync Validation - Integration Tests', () => {
  let testRoot: string;
  let config: ServerConfig;
  let tools: Map<string, ToolDefinition>;

  beforeEach(async () => {
    // Create temporary test directory
    testRoot = await mkdtemp(join(tmpdir(), 'swarmbbs-sync-test-'));

    config = {
      rootDir: testRoot,
      handle: 'agent-a',
      defaultSpace: 'test-space',
      presenceTTL: 60,
    };

    tools = new Map();
    registerMessagingTools(tools);
    registerP2PTools(tools);
  });

  afterEach(async () => {
    // Clear thread metadata cache
    clearThreadMetadataCache();

    // Cleanup test directory
    await rm(testRoot, { recursive: true, force: true });
  });

  describe('T008: validateCursorSync function', () => {
    it('should return isSync=true when cursor matches thread state', async () => {
      // Create thread with 2 messages
      await appendMessage(testRoot, 'test-space', 'main', 'agent-b', 'Message 1');
      await appendMessage(testRoot, 'test-space', 'main', 'agent-b', 'Message 2');

      // Set agent-a's cursor to seq=2 (current)
      const cursor: Cursor = {
        last_seq: 2,
        epoch: 0,
        updated_ts: new Date().toISOString(),
      };
      await writeCursor(testRoot, 'test-space', 'agent-a', 'main', cursor);

      // Validate sync
      const result = await validateCursorSync(testRoot, 'test-space', 'agent-a', 'main');

      expect(result.isSync).toBe(true);
      expect(result.missingMessages).toBeUndefined();
      expect(result.cursorState).toBeUndefined();
    });

    it('should return isSync=false when cursor is behind thread state', async () => {
      // Create thread with 3 messages
      await appendMessage(testRoot, 'test-space', 'main', 'agent-b', 'Message 1');
      await appendMessage(testRoot, 'test-space', 'main', 'agent-b', 'Message 2');
      await appendMessage(testRoot, 'test-space', 'main', 'agent-c', 'Message 3');

      // Set agent-a's cursor to seq=1 (behind)
      const cursor: Cursor = {
        last_seq: 1,
        epoch: 0,
        updated_ts: new Date().toISOString(),
      };
      await writeCursor(testRoot, 'test-space', 'agent-a', 'main', cursor);

      // Validate sync
      const result = await validateCursorSync(testRoot, 'test-space', 'agent-a', 'main');

      expect(result.isSync).toBe(false);
      expect(result.missingMessages).toBeDefined();
      expect(result.missingMessages).toHaveLength(2); // Messages 2 and 3
      expect(result.cursorState).toBeDefined();
      expect(result.cursorState!.last_seq).toBe(3);
      expect(result.cursorState!.epoch).toBe(0);
    });

    it('should return isSync=true when no cursor exists (first send)', async () => {
      // Create thread with messages
      await appendMessage(testRoot, 'test-space', 'main', 'agent-b', 'Message 1');

      // No cursor exists for agent-a yet
      const cursor = await getCursor(testRoot, 'test-space', 'agent-a', 'main');
      expect(cursor).toBeNull();

      // Validate sync - should be true (first send allowed)
      const result = await validateCursorSync(testRoot, 'test-space', 'agent-a', 'main');

      expect(result.isSync).toBe(true);
    });

    it('should return missing messages in correct order (ascending seq)', async () => {
      // Create thread with 5 messages
      await appendMessage(testRoot, 'test-space', 'main', 'agent-b', 'Message 1');
      await appendMessage(testRoot, 'test-space', 'main', 'agent-c', 'Message 2');
      await appendMessage(testRoot, 'test-space', 'main', 'agent-b', 'Message 3');
      await appendMessage(testRoot, 'test-space', 'main', 'agent-c', 'Message 4');
      await appendMessage(testRoot, 'test-space', 'main', 'agent-b', 'Message 5');

      // Set cursor to seq=2
      const cursor: Cursor = {
        last_seq: 2,
        epoch: 0,
        updated_ts: new Date().toISOString(),
      };
      await writeCursor(testRoot, 'test-space', 'agent-a', 'main', cursor);

      // Validate sync
      const result = await validateCursorSync(testRoot, 'test-space', 'agent-a', 'main');

      expect(result.isSync).toBe(false);
      expect(result.missingMessages).toHaveLength(3); // Messages 3, 4, 5

      // Check order
      expect(result.missingMessages![0].seq).toBe(3);
      expect(result.missingMessages![1].seq).toBe(4);
      expect(result.missingMessages![2].seq).toBe(5);

      // Check content
      expect(result.missingMessages![0].text).toBe('Message 3');
      expect(result.missingMessages![1].text).toBe('Message 4');
      expect(result.missingMessages![2].text).toBe('Message 5');
    });

    it('should include complete message metadata in missing messages - T021', async () => {
      // Create thread with 1 message
      await appendMessage(testRoot, 'test-space', 'main', 'agent-b', 'Test message');

      // Set cursor to seq=0 (nothing read)
      const cursor: Cursor = {
        last_seq: 0,
        epoch: 0,
        updated_ts: new Date().toISOString(),
      };
      await writeCursor(testRoot, 'test-space', 'agent-a', 'main', cursor);

      // Validate sync
      const result = await validateCursorSync(testRoot, 'test-space', 'agent-a', 'main');

      expect(result.isSync).toBe(false);
      expect(result.missingMessages).toHaveLength(1);

      const msg = result.missingMessages![0];
      // Verify all metadata fields are present (T021)
      expect(msg).toHaveProperty('type', 'msg');
      expect(msg).toHaveProperty('seq', 1);
      expect(msg).toHaveProperty('from', 'agent-b');
      expect(msg).toHaveProperty('ts');
      expect(msg).toHaveProperty('text', 'Test message');
      expect(msg).toHaveProperty('up_to_seq', 0);
    });

    it('should respect maxMessages limit', async () => {
      // Create thread with 10 messages
      for (let i = 1; i <= 10; i++) {
        await appendMessage(testRoot, 'test-space', 'main', 'agent-b', `Message ${i}`);
      }

      // Set cursor to seq=0
      const cursor: Cursor = {
        last_seq: 0,
        epoch: 0,
        updated_ts: new Date().toISOString(),
      };
      await writeCursor(testRoot, 'test-space', 'agent-a', 'main', cursor);

      // Validate sync with limit of 5
      const result = await validateCursorSync(testRoot, 'test-space', 'agent-a', 'main', 5);

      expect(result.isSync).toBe(false);
      expect(result.missingMessages!.length).toBeLessThanOrEqual(5);
    });

    it('should handle epoch mismatch (post-compaction) - T029', async () => {
      // Create thread with 2 messages
      await appendMessage(testRoot, 'test-space', 'main', 'agent-b', 'Message 1');
      await appendMessage(testRoot, 'test-space', 'main', 'agent-b', 'Message 2');

      // Set cursor with old epoch (simulating cursor from before compaction)
      const cursor: Cursor = {
        last_seq: 1,
        epoch: 0, // Old epoch
        updated_ts: new Date().toISOString(),
      };
      await writeCursor(testRoot, 'test-space', 'agent-a', 'main', cursor);

      // Get current thread metadata
      const threadMeta = await getThreadMetadata(testRoot, 'test-space', 'main');

      // Validate sync - should handle epoch mismatch gracefully
      const result = await validateCursorSync(testRoot, 'test-space', 'agent-a', 'main');

      // Should detect that agent is behind and return missing messages
      expect(result.isSync).toBe(false);
      expect(result.missingMessages).toBeDefined();
      expect(result.missingMessages!.length).toBeGreaterThan(0);

      // Cursor state should be at current thread state
      expect(result.cursorState).toBeDefined();
      expect(result.cursorState!.last_seq).toBe(threadMeta.current_seq);
      expect(result.cursorState!.epoch).toBe(threadMeta.epoch);
    });
  });

  describe('T009: Cursor advancement during sync error', () => {
    it('should NOT automatically advance cursor in validateCursorSync', async () => {
      // NOTE: validateCursorSync only validates and returns missing messages
      // It does NOT advance the cursor - that happens in the send handler

      // Create thread with 3 messages
      await appendMessage(testRoot, 'test-space', 'main', 'agent-b', 'Message 1');
      await appendMessage(testRoot, 'test-space', 'main', 'agent-b', 'Message 2');
      await appendMessage(testRoot, 'test-space', 'main', 'agent-c', 'Message 3');

      // Set cursor to seq=1
      const cursor: Cursor = {
        last_seq: 1,
        epoch: 0,
        updated_ts: new Date().toISOString(),
      };
      await writeCursor(testRoot, 'test-space', 'agent-a', 'main', cursor);

      // Validate sync
      const result = await validateCursorSync(testRoot, 'test-space', 'agent-a', 'main');

      expect(result.isSync).toBe(false);
      expect(result.cursorState).toMatchObject({
        last_seq: 3,
        epoch: 0,
      });

      // Check cursor was NOT advanced yet (validateCursorSync doesn't write)
      const cursorAfter = await getCursor(testRoot, 'test-space', 'agent-a', 'main');
      expect(cursorAfter!.last_seq).toBe(1); // Still at old position
    });

    it('should provide cursor state for advancement in result', async () => {
      // Create thread
      await appendMessage(testRoot, 'test-space', 'main', 'agent-b', 'Message 1');
      await appendMessage(testRoot, 'test-space', 'main', 'agent-b', 'Message 2');
      await appendMessage(testRoot, 'test-space', 'main', 'agent-b', 'Message 3');

      // Set cursor to seq=0
      const cursor: Cursor = {
        last_seq: 0,
        epoch: 0,
        updated_ts: new Date().toISOString(),
      };
      await writeCursor(testRoot, 'test-space', 'agent-a', 'main', cursor);

      // Validate sync
      const result = await validateCursorSync(testRoot, 'test-space', 'agent-a', 'main');

      // Result should include cursor state to advance to
      expect(result.cursorState).toBeDefined();
      expect(result.cursorState!.last_seq).toBe(3);
      expect(result.cursorState!.epoch).toBe(0);
    });

    it('should calculate correct cursor advancement for large gap', async () => {
      // Create thread with many messages
      for (let i = 1; i <= 100; i++) {
        await appendMessage(testRoot, 'test-space', 'main', 'agent-b', `Message ${i}`);
      }

      // Set cursor far behind
      const cursor: Cursor = {
        last_seq: 10,
        epoch: 0,
        updated_ts: new Date().toISOString(),
      };
      await writeCursor(testRoot, 'test-space', 'agent-a', 'main', cursor);

      // Validate sync
      const result = await validateCursorSync(testRoot, 'test-space', 'agent-a', 'main');

      expect(result.isSync).toBe(false);
      expect(result.cursorState!.last_seq).toBe(100); // Should advance to latest
    });
  });

  describe('T010: Send rejection when cursor behind', () => {
    it('should reject send when cursor is behind thread state', async () => {
      const sendTool = tools.get('swarmbbs.send_message')!;

      // Agent-b sends messages 1 and 2
      const agentBConfig: ServerConfig = {
        ...config,
        handle: 'agent-b',
      };
      await sendTool.handler({ thread: 'coordination', text: 'Message 1' }, agentBConfig);
      await sendTool.handler({ thread: 'coordination', text: 'Message 2' }, agentBConfig);

      // Agent-a has cursor at seq=1 (behind)
      const cursor: Cursor = {
        last_seq: 1,
        epoch: 0,
        updated_ts: new Date().toISOString(),
      };
      await writeCursor(testRoot, 'test-space', 'agent-a', 'coordination', cursor);

      // Agent-a tries to send - should fail with sync error
      await expect(
        sendTool.handler({ thread: 'coordination', text: 'Agent A message' }, config)
      ).rejects.toThrow();
    });

    it('should include 409 error code in sync error', async () => {
      const sendTool = tools.get('swarmbbs.send_message')!;

      // Agent-b sends message
      const agentBConfig: ServerConfig = {
        ...config,
        handle: 'agent-b',
      };
      await sendTool.handler({ thread: 'coordination', text: 'Message 1' }, agentBConfig);

      // Agent-a has cursor at seq=0
      const cursor: Cursor = {
        last_seq: 0,
        epoch: 0,
        updated_ts: new Date().toISOString(),
      };
      await writeCursor(testRoot, 'test-space', 'agent-a', 'coordination', cursor);

      // Try to send - should get 409 error
      try {
        await sendTool.handler({ thread: 'coordination', text: 'Agent A message' }, config);
        expect.fail('Should have thrown sync error');
      } catch (error: any) {
        expect(error.code).toBe(409);
        expect(error.name).toBe('SwarmBBSError');
      }
    });

    it('should include missing messages in sync error', async () => {
      const sendTool = tools.get('swarmbbs.send_message')!;

      // Agent-b sends messages
      const agentBConfig: ServerConfig = {
        ...config,
        handle: 'agent-b',
      };
      await sendTool.handler({ thread: 'coordination', text: 'Message 1' }, agentBConfig);
      await sendTool.handler({ thread: 'coordination', text: 'Message 2' }, agentBConfig);

      // Agent-a has cursor at seq=0
      const cursor: Cursor = {
        last_seq: 0,
        epoch: 0,
        updated_ts: new Date().toISOString(),
      };
      await writeCursor(testRoot, 'test-space', 'agent-a', 'coordination', cursor);

      // Try to send
      try {
        await sendTool.handler({ thread: 'coordination', text: 'Agent A message' }, config);
        expect.fail('Should have thrown sync error');
      } catch (error: any) {
        expect(error.context).toBeDefined();
        expect(error.context.missing_messages).toBeDefined();
        expect(error.context.missing_messages).toHaveLength(2);
        expect(error.context.missing_messages[0].text).toBe('Message 1');
        expect(error.context.missing_messages[1].text).toBe('Message 2');
      }
    });

    it('should include cursor_advanced in sync error context', async () => {
      const sendTool = tools.get('swarmbbs.send_message')!;

      // Agent-b sends message
      const agentBConfig: ServerConfig = {
        ...config,
        handle: 'agent-b',
      };
      await sendTool.handler({ thread: 'coordination', text: 'Message 1' }, agentBConfig);

      // Agent-a has cursor at seq=0
      const cursor: Cursor = {
        last_seq: 0,
        epoch: 0,
        updated_ts: new Date().toISOString(),
      };
      await writeCursor(testRoot, 'test-space', 'agent-a', 'coordination', cursor);

      // Try to send
      try {
        await sendTool.handler({ thread: 'coordination', text: 'Agent A message' }, config);
        expect.fail('Should have thrown sync error');
      } catch (error: any) {
        expect(error.context.cursor_advanced).toBeDefined();
        expect(error.context.cursor_advanced.last_seq).toBe(1);
        expect(error.context.cursor_advanced.epoch).toBe(0);
      }
    });

    it('should advance cursor before throwing sync error', async () => {
      const sendTool = tools.get('swarmbbs.send_message')!;

      // Agent-b sends message
      const agentBConfig: ServerConfig = {
        ...config,
        handle: 'agent-b',
      };
      await sendTool.handler({ thread: 'coordination', text: 'Message 1' }, agentBConfig);

      // Agent-a has cursor at seq=0
      const cursor: Cursor = {
        last_seq: 0,
        epoch: 0,
        updated_ts: new Date().toISOString(),
      };
      await writeCursor(testRoot, 'test-space', 'agent-a', 'coordination', cursor);

      // Try to send
      try {
        await sendTool.handler({ thread: 'coordination', text: 'Agent A message' }, config);
        expect.fail('Should have thrown sync error');
      } catch (error: any) {
        // Error thrown
      }

      // Check that cursor was advanced
      const cursorAfter = await getCursor(testRoot, 'test-space', 'agent-a', 'coordination');
      expect(cursorAfter).not.toBeNull();
      expect(cursorAfter!.last_seq).toBe(1); // Advanced to current thread state
    });

    it('should allow send after cursor is advanced', async () => {
      const sendTool = tools.get('swarmbbs.send_message')!;

      // Agent-b sends message
      const agentBConfig: ServerConfig = {
        ...config,
        handle: 'agent-b',
      };
      await sendTool.handler({ thread: 'coordination', text: 'Message 1' }, agentBConfig);

      // Agent-a has cursor at seq=0
      const cursor: Cursor = {
        last_seq: 0,
        epoch: 0,
        updated_ts: new Date().toISOString(),
      };
      await writeCursor(testRoot, 'test-space', 'agent-a', 'coordination', cursor);

      // First send attempt - should fail and advance cursor
      try {
        await sendTool.handler({ thread: 'coordination', text: 'Agent A message' }, config);
        expect.fail('Should have thrown sync error');
      } catch (error: any) {
        expect(error.code).toBe(409);
      }

      // Second send attempt - should succeed (cursor now advanced)
      const result = await sendTool.handler({ thread: 'coordination', text: 'Agent A retry' }, config);

      expect((result as any).success).toBe(true);
      expect((result as any).seq).toBe(2);
      expect((result as any).text).toBe('Agent A retry');
    });

    it('should allow send when cursor is current', async () => {
      const sendTool = tools.get('swarmbbs.send_message')!;
      const pollTool = tools.get('swarmbbs.poll_messages')!;

      // Agent-b sends message
      const agentBConfig: ServerConfig = {
        ...config,
        handle: 'agent-b',
      };
      await sendTool.handler({ thread: 'coordination', text: 'Message 1' }, agentBConfig);

      // Agent-a polls to advance cursor
      await pollTool.handler({ threads: ['coordination'] }, config);

      // Check cursor is current
      const cursor = await getCursor(testRoot, 'test-space', 'agent-a', 'coordination');
      expect(cursor!.last_seq).toBe(1);

      // Agent-a sends - should succeed
      const result = await sendTool.handler({ thread: 'coordination', text: 'Agent A message' }, config);

      expect((result as any).success).toBe(true);
      expect((result as any).seq).toBe(2);
    });

    it('should handle multiple agents out of sync simultaneously', async () => {
      const sendTool = tools.get('swarmbbs.send_message')!;

      // Agent-b sends initial message
      const agentBConfig: ServerConfig = {
        ...config,
        handle: 'agent-b',
      };
      await sendTool.handler({ thread: 'coordination', text: 'Message 1' }, agentBConfig);

      // Agent-a and agent-c both have cursor at seq=0
      const cursor: Cursor = {
        last_seq: 0,
        epoch: 0,
        updated_ts: new Date().toISOString(),
      };
      await writeCursor(testRoot, 'test-space', 'agent-a', 'coordination', cursor);

      const agentCConfig: ServerConfig = {
        ...config,
        handle: 'agent-c',
      };
      await writeCursor(testRoot, 'test-space', 'agent-c', 'coordination', cursor);

      // Both try to send simultaneously
      const promises = [
        sendTool.handler({ thread: 'coordination', text: 'Agent A message' }, config),
        sendTool.handler({ thread: 'coordination', text: 'Agent C message' }, agentCConfig),
      ];

      // Both should fail with sync error
      const results = await Promise.allSettled(promises);

      expect(results[0].status).toBe('rejected');
      expect(results[1].status).toBe('rejected');

      if (results[0].status === 'rejected') {
        expect((results[0].reason as any).code).toBe(409);
      }
      if (results[1].status === 'rejected') {
        expect((results[1].reason as any).code).toBe(409);
      }

      // Both cursors should be advanced
      const cursorA = await getCursor(testRoot, 'test-space', 'agent-a', 'coordination');
      const cursorC = await getCursor(testRoot, 'test-space', 'agent-c', 'coordination');

      expect(cursorA!.last_seq).toBe(1);
      expect(cursorC!.last_seq).toBe(1);
    });

    it('should work for P2P threads (User Story 5)', async () => {
      const sendP2PTool = tools.get('swarmbbs.send_p2p')!;

      // Agent-b sends P2P message to agent-a
      const agentBConfig: ServerConfig = {
        ...config,
        handle: 'agent-b',
      };
      await sendP2PTool.handler({ peer_handle: 'agent-a', text: 'P2P Message 1' }, agentBConfig);

      // Agent-a has cursor at seq=0 for P2P thread
      const cursor: Cursor = {
        last_seq: 0,
        epoch: 0,
        updated_ts: new Date().toISOString(),
      };
      await writeCursor(testRoot, 'test-space', 'agent-a', 'p2p/agent-a__agent-b', cursor);

      // Agent-a tries to send P2P message - should fail
      try {
        await sendP2PTool.handler({ peer_handle: 'agent-b', text: 'Agent A P2P reply' }, config);
        expect.fail('Should have thrown sync error');
      } catch (error: any) {
        expect(error.code).toBe(409);
        expect(error.context.thread).toBe('p2p/agent-a__agent-b');
      }
    });

    it('should include correct error message text', async () => {
      const sendTool = tools.get('swarmbbs.send_message')!;

      // Agent-b sends message
      const agentBConfig: ServerConfig = {
        ...config,
        handle: 'agent-b',
      };
      await sendTool.handler({ thread: 'coordination', text: 'Message 1' }, agentBConfig);

      // Agent-a has cursor at seq=0
      const cursor: Cursor = {
        last_seq: 0,
        epoch: 0,
        updated_ts: new Date().toISOString(),
      };
      await writeCursor(testRoot, 'test-space', 'agent-a', 'coordination', cursor);

      // Try to send
      try {
        await sendTool.handler({ thread: 'coordination', text: 'Agent A message' }, config);
        expect.fail('Should have thrown sync error');
      } catch (error: any) {
        expect(error.message).toBe(
          'Cannot send: you have unread messages in this thread. Your cursor has been advanced. Please review the messages below and retry if still relevant.'
        );
      }
    });

    it('should include nextSteps in sync error', async () => {
      const sendTool = tools.get('swarmbbs.send_message')!;

      // Agent-b sends message
      const agentBConfig: ServerConfig = {
        ...config,
        handle: 'agent-b',
      };
      await sendTool.handler({ thread: 'coordination', text: 'Message 1' }, agentBConfig);

      // Agent-a has cursor at seq=0
      const cursor: Cursor = {
        last_seq: 0,
        epoch: 0,
        updated_ts: new Date().toISOString(),
      };
      await writeCursor(testRoot, 'test-space', 'agent-a', 'coordination', cursor);

      // Try to send
      try {
        await sendTool.handler({ thread: 'coordination', text: 'Agent A message' }, config);
        expect.fail('Should have thrown sync error');
      } catch (error: any) {
        expect(error.nextSteps).toBe(
          'Review the missing messages and retry your send operation if still appropriate given the new context.'
        );
      }
    });
  });

  describe('User Story 1 - Acceptance Scenarios', () => {
    it('Scenario 1: Reject send with 409, return missing messages, advance cursor', async () => {
      const sendTool = tools.get('swarmbbs.send_message')!;

      // Create thread with messages seq=1 and seq=2
      const agentBConfig: ServerConfig = {
        ...config,
        handle: 'agent-b',
      };
      await sendTool.handler({ thread: 'coordination', text: 'Message 1' }, agentBConfig);
      await sendTool.handler({ thread: 'coordination', text: 'Message 2' }, agentBConfig);

      // Agent-a has cursor at seq=1
      const cursor: Cursor = {
        last_seq: 1,
        epoch: 0,
        updated_ts: new Date().toISOString(),
      };
      await writeCursor(testRoot, 'test-space', 'agent-a', 'coordination', cursor);

      // Agent-a attempts to send
      try {
        await sendTool.handler({ thread: 'coordination', text: 'Agent A message' }, config);
        expect.fail('Should have thrown sync error');
      } catch (error: any) {
        // Check 409 error
        expect(error.code).toBe(409);

        // Check missing messages (seq=2)
        expect(error.context.missing_messages).toHaveLength(1);
        expect(error.context.missing_messages[0].seq).toBe(2);
        expect(error.context.missing_messages[0].text).toBe('Message 2');

        // Check cursor advanced to seq=2
        expect(error.context.cursor_advanced.last_seq).toBe(2);
      }

      // Verify cursor was persisted
      const cursorAfter = await getCursor(testRoot, 'test-space', 'agent-a', 'coordination');
      expect(cursorAfter!.last_seq).toBe(2);
    });

    it('Scenario 2: Agent retries after processing missing messages', async () => {
      const sendTool = tools.get('swarmbbs.send_message')!;

      // Agent-b sends message
      const agentBConfig: ServerConfig = {
        ...config,
        handle: 'agent-b',
      };
      await sendTool.handler({ thread: 'coordination', text: 'Message 1' }, agentBConfig);

      // Agent-a has cursor at seq=0
      const cursor: Cursor = {
        last_seq: 0,
        epoch: 0,
        updated_ts: new Date().toISOString(),
      };
      await writeCursor(testRoot, 'test-space', 'agent-a', 'coordination', cursor);

      // First attempt - fails with sync error
      let missingMessages: any[] = [];
      try {
        await sendTool.handler({ thread: 'coordination', text: 'Agent A message' }, config);
        expect.fail('Should have thrown sync error');
      } catch (error: any) {
        missingMessages = error.context.missing_messages;
        expect(missingMessages).toHaveLength(1);
      }

      // Agent processes missing messages (simulated)
      // In real scenario, agent would incorporate this into context

      // Retry send with updated context - should succeed
      const result = await sendTool.handler(
        { thread: 'coordination', text: 'Agent A message with updated context' },
        config
      );

      expect((result as any).success).toBe(true);
      expect((result as any).seq).toBe(2);
      expect((result as any).text).toBe('Agent A message with updated context');
    });

    it('Scenario 3: Send accepted immediately when cursor is current', async () => {
      const sendTool = tools.get('swarmbbs.send_message')!;
      const pollTool = tools.get('swarmbbs.poll_messages')!;

      // Agent-b sends message
      const agentBConfig: ServerConfig = {
        ...config,
        handle: 'agent-b',
      };
      await sendTool.handler({ thread: 'coordination', text: 'Message 1' }, agentBConfig);

      // Agent-a polls to get current
      await pollTool.handler({ threads: ['coordination'] }, config);

      // Verify cursor is at latest
      const cursor = await getCursor(testRoot, 'test-space', 'agent-a', 'coordination');
      expect(cursor!.last_seq).toBe(1);

      // Get thread metadata to confirm
      const threadMeta = await getThreadMetadata(testRoot, 'test-space', 'coordination');
      expect(threadMeta.current_seq).toBe(1);
      expect(cursor!.last_seq).toBe(threadMeta.current_seq);

      // Agent-a sends - should succeed immediately
      const result = await sendTool.handler(
        { thread: 'coordination', text: 'Agent A message' },
        config
      );

      expect((result as any).success).toBe(true);
      expect((result as any).seq).toBe(2);
    });
  });

  describe('User Story 5 - P2P Sync Validation', () => {
    describe('T038: P2P sync validation', () => {
      it('should reject P2P send when cursor is behind', async () => {
        const sendP2PTool = tools.get('swarmbbs.send_p2p')!;

        // Agent-b sends P2P message
        const agentBConfig: ServerConfig = {
          ...config,
          handle: 'agent-b',
        };
        await sendP2PTool.handler({ peer_handle: 'agent-a', text: 'P2P Message 1' }, agentBConfig);

        // Agent-a has cursor at seq=0
        const cursor: Cursor = {
          last_seq: 0,
          epoch: 0,
          updated_ts: new Date().toISOString(),
        };
        await writeCursor(testRoot, 'test-space', 'agent-a', 'p2p/agent-a__agent-b', cursor);

        // Agent-a tries to send - should fail with sync error
        await expect(
          sendP2PTool.handler({ peer_handle: 'agent-b', text: 'P2P Reply' }, config)
        ).rejects.toThrow();
      });

      it('should include 409 error code in P2P sync error', async () => {
        const sendP2PTool = tools.get('swarmbbs.send_p2p')!;

        // Agent-b sends P2P message
        const agentBConfig: ServerConfig = {
          ...config,
          handle: 'agent-b',
        };
        await sendP2PTool.handler({ peer_handle: 'agent-a', text: 'P2P Message 1' }, agentBConfig);

        // Agent-a has cursor at seq=0
        const cursor: Cursor = {
          last_seq: 0,
          epoch: 0,
          updated_ts: new Date().toISOString(),
        };
        await writeCursor(testRoot, 'test-space', 'agent-a', 'p2p/agent-a__agent-b', cursor);

        // Try to send
        try {
          await sendP2PTool.handler({ peer_handle: 'agent-b', text: 'P2P Reply' }, config);
          expect.fail('Should have thrown sync error');
        } catch (error: any) {
          expect(error.code).toBe(409);
          expect(error.name).toBe('SwarmBBSError');
        }
      });

      it('should include missing messages in P2P sync error', async () => {
        const sendP2PTool = tools.get('swarmbbs.send_p2p')!;

        // Agent-b sends P2P messages
        const agentBConfig: ServerConfig = {
          ...config,
          handle: 'agent-b',
        };
        await sendP2PTool.handler({ peer_handle: 'agent-a', text: 'P2P Message 1' }, agentBConfig);
        await sendP2PTool.handler({ peer_handle: 'agent-a', text: 'P2P Message 2' }, agentBConfig);

        // Agent-a has cursor at seq=0
        const cursor: Cursor = {
          last_seq: 0,
          epoch: 0,
          updated_ts: new Date().toISOString(),
        };
        await writeCursor(testRoot, 'test-space', 'agent-a', 'p2p/agent-a__agent-b', cursor);

        // Try to send
        try {
          await sendP2PTool.handler({ peer_handle: 'agent-b', text: 'P2P Reply' }, config);
          expect.fail('Should have thrown sync error');
        } catch (error: any) {
          expect(error.context).toBeDefined();
          expect(error.context.missing_messages).toBeDefined();
          expect(error.context.missing_messages).toHaveLength(2);
          expect(error.context.missing_messages[0].text).toBe('P2P Message 1');
          expect(error.context.missing_messages[1].text).toBe('P2P Message 2');
        }
      });

      it('should allow P2P send when cursor is current', async () => {
        const sendP2PTool = tools.get('swarmbbs.send_p2p')!;

        // Agent-b sends P2P message
        const agentBConfig: ServerConfig = {
          ...config,
          handle: 'agent-b',
        };
        await sendP2PTool.handler({ peer_handle: 'agent-a', text: 'P2P Message 1' }, agentBConfig);

        // Agent-a reads and advances cursor manually
        const cursor: Cursor = {
          last_seq: 1,
          epoch: 0,
          updated_ts: new Date().toISOString(),
        };
        await writeCursor(testRoot, 'test-space', 'agent-a', 'p2p/agent-a__agent-b', cursor);

        // Check cursor is current
        const cursorRead = await getCursor(testRoot, 'test-space', 'agent-a', 'p2p/agent-a__agent-b');
        expect(cursorRead!.last_seq).toBe(1);

        // Agent-a sends - should succeed
        const result = await sendP2PTool.handler({ peer_handle: 'agent-b', text: 'P2P Reply' }, config);

        expect((result as any).success).toBe(true);
        expect((result as any).seq).toBe(2);
      });
    });

    describe('T039: P2P cursor advancement', () => {
      it('should advance cursor before throwing P2P sync error', async () => {
        const sendP2PTool = tools.get('swarmbbs.send_p2p')!;

        // Agent-b sends P2P message
        const agentBConfig: ServerConfig = {
          ...config,
          handle: 'agent-b',
        };
        await sendP2PTool.handler({ peer_handle: 'agent-a', text: 'P2P Message 1' }, agentBConfig);

        // Agent-a has cursor at seq=0
        const cursor: Cursor = {
          last_seq: 0,
          epoch: 0,
          updated_ts: new Date().toISOString(),
        };
        await writeCursor(testRoot, 'test-space', 'agent-a', 'p2p/agent-a__agent-b', cursor);

        // Try to send
        try {
          await sendP2PTool.handler({ peer_handle: 'agent-b', text: 'P2P Reply' }, config);
          expect.fail('Should have thrown sync error');
        } catch (error: any) {
          // Error thrown
        }

        // Check that cursor was advanced
        const cursorAfter = await getCursor(testRoot, 'test-space', 'agent-a', 'p2p/agent-a__agent-b');
        expect(cursorAfter).not.toBeNull();
        expect(cursorAfter!.last_seq).toBe(1);
      });

      it('should allow P2P send after cursor is advanced', async () => {
        const sendP2PTool = tools.get('swarmbbs.send_p2p')!;

        // Agent-b sends P2P message
        const agentBConfig: ServerConfig = {
          ...config,
          handle: 'agent-b',
        };
        await sendP2PTool.handler({ peer_handle: 'agent-a', text: 'P2P Message 1' }, agentBConfig);

        // Agent-a has cursor at seq=0
        const cursor: Cursor = {
          last_seq: 0,
          epoch: 0,
          updated_ts: new Date().toISOString(),
        };
        await writeCursor(testRoot, 'test-space', 'agent-a', 'p2p/agent-a__agent-b', cursor);

        // First send - should fail and advance cursor
        try {
          await sendP2PTool.handler({ peer_handle: 'agent-b', text: 'P2P Reply' }, config);
          expect.fail('Should have thrown sync error');
        } catch (error: any) {
          expect(error.code).toBe(409);
        }

        // Second send - should succeed (cursor now advanced)
        const result = await sendP2PTool.handler({ peer_handle: 'agent-b', text: 'P2P Reply retry' }, config);

        expect((result as any).success).toBe(true);
        expect((result as any).seq).toBe(2);
        expect((result as any).text).toBe('P2P Reply retry');
      });

      it('should include cursor_advanced in P2P sync error context', async () => {
        const sendP2PTool = tools.get('swarmbbs.send_p2p')!;

        // Agent-b sends P2P message
        const agentBConfig: ServerConfig = {
          ...config,
          handle: 'agent-b',
        };
        await sendP2PTool.handler({ peer_handle: 'agent-a', text: 'P2P Message 1' }, agentBConfig);

        // Agent-a has cursor at seq=0
        const cursor: Cursor = {
          last_seq: 0,
          epoch: 0,
          updated_ts: new Date().toISOString(),
        };
        await writeCursor(testRoot, 'test-space', 'agent-a', 'p2p/agent-a__agent-b', cursor);

        // Try to send
        try {
          await sendP2PTool.handler({ peer_handle: 'agent-b', text: 'P2P Reply' }, config);
          expect.fail('Should have thrown sync error');
        } catch (error: any) {
          expect(error.context.cursor_advanced).toBeDefined();
          expect(error.context.cursor_advanced.last_seq).toBe(1);
          expect(error.context.cursor_advanced.epoch).toBe(0);
        }
      });
    });

    describe('T040: Regular vs P2P sync error format equivalence', () => {
      it('should return identical error format for regular and P2P threads', async () => {
        const sendTool = tools.get('swarmbbs.send_message')!;
        const sendP2PTool = tools.get('swarmbbs.send_p2p')!;

        // Setup: Create messages in both regular and P2P threads
        const agentBConfig: ServerConfig = {
          ...config,
          handle: 'agent-b',
        };

        // Regular thread
        await sendTool.handler({ thread: 'regular-thread', text: 'Regular Message 1' }, agentBConfig);

        // P2P thread
        await sendP2PTool.handler({ peer_handle: 'agent-a', text: 'P2P Message 1' }, agentBConfig);

        // Set agent-a's cursor to seq=0 for both threads
        const cursor: Cursor = {
          last_seq: 0,
          epoch: 0,
          updated_ts: new Date().toISOString(),
        };
        await writeCursor(testRoot, 'test-space', 'agent-a', 'regular-thread', cursor);
        await writeCursor(testRoot, 'test-space', 'agent-a', 'p2p/agent-a__agent-b', cursor);

        // Try to send to both threads and capture errors
        let regularError: any;
        let p2pError: any;

        try {
          await sendTool.handler({ thread: 'regular-thread', text: 'Agent A message' }, config);
        } catch (error) {
          regularError = error;
        }

        try {
          await sendP2PTool.handler({ peer_handle: 'agent-b', text: 'Agent A P2P message' }, config);
        } catch (error) {
          p2pError = error;
        }

        // Verify both errors exist
        expect(regularError).toBeDefined();
        expect(p2pError).toBeDefined();

        // Verify identical error structure
        expect(regularError.code).toBe(p2pError.code);
        expect(regularError.code).toBe(409);

        expect(regularError.name).toBe(p2pError.name);
        expect(regularError.name).toBe('SwarmBBSError');

        expect(regularError.message).toBe(p2pError.message);
        expect(regularError.message).toBe(
          'Cannot send: you have unread messages in this thread. Your cursor has been advanced. Please review the messages below and retry if still relevant.'
        );

        // Verify both have missing_messages
        expect(regularError.context.missing_messages).toHaveLength(1);
        expect(p2pError.context.missing_messages).toHaveLength(1);

        // Verify both have cursor_advanced
        expect(regularError.context.cursor_advanced).toBeDefined();
        expect(p2pError.context.cursor_advanced).toBeDefined();
        expect(regularError.context.cursor_advanced.last_seq).toBe(1);
        expect(p2pError.context.cursor_advanced.last_seq).toBe(1);

        // Verify both have nextSteps
        expect(regularError.nextSteps).toBe(p2pError.nextSteps);
        expect(regularError.nextSteps).toBe(
          'Review the missing messages and retry your send operation if still appropriate given the new context.'
        );
      });

      it('should handle P2P thread names correctly in cursor operations', async () => {
        const sendP2PTool = tools.get('swarmbbs.send_p2p')!;

        // Agent-b sends to agent-a
        const agentBConfig: ServerConfig = {
          ...config,
          handle: 'agent-b',
        };
        await sendP2PTool.handler({ peer_handle: 'agent-a', text: 'Message from B to A' }, agentBConfig);

        // Agent-a sends to agent-b
        await sendP2PTool.handler({ peer_handle: 'agent-b', text: 'Message from A to B' }, config);

        // Verify both messages are in the same canonical thread
        const threadMeta = await getThreadMetadata(testRoot, 'test-space', 'p2p/agent-a__agent-b');
        expect(threadMeta.current_seq).toBe(2);

        // Verify cursor paths work correctly
        const cursorA = await getCursor(testRoot, 'test-space', 'agent-a', 'p2p/agent-a__agent-b');
        expect(cursorA).toBeDefined();
      });

      it('should validate sync for both agents in P2P thread independently', async () => {
        const sendP2PTool = tools.get('swarmbbs.send_p2p')!;

        // Agent-a sends P2P message
        await sendP2PTool.handler({ peer_handle: 'agent-b', text: 'Message 1 from A' }, config);

        // Agent-b sends P2P message
        const agentBConfig: ServerConfig = {
          ...config,
          handle: 'agent-b',
        };
        await sendP2PTool.handler({ peer_handle: 'agent-a', text: 'Message 2 from B' }, agentBConfig);

        // Both agents now have cursors behind (agent-a at seq=1, agent-b at seq=1)
        // Both try to send simultaneously
        const cursorA: Cursor = {
          last_seq: 1,
          epoch: 0,
          updated_ts: new Date().toISOString(),
        };
        await writeCursor(testRoot, 'test-space', 'agent-a', 'p2p/agent-a__agent-b', cursorA);

        const cursorB: Cursor = {
          last_seq: 1,
          epoch: 0,
          updated_ts: new Date().toISOString(),
        };
        await writeCursor(testRoot, 'test-space', 'agent-b', 'p2p/agent-a__agent-b', cursorB);

        // Both should get sync errors
        const promises = [
          sendP2PTool.handler({ peer_handle: 'agent-b', text: 'Message from A' }, config),
          sendP2PTool.handler({ peer_handle: 'agent-a', text: 'Message from B' }, agentBConfig),
        ];

        const results = await Promise.allSettled(promises);

        expect(results[0].status).toBe('rejected');
        expect(results[1].status).toBe('rejected');

        if (results[0].status === 'rejected') {
          expect((results[0].reason as any).code).toBe(409);
        }
        if (results[1].status === 'rejected') {
          expect((results[1].reason as any).code).toBe(409);
        }
      });
    });
  });
});
