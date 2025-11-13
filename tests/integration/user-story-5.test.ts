/**
 * Integration Tests for User Story 5: Space-Wide Announcements
 *
 * Tests the complete announcement lifecycle:
 * - Coordinator sets announcement
 * - Multiple agents poll and receive announcements
 * - Exactly-once delivery per version
 * - Dynamic "Who's online" section generation
 * - Announcement updates trigger new deliveries
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
} from '../../src/tools/announcements.js';
import {
  writePresence,
  writeProfile,
  getAnnouncementSeen,
} from '../../src/storage/state-ops.js';
import type { PresenceRecord } from '../../src/types/state.js';

describe('User Story 5: Space-Wide Announcements', () => {
  const testRoot = join(process.cwd(), 'tmp', 'test-us5-integration');
  const space = 'project-collab';
  const presenceTtl = 60; // 60 seconds

  beforeEach(async () => {
    await mkdir(testRoot, { recursive: true });
  });

  afterEach(async () => {
    await rm(testRoot, { recursive: true, force: true });
  });

  // ==========================================================================
  // User Story 5: Complete announcement lifecycle
  // ==========================================================================

  it('should support complete announcement lifecycle with multiple agents', async () => {
    const coordinator = 'agent-coordinator';
    const worker1 = 'agent-worker-1';
    const worker2 = 'agent-worker-2';

    // Step 1: Coordinator sets an announcement
    const setInput: AnnouncementSetInput = {
      space,
      content: '# Project Update\n\nNew tasks are available in the coordination thread.',
      content_type: 'text/markdown',
    };

    const setResult = await announcementSet(testRoot, space, setInput);

    expect(setResult.success).toBe(true);
    expect(setResult.space).toBe(space);
    expect(setResult.version).toBe(1);
    expect(setResult.ts).toBeDefined();

    // Step 2: Worker 1 retrieves announcement (first time)
    const worker1Get1 = await announcementGet(testRoot, worker1, space, presenceTtl, {
      space,
    });

    expect(worker1Get1.success).toBe(true);
    expect(worker1Get1.version).toBe(1);
    expect(worker1Get1.content).toContain('# Project Update');
    expect(worker1Get1.has_seen).toBe(false); // First time seeing this version

    // Step 3: Worker 2 retrieves announcement (first time)
    const worker2Get1 = await announcementGet(testRoot, worker2, space, presenceTtl, {
      space,
    });

    expect(worker2Get1.success).toBe(true);
    expect(worker2Get1.version).toBe(1);
    expect(worker2Get1.has_seen).toBe(false); // First time for this agent

    // Step 4: Worker 1 retrieves again (should be marked as seen)
    const worker1Get2 = await announcementGet(testRoot, worker1, space, presenceTtl, {
      space,
    });

    expect(worker1Get2.version).toBe(1);
    expect(worker1Get2.has_seen).toBe(true); // Already seen

    // Step 5: Coordinator updates announcement
    const appendResult = await announcementAppend(testRoot, space, {
      space,
      content: 'Update: 5 tasks completed successfully!',
    });

    expect(appendResult.version).toBe(2);

    // Step 6: Worker 1 retrieves updated announcement
    const worker1Get3 = await announcementGet(testRoot, worker1, space, presenceTtl, {
      space,
    });

    expect(worker1Get3.version).toBe(2);
    expect(worker1Get3.content).toContain('# Project Update');
    expect(worker1Get3.content).toContain('Update: 5 tasks completed');
    expect(worker1Get3.has_seen).toBe(false); // New version

    // Step 7: Worker 2 still hasn't seen version 2
    const worker2Get2 = await announcementGet(testRoot, worker2, space, presenceTtl, {
      space,
    });

    expect(worker2Get2.version).toBe(2);
    expect(worker2Get2.has_seen).toBe(false); // New version for worker 2
  });

  // ==========================================================================
  // Exactly-once delivery per version
  // ==========================================================================

  it('should deliver announcements exactly once per version to each agent', async () => {
    const agent = 'agent-test';

    // Set version 1
    await announcementSet(testRoot, space, {
      space,
      content: 'Version 1',
    });

    // First get - not seen
    const get1 = await announcementGet(testRoot, agent, space, presenceTtl, { space });
    expect(get1.version).toBe(1);
    expect(get1.has_seen).toBe(false);

    // Second get - already seen
    const get2 = await announcementGet(testRoot, agent, space, presenceTtl, { space });
    expect(get2.version).toBe(1);
    expect(get2.has_seen).toBe(true);

    // Third get - still seen
    const get3 = await announcementGet(testRoot, agent, space, presenceTtl, { space });
    expect(get3.version).toBe(1);
    expect(get3.has_seen).toBe(true);

    // Set version 2
    await announcementSet(testRoot, space, {
      space,
      content: 'Version 2',
    });

    // First get of version 2 - not seen
    const get4 = await announcementGet(testRoot, agent, space, presenceTtl, { space });
    expect(get4.version).toBe(2);
    expect(get4.has_seen).toBe(false);

    // Second get of version 2 - already seen
    const get5 = await announcementGet(testRoot, agent, space, presenceTtl, { space });
    expect(get5.version).toBe(2);
    expect(get5.has_seen).toBe(true);
  });

  // ==========================================================================
  // Multiple agents receive announcements independently
  // ==========================================================================

  it('should deliver announcements independently to multiple agents', async () => {
    const agents = ['agent-a', 'agent-b', 'agent-c', 'agent-d'];

    // Set announcement
    await announcementSet(testRoot, space, {
      space,
      content: 'Broadcast to all agents',
    });

    // All agents get announcement independently
    for (const agent of agents) {
      const result = await announcementGet(testRoot, agent, space, presenceTtl, {
        space,
      });

      expect(result.version).toBe(1);
      expect(result.has_seen).toBe(false);
      expect(result.content).toContain('Broadcast to all agents');
    }

    // Each agent gets it again - all should be marked as seen
    for (const agent of agents) {
      const result = await announcementGet(testRoot, agent, space, presenceTtl, {
        space,
      });

      expect(result.version).toBe(1);
      expect(result.has_seen).toBe(true);
    }

    // Update announcement
    await announcementAppend(testRoot, space, {
      space,
      content: 'Update for all',
    });

    // All agents see new version
    for (const agent of agents) {
      const result = await announcementGet(testRoot, agent, space, presenceTtl, {
        space,
      });

      expect(result.version).toBe(2);
      expect(result.has_seen).toBe(false); // New version not seen yet
    }
  });

  // ==========================================================================
  // Dynamic "Who's online" section
  // ==========================================================================

  it('should append dynamic "Who\'s online" section with agent profiles', async () => {
    const coordinator = 'agent-coordinator';
    const worker1 = 'agent-worker-1';
    const worker2 = 'agent-worker-2';

    // Set up agent profiles
    await writeProfile(testRoot, space, coordinator, 'coordinator', [
      'task management',
      'resource allocation',
    ]);
    await writeProfile(testRoot, space, worker1, 'executor', ['Python', 'data processing']);
    await writeProfile(testRoot, space, worker2, 'researcher', ['NLP', 'machine learning']);

    // Set up presence (make agents online)
    const now = new Date().toISOString();
    const presence: PresenceRecord = {
      last_request_ts: now,
      last_heartbeat_ts: now,
      status: 'available',
    };

    await writePresence(testRoot, space, coordinator, presence);
    await writePresence(testRoot, space, worker1, { ...presence, status: 'busy' });
    await writePresence(testRoot, space, worker2, presence);

    // Set announcement
    await announcementSet(testRoot, space, {
      space,
      content: 'Check who is online below',
      content_type: 'text/plain',
    });

    // Get announcement
    const result = await announcementGet(testRoot, coordinator, space, presenceTtl, {
      space,
    });

    expect(result.success).toBe(true);
    expect(result.content).toContain('Check who is online below');

    // Should contain "Who's online" section
    expect(result.content).toContain("Who's Online");

    // Should list online agents
    expect(result.content).toContain('agent-coordinator');
    expect(result.content).toContain('agent-worker-1');
    expect(result.content).toContain('agent-worker-2');

    // Should show statuses
    expect(result.content).toContain('available');
    expect(result.content).toContain('busy');
  });

  it('should format "Who\'s online" section in markdown when content_type is markdown', async () => {
    const agent = 'agent-test';

    // Set up agent with profile
    await writeProfile(testRoot, space, agent, 'executor', ['testing']);

    // Set up presence
    const presence: PresenceRecord = {
      last_request_ts: new Date().toISOString(),
      last_heartbeat_ts: new Date().toISOString(),
      status: 'available',
    };
    await writePresence(testRoot, space, agent, presence);

    // Set markdown announcement
    await announcementSet(testRoot, space, {
      space,
      content: '# Announcement',
      content_type: 'text/markdown',
    });

    // Get announcement
    const result = await announcementGet(testRoot, agent, space, presenceTtl, { space });

    expect(result.content_type).toBe('text/markdown');
    expect(result.content).toContain('# Announcement');
    expect(result.content).toContain("## Who's Online");
    expect(result.content).toContain('**agent-test**'); // Markdown bold
  });

  // ==========================================================================
  // Announcement updates trigger new deliveries
  // ==========================================================================

  it('should trigger new deliveries when announcement is updated', async () => {
    const agents = ['agent-a', 'agent-b', 'agent-c'];

    // Set version 1
    await announcementSet(testRoot, space, {
      space,
      content: 'Version 1',
    });

    // All agents fetch and mark as seen
    for (const agent of agents) {
      await announcementGet(testRoot, agent, space, presenceTtl, { space });
      const seen = await getAnnouncementSeen(testRoot, space, agent);
      expect(seen).toBe(1);
    }

    // Update to version 2
    await announcementAppend(testRoot, space, {
      space,
      content: 'Update 1',
    });

    // All agents should see new version as not seen
    for (const agent of agents) {
      const result = await announcementGet(testRoot, agent, space, presenceTtl, {
        space,
      });
      expect(result.version).toBe(2);
      expect(result.has_seen).toBe(false);

      const seen = await getAnnouncementSeen(testRoot, space, agent);
      expect(seen).toBe(2); // Now marked as seen version 2
    }

    // Replace with version 3
    await announcementSet(testRoot, space, {
      space,
      content: 'Complete replacement',
    });

    // All agents should see new version as not seen
    for (const agent of agents) {
      const result = await announcementGet(testRoot, agent, space, presenceTtl, {
        space,
      });
      expect(result.version).toBe(3);
      expect(result.has_seen).toBe(false);
    }
  });

  // ==========================================================================
  // Multiple sequential updates
  // ==========================================================================

  it('should handle multiple sequential updates correctly', async () => {
    const agent = 'agent-updater';

    // Version 1
    await announcementSet(testRoot, space, {
      space,
      content: 'Initial',
    });

    // Version 2
    await announcementAppend(testRoot, space, {
      space,
      content: 'Update 1',
    });

    // Version 3
    await announcementAppend(testRoot, space, {
      space,
      content: 'Update 2',
    });

    // Version 4
    await announcementAppend(testRoot, space, {
      space,
      content: 'Update 3',
    });

    // Agent fetches final version
    const result = await announcementGet(testRoot, agent, space, presenceTtl, { space });

    expect(result.version).toBe(4);
    expect(result.content).toContain('Initial');
    expect(result.content).toContain('Update 1');
    expect(result.content).toContain('Update 2');
    expect(result.content).toContain('Update 3');
    expect(result.has_seen).toBe(false);

    // Agent fetches again
    const result2 = await announcementGet(testRoot, agent, space, presenceTtl, { space });
    expect(result2.version).toBe(4);
    expect(result2.has_seen).toBe(true);
  });

  // ==========================================================================
  // Clear announcement
  // ==========================================================================

  it('should handle clearing announcements', async () => {
    const agent = 'agent-clearer';

    // Set announcement
    await announcementSet(testRoot, space, {
      space,
      content: 'Original announcement',
    });

    // Agent sees it
    const result1 = await announcementGet(testRoot, agent, space, presenceTtl, { space });
    expect(result1.version).toBe(1);
    expect(result1.content).toContain('Original announcement');

    // Clear announcement
    await announcementSet(testRoot, space, {
      space,
      content: '',
    });

    // Agent sees cleared announcement
    const result2 = await announcementGet(testRoot, agent, space, presenceTtl, { space });
    expect(result2.version).toBe(2);
    expect(result2.has_seen).toBe(false); // New version
    expect(result2.content).not.toContain('Original announcement');
  });

  // ==========================================================================
  // Cross-space isolation
  // ==========================================================================

  it('should isolate announcements per space', async () => {
    const agent = 'agent-multi-space';
    const space1 = 'space-1';
    const space2 = 'space-2';

    // Set announcement in space 1
    await announcementSet(testRoot, space1, {
      space: space1,
      content: 'Space 1 announcement',
    });

    // Set announcement in space 2
    await announcementSet(testRoot, space2, {
      space: space2,
      content: 'Space 2 announcement',
    });

    // Get from space 1
    const result1 = await announcementGet(testRoot, agent, space1, presenceTtl, {
      space: space1,
    });
    expect(result1.space).toBe(space1);
    expect(result1.content).toContain('Space 1 announcement');
    expect(result1.content).not.toContain('Space 2 announcement');

    // Get from space 2
    const result2 = await announcementGet(testRoot, agent, space2, presenceTtl, {
      space: space2,
    });
    expect(result2.space).toBe(space2);
    expect(result2.content).toContain('Space 2 announcement');
    expect(result2.content).not.toContain('Space 1 announcement');

    // Seen tracking is also per-space
    const result1Again = await announcementGet(testRoot, agent, space1, presenceTtl, {
      space: space1,
    });
    expect(result1Again.has_seen).toBe(true);

    const result2Again = await announcementGet(testRoot, agent, space2, presenceTtl, {
      space: space2,
    });
    expect(result2Again.has_seen).toBe(true);
  });
});
