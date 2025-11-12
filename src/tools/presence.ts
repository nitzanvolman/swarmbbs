/**
 * Presence & Discovery Tools
 *
 * Tools for agent presence tracking, profile management, and discovery
 */

import type { ToolDefinition, ServerConfig } from '../server/mcp-server.js';
import type { Profile } from '../types/state.js';
import {
  getProfile,
  writeProfile,
  updateHeartbeat,
  getWhoIsOnline,
  getPresence,
} from '../storage/state-ops.js';
import { assertValidName } from '../utils/validation.js';
import { badRequest, payloadTooLarge } from '../utils/errors.js';

// ============================================================================
// Tool: swarmbbs.introduce
// ============================================================================

export interface IntroduceInput {
  space?: string;
  role: string;
  expertise?: string[];
}

export interface IntroduceOutput {
  success: boolean;
  space: string;
  handle: string;
  profile: {
    role: string;
    expertise: string[];
    updated_ts: string;
  };
}

/**
 * Introduce tool - Register or update agent profile
 *
 * @param rootDir - Root directory for storage
 * @param handle - Agent handle
 * @param defaultSpace - Default space from server config
 * @param input - Tool input
 * @returns Introduction confirmation
 */
export async function introduce(
  rootDir: string,
  handle: string,
  defaultSpace: string,
  input: IntroduceInput
): Promise<IntroduceOutput> {
  const space = input.space || defaultSpace;
  assertValidName(space, 'space');

  // Validate role
  if (!input.role || input.role.length < 1 || input.role.length > 128) {
    throw badRequest(
      'Role must be between 1 and 128 characters',
      { field: 'role', max_length: 128, received_length: input.role?.length || 0 },
      'Provide a role string within the allowed length (1-128 characters).'
    );
  }

  // Validate expertise array
  const expertise = input.expertise || [];
  if (expertise.length > 20) {
    throw payloadTooLarge(
      'Expertise array',
      20,
      expertise.length,
      'Reduce expertise list to most important 20 capabilities'
    );
  }

  // Write profile
  const profile = await writeProfile(rootDir, space, handle, input.role, expertise);

  return {
    success: true,
    space,
    handle,
    profile: {
      role: profile.role,
      expertise: profile.expertise,
      updated_ts: profile.updated_ts,
    },
  };
}

// ============================================================================
// Tool: swarmbbs.send_heartbeat
// ============================================================================

export interface SendHeartbeatInput {
  space?: string;
  status?: 'available' | 'busy' | 'away';
}

export interface SendHeartbeatOutput {
  success: boolean;
  space: string;
  handle: string;
  last_heartbeat: string;
  status: 'available' | 'busy' | 'away';
  next_heartbeat_recommended: string;
}

/**
 * Send heartbeat tool - Update presence explicitly
 *
 * @param rootDir - Root directory for storage
 * @param handle - Agent handle
 * @param defaultSpace - Default space from server config
 * @param presenceTtl - Presence TTL in seconds
 * @param input - Tool input
 * @returns Heartbeat confirmation
 */
export async function sendHeartbeat(
  rootDir: string,
  handle: string,
  defaultSpace: string,
  presenceTtl: number,
  input: SendHeartbeatInput
): Promise<SendHeartbeatOutput> {
  const space = input.space || defaultSpace;
  assertValidName(space, 'space');

  const status = input.status || 'available';

  // Update heartbeat
  await updateHeartbeat(rootDir, space, handle, status);

  // Get the actual timestamp that was written
  const presence = await getPresence(rootDir, space, handle);
  const lastHeartbeat = presence?.last_heartbeat_ts || new Date().toISOString();

  const heartbeatTime = new Date(lastHeartbeat).getTime();
  const nextRecommended = new Date(heartbeatTime + (presenceTtl * 1000 * 0.75)); // 75% of TTL

  return {
    success: true,
    space,
    handle,
    last_heartbeat: lastHeartbeat,
    status,
    next_heartbeat_recommended: nextRecommended.toISOString(),
  };
}

// ============================================================================
// Tool: swarmbbs.who_online
// ============================================================================

export interface WhoOnlineInput {
  space?: string;
}

export interface WhoOnlineAgent {
  handle: string;
  status: 'available' | 'busy' | 'away';
  role?: string;
  expertise?: string[];
  last_seen: string;
  last_heartbeat?: string;
}

export interface WhoOnlineOutput {
  success: boolean;
  space: string;
  as_of: string;
  presence_ttl_s: number;
  agents: WhoOnlineAgent[];
}

/**
 * Who's online tool - Query active agents
 *
 * @param rootDir - Root directory for storage
 * @param defaultSpace - Default space from server config
 * @param presenceTtl - Presence TTL in seconds
 * @param input - Tool input
 * @returns List of online agents with profiles
 */
export async function whoOnline(
  rootDir: string,
  defaultSpace: string,
  presenceTtl: number,
  input: WhoOnlineInput
): Promise<WhoOnlineOutput> {
  const space = input.space || defaultSpace;
  assertValidName(space, 'space');

  const now = new Date();
  const onlineAgents = await getWhoIsOnline(rootDir, space, presenceTtl);

  const agents: WhoOnlineAgent[] = onlineAgents.map(({ handle, presence, profile }) => {
    const lastRequestTime = new Date(presence.last_request_ts).getTime();
    const lastHeartbeatTime = new Date(presence.last_heartbeat_ts).getTime();
    const lastSeenTime = Math.max(lastRequestTime, lastHeartbeatTime);

    const agent: WhoOnlineAgent = {
      handle,
      status: presence.status,
      last_seen: new Date(lastSeenTime).toISOString(),
    };

    // Add last_heartbeat if it exists and is not the same as last_seen
    if (presence.last_heartbeat_ts && lastHeartbeatTime !== lastSeenTime) {
      agent.last_heartbeat = presence.last_heartbeat_ts;
    } else if (presence.last_heartbeat_ts) {
      agent.last_heartbeat = presence.last_heartbeat_ts;
    }

    // Add profile data if available
    if (profile) {
      agent.role = profile.role;
      agent.expertise = profile.expertise;
    }

    return agent;
  });

  return {
    success: true,
    space,
    as_of: now.toISOString(),
    presence_ttl_s: presenceTtl,
    agents,
  };
}

// ============================================================================
// MCP Tool Definitions
// ============================================================================

/**
 * introduce tool
 */
const introduceTool: ToolDefinition = {
  definition: {
    name: 'swarmbbs.introduce',
    description: 'Register or update agent profile with role and expertise information',
    inputSchema: {
      type: 'object',
      properties: {
        space: {
          type: 'string',
          pattern: '^[A-Za-z0-9._-]+$',
          description: 'Target space (defaults to server-configured space)',
        },
        role: {
          type: 'string',
          minLength: 1,
          maxLength: 128,
          description: 'Agent role or purpose (1-128 characters)',
        },
        expertise: {
          type: 'array',
          items: { type: 'string' },
          maxItems: 20,
          description: 'List of expertise areas or capabilities (max 20)',
        },
      },
      required: ['role'],
      additionalProperties: false,
    },
  },
  handler: async (args: Record<string, unknown>, config: ServerConfig) => {
    const role = args.role as string;
    const expertise = (args.expertise as string[]) || [];
    const space = (args.space as string) || config.defaultSpace;

    return introduce(config.rootDir, config.handle, space, { role, expertise, space });
  },
};

/**
 * send_heartbeat tool
 */
const sendHeartbeatTool: ToolDefinition = {
  definition: {
    name: 'swarmbbs.send_heartbeat',
    description: 'Send a heartbeat to update presence status and prevent timeout',
    inputSchema: {
      type: 'object',
      properties: {
        space: {
          type: 'string',
          pattern: '^[A-Za-z0-9._-]+$',
          description: 'Target space (defaults to server-configured space)',
        },
        status: {
          type: 'string',
          enum: ['available', 'busy', 'away'],
          description: 'Current status (defaults to "available")',
        },
      },
      additionalProperties: false,
    },
  },
  handler: async (args: Record<string, unknown>, config: ServerConfig) => {
    const status = (args.status as 'available' | 'busy' | 'away') || 'available';
    const space = (args.space as string) || config.defaultSpace;

    return sendHeartbeat(config.rootDir, config.handle, space, config.presenceTTL, { status, space });
  },
};

/**
 * who_online tool
 */
const whoOnlineTool: ToolDefinition = {
  definition: {
    name: 'swarmbbs.who_online',
    description: 'Query which agents are currently online (based on recent activity and heartbeats)',
    inputSchema: {
      type: 'object',
      properties: {
        space: {
          type: 'string',
          pattern: '^[A-Za-z0-9._-]+$',
          description: 'Target space (defaults to server-configured space)',
        },
      },
      additionalProperties: false,
    },
  },
  handler: async (args: Record<string, unknown>, config: ServerConfig) => {
    const space = (args.space as string) || config.defaultSpace;

    return whoOnline(config.rootDir, space, config.presenceTTL, { space });
  },
};

/**
 * Register all presence tools
 */
export function registerPresenceTools(registry: Map<string, ToolDefinition>): void {
  registry.set('swarmbbs.introduce', introduceTool);
  registry.set('swarmbbs.send_heartbeat', sendHeartbeatTool);
  registry.set('swarmbbs.who_online', whoOnlineTool);
}

