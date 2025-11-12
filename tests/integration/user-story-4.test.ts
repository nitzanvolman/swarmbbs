/**
 * Integration Tests for User Story 4: Presence & Discovery
 *
 * Tests the complete presence lifecycle:
 * - Agent introduces itself with role and expertise
 * - Agent sends heartbeat
 * - Other agents query who's online and verify metadata
 * - TTL expiration causes agent to go offline
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
import { writePresence } from '../../src/storage/state-ops.js';
import type { PresenceRecord } from '../../src/types/state.js';

describe('User Story 4: Presence & Discovery', () => {
  const testRoot = join(process.cwd(), 'tmp', 'test-us4-integration');
  const space = 'project-discovery';
  const presenceTtl = 60; // 60 seconds

  beforeEach(async () => {
    await mkdir(testRoot, { recursive: true });
  });

  afterEach(async () => {
    await rm(testRoot, { recursive: true, force: true });
  });

  // ==========================================================================
  // User Story 4: Complete presence lifecycle
  // ==========================================================================

  it('should support complete presence lifecycle', async () => {
    // Step 1: agent-a introduces itself with role "researcher" and expertise
    const agentA = 'agent-researcher';
    const introduceInput: IntroduceInput = {
      space,
      role: 'researcher',
      expertise: ['NLP', 'data mining'],
    };

    const introduceResult = await introduce(testRoot, agentA, space, introduceInput);

    expect(introduceResult.success).toBe(true);
    expect(introduceResult.space).toBe(space);
    expect(introduceResult.handle).toBe(agentA);
    expect(introduceResult.profile.role).toBe('researcher');
    expect(introduceResult.profile.expertise).toEqual(['NLP', 'data mining']);

    // Step 2: agent-a sends heartbeat
    const heartbeatInput: SendHeartbeatInput = {
      space,
      status: 'available',
    };

    const heartbeatResult = await sendHeartbeat(testRoot, agentA, space, presenceTtl, heartbeatInput);

    expect(heartbeatResult.success).toBe(true);
    expect(heartbeatResult.handle).toBe(agentA);
    expect(heartbeatResult.status).toBe('available');
    expect(heartbeatResult.last_heartbeat).toBeDefined();

    // Step 3: agent-b queries who's online
    const agentB = 'agent-coordinator';
    const whoOnlineInput: WhoOnlineInput = {
      space,
    };

    const whoOnlineResult = await whoOnline(testRoot, space, presenceTtl, whoOnlineInput);

    expect(whoOnlineResult.success).toBe(true);
    expect(whoOnlineResult.space).toBe(space);
    expect(whoOnlineResult.presence_ttl_s).toBe(presenceTtl);

    // Step 4: Verify agent-a appears with correct metadata
    const agentAInList = whoOnlineResult.agents.find((a) => a.handle === agentA);
    expect(agentAInList).toBeDefined();
    expect(agentAInList!.status).toBe('available');
    expect(agentAInList!.role).toBe('researcher');
    expect(agentAInList!.expertise).toEqual(['NLP', 'data mining']);
    expect(agentAInList!.last_seen).toBeDefined();

    // Verify last_seen is recent
    const lastSeen = new Date(agentAInList!.last_seen).getTime();
    const now = Date.now();
    expect(now - lastSeen).toBeLessThan(5000); // Within 5 seconds
  });

  // ==========================================================================
  // Multi-agent presence
  // ==========================================================================

  it('should handle multiple agents with different roles', async () => {
    // Create multiple agents with different profiles
    const agents = [
      {
        handle: 'agent-coordinator',
        role: 'coordinator',
        expertise: ['task management', 'resource allocation'],
        status: 'available' as const,
      },
      {
        handle: 'agent-worker-1',
        role: 'executor',
        expertise: ['Python', 'data processing'],
        status: 'busy' as const,
      },
      {
        handle: 'agent-worker-2',
        role: 'executor',
        expertise: ['JavaScript', 'testing'],
        status: 'available' as const,
      },
      {
        handle: 'agent-researcher',
        role: 'researcher',
        expertise: ['NLP', 'ML'],
        status: 'away' as const,
      },
    ];

    // Introduce all agents
    for (const agent of agents) {
      await introduce(testRoot, agent.handle, space, {
        space,
        role: agent.role,
        expertise: agent.expertise,
      });

      await sendHeartbeat(testRoot, agent.handle, space, presenceTtl, {
        space,
        status: agent.status,
      });
    }

    // Query who's online
    const result = await whoOnline(testRoot, space, presenceTtl, {
      space,
    });

    expect(result.success).toBe(true);
    expect(result.agents).toHaveLength(4);

    // Verify each agent appears with correct data
    for (const agent of agents) {
      const found = result.agents.find((a) => a.handle === agent.handle);
      expect(found).toBeDefined();
      expect(found!.status).toBe(agent.status);
      expect(found!.role).toBe(agent.role);
      expect(found!.expertise).toEqual(agent.expertise);
    }

    // Verify we can filter by status
    const availableAgents = result.agents.filter((a) => a.status === 'available');
    expect(availableAgents).toHaveLength(2);

    const busyAgents = result.agents.filter((a) => a.status === 'busy');
    expect(busyAgents).toHaveLength(1);

    const awayAgents = result.agents.filter((a) => a.status === 'away');
    expect(awayAgents).toHaveLength(1);
  });

  // ==========================================================================
  // Discovery by expertise
  // ==========================================================================

  it('should enable discovery by expertise', async () => {
    // Create agents with different expertise
    await introduce(testRoot, 'nlp-expert', space, {
      space,
      role: 'researcher',
      expertise: ['NLP', 'sentiment analysis', 'text classification'],
    });

    await sendHeartbeat(testRoot, 'nlp-expert', space, presenceTtl, {
      space,
      status: 'available',
    });

    await introduce(testRoot, 'data-expert', space, {
      space,
      role: 'researcher',
      expertise: ['data mining', 'ETL', 'databases'],
    });

    await sendHeartbeat(testRoot, 'data-expert', space, presenceTtl, {
      space,
      status: 'available',
    });

    await introduce(testRoot, 'generalist', space, {
      space,
      role: 'executor',
      expertise: ['Python', 'JavaScript', 'testing'],
    });

    await sendHeartbeat(testRoot, 'generalist', space, presenceTtl, {
      space,
      status: 'available',
    });

    // Query who's online
    const result = await whoOnline(testRoot, space, presenceTtl, {
      space,
    });

    // Find NLP experts
    const nlpExperts = result.agents.filter(
      (a) => a.expertise && a.expertise.includes('NLP')
    );
    expect(nlpExperts).toHaveLength(1);
    expect(nlpExperts[0].handle).toBe('nlp-expert');

    // Find data mining experts
    const dataMiningExperts = result.agents.filter(
      (a) => a.expertise && a.expertise.includes('data mining')
    );
    expect(dataMiningExperts).toHaveLength(1);
    expect(dataMiningExperts[0].handle).toBe('data-expert');

    // Find Python experts
    const pythonExperts = result.agents.filter(
      (a) => a.expertise && a.expertise.includes('Python')
    );
    expect(pythonExperts).toHaveLength(1);
    expect(pythonExperts[0].handle).toBe('generalist');
  });

  // ==========================================================================
  // TTL expiration
  // ==========================================================================

  it('should remove agents from online list after TTL expires', async () => {
    const shortTtl = 2; // 2 seconds for faster testing
    const now = Date.now();

    // Create agent that's currently online
    const onlineAgent = 'agent-online';
    await introduce(testRoot, onlineAgent, space, {
      space,
      role: 'executor',
      expertise: ['testing'],
    });

    await sendHeartbeat(testRoot, onlineAgent, space, shortTtl, {
      space,
      status: 'available',
    });

    // Create agent that's already expired
    const offlineAgent = 'agent-offline';
    const expiredTs = new Date(now - 5000).toISOString(); // 5 seconds ago

    await introduce(testRoot, offlineAgent, space, {
      space,
      role: 'executor',
      expertise: ['expired'],
    });

    const expiredPresence: PresenceRecord = {
      last_request_ts: expiredTs,
      last_heartbeat_ts: expiredTs,
      status: 'available',
    };

    await writePresence(testRoot, space, offlineAgent, expiredPresence);

    // Query immediately - should only see online agent
    const result1 = await whoOnline(testRoot, space, shortTtl, {
      space,
    });

    expect(result1.agents).toHaveLength(1);
    expect(result1.agents[0].handle).toBe(onlineAgent);

    // Wait for TTL to expire (2.5 seconds to be safe)
    await new Promise((resolve) => setTimeout(resolve, 2500));

    // Query again - should see no agents
    const result2 = await whoOnline(testRoot, space, shortTtl, {
      space,
    });

    expect(result2.agents).toHaveLength(0);
  });

  // ==========================================================================
  // Heartbeat keeps agent online
  // ==========================================================================

  it('should keep agent online with periodic heartbeats', async () => {
    const shortTtl = 3; // 3 seconds
    const agent = 'agent-heartbeat';

    await introduce(testRoot, agent, space, {
      space,
      role: 'executor',
      expertise: ['long-running'],
    });

    // Send initial heartbeat
    await sendHeartbeat(testRoot, agent, space, shortTtl, {
      space,
      status: 'busy',
    });

    // Query - should be online
    const result1 = await whoOnline(testRoot, space, shortTtl, {
      space,
    });
    expect(result1.agents).toHaveLength(1);

    // Wait 2 seconds (within TTL)
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Send another heartbeat
    await sendHeartbeat(testRoot, agent, space, shortTtl, {
      space,
      status: 'busy',
    });

    // Wait another 2 seconds (total 4 seconds, but heartbeat was at 2s)
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Query - should still be online (last heartbeat was 2s ago)
    const result2 = await whoOnline(testRoot, space, shortTtl, {
      space,
    });
    expect(result2.agents).toHaveLength(1);
    expect(result2.agents[0].handle).toBe(agent);
    expect(result2.agents[0].status).toBe('busy');
  });

  // ==========================================================================
  // Status updates
  // ==========================================================================

  it('should allow status updates via heartbeat', async () => {
    const agent = 'agent-status';

    await introduce(testRoot, agent, space, {
      space,
      role: 'executor',
      expertise: ['adaptive'],
    });

    // Start as available
    await sendHeartbeat(testRoot, agent, space, presenceTtl, {
      space,
      status: 'available',
    });

    const result1 = await whoOnline(testRoot, space, presenceTtl, { space });
    expect(result1.agents[0].status).toBe('available');

    // Change to busy
    await sendHeartbeat(testRoot, agent, space, presenceTtl, {
      space,
      status: 'busy',
    });

    const result2 = await whoOnline(testRoot, space, presenceTtl, { space });
    expect(result2.agents[0].status).toBe('busy');

    // Change to away
    await sendHeartbeat(testRoot, agent, space, presenceTtl, {
      space,
      status: 'away',
    });

    const result3 = await whoOnline(testRoot, space, presenceTtl, { space });
    expect(result3.agents[0].status).toBe('away');
  });

  // ==========================================================================
  // Profile updates
  // ==========================================================================

  it('should allow profile updates', async () => {
    const agent = 'agent-evolving';

    // Initial profile
    await introduce(testRoot, agent, space, {
      space,
      role: 'learner',
      expertise: ['basics'],
    });

    await sendHeartbeat(testRoot, agent, space, presenceTtl, {
      space,
      status: 'available',
    });

    const result1 = await whoOnline(testRoot, space, presenceTtl, { space });
    expect(result1.agents[0].role).toBe('learner');
    expect(result1.agents[0].expertise).toEqual(['basics']);

    // Update profile
    await introduce(testRoot, agent, space, {
      space,
      role: 'expert',
      expertise: ['NLP', 'ML', 'data mining', 'Python'],
    });

    // Send heartbeat to ensure online
    await sendHeartbeat(testRoot, agent, space, presenceTtl, {
      space,
      status: 'available',
    });

    const result2 = await whoOnline(testRoot, space, presenceTtl, { space });
    expect(result2.agents[0].role).toBe('expert');
    expect(result2.agents[0].expertise).toEqual(['NLP', 'ML', 'data mining', 'Python']);
  });

  // ==========================================================================
  // Space isolation
  // ==========================================================================

  it('should isolate presence by space', async () => {
    const agent = 'agent-multi-space';
    const space1 = 'project-alpha';
    const space2 = 'project-beta';

    // Agent in space1
    await introduce(testRoot, agent, space1, {
      space: space1,
      role: 'executor',
      expertise: ['alpha'],
    });

    await sendHeartbeat(testRoot, agent, space1, presenceTtl, {
      space: space1,
      status: 'available',
    });

    // Agent in space2 with different profile
    await introduce(testRoot, agent, space2, {
      space: space2,
      role: 'coordinator',
      expertise: ['beta'],
    });

    await sendHeartbeat(testRoot, agent, space2, presenceTtl, {
      space: space2,
      status: 'busy',
    });

    // Query space1
    const result1 = await whoOnline(testRoot, space1, presenceTtl, {
      space: space1,
    });

    expect(result1.agents).toHaveLength(1);
    expect(result1.agents[0].handle).toBe(agent);
    expect(result1.agents[0].role).toBe('executor');
    expect(result1.agents[0].expertise).toEqual(['alpha']);
    expect(result1.agents[0].status).toBe('available');

    // Query space2
    const result2 = await whoOnline(testRoot, space2, presenceTtl, {
      space: space2,
    });

    expect(result2.agents).toHaveLength(1);
    expect(result2.agents[0].handle).toBe(agent);
    expect(result2.agents[0].role).toBe('coordinator');
    expect(result2.agents[0].expertise).toEqual(['beta']);
    expect(result2.agents[0].status).toBe('busy');
  });
});
