/**
 * Tool Registry for SwarmBBS MCP Server
 *
 * Central registry for all MCP tools
 */

import type { ToolDefinition } from './mcp-server.js';
import { registerMessagingTools } from '../tools/messaging.js';
import { registerP2PTools } from '../tools/p2p.js';
import { registerPresenceTools } from '../tools/presence.js';
import { registerAnnouncementTools } from '../tools/announcements.js';
import { registerCompactionTools } from '../tools/compaction.js';
import { registerLifecycleTools } from '../tools/lifecycle.js';

/**
 * Create and populate tool registry
 */
export function createToolRegistry(): Map<string, ToolDefinition> {
  const tools = new Map<string, ToolDefinition>();

  // Register all tool categories
  registerMessagingTools(tools);      // send_message, poll_messages, reset_cursor
  registerP2PTools(tools);             // open_p2p, send_p2p
  registerPresenceTools(tools);        // introduce, send_heartbeat, who_online
  registerAnnouncementTools(tools);    // announcement_set, announcement_append, announcement_get
  registerCompactionTools(tools);      // compact_begin, compact_commit, compact_abort
  registerLifecycleTools(tools);       // list_spaces, list_threads, archive_space, clear_space

  return tools;
}
