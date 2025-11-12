#!/usr/bin/env node
/**
 * SwarmBBS MCP Server - Main Entry Point
 *
 * CLI for starting the SwarmBBS MCP server
 */

import { resolve } from 'path';
import { startServer } from './server/mcp-server.js';
import { createToolRegistry } from './server/tool-registry.js';
import type { ServerConfig } from './server/mcp-server.js';

/**
 * Parse command-line arguments
 */
function parseArgs(): ServerConfig {
  const args = process.argv.slice(2);

  let rootDir = process.env.SWARMBBS_ROOT || './swarmbbs-data';
  let handle = process.env.SWARMBBS_HANDLE || '';
  let defaultSpace = process.env.SWARMBBS_SPACE_DEFAULT || 'default';
  let presenceTTL = parseInt(process.env.SWARMBBS_PRESENCE_TTL || '60', 10);

  // Parse flags
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      console.log(`
SwarmBBS MCP Server v1.0.0

Usage: swarmbbs [options]

Options:
  --root <path>           Root directory for storage (default: ./swarmbbs-data)
  --handle <name>         Handle for this agent instance (required)
  --space-default <name>  Default space name (default: default)
  --presence-ttl <secs>   Presence TTL in seconds (default: 60)
  --version, -v           Show version
  --help, -h              Show this help message

Environment Variables:
  SWARMBBS_ROOT           Same as --root
  SWARMBBS_HANDLE         Same as --handle
  SWARMBBS_SPACE_DEFAULT  Same as --space-default
  SWARMBBS_PRESENCE_TTL   Same as --presence-ttl

Examples:
  swarmbbs --handle agent-worker
  swarmbbs --root /data/bbs --handle coordinator --space-default project-x
      `);
      process.exit(0);
    }

    if (arg === '--version' || arg === '-v') {
      console.log('SwarmBBS MCP Server v1.0.0');
      process.exit(0);
    }

    if (arg === '--root' && i + 1 < args.length) {
      rootDir = args[++i];
    } else if (arg === '--handle' && i + 1 < args.length) {
      handle = args[++i];
    } else if (arg === '--space-default' && i + 1 < args.length) {
      defaultSpace = args[++i];
    } else if (arg === '--presence-ttl' && i + 1 < args.length) {
      presenceTTL = parseInt(args[++i], 10);
    }
  }

  // Validate required parameters
  if (!handle) {
    console.error('Error: --handle is required');
    console.error('Provide a handle using --handle flag or SWARMBBS_HANDLE environment variable');
    console.error('Example: swarmbbs --handle agent-worker');
    process.exit(1);
  }

  return {
    rootDir: resolve(rootDir),
    handle,
    defaultSpace,
    presenceTTL,
  };
}

/**
 * Main entry point
 */
async function main() {
  const config = parseArgs();

  // Create tool registry
  const tools = createToolRegistry();

  // Start server
  await startServer(config, tools);
}

// Run main
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
