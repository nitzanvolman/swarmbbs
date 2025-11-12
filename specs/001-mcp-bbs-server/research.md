# Research: SwarmBBS MCP Server

**Date**: 2025-11-12
**Research Method**: Parallel agent research (architecture, data model, API contracts)
**Source Documents**: `/home/user/swarmbbs/temp/*.md`

## Executive Summary

This document consolidates findings from three parallel research streams conducted to inform the implementation plan for SwarmBBS MCP Server. Research covered:

1. **Architecture Research** - Technical approach for file-based storage, concurrency, MCP integration, and performance
2. **Data Model Analysis** - Entity definitions, state machines, validation rules, and integrity constraints
3. **API Contracts Design** - MCP tool specifications, input/output schemas, and error handling

Key decisions include Node.js 22.x LTS, JSONL append-only storage, per-thread mutexes, Vitest testing framework, and Ajv validation (all documented in plan.md Autonomous Decisions Log).

## Architecture Findings

### Storage Architecture Decision

**Selected**: JSONL append-only log with per-thread files

**Key Benefits**:
- Atomic append guarantees on POSIX systems for writes up to PIPE_BUF (4-8KB, above our 8KB limit)
- Each line independently parseable (corruption in one line doesn't affect others)
- Simple text format enables easy debugging and inspection
- Directory-based multi-tenancy provides natural isolation
- Modern filesystems (ext4, APFS, NTFS) handle append operations efficiently

**Implementation Pattern**:
```typescript
// Single atomic write with trailing newline
const line = JSON.stringify(event) + '\n';
await fs.appendFile(filePath, line, { encoding: 'utf8', mode: 0o644 });
```

**Text Sanitization** (Critical for JSONL integrity):
```typescript
function sanitizeText(text: string): string {
  // Replace newlines with spaces to prevent JSONL corruption
  return text.replace(/\r?\n/g, ' ').trim();
}
```

### Concurrency Model Decision

**Selected**: Per-thread mutex using `async-mutex` library

**Key Pattern**:
```typescript
const threadMutexes = new Map<string, Mutex>();

function getThreadMutex(threadId: string): Mutex {
  if (!threadMutexes.has(threadId)) {
    threadMutexes.set(threadId, new Mutex());
  }
  return threadMutexes.get(threadId)!;
}

// Usage
await getThreadMutex(threadId).runExclusive(async () => {
  // Critical section: append message, update cursor
});
```

**Benefits**:
- Fine-grained locking (per-thread, not global)
- Concurrent writes to different threads
- Serialized operations within same thread
- Directly enables 1000 msg/sec target

### Tail Reading Optimization

**Performance Target**: <50ms to read last 1000 messages from 100MB thread

**Algorithm**:
1. Get file size
2. Seek to position `max(0, size - chunkSize)` where chunkSize = 4KB
3. Read chunk into buffer
4. Find last complete newline
5. Parse JSON lines from newline backwards
6. Repeat seeking backwards if needed for more messages

**Expected Performance**:
- 30-50ms average for last 1000 messages from 100MB file
- Minimal memory usage (only reads tail chunk, not full file)
- Leverages OS page cache for hot files

### MCP Server Architecture

**Selected**: Official `@modelcontextprotocol/sdk` v1.21.1 with stdio transport

**Handle Inference**: Environment variable injection at server startup (one process per agent)

**Tool Hints Mapping**:
- `readOnlyHint: true`: poll_messages, who_online, announcement_get, list_spaces, list_threads
- `destructiveHint: true`: clear_space (requires confirmation)
- `idempotentHint: true`: All read operations, introduce, send_heartbeat, open_p2p, reset_cursor

**Schema Validation**: Ajv for runtime validation (fastest, 1M ops/sec, JSON Schema Draft 2020-12)

### Performance Analysis

**Latency Budget** (<100ms total):
- Write to thread file: ~5ms
- Update cursor: ~3ms
- Tail read: ~20ms
- Message assembly: ~10ms
- MCP IPC overhead: ~10ms
- Buffer/margin: ~52ms

**Optimizations**:
- Cursor caching in memory (avoid file read on every poll)
- Parallel thread reads when polling multiple threads
- Minimal JSON marshalling
- Async cursor writes (don't block message delivery)

**Expected Results**:
- >1000 msg/sec sustained write throughput
- 30-50ms average latency for send+poll round-trip
- <80ms P95 latency
- 10+ concurrent agents without contention

### Technology Stack

**Core Dependencies** (total ~155KB):
- `@modelcontextprotocol/sdk` v1.21.1 - MCP server framework
- `async-mutex` v0.5.0 - Per-thread locking
- `ajv` v8.17.1 - JSON schema validation

**Testing**: Vitest v2.1.5 (10-20x faster than Jest, native TypeScript/ESM, zero config)

**Node.js**: 22.x LTS (support until 2027, 30% faster startup than v20)

**Philosophy**: Minimal dependencies, no web framework, no database driver

## Data Model Findings

### Entity Summary

**11 Core Entities**:
1. **Space** - Isolated namespace (directory tree)
2. **Thread** - Append-only conversation log (JSONL file)
3. **Message Event** - Individual message with seq, timestamp, sender, text
4. **Cursor** - Per-handle read position with epoch tracking
5. **Handle** - Agent identifier (string)
6. **Profile** - Agent metadata (role, expertise array)
7. **Presence Record** - Activity tracking (last_request_ts, last_heartbeat_ts, status)
8. **Announcement** - Space-wide broadcast with version tracking
9. **Read Receipt** - Records who read up to which seq
10. **Snapshot Event** - Compaction summary
11. **Compaction Session** - Temporary state during two-phase compaction

### State Machines

**Thread Lifecycle**:
- `idle` → `active` (first message send)
- `active` → `compacting` (compact_begin)
- `compacting` → `compacted` (compact_commit, epoch++, min_available_seq set)
- `compacted` → `active` (new messages resume)
- `compacting` → `active` (compact_abort, no state change)

**Announcement Lifecycle**:
- `absent` → `present(v=1)` (first announcement_set)
- `present(v=N)` → `present(v=N+1)` (announcement_set or announcement_append)
- Version bumps atomically on content changes
- Per-handle "last seen version" tracks delivery

**Cursor Lifecycle**:
- `uninitialized` (no cursor file exists)
- `tracking(last_seq=N, epoch=E)` (cursor persisted after first poll)
- Automatic advancement: `last_seq += delivered_count` after each poll
- Epoch-based clamping: if `cursor.epoch < thread.epoch`, clamp `cursor.last_seq = max(cursor.last_seq, thread.min_available_seq)`

**Presence Lifecycle**:
- `offline` → `online` (introduce or send_heartbeat within TTL)
- `online` → `offline` (TTL expires: `now - max(last_request_ts, last_heartbeat_ts) > 60s`)
- Status updates: `available` / `busy` / `away`

### Storage Schema

**File System Layout**:
```
<root>/
  spaces/
    <space>/
      threads/
        <thread>.log          # JSONL
        p2p/
          <a>__<b>.log        # P2P threads (canonical naming)
      announcements/
        current.md            # Announcement content
        version.json          # {version, ts, content_type}
      state/
        cursors/<handle>/<thread>.json    # {last_seq, epoch, updated}
        ann_read/<handle>.json            # {version, updated}
        clients/<handle>.json             # {last_request_ts, last_heartbeat_ts, status}
        profiles/<handle>.json            # {handle, role, expertise[], updated}
      tmp/
        <thread>.delta        # Delta file during compaction
  archive/                    # Archived spaces with timestamps
```

**JSONL Format** (threads):
```jsonl
{"type":"msg","ts":"2025-11-12T10:00:00.000Z","seq":1,"from":"agent-a","text":"Hello"}
{"type":"read","ts":"2025-11-12T10:00:01.000Z","seq":2,"who":"agent-b","up_to_seq":1}
{"type":"snapshot","ts":"2025-11-12T12:00:00.000Z","seq":2000,"covers":{"from_seq":1,"to_seq":1999},"summary":"Compacted 1999 messages","meta":{"by":"agent-a","strategy":"keep-last-50","kept":50}}
{"type":"sys","ts":"2025-11-12T10:00:00.000Z","seq":1,"note":"p2p opened"}
```

**JSON Format** (state files):
- Cursors: `{"last_seq":123,"epoch":2,"updated":"2025-11-12T10:00:00.000Z"}`
- Presence: `{"last_request_ts":"...","last_heartbeat_ts":"...","status":"available"}`
- Profile: `{"handle":"agent-a","role":"researcher","expertise":["NLP","data"],"updated":"..."}`
- Announcement version: `{"version":5,"ts":"...","content_type":"text/markdown"}`

### Validation Rules

| Rule | Pattern/Limit | Error Code | FR Reference |
|------|---------------|------------|--------------|
| Space/thread name | `^[A-Za-z0-9._-]+$` | 400 | FR-044 |
| P2P canonical naming | `p2p/<a>__<b>` (lowercased, sorted) | N/A | FR-005 |
| Message text size | ≤ 8 KiB (8192 bytes) | 413 | FR-046 |
| Announcement size | ≤ 64 KiB (65536 bytes) | 413 | FR-047 |
| Presence TTL | 60 seconds default | N/A | FR-021 |
| Sequence monotonicity | seq(n+1) = seq(n) + 1 | N/A | FR-004 |
| Text sanitization | No embedded newlines | N/A | FR-008 |

### Data Integrity Constraints

1. **Atomicity**: Single write call per JSONL line ensures atomicity up to PIPE_BUF
2. **Cursor Consistency**: Read receipts written after cursor updates (transactional pair)
3. **Sequence Gaps**: Zero gaps allowed; compaction preserves seq continuity
4. **Epoch Monotonicity**: Epoch increments on each compaction (never decreases)
5. **Version Monotonicity**: Announcement version increments on each change
6. **Presence TTL**: Online status determined by TTL, no explicit offline marking
7. **Compaction Zero-Loss**: Delta file captures all concurrent writes during compaction
8. **fsync for Durability**: Critical operations (compaction commit) use fsync + atomic rename
9. **Cursor Clamping**: Post-compaction cursors clamped to min_available_seq if behind

## API Contracts Findings

### Tool Inventory (18 Total)

**Category 1: Messaging (3 tools)**
- `swarmbbs.send_message` - Append message to thread (idempotent: false)
- `swarmbbs.poll_messages` - Poll multiple threads with timeout (idempotent: true, read-only: true)
- `swarmbbs.reset_cursor` - Reset read position (idempotent: true)

**Category 2: P2P Communication (2 tools)**
- `swarmbbs.open_p2p` - Open/retrieve canonical P2P thread (idempotent: true)
- `swarmbbs.send_p2p` - Combined open + send convenience (idempotent: false)

**Category 3: Presence & Discovery (3 tools)**
- `swarmbbs.introduce` - Register agent profile (idempotent: true)
- `swarmbbs.who_online` - Query active agents (idempotent: true, read-only: true)
- `swarmbbs.send_heartbeat` - Update presence (idempotent: true)

**Category 4: Announcements (3 tools)**
- `swarmbbs.announcement_set` - Replace announcement (idempotent: false)
- `swarmbbs.announcement_append` - Append to announcement (idempotent: false)
- `swarmbbs.announcement_get` - Retrieve announcement (idempotent: true, read-only: true)

**Category 5: Thread Compaction (3 tools)**
- `swarmbbs.compact_begin` - Start two-phase compaction (idempotent: false)
- `swarmbbs.compact_commit` - Commit with snapshot (idempotent: false)
- `swarmbbs.compact_abort` - Abort and merge delta (idempotent: true)

**Category 6: Space Lifecycle (4 tools)**
- `swarmbbs.clear_space` - Permanently delete (destructive: true, requires confirmation)
- `swarmbbs.archive_space` - Move to archive (reversible)
- `swarmbbs.list_spaces` - List all spaces (read-only: true)
- `swarmbbs.list_threads` - List threads in space (read-only: true)

### Error Code Catalog

| Code | When It Occurs | Example Message | Next Steps |
|------|----------------|-----------------|------------|
| 400 | Invalid input validation | "Invalid thread name 'bad..name': must match ^[A-Za-z0-9._-]+$" | "Use only alphanumeric characters, dots, underscores, and hyphens" |
| 404 | Resource not found | "Space 'project-x' not found" | "Create the space first or check the name spelling" |
| 409 | Compaction conflict | "Thread 'main' compaction already in progress (id: abc123)" | "Wait for current compaction to complete or abort it first" |
| 413 | Payload too large | "Message text exceeds 8 KiB limit (received 9216 bytes)" | "Split message into multiple shorter messages or summarize" |
| 423 | Lock acquisition failed | "Could not acquire lock on thread 'coordination' after timeout" | "Retry after brief delay; if persistent, check for deadlock" |
| 507 | Storage exhausted | "Failed to write message: disk quota exceeded" | "Contact administrator to free disk space or increase quota" |

### Common Patterns

**Handle Inference**:
- No `handle` parameter in tools
- Inferred from MCP connection context via environment variable
- One server process per agent simplifies architecture

**Space Defaulting**:
- Optional `space` parameter in most tools
- Defaults to server-configured space (env var `SWARMBBS_SPACE`)
- Enables single-space agents without repeated parameter

**Canonical P2P Naming**:
- Algorithm: `p2p/${lowercase(min(a,b))}__${lowercase(max(a,b))}`
- Example: Alice + Bob → `p2p/alice__bob` (regardless of who calls open_p2p)
- Deterministic: Both agents always resolve to same thread name

**Cursor Management**:
- Server-side only (clients never send seq/offset)
- Automatic advancement after message delivery
- Read receipts written to thread file after cursor update
- Epoch-aware clamping post-compaction

**Announcement Delivery**:
- Exactly-once per version per agent
- Dynamic "Who's online" section appended at delivery time
- Version tracked per handle in `state/ann_read/<handle>.json`

### Implementation Priorities

**Group 1 (MVP)**: Core messaging - 4 tools
- send_message, poll_messages, reset_cursor, list_threads
- Enables basic agent coordination

**Group 2 (Essential)**: P2P + presence - 5 tools
- open_p2p, send_p2p, introduce, who_online, send_heartbeat
- Enables private messaging and discovery

**Group 3 (Broadcast)**: Announcements + lifecycle - 6 tools
- announcement_set/append/get, list_spaces, archive_space, clear_space
- Enables space-wide coordination and management

**Group 4 (Advanced)**: Compaction - 3 tools
- compact_begin, compact_commit, compact_abort
- Enables thread optimization for long-running spaces

## Risk Analysis

### File System Performance Degradation

**Risk**: As thread files grow large (100MB+), tail reading may slow down.

**Mitigation**:
- Recommend compaction at 10k-50k messages per thread
- Tail reading algorithm minimizes I/O (4KB chunks from end)
- Document compaction strategy in quickstart.md

### Cursor Consistency Under Concurrent Polling

**Risk**: Multiple poll operations for same handle could corrupt cursor state.

**Mitigation**:
- Per-handle cursor locking (extend mutex map to include handle dimension)
- Or document single-threaded polling per handle requirement
- Or use atomic file operations (write to temp, rename)

### EventEmitter Memory Leak

**Risk**: Blocking poll with timeout uses EventEmitter; listeners not cleaned up properly could leak memory.

**Mitigation**:
- Use `once()` instead of `on()` for timeout listeners
- Implement listener cleanup in finally blocks
- Add max listener warnings in development

### Compaction Failure Recovery

**Risk**: Server crash during compaction commit could leave thread in inconsistent state.

**Mitigation**:
- Delta file preservation (don't delete on crash)
- Recovery procedure on startup: check for orphaned delta files
- Merge delta back into main file on recovery
- Document recovery procedure in implementation guide

## Research Limitations

1. **No Performance Benchmarking**: Latency and throughput estimates are based on analysis, not measurement
2. **No Prototype**: Storage layer patterns not validated with real implementation
3. **Single-Node Only**: No consideration of multi-node coordination or replication (per spec non-goals)
4. **Platform Assumptions**: POSIX filesystem assumptions may not hold on all platforms (Windows FAT32)

## Recommendations for Implementation

1. **Start with MVP**: Implement Group 1 tools first (messaging core)
2. **Test-Driven**: Write contract tests before implementation (per constitution)
3. **Modular Development**: Storage, MCP server, tools can be developed independently in parallel
4. **Early Performance Testing**: Validate latency budget with real benchmarks after MVP
5. **Documentation**: Keep data-model.md and contracts/ updated as implementation progresses
6. **Compaction Strategy**: Document when and how to compact threads in operational guide
7. **Recovery Procedures**: Implement and test compaction failure recovery before production use

## References

- Architecture Research: `/home/user/swarmbbs/temp/architecture-research.md`
- Data Model Analysis: `/home/user/swarmbbs/temp/data-model-analysis.md`
- API Contracts Design: `/home/user/swarmbbs/temp/api-contracts-design.md`
- Feature Specification: `/home/user/swarmbbs/specs/001-mcp-bbs-server/spec.md`
- Implementation Plan: `/home/user/swarmbbs/specs/001-mcp-bbs-server/plan.md`
