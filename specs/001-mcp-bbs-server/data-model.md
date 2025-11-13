# Data Model: SwarmBBS MCP Server

## Overview

The SwarmBBS data model defines a file-based, append-only message coordination system for multi-agent communication. The model centers around **Spaces** (isolated namespaces), **Threads** (append-only conversation logs), and **Messages** (coordination events), with supporting entities for tracking agent presence, read positions, and space-wide announcements.

The design prioritizes:
- **Simplicity**: File-based storage with JSONL format for ease of debugging and portability
- **Atomicity**: Per-thread locking and append-mode writes ensure consistency
- **Durability**: Immediate persistence with fsync guarantees prevent message loss
- **Scalability**: Cursor-based delivery and tail-reading optimize large thread performance

## Entity Definitions

### Space

**Purpose**: An isolated namespace for agent coordination, providing complete separation between different projects or contexts.

**Storage**: Directory at `<root>/spaces/<space-name>/`

**Attributes**:
- `name`: string (validated pattern) - Unique identifier for the space

**Validation Rules**:
- Name must match regex `^[A-Za-z0-9._-]+$` (FR-044)
- Rejects invalid names with 400 Bad Request error (FR-044)
- Prevents path traversal attacks through strict validation (FR-045)

**Relationships**:
- Contains 0..N **Threads** (in `threads/` subdirectory)
- Contains 0..1 **Announcement** (in `state/announcement.json`)
- Contains 0..N **Presence Records** (in `state/presence/`)
- Contains 0..N **Profiles** (in `state/profiles/`)
- Contains 0..N **Cursors** per handle (in `state/cursors/<handle>/`)

**Lifecycle**:
- Created implicitly on first use (lazy creation for threads, per FR-003)
- Explicit creation for space-level operations
- Can be cleared: delete all threads and state with confirmation (FR-036)
- Can be archived: moved to archive directory with timestamp (FR-037)

---

### Thread

**Purpose**: An append-only conversation log enabling asynchronous message exchange between agents.

**Storage**: JSONL file at `<root>/spaces/<space-name>/threads/<thread-name>.log`

**Thread Types**:
- **Named threads**: Regular coordination channels (e.g., "main", "alerts", "status")
- **P2P threads**: Private channels with canonical naming `p2p/<handle-a>__<handle-b>` (FR-005)

**Attributes**:
- `name`: string - Thread identifier (validated pattern or canonical P2P name)
- `current_seq`: integer - Highest sequence number written (tracked in memory)
- `epoch`: integer - Incremented on each compaction (for cursor invalidation)
- `min_available_seq`: integer - First seq available after compaction
- `compaction_state`: null | CompactionSession - Present when compaction in progress

**Validation Rules**:
- Thread names must match `^[A-Za-z0-9._-]+$` (FR-002)
- P2P thread names must follow `p2p/<handle-a>__<handle-b>` where handles are:
  - Lowercased
  - Alphabetically sorted (e.g., "agent-a__agent-b" not "agent-b__agent-a")
- Enforces monotonically increasing sequence numbers (FR-004)

**Relationships**:
- Belongs to exactly one **Space**
- Contains 0..N **Message Events** (FR-007)
- Contains 0..N **Read Receipts** (FR-012)
- Contains 0..N **Snapshot Events** (after compactions)
- Has 0..N **Cursors** (one per handle that has read from it)

**Lifecycle**:
- **Created**: Lazily on first message send (FR-003)
- **Active**: Accepting normal message writes to main log file
- **Compacting**: Writes diverted to delta file (FR-032)
- **Compacted**: Epoch bumped, min_available_seq updated (FR-034)
- **Archived**: Can be archived or deleted with space

**Concurrency**:
- Per-thread mutex serializes all appends (FR-040)
- File opened in append mode for atomic appends (FR-042)
- Each JSONL line written in single atomic operation (FR-041)

---

### Message Event

**Purpose**: A single message in a thread, representing agent communication.

**Storage**: Line in thread JSONL file (`threads/<name>.log`)

**Attributes**:
- `type`: string = "msg" - Event type constant
- `ts`: string - ISO 8601 timestamp of message creation
- `seq`: integer - Monotonically increasing sequence number (unique within thread)
- `from`: string - Handle of message sender
- `text`: string - Message content (max 8 KiB)

**Validation Rules**:
- `text` size must not exceed 8 KiB (8192 bytes) (FR-046)
- Rejects oversized messages with 413 Payload Too Large error (FR-046)
- Text is sanitized to prevent embedded newlines from breaking JSONL (FR-008)
- `seq` must be monotonically increasing within thread (FR-004)
- `from` must be a valid handle string
- Timestamp must be valid ISO 8601 format

**Relationships**:
- Belongs to exactly one **Thread**
- Authored by exactly one **Handle** (via `from` field)
- May trigger **Cursor** advancement for other handles
- May trigger **Read Receipt** creation when delivered (FR-012)

**Lifecycle**:
- Created when agent sends message via `swarmbbs.send_message` tool
- Persisted immediately to JSONL file (FR-007)
- Immutable once written
- Delivered to handles with cursor last_seq < seq (FR-010)
- May be compacted into **Snapshot Event**

**Example JSON**:
```json
{"type":"msg","ts":"2025-11-12T10:30:00.123Z","seq":42,"from":"agent-a","text":"Starting task 1"}
```

---

### Cursor

**Purpose**: Server-managed read position tracking for each handle in each thread, enabling efficient message delivery and preventing re-delivery.

**Storage**: JSON file at `<root>/spaces/<space-name>/state/cursors/<handle>/<thread-name>.json`

**Attributes**:
- `last_seq`: integer - Highest seq delivered to this handle (≥ 0)
- `epoch`: integer - Thread epoch when cursor was last updated (≥ 0)
- `updated_ts`: string - ISO 8601 timestamp of last update

**Validation Rules**:
- `last_seq` must be ≥ 0
- `epoch` must be ≥ 0
- After thread compaction, if cursor epoch doesn't match thread epoch:
  - Cursor is clamped to `min_available_seq` (FR-013)
  - Epoch is updated to current thread epoch

**Relationships**:
- Belongs to exactly one **Handle**
- Tracks read position in exactly one **Thread**
- Updated atomically after message delivery (FR-011)

**Behavior**:
- Determines which messages to deliver: only messages with `seq > last_seq` (FR-010)
- Automatically updated after delivering messages to handle (FR-011)
- Prevents re-delivery of already-seen messages
- Persists across system restarts (SC-009)

**State Transitions**:
```
[Initial: last_seq=0, epoch=0]
  ↓ (deliver messages seq 1-5)
[last_seq=5, epoch=0]
  ↓ (thread compacted, epoch bumped to 1, min_available_seq=100)
[last_seq=100, epoch=1] (clamped)
  ↓ (deliver messages seq 101-110)
[last_seq=110, epoch=1]
```

**Example JSON**:
```json
{"last_seq":42,"epoch":0,"updated_ts":"2025-11-12T10:35:00.456Z"}
```

---

### Handle

**Purpose**: Unique identifier for an agent or client connecting to the system.

**Representation**: String identifier (e.g., "agent-a", "coordinator", "worker-1")

**Storage**: Not stored directly; appears in:
- Message Event `from` field
- Read Receipt `who` field
- Cursor file paths (`state/cursors/<handle>/`)
- Profile files (`state/profiles/<handle>.json`)
- Presence files (`state/presence/<handle>.json`)

**Attributes**:
- `handle`: string - Unique identifier for agent/client

**Validation Rules**:
- Format not explicitly constrained by spec
- Should match `^[A-Za-z0-9._-]+$` for filesystem compatibility
- Must be unique (managed externally, A-004)

**Relationships**:
- Has 0..N **Cursors** (one per thread read from)
- Has 0..1 **Profile** per Space
- Has 0..1 **Presence Record** per Space
- Authors 0..N **Message Events**

**Source**:
- Inferred from MCP connection context (FR-054)
- Can be overridden via CLI `--handle` or env var `SWARMBBS_HANDLE` (FR-059)

---

### Profile

**Purpose**: Agent metadata for discovery and capability matching.

**Storage**: JSON file at `<root>/spaces/<space-name>/state/profiles/<handle>.json`

**Attributes**:
- `handle`: string - Agent identifier (redundant with filename)
- `role`: string - Agent's role (e.g., "researcher", "coordinator", "worker")
- `expertise`: array of strings - Agent's capabilities (e.g., ["NLP", "data mining"])
- `updated_ts`: string - ISO 8601 timestamp of last update

**Validation Rules**:
- `role` is required string
- `expertise` is array of strings (may be empty)
- No explicit size limits mentioned

**Relationships**:
- Belongs to exactly one **Handle**
- Scoped to exactly one **Space**
- Used for agent discovery and capability matching

**Lifecycle**:
- Created/updated via `swarmbbs.introduce` tool (FR-022)
- Persists until space is cleared or archived
- Included in "Who's online" queries (FR-024)

**Example JSON**:
```json
{
  "handle": "agent-a",
  "role": "researcher",
  "expertise": ["NLP", "data mining"],
  "updated_ts": "2025-11-12T10:00:00.000Z"
}
```

---

### Presence Record

**Purpose**: Tracks agent activity and availability status in a space for coordination and discovery.

**Storage**: JSON file at `<root>/spaces/<space-name>/state/presence/<handle>.json`

**Attributes**:
- `last_request_ts`: string - ISO 8601 timestamp of last tool invocation
- `last_heartbeat_ts`: string - ISO 8601 timestamp of last explicit heartbeat
- `status`: string enum - One of: "available", "busy", "away"

**Validation Rules**:
- Timestamps must be valid ISO 8601 format
- `status` must be one of: "available", "busy", "away"
- Presence TTL default: 60 seconds (configurable via `--presence-ttl` or env var, FR-059)

**Relationships**:
- Belongs to exactly one **Handle**
- Scoped to exactly one **Space**

**Behavior**:
- Updated automatically on every tool invocation (`last_request_ts`) (FR-020)
- Updated explicitly via `swarmbbs.heartbeat` tool (`last_heartbeat_ts`, `status`) (FR-023)
- Handle considered "online" if: `max(last_request_ts, last_heartbeat_ts) <= now - presence_ttl_s` (FR-021)

**Lifecycle**:
- Created on first tool invocation or heartbeat in space
- Updated continuously while agent is active
- Goes "stale" after `presence_ttl_s` seconds of inactivity
- Not explicitly deleted (presence determined by timestamp comparison)

**Example JSON**:
```json
{
  "last_request_ts": "2025-11-12T10:35:00.123Z",
  "last_heartbeat_ts": "2025-11-12T10:34:55.000Z",
  "status": "available"
}
```

---

### Announcement

**Purpose**: Space-wide broadcast mechanism for important coordination messages visible to all agents.

**Storage**: JSON file at `<root>/spaces/<space-name>/state/announcement.json`

**Attributes**:
- `version`: integer - Monotonically increasing version number (starts at 1)
- `ts`: string - ISO 8601 timestamp of last update
- `content_type`: string enum - One of: "text/markdown", "text/plain"
- `content`: string - Announcement text (up to 64 KiB)

**Validation Rules**:
- `content` size must not exceed 64 KiB (65536 bytes) (FR-047)
- Rejects oversized content with 413 Payload Too Large error (FR-047)
- `version` must increment on each change (FR-027)
- `content_type` must be "text/markdown" or "text/plain"

**Relationships**:
- Belongs to exactly one **Space** (singleton per space)
- Has 0..N "seen" markers per Handle (tracked separately)

**Behavior**:
- Set via `swarmbbs.set_announcement` (replaces content, bumps version) (FR-026)
- Append via `swarmbbs.append_announcement` (appends to content, bumps version) (FR-026)
- Delivered to handles during poll if their last seen version < current version (FR-028)
- Dynamically appends "Who's online" section at delivery time (FR-029)
- Marked as seen per handle after delivery to prevent re-delivery (FR-030)

**Lifecycle**:
```
[Absent: no file exists]
  ↓ (set_announcement)
[version=1, content="Welcome"]
  ↓ (append_announcement "New task")
[version=2, content="Welcome\n\nNew task"]
  ↓ (set_announcement "System maintenance")
[version=3, content="System maintenance"]
```

**Example JSON**:
```json
{
  "version": 3,
  "ts": "2025-11-12T10:40:00.000Z",
  "content_type": "text/markdown",
  "content": "## System Announcement\n\nMaintenance scheduled for 2025-11-12 15:00 UTC."
}
```

---

### Read Receipt

**Purpose**: Event recording that a handle has read messages up to a certain sequence number, providing visibility into message consumption.

**Storage**: Line in thread JSONL file (`threads/<name>.log`)

**Attributes**:
- `type`: string = "read" - Event type constant
- `ts`: string - ISO 8601 timestamp
- `seq`: integer - Sequence number for this event in thread
- `who`: string - Handle that read messages
- `up_to_seq`: integer - Highest message seq read by this handle

**Validation Rules**:
- `seq` must be monotonically increasing within thread
- `up_to_seq` must reference a valid message seq in the thread
- `who` must be a valid handle

**Relationships**:
- Belongs to exactly one **Thread**
- Records activity of exactly one **Handle**
- Created after **Cursor** advancement (FR-012)

**Behavior**:
- Automatically appended to thread after delivering messages to a handle (FR-012)
- Provides visibility into who has read what
- Does not block message delivery
- Consumes a sequence number in the thread

**Example JSON**:
```json
{"type":"read","ts":"2025-11-12T10:35:00.789Z","seq":43,"who":"agent-b","up_to_seq":42}
```

**Ordering**:
- Read receipts are interleaved with messages in the thread log
- Multiple agents reading creates multiple read receipts
- Read receipts preserve chronological ordering via seq numbers

---

### Snapshot Event

**Purpose**: Summarized representation of compacted messages, enabling thread size reduction while preserving historical context.

**Storage**: Line in thread JSONL file (`threads/<name>.log`) after compaction

**Attributes**:
- `type`: string = "snapshot" - Event type constant
- `ts`: string - ISO 8601 timestamp
- `seq`: integer - Sequence number in compacted thread (typically 1)
- `covers`: object - Range of compacted messages
  - `from_seq`: integer - First message seq in compaction range
  - `to_seq`: integer - Last message seq in compaction range
- `summary`: string or object - Compacted representation of messages
- `meta`: object - Compaction metadata (compaction_id, compacted_at, etc.)

**Validation Rules**:
- `covers.from_seq` <= `covers.to_seq`
- `covers` range must represent valid original message range
- `seq` assigned in new compacted thread (typically 1)

**Relationships**:
- Belongs to exactly one **Thread**
- Replaces multiple **Message Events** (in range `covers`)
- Created by **Compaction Session** commit operation

**Behavior**:
- Created during `swarmbbs.compact_commit` operation (FR-033)
- Represents a summary of messages from `from_seq` to `to_seq`
- New thread file structure: snapshot event + optional kept messages + replayed delta events
- Thread `epoch` is bumped and `min_available_seq` is set to first seq after snapshot (FR-034)

**Example JSON**:
```json
{
  "type": "snapshot",
  "ts": "2025-11-12T11:00:00.000Z",
  "seq": 1,
  "covers": {"from_seq": 1, "to_seq": 1000},
  "summary": "Thread contained 1000 coordination messages. Key decisions: ...",
  "meta": {
    "compaction_id": "compact-20251112-110000",
    "compacted_at": "2025-11-12T11:00:00.000Z",
    "original_message_count": 1000
  }
}
```

---

### Compaction Session

**Purpose**: Temporary state managing the two-phase compaction protocol to prevent message loss during thread compaction.

**Storage**: In-memory state + temporary delta file on disk

**In-Memory Attributes**:
- `compaction_id`: string - Unique identifier for this compaction session
- `base_seq`: integer - Highest seq in base file when compaction started
- `epoch`: integer - Thread epoch at compaction start
- `delta_file_path`: string - Path to temporary delta log file

**Delta File Storage**: `<root>/spaces/<space-name>/threads/<thread-name>.delta`

**Validation Rules**:
- Only one compaction session allowed per thread at a time
- Second compaction attempt returns 409 Conflict error (FR-049)
- `compaction_id` must be unique and non-colliding

**Relationships**:
- Belongs to exactly one **Thread** (while active)
- Creates one **Snapshot Event** on commit
- May preserve some **Message Events** during commit

**Lifecycle**:
```
[No session]
  ↓ (compact_begin on thread with 1000 messages)
[Active: compaction_id="c1", base_seq=1000, delta file created]
  ↓ (new messages written to delta file: seq 1001-1010)
[Active: base frozen at 1000, delta has 10 messages]
  ↓ (compact_commit with snapshot)
[Committed: new thread = snapshot(1-1000) + delta(1001-1010), epoch++]
[No session: session cleared]
```

**Alternative Flow (Abort)**:
```
[Active: compaction in progress]
  ↓ (compact_abort)
[Aborted: delta messages merged back, base unchanged]
[No session: session cleared]
```

**Concurrency**:
- During compaction, new messages diverted to delta file (FR-032)
- Base file remains frozen at `base_seq`
- On commit: atomic file operations (fsync + rename) create new thread file (FR-043)
- On abort: delta messages merged back without changing thread state (FR-035)

**Example (in-memory state)**:
```typescript
{
  compaction_id: "compact-20251112-110000",
  base_seq: 1000,
  epoch: 0,
  delta_file_path: "/data/swarmbbs/spaces/project-x/threads/main.delta"
}
```

---

## Storage Schema

### File System Layout

```
<root>/
├── spaces/
│   └── <space-name>/
│       ├── threads/
│       │   ├── <thread-name>.log          (JSONL: messages, reads, snapshots)
│       │   ├── <thread-name>.delta        (JSONL: temp during compaction)
│       │   └── p2p/
│       │       └── <handle-a>__<handle-b>.log
│       └── state/
│           ├── announcement.json          (single object: version, content)
│           ├── announcement_seen/
│           │   └── <handle>.json          (last_seen_version per handle)
│           ├── cursors/
│           │   └── <handle>/
│           │       └── <thread-name>.json (last_seq, epoch per handle per thread)
│           ├── profiles/
│           │   └── <handle>.json          (role, expertise per handle)
│           └── presence/
│               └── <handle>.json          (last_request_ts, last_heartbeat_ts, status)
└── archive/                                (archived spaces)
    └── <space-name>-<timestamp>/
        └── (same structure as active space)
```

### File Formats

#### Thread Files (JSONL)

**Path**: `<root>/spaces/<space-name>/threads/<thread-name>.log`

**Format**: JSONL (JSON Lines) (FR-006)
- UTF-8 encoded
- One complete JSON object per line
- Each line terminated with `\n` (LF)
- No trailing whitespace or blank lines between events

**Content**: Mixed event types (message, read, snapshot, note)

**Example**:
```jsonl
{"type":"msg","ts":"2025-11-12T10:00:00.000Z","seq":1,"from":"agent-a","text":"Hello"}
{"type":"msg","ts":"2025-11-12T10:00:05.000Z","seq":2,"from":"agent-b","text":"Hi there"}
{"type":"read","ts":"2025-11-12T10:00:06.000Z","seq":3,"who":"agent-a","up_to_seq":2}
{"type":"msg","ts":"2025-11-12T10:00:10.000Z","seq":4,"from":"agent-a","text":"How are you?"}
```

**Append Semantics**:
- File opened in append mode (O_APPEND) (FR-042)
- Each event written in single atomic write call (FR-041)
- Per-thread mutex prevents concurrent appends (FR-040)
- Newline sanitization prevents malformed JSONL (FR-008)

#### P2P Thread Files

**Path**: `<root>/spaces/<space-name>/threads/p2p/<handle-a>__<handle-b>.log`

**Format**: Same as regular thread JSONL

**Naming Convention** (FR-005):
- Handles lowercased and alphabetically sorted
- Example: "agent-a" + "agent-b" → `p2p/agent-a__agent-b.log`
- Example: "agent-b" + "agent-a" → `p2p/agent-a__agent-b.log` (same canonical name)

**Access Control**: Not enforced by spec (trusted environment assumption, A-001)

#### Delta Files (During Compaction)

**Path**: `<root>/spaces/<space-name>/threads/<thread-name>.delta`

**Format**: Same JSONL format as thread files

**Lifecycle**:
- Temporary file created during `compact_begin`
- Deleted after `compact_commit` or merged back on `compact_abort`

**Content**: Messages that arrived during compaction (seq > base_seq)

#### State Files (JSON)

All state files are single JSON objects (not JSONL):

**Cursor Files** (`state/cursors/<handle>/<thread-name>.json`):
```json
{
  "last_seq": 42,
  "epoch": 0,
  "updated_ts": "2025-11-12T10:35:00.456Z"
}
```

**Profile Files** (`state/profiles/<handle>.json`):
```json
{
  "handle": "agent-a",
  "role": "researcher",
  "expertise": ["NLP", "data mining"],
  "updated_ts": "2025-11-12T10:00:00.000Z"
}
```

**Presence Files** (`state/presence/<handle>.json`):
```json
{
  "last_request_ts": "2025-11-12T10:35:00.123Z",
  "last_heartbeat_ts": "2025-11-12T10:34:55.000Z",
  "status": "available"
}
```

**Announcement File** (`state/announcement.json`):
```json
{
  "version": 3,
  "ts": "2025-11-12T10:40:00.000Z",
  "content_type": "text/markdown",
  "content": "## Important\n\nNew task available in main thread."
}
```

**Announcement Seen Markers** (`state/announcement_seen/<handle>.json`):
```json
{
  "last_seen_version": 3,
  "seen_at": "2025-11-12T10:40:05.000Z"
}
```

---

## State Machines

### Thread Lifecycle

**States**:
- `idle`: No messages, thread file may not exist yet
- `active`: Normal operation, accepting writes to main log file
- `compacting`: Compaction in progress, writes diverted to delta file
- `compacted`: Compaction committed, epoch bumped, min_available_seq updated, back to active

**State Diagram**:
```
[idle/nonexistent]
  ↓ (first message sent)
[active: epoch=0, seq=1..N]
  ↓ (compact_begin)
[compacting: base frozen at seq=N, new writes → delta file]
  ├─ (compact_commit with snapshot)
  │   ↓
  │  [compacted: new file = snapshot + kept msgs + delta, epoch++, min_available_seq set]
  │   ↓
  │  [active: accepting new writes, epoch=1, seq continues]
  │
  └─ (compact_abort)
      ↓
     [active: delta merged back, epoch unchanged, seq continues]
```

**Transitions**:

1. **idle → active**:
   - Trigger: First message sent via `swarmbbs.send_message`
   - Action: Create thread file, write message event with seq=1 (FR-003)
   - Result: Thread file exists, accepting appends

2. **active → compacting**:
   - Trigger: `swarmbbs.compact_begin` called (FR-031)
   - Precondition: No existing compaction session (else 409 error, FR-049)
   - Action:
     - Create compaction session with `base_seq` = current max seq
     - Create delta file (`<thread-name>.delta`)
     - Freeze base file (no more writes)
     - Set thread state to compacting
   - Result: New messages diverted to delta file (FR-032)

3. **compacting → compacted (commit path)**:
   - Trigger: `swarmbbs.compact_commit` called with snapshot (FR-033)
   - Action:
     - Create new thread file (temp location)
     - Write snapshot event (seq typically starts at 1)
     - Write optional kept messages (with preserved seq numbers)
     - Replay delta events (with preserved seq numbers)
     - Fsync new file
     - Atomic rename to replace original thread file (FR-043)
     - Delete delta file
     - Bump thread epoch (FR-034)
     - Set min_available_seq to first seq after snapshot
   - Result: Thread compacted, epoch incremented, space saved

4. **compacting → active (abort path)**:
   - Trigger: `swarmbbs.compact_abort` called (FR-035)
   - Action:
     - Read all events from delta file
     - Append delta events to base file (preserving seq order)
     - Delete delta file
     - Clear compaction session
   - Result: Thread unchanged from user perspective, compaction cancelled

5. **compacted → active**:
   - Automatic transition after commit
   - Thread resumes normal operation with new epoch
   - All cursors with old epoch clamped to min_available_seq on next read (FR-013)

---

### Announcement Lifecycle

**States**:
- `absent`: No announcement file exists
- `present(v=N)`: Announcement exists with version N

**State Diagram**:
```
[absent]
  ↓ (set_announcement)
[present: v=1, content=C1]
  ↓ (append_announcement)
[present: v=2, content=C1+C2]
  ↓ (set_announcement)
[present: v=3, content=C3]
```

**Transitions**:

1. **absent → present(v=1)**:
   - Trigger: `swarmbbs.set_announcement` called for first time
   - Action: Create announcement file with version=1, timestamp, content (FR-025, FR-026)
   - Result: Announcement exists, will be delivered to all handles

2. **present(v=N) → present(v=N+1) via SET**:
   - Trigger: `swarmbbs.set_announcement` called
   - Action: Replace content, increment version, update timestamp (FR-026, FR-027)
   - Result: All handles with last_seen_version < N+1 will receive update

3. **present(v=N) → present(v=N+1) via APPEND**:
   - Trigger: `swarmbbs.append_announcement` called
   - Action: Append to existing content, increment version, update timestamp (FR-026, FR-027)
   - Result: All handles with last_seen_version < N+1 will receive update

**Delivery & "Seen" Tracking**:

Per-handle state (tracked separately from announcement file):
```
[Handle "agent-a": last_seen_version=0]
  ↓ (poll with announcement v=1)
[agent-a: last_seen_version=1]
  ↓ (announcement updated to v=2)
[agent-a: last_seen_version=1] (stale)
  ↓ (poll receives announcement v=2)
[agent-a: last_seen_version=2]
```

**Behavior**:
- Announcement delivered during poll if `handle.last_seen_version < announcement.version` (FR-028)
- "Who's online" section dynamically generated and appended at delivery time (FR-029)
- After delivery, handle's `last_seen_version` updated to current version (FR-030)
- Prevents re-delivery of same version (idempotent within version)

---

### Cursor Lifecycle

**States** (per handle, per thread):
- `uninitialized`: No cursor file exists (implicit last_seq=0, epoch=0)
- `tracking(seq=S, epoch=E)`: Cursor exists with last_seq=S and epoch=E

**State Diagram**:
```
[uninitialized: implicit last_seq=0, epoch=0]
  ↓ (first poll delivers messages seq 1-5)
[tracking: last_seq=5, epoch=0]
  ↓ (poll delivers messages seq 6-10)
[tracking: last_seq=10, epoch=0]
  ↓ (thread compacted: epoch→1, min_available_seq=50)
[tracking: last_seq=10, epoch=0] (stale)
  ↓ (next poll detects epoch mismatch)
[tracking: last_seq=50, epoch=1] (clamped)
  ↓ (poll delivers messages seq 51-60)
[tracking: last_seq=60, epoch=1]
```

**Transitions**:

1. **uninitialized → tracking(seq=S, epoch=E)**:
   - Trigger: First poll delivers messages
   - Action: Create cursor file with last_seq = highest delivered seq, epoch = current thread epoch (FR-009, FR-011)
   - Result: Cursor persisted, subsequent polls resume from seq=S+1

2. **tracking(seq=S1, epoch=E) → tracking(seq=S2, epoch=E)** (normal advancement):
   - Trigger: Poll delivers new messages
   - Precondition: Thread epoch matches cursor epoch
   - Action: Update cursor last_seq to highest delivered seq (FR-011)
   - Result: Cursor advanced, next poll starts from seq=S2+1

3. **tracking(seq=S, epoch=E1) → tracking(seq=min_available_seq, epoch=E2)** (epoch mismatch/clamp):
   - Trigger: Poll detects cursor epoch < thread epoch (thread was compacted)
   - Action: Clamp cursor to thread's min_available_seq, update epoch to current thread epoch (FR-013)
   - Result: Cursor reset to earliest available message after compaction
   - Note: Messages seq S+1 to min_available_seq-1 are effectively skipped (compacted away)

**Atomicity**:
- Cursor update is atomic with message delivery (FR-011)
- Update occurs after messages are successfully delivered
- Read receipt appended to thread after cursor update (FR-012)

---

### Presence Lifecycle

**States** (per handle, per space):
- `offline`: No recent activity (last_activity > presence_ttl_s ago)
- `online(status)`: Recent activity within presence_ttl_s, with status (available/busy/away)

**State Diagram**:
```
[offline: no presence file or stale timestamps]
  ↓ (agent sends first request or heartbeat)
[online(available): last_request_ts=T1]
  ↓ (agent sends heartbeat with status=busy)
[online(busy): last_heartbeat_ts=T2]
  ↓ (agent makes tool call)
[online(busy): last_request_ts=T3, last_heartbeat_ts=T2]
  ↓ (time passes, no activity for >60s)
[offline: max(last_request_ts, last_heartbeat_ts) > 60s old]
  ↓ (agent sends heartbeat)
[online(available): last_heartbeat_ts=T4]
```

**Transitions**:

1. **offline → online(available)**:
   - Trigger: Agent makes first tool call or sends first heartbeat in space
   - Action: Create/update presence file with current timestamp(s) and status (FR-020)
   - Result: Handle appears in "Who's online" queries (FR-024)

2. **online(status1) → online(status2)**:
   - Trigger: Agent activity (tool call or heartbeat)
   - Action:
     - Update `last_request_ts` on any tool call (FR-020)
     - Update `last_heartbeat_ts` and `status` on explicit heartbeat (FR-023)
   - Result: Presence timestamp refreshed, status optionally changed

3. **online(status) → offline**:
   - Trigger: Time passes with no activity for >presence_ttl_s seconds
   - Action: None (implicit transition, file remains but timestamps are stale)
   - Result: Handle no longer appears in "Who's online" queries

**Determination Logic**:
```
is_online = (now - max(last_request_ts, last_heartbeat_ts)) <= presence_ttl_s
```
(FR-021)

**Behavior**:
- Presence updated automatically on every tool invocation (implicit heartbeat)
- Explicit heartbeat allows status control without other operations
- Default presence_ttl_s = 60 seconds (configurable via FR-059)
- Presence records not deleted, just become stale

---

## Validation Rules Reference

| Rule | Entity | Constraint | FR Reference | Error Code |
|------|--------|------------|--------------|------------|
| Name pattern | Space, Thread | Must match `^[A-Za-z0-9._-]+$` | FR-044 | 400 Bad Request |
| Path traversal prevention | Space, Thread | Strict name validation | FR-045 | 400 Bad Request |
| Message size | Message Event | Max 8 KiB (8192 bytes) | FR-046 | 413 Payload Too Large |
| Announcement size | Announcement | Max 64 KiB (65536 bytes) | FR-047 | 413 Payload Too Large |
| Sequence monotonicity | Message Event, Read Receipt, Snapshot Event | seq_i < seq_(i+1) | FR-004 | N/A (enforced by design) |
| P2P naming | Thread | `p2p/<handle-a>__<handle-b>` (lowercase, sorted) | FR-005 | N/A (enforced by design) |
| JSONL newline sanitization | Message Event | Embedded newlines must be escaped | FR-008 | N/A (enforced by design) |
| Cursor clamping | Cursor | If cursor.epoch < thread.epoch, clamp to min_available_seq | FR-013 | N/A (automatic correction) |
| Compaction exclusivity | Compaction Session | Only one per thread | FR-049 | 409 Conflict |
| Content type | Announcement | "text/markdown" or "text/plain" | N/A | 400 Bad Request |
| Status values | Presence Record | "available", "busy", or "away" | N/A | 400 Bad Request |
| Timestamp format | All entities with timestamps | ISO 8601 | N/A | 400 Bad Request |

---

## Data Integrity Constraints

### Monotonic Sequence Numbers
- **Constraint**: `seq_i < seq_(i+1)` for all events in a thread
- **Enforcement**: Server assigns seq numbers sequentially under mutex (FR-040)
- **Violation handling**: Impossible with correct implementation (single-threaded append per thread)

### Epoch Tracking Across Compactions
- **Constraint**: Thread epoch increments exactly once per compaction (FR-034)
- **Purpose**: Detect when cursors reference pre-compaction state
- **Cursor clamping**: If `cursor.epoch < thread.epoch`, reset `cursor.last_seq` to `thread.min_available_seq` (FR-013)

### Atomic Cursor Updates
- **Constraint**: Cursor update and read receipt append are atomic with message delivery (FR-011, FR-012)
- **Order**:
  1. Deliver messages to client
  2. Update cursor file (last_seq = highest delivered seq)
  3. Append read receipt to thread log
- **Failure handling**: If cursor update fails, read receipt not appended (retry on next poll)

### Read Receipt Ordering
- **Constraint**: Read receipts interleaved chronologically with messages via seq numbers
- **Property**: `read_receipt.seq > all delivered message seqs` at time of receipt creation
- **Visibility**: Other agents can see read receipts when polling thread

### Compaction Message Preservation
- **Constraint**: 100% of messages arriving during compaction must be preserved (SC-004)
- **Mechanism**: Delta file captures all new writes during compaction (FR-032)
- **Commit process**: Delta messages replayed into new thread file after snapshot (FR-033)
- **Verification**: seq numbers in committed file must have no gaps

### Announcement Version Monotonicity
- **Constraint**: Announcement version strictly increases on each update (FR-027)
- **Enforcement**: Server increments version on set/append operations
- **Delivery logic**: Only deliver if `handle.last_seen_version < announcement.version` (FR-028)

### No Message Loss on Abort
- **Constraint**: Compaction abort must preserve all messages (base + delta)
- **Mechanism**: Delta messages merged back to base file (FR-035)
- **Verification**: Thread state after abort identical to state if compaction never started

### Storage Atomicity
- **Constraint**: Thread files remain valid JSONL even in case of crash
- **Mechanism**: Append mode + atomic writes ensure each line is complete or absent (FR-041, FR-042)
- **Recovery**: Incomplete last line (if any) can be truncated on restart

### Cursor Persistence
- **Constraint**: Cursors persist across server restarts (SC-009)
- **Mechanism**: Cursor files written to disk immediately after update
- **Test**: Agent polls, server restarts, agent polls again and sees correct continuation

### Text Round-tripping
- **Constraint**: Special characters in message text preserved exactly (SC-010)
- **Mechanism**: JSON string escaping + JSONL newline sanitization (FR-008)
- **Characters**: Quotes, newlines, unicode, control characters

---

## Performance Considerations

### Tail Reading Optimization
- **Requirement**: Read thread tails only, not full files (FR-018)
- **Purpose**: Avoid I/O overhead on large threads (thousands of messages)
- **Implementation**: Seek to (file_size - tail_buffer_size), read last N bytes, parse JSONL
- **Cursor benefit**: Knowing last_seq allows efficient skip-ahead

### Blocking Poll Efficiency
- **Requirement**: Support blocking poll with timeout (FR-015, FR-016)
- **Purpose**: Avoid busy-polling when no messages available
- **Implementation**: File system watchers, inotify, or simple sleep + recheck loop
- **Early return**: Must return immediately when messages arrive (don't wait full timeout, FR-016)

### Concurrent Agent Support
- **Requirement**: Support 10+ concurrent agents (SC-002)
- **Bottleneck**: Per-thread mutex means high contention on popular threads
- **Mitigation**: Lock held only during append operation (minimal duration, FR-040)

### Throughput Target
- **Requirement**: 1000 messages/second sustained write to single thread (SC-011)
- **Constraint**: Filesystem append performance, JSONL serialization
- **Optimization**: Batch writes if possible (while maintaining atomicity)

### Latency Target
- **Requirement**: <100ms end-to-end latency for send + poll round-trip (SC-001)
- **Constraint**: Disk flush time, tail read time, JSON parsing
- **Optimization**: In-memory caching of recent messages, async file operations

### Multi-thread Polling
- **Requirement**: Poll 50 threads simultaneously (SC-003)
- **Constraint**: Opening/reading 50 files in parallel
- **Optimization**: Parallel file reads, efficient cursor lookups
