/**
 * E2E Test Harness for Multi-Agent Collaboration Testing (FR-065 to FR-071)
 *
 * Spawns multiple headless Claude CLI agents and coordinates their testing.
 */

import { spawn, ChildProcess } from 'child_process';
import { writeFile, mkdir, rm, readFile } from 'fs/promises';
import { join } from 'path';
import type { ThreadEvent } from '../../src/types/events.js';

export interface AgentConfig {
  handle: string;
  prompt: string;
  mcpConfig: {
    mcpServers: {
      swarmbbs: {
        command: string;
        args: string[];
        cwd: string;
      };
    };
  };
}

export interface E2ETestConfig {
  testName: string;
  rootDir: string;
  space: string;
  agents: AgentConfig[];
  timeoutMs: number;
}

export interface AgentProcess {
  handle: string;
  process: ChildProcess;
  stdout: string[];
  stderr: string[];
}

/**
 * E2E Test Harness for spawning and managing Claude agents
 */
export class E2ETestHarness {
  private testConfig: E2ETestConfig;
  private testDir: string;
  private agentProcesses: AgentProcess[] = [];

  constructor(config: E2ETestConfig) {
    this.testConfig = config;
    this.testDir = join(process.cwd(), 'test-data', 'e2e', config.testName);
  }

  /**
   * Setup test environment (FR-066)
   */
  async setup(): Promise<void> {
    // Clean up any existing test data
    await rm(this.testDir, { recursive: true, force: true });
    await mkdir(this.testDir, { recursive: true });

    // Create MCP config files for each agent
    for (const agent of this.testConfig.agents) {
      const configPath = join(this.testDir, `mcp-config-${agent.handle}.json`);
      await writeFile(configPath, JSON.stringify(agent.mcpConfig, null, 2));

      // Create prompt file
      const promptPath = join(this.testDir, `prompt-${agent.handle}.txt`);
      await writeFile(promptPath, agent.prompt);
    }
  }

  /**
   * Start all agents concurrently (FR-067)
   */
  async startAgents(): Promise<void> {
    for (const agent of this.testConfig.agents) {
      const configPath = join(this.testDir, `mcp-config-${agent.handle}.json`);
      const promptPath = join(this.testDir, `prompt-${agent.handle}.txt`);

      // Create shell script wrapper to run agent
      const scriptPath = join(this.testDir, `run-${agent.handle}.sh`);
      const script = `#!/bin/bash
cd "${this.testDir}"
cat "${promptPath}" | claude --mcp-config "${configPath}" --permission-mode bypassPermissions 2>&1
`;
      await writeFile(scriptPath, script, { mode: 0o755 });

      // Spawn shell script
      const process = spawn('bash', [scriptPath], {
        cwd: this.testDir,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      const agentProcess: AgentProcess = {
        handle: agent.handle,
        process,
        stdout: [],
        stderr: []
      };

      // Collect stdout
      process.stdout?.on('data', (data) => {
        agentProcess.stdout.push(data.toString());
      });

      // Collect stderr
      process.stderr?.on('data', (data) => {
        agentProcess.stderr.push(data.toString());
      });

      this.agentProcesses.push(agentProcess);
    }
  }

  /**
   * Wait for test completion with timeout (FR-069)
   */
  async waitForCompletion(checkFn: () => Promise<boolean>): Promise<boolean> {
    const startTime = Date.now();
    const pollInterval = 1000; // Check every second

    while (Date.now() - startTime < this.testConfig.timeoutMs) {
      try {
        const complete = await checkFn();
        if (complete) {
          return true;
        }
      } catch (error) {
        // Ignore errors during polling
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    return false; // Timeout
  }

  /**
   * Stop all agents gracefully (FR-069)
   */
  async stopAgents(): Promise<void> {
    for (const agent of this.agentProcesses) {
      if (!agent.process.killed) {
        agent.process.kill('SIGTERM');
      }
    }

    // Wait for processes to exit
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Force kill if still running
    for (const agent of this.agentProcesses) {
      if (!agent.process.killed) {
        agent.process.kill('SIGKILL');
      }
    }
  }

  /**
   * Get agent outputs
   */
  getAgentOutputs(): Record<string, { stdout: string; stderr: string }> {
    const outputs: Record<string, { stdout: string; stderr: string }> = {};
    for (const agent of this.agentProcesses) {
      outputs[agent.handle] = {
        stdout: agent.stdout.join(''),
        stderr: agent.stderr.join('')
      };
    }
    return outputs;
  }

  /**
   * Read thread log from test root directory (FR-068)
   */
  async readThreadLog(thread: string): Promise<ThreadEvent[]> {
    const threadPath = join(
      this.testConfig.rootDir,
      'spaces',
      this.testConfig.space,
      'threads',
      `${thread}.log`
    );

    try {
      const content = await readFile(threadPath, 'utf8');
      const lines = content.trim().split('\n').filter(line => line.length > 0);
      return lines.map(line => JSON.parse(line) as ThreadEvent);
    } catch {
      return [];
    }
  }

  /**
   * Cleanup test environment
   */
  async cleanup(): Promise<void> {
    await this.stopAgents();
    // Keep test data for debugging - don't delete testDir
  }

  /**
   * Get test directory path
   */
  getTestDir(): string {
    return this.testDir;
  }
}

/**
 * Verification utilities (FR-068)
 */
export class E2EVerifier {
  /**
   * Check for sequence collisions
   */
  static hasSequenceCollisions(events: ThreadEvent[]): boolean {
    const seqs = events.map(e => e.seq);
    const uniqueSeqs = new Set(seqs);
    return seqs.length !== uniqueSeqs.size;
  }

  /**
   * Get duplicate sequences
   */
  static getDuplicateSequences(events: ThreadEvent[]): number[] {
    const seqs = events.map(e => e.seq);
    const seen = new Set<number>();
    const duplicates = new Set<number>();

    for (const seq of seqs) {
      if (seen.has(seq)) {
        duplicates.add(seq);
      }
      seen.add(seq);
    }

    return Array.from(duplicates);
  }

  /**
   * Count events by type
   */
  static countEventsByType(events: ThreadEvent[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const event of events) {
      counts[event.type] = (counts[event.type] || 0) + 1;
    }
    return counts;
  }

  /**
   * Filter events by type
   */
  static filterByType<T extends ThreadEvent>(
    events: ThreadEvent[],
    type: string
  ): T[] {
    return events.filter(e => e.type === type) as T[];
  }

  /**
   * Verify all messages have up_to_seq field
   */
  static allMessagesHaveUpToSeq(events: ThreadEvent[]): boolean {
    const messages = events.filter(e => e.type === 'msg');
    return messages.every(m => 'up_to_seq' in m);
  }

  /**
   * Get messages in order
   */
  static getMessagesInOrder(events: ThreadEvent[]): ThreadEvent[] {
    return events.filter(e => e.type === 'msg').sort((a, b) => a.seq - b.seq);
  }
}
