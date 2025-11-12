/**
 * Contract Tests for Lifecycle Management Tools
 *
 * Tests list_spaces, list_threads, archive_space, and clear_space
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  listSpaces,
  listThreads,
  archiveSpace,
  clearSpace,
  type ListSpacesInput,
  type ListThreadsInput,
  type ArchiveSpaceInput,
  type ClearSpaceInput,
} from '../../src/tools/lifecycle.js';
import { appendMessage, clearThreadMetadataCache } from '../../src/storage/thread-ops.js';

describe('Lifecycle Tools - Contract Tests', () => {
  let testRoot: string;

  beforeEach(async () => {
    // Create temporary test directory
    testRoot = await mkdtemp(join(tmpdir(), 'swarmbbs-lifecycle-test-'));
  });

  afterEach(async () => {
    // Clear thread metadata cache
    clearThreadMetadataCache();

    // Cleanup test directory
    await rm(testRoot, { recursive: true, force: true });
  });

  describe('list_spaces', () => {
    it('should return empty list when no spaces exist', async () => {
      const result = await listSpaces(testRoot, {});

      expect(result).toMatchObject({
        success: true,
        spaces: [],
      });
    });

    it('should list available spaces with metadata', async () => {
      // Create test spaces with threads
      await appendMessage(testRoot, 'space-a', 'thread-1', 'agent-1', 'Message 1');
      await appendMessage(testRoot, 'space-a', 'thread-2', 'agent-1', 'Message 2');
      await appendMessage(testRoot, 'space-b', 'thread-1', 'agent-1', 'Message 3');

      const result = await listSpaces(testRoot, {});

      expect(result.success).toBe(true);
      expect(result.spaces).toHaveLength(2);

      const spaceNames = result.spaces.map((s) => s.name).sort();
      expect(spaceNames).toEqual(['space-a', 'space-b']);

      // Verify space-a has 2 threads
      const spaceA = result.spaces.find((s) => s.name === 'space-a');
      expect(spaceA).toBeDefined();
      expect(spaceA!.thread_count).toBe(2);
      expect(spaceA!.size_bytes).toBeGreaterThan(0);
      expect(spaceA!.last_modified).toBeDefined();

      // Verify space-b has 1 thread
      const spaceB = result.spaces.find((s) => s.name === 'space-b');
      expect(spaceB).toBeDefined();
      expect(spaceB!.thread_count).toBe(1);
      expect(spaceB!.size_bytes).toBeGreaterThan(0);
    });

    it('should include P2P threads in space thread count', async () => {
      // Create regular thread
      await appendMessage(testRoot, 'test-space', 'regular', 'agent-1', 'Regular message');

      // Create P2P thread
      await appendMessage(testRoot, 'test-space', 'p2p/agent-a__agent-b', 'agent-a', 'P2P message');

      const result = await listSpaces(testRoot, {});

      expect(result.success).toBe(true);
      expect(result.spaces).toHaveLength(1);
      expect(result.spaces[0].thread_count).toBe(2); // 1 regular + 1 P2P
    });

    it('should list archived spaces when include_archived is true', async () => {
      // Create and archive a space
      await appendMessage(testRoot, 'old-space', 'thread-1', 'agent-1', 'Message 1');
      await archiveSpace(testRoot, { space: 'old-space' });

      // Create an active space
      await appendMessage(testRoot, 'active-space', 'thread-1', 'agent-1', 'Message 2');

      const result = await listSpaces(testRoot, { include_archived: true });

      expect(result.success).toBe(true);
      expect(result.spaces).toHaveLength(1);
      expect(result.spaces[0].name).toBe('active-space');

      expect(result.archived_spaces).toBeDefined();
      expect(result.archived_spaces).toHaveLength(1);
      expect(result.archived_spaces![0].name).toBe('old-space');
      expect(result.archived_spaces![0].archive_path).toContain('archives/old-space-');
      expect(result.archived_spaces![0].archived_at).toBeDefined();
      expect(result.archived_spaces![0].size_bytes).toBeGreaterThan(0);
    });

    it('should not include archived_spaces when include_archived is false', async () => {
      // Create and archive a space
      await appendMessage(testRoot, 'archived', 'thread-1', 'agent-1', 'Message');
      await archiveSpace(testRoot, { space: 'archived' });

      const result = await listSpaces(testRoot, { include_archived: false });

      expect(result.success).toBe(true);
      expect(result.archived_spaces).toBeUndefined();
    });
  });

  describe('list_threads', () => {
    it('should return empty list when space has no threads', async () => {
      // Create space directory but no threads
      const spacePath = join(testRoot, 'spaces', 'empty-space', 'threads');
      await mkdir(spacePath, { recursive: true });

      const result = await listThreads(testRoot, 'empty-space', {});

      expect(result).toMatchObject({
        success: true,
        space: 'empty-space',
        threads: [],
      });
    });

    it('should list threads in a space with metadata', async () => {
      // Create threads with messages
      await appendMessage(testRoot, 'project-x', 'coordination', 'agent-1', 'Message 1');
      await appendMessage(testRoot, 'project-x', 'coordination', 'agent-1', 'Message 2');
      await appendMessage(testRoot, 'project-x', 'alerts', 'agent-2', 'Alert 1');

      const result = await listThreads(testRoot, 'project-x', {});

      expect(result.success).toBe(true);
      expect(result.space).toBe('project-x');
      expect(result.threads).toHaveLength(2);

      const threadNames = result.threads.map((t) => t.name).sort();
      expect(threadNames).toEqual(['alerts', 'coordination']);

      // Verify coordination thread
      const coordination = result.threads.find((t) => t.name === 'coordination');
      expect(coordination).toBeDefined();
      expect(coordination!.message_count).toBe(2);
      expect(coordination!.size_bytes).toBeGreaterThan(0);
      expect(coordination!.epoch).toBe(0);
      expect(coordination!.min_available_seq).toBe(0);
      expect(coordination!.is_p2p).toBe(false);
      expect(coordination!.last_message_ts).toBeDefined();

      // Verify alerts thread
      const alerts = result.threads.find((t) => t.name === 'alerts');
      expect(alerts).toBeDefined();
      expect(alerts!.message_count).toBe(1);
      expect(alerts!.is_p2p).toBe(false);
    });

    it('should exclude P2P threads by default', async () => {
      // Create regular thread
      await appendMessage(testRoot, 'test-space', 'regular', 'agent-1', 'Regular message');

      // Create P2P thread
      await appendMessage(testRoot, 'test-space', 'p2p/agent-a__agent-b', 'agent-a', 'P2P message');

      const result = await listThreads(testRoot, 'test-space', { include_p2p: false });

      expect(result.success).toBe(true);
      expect(result.threads).toHaveLength(1);
      expect(result.threads[0].name).toBe('regular');
      expect(result.threads[0].is_p2p).toBe(false);
    });

    it('should include P2P threads when include_p2p is true', async () => {
      // Create regular thread
      await appendMessage(testRoot, 'test-space', 'regular', 'agent-1', 'Regular message');

      // Create P2P threads
      await appendMessage(testRoot, 'test-space', 'p2p/agent-a__agent-b', 'agent-a', 'P2P message 1');
      await appendMessage(testRoot, 'test-space', 'p2p/agent-x__agent-y', 'agent-x', 'P2P message 2');

      const result = await listThreads(testRoot, 'test-space', { include_p2p: true });

      expect(result.success).toBe(true);
      expect(result.threads).toHaveLength(3);

      // Verify regular thread
      const regular = result.threads.find((t) => t.name === 'regular');
      expect(regular).toBeDefined();
      expect(regular!.is_p2p).toBe(false);
      expect(regular!.participants).toBeUndefined();

      // Verify P2P threads
      const p2p1 = result.threads.find((t) => t.name === 'p2p/agent-a__agent-b');
      expect(p2p1).toBeDefined();
      expect(p2p1!.is_p2p).toBe(true);
      expect(p2p1!.participants).toEqual(['agent-a', 'agent-b']);

      const p2p2 = result.threads.find((t) => t.name === 'p2p/agent-x__agent-y');
      expect(p2p2).toBeDefined();
      expect(p2p2!.is_p2p).toBe(true);
      expect(p2p2!.participants).toEqual(['agent-x', 'agent-y']);
    });

    it('should throw error when space does not exist', async () => {
      await expect(listThreads(testRoot, 'nonexistent-space', {})).rejects.toThrow(
        "Space 'nonexistent-space' not found"
      );
    });

    it('should use default space from config', async () => {
      // Create thread in default space
      await appendMessage(testRoot, 'default-space', 'thread-1', 'agent-1', 'Message');

      const result = await listThreads(testRoot, 'default-space', {});

      expect(result.success).toBe(true);
      expect(result.space).toBe('default-space');
      expect(result.threads).toHaveLength(1);
    });
  });

  describe('archive_space', () => {
    it('should archive a space successfully', async () => {
      // Create space with threads
      await appendMessage(testRoot, 'completed-project', 'thread-1', 'agent-1', 'Message 1');
      await appendMessage(testRoot, 'completed-project', 'thread-2', 'agent-1', 'Message 2');

      const result = await archiveSpace(testRoot, { space: 'completed-project' });

      expect(result.success).toBe(true);
      expect(result.space).toBe('completed-project');
      expect(result.archive_path).toContain('archives/completed-project-');
      expect(result.archived_at).toBeDefined();
      expect(result.threads_archived).toBe(2);
      expect(result.size_bytes).toBeGreaterThan(0);

      // Verify space no longer exists in active spaces
      const listResult = await listSpaces(testRoot, {});
      expect(listResult.spaces.find((s) => s.name === 'completed-project')).toBeUndefined();

      // Verify space exists in archives
      const listWithArchives = await listSpaces(testRoot, { include_archived: true });
      expect(listWithArchives.archived_spaces).toBeDefined();
      expect(
        listWithArchives.archived_spaces!.find((s) => s.name === 'completed-project')
      ).toBeDefined();
    });

    it('should archive space with P2P threads', async () => {
      // Create regular and P2P threads
      await appendMessage(testRoot, 'test-space', 'regular', 'agent-1', 'Message 1');
      await appendMessage(testRoot, 'test-space', 'p2p/agent-a__agent-b', 'agent-a', 'P2P message');

      const result = await archiveSpace(testRoot, { space: 'test-space' });

      expect(result.success).toBe(true);
      expect(result.threads_archived).toBe(2); // Regular + P2P
    });

    it('should throw error when space does not exist', async () => {
      await expect(archiveSpace(testRoot, { space: 'nonexistent' })).rejects.toThrow(
        "Space 'nonexistent' not found"
      );
    });

    it('should reject invalid space name', async () => {
      await expect(archiveSpace(testRoot, { space: '../etc/passwd' })).rejects.toThrow();
    });

    it('should create timestamped archive directory', async () => {
      await appendMessage(testRoot, 'test-space', 'thread-1', 'agent-1', 'Message');

      const result = await archiveSpace(testRoot, { space: 'test-space' });

      // Verify archive path matches expected pattern
      expect(result.archive_path).toMatch(/archives\/test-space-\d{8}-\d{6}$/);
    });
  });

  describe('clear_space', () => {
    it('should clear a space with confirmation', async () => {
      // Create space with threads
      await appendMessage(testRoot, 'old-project', 'thread-1', 'agent-1', 'Message 1');
      await appendMessage(testRoot, 'old-project', 'thread-2', 'agent-1', 'Message 2');

      const result = await clearSpace(testRoot, { space: 'old-project', confirm: true });

      expect(result.success).toBe(true);
      expect(result.space).toBe('old-project');
      expect(result.deleted_threads).toBe(2);
      expect(result.deleted_bytes).toBeGreaterThan(0);
      expect(result.ts).toBeDefined();

      // Verify space no longer exists
      const listResult = await listSpaces(testRoot, {});
      expect(listResult.spaces.find((s) => s.name === 'old-project')).toBeUndefined();
    });

    it('should reject deletion without confirmation', async () => {
      await appendMessage(testRoot, 'test-space', 'thread-1', 'agent-1', 'Message');

      await expect(clearSpace(testRoot, { space: 'test-space', confirm: false })).rejects.toThrow(
        'Must provide confirm: true'
      );

      // Verify space still exists
      const listResult = await listSpaces(testRoot, {});
      expect(listResult.spaces.find((s) => s.name === 'test-space')).toBeDefined();
    });

    it('should reject deletion without confirm parameter', async () => {
      await appendMessage(testRoot, 'test-space', 'thread-1', 'agent-1', 'Message');

      await expect(
        clearSpace(testRoot, { space: 'test-space', confirm: undefined as any })
      ).rejects.toThrow('Must provide confirm: true');
    });

    it('should throw error when space does not exist', async () => {
      await expect(clearSpace(testRoot, { space: 'nonexistent', confirm: true })).rejects.toThrow(
        "Space 'nonexistent' not found"
      );
    });

    it('should delete space with P2P threads', async () => {
      // Create regular and P2P threads
      await appendMessage(testRoot, 'test-space', 'regular', 'agent-1', 'Message 1');
      await appendMessage(testRoot, 'test-space', 'p2p/agent-a__agent-b', 'agent-a', 'P2P message');

      const result = await clearSpace(testRoot, { space: 'test-space', confirm: true });

      expect(result.success).toBe(true);
      expect(result.deleted_threads).toBe(2); // Regular + P2P
    });

    it('should reject invalid space name', async () => {
      await expect(clearSpace(testRoot, { space: '../etc/passwd', confirm: true })).rejects.toThrow();
    });

    it('should provide destructive operation warning in error', async () => {
      await appendMessage(testRoot, 'test-space', 'thread-1', 'agent-1', 'Message');

      try {
        await clearSpace(testRoot, { space: 'test-space', confirm: false });
        expect.fail('Should have thrown error');
      } catch (err: any) {
        expect(err.message).toContain('confirm: true');
        expect(err.nextSteps).toContain('archive_space');
      }
    });

    it('should calculate total deleted bytes correctly', async () => {
      // Create multiple messages to ensure measurable size
      await appendMessage(testRoot, 'test-space', 'thread-1', 'agent-1', 'x'.repeat(100));
      await appendMessage(testRoot, 'test-space', 'thread-1', 'agent-1', 'x'.repeat(100));
      await appendMessage(testRoot, 'test-space', 'thread-2', 'agent-1', 'x'.repeat(100));

      const result = await clearSpace(testRoot, { space: 'test-space', confirm: true });

      expect(result.deleted_bytes).toBeGreaterThan(300); // At least 3 * 100 bytes
    });

    it('should be idempotent for already-deleted space', async () => {
      await appendMessage(testRoot, 'test-space', 'thread-1', 'agent-1', 'Message');

      // First deletion
      await clearSpace(testRoot, { space: 'test-space', confirm: true });

      // Second deletion should fail with not found
      await expect(clearSpace(testRoot, { space: 'test-space', confirm: true })).rejects.toThrow(
        "Space 'test-space' not found"
      );
    });
  });

  describe('Integration - Lifecycle workflow', () => {
    it('should support full lifecycle: create -> list -> archive -> verify', async () => {
      // Create spaces with threads
      await appendMessage(testRoot, 'active-1', 'thread-1', 'agent-1', 'Message 1');
      await appendMessage(testRoot, 'active-2', 'thread-1', 'agent-1', 'Message 2');
      await appendMessage(testRoot, 'to-archive', 'thread-1', 'agent-1', 'Message 3');

      // List active spaces
      const list1 = await listSpaces(testRoot, {});
      expect(list1.spaces).toHaveLength(3);

      // Archive one space
      await archiveSpace(testRoot, { space: 'to-archive' });

      // List active spaces again
      const list2 = await listSpaces(testRoot, {});
      expect(list2.spaces).toHaveLength(2);
      expect(list2.spaces.find((s) => s.name === 'to-archive')).toBeUndefined();

      // List with archived
      const list3 = await listSpaces(testRoot, { include_archived: true });
      expect(list3.spaces).toHaveLength(2);
      expect(list3.archived_spaces).toHaveLength(1);
      expect(list3.archived_spaces![0].name).toBe('to-archive');
    });

    it('should support full lifecycle: create -> list -> clear -> verify', async () => {
      // Create spaces
      await appendMessage(testRoot, 'active', 'thread-1', 'agent-1', 'Message 1');
      await appendMessage(testRoot, 'to-delete', 'thread-1', 'agent-1', 'Message 2');

      // List threads before deletion
      const threads1 = await listThreads(testRoot, 'to-delete', {});
      expect(threads1.threads).toHaveLength(1);

      // Clear space
      await clearSpace(testRoot, { space: 'to-delete', confirm: true });

      // Verify space is gone
      await expect(listThreads(testRoot, 'to-delete', {})).rejects.toThrow('not found');

      // Verify other space is unaffected
      const threads2 = await listThreads(testRoot, 'active', {});
      expect(threads2.threads).toHaveLength(1);
    });

    it('should list threads immediately after space creation', async () => {
      // Create first thread (creates space)
      await appendMessage(testRoot, 'new-space', 'thread-1', 'agent-1', 'Message 1');

      // List threads immediately
      const result1 = await listThreads(testRoot, 'new-space', {});
      expect(result1.threads).toHaveLength(1);

      // Add another thread
      await appendMessage(testRoot, 'new-space', 'thread-2', 'agent-1', 'Message 2');

      // List threads again
      const result2 = await listThreads(testRoot, 'new-space', {});
      expect(result2.threads).toHaveLength(2);
    });
  });
});
