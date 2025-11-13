/**
 * Minimal E2E Test Verifier - ONLY verification logic, no process management
 */

import { readFile } from 'fs/promises';
import { join } from 'path';
import type { ThreadEvent, MessageEvent } from '../../src/types/events.js';

export class E2EVerifier {
  /**
   * Read and parse thread log
   */
  static async readThreadLog(rootDir: string, space: string, thread: string): Promise<ThreadEvent[]> {
    const threadPath = join(rootDir, 'spaces', space, 'threads', `${thread}.log`);

    try {
      const content = await readFile(threadPath, 'utf8');
      const lines = content.trim().split('\n').filter(line => line.length > 0);
      return lines.map(line => JSON.parse(line) as ThreadEvent);
    } catch {
      return [];
    }
  }

  /**
   * Check for sequence collisions (FR-063)
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
  static filterByType<T extends ThreadEvent>(events: ThreadEvent[], type: string): T[] {
    return events.filter(e => e.type === type) as T[];
  }

  /**
   * Verify all messages have up_to_seq field (FR-007)
   */
  static allMessagesHaveUpToSeq(events: ThreadEvent[]): boolean {
    const messages = events.filter(e => e.type === 'msg');
    return messages.every(m => 'up_to_seq' in m);
  }

  /**
   * Get messages in order
   */
  static getMessagesInOrder(events: ThreadEvent[]): MessageEvent[] {
    return events
      .filter(e => e.type === 'msg')
      .sort((a, b) => a.seq - b.seq) as MessageEvent[];
  }

  /**
   * Verify FizzBuzz correctness
   */
  static verifyFizzBuzz(num: number, value: string): boolean {
    if (num % 15 === 0) return value === 'FizzBuzz';
    if (num % 3 === 0) return value === 'Fizz';
    if (num % 5 === 0) return value === 'Buzz';
    return value === num.toString();
  }
}