# Implementation Plan: SwarmBBS MCP Server

**Branch**: `001-mcp-bbs-server` | **Date**: 2025-11-12 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/home/user/swarmbbs/specs/001-mcp-bbs-server/spec.md`

## Summary

SwarmBBS is a minimal, Unix-style bulletin board system exposed as MCP tools, enabling isolated sub-agents to communicate and coordinate through file-backed append-only threads. The system provides:

- **Agent-to-agent messaging** via shared named threads with server-managed cursors
- **Private P2P channels** with canonical naming for direct agent communication
- **Multi-thread polling** with blocking timeout for efficient message retrieval
- **Presence and discovery** so agents can announce capabilities and see who's online
- **Space-wide announcements** with dynamic "Who's online" sections
- **Thread compaction** with two-phase protocol ensuring zero message loss

**Technical Approach**: File-based storage with JSONL format, per-thread mutexes for concurrency, MCP TypeScript SDK for stdio transport, tail-read optimization for performance. Target: 1000 msg/sec throughput, <100ms latency, 10+ concurrent agents.

## Technical Context

**Language/Version**: Node.js 22.x LTS (supported until 2027, 30% faster startup than v20)
**Primary Dependencies**:
- `@modelcontextprotocol/sdk` v1.21.1 (MCP server framework)
- `async-mutex` v0.5.0 (per-thread locking)
- `ajv` v8.17.1 (JSON schema validation)
- `vitest` v2.1.5 (testing framework)

**Storage**: File-based JSONL for append-only threads, JSON for state (cursors, presence, profiles, announcements)
**Testing**: Vitest (10-20x faster than Jest, native TypeScript/ESM support, zero config)
**Target Platform**: Linux/macOS/Windows with Node.js 22+, stdio transport for MCP
**Project Type**: Single project (CLI tool + MCP server)
**Performance Goals**:
- 1000 messages/second sustained write throughput
- <100ms message exchange latency (send + poll round-trip)
- <50ms tail-read for last 1000 messages from 100MB thread
- 10+ concurrent agents without contention

**Constraints**:
- Zero-install via `npx` execution (no prior setup required)
- Stdio transport only (no HTTP/WebSocket)
- File-based storage (no external database)
- Message size limit: 8 KiB
- Announcement size limit: 64 KiB
- Presence TTL: 60 seconds default

**Scale/Scope**:
- 10-50 concurrent agents per server instance
- Hundreds of threads per space
- Tens of thousands of messages per thread before compaction recommended
- Dozens of spaces per installation

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Principle I: Parallel Task Execution ✅ COMPLIANT

**Assessment**: Implementation will use Task tool for spawning parallel test execution, parallel module implementation (storage, MCP server, CLI can be developed independently), and parallel contract test generation.

**Plan Alignment**: Phase 2 task generation will explicitly mark independent tasks with `[P]` flag for parallel execution. Tasks grouped by file/module to prevent conflicts.

### Principle II: Test-Driven Development ✅ COMPLIANT

**Assessment**: TDD will be strictly followed. Contract tests define MCP tool interfaces, integration tests verify user journeys, unit tests cover complex logic (cursor management, compaction protocol, tail reading).

**Plan Alignment**:
- Phase 1 generates contracts/ defining expected behavior
- Phase 2 tasks will include test tasks BEFORE implementation tasks
- Tests must fail (Red) before implementation (Green)
- All 62 functional requirements mapped to tests

### Principle III: Organized File Structure ✅ COMPLIANT

**Assessment**:
- Specs in `specs/001-mcp-bbs-server/` ✅
- Source in `src/` (server, storage, tools subdirectories) ✅
- Tests in `tests/` (contract/, integration/, unit/) ✅
- Ephemeral research in `temp/` ✅
- No root pollution ✅

**Plan Alignment**: Project structure section documents exact layout. All artifacts in proper locations.

### Principle IV: Modular Code Architecture ✅ COMPLIANT

**Assessment**: Design enforces <500 line limit through module decomposition:
- MCP server setup (<200 lines)
- Per-tool handlers (18 tools × ~50-100 lines each)
- Storage layer (split into: thread-ops.ts, cursor-ops.ts, state-ops.ts, compaction.ts)
- Each module has single responsibility

**Plan Alignment**: Phase 1 data-model.md will identify module boundaries. Phase 2 tasks will create one file per module.

### Principle V: Claude Code Task Tool ✅ COMPLIANT

**Assessment**: Planning phase already used 3 parallel Task invocations for research agents. Implementation phase will use Task tool for:
- Parallel test writing across tool categories
- Parallel module implementation (independent files)
- Parallel contract generation

**Plan Alignment**: This plan was generated using Task tool. Implementation tasks will leverage it throughout.

### Principle VI: Fail-Fast Error Handling ✅ COMPLIANT

**Assessment**: Spec defines 6 error codes (400, 404, 409, 413, 423, 507) with actionable messages. Implementation will:
- Validate inputs before state changes
- Return explicit errors with context and next steps
- No silent fallbacks or default values for missing config
- Surface config errors at startup (root dir, permissions)

**Plan Alignment**: API contracts document error scenarios per tool. All validation failures fail fast with clear messages.

### Principle VII: Autonomous Task Completion ✅ COMPLIANT

**Assessment**: This plan was created autonomously after parallel research. Implementation will make technical decisions (error message wording, internal data structures, helper functions) without human approval. Only blocking questions: none anticipated (spec is comprehensive).

**Plan Alignment**: Autonomous decisions logged in this plan's Decision Log section below.

**VERDICT**: ✅ **ALL GATES PASSED** - Proceed to Phase 0

## Autonomous Decisions Log

### Decision 1: Node.js 22.x LTS over v20 LTS

**Context**: Spec requires Node ≥ 18.17. Multiple LTS versions available.

**Options Considered**:
- Node 18.x LTS (Maintenance until 2025-04) - Rejected: approaching end of life
- Node 20.x LTS (Active until 2026-10) - Rejected: 22.x has better performance
- **Node 22.x LTS (Active until 2027-04)** - **SELECTED**: Longer support, 30% faster startup, better performance

**Rationale**: Node 22.x is the current Active LTS with support through April 2027, providing 2+ years of guaranteed support. Performance improvements (30% faster startup, optimized async/await) directly benefit MCP server launch time and message throughput. Minimal risk since it's LTS.

**Impact**: Affects package.json engines field and documentation
**Reversibility**: Easy - can downgrade to 20.x if compatibility issues arise

### Decision 2: Vitest over Jest for Testing

**Context**: Need testing framework for contract/integration/unit tests. Spec doesn't mandate specific framework.

**Options Considered**:
- Jest 29.x (industry standard) - Rejected: slow, poor ESM support, requires babel config
- **Vitest 2.1.x** - **SELECTED**: 10-20x faster, native TypeScript/ESM, zero config, compatible API
- AVA - Rejected: less mainstream, smaller ecosystem

**Rationale**: Vitest provides Jest-compatible API (easy migration if needed) while being dramatically faster (10-20x) and having first-class TypeScript/ESM support with zero configuration. For a new project in 2025, Vitest is the modern choice. Aligns with performance goals.

**Impact**: Affects package.json devDependencies and test scripts
**Reversibility**: Easy - Jest-compatible API allows switching if needed

### Decision 3: Ajv over Zod for Runtime Validation

**Context**: Need runtime JSON schema validation for MCP tool inputs. Spec mentions "Zod-equivalent constraints".

**Options Considered**:
- Zod - Rejected: 10x slower than Ajv, larger bundle, TypeScript-first (not JSON Schema)
- **Ajv 8.17.1** - **SELECTED**: Fastest validator (1M ops/sec), standards-compliant JSON Schema, battle-tested
- Joi - Rejected: slower than Ajv, less strict standards compliance

**Rationale**: Ajv is the fastest, most standards-compliant JSON Schema validator. Supports JSON Schema Draft 2020-12. "Zod-equivalent" in spec means strong validation, not literal Zod usage. Ajv aligns with performance goals (<100ms latency) better than Zod's TypeScript-first approach.

**Impact**: Validation schemas will use JSON Schema format (easily generated from TypeScript types)
**Reversibility**: Moderate - would require rewriting schemas, but validation logic stays same

### Decision 4: Per-Thread Mutex Map Pattern

**Context**: Spec requires per-thread mutexes (FR-040). Implementation pattern needed.

**Options Considered**:
- Global mutex - Rejected: kills concurrency, defeats performance goals
- **Map<string, Mutex> with lazy creation** - **SELECTED**: Fine-grained locking, high concurrency
- AsyncLocalStorage + mutex - Rejected: overcomplicated, no benefit

**Rationale**: `Map<thread-id, Mutex>` pattern allows concurrent writes to different threads while preventing races within same thread. Lazy mutex creation avoids memory overhead. Standard pattern in async-mutex documentation. Directly enables 1000 msg/sec target.

**Impact**: Core concurrency implementation in storage layer
**Reversibility**: Easy - well-encapsulated behind storage API

### Decision 5: Compaction Delta File Naming: `<thread>.delta`

**Context**: Spec mentions `.delta` files during compaction but doesn't specify exact naming.

**Options Considered**:
- `<thread>.delta` (simple) - **SELECTED**: matches spec hint, clear intent
- `<thread>.<compaction-id>.delta` (unique) - Rejected: adds complexity, compaction-id already prevents conflicts
- `.compacting.<thread>` (hidden) - Rejected: harder to debug, less transparent

**Rationale**: Spec explicitly mentions `.delta` extension in storage layout section and compaction protocol. Simple `<thread>.delta` naming is clear, matches spec intent, and compaction_id in state prevents concurrent compaction conflicts anyway.

**Impact**: File naming in compaction implementation
**Reversibility**: Easy - internal implementation detail

## Project Structure

### Documentation (this feature)

```
specs/001-mcp-bbs-server/
├── spec.md                    # Feature specification (DONE)
├── plan.md                    # This file (IN PROGRESS)
├── checklists/
│   └── requirements.md        # Spec quality checklist (DONE)
├── research.md                # Phase 0 output (pending - will consolidate temp/ files)
├── data-model.md              # Phase 1 output (pending)
├── quickstart.md              # Phase 1 output (pending)
├── contracts/                 # Phase 1 output (pending)
│   ├── messaging.md
│   ├── p2p.md
│   ├── presence.md
│   ├── announcements.md
│   ├── compaction.md
│   ├── lifecycle.md
│   └── schemas.ts             # Zod/Ajv definitions
└── tasks.md                   # Phase 2 output (/speckit.tasks - NOT created by /speckit.plan)
```

### Source Code (repository root)

```
src/
├── index.ts                   # Main entry point + CLI
├── server/
│   ├── mcp-server.ts          # MCP server setup (<200 lines)
│   └── tool-registry.ts       # Tool registration logic
├── tools/
│   ├── messaging.ts           # send_message, poll_messages, reset_cursor
│   ├── p2p.ts                 # open_p2p, send_p2p
│   ├── presence.ts            # introduce, who_online, send_heartbeat
│   ├── announcements.ts       # announcement_set, append, get
│   ├── compaction.ts          # compact_begin, commit, abort
│   └── lifecycle.ts           # clear_space, archive_space, list_*
├── storage/
│   ├── thread-ops.ts          # Thread read/write/append operations
│   ├── cursor-ops.ts          # Cursor management and advancement
│   ├── state-ops.ts           # Presence, profiles, announcements
│   ├── compaction-impl.ts     # Two-phase compaction protocol
│   └── tail-reader.ts         # Optimized tail reading utility
├── types/
│   ├── events.ts              # Message, Read Receipt, Snapshot types
│   ├── state.ts               # Cursor, Presence, Profile types
│   └── schemas.ts             # Validation schemas (Ajv)
└── utils/
    ├── validation.ts          # Name validation, text sanitization
    ├── locking.ts             # Mutex map management
    └── errors.ts              # Error response formatting

tests/
├── contract/
│   ├── messaging.test.ts      # Contract tests for messaging tools
│   ├── p2p.test.ts            # Contract tests for P2P tools
│   ├── presence.test.ts       # Contract tests for presence tools
│   ├── announcements.test.ts  # Contract tests for announcement tools
│   ├── compaction.test.ts     # Contract tests for compaction tools
│   └── lifecycle.test.ts      # Contract tests for lifecycle tools
├── integration/
│   ├── user-story-1.test.ts   # Agent sends message to shared thread
│   ├── user-story-2.test.ts   # Agent establishes P2P channel
│   ├── user-story-3.test.ts   # Agent polls multiple threads
│   ├── user-story-4.test.ts   # Agent maintains presence
│   ├── user-story-5.test.ts   # Coordinator posts announcement
│   └── user-story-6.test.ts   # Agent compacts thread
└── unit/
    ├── tail-reader.test.ts    # Tail reading optimization
    ├── cursor-logic.test.ts   # Cursor advancement and clamping
    ├── compaction.test.ts     # Compaction protocol edge cases
    └── validation.test.ts     # Name validation, text sanitization

temp/                          # Ephemeral coordination files
├── architecture-research.md   # Architecture agent output (DONE)
├── data-model-analysis.md     # Data model agent output (DONE)
└── api-contracts-design.md    # API contracts agent output (DONE)
```

**Structure Decision**:

Selected **Option 1: Single project** structure because:
- This is a CLI tool + MCP server, not a web application
- No frontend/backend split required
- No mobile app component
- Single deployment artifact (npx executable)

The `src/` organization groups by concern:
- `server/` - MCP server framework setup
- `tools/` - MCP tool handlers (one file per category, ~50-100 lines each)
- `storage/` - File operations and data persistence
- `types/` - TypeScript types and validation schemas
- `utils/` - Shared utilities

Tests mirror user stories (integration) and tool contracts (contract), with unit tests for complex algorithms (tail reading, cursor management, compaction).

## Complexity Tracking

> **No constitutional violations requiring justification.**

All principles are satisfied:
- ✅ Parallel execution planned throughout
- ✅ TDD enforced (tests before implementation)
- ✅ Organized file structure (no root pollution)
- ✅ Modular architecture (all files <500 lines)
- ✅ Task tool for agent spawning
- ✅ Fail-fast error handling
- ✅ Autonomous task completion

No complexity justifications needed.
