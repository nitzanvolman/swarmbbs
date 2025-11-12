/**
 * Contract Tests for Presence Tools
 *
 * Tests introduce, send_heartbeat, and who_online tool contracts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'fs/promises';
import { join } from 'path';
import {
  introduce,
  sendHeartbeat,
  whoOnline,
  type IntroduceInput,
  type SendHeartbeatInput,
  type WhoOnlineInput,
} from '../../src/tools/presence.js';
import { writePresence, getPresence } from '../../src/storage/state-ops.js';
import type { PresenceRecord } from '../../src/types/state.js';

describe('Presence Tools Contract Tests', () => {
  const testRoot = join(process.cwd(), 'tmp', 'test-presence-contract');
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
  // introduce tests
  // ==========================================================================

  describe('introduce', () => {
    it('should create profile with role and expertise', async () => {
      const input: IntroduceInput = {
        role: 'researcher',
        expertise: ['NLP', 'data mining', 'sentiment analysis'],
      };

      const result = await introduce(testRoot, handle, defaultSpace, input);

      expect(result.success).toBe(true);
      expect(result.space).toBe(defaultSpace);
      expect(result.handle).toBe(handle);
      expect(result.profile.role).toBe('researcher');
      expect(result.profile.expertise).toEqual(['NLP', 'data mining', 'sentiment analysis']);
      expect(result.profile.updated_ts).toBeDefined();
      expect(new Date(result.profile.updated_ts).getTime()).toBeGreaterThan(0);
    });

    it('should create profile with minimal input (no expertise)', async () => {
      const input: IntroduceInput = {
        role: 'coordinator',
      };

      const result = await introduce(testRoot, handle, defaultSpace, input);

      expect(result.success).toBe(true);
      expect(result.profile.role).toBe('coordinator');
      expect(result.profile.expertise).toEqual([]);
    });

    it('should update existing profile', async () => {
      // First introduction
      await introduce(testRoot, handle, defaultSpace, {
        role: 'executor',
        expertise: ['Python'],
      });

      // Wait a small amount to ensure timestamp changes
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Update profile
      const input: IntroduceInput = {
        role: 'researcher',
        expertise: ['Python', 'data mining'],
      };

      const result = await introduce(testRoot, handle, defaultSpace, input);

      expect(result.success).toBe(true);
      expect(result.profile.role).toBe('researcher');
      expect(result.profile.expertise).toEqual(['Python', 'data mining']);
    });

    it('should accept custom space', async () => {
      const input: IntroduceInput = {
        space: 'project-x',
        role: 'executor',
        expertise: ['testing'],
      };

      const result = await introduce(testRoot, handle, defaultSpace, input);

      expect(result.success).toBe(true);
      expect(result.space).toBe('project-x');
    });

    it('should reject role that is too long', async () => {
      const longRole = 'a'.repeat(129);
      const input: IntroduceInput = {
        role: longRole,
      };

      await expect(introduce(testRoot, handle, defaultSpace, input)).rejects.toThrow(
        'Role must be between 1 and 128 characters'
      );
    });

    it('should reject empty role', async () => {
      const input: IntroduceInput = {
        role: '',
      };

      await expect(introduce(testRoot, handle, defaultSpace, input)).rejects.toThrow(
        'Role must be between 1 and 128 characters'
      );
    });

    it('should reject expertise array with more than 20 items', async () => {
      const expertise = Array.from({ length: 21 }, (_, i) => `skill-${i}`);
      const input: IntroduceInput = {
        role: 'researcher',
        expertise,
      };

      await expect(introduce(testRoot, handle, defaultSpace, input)).rejects.toThrow(
        'Expertise array exceeds'
      );
    });

    it('should accept exactly 20 expertise items', async () => {
      const expertise = Array.from({ length: 20 }, (_, i) => `skill-${i}`);
      const input: IntroduceInput = {
        role: 'researcher',
        expertise,
      };

      const result = await introduce(testRoot, handle, defaultSpace, input);

      expect(result.success).toBe(true);
      expect(result.profile.expertise).toHaveLength(20);
    });

    it('should reject invalid space name', async () => {
      const input: IntroduceInput = {
        space: '../invalid',
        role: 'executor',
      };

      await expect(introduce(testRoot, handle, defaultSpace, input)).rejects.toThrow();
    });
  });

  // ==========================================================================
  // send_heartbeat tests
  // ==========================================================================

  describe('send_heartbeat', () => {
    it('should update heartbeat with default status', async () => {
      const input: SendHeartbeatInput = {};

      const result = await sendHeartbeat(testRoot, handle, defaultSpace, presenceTtl, input);

      expect(result.success).toBe(true);
      expect(result.space).toBe(defaultSpace);
      expect(result.handle).toBe(handle);
      expect(result.status).toBe('available');
      expect(result.last_heartbeat).toBeDefined();
      expect(result.next_heartbeat_recommended).toBeDefined();

      // Verify next heartbeat is in the future
      const nextHeartbeat = new Date(result.next_heartbeat_recommended).getTime();
      const lastHeartbeat = new Date(result.last_heartbeat).getTime();
      expect(nextHeartbeat).toBeGreaterThan(lastHeartbeat);

      // Verify presence was updated
      const presence = await getPresence(testRoot, defaultSpace, handle);
      expect(presence).not.toBeNull();
      expect(presence!.status).toBe('available');
      expect(presence!.last_heartbeat_ts).toBe(result.last_heartbeat);
    });

    it('should update heartbeat with busy status', async () => {
      const input: SendHeartbeatInput = {
        status: 'busy',
      };

      const result = await sendHeartbeat(testRoot, handle, defaultSpace, presenceTtl, input);

      expect(result.success).toBe(true);
      expect(result.status).toBe('busy');

      const presence = await getPresence(testRoot, defaultSpace, handle);
      expect(presence!.status).toBe('busy');
    });

    it('should update heartbeat with away status', async () => {
      const input: SendHeartbeatInput = {
        status: 'away',
      };

      const result = await sendHeartbeat(testRoot, handle, defaultSpace, presenceTtl, input);

      expect(result.success).toBe(true);
      expect(result.status).toBe('away');
    });

    it('should accept custom space', async () => {
      const input: SendHeartbeatInput = {
        space: 'custom-space',
        status: 'available',
      };

      const result = await sendHeartbeat(testRoot, handle, defaultSpace, presenceTtl, input);

      expect(result.success).toBe(true);
      expect(result.space).toBe('custom-space');
    });

    it('should preserve existing last_request_ts', async () => {
      // Create initial presence with older last_request_ts
      const oldRequestTs = new Date(Date.now() - 30000).toISOString();
      const initialPresence: PresenceRecord = {
        last_request_ts: oldRequestTs,
        last_heartbeat_ts: new Date().toISOString(),
        status: 'available',
      };
      await writePresence(testRoot, defaultSpace, handle, initialPresence);

      // Send heartbeat
      const input: SendHeartbeatInput = {
        status: 'busy',
      };

      await sendHeartbeat(testRoot, handle, defaultSpace, presenceTtl, input);

      // Verify last_request_ts was preserved
      const presence = await getPresence(testRoot, defaultSpace, handle);
      expect(presence!.last_request_ts).toBe(oldRequestTs);
    });

    it('should reject invalid space name', async () => {
      const input: SendHeartbeatInput = {
        space: '../invalid',
      };

      await expect(
        sendHeartbeat(testRoot, handle, defaultSpace, presenceTtl, input)
      ).rejects.toThrow();
    });
  });

  // ==========================================================================
  // who_online tests (TTL filtering)
  // ==========================================================================

  describe('who_online', () => {
    it('should return empty array when no agents online', async () => {
      const input: WhoOnlineInput = {};

      const result = await whoOnline(testRoot, defaultSpace, presenceTtl, input);

      expect(result.success).toBe(true);
      expect(result.space).toBe(defaultSpace);
      expect(result.presence_ttl_s).toBe(presenceTtl);
      expect(result.agents).toEqual([]);
      expect(result.as_of).toBeDefined();
    });

    it('should return online agents within TTL', async () => {
      // Create presence for multiple agents
      const now = new Date().toISOString();

      await writePresence(testRoot, defaultSpace, 'agent-1', {
        last_request_ts: now,
        last_heartbeat_ts: now,
        status: 'available',
      });

      await writePresence(testRoot, defaultSpace, 'agent-2', {
        last_request_ts: now,
        last_heartbeat_ts: now,
        status: 'busy',
      });

      const input: WhoOnlineInput = {};

      const result = await whoOnline(testRoot, defaultSpace, presenceTtl, input);

      expect(result.success).toBe(true);
      expect(result.agents).toHaveLength(2);

      const handles = result.agents.map((a) => a.handle);
      expect(handles).toContain('agent-1');
      expect(handles).toContain('agent-2');
    });

    it('should filter out agents beyond TTL', async () => {
      const now = Date.now();
      const withinTtl = new Date(now - 30000).toISOString(); // 30 seconds ago
      const beyondTtl = new Date(now - 70000).toISOString(); // 70 seconds ago (beyond 60s TTL)

      // Agent within TTL
      await writePresence(testRoot, defaultSpace, 'agent-online', {
        last_request_ts: withinTtl,
        last_heartbeat_ts: withinTtl,
        status: 'available',
      });

      // Agent beyond TTL
      await writePresence(testRoot, defaultSpace, 'agent-offline', {
        last_request_ts: beyondTtl,
        last_heartbeat_ts: beyondTtl,
        status: 'available',
      });

      const input: WhoOnlineInput = {};

      const result = await whoOnline(testRoot, defaultSpace, presenceTtl, input);

      expect(result.success).toBe(true);
      expect(result.agents).toHaveLength(1);
      expect(result.agents[0].handle).toBe('agent-online');
    });

    it('should use max of last_request_ts and last_heartbeat_ts for TTL', async () => {
      const now = Date.now();
      const oldRequest = new Date(now - 70000).toISOString(); // Beyond TTL
      const recentHeartbeat = new Date(now - 30000).toISOString(); // Within TTL

      // Agent with old request but recent heartbeat (should be online)
      await writePresence(testRoot, defaultSpace, 'agent-heartbeat', {
        last_request_ts: oldRequest,
        last_heartbeat_ts: recentHeartbeat,
        status: 'available',
      });

      const input: WhoOnlineInput = {};

      const result = await whoOnline(testRoot, defaultSpace, presenceTtl, input);

      expect(result.success).toBe(true);
      expect(result.agents).toHaveLength(1);
      expect(result.agents[0].handle).toBe('agent-heartbeat');
    });

    it('should include profile information when available', async () => {
      // Create agent with profile
      await introduce(testRoot, 'agent-with-profile', defaultSpace, {
        role: 'researcher',
        expertise: ['NLP', 'data mining'],
      });

      // Update presence
      await sendHeartbeat(testRoot, 'agent-with-profile', defaultSpace, presenceTtl, {
        status: 'available',
      });

      const input: WhoOnlineInput = {};

      const result = await whoOnline(testRoot, defaultSpace, presenceTtl, input);

      expect(result.success).toBe(true);
      expect(result.agents).toHaveLength(1);
      expect(result.agents[0].handle).toBe('agent-with-profile');
      expect(result.agents[0].role).toBe('researcher');
      expect(result.agents[0].expertise).toEqual(['NLP', 'data mining']);
    });

    it('should work without profile information', async () => {
      // Create presence without profile
      const now = new Date().toISOString();
      await writePresence(testRoot, defaultSpace, 'agent-no-profile', {
        last_request_ts: now,
        last_heartbeat_ts: now,
        status: 'available',
      });

      const input: WhoOnlineInput = {};

      const result = await whoOnline(testRoot, defaultSpace, presenceTtl, input);

      expect(result.success).toBe(true);
      expect(result.agents).toHaveLength(1);
      expect(result.agents[0].handle).toBe('agent-no-profile');
      expect(result.agents[0].role).toBeUndefined();
      expect(result.agents[0].expertise).toBeUndefined();
    });

    it('should include all status values', async () => {
      const now = new Date().toISOString();

      await writePresence(testRoot, defaultSpace, 'agent-available', {
        last_request_ts: now,
        last_heartbeat_ts: now,
        status: 'available',
      });

      await writePresence(testRoot, defaultSpace, 'agent-busy', {
        last_request_ts: now,
        last_heartbeat_ts: now,
        status: 'busy',
      });

      await writePresence(testRoot, defaultSpace, 'agent-away', {
        last_request_ts: now,
        last_heartbeat_ts: now,
        status: 'away',
      });

      const input: WhoOnlineInput = {};

      const result = await whoOnline(testRoot, defaultSpace, presenceTtl, input);

      expect(result.success).toBe(true);
      expect(result.agents).toHaveLength(3);

      const statuses = result.agents.map((a) => a.status);
      expect(statuses).toContain('available');
      expect(statuses).toContain('busy');
      expect(statuses).toContain('away');
    });

    it('should accept custom space', async () => {
      const now = new Date().toISOString();

      // Agent in custom space
      await writePresence(testRoot, 'custom-space', 'agent-custom', {
        last_request_ts: now,
        last_heartbeat_ts: now,
        status: 'available',
      });

      // Agent in default space (should not appear)
      await writePresence(testRoot, defaultSpace, 'agent-default', {
        last_request_ts: now,
        last_heartbeat_ts: now,
        status: 'available',
      });

      const input: WhoOnlineInput = {
        space: 'custom-space',
      };

      const result = await whoOnline(testRoot, defaultSpace, presenceTtl, input);

      expect(result.success).toBe(true);
      expect(result.space).toBe('custom-space');
      expect(result.agents).toHaveLength(1);
      expect(result.agents[0].handle).toBe('agent-custom');
    });

    it('should reject invalid space name', async () => {
      const input: WhoOnlineInput = {
        space: '../invalid',
      };

      await expect(whoOnline(testRoot, defaultSpace, presenceTtl, input)).rejects.toThrow();
    });
  });
});
