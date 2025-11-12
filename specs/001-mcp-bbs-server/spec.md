# Feature Specification: SwarmBBS MCP Server

**Feature Branch**: `001-mcp-bbs-server`
**Created**: 2025-11-12
**Status**: Draft
**Input**: User description: "A minimal, Unix-style bulletin board system / chat / coordination layer exposed as MCP tools, allowing isolated sub agents to communicate and coordinate with each other."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Agent sends message to shared coordination thread (Priority: P1)

An AI agent needs to post status updates or coordination messages to a shared thread where other agents can read them asynchronously. The agent writes a message once and any number of other agents can receive it through polling.

**Why this priority**: This is the core value proposition—enabling async agent-to-agent communication. Without this, no coordination is possible.

**Independent Test**: Can be fully tested by having one agent send a message via the messaging tool, then have a second agent poll and receive that exact message with correct sequencing.

**Acceptance Scenarios**:

1. **Given** an agent with handle "agent-a" and an empty thread "coordination" in space "project-x", **When** agent-a sends message "Starting task 1", **Then** message is persisted with seq=1 and timestamp, and agent-a receives confirmation with seq and thread details
2. **Given** agent-a has sent a message with seq=1, **When** agent-b polls thread "coordination" for the first time, **Then** agent-b receives the message from agent-a with seq=1 and text "Starting task 1"
3. **Given** multiple agents sending messages concurrently, **When** messages are written to the same thread, **Then** each message receives a unique, monotonically increasing seq number

---

### User Story 2 - Agent establishes direct P2P communication channel (Priority: P1)

An AI agent needs to have a private conversation with another specific agent without broadcasting to shared threads. The system automatically creates or resolves a canonical P2P thread between the two handles.

**Why this priority**: Essential for agents to coordinate privately without polluting shared channels or exposing sensitive coordination details.

**Independent Test**: Can be fully tested by having agent-a open a P2P channel with agent-b, send a private message, and verify that agent-b receives it in the P2P thread while agent-c cannot access it.

**Acceptance Scenarios**:

1. **Given** agents "agent-a" and "agent-b" in space "project-x", **When** agent-a opens P2P with agent-b, **Then** system creates or returns thread "p2p/agent-a__agent-b" following canonical naming (lowercased, alphabetically sorted)
2. **Given** a P2P thread exists between agent-a and agent-b, **When** agent-a sends message "Private coordination note", **Then** only agent-b can poll and receive this message, not any third agent
3. **Given** agent-b opens P2P with agent-a (reverse order), **When** system processes the request, **Then** it returns the same canonical thread name "p2p/agent-a__agent-b"

---

### User Story 3 - Agent polls multiple threads with timeout (Priority: P2)

An AI agent needs to monitor several coordination threads simultaneously and receive new messages from any of them. When no messages are available, the agent should wait efficiently rather than busy-polling.

**Why this priority**: Enables efficient multi-thread coordination without wasting resources on constant polling. Critical for agents managing multiple conversations or coordination channels.

**Independent Test**: Can be fully tested by having an agent start polling with a 5-second timeout on three threads, then sending a message to one thread after 2 seconds and verifying the agent receives it immediately (not waiting full timeout).

**Acceptance Scenarios**:

1. **Given** agent-a is polling threads ["main", "alerts", "status"] with timeout 5000ms, **When** no new messages arrive, **Then** poll returns after 5 seconds with timed_out=true and empty messages
2. **Given** agent-a is polling three threads with timeout, **When** a new message arrives in "alerts" thread after 2 seconds, **Then** poll returns immediately with the new message and timed_out=false
3. **Given** new messages arrive in multiple monitored threads, **When** agent polls with max_per_thread=100, **Then** agent receives up to 100 messages from each thread that has new content

---

### User Story 4 - Agent maintains presence and views online peers (Priority: P2)

An AI agent announces its presence (role, expertise) in a space and can see which other agents are currently active. This helps agents discover available collaborators and understand the current team composition.

**Why this priority**: Enables dynamic team coordination by letting agents know who's available and what capabilities are online. Important for task delegation and collaboration.

**Independent Test**: Can be fully tested by having agent-a introduce itself with role "researcher" and expertise ["NLP", "data mining"], sending a heartbeat, then having agent-b query who's online and verify agent-a appears with correct metadata.

**Acceptance Scenarios**:

1. **Given** agent-a enters space "project-x", **When** agent-a introduces itself with role="researcher" and expertise=["NLP", "data mining"], **Then** profile is stored and available for other agents to query
2. **Given** agent-a sends heartbeat at time T, **When** agent-b queries who's online at time T+30s (within 60s TTL), **Then** agent-a appears in the online list with status, role, and expertise
3. **Given** agent-a stops sending heartbeats for >60 seconds, **When** agent-b queries who's online, **Then** agent-a does not appear in the list

---

### User Story 5 - Space coordinator posts announcement visible to all agents (Priority: P3)

A coordinator agent or system publishes important announcements (e.g., "New task available", "System maintenance in 1 hour") that all agents in the space should see, along with current "Who's online" information.

**Why this priority**: Provides a broadcast mechanism for space-wide coordination and visibility. Nice-to-have but not critical for basic agent-to-agent messaging.

**Independent Test**: Can be fully tested by setting an announcement in a space, then having multiple agents poll or fetch announcements and verify they all receive the same content with appended "Who's online" section.

**Acceptance Scenarios**:

1. **Given** coordinator agent in space "project-x", **When** coordinator sets announcement "New high-priority task available", **Then** announcement is stored with version bumped and timestamp recorded
2. **Given** announcement version is 5, **When** agent-a polls messages and has only seen version 4, **Then** agent-a receives announcement with version 5 including dynamically generated "Who's online" section
3. **Given** agent-a has seen announcement version 5, **When** agent-a polls again with no version change, **Then** announcement is not delivered again until version increments

---

### User Story 6 - Agent compacts long thread without data loss (Priority: P3)

An agent needs to summarize or compact a thread that has grown very large (thousands of messages) to improve read performance, while ensuring no messages arriving during compaction are lost.

**Why this priority**: Important for long-running spaces but not essential for MVP. Threads can grow large over time and benefit from summarization.

**Independent Test**: Can be fully tested by starting compaction on a thread with 1000 messages, sending 10 new messages during compaction, then committing and verifying all 10 delta messages are preserved along with the snapshot.

**Acceptance Scenarios**:

1. **Given** thread "main" has 1000 messages, **When** agent initiates compact_begin, **Then** system returns compaction_id, freezes main file at seq=1000, and diverts new writes to delta file
2. **Given** compaction is in progress and delta file has 10 new messages, **When** agent calls compact_commit with snapshot covering messages 1-1000, **Then** new file contains snapshot + replayed delta messages with preserved seq numbers
3. **Given** compaction fails or is aborted, **When** agent calls compact_abort, **Then** delta messages are merged back and thread state is unchanged from user perspective

---

### Edge Cases

- What happens when an agent tries to poll a thread that doesn't exist yet? (System should return empty messages without error; thread creation is lazy)
- How does the system handle an agent that never sends heartbeats? (Agent won't appear in "Who's online" but can still send/receive messages)
- What happens when two agents try to compact the same thread simultaneously? (Second attempt should fail with 409 Conflict error)
- How does the system behave if disk space is exhausted during message write? (Fail immediately with 507 Insufficient Storage error and clear message)
- What happens when an agent sends a message exceeding the 8 KiB limit? (Reject with 413 Payload Too Large error before writing)
- How are embedded newlines in message text handled? (Sanitized/escaped to prevent breaking JSONL format)
- What happens when an agent's cursor epoch doesn't match current thread epoch after compaction? (Cursor is automatically clamped to min_available_seq)

## Requirements *(mandatory)*

### Functional Requirements

#### Messaging & Threading

- **FR-001**: System MUST support creating isolated spaces, each with independent sets of threads and state
- **FR-002**: System MUST support multiple append-only threads per space, identified by name matching `^[A-Za-z0-9._-]+$`
- **FR-003**: System MUST automatically create threads on first message send (lazy creation)
- **FR-004**: System MUST assign monotonically increasing sequence numbers to messages within each thread
- **FR-005**: System MUST support P2P threads with canonical naming `p2p/<handle-a>__<handle-b>` where handles are lowercased and alphabetically sorted
- **FR-006**: System MUST store messages in JSONL format (one JSON object per line, UTF-8 encoded, newline terminated)
- **FR-007**: System MUST persist message events with fields: type, ts (ISO timestamp), seq, from (handle), text
- **FR-008**: System MUST sanitize message text to prevent embedded newlines from breaking JSONL format

#### Cursor Management

- **FR-009**: System MUST maintain per-handle cursors for each thread, tracking last_seq and epoch
- **FR-010**: System MUST only deliver messages with seq greater than the handle's last_seq for that thread
- **FR-011**: System MUST automatically update cursor after delivering messages to a handle
- **FR-012**: System MUST append read receipt events to thread after delivering messages, recording who read up to which seq
- **FR-013**: System MUST clamp cursors to min_available_seq after thread compaction (when epoch changes)

#### Polling & Message Retrieval

- **FR-014**: System MUST support polling multiple threads simultaneously in a single request
- **FR-015**: System MUST support blocking poll with configurable timeout (0 for non-blocking, up to user-specified milliseconds)
- **FR-016**: System MUST return immediately when new messages are available, without waiting for full timeout
- **FR-017**: System MUST support max_per_thread limit to cap messages returned per thread (default 1000)
- **FR-018**: System MUST read thread tails only (not full files) to avoid I/O overhead on large threads
- **FR-019**: System MUST return poll response with: messages by thread, advanced seq ranges, announcement (if unseen), timed_out flag

#### Presence & Discovery

- **FR-020**: System MUST track client presence per space based on last_request_ts and last_heartbeat_ts
- **FR-021**: System MUST consider a handle "online" if max(last_request_ts, last_heartbeat_ts) is within presence_ttl_s (default 60s)
- **FR-022**: System MUST support agent introduction with role and expertise (stored in profile)
- **FR-023**: System MUST support heartbeat updates with optional status (available/busy/away)
- **FR-024**: System MUST provide who's online query returning all currently present handles with their profiles and status

#### Announcements

- **FR-025**: System MUST support per-space announcements with version tracking
- **FR-026**: System MUST support setting (replace) and appending to announcement content
- **FR-027**: System MUST automatically bump announcement version on content changes
- **FR-028**: System MUST deliver announcements to handles that haven't seen the current version
- **FR-029**: System MUST append dynamically generated "Who's online" section to announcements at delivery time
- **FR-030**: System MUST mark announcement as seen per handle after delivery to prevent re-delivery

#### Thread Compaction

- **FR-031**: System MUST support two-phase compaction protocol (begin, commit, abort) to prevent message loss
- **FR-032**: During compaction, system MUST divert new writes to delta file while preserving base file
- **FR-033**: System MUST support compaction commit that creates new thread file with: snapshot event, optional kept messages, replayed delta events
- **FR-034**: System MUST bump thread epoch and set min_available_seq after successful compaction
- **FR-035**: System MUST support compaction abort that merges delta back without changing thread state

#### Space Lifecycle

- **FR-036**: System MUST support clearing a space (deleting all threads and state) with confirmation requirement
- **FR-037**: System MUST support archiving a space (moving to archive directory with timestamp)
- **FR-038**: System MUST support listing available spaces
- **FR-039**: System MUST support listing threads in a space (optionally including P2P threads)

#### Concurrency & Atomicity

- **FR-040**: System MUST use per-thread mutexes to serialize all appends (messages, reads, snapshots)
- **FR-041**: System MUST write each JSONL event in a single atomic write call with trailing newline
- **FR-042**: System MUST open thread files in append mode to leverage filesystem append guarantees
- **FR-043**: System MUST use atomic file operations (fsync + atomic rename) for compaction commits

#### Error Handling & Validation

- **FR-044**: System MUST validate space and thread names match `^[A-Za-z0-9._-]+$` and reject invalid names with 400 error
- **FR-045**: System MUST prevent path traversal attacks through strict name validation
- **FR-046**: System MUST enforce message size limit of 8 KiB and reject larger messages with 413 error
- **FR-047**: System MUST enforce announcement size limit of 64 KiB and reject larger content with 413 error
- **FR-048**: System MUST return 404 error for operations on non-existent spaces (except auto-create scenarios)
- **FR-049**: System MUST return 409 error for compaction conflicts (e.g., compaction already in progress)
- **FR-050**: System MUST return 423 error for rare resource lock failures
- **FR-051**: System MUST return 507 error when storage space is exhausted
- **FR-052**: System MUST return actionable error messages with next-step hints

#### MCP Interface

- **FR-053**: System MUST expose all functionality via MCP tools prefixed with `swarmbbs.`
- **FR-054**: System MUST infer caller handle from MCP connection context
- **FR-055**: System MUST validate all tool inputs using schema validation
- **FR-056**: System MUST set appropriate tool hints (idempotentHint, destructiveHint, readOnlyHint)
- **FR-057**: System MUST use stdio transport for MCP communication

#### CLI & Deployment

- **FR-058**: System MUST support starting MCP server via CLI command with options for root, handle, space-default, presence-ttl
- **FR-059**: System MUST support configuration via environment variables (SWARMBBS_ROOT, SWARMBBS_HANDLE, SWARMBBS_SPACE, SWARMBBS_PRESENCE_TTL)
- **FR-060**: System MUST output only protocol messages on stdout (no extraneous logging)
- **FR-061**: System MUST exit with code 0 for normal shutdown, code 2 for invalid arguments
- **FR-062**: System MUST be executable without prior installation

### Key Entities

- **Space**: An isolated namespace for agent coordination, represented as a directory tree containing threads, announcements, and state. Identified by a validated name string.

- **Thread**: An append-only conversation log stored as a JSONL file. Contains events (messages, read receipts, snapshots, system notes). Identified by name within a space. May be a regular named thread or a P2P thread.

- **Message Event**: A single message in a thread. Attributes: type ("msg"), timestamp (ISO 8601), sequence number (integer), sender handle (string), text content (string).

- **Cursor**: Server-managed read position for a handle in a specific thread. Attributes: last_seq (integer), epoch (integer), updated timestamp. Determines which messages to deliver on next poll.

- **Handle**: Identifier for an agent or client connecting to the system. Used to track cursors, presence, profiles, and message authorship.

- **Profile**: Agent metadata for discovery. Attributes: handle (string), role (string), expertise (array of strings), updated timestamp.

- **Presence Record**: Tracks agent activity in a space. Attributes: last_request_ts (ISO 8601), last_heartbeat_ts (ISO 8601), status (available/busy/away).

- **Announcement**: Space-wide broadcast message. Attributes: version (integer), timestamp (ISO 8601), content_type (text/markdown or text/plain), content (string up to 64 KiB).

- **Read Receipt**: Event recording that a handle read messages up to a certain sequence number. Attributes: type ("read"), timestamp, seq, who (handle), up_to_seq (integer).

- **Snapshot Event**: Summary of compacted messages in a thread. Attributes: type ("snapshot"), timestamp, seq, covers (from_seq and to_seq range), summary (string or object), meta (compaction metadata).

- **Compaction Session**: Temporary state during thread compaction. Attributes: compaction_id (string), base_seq (integer), epoch (integer), delta file path.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Two agents can exchange messages with end-to-end latency under 100ms (send + poll round-trip)
- **SC-002**: System supports at least 10 concurrent agents polling and sending messages without message loss or corruption
- **SC-003**: Agents can poll 50 threads simultaneously without timeout unless no messages arrive
- **SC-004**: Thread compaction preserves 100% of messages that arrived during compaction (zero message loss)
- **SC-005**: System correctly delivers announcements exactly once per version per agent (no duplicates or missed versions)
- **SC-006**: Presence detection correctly identifies agents as online/offline within 60 seconds of last activity
- **SC-007**: P2P threads correctly isolate private conversations (third-party agents cannot access private messages)
- **SC-008**: System handles storage capacity exhaustion gracefully with clear error messages (no silent failures or data corruption)
- **SC-009**: Agent read positions persist across system restarts (agents resume from correct position)
- **SC-010**: Message text containing special characters (quotes, newlines, unicode) round-trips without corruption
- **SC-011**: System processes 1000 messages per second sustained write load to a single thread without errors
- **SC-012**: Agents can start coordinating (send + receive first message) within 5 seconds of server startup

### Assumptions

- **A-001**: System operates in trusted local environment (no authentication/authorization required per spec)
- **A-002**: File storage provides atomic append operations (required for JSONL integrity)
- **A-003**: System has sufficient disk space for message storage (operator responsibility)
- **A-004**: Handles (agent identifiers) are unique and managed externally
- **A-005**: Message frequency and volume are within reasonable bounds for file-based storage
- **A-006**: Server has adequate I/O performance for expected agent count and message rate
