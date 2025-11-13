/**
 * Announcement Tools
 *
 * Tools for space-wide announcements with version tracking and dynamic "Who's online" sections
 */

import type { ToolDefinition, ServerConfig } from '../server/mcp-server.js';
import type { Announcement } from '../types/state.js';
import {
  getAnnouncement,
  setAnnouncement,
  appendAnnouncement as appendAnnouncementStorage,
  getAnnouncementSeen,
  markAnnouncementSeen,
  getWhoIsOnline,
} from '../storage/state-ops.js';
import { assertValidName, validateAnnouncementSize, getByteLength } from '../utils/validation.js';
import { badRequest, payloadTooLarge } from '../utils/errors.js';

const MAX_ANNOUNCEMENT_SIZE = 65536; // 64 KiB

// ============================================================================
// Tool: swarmbbs.announcement_set
// ============================================================================

export interface AnnouncementSetInput {
  space?: string;
  content: string;
  content_type?: 'text/markdown' | 'text/plain';
}

export interface AnnouncementSetOutput {
  success: boolean;
  space: string;
  version: number;
  ts: string;
  content_length: number;
}

/**
 * Announcement set tool - Replace announcement content and bump version
 *
 * @param rootDir - Root directory for storage
 * @param defaultSpace - Default space from server config
 * @param input - Tool input
 * @returns Set confirmation with new version
 */
export async function announcementSet(
  rootDir: string,
  defaultSpace: string,
  input: AnnouncementSetInput
): Promise<AnnouncementSetOutput> {
  const space = input.space || defaultSpace;
  assertValidName(space, 'space');

  const content = input.content;
  const contentType = input.content_type || 'text/plain';

  // Validate content size
  const contentLength = getByteLength(content);
  if (contentLength > MAX_ANNOUNCEMENT_SIZE) {
    throw payloadTooLarge(
      'Announcement content',
      MAX_ANNOUNCEMENT_SIZE,
      contentLength,
      'Reduce announcement size or link to external document instead of embedding full content.'
    );
  }

  // Set announcement (replaces content, bumps version)
  const announcement = await setAnnouncement(rootDir, space, content, contentType);

  return {
    success: true,
    space,
    version: announcement.version,
    ts: announcement.ts,
    content_length: contentLength,
  };
}

// ============================================================================
// Tool: swarmbbs.announcement_append
// ============================================================================

export interface AnnouncementAppendInput {
  space?: string;
  content: string;
  separator?: string;
}

export interface AnnouncementAppendOutput {
  success: boolean;
  space: string;
  version: number;
  ts: string;
  total_content_length: number;
}

/**
 * Announcement append tool - Append content to existing announcement and bump version
 *
 * @param rootDir - Root directory for storage
 * @param defaultSpace - Default space from server config
 * @param input - Tool input
 * @returns Append confirmation with new version
 */
export async function announcementAppend(
  rootDir: string,
  defaultSpace: string,
  input: AnnouncementAppendInput
): Promise<AnnouncementAppendOutput> {
  const space = input.space || defaultSpace;
  assertValidName(space, 'space');

  const content = input.content;

  // Validate content is not empty
  if (!content || content.length === 0) {
    throw badRequest(
      'Content cannot be empty for append operation',
      { field: 'content' },
      'Provide non-empty content to append.'
    );
  }

  // Get current announcement to check size
  const current = await getAnnouncement(rootDir, space);
  const separator = input.separator || '\n\n---\n\n';

  // Calculate new content
  let newContent: string;
  let newContentType: 'text/markdown' | 'text/plain';

  if (current) {
    // If there's an existing announcement, append with separator
    newContent = current.content + separator + content;
    newContentType = current.content_type;
  } else {
    // No existing announcement, just use the new content
    newContent = content;
    newContentType = 'text/plain';
  }

  const totalLength = getByteLength(newContent);

  // Check if appending would exceed limit
  if (totalLength > MAX_ANNOUNCEMENT_SIZE) {
    const currentBytes = current ? getByteLength(current.content) : 0;
    const appendBytes = getByteLength(separator + content);

    throw payloadTooLarge(
      'Announcement content after append',
      MAX_ANNOUNCEMENT_SIZE,
      totalLength,
      `Use announcement_set to replace with shorter content, or compact existing announcement by summarizing older updates. Current: ${currentBytes} bytes, adding: ${appendBytes} bytes.`
    );
  }

  // Append announcement
  const announcement = await setAnnouncement(rootDir, space, newContent, newContentType);

  return {
    success: true,
    space,
    version: announcement.version,
    ts: announcement.ts,
    total_content_length: totalLength,
  };
}

// ============================================================================
// Tool: swarmbbs.announcement_get
// ============================================================================

export interface AnnouncementGetInput {
  space?: string;
}

export interface AnnouncementGetOutput {
  success: boolean;
  space: string;
  version: number;
  ts?: string;
  content_type: 'text/markdown' | 'text/plain';
  content: string;
  has_seen: boolean;
}

/**
 * Generate "Who's online" section dynamically
 *
 * @param rootDir - Root directory for storage
 * @param space - Space name
 * @param presenceTtl - Presence TTL in seconds
 * @param contentType - Content type for formatting
 * @returns Formatted "Who's online" section
 */
async function generateWhosOnlineSection(
  rootDir: string,
  space: string,
  presenceTtl: number,
  contentType: 'text/markdown' | 'text/plain'
): Promise<string> {
  const onlineAgents = await getWhoIsOnline(rootDir, space, presenceTtl);

  if (onlineAgents.length === 0) {
    return '';
  }

  let section = '';

  if (contentType === 'text/markdown') {
    section = '\n\n---\n\n## Who\'s Online\n\n';
    for (const { handle, presence, profile } of onlineAgents) {
      section += `- **${handle}** (${presence.status})`;
      if (profile) {
        section += ` - ${profile.role}`;
        if (profile.expertise.length > 0) {
          section += `\n  Expertise: ${profile.expertise.join(', ')}`;
        }
      }
      section += '\n';
    }
  } else {
    section = '\n\n---\n\nWho\'s Online:\n';
    for (const { handle, presence, profile } of onlineAgents) {
      section += `- ${handle} (${presence.status})`;
      if (profile) {
        section += ` - ${profile.role}`;
        if (profile.expertise.length > 0) {
          section += ` [${profile.expertise.join(', ')}]`;
        }
      }
      section += '\n';
    }
  }

  return section;
}

/**
 * Announcement get tool - Retrieve current announcement with dynamic "Who's online" section
 *
 * @param rootDir - Root directory for storage
 * @param handle - Agent handle
 * @param defaultSpace - Default space from server config
 * @param presenceTtl - Presence TTL in seconds
 * @param input - Tool input
 * @returns Current announcement with "Who's online" appended
 */
export async function announcementGet(
  rootDir: string,
  handle: string,
  defaultSpace: string,
  presenceTtl: number,
  input: AnnouncementGetInput
): Promise<AnnouncementGetOutput> {
  const space = input.space || defaultSpace;
  assertValidName(space, 'space');

  // Get current announcement
  const announcement = await getAnnouncement(rootDir, space);

  // Get last seen version for this handle
  const lastSeenVersion = await getAnnouncementSeen(rootDir, space, handle);

  let version = 0;
  let ts: string | undefined;
  let contentType: 'text/markdown' | 'text/plain' = 'text/plain';
  let content = '';
  let hasSeen = true;

  if (announcement) {
    version = announcement.version;
    ts = announcement.ts;
    contentType = announcement.content_type;
    content = announcement.content;
    hasSeen = lastSeenVersion >= version;
  }

  // Generate and append "Who's online" section
  const whosOnlineSection = await generateWhosOnlineSection(
    rootDir,
    space,
    presenceTtl,
    contentType
  );

  const fullContent = content + whosOnlineSection;

  // Mark as seen if there's a new version
  if (version > 0 && !hasSeen) {
    await markAnnouncementSeen(rootDir, space, handle, version);
  }

  return {
    success: true,
    space,
    version,
    ...(ts && { ts }),
    content_type: contentType,
    content: fullContent,
    has_seen: hasSeen,
  };
}

// ============================================================================
// MCP Tool Definitions
// ============================================================================

/**
 * announcement_set tool
 */
const announcementSetTool: ToolDefinition = {
  definition: {
    name: 'swarmbbs.announcement_set',
    description: 'Set or replace the space-wide announcement (bumps version, invalidates all "has_seen" flags)',
    inputSchema: {
      type: 'object',
      properties: {
        space: {
          type: 'string',
          pattern: '^[A-Za-z0-9._-]+$',
          description: 'Target space (defaults to server-configured space)',
        },
        content: {
          type: 'string',
          maxLength: 65536,
          description: 'Announcement content (max 64 KiB)',
        },
        content_type: {
          type: 'string',
          description: 'Content type (defaults to "text/plain")',
        },
      },
      required: ['content'],
      additionalProperties: false,
    },
  },
  handler: async (args: Record<string, unknown>, config: ServerConfig) => {
    const content = args.content as string;
    const contentType = (args.content_type as 'text/plain' | 'text/markdown') || 'text/plain';
    const space = (args.space as string) || config.defaultSpace;

    return announcementSet(config.rootDir, space, { content, content_type: contentType, space });
  },
};

/**
 * announcement_append tool
 */
const announcementAppendTool: ToolDefinition = {
  definition: {
    name: 'swarmbbs.announcement_append',
    description: 'Append content to existing announcement (bumps version, invalidates all "has_seen" flags)',
    inputSchema: {
      type: 'object',
      properties: {
        space: {
          type: 'string',
          pattern: '^[A-Za-z0-9._-]+$',
          description: 'Target space (defaults to server-configured space)',
        },
        content: {
          type: 'string',
          maxLength: 65536,
          description: 'Content to append (max 64 KiB total after appending)',
        },
      },
      required: ['content'],
      additionalProperties: false,
    },
  },
  handler: async (args: Record<string, unknown>, config: ServerConfig) => {
    const content = args.content as string;
    const space = (args.space as string) || config.defaultSpace;

    return announcementAppend(config.rootDir, space, { content, space });
  },
};

/**
 * announcement_get tool
 */
const announcementGetTool: ToolDefinition = {
  definition: {
    name: 'swarmbbs.announcement_get',
    description: 'Retrieve the current announcement with dynamic "who\'s online" section (automatically marks unseen announcements as seen)',
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

    return announcementGet(config.rootDir, config.handle, space, config.presenceTTL, { space });
  },
};

/**
 * Register all announcement tools
 */
export function registerAnnouncementTools(registry: Map<string, ToolDefinition>): void {
  registry.set('swarmbbs.announcement_set', announcementSetTool);
  registry.set('swarmbbs.announcement_append', announcementAppendTool);
  registry.set('swarmbbs.announcement_get', announcementGetTool);
}

