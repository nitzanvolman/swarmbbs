# Feature Specification: Message Synchronization Validation

**Feature Branch**: `002-message-sync-validation`
**Created**: 2025-11-14
**Status**: Draft
**Input**: User description: "sending a message (to a thread or to p2p) should fail with an error if the client agent is not up to date on the thread. if such an error occurs, the missing messaged should be included in the response, prompting the agent to consider them and try again if relevant (with it's updated context). the client's cursor for the specific thread should be updated to reflect the fact he was shown the new messages. for testing, include an additional fizzbuzz e2e that does not enforce strict turns to test this mechanism."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Agent attempts to send message without reading latest messages (Priority: P1)

An AI agent tries to send a message to a thread (regular or P2P) but hasn't read all messages that were sent since their last interaction. The system detects this out-of-sync state and prevents the send, returning the missing messages so the agent can incorporate them into their context before trying again.

**Why this priority**: This is the core synchronization mechanism that ensures agents always have full context before contributing to a conversation. Without this, agents could send messages based on incomplete information, leading to coordination failures and redundant work.

**Independent Test**: Can be fully tested by having agent-a send message #1, agent-b send message #2, then agent-a (still at cursor seq=1) try to send message #3. System should reject with 409 error and return message #2, then agent-a can retry successfully after processing message #2.

**Acceptance Scenarios**:

1. **Given** thread "coordination" has messages with seq=1 and seq=2, and agent-a's cursor is at last_seq=1, **When** agent-a attempts to send a new message, **Then** system rejects with 409 Conflict error, returns message(s) with seq=2, and advances agent-a's cursor to last_seq=2
2. **Given** agent-a receives missing messages in error response and processes them, **When** agent-a retries sending the message with updated context, **Then** message is accepted and written with next available seq
3. **Given** agent-a's cursor is already at the latest seq for a thread, **When** agent-a sends a message, **Then** message is accepted immediately without sync error

---

### User Story 2 - Agent receives actionable sync error with missing context (Priority: P1)

When a send operation fails due to sync state, the agent receives a clear, actionable error that includes all missing messages and explains what to do next. The error format is structured to make it easy for AI agents to parse and understand.

**Why this priority**: Essential for agents to self-correct and retry autonomously. The error response must be actionable enough that agents can programmatically handle the sync failure without human intervention.

**Independent Test**: Can be fully tested by triggering a sync error and verifying the error response contains: error type (409 Conflict), clear explanation, all missing messages with full metadata (seq, from, ts, text), and suggested next action.

**Acceptance Scenarios**:

1. **Given** a sync error occurs with 3 missing messages, **When** agent receives the error response, **Then** response includes all 3 messages in order with complete metadata (seq, from, ts, text, up_to_seq)
2. **Given** a sync error response is returned, **When** agent parses the error, **Then** error message clearly states "Cannot send: you have unread messages in this thread. Your cursor has been advanced. Please review the messages below and retry if still relevant."
3. **Given** the error includes missing messages, **When** system prepares the response, **Then** messages are ordered by seq and include enough context for agent to understand conversation state

---

### User Story 3 - Agent cursor automatically advances when sync error occurs (Priority: P1)

When a sync error is triggered, the system automatically advances the agent's cursor to mark the missing messages as "seen" in the error response itself. This prevents the same sync error from occurring repeatedly if the agent retries without explicitly polling.

**Why this priority**: Critical for error recovery UX. Without automatic cursor advancement, agents would hit the same sync error repeatedly even after receiving the missing messages in the error response.

**Independent Test**: Can be fully tested by triggering sync error at cursor seq=1 when thread is at seq=5, verifying cursor advances to seq=5, then having agent retry send operation and confirming it succeeds (no second sync error).

**Acceptance Scenarios**:

1. **Given** agent-a's cursor is at seq=1 and thread has messages up to seq=5, **When** sync error occurs, **Then** agent-a's cursor is updated to last_seq=5 before returning error response
2. **Given** cursor was automatically advanced in sync error response, **When** agent retries send immediately after processing missing messages, **Then** no sync error occurs (cursor is already current)
3. **Given** cursor advancement during sync error, **When** agent later polls the thread normally, **Then** poll returns no messages (cursor already reflects latest state)

---

### User Story 4 - Multiple agents coordinate in parallel without strict turn-taking (Priority: P2)

Multiple AI agents work on a shared task (e.g., FizzBuzz) where they can send messages in parallel rather than strict turns. The sync validation ensures each agent incorporates others' contributions before adding their own, even when messages arrive rapidly.

**Why this priority**: Demonstrates that sync validation enables flexible coordination patterns beyond rigid turn-taking. Important for real-world scenarios where agents work asynchronously.

**Independent Test**: Can be fully tested with FizzBuzz e2e test where agents race to post numbers - first agent posts "1", both try to post "2" simultaneously, one succeeds, other gets sync error with "1" and "2", realizes "2" is posted, skips to "3" or "4" based on rules.

**Acceptance Scenarios**:

1. **Given** three agents playing FizzBuzz in parallel without turn enforcement, **When** multiple agents try to post the same number simultaneously, **Then** only one succeeds, others receive sync errors with the winning message
2. **Given** an agent receives a sync error showing another agent posted the number they intended, **When** agent processes the error, **Then** agent skips to next appropriate number based on FizzBuzz rules and current thread state
3. **Given** agents are posting FizzBuzz numbers rapidly, **When** any agent attempts to send, **Then** system ensures agent has seen all prior numbers before allowing contribution

---

### User Story 5 - Sync validation works identically for regular threads and P2P threads (Priority: P2)

The sync validation mechanism applies consistently to both regular named threads and P2P threads. Agents conversing privately receive the same protection against out-of-sync sends.

**Why this priority**: Ensures consistency across all thread types. Prevents confusion and implementation complexity from having different sync behaviors for different thread types.

**Independent Test**: Can be fully tested by repeating basic sync validation test (User Story 1 scenarios) on a P2P thread between agent-a and agent-b, verifying identical error handling and cursor advancement behavior.

**Acceptance Scenarios**:

1. **Given** a P2P thread between agent-a and agent-b, **When** agent-a is out of sync and tries to send, **Then** same 409 error with missing messages is returned as in regular threads
2. **Given** sync error in P2P thread, **When** cursor is advanced, **Then** cursor update is persisted in agent's P2P thread cursor file
3. **Given** both regular and P2P threads exist, **When** sync validation is triggered in each, **Then** error format, cursor advancement, and retry behavior are identical

---

### Edge Cases

- What happens when an agent is out of sync by 100+ messages? (System returns all missing messages up to max_per_thread limit configured, typically 1000; if more than limit, cursor is advanced but agent should poll separately to get full history)
- How does system handle an agent that retries send without processing missing messages? (Message succeeds if cursor was advanced in previous sync error; agent can choose to ignore missing context but cursor prevents repeated sync errors)
- What happens when a sync error occurs during P2P thread auto-creation? (Thread is created, cursors initialized, sync validation proceeds normally - first message might be accepted if no race condition)
- How does the system behave if two agents hit sync errors simultaneously on the same thread? (Each receives error independently with their respective missing messages; cursor advancement is per-handle)
- What happens when sync error includes messages with special characters or very long text? (Messages are returned with same sanitization/escaping as normal poll responses; text truncation follows standard message size limits)
- How are up_to_seq values in sync error messages used? (Included in message metadata to help agents understand what each sender had read when they sent their message; useful for understanding conversation flow)

## Requirements *(mandatory)*

### Functional Requirements

#### Sync Validation Core

- **FR-001**: System MUST validate that sending agent's cursor last_seq matches current thread last_seq before accepting a new message
- **FR-002**: System MUST reject send operations with 409 Conflict error when agent's cursor is behind thread state
- **FR-003**: System MUST include all missing messages in 409 error response, ordered by seq, with complete metadata (seq, from, ts, text, up_to_seq)
- **FR-004**: System MUST automatically advance agent's cursor to current thread last_seq when returning 409 sync error
- **FR-005**: System MUST persist cursor advancement that occurs during sync error (not just return it in response)
- **FR-006**: System MUST apply sync validation to both regular named threads and P2P threads identically

#### Error Response Format

- **FR-007**: System MUST return 409 Conflict HTTP-style error code for sync validation failures
- **FR-008**: System MUST include clear error message explaining sync failure: "Cannot send: you have unread messages in this thread. Your cursor has been advanced. Please review the messages below and retry if still relevant."
- **FR-009**: System MUST include "missing_messages" array in error response with full message objects
- **FR-010**: System MUST include "cursor_advanced" field in error response showing new cursor state (last_seq, epoch)
- **FR-011**: System MUST format error responses to be easily parseable by AI agents (structured JSON/object format)

#### Cursor Management During Sync

- **FR-012**: System MUST read current thread state (latest seq) before validating agent cursor
- **FR-013**: System MUST read agent's cursor for the specific thread being written to
- **FR-014**: System MUST compare cursor last_seq with thread last_seq to determine if agent is out of sync
- **FR-015**: System MUST retrieve all messages from (cursor last_seq + 1) to (thread last_seq) for inclusion in error response
- **FR-016**: System MUST update cursor file atomically during sync error to prevent race conditions
- **FR-017**: System MUST handle epoch changes gracefully during sync validation (cursor epoch mismatch indicates compaction occurred)

#### Send Operation Flow

- **FR-018**: System MUST perform sync validation before writing message to thread
- **FR-019**: System MUST use same thread mutex for sync validation and message write to ensure atomicity
- **FR-020**: System MUST allow send to proceed if cursor last_seq equals thread last_seq (agent is current)
- **FR-021**: System MUST allow send to proceed if agent has no cursor for thread yet (first message to that thread)
- **FR-022**: System MUST write message with up_to_seq field reflecting agent's cursor state at send time

#### Testing Requirements

- **FR-023**: System MUST support e2e test demonstrating sync validation with multiple agents
- **FR-024**: E2E test MUST demonstrate non-strict-turn coordination (FizzBuzz variant without turn enforcement)
- **FR-025**: E2E test MUST verify sync errors are recoverable (agent receives error, processes messages, retries successfully)
- **FR-026**: E2E test MUST verify cursor advancement during sync errors prevents repeated failures
- **FR-027**: E2E test MUST verify sync validation works for both regular and P2P threads

#### Error Handling & Edge Cases

- **FR-028**: System MUST limit missing messages in sync error response to max_per_thread limit (default 1000) to prevent unbounded response size
- **FR-029**: System MUST handle case where cursor epoch differs from thread epoch (post-compaction) by clamping cursor and returning messages from min_available_seq
- **FR-030**: System MUST handle concurrent sync errors on same thread independently (each agent gets their missing messages)
- **FR-031**: System MUST sanitize message text in sync error responses same as in poll responses

### Key Entities

- **Sync Error Response**: Error object returned when send operation fails due to out-of-sync cursor. Attributes: error code (409), error message (string), missing_messages (array of Message Events), cursor_advanced (Cursor object), suggested_action (string).

- **Cursor** (updated): Server-managed read position for a handle in a specific thread. Attributes: last_seq (integer), epoch (integer), updated timestamp. Used for sync validation to determine if agent is current before allowing sends.

- **Message Event** (context): When included in sync error response, contains same fields as normal message: type ("msg"), seq, from, ts, text, up_to_seq.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Agent attempting to send message while out of sync receives error response within 50ms containing all missing messages
- **SC-002**: Agent's cursor is successfully advanced to current thread state during sync error in 100% of cases
- **SC-003**: Agent can successfully retry send operation immediately after receiving sync error without triggering second sync error
- **SC-004**: Multiple agents collaborating on shared task (FizzBuzz) achieve correct results without message loss or duplication in non-strict-turn mode
- **SC-005**: Sync validation error responses contain complete, parseable message metadata enabling autonomous agent recovery
- **SC-006**: System handles 10 concurrent sync errors on same thread without cursor corruption or message delivery failures
- **SC-007**: Sync validation adds less than 10ms latency overhead to successful send operations (when agent is already current)
- **SC-008**: Agents successfully coordinate in parallel FizzBuzz test completing sequence 1-100 with correct Fizz/Buzz/FizzBuzz substitutions despite no turn enforcement
- **SC-009**: Sync validation works identically for regular threads and P2P threads (same error format, cursor behavior, retry flow)

### Assumptions

- **A-001**: Agents are programmed to handle 409 sync errors gracefully (read error response, process missing messages, decide whether to retry)
- **A-002**: Message arrival rate is reasonable enough that sync error responses don't exceed max_per_thread limit frequently
- **A-003**: Cursors and thread files are on same filesystem with consistent atomicity guarantees
- **A-004**: Agents understand that receiving missing messages in error response counts as "seeing" them (cursor advancement is legitimate)
- **A-005**: Clock skew between agents is minimal (timestamps in sync errors are informational, not used for ordering)
