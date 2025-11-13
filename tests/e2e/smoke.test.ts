/**
 * E2E Smoke Test - Minimal version using shell orchestration
 *
 * JavaScript only handles verification. All agent coordination is done in shell.
 */

import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { execSync } from 'child_process';
import { E2EVerifier } from './verifier.js';

describe('E2E: Multi-Agent Smoke Test', () => {
  const TEST_NAME = 'smoke-test';
  const ROOT_DIR = join(process.cwd(), 'test-data', 'e2e', TEST_NAME, 'swarmbbs-data');
  const SPACE = 'default';
  const THREAD = 'game';
  const TIMEOUT_MS = 180000; // 3 minutes

  it('should demonstrate basic multi-agent coordination (FR-071)', async () => {
    try {
      // Run shell script - this does ALL the work
      const result = execSync(
        `bash tests/e2e/runner.sh ${TEST_NAME} 3 180`,
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

    // Now just verify the results
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
    const uniqueAgents = new Set(messages.map(m => m.from));

    // Verify we got coordination between multiple agents
    expect(messages.length).toBeGreaterThanOrEqual(2);
    expect(uniqueAgents.size).toBeGreaterThanOrEqual(2);

    console.log('\n✅ E2E Smoke Test Verification Results:');
    console.log(`  Total events: ${events.length}`);
    console.log(`  Message events: ${eventCounts['msg'] || 0}`);
    console.log(`  Read receipts: ${eventCounts['read'] || 0} ✅`);
    console.log(`  Unique agents: ${uniqueAgents.size}`);
    console.log(`  Sequence collisions: ${hasCollisions ? '❌' : '✅ None'}`);
    console.log(`  All have up_to_seq: ✅`);
    console.log(`\n  Messages:`);
    for (const msg of messages) {
      console.log(`    [${msg.from}] ${msg.text}`);
    }
  }, TIMEOUT_MS);
});