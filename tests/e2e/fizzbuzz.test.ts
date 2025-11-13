/**
 * E2E FizzBuzz Test - Minimal version using shell orchestration
 *
 * JavaScript only handles verification. All agent coordination is done in shell.
 */

import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { execSync } from 'child_process';
import { E2EVerifier } from './verifier.js';

describe('E2E: FizzBuzz Round-Robin Game', () => {
  const TEST_NAME = 'fizzbuzz';
  const ROOT_DIR = join(process.cwd(), 'test-data', 'e2e', TEST_NAME, 'swarmbbs-data');
  const SPACE = 'default';
  const THREAD = 'game';
  const TIMEOUT_MS = 300000; // 5 minutes

  it('should demonstrate multi-agent coordination with FizzBuzz', async () => {
    try {
      // Run shell script - this does ALL the work
      const result = execSync(
        `bash tests/e2e/runner.sh ${TEST_NAME} 3 300`,
        {
          cwd: process.cwd(),
          encoding: 'utf8',
          timeout: TIMEOUT_MS,
          stdio: 'pipe'  // Capture output
        }
      );

      console.log('\n=== Shell Script Output ===');
      console.log(result);
      console.log('=========================\n');
    } catch (error: any) {
      // If shell script exits with non-zero, show the output
      if (error.stdout) {
        console.log('\n=== Shell Script Output ===');
        console.log(error.stdout);
        console.log('=========================\n');
      }
      if (error.stderr) {
        console.error('\n=== Shell Script Errors ===');
        console.error(error.stderr);
        console.error('=========================\n');
      }
      // Don't fail here - we still want to check what was produced
    }

    // Verify results
    const events = await E2EVerifier.readThreadLog(ROOT_DIR, SPACE, THREAD);

    // If no events, the test didn't run properly
    if (events.length === 0) {
      console.error('No events found in thread log. Test may not have run properly.');
      expect(events.length).toBeGreaterThan(0);
      return;
    }

    // Verify no sequence collisions (FR-063)
    const hasCollisions = E2EVerifier.hasSequenceCollisions(events);
    if (hasCollisions) {
      const duplicates = E2EVerifier.getDuplicateSequences(events);
      console.error('Duplicate sequences found:', duplicates);
    }
    expect(hasCollisions).toBe(false);

    // Verify no read receipt spam (FR-012a)
    const eventCounts = E2EVerifier.countEventsByType(events);
    expect(eventCounts['read'] || 0).toBe(0);

    // Verify all messages have up_to_seq (FR-007)
    expect(E2EVerifier.allMessagesHaveUpToSeq(events)).toBe(true);

    const messages = E2EVerifier.getMessagesInOrder(events);
    const gameMessages = messages.filter(m => /^\d+:/.test(m.text));

    // Verify we got at least 10 game messages showing multi-agent coordination
    expect(gameMessages.length).toBeGreaterThanOrEqual(10);

    // Verify FizzBuzz correctness
    for (const msg of gameMessages) {
      const match = msg.text.match(/^(\d+): (.+)$/);
      if (match) {
        const num = parseInt(match[1], 10);
        const value = match[2];
        const isCorrect = E2EVerifier.verifyFizzBuzz(num, value);
        if (!isCorrect) {
          console.error(`Incorrect FizzBuzz: ${num} should not be ${value}`);
        }
        expect(isCorrect).toBe(true);
      }
    }

    // Check turn-taking pattern (should be A, B, C, A, B, C...)
    if (gameMessages.length >= 4) {
      const agents = gameMessages.map(m => m.from);
      const expectedPattern = ['AgentA', 'AgentB', 'AgentC'];

      // Check first few turns follow the pattern
      for (let i = 0; i < Math.min(6, agents.length); i++) {
        const expected = expectedPattern[i % 3];
        if (agents[i] !== expected) {
          console.warn(`Turn ${i+1}: Expected ${expected} but got ${agents[i]}`);
        }
      }
    }

    console.log('\n✅ E2E FizzBuzz Test Verification Results:');
    console.log(`  Total events: ${events.length}`);
    console.log(`  Message events: ${eventCounts['msg'] || 0}`);
    console.log(`  Game messages: ${gameMessages.length}`);
    console.log(`  Read receipts: ${eventCounts['read'] || 0} ✅`);
    console.log(`  Sequence collisions: ${hasCollisions ? '❌' : '✅ None'}`);
    console.log(`  All have up_to_seq: ✅`);

    if (gameMessages.length > 0) {
      console.log(`\n  First 10 game messages:`);
      for (const msg of gameMessages.slice(0, 10)) {
        console.log(`    [${msg.from}] ${msg.text}`);
      }
    }
  }, TIMEOUT_MS);
});