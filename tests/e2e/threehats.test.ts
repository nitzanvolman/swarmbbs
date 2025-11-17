/**
 * E2E Three Hats Logic Puzzle Test
 *
 * Tests multi-agent logical deduction and coordination.
 * Three agents must deduce their own hat colors based on observations and public announcements.
 *
 * Setup: [Blue, Blue, Red] - AgentA=Blue, AgentB=Blue, AgentC=Red
 *
 * Expected logic:
 * 1. AgentC sees two Blue hats, deduces they must be Red (since at least one is Red)
 * 2. AgentA/AgentB see Blue+Red, can't initially deduce
 * 3. When AgentA/AgentB sees AgentC announce Red, they deduce AgentC saw two Blues
 * 4. Therefore AgentA/AgentB must be Blue
 */

import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { execSync } from 'child_process';
import { E2EVerifier } from './verifier.js';

describe('E2E: Three Hats Logic Puzzle', () => {
  const TEST_NAME = 'threehats';
  const ROOT_DIR = join(process.cwd(), 'test-data', 'e2e', TEST_NAME, 'swarmbbs-data');
  const SPACE = 'default';
  const THREAD = 'game';
  const TIMEOUT_MS = 180000; // 3 minutes

  it('should demonstrate logical deduction through public announcements', async () => {
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

    // Verify we got announcements from at least 2 agents (demonstrates logical deduction)
    const announcements = messages.filter(m => /I am (Red|Blue)/.test(m.text));
    expect(announcements.length).toBeGreaterThanOrEqual(2);

    // Expected results: AgentA=Blue, AgentB=Blue, AgentC=Red
    const expectedColors = {
      'AgentA': 'Blue',
      'AgentB': 'Blue',
      'AgentC': 'Red'
    };

    // Verify each agent announced the correct color
    for (const [agent, expectedColor] of Object.entries(expectedColors)) {
      const agentAnnouncements = announcements.filter(m => m.from === agent);

      if (agentAnnouncements.length === 0) {
        console.warn(`Warning: ${agent} did not announce their color`);
        continue;
      }

      const announcement = agentAnnouncements[0]; // Take first announcement
      const match = announcement.text.match(/I am (Red|Blue)/);

      if (match) {
        const announcedColor = match[1];
        if (announcedColor !== expectedColor) {
          console.error(`${agent} announced ${announcedColor} but should be ${expectedColor}`);
        }
        expect(announcedColor).toBe(expectedColor);
      }
    }

    // Verify logical order: AgentC (Red) should announce first or early
    // since they can deduce immediately by seeing two Blues
    const firstAnnouncement = announcements[0];
    console.log(`\nFirst to announce: ${firstAnnouncement.from} - ${firstAnnouncement.text}`);

    // AgentC should be able to deduce first (though not strictly required due to race conditions)
    if (firstAnnouncement.from === 'AgentC') {
      expect(firstAnnouncement.text).toContain('Red');
    }

    console.log('\n✅ E2E Three Hats Test Verification Results:');
    console.log(`  Total events: ${events.length}`);
    console.log(`  Message events: ${eventCounts['msg'] || 0}`);
    console.log(`  Announcements: ${announcements.length}`);
    console.log(`  Read receipts: ${eventCounts['read'] || 0} ✅`);
    console.log(`  Sequence collisions: ${hasCollisions ? '❌' : '✅ None'}`);
    console.log(`  All have up_to_seq: ✅`);

    console.log(`\n  Hat color announcements:`);
    for (const announcement of announcements) {
      console.log(`    [${announcement.from}] ${announcement.text}`);
    }
  }, TIMEOUT_MS);
});
