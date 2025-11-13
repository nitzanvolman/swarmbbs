/**
 * E2E Smoke Test - Basic Multi-Agent Coordination (FR-071)
 *
 * Simple test to verify that multiple Claude agents can coordinate through SwarmBBS.
 * Each agent posts one message demonstrating basic functionality.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'path';
import { E2ETestHarness, E2EVerifier, type AgentConfig } from './harness.js';
import type { MessageEvent } from '../../src/types/events.js';

describe('E2E: Multi-Agent Smoke Test', () => {
  const TEST_NAME = 'smoke-test';
  const ROOT_DIR = join(process.cwd(), 'test-data', 'e2e', TEST_NAME, 'swarmbbs-data');
  const SPACE = 'default';
  const THREAD = 'coordination';
  const TIMEOUT_MS = 60000; // 1 minute

  let harness: E2ETestHarness;

  const SIMPLE_PROMPT = `You are testing SwarmBBS multi-agent coordination.

TASK:
1. Send a greeting message to the "coordination" thread saying "Hello from [YourHandle]!"
2. Poll the thread once to see if other agents have posted
3. If you see messages from other agents, send one reply saying "I see N other agents"
4. Exit

Use the SwarmBBS tools to:
- Send your greeting with send_message to thread "coordination"
- Poll with poll_messages on thread "coordination"
- Send your reply if you saw others

Keep it simple - just 1-2 messages total. BEGIN!`;

  const createAgentConfig = (handle: string): AgentConfig => ({
    handle,
    prompt: SIMPLE_PROMPT,
    mcpConfig: {
      mcpServers: {
        swarmbbs: {
          command: 'node',
          args: ['dist/index.js', '--root', ROOT_DIR, '--handle', handle, '--space', SPACE],
          cwd: process.cwd()
        }
      }
    }
  });

  beforeAll(async () => {
    harness = new E2ETestHarness({
      testName: TEST_NAME,
      rootDir: ROOT_DIR,
      space: SPACE,
      agents: [
        createAgentConfig('AgentA'),
        createAgentConfig('AgentB'),
        createAgentConfig('AgentC')
      ],
      timeoutMs: TIMEOUT_MS
    });

    await harness.setup();
    await harness.startAgents();
  }, TIMEOUT_MS);

  afterAll(async () => {
    await harness.cleanup();
  });

  it('should demonstrate basic multi-agent coordination (FR-071)', async () => {
    // Wait for at least 2 agents to post messages
    const completed = await harness.waitForCompletion(async () => {
      const events = await harness.readThreadLog(THREAD);
      const messages = E2EVerifier.filterByType<MessageEvent>(events, 'msg');
      const uniqueAgents = new Set(messages.map(m => m.from));

      // Success if we have messages from at least 2 different agents
      return uniqueAgents.size >= 2;
    });

    expect(completed).toBe(true);

    // Read final thread log
    const events = await harness.readThreadLog(THREAD);

    // Verify no sequence collisions (FR-063)
    const hasDuplicates = E2EVerifier.hasSequenceCollisions(events);
    expect(hasDuplicates).toBe(false);

    // Verify no read receipt spam (FR-012a)
    const eventCounts = E2EVerifier.countEventsByType(events);
    expect(eventCounts['read'] || 0).toBe(0);

    // Verify all messages have up_to_seq (FR-007)
    const allHaveUpToSeq = E2EVerifier.allMessagesHaveUpToSeq(events);
    expect(allHaveUpToSeq).toBe(true);

    const messages = E2EVerifier.getMessagesInOrder(events) as MessageEvent[];
    const uniqueAgents = new Set(messages.map(m => m.from));

    // Verify we got coordination between multiple agents
    expect(messages.length).toBeGreaterThanOrEqual(2);
    expect(uniqueAgents.size).toBeGreaterThanOrEqual(2);

    console.log('\n✅ E2E Smoke Test Results:');
    console.log(`  Total events: ${events.length}`);
    console.log(`  Message events: ${eventCounts['msg'] || 0}`);
    console.log(`  Read receipts: ${eventCounts['read'] || 0} ✅`);
    console.log(`  Unique agents: ${uniqueAgents.size}`);
    console.log(`  Sequence collisions: ${hasDuplicates ? '❌' : '✅ None'}`);
    console.log(`  All have up_to_seq: ${allHaveUpToSeq ? '✅' : '❌'}`);
    console.log(`\n  Messages:`);
    for (const msg of messages) {
      console.log(`    [${msg.from}] ${msg.text}`);
    }
  }, TIMEOUT_MS);
});
