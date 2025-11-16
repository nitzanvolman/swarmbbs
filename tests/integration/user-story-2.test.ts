/**
 * Integration Test for User Story 2: P2P Communication
 *
 * Goal: Enable agents to establish private peer-to-peer channels
 * with canonical naming for direct communication.
 *
 * Test Scenario:
 * - Agent-a opens P2P with agent-b and sends a private message
 * - Agent-b receives it in the P2P thread
 * - Agent-c cannot access the P2P thread (by convention)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { openP2P, sendP2P } from '../../src/tools/p2p.js';
import { readThreadAfterSeq, getThreadPath, clearThreadMetadataCache } from '../../src/storage/thread-ops.js';
import { getCursor, updateCursor } from '../../src/storage/cursor-ops.js';
import { canonicalP2PName } from '../../src/utils/validation.js';

describe('User Story 2: P2P Communication', () => {
  let testRoot: string;
  const space = 'project-alpha';

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), 'swarmbbs-us2-test-'));
    clearThreadMetadataCache();
  });

  afterEach(() => {
    if (testRoot && existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
    clearThreadMetadataCache();
  });

  it('should enable private messaging between two agents', async () => {
    // GIVEN: Agent-a and agent-b need to communicate privately
    const agentA = 'agent-a';
    const agentB = 'agent-b';

    // WHEN: Agent-a opens P2P channel with agent-b
    const openResult = await openP2P(testRoot, agentA, space, {
      space,
      peer_handle: agentB,
    });

    // THEN: P2P channel is created with canonical naming
    expect(openResult.success).toBe(true);
    expect(openResult.thread).toBe('p2p/agent-a__agent-b');
    expect(openResult.created).toBe(true);

    // WHEN: Agent-a sends a private message
    const sendResult = await sendP2P(testRoot, agentA, space, {
      space,
      peer_handle: agentB,
      text: 'This is a private message for agent-b',
    });

    // THEN: Message is sent successfully
    expect(sendResult.success).toBe(true);
    expect(sendResult.thread).toBe('p2p/agent-a__agent-b');
    expect(sendResult.seq).toBe(1);
    expect(sendResult.from).toBe(agentA);

    // WHEN: Agent-b polls the P2P thread
    const cursor = await getCursor(testRoot, space, agentB, 'p2p/agent-a__agent-b');
    const lastReadSeq = cursor?.last_seq ?? 0;
    const messages = await readThreadAfterSeq(
      testRoot,
      space,
      'p2p/agent-a__agent-b',
      lastReadSeq
    );

    // THEN: Agent-b receives the private message
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe('msg');
    if (messages[0].type === 'msg') {
      expect(messages[0].from).toBe(agentA);
      expect(messages[0].text).toBe('This is a private message for agent-b');
      expect(messages[0].seq).toBe(1);
    }

    // AND: Cursor is updated
    await updateCursor(testRoot, space, agentB, 'p2p/agent-a__agent-b', 1);
    const updatedCursor = await getCursor(
      testRoot,
      space,
      agentB,
      'p2p/agent-a__agent-b'
    );
    expect(updatedCursor?.last_seq).toBe(1);
  });

  it('should ensure bidirectional communication uses same thread', async () => {
    // GIVEN: Agent-a and agent-b both want to communicate
    const agentA = 'agent-a';
    const agentB = 'agent-b';

    // WHEN: Agent-a sends to agent-b
    const msg1 = await sendP2P(testRoot, agentA, space, {
      space,
      peer_handle: agentB,
      text: 'Hello from A',
    });

    // AND: Agent-b sends to agent-a
    const msg2 = await sendP2P(testRoot, agentB, space, {
      space,
      peer_handle: agentA,
      text: 'Hello from B',
    });

    // THEN: Both messages are in the same canonical thread
    expect(msg1.thread).toBe('p2p/agent-a__agent-b');
    expect(msg2.thread).toBe('p2p/agent-a__agent-b');

    // AND: Sequence numbers are sequential
    expect(msg1.seq).toBe(1);
    expect(msg2.seq).toBe(2);

    // WHEN: Agent-a polls for new messages
    const messagesForA = await readThreadAfterSeq(
      testRoot,
      space,
      'p2p/agent-a__agent-b',
      0 // Read all messages
    );

    // THEN: Agent-a sees both messages in conversation
    expect(messagesForA).toHaveLength(2);
    if (messagesForA[0].type === 'msg' && messagesForA[1].type === 'msg') {
      expect(messagesForA[0].from).toBe(agentA);
      expect(messagesForA[0].text).toBe('Hello from A');
      expect(messagesForA[1].from).toBe(agentB);
      expect(messagesForA[1].text).toBe('Hello from B');
    }
  });

  it('should maintain privacy - agent-c cannot access P2P thread by convention', async () => {
    // GIVEN: Agent-a and agent-b have a private conversation
    const agentA = 'agent-a';
    const agentB = 'agent-b';
    const agentC = 'agent-c';

    // WHEN: Agent-a and agent-b exchange private messages
    await sendP2P(testRoot, agentA, space, {
      space,
      peer_handle: agentB,
      text: 'Secret message from A to B',
    });

    await sendP2P(testRoot, agentB, space, {
      space,
      peer_handle: agentA,
      text: 'Secret reply from B to A',
    });

    // THEN: The P2P thread exists
    const p2pThread = canonicalP2PName(agentA, agentB);
    const threadPath = getThreadPath(testRoot, space, p2pThread);
    expect(existsSync(threadPath)).toBe(true);

    // AND: Agent-c should not poll this thread (by convention)
    // Note: File-level isolation is not enforced, but agents should only
    // poll P2P threads where they are one of the participants

    // Verify agent-c is not part of this P2P thread name
    expect(p2pThread).toBe('p2p/agent-a__agent-b');
    expect(p2pThread).not.toContain('agent-c');

    // If agent-c attempts to generate a P2P thread with agent-a or agent-b,
    // it would be a different thread
    const agentCtoA = canonicalP2PName(agentC, agentA);
    const agentCtoB = canonicalP2PName(agentC, agentB);

    expect(agentCtoA).toBe('p2p/agent-a__agent-c');
    expect(agentCtoB).toBe('p2p/agent-b__agent-c');
    expect(agentCtoA).not.toBe(p2pThread);
    expect(agentCtoB).not.toBe(p2pThread);
  });

  it('should handle concurrent P2P conversations between multiple agents', async () => {
    // GIVEN: Three agents with different P2P pairs
    const agentA = 'agent-a';
    const agentB = 'agent-b';
    const agentC = 'agent-c';

    // WHEN: Multiple P2P conversations happen concurrently
    // A talks to B
    await sendP2P(testRoot, agentA, space, {
      space,
      peer_handle: agentB,
      text: 'A to B private',
    });

    // A talks to C
    await sendP2P(testRoot, agentA, space, {
      space,
      peer_handle: agentC,
      text: 'A to C private',
    });

    // B talks to C
    await sendP2P(testRoot, agentB, space, {
      space,
      peer_handle: agentC,
      text: 'B to C private',
    });

    // THEN: Each P2P pair has its own separate thread
    const threadAB = canonicalP2PName(agentA, agentB);
    const threadAC = canonicalP2PName(agentA, agentC);
    const threadBC = canonicalP2PName(agentB, agentC);

    expect(threadAB).toBe('p2p/agent-a__agent-b');
    expect(threadAC).toBe('p2p/agent-a__agent-c');
    expect(threadBC).toBe('p2p/agent-b__agent-c');

    // AND: Each thread contains only messages for that pair
    const messagesAB = await readThreadAfterSeq(testRoot, space, threadAB, 0);
    const messagesAC = await readThreadAfterSeq(testRoot, space, threadAC, 0);
    const messagesBC = await readThreadAfterSeq(testRoot, space, threadBC, 0);

    expect(messagesAB).toHaveLength(1);
    expect(messagesAC).toHaveLength(1);
    expect(messagesBC).toHaveLength(1);

    if (messagesAB[0].type === 'msg') {
      expect(messagesAB[0].text).toBe('A to B private');
    }
    if (messagesAC[0].type === 'msg') {
      expect(messagesAC[0].text).toBe('A to C private');
    }
    if (messagesBC[0].type === 'msg') {
      expect(messagesBC[0].text).toBe('B to C private');
    }
  });

  it('should handle case-insensitive canonical naming', async () => {
    // GIVEN: Agents with mixed-case handles
    const agentA = 'Agent-Alpha';
    const agentB = 'Agent-Beta';

    // WHEN: Both agents send messages to each other
    const msg1 = await sendP2P(testRoot, agentA, space, {
      space,
      peer_handle: agentB,
      text: 'From Alpha',
    });

    const msg2 = await sendP2P(testRoot, agentB, space, {
      space,
      peer_handle: agentA,
      text: 'From Beta',
    });

    // THEN: Canonical naming uses lowercase
    expect(msg1.thread).toBe('p2p/agent-alpha__agent-beta');
    expect(msg2.thread).toBe('p2p/agent-alpha__agent-beta');

    // AND: Both messages are in the same thread
    const messages = await readThreadAfterSeq(
      testRoot,
      space,
      'p2p/agent-alpha__agent-beta',
      0
    );
    expect(messages).toHaveLength(2);
  });

  it('should support multi-message conversations', async () => {
    // GIVEN: Agent-a and agent-b have an ongoing conversation
    const agentA = 'agent-a';
    const agentB = 'agent-b';

    // WHEN: Multiple messages are exchanged
    await sendP2P(testRoot, agentA, space, {
      space,
      peer_handle: agentB,
      text: 'Message 1 from A',
    });

    await sendP2P(testRoot, agentB, space, {
      space,
      peer_handle: agentA,
      text: 'Message 2 from B',
    });

    await sendP2P(testRoot, agentA, space, {
      space,
      peer_handle: agentB,
      text: 'Message 3 from A',
    });

    await sendP2P(testRoot, agentB, space, {
      space,
      peer_handle: agentA,
      text: 'Message 4 from B',
    });

    // THEN: All messages are in the same thread with sequential seq numbers
    const messages = await readThreadAfterSeq(
      testRoot,
      space,
      'p2p/agent-a__agent-b',
      0
    );

    expect(messages).toHaveLength(4);
    expect(messages.map((m) => m.seq)).toEqual([1, 2, 3, 4]);

    if (
      messages[0].type === 'msg' &&
      messages[1].type === 'msg' &&
      messages[2].type === 'msg' &&
      messages[3].type === 'msg'
    ) {
      expect(messages[0].from).toBe(agentA);
      expect(messages[1].from).toBe(agentB);
      expect(messages[2].from).toBe(agentA);
      expect(messages[3].from).toBe(agentB);
    }
  });

  it('should support cursor-based message tracking per agent', async () => {
    // GIVEN: Agent-a and agent-b have exchanged messages
    const agentA = 'agent-a';
    const agentB = 'agent-b';
    const thread = 'p2p/agent-a__agent-b';

    await sendP2P(testRoot, agentA, space, {
      space,
      peer_handle: agentB,
      text: 'Message 1',
    });

    await sendP2P(testRoot, agentB, space, {
      space,
      peer_handle: agentA,
      text: 'Message 2',
    });

    // WHEN: Agent-a updates cursor after reading first message
    await updateCursor(testRoot, space, agentA, thread, 1);

    // AND: Agent-b updates cursor after reading both messages
    await updateCursor(testRoot, space, agentB, thread, 2);

    // THEN: Each agent has independent cursor position
    const cursorA = await getCursor(testRoot, space, agentA, thread);
    const cursorB = await getCursor(testRoot, space, agentB, thread);

    expect(cursorA?.last_seq).toBe(1);
    expect(cursorB?.last_seq).toBe(2);

    // WHEN: Agent-a polls for new messages
    const newMessagesForA = await readThreadAfterSeq(
      testRoot,
      space,
      thread,
      cursorA?.last_seq ?? 0
    );

    // THEN: Agent-a only sees unread messages
    expect(newMessagesForA).toHaveLength(1);
    if (newMessagesForA[0].type === 'msg') {
      expect(newMessagesForA[0].seq).toBe(2);
      expect(newMessagesForA[0].text).toBe('Message 2');
    }
  });

  it('should reject attempts to create P2P with self', async () => {
    // GIVEN: Agent-a tries to create P2P with itself
    const agentA = 'agent-a';

    // WHEN/THEN: open_p2p should reject
    await expect(async () => {
      await openP2P(testRoot, agentA, space, {
        space,
        peer_handle: agentA,
      });
    }).rejects.toThrow('Cannot open P2P channel with yourself');

    // AND: send_p2p should also reject
    await expect(async () => {
      await sendP2P(testRoot, agentA, space, {
        space,
        peer_handle: agentA,
        text: 'Note to self',
      });
    }).rejects.toThrow('Cannot open P2P channel with yourself');
  });

  it('should handle P2P threads in different spaces', async () => {
    // GIVEN: Same agents in different spaces
    const agentA = 'agent-a';
    const agentB = 'agent-b';
    const space1 = 'project-x';
    const space2 = 'project-y';

    // WHEN: P2P messages are sent in different spaces
    await sendP2P(testRoot, agentA, space1, {
      space: space1,
      peer_handle: agentB,
      text: 'Message in project-x',
    });

    await sendP2P(testRoot, agentA, space2, {
      space: space2,
      peer_handle: agentB,
      text: 'Message in project-y',
    });

    // THEN: Messages are isolated by space
    const messagesSpace1 = await readThreadAfterSeq(
      testRoot,
      space1,
      'p2p/agent-a__agent-b',
      0
    );
    const messagesSpace2 = await readThreadAfterSeq(
      testRoot,
      space2,
      'p2p/agent-a__agent-b',
      0
    );

    expect(messagesSpace1).toHaveLength(1);
    expect(messagesSpace2).toHaveLength(1);

    if (messagesSpace1[0].type === 'msg' && messagesSpace2[0].type === 'msg') {
      expect(messagesSpace1[0].text).toBe('Message in project-x');
      expect(messagesSpace2[0].text).toBe('Message in project-y');
    }
  });
});
