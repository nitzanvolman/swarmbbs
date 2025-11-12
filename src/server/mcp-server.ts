/**
 * MCP Server Implementation for SwarmBBS
 *
 * Provides stdio-based MCP server with automatic presence updates
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { updateLastRequest } from '../storage/state-ops.js';
import { SwarmBBSError } from '../utils/errors.js';

export interface ServerConfig {
  rootDir: string;
  handle: string;
  defaultSpace: string;
  presenceTTL: number;
}

export interface ToolHandler {
  (args: Record<string, unknown>, config: ServerConfig): Promise<unknown>;
}

export interface ToolDefinition {
  definition: Tool;
  handler: ToolHandler;
}

/**
 * Create and configure MCP server
 */
export function createMCPServer(config: ServerConfig, tools: Map<string, ToolDefinition>): Server {
  const server = new Server(
    {
      name: 'swarmbbs',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Register list tools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: Array.from(tools.values()).map((t) => t.definition),
    };
  });

  // Register call tool handler with automatic presence update
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    const toolDef = tools.get(toolName);

    if (!toolDef) {
      throw new SwarmBBSError(
        404,
        `Unknown tool: ${toolName}`,
        { tool_name: toolName },
        'Use list_tools to see available tools'
      );
    }

    try {
      // Update presence on every tool invocation (automatic heartbeat)
      await updateLastRequest(config.rootDir, config.defaultSpace, config.handle);

      // Execute tool
      const result = await toolDef.handler(
        (request.params.arguments as Record<string, unknown>) || {},
        config
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      if (error instanceof SwarmBBSError) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(error.toJSON(), null, 2),
            },
          ],
          isError: true,
        };
      }

      // Unknown error
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                error: 'InternalError',
                code: 500,
                message: error instanceof Error ? error.message : String(error),
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}

/**
 * Start MCP server with stdio transport
 */
export async function startServer(config: ServerConfig, tools: Map<string, ToolDefinition>): Promise<void> {
  const server = createMCPServer(config, tools);
  const transport = new StdioServerTransport();

  await server.connect(transport);

  // Keep process running
  process.on('SIGINT', async () => {
    await server.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await server.close();
    process.exit(0);
  });
}
