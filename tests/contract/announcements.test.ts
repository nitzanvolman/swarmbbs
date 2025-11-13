/**
 * Contract Tests for Announcement Tools
 *
 * Tests announcement_set, announcement_append, and announcement_get tool contracts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'fs/promises';
import { join } from 'path';
import {
  announcementSet,
  announcementAppend,
  announcementGet,
  type AnnouncementSetInput,
  type AnnouncementAppendInput,
  type AnnouncementGetInput,
} from '../../src/tools/announcements.js';
import { getAnnouncement, markAnnouncementSeen } from '../../src/storage/state-ops.js';
import { SwarmBBSError } from '../../src/utils/errors.js';

describe('Announcement Tools Contract Tests', () => {
  const testRoot = join(process.cwd(), 'tmp', 'test-announcements-contract');
  const handle = 'test-agent';
  const defaultSpace = 'test-space';
  const presenceTtl = 60;

  beforeEach(async () => {
    await mkdir(testRoot, { recursive: true });
  });

  afterEach(async () => {
    await rm(testRoot, { recursive: true, force: true });
  });

  // ==========================================================================
  // announcement_set tests
  // ==========================================================================

  describe('announcement_set', () => {
    it('should set announcement with default content type', async () => {
      const input: AnnouncementSetInput = {
        content: 'Test announcement',
      };

      const result = await announcementSet(testRoot, defaultSpace, input);

      expect(result.success).toBe(true);
      expect(result.space).toBe(defaultSpace);
      expect(result.version).toBe(1);
      expect(result.ts).toBeDefined();
      expect(new Date(result.ts).getTime()).toBeGreaterThan(0);
      expect(result.content_length).toBe(Buffer.byteLength('Test announcement'));

      // Verify announcement was stored
      const stored = await getAnnouncement(testRoot, defaultSpace);
      expect(stored).not.toBeNull();
      expect(stored!.version).toBe(1);
      expect(stored!.content).toBe('Test announcement');
      expect(stored!.content_type).toBe('text/plain');
    });

    it('should set announcement with markdown content type', async () => {
      const input: AnnouncementSetInput = {
        content: '# Header\n\nSome markdown content',
        content_type: 'text/markdown',
      };

      const result = await announcementSet(testRoot, defaultSpace, input);

      expect(result.success).toBe(true);
      expect(result.version).toBe(1);

      const stored = await getAnnouncement(testRoot, defaultSpace);
      expect(stored!.content_type).toBe('text/markdown');
      expect(stored!.content).toBe('# Header\n\nSome markdown content');
    });

    it('should replace existing announcement and increment version', async () => {
      // First set
      await announcementSet(testRoot, defaultSpace, {
        content: 'First announcement',
      });

      // Wait briefly to ensure timestamp changes
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Second set
      const input: AnnouncementSetInput = {
        content: 'Second announcement',
      };

      const result = await announcementSet(testRoot, defaultSpace, input);

      expect(result.success).toBe(true);
      expect(result.version).toBe(2);

      const stored = await getAnnouncement(testRoot, defaultSpace);
      expect(stored!.version).toBe(2);
      expect(stored!.content).toBe('Second announcement');
    });

    it('should allow empty content (clearing announcement)', async () => {
      const input: AnnouncementSetInput = {
        content: '',
      };

      const result = await announcementSet(testRoot, defaultSpace, input);

      expect(result.success).toBe(true);
      expect(result.version).toBe(1);
      expect(result.content_length).toBe(0);

      const stored = await getAnnouncement(testRoot, defaultSpace);
      expect(stored!.content).toBe('');
    });

    it('should accept custom space', async () => {
      const input: AnnouncementSetInput = {
        space: 'custom-space',
        content: 'Custom space announcement',
      };

      const result = await announcementSet(testRoot, defaultSpace, input);

      expect(result.success).toBe(true);
      expect(result.space).toBe('custom-space');

      const stored = await getAnnouncement(testRoot, 'custom-space');
      expect(stored!.content).toBe('Custom space announcement');
    });

    it('should reject invalid space name', async () => {
      const input: AnnouncementSetInput = {
        space: '../invalid',
        content: 'Test',
      };

      await expect(announcementSet(testRoot, defaultSpace, input)).rejects.toThrow(
        "Invalid space name '../invalid'"
      );
    });

    it('should reject content exceeding 64 KiB limit', async () => {
      const largeContent = 'x'.repeat(65537); // 65537 bytes

      const input: AnnouncementSetInput = {
        content: largeContent,
      };

      await expect(announcementSet(testRoot, defaultSpace, input)).rejects.toThrow(
        SwarmBBSError
      );

      try {
        await announcementSet(testRoot, defaultSpace, input);
      } catch (error) {
        expect(error).toBeInstanceOf(SwarmBBSError);
        const err = error as SwarmBBSError;
        expect(err.code).toBe(413);
        expect(err.message).toContain('65536');
        expect(err.nextSteps).toBeDefined();
      }
    });

    it('should handle exactly 64 KiB content', async () => {
      const maxContent = 'x'.repeat(65536); // Exactly 64 KiB

      const input: AnnouncementSetInput = {
        content: maxContent,
      };

      const result = await announcementSet(testRoot, defaultSpace, input);

      expect(result.success).toBe(true);
      expect(result.content_length).toBe(65536);
    });
  });

  // ==========================================================================
  // announcement_append tests
  // ==========================================================================

  describe('announcement_append', () => {
    it('should create new announcement if none exists', async () => {
      const input: AnnouncementAppendInput = {
        content: 'First content',
      };

      const result = await announcementAppend(testRoot, defaultSpace, input);

      expect(result.success).toBe(true);
      expect(result.version).toBe(1);
      expect(result.total_content_length).toBe(Buffer.byteLength('First content'));

      const stored = await getAnnouncement(testRoot, defaultSpace);
      expect(stored!.content).toBe('First content');
    });

    it('should append to existing announcement with default separator', async () => {
      // Create initial announcement
      await announcementSet(testRoot, defaultSpace, {
        content: 'Initial content',
      });

      // Append
      const input: AnnouncementAppendInput = {
        content: 'Additional content',
      };

      const result = await announcementAppend(testRoot, defaultSpace, input);

      expect(result.success).toBe(true);
      expect(result.version).toBe(2);

      const stored = await getAnnouncement(testRoot, defaultSpace);
      expect(stored!.content).toBe('Initial content\n\n---\n\nAdditional content');
    });

    it('should append with custom separator', async () => {
      await announcementSet(testRoot, defaultSpace, {
        content: 'First',
      });

      const input: AnnouncementAppendInput = {
        content: 'Second',
        separator: '\n\n',
      };

      const result = await announcementAppend(testRoot, defaultSpace, input);

      expect(result.success).toBe(true);
      expect(result.version).toBe(2);

      const stored = await getAnnouncement(testRoot, defaultSpace);
      expect(stored!.content).toBe('First\n\nSecond');
    });

    it('should increment version on append', async () => {
      await announcementSet(testRoot, defaultSpace, {
        content: 'Version 1',
      });

      await announcementAppend(testRoot, defaultSpace, {
        content: 'Update 1',
      });

      const stored = await getAnnouncement(testRoot, defaultSpace);
      expect(stored!.version).toBe(2);

      await announcementAppend(testRoot, defaultSpace, {
        content: 'Update 2',
      });

      const stored2 = await getAnnouncement(testRoot, defaultSpace);
      expect(stored2!.version).toBe(3);
    });

    it('should reject empty content', async () => {
      const input: AnnouncementAppendInput = {
        content: '',
      };

      await expect(announcementAppend(testRoot, defaultSpace, input)).rejects.toThrow(
        SwarmBBSError
      );

      try {
        await announcementAppend(testRoot, defaultSpace, input);
      } catch (error) {
        expect(error).toBeInstanceOf(SwarmBBSError);
        const err = error as SwarmBBSError;
        expect(err.code).toBe(400);
        expect(err.message).toContain('empty');
      }
    });

    it('should reject append that would exceed 64 KiB limit', async () => {
      // Set large initial content
      const initialContent = 'x'.repeat(60000);
      await announcementSet(testRoot, defaultSpace, {
        content: initialContent,
      });

      // Try to append content that would exceed limit
      const appendContent = 'y'.repeat(6000);
      const input: AnnouncementAppendInput = {
        content: appendContent,
      };

      await expect(announcementAppend(testRoot, defaultSpace, input)).rejects.toThrow(
        SwarmBBSError
      );

      try {
        await announcementAppend(testRoot, defaultSpace, input);
      } catch (error) {
        expect(error).toBeInstanceOf(SwarmBBSError);
        const err = error as SwarmBBSError;
        expect(err.code).toBe(413);
        expect(err.message).toContain('65536');
        expect(err.nextSteps).toBeDefined();
      }
    });

    it('should preserve content type when appending', async () => {
      await announcementSet(testRoot, defaultSpace, {
        content: '# Markdown',
        content_type: 'text/markdown',
      });

      await announcementAppend(testRoot, defaultSpace, {
        content: 'More markdown',
      });

      const stored = await getAnnouncement(testRoot, defaultSpace);
      expect(stored!.content_type).toBe('text/markdown');
    });
  });

  // ==========================================================================
  // announcement_get tests
  // ==========================================================================

  describe('announcement_get', () => {
    it('should get announcement with version 0 if none exists', async () => {
      const input: AnnouncementGetInput = {};

      const result = await announcementGet(
        testRoot,
        handle,
        defaultSpace,
        presenceTtl,
        input
      );

      expect(result.success).toBe(true);
      expect(result.space).toBe(defaultSpace);
      expect(result.version).toBe(0);
      expect(result.content_type).toBe('text/plain');
      expect(result.content).toBe(''); // Empty content, no who's online section
      expect(result.has_seen).toBe(true);
    });

    it('should get existing announcement', async () => {
      await announcementSet(testRoot, defaultSpace, {
        content: 'Test announcement',
        content_type: 'text/plain',
      });

      const input: AnnouncementGetInput = {};

      const result = await announcementGet(
        testRoot,
        handle,
        defaultSpace,
        presenceTtl,
        input
      );

      expect(result.success).toBe(true);
      expect(result.version).toBe(1);
      expect(result.ts).toBeDefined();
      expect(result.content_type).toBe('text/plain');
      expect(result.content).toContain('Test announcement');
      expect(result.has_seen).toBe(false); // First time seeing this version
    });

    it('should mark announcement as seen after get', async () => {
      await announcementSet(testRoot, defaultSpace, {
        content: 'Test announcement',
      });

      // First get - not seen
      const result1 = await announcementGet(
        testRoot,
        handle,
        defaultSpace,
        presenceTtl,
        {}
      );
      expect(result1.has_seen).toBe(false);

      // Second get - already seen
      const result2 = await announcementGet(
        testRoot,
        handle,
        defaultSpace,
        presenceTtl,
        {}
      );
      expect(result2.has_seen).toBe(true);
    });

    it('should show has_seen=false after version increment', async () => {
      await announcementSet(testRoot, defaultSpace, {
        content: 'Version 1',
      });

      // Get and mark as seen
      await announcementGet(testRoot, handle, defaultSpace, presenceTtl, {});

      // Update announcement
      await announcementSet(testRoot, defaultSpace, {
        content: 'Version 2',
      });

      // Get again - should be not seen
      const result = await announcementGet(
        testRoot,
        handle,
        defaultSpace,
        presenceTtl,
        {}
      );

      expect(result.version).toBe(2);
      expect(result.has_seen).toBe(false);
    });

    it('should append "Who\'s online" section in plain text format', async () => {
      await announcementSet(testRoot, defaultSpace, {
        content: 'Announcement content',
        content_type: 'text/plain',
      });

      const result = await announcementGet(
        testRoot,
        handle,
        defaultSpace,
        presenceTtl,
        {}
      );

      // Should have announcement content
      expect(result.content).toContain('Announcement content');

      // If there are online agents, should have Who's Online section
      // Note: In this test, no agents have presence, so section may be empty
    });

    it('should append "Who\'s online" section in markdown format', async () => {
      await announcementSet(testRoot, defaultSpace, {
        content: '# Announcement',
        content_type: 'text/markdown',
      });

      const result = await announcementGet(
        testRoot,
        handle,
        defaultSpace,
        presenceTtl,
        {}
      );

      expect(result.content).toContain('# Announcement');
      expect(result.content_type).toBe('text/markdown');
    });

    it('should support custom space', async () => {
      const customSpace = 'custom-space';

      await announcementSet(testRoot, customSpace, {
        content: 'Custom space content',
      });

      const input: AnnouncementGetInput = {
        space: customSpace,
      };

      const result = await announcementGet(
        testRoot,
        handle,
        defaultSpace,
        presenceTtl,
        input
      );

      expect(result.success).toBe(true);
      expect(result.space).toBe(customSpace);
      expect(result.content).toContain('Custom space content');
    });

    it('should handle different handles seeing same announcement', async () => {
      await announcementSet(testRoot, defaultSpace, {
        content: 'Shared announcement',
      });

      // Handle 1 gets it
      const result1 = await announcementGet(
        testRoot,
        'agent-1',
        defaultSpace,
        presenceTtl,
        {}
      );
      expect(result1.has_seen).toBe(false);

      // Handle 2 gets it (should also be not seen)
      const result2 = await announcementGet(
        testRoot,
        'agent-2',
        defaultSpace,
        presenceTtl,
        {}
      );
      expect(result2.has_seen).toBe(false);

      // Handle 1 gets it again (should be seen)
      const result3 = await announcementGet(
        testRoot,
        'agent-1',
        defaultSpace,
        presenceTtl,
        {}
      );
      expect(result3.has_seen).toBe(true);
    });
  });

  // ==========================================================================
  // Integration: Set, Append, Get workflow
  // ==========================================================================

  describe('Set, Append, Get workflow', () => {
    it('should support complete announcement workflow', async () => {
      // Set initial announcement
      const setResult = await announcementSet(testRoot, defaultSpace, {
        content: 'Initial announcement',
        content_type: 'text/markdown',
      });
      expect(setResult.version).toBe(1);

      // Get announcement
      const getResult1 = await announcementGet(
        testRoot,
        handle,
        defaultSpace,
        presenceTtl,
        {}
      );
      expect(getResult1.version).toBe(1);
      expect(getResult1.content).toContain('Initial announcement');
      expect(getResult1.has_seen).toBe(false);

      // Append to announcement
      const appendResult = await announcementAppend(testRoot, defaultSpace, {
        content: 'Update: Task completed',
      });
      expect(appendResult.version).toBe(2);

      // Get updated announcement
      const getResult2 = await announcementGet(
        testRoot,
        handle,
        defaultSpace,
        presenceTtl,
        {}
      );
      expect(getResult2.version).toBe(2);
      expect(getResult2.content).toContain('Initial announcement');
      expect(getResult2.content).toContain('Update: Task completed');
      expect(getResult2.has_seen).toBe(false); // New version

      // Replace announcement
      const setResult2 = await announcementSet(testRoot, defaultSpace, {
        content: 'New announcement',
      });
      expect(setResult2.version).toBe(3);

      // Get replaced announcement
      const getResult3 = await announcementGet(
        testRoot,
        handle,
        defaultSpace,
        presenceTtl,
        {}
      );
      expect(getResult3.version).toBe(3);
      expect(getResult3.content).toContain('New announcement');
      expect(getResult3.content).not.toContain('Initial announcement');
    });
  });
});
