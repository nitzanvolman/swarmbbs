# Tasks: SwarmBBS MCP Server

**Input**: Design documents from `/home/user/swarmbbs/specs/001-mcp-bbs-server/`
**Prerequisites**: plan.md, spec.md, data-model.md, contracts/, research.md, quickstart.md

**Execution Strategy**: 3-Developer Parallel Team with Sync Points

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies within phase)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, etc.)
- Include exact file paths in descriptions

---

## Parallel Execution Strategy (3 Developers)

This implementation uses **3 parallel developer agents** with **explicit sync points** where the parent coordinator performs commits.

### Workflow Pattern

```
Parent Coordinator
  ↓
  Spawns 3 agents in parallel for phases [3, 4, 6]
  ↓
  SYNC POINT 1: Wait for all agents to complete
  ↓
  Parent commits phases 3, 4, 6
  ↓
  Spawns 3 agents in parallel for phases [5, 7, 10]
  ↓
  SYNC POINT 2: Wait for all agents to complete
  ↓
  Parent commits phases 5, 7, 10
  ↓
  Spawns 3 agents in parallel for phases [8, 9, 11]
  ↓
  SYNC POINT 3: Wait for all agents to complete
  ↓
  Parent commits phases 8, 9, 11
  ↓
  COMPLETE
```

### Critical Rules

⚠️ **SUB-AGENTS NEVER COMMIT** - All commits are performed by the parent coordinator at sync points
⚠️ **Phase isolation** - Each phase works on separate files to avoid conflicts
⚠️ **Sync before commit** - Parent waits for all parallel agents to complete before committing

---

## Phase 1: Project Setup & Foundation

**Executor**: Parent Coordinator (single-threaded, blocking)

**Purpose**: Initialize project structure and core infrastructure that all subsequent phases depend on.

**Phase Boundaries**:
- **Input**: Empty repository
- **Output**: Compilable TypeScript project with test framework, type definitions, validation utilities, and error handling framework
- **Files Created**: `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/types/*`, `src/utils/*`

**Dependencies**: None - can start immediately

### Tasks

- [ ] T001 Initialize npm project with Node.js 22.x configuration in package.json
- [ ] T002 Install production dependencies (@modelcontextprotocol/sdk@1.21.1, async-mutex@0.5.0, ajv@8.17.1)
- [ ] T003 [P] Install development dependencies (vitest@2.1.5, typescript@5.7.2, tsx@4.19.0, @types/node@22.0.0)
- [ ] T004 [P] Create TypeScript configuration in tsconfig.json with Node16 module resolution
- [ ] T005 [P] Create Vitest configuration in vitest.config.ts
- [ ] T006 [P] Create project directory structure (src/, tests/contract/, tests/integration/, tests/unit/)
- [ ] T007 [P] Define event types in src/types/events.ts (MessageEvent, ReadReceiptEvent, SnapshotEvent, SystemNoteEvent)
- [ ] T008 [P] Define state types in src/types/state.ts (Cursor, PresenceRecord, Profile, Announcement, CompactionSession)
- [ ] T009 [P] Create JSON schemas for validation in src/types/schemas.ts using Ajv
- [ ] T010 [P] Implement name validation utilities in src/utils/validation.ts (space/thread name pattern matching)
- [ ] T011 [P] Implement text sanitization for JSONL integrity in src/utils/validation.ts
- [ ] T012 [P] Implement error handling framework in src/utils/errors.ts (SwarmBBSError class with code, context, nextSteps)
- [ ] T013 [P] Implement mutex map management in src/utils/locking.ts (per-thread mutex with lazy creation)
- [ ] T014 Verify project builds successfully with `npm run build`

**Phase 1 Complete** → Parent commits setup and foundation

---

## Phase 2: Storage Layer - Core Operations

**Executor**: Parent Coordinator (single-threaded, blocking)

**Purpose**: Implement file-based storage primitives for threads, cursors, and state management.

**Phase Boundaries**:
- **Input**: Project foundation from Phase 1
- **Output**: Fully functional storage layer with thread operations, cursor management, and state persistence
- **Files Created**: `src/storage/thread-ops.ts`, `src/storage/cursor-ops.ts`, `src/storage/state-ops.ts`, `src/storage/tail-reader.ts`
- **Test Coverage**: Unit tests for all storage operations

**Dependencies**: Phase 1 (types, validation, locking utilities)

### Tasks

- [ ] T015 [P] Implement tail reading optimization in src/storage/tail-reader.ts (read last N lines without loading full file)
- [ ] T016 [P] Implement atomic JSONL append in src/storage/thread-ops.ts (thread creation, message append with mutex)
- [ ] T017 [P] Implement thread reading operations in src/storage/thread-ops.ts (read tail, get current seq, get epoch)
- [ ] T018 [P] Implement cursor read/write operations in src/storage/cursor-ops.ts (get cursor, update cursor, persist to file)
- [ ] T019 [P] Implement cursor advancement logic in src/storage/cursor-ops.ts (advance after delivery, epoch clamping)
- [ ] T020 [P] Implement read receipt appending in src/storage/cursor-ops.ts (append read event to thread after cursor update)
- [ ] T021 [P] Implement presence tracking in src/storage/state-ops.ts (read/write presence records, check TTL)
- [ ] T022 [P] Implement profile management in src/storage/state-ops.ts (read/write agent profiles)
- [ ] T023 [P] Implement announcement storage in src/storage/state-ops.ts (read/write/update announcements with version tracking)
- [ ] T024 [P] Implement "Who's online" query in src/storage/state-ops.ts (filter by presence TTL, include profiles)
- [ ] T025 [P] Unit test tail reader with large files in tests/unit/tail-reader.test.ts
- [ ] T026 [P] Unit test cursor advancement and clamping in tests/unit/cursor-logic.test.ts
- [ ] T027 [P] Unit test text sanitization (newlines, special characters) in tests/unit/validation.test.ts
- [ ] T028 [P] Unit test epoch tracking across compactions in tests/unit/cursor-logic.test.ts
- [ ] T029 Run unit tests and verify all pass

**Phase 2 Complete** → Parent commits storage layer

---

## 🔀 SYNC POINT 1: Parallel Wave 1 [Phases 3, 4, 6]

**Parent Action**: Spawn 3 agents in parallel, wait for completion, then commit

### Agent Spawning Instructions

```typescript
// Pseudo-code for parent coordinator
await Promise.all([
  spawnAgent("Dev-A", "Implement Phase 3: User Story 1 - Core Messaging"),
  spawnAgent("Dev-B", "Implement Phase 4: User Story 2 - P2P Communication"),
  spawnAgent("Dev-C", "Implement Phase 6: User Story 4 - Presence & Discovery")
]);

// After all agents complete:
git add src/server/ src/tools/messaging.ts tests/contract/messaging.test.ts tests/integration/user-story-1.test.ts src/index.ts
git commit -m "feat: Phase 3 - User Story 1 (Core Messaging) - MVP"

git add src/tools/p2p.ts tests/contract/p2p.test.ts tests/integration/user-story-2.test.ts
git commit -m "feat: Phase 4 - User Story 2 (P2P Communication)"

git add src/tools/presence.ts tests/contract/presence.test.ts tests/integration/user-story-4.test.ts
git commit -m "feat: Phase 6 - User Story 4 (Presence & Discovery)"
```

---

## Phase 3: User Story 1 - Core Messaging (Priority: P1) 🎯 MVP

**Executor**: Dev-A Agent (parallel with Phases 4, 6)

**Goal**: Enable agents to send messages to shared threads and poll for new messages with automatic cursor management.

**Independent Test**: One agent sends a message via send_message, a second agent polls and receives that exact message with correct sequencing.

**Phase Boundaries**:
- **Input**: Storage layer from Phase 2
- **Output**: Working MCP server with send_message and poll_messages tools
- **Files Created**: `src/server/mcp-server.ts`, `src/server/tool-registry.ts`, `src/tools/messaging.ts`, `src/index.ts`, contract and integration tests
- **User Stories**: US1 only

**Dependencies**: Phase 2 (storage layer)

⚠️ **Dev-A DOES NOT COMMIT** - Parent commits at sync point

### Implementation for User Story 1

- [ ] T030 [P] [US1] Initialize MCP server with stdio transport in src/server/mcp-server.ts
- [ ] T031 [P] [US1] Implement handle inference from environment in src/server/mcp-server.ts
- [ ] T032 [P] [US1] Create tool registry structure in src/server/tool-registry.ts
- [ ] T033 [US1] Implement send_message tool in src/tools/messaging.ts (validate input, append to thread, return confirmation)
- [ ] T034 [US1] Implement poll_messages tool in src/tools/messaging.ts (multi-thread polling, cursor-based delivery, timeout support)
- [ ] T034a [US1] Implement automatic presence update middleware in src/server/mcp-server.ts  (update last_request_ts on every tool invocation)
- [ ] T035 [US1] Implement reset_cursor tool in src/tools/messaging.ts (reset read position, handle clamping)
- [ ] T036 [P] [US1] Contract test for send_message in tests/contract/messaging.test.ts (valid input, size limits, sanitization)
- [ ] T037 [P] [US1] Contract test for poll_messages in tests/contract/messaging.test.ts (multi-thread, timeout, cursor advancement)
- [ ] T038 [P] [US1] Contract test for reset_cursor in tests/contract/messaging.test.ts
- [ ] T039 [US1] Integration test for User Story 1 in tests/integration/user-story-1.test.ts (agent-a sends, agent-b receives)
- [ ] T040 [US1] Integration test for concurrent writes in tests/integration/user-story-1.test.ts (unique seq numbers under load)
- [ ] T041 [US1] Create CLI entry point in src/index.ts (parse arguments, start server)
- [ ] T042 [US1] Run contract and integration tests for US1, verify all pass

**Dev-A Complete** → Return to parent (no commit)

---

## Phase 4: User Story 2 - P2P Communication (Priority: P1)

**Executor**: Dev-B Agent (parallel with Phases 3, 6)

**Goal**: Enable agents to establish private peer-to-peer channels with canonical naming for direct communication.

**Independent Test**: Agent-a opens P2P with agent-b, sends a private message, and agent-b receives it in the P2P thread while agent-c cannot access it.

**Phase Boundaries**:
- **Input**: Storage layer from Phase 2
- **Output**: P2P tools with canonical thread naming
- **Files Created**: `src/tools/p2p.ts`, contract and integration tests for P2P
- **User Stories**: US2 only

**Dependencies**: Phase 2 (storage layer)

⚠️ **Dev-B DOES NOT COMMIT** - Parent commits at sync point

### Implementation for User Story 2

- [ ] T043 [P] [US2] Implement canonical P2P naming algorithm in src/tools/p2p.ts (lowercase, alphabetically sorted)
- [ ] T044 [US2] Implement open_p2p tool in src/tools/p2p.ts (resolve canonical thread name, create if needed)
- [ ] T045 [US2] Implement send_p2p tool in src/tools/p2p.ts (convenience: open + send)
- [ ] T046 [P] [US2] Contract test for open_p2p in tests/contract/p2p.test.ts (canonical naming both directions)
- [ ] T047 [P] [US2] Contract test for send_p2p in tests/contract/p2p.test.ts
- [ ] T048 [US2] Integration test for User Story 2 in tests/integration/user-story-2.test.ts (private messaging, third party cannot access)
- [ ] T049 [US2] Run contract and integration tests for US2, verify all pass

**Dev-B Complete** → Return to parent (no commit)

---

## Phase 6: User Story 4 - Presence & Discovery (Priority: P2)

**Executor**: Dev-C Agent (parallel with Phases 3, 4)

**Goal**: Enable agents to announce their presence (role, expertise) and view which other agents are currently active.

**Independent Test**: Agent-a introduces itself with role "researcher" and expertise ["NLP", "data mining"], sends heartbeat, then agent-b queries who's online and verifies agent-a appears with correct metadata.

**Phase Boundaries**:
- **Input**: Storage layer from Phase 2 (specifically state-ops.ts)
- **Output**: Presence tools with introduce, heartbeat, and who_online
- **Files Created**: `src/tools/presence.ts`, contract and integration tests for presence
- **User Stories**: US4 only

**Dependencies**: Phase 2 (state-ops for presence and profiles)

⚠️ **Dev-C DOES NOT COMMIT** - Parent commits at sync point

### Implementation for User Story 4

- [ ] T050 [P] [US4] Implement introduce tool in src/tools/presence.ts (create/update profile with role and expertise)
- [ ] T051 [P] [US4] Implement send_heartbeat tool in src/tools/presence.ts (update presence with status and timestamp)
- [ ] T052 [P] [US4] Implement who_online tool in src/tools/presence.ts (query active agents, include profiles)
- [ ] T053 [P] [US4] Contract test for introduce in tests/contract/presence.test.ts
- [ ] T054 [P] [US4] Contract test for send_heartbeat in tests/contract/presence.test.ts
- [ ] T055 [P] [US4] Contract test for who_online in tests/contract/presence.test.ts (TTL filtering)
- [ ] T056 [US4] Integration test for User Story 4 in tests/integration/user-story-4.test.ts (presence lifecycle, TTL expiration)
- [ ] T057 [US4] Run contract and integration tests for US4, verify all pass

**Dev-C Complete** → Return to parent (no commit)

---

**⏸️ SYNC POINT 1 REACHED**

Parent coordinator commits phases 3, 4, 6:
```bash
git commit -m "feat: Phase 3 - User Story 1 (Core Messaging) - MVP"
git commit -m "feat: Phase 4 - User Story 2 (P2P Communication)"
git commit -m "feat: Phase 6 - User Story 4 (Presence & Discovery)"
```

---

## 🔀 SYNC POINT 2: Parallel Wave 2 [Phases 5, 7, 10]

**Parent Action**: Spawn 3 agents in parallel, wait for completion, then commit

### Agent Spawning Instructions

```typescript
// Pseudo-code for parent coordinator
await Promise.all([
  spawnAgent("Dev-A", "Implement Phase 5: User Story 3 - Multi-Thread Polling"),
  spawnAgent("Dev-B", "Implement Phase 7: User Story 5 - Announcements"),
  spawnAgent("Dev-C", "Implement Phase 10: CLI & Documentation")
]);

// After all agents complete:
git add src/tools/messaging.ts tests/contract/messaging.test.ts tests/integration/user-story-3.test.ts
git commit -m "feat: Phase 5 - User Story 3 (Multi-Thread Polling with Timeout)"

git add src/tools/announcements.ts src/storage/state-ops.ts tests/contract/announcements.test.ts tests/integration/user-story-5.test.ts
git commit -m "feat: Phase 7 - User Story 5 (Space-Wide Announcements)"

git add src/index.ts package.json README.md
git commit -m "feat: Phase 10 - CLI & Documentation"
```

---

## Phase 5: User Story 3 - Multi-Thread Polling with Timeout (Priority: P2)

**Executor**: Dev-A Agent (parallel with Phases 7, 10)

**Goal**: Enable agents to poll multiple threads simultaneously with blocking timeout for efficient message retrieval.

**Independent Test**: Agent starts polling with 5-second timeout on three threads, a message arrives in one thread after 2 seconds, and poll returns immediately (not waiting full timeout).

**Phase Boundaries**:
- **Input**: Messaging tools from Phase 3
- **Output**: Enhanced poll_messages with efficient blocking and early return
- **Files Modified**: `src/tools/messaging.ts` (poll_messages enhancement)
- **User Stories**: US3 only

**Dependencies**: Phase 3 (poll_messages tool must exist)

⚠️ **Dev-A DOES NOT COMMIT** - Parent commits at sync point

### Implementation for User Story 3

- [ ] T058 [US3] Implement blocking poll mechanism in src/tools/messaging.ts (EventEmitter-based notification)
- [ ] T059 [US3] Implement early return on message arrival in src/tools/messaging.ts (detect new messages, cancel timeout)
- [ ] T060 [US3] Implement parallel thread reads in src/tools/messaging.ts (read multiple threads concurrently)
- [ ] T061 [P] [US3] Contract test for blocking poll behavior in tests/contract/messaging.test.ts (timeout vs early return)
- [ ] T062 [US3] Integration test for User Story 3 in tests/integration/user-story-3.test.ts (multi-thread poll with timeout)
- [ ] T063 [US3] Run contract and integration tests for US3, verify all pass

**Dev-A Complete** → Return to parent (no commit)

---

## Phase 7: User Story 5 - Space-Wide Announcements (Priority: P3)

**Executor**: Dev-B Agent (parallel with Phases 5, 10)

**Goal**: Enable coordinator agents to post announcements visible to all agents in a space, with dynamic "Who's online" sections.

**Independent Test**: Set an announcement in a space, have multiple agents poll or fetch announcements, and verify they all receive the same content with appended "Who's online" section.

**Phase Boundaries**:
- **Input**: Messaging and presence systems from Phases 3, 6
- **Output**: Announcement tools with version tracking and exactly-once delivery
- **Files Created**: `src/tools/announcements.ts`, contract and integration tests for announcements
- **Files Modified**: `src/storage/state-ops.ts` (announcement seen tracking)
- **User Stories**: US5 only

**Dependencies**: Phase 2 (state-ops), Phase 6 (who_online for dynamic section)

⚠️ **Dev-B DOES NOT COMMIT** - Parent commits at sync point

### Implementation for User Story 5

- [ ] T064 [P] [US5] Implement announcement_set tool in src/tools/announcements.ts (replace content, bump version)
- [ ] T065 [P] [US5] Implement announcement_append tool in src/tools/announcements.ts (append to content, bump version)
- [ ] T066 [P] [US5] Implement announcement_get tool in src/tools/announcements.ts (retrieve current announcement)
- [ ] T067 [US5] Implement announcement seen tracking in src/storage/state-ops.ts (per-handle version tracking)
- [ ] T068 [P] [US5] Contract test for announcement_set in tests/contract/announcements.test.ts
- [ ] T069 [P] [US5] Contract test for announcement_append in tests/contract/announcements.test.ts (version increment, size limits)
- [ ] T070 [P] [US5] Contract test for announcement_get in tests/contract/announcements.test.ts
- [ ] T071 [US5] Integration test for User Story 5 in tests/integration/user-story-5.test.ts (exactly-once delivery per version)
- [ ] T072 [US5] Run contract and integration tests for US5, verify all pass

**Dev-B Complete** → Return to parent (no commit)

---

## Phase 10: CLI & Documentation

**Executor**: Dev-C Agent (parallel with Phases 5, 7)

**Purpose**: Command-line interface and comprehensive documentation for project completeness.

**Phase Boundaries**:
- **Input**: Complete MCP server implementation from Phase 3
- **Output**: Polished CLI with help/version, updated README, package.json bin configuration
- **Files Modified**: `src/index.ts`, `README.md`, `package.json`
- **User Stories**: Cross-cutting

**Dependencies**: Phase 3 (MCP server must exist)

⚠️ **Dev-C DOES NOT COMMIT** - Parent commits at sync point

### Tasks

- [ ] T073 [P] Implement CLI argument parsing in src/index.ts (--root, --handle, --space-default, --presence-ttl)
- [ ] T074 [P] Implement environment variable support in src/index.ts (SWARMBBS_ROOT, SWARMBBS_HANDLE, etc.)
- [ ] T075 [P] Add --help and --version flags in src/index.ts
- [ ] T076 [P] Implement graceful shutdown handling in src/index.ts
- [ ] T077 [P] Update package.json with bin entry and build scripts
- [ ] T078 [P] Create comprehensive README.md with installation, usage, examples
- [ ] T079 Build project and test CLI execution with `npm run build && node dist/index.js --help`

**Dev-C Complete** → Return to parent (no commit)

---

**⏸️ SYNC POINT 2 REACHED**

Parent coordinator commits phases 5, 7, 10:
```bash
git commit -m "feat: Phase 5 - User Story 3 (Multi-Thread Polling with Timeout)"
git commit -m "feat: Phase 7 - User Story 5 (Space-Wide Announcements)"
git commit -m "feat: Phase 10 - CLI & Documentation"
```

---

## 🔀 SYNC POINT 3: Parallel Wave 3 [Phases 8, 9, 11]

**Parent Action**: Spawn 3 agents in parallel, wait for completion, then commit

### Agent Spawning Instructions

```typescript
// Pseudo-code for parent coordinator
await Promise.all([
  spawnAgent("Dev-A", "Implement Phase 8: User Story 6 - Thread Compaction"),
  spawnAgent("Dev-B", "Implement Phase 9: Lifecycle & Management Tools"),
  spawnAgent("Dev-C", "Implement Phase 11: Final Validation & Polish")
]);

// After all agents complete:
git add src/storage/compaction-impl.ts src/tools/compaction.ts tests/contract/compaction.test.ts tests/unit/compaction.test.ts tests/integration/user-story-6.test.ts
git commit -m "feat: Phase 8 - User Story 6 (Thread Compaction)"

git add src/tools/lifecycle.ts tests/contract/lifecycle.test.ts
git commit -m "feat: Phase 9 - Lifecycle & Management Tools"

git commit -m "chore: Phase 11 - Final Validation & Polish"
```

---

## Phase 8: User Story 6 - Thread Compaction (Priority: P3)

**Executor**: Dev-A Agent (parallel with Phases 9, 11)

**Goal**: Enable agents to compact long threads without data loss using two-phase protocol (begin, commit, abort).

**Independent Test**: Start compaction on thread with 1000 messages, send 10 new messages during compaction, commit, and verify all 10 delta messages are preserved along with snapshot.

**Phase Boundaries**:
- **Input**: Messaging system from Phase 3
- **Output**: Compaction tools with two-phase protocol and zero message loss
- **Files Created**: `src/storage/compaction-impl.ts`, `src/tools/compaction.ts`, contract, unit, and integration tests
- **User Stories**: US6 only

**Dependencies**: Phase 2 (thread-ops for file operations)

⚠️ **Dev-A DOES NOT COMMIT** - Parent commits at sync point

### Implementation for User Story 6

- [ ] T080 [P] [US6] Implement compaction begin in src/storage/compaction-impl.ts (freeze base, create delta file, track session)
- [ ] T081 [P] [US6] Implement delta file writes in src/storage/compaction-impl.ts (divert new messages to delta)
- [ ] T082 [P] [US6] Implement compaction commit in src/storage/compaction-impl.ts (snapshot + kept messages + delta replay, atomic rename)
- [ ] T083 [P] [US6] Implement compaction abort in src/storage/compaction-impl.ts (merge delta back to base)
- [ ] T084 [US6] Implement epoch bumping and min_available_seq in src/storage/compaction-impl.ts
- [ ] T085 [US6] Implement compact_begin tool in src/tools/compaction.ts (validate no existing session, start compaction)
- [ ] T086 [US6] Implement compact_commit tool in src/tools/compaction.ts (validate snapshot, commit with fsync)
- [ ] T087 [US6] Implement compact_abort tool in src/tools/compaction.ts (cleanup and merge)
- [ ] T088 [P] [US6] Contract test for compact_begin in tests/contract/compaction.test.ts (conflict detection)
- [ ] T089 [P] [US6] Contract test for compact_commit in tests/contract/compaction.test.ts
- [ ] T090 [P] [US6] Contract test for compact_abort in tests/contract/compaction.test.ts
- [ ] T091 [P] [US6] Unit test for compaction protocol edge cases in tests/unit/compaction.test.ts (concurrent writes during compaction)
- [ ] T092 [US6] Integration test for User Story 6 in tests/integration/user-story-6.test.ts (zero message loss, cursor clamping)
- [ ] T093 [US6] Run contract, unit, and integration tests for US6, verify all pass

**Dev-A Complete** → Return to parent (no commit)

---

## Phase 9: Lifecycle & Management Tools

**Executor**: Dev-B Agent (parallel with Phases 8, 11)

**Purpose**: Space management and listing operations for operational workflows.

**Phase Boundaries**:
- **Input**: Storage layer from Phase 2
- **Output**: Lifecycle tools for managing spaces and threads
- **Files Created**: `src/tools/lifecycle.ts`, contract tests for lifecycle
- **User Stories**: Cross-cutting (no specific user story)

**Dependencies**: Phase 2 (storage layer for file operations)

⚠️ **Dev-B DOES NOT COMMIT** - Parent commits at sync point

### Tasks

- [ ] T094 [P] Implement list_spaces tool in src/tools/lifecycle.ts (enumerate available spaces)
- [ ] T095 [P] Implement list_threads tool in src/tools/lifecycle.ts (list threads in space, optionally include P2P)
- [ ] T096 [P] Implement archive_space tool in src/tools/lifecycle.ts (move space to archive with timestamp)
- [ ] T097 [P] Implement clear_space tool in src/tools/lifecycle.ts (delete space with confirmation)
- [ ] T098 [P] Contract test for list_spaces in tests/contract/lifecycle.test.ts
- [ ] T099 [P] Contract test for list_threads in tests/contract/lifecycle.test.ts
- [ ] T100 [P] Contract test for archive_space in tests/contract/lifecycle.test.ts
- [ ] T101 [P] Contract test for clear_space in tests/contract/lifecycle.test.ts (destructive hint, confirmation)
- [ ] T102 Run contract tests for lifecycle tools, verify all pass

**Dev-B Complete** → Return to parent (no commit)

---

## Phase 11: Final Validation & Polish

**Executor**: Dev-C Agent (parallel with Phases 8, 9)

**Purpose**: End-to-end validation using quickstart scenarios and final polish.

**Phase Boundaries**:
- **Input**: Complete implementation from all previous phases
- **Output**: Production-ready project with all tests passing
- **User Stories**: All (validation)

**Dependencies**: All previous phases

⚠️ **Dev-C DOES NOT COMMIT** - Parent commits at sync point

### Tasks

- [ ] T103 Run all unit tests (`npm run test tests/unit/`), verify 100% pass rate
- [ ] T104 Run all contract tests (`npm run test tests/contract/`), verify 100% pass rate
- [ ] T105 Run all integration tests (`npm run test tests/integration/`), verify 100% pass rate
- [ ] T106 Validate quickstart scenarios from quickstart.md work end-to-end
- [ ] T107 [P] Test npx execution: `npx swarmbbs start --root ./test-data --handle test-agent`
- [ ] T108 [P] Performance validation: verify <100ms latency for send+poll round-trip
- [ ] T109 [P] Performance validation: verify >1000 msg/sec sustained write throughput
- [ ] T110 [P] Verify error messages are actionable with clear next steps
- [ ] T111 [P] Code review for constitutional compliance (file sizes <500 lines, modular architecture)

**Dev-C Complete** → Return to parent (no commit)

---

**⏸️ SYNC POINT 3 REACHED**

Parent coordinator commits phases 8, 9, 11:
```bash
git commit -m "feat: Phase 8 - User Story 6 (Thread Compaction)"
git commit -m "feat: Phase 9 - Lifecycle & Management Tools"
git commit -m "chore: Phase 11 - Final Validation & Polish"
```

---

## 🎉 IMPLEMENTATION COMPLETE

All phases delivered, all commits made by parent coordinator.

---

## Execution Timeline (3 Developers)

```
Time  | Parent        | Dev-A           | Dev-B           | Dev-C
------|---------------|-----------------|-----------------|----------------
0h    | Phase 1       | -               | -               | -
0h    | COMMIT 1      | -               | -               | -
2h    | Phase 2       | -               | -               | -
2h    | COMMIT 2      | -               | -               | -
8h    | SPAWN WAVE 1  | Phase 3 (US1)   | Phase 4 (US2)   | Phase 6 (US4)
14h   | COMMIT 3,4,6  | -               | -               | -
14h   | SPAWN WAVE 2  | Phase 5 (US3)   | Phase 7 (US5)   | Phase 10 (CLI)
17h   | COMMIT 5,7,10 | -               | -               | -
17h   | SPAWN WAVE 3  | Phase 8 (US6)   | Phase 9 (Life.) | Phase 11 (Val.)
22h   | COMMIT 8,9,11 | -               | -               | -
22h   | COMPLETE ✅   | -               | -               | -
```

**Total Time**: ~22 hours (vs ~35 hours solo)

---

## Dependencies Visualization

```
Phase 1 (Setup) - Parent
    ↓
COMMIT 1 - Parent 
    ↓    
Phase 2 (Storage) - Parent
    ↓
COMMIT 2 - Parent  
    ↓    
    ├─────────────────┬─────────────────┐
    ↓                 ↓                 ↓
Phase 3 (US1)    Phase 4 (US2)    Phase 6 (US4)
Dev-A            Dev-B            Dev-C
    ↓                 ↓                 ↓
    └─────────────────┴─────────────────┘
                      ↓
            [SYNC POINT 1 - Parent commits]
                      ↓
    ├─────────────────┬─────────────────┐
    ↓                 ↓                 ↓
Phase 5 (US3)    Phase 7 (US5)    Phase 10 (CLI)
Dev-A            Dev-B            Dev-C
    ↓                 ↓                 ↓
    └─────────────────┴─────────────────┘
                      ↓
            [SYNC POINT 2 - Parent commits]
                      ↓
    ├─────────────────┬─────────────────┐
    ↓                 ↓                 ↓
Phase 8 (US6)    Phase 9 (Life.)  Phase 11 (Val.)
Dev-A            Dev-B            Dev-C
    ↓                 ↓                 ↓
    └─────────────────┴─────────────────┘
                      ↓
            [SYNC POINT 3 - Parent commits]
                      ↓
                  COMPLETE
```

---

## Summary

- **Total Tasks**: 111 tasks across 11 phases
- **Parallel Waves**: 3 waves with 3 agents each
- **Sync Points**: 3 sync points where parent commits
- **User Stories**: 6 stories (US1-US6) mapped to phases
- **Test Coverage**: 41 test tasks (contract, integration, unit)
- **Parallelizable Tasks**: 55 tasks marked [P]
- **Estimated Time**: ~22 hours with 3-person team (vs ~35 hours solo)
- **Git Commits**: 9 feature commits (all made by parent coordinator)

### Critical Rules Summary

✅ Sub-agents implement phases but **DO NOT COMMIT**
✅ Parent coordinator waits at sync points for all agents to complete
✅ Parent commits all phases after each sync point
✅ Phases are isolated by file boundaries to prevent conflicts
✅ Each phase is independently testable
