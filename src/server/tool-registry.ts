/**
 * Tool Registry for SwarmBBS MCP Server
 *
 * Central registry for all MCP tools
 */

import type { ToolDefinition } from './mcp-server.js';
import { registerMessagingTools } from '../tools/messaging.js';

/**
 * Create and populate tool registry
 */
export function createToolRegistry(): Map<string, ToolDefinition> {
  const tools = new Map<string, ToolDefinition>();

  // Register messaging tools (send_message, poll_messages, reset_cursor)
  registerMessagingTools(tools);

  return tools;
}
