/**
 * E2E FizzBuzz Test - Multi-Agent Collaboration (FR-071)
 *
 * Tests 3 headless Claude agents playing FizzBuzz round-robin from 1 to 100.
 * Verifies:
 * - No sequence collisions (FR-063)
 * - No read receipt spam (FR-012a)
 * - All messages have up_to_seq (FR-007)
 * - Proper agent coordination
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'path';
import { E2ETestHarness, E2EVerifier, type AgentConfig } from './harness.js';
import type { MessageEvent } from '../../src/types/events.js';

describe('E2E: FizzBuzz Round-Robin Game', () => {
  const TEST_NAME = 'fizzbuzz-roundrobin';
  const ROOT_DIR = join(process.cwd(), 'test-data', 'e2e', TEST_NAME, 'swarmbbs-data');
  const SPACE = 'default';
  const THREAD = 'game';
  const TIMEOUT_MS = 120000; // 2 minutes

  let harness: E2ETestHarness;

  const FIZZBUZZ_PROMPT = `You are playing a round-robin FizzBuzz game with 2 other agents (AgentA, AgentB, AgentC) using SwarmBBS.

RULES:
- Count from 1 to 20
- Replace multiples of 3 with "Fizz"
- Replace multiples of 5 with "Buzz"
- Replace multiples of both with "FizzBuzz"
- Take turns in order: AgentA → AgentB → AgentC → AgentA...
- Post to thread "game" in space "default"

MAIN GAME LOOP:
You must run this loop continuously until the game reaches 20:

a) Poll the "game" thread with timeout_ms=2000 to get new messages
b) Look at all messages to find the highest number posted so far
c) Determine whose turn it is:
   - If last message was from AgentA, it's AgentB's turn
   - If last message was from AgentB, it's AgentC's turn
   - If last message was from AgentC, it's AgentA's turn
   - If no messages yet, it's AgentA's turn
d) If it's YOUR turn and the number is < 20:
   - Calculate the next number (last + 1)
   - Apply FizzBuzz rules
   - Send your message in format "N: [number or Fizz/Buzz/FizzBuzz]"
e) If it's NOT your turn, go back to step (a) and poll again
f) If the number is >= 20, the game is over - exit
g) Go back to step (a)

IMPORTANT:
- Always check whose turn it is before posting
- Never post out of turn
- Keep looping until game reaches 20
- Start with a brief greeting, then enter the game loop

BEGIN!`;

  const createAgentConfig = (handle: string): AgentConfig => ({
    handle,
    prompt: FIZZBUZZ_PROMPT,
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
    // Create harness with 3 agents
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

    // Setup test environment
    await harness.setup();

    // Start agents
    await harness.startAgents();
  }, TIMEOUT_MS);

  afterAll(async () => {
    await harness.cleanup();
  });

  it('should demonstrate multi-agent coordination with FizzBuzz (at least 5 messages)', async () => {
    // Wait for some coordination to happen - at least 5 messages from different agents
    const completed = await harness.waitForCompletion(async () => {
      const events = await harness.readThreadLog(THREAD);
      const messages = E2EVerifier.filterByType<MessageEvent>(events, 'msg');

      // Look for at least 5 messages from at least 2 different agents
      const uniqueAgents = new Set(messages.map(m => m.from));
      return messages.length >= 5 && uniqueAgents.size >= 2;
    });

    expect(completed).toBe(true);

    // Read final thread log
    const events = await harness.readThreadLog(THREAD);

    // Verify no sequence collisions (FR-063)
    const hasDuplicates = E2EVerifier.hasSequenceCollisions(events);
    expect(hasDuplicates).toBe(false);

    if (hasDuplicates) {
      const duplicates = E2EVerifier.getDuplicateSequences(events);
      console.error('Duplicate sequences found:', duplicates);
    }

    // Verify no read receipt spam (FR-012a)
    const eventCounts = E2EVerifier.countEventsByType(events);
    expect(eventCounts['read'] || 0).toBe(0);

    // Verify all messages have up_to_seq (FR-007)
    const allHaveUpToSeq = E2EVerifier.allMessagesHaveUpToSeq(events);
    expect(allHaveUpToSeq).toBe(true);

    // Get all messages
    const messages = E2EVerifier.getMessagesInOrder(events) as MessageEvent[];

    // Find game messages (format "N: value")
    const gameMessages = messages.filter(m => /^\d+:/.test(m.text));

    // Verify we got at least some game messages (test may not complete full 20 rounds)
    expect(gameMessages.length).toBeGreaterThan(0);

    // Verify FizzBuzz rules applied correctly
    const verifyFizzBuzz = (n: number, value: string): boolean => {
      if (n % 15 === 0) return value === 'FizzBuzz';
      if (n % 3 === 0) return value === 'Fizz';
      if (n % 5 === 0) return value === 'Buzz';
      return value === n.toString();
    };

    for (const msg of gameMessages) {
      const match = msg.text.match(/^(\d+): (.+)$/);
      if (match) {
        const num = parseInt(match[1], 10);
        const value = match[2];
        expect(verifyFizzBuzz(num, value)).toBe(true);
      }
    }

    // Verify round-robin turn taking
    const agentSequence = gameMessages.map(m => m.from);
    const expectedPattern = ['AgentA', 'AgentB', 'AgentC'];

    // Check that agents mostly alternate (allowing for some greetings at start)
    const gameStart = agentSequence.findIndex(h => h === 'AgentA' && gameMessages[agentSequence.indexOf(h)].text.match(/^1:/));
    const actualPattern = agentSequence.slice(gameStart, gameStart + 12);

    // Should see A, B, C, A, B, C... pattern
    expect(actualPattern[0]).toBe('AgentA');
    expect(actualPattern[1]).toBe('AgentB');
    expect(actualPattern[2]).toBe('AgentC');
    expect(actualPattern[3]).toBe('AgentA');

    console.log('\n✅ E2E FizzBuzz Test Results:');
    console.log(`  Total events: ${events.length}`);
    console.log(`  Message events: ${eventCounts['msg'] || 0}`);
    console.log(`  Read receipts: ${eventCounts['read'] || 0} ✅`);
    console.log(`  Game messages: ${gameMessages.length}`);
    console.log(`  Sequence collisions: ${hasDuplicates ? '❌' : '✅ None'}`);
    console.log(`  All have up_to_seq: ${allHaveUpToSeq ? '✅' : '❌'}`);
  }, TIMEOUT_MS);
});
