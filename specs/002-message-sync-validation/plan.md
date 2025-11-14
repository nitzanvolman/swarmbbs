# Implementation Plan: Message Synchronization Validation

**Branch**: `002-message-sync-validation` | **Date**: 2025-11-14 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/002-message-sync-validation/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

This feature adds synchronization validation to SwarmBBS message sending operations. When an agent attempts to send a message to a thread (regular or P2P), the system validates that the agent's cursor is up-to-date with the thread's current state. If the agent has unread messages, the send operation is rejected with a 409 Conflict error that includes all missing messages. The agent's cursor is automatically advanced, allowing the agent to review the context and retry with updated information. This prevents agents from sending messages based on incomplete conversation context.

**Technical Approach**: Extend existing send message operations in `src/tools/messaging.ts` and `src/tools/p2p.ts` to perform pre-send cursor validation using existing cursor operations from `src/storage/cursor-ops.ts`. Leverage existing thread reading and cursor management infrastructure. Add new error type for sync conflicts with structured response format including missing messages array.

## Technical Context

**Language/Version**: TypeScript 5.7.2 / Node.js 22.x LTS
**Primary Dependencies**: @modelcontextprotocol/sdk ^1.21.1, ajv ^8.17.1 (JSON schema validation), async-mutex ^0.5.0 (locking)
**Storage**: File-based JSONL (existing pattern: threads in `spaces/<space>/threads/<thread>.jsonl`, cursors in `spaces/<space>/state/cursors/<handle>/<thread>.json`)
**Testing**: Vitest 2.1.5 (unit, integration, contract, e2e)
**Target Platform**: Node.js server (MCP server via stdio transport)
**Project Type**: Single project (CLI/server application)
**Performance Goals**:
- Sync validation check adds <10ms overhead to send operations when agent is current
- Sync error response generation <50ms including message retrieval
- Support 10 concurrent sync errors without corruption
**Constraints**:
- Must preserve existing atomicity guarantees (per-thread mutexes)
- Sync error responses capped at max_per_thread limit (1000 messages default)
- Must work correctly with existing cursor advancement and epoch tracking
**Scale/Scope**:
- Affects 2 existing MCP tools: swarmbbs.sendMessage, swarmbbs.sendP2P
- Introduces 1 new error type with structured format
- Requires 1 new e2e test (parallel FizzBuzz without strict turns)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### ✅ I. Parallel Task Execution (NON-NEGOTIABLE)
**Status**: PASS
**Rationale**: Implementation tasks can be parallelized:
- Sync validation logic extension (operates on messaging tools)
- Error response formatting (separate from validation)
- Test creation (independent e2e test)
- All operate on separate files, no conflicts expected

### ✅ II. Test-Driven Development (NON-NEGOTIABLE)
**Status**: PASS
**Rationale**: Feature will follow TDD workflow:
1. Write contract tests for sync error response format
2. Write integration tests for cursor validation logic
3. Write e2e test for parallel FizzBuzz coordination
4. Verify all tests fail (Red phase)
5. Implement sync validation to pass tests (Green phase)
6. Refactor for clarity and maintainability

### ✅ III. Organized File Structure (NON-NEGOTIABLE)
**Status**: PASS
**Rationale**: All artifacts properly organized:
- Specs/docs: `specs/002-message-sync-validation/` (plan.md, research.md, data-model.md, contracts/, tasks.md)
- Source: `src/` (extend existing tools/, storage/, utils/)
- Tests: `tests/` (contract/, integration/, e2e/)
- No root-level pollution

### ✅ IV. Modular Code Architecture
**Status**: PASS
**Rationale**: Changes are localized and modular:
- Sync validation logic: Small extension to existing `cursor-ops.ts` (<500 lines currently)
- Error formatting: New utility function in `utils/errors.ts` (<500 lines currently)
- Tool modifications: Updates to `tools/messaging.ts` and `tools/p2p.ts` (both <500 lines)
- E2E test: New file in `tests/e2e/` following existing 3-hats pattern
- All files remain under 500-line limit

### ✅ V. Claude Code Task Tool as Primary Agent Spawner
**Status**: PASS
**Rationale**: Implementation will use Task tool for parallel execution:
- Research agents for sync validation patterns
- Parallel test creation (contract, integration, e2e)
- Parallel implementation of validation and error formatting

### ✅ VI. Fail-Fast Error Handling (NON-NEGOTIABLE)
**Status**: PASS
**Rationale**: Feature enhances fail-fast behavior:
- Sync validation explicitly fails send operations with clear 409 error
- Error message is actionable: "Cannot send: you have unread messages in this thread. Your cursor has been advanced. Please review the messages below and retry if still relevant."
- No silent fallbacks - agents are forced to acknowledge missing context
- Missing messages included in error response for immediate visibility
- Aligns perfectly with constitution's fail-fast principle

### ✅ VII. Autonomous Task Completion (NON-NEGOTIABLE)
**Status**: PASS
**Rationale**: Implementation decisions are straightforward:
- Extend existing patterns (cursor validation, error responses, MCP error format)
- No business policy decisions required
- Technical choices follow existing SwarmBBS conventions
- Decisions will be documented in decisions.md if any arise during implementation

### Constitution Compliance Summary
**Overall Status**: ✅ ALL GATES PASS
**Proceed to Phase 0**: YES

## Project Structure

### Documentation (this feature)

```text
specs/002-message-sync-validation/
├── spec.md              # Feature specification (completed)
├── checklists/
│   └── requirements.md  # Spec quality checklist (completed)
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
│   └── sync-error-response.schema.json
├── decisions.md         # Autonomous decisions log (created during implementation if needed)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
src/
├── utils/
│   ├── errors.ts          # [EXTEND] Add SyncError class and formatting
│   ├── validation.ts      # [UNCHANGED]
│   └── locking.ts         # [UNCHANGED]
├── storage/
│   ├── thread-ops.ts      # [UNCHANGED]
│   ├── cursor-ops.ts      # [EXTEND] Add sync validation function
│   ├── tail-reader.ts     # [REUSE] For retrieving missing messages
│   ├── state-ops.ts       # [UNCHANGED]
│   └── compaction-impl.ts # [UNCHANGED]
├── types/
│   ├── events.ts          # [UNCHANGED]
│   ├── state.ts           # [EXTEND] Add SyncErrorResponse type
│   └── schemas.ts         # [EXTEND] Add sync error schema
├── tools/
│   ├── messaging.ts       # [EXTEND] Add pre-send sync validation
│   ├── p2p.ts             # [EXTEND] Add pre-send sync validation
│   ├── presence.ts        # [UNCHANGED]
│   ├── announcements.ts   # [UNCHANGED]
│   ├── compaction.ts      # [UNCHANGED]
│   ├── lifecycle.ts       # [UNCHANGED]
│   ├── lifecycle-list.ts  # [UNCHANGED]
│   └── lifecycle-admin.ts # [UNCHANGED]
├── server/
│   ├── mcp-server.ts      # [UNCHANGED]
│   └── tool-registry.ts   # [UNCHANGED]
└── index.ts               # [UNCHANGED]

tests/
├── contract/
│   └── sync-validation.contract.test.ts  # [NEW] Contract tests for sync error format
├── integration/
│   └── sync-validation.integration.test.ts  # [NEW] Integration tests for cursor validation
├── unit/
│   └── sync-error-formatting.test.ts  # [NEW] Unit tests for error response formatting
└── e2e/
    ├── fixtures/
    │   └── e2e-helpers.ts     # [UNCHANGED] Reuse existing helpers
    ├── lib/
    │   └── agent-runner.ts    # [UNCHANGED] Reuse existing runner
    ├── fizzbuzz-turns.test.ts # [EXISTING] Strict turn-based FizzBuzz
    ├── fizzbuzz-parallel.test.ts  # [NEW] Parallel FizzBuzz without turn enforcement
    └── three-hats.test.ts     # [EXISTING] Logic puzzle e2e test
```

**Structure Decision**: Using existing single-project structure (Option 1). Feature extends existing MCP server codebase with sync validation functionality. All source code remains in `src/` organized by function (utils, storage, types, tools, server). Tests organized by type (contract, integration, unit, e2e) following existing conventions.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No violations. All constitutional principles are satisfied by this feature design.

---

## Post-Design Constitution Check

*Re-evaluation after Phase 1 design (research.md, data-model.md, contracts/ complete)*

### ✅ I. Parallel Task Execution
**Status**: PASS (reconfirmed)
**Evidence**:
- research.md identifies 6 independent research topics
- Implementation can proceed in parallel: sync validation logic, error formatting, test creation
- No architectural decisions that prevent parallelization
- File modifications remain isolated (cursor-ops.ts, errors.ts, messaging.ts, p2p.ts)

### ✅ II. Test-Driven Development
**Status**: PASS (reconfirmed)
**Evidence**:
- data-model.md defines all types needed for test assertions
- contracts/sync-error-response.schema.json provides contract test specification
- research.md section 5 outlines e2e test design (fizzbuzz-parallel.test.ts)
- TDD workflow explicitly documented in quickstart.md testing section
- All functional requirements (FR-001 through FR-031) are testable

### ✅ III. Organized File Structure
**Status**: PASS (reconfirmed)
**Evidence**:
- All design artifacts in specs/002-message-sync-validation/
- Source modifications follow existing src/ structure
- Tests organized by type in tests/{contract,integration,unit,e2e}/
- No temporary files or root pollution
- Project structure documented in plan.md matches actual layout

### ✅ IV. Modular Code Architecture
**Status**: PASS (reconfirmed)
**Evidence**:
- research.md validates all modified files remain <500 lines:
  - cursor-ops.ts: +50 lines (validateCursorSync function)
  - errors.ts: +15 lines (syncConflict factory)
  - types/state.ts: +10 lines (type definitions)
  - messaging.ts: +10 lines (validation call)
  - p2p.ts: +10 lines (validation call)
- Single responsibility maintained: cursor validation in cursor-ops, error formatting in errors
- No god objects introduced

### ✅ V. Claude Code Task Tool
**Status**: PASS (reconfirmed)
**Evidence**: Planning complete, implementation phase will use Task tool for parallel execution per constitution

### ✅ VI. Fail-Fast Error Handling
**Status**: PASS (reconfirmed)
**Evidence**:
- data-model.md defines explicit SyncErrorResponse structure
- contracts/sync-error-response.schema.json enforces error format
- research.md section 2 confirms error includes actionable next steps
- Cursor advancement happens before throwing (guaranteed persistence)
- No silent fallbacks introduced
- Clear error message: "Cannot send: you have unread messages..."

### ✅ VII. Autonomous Task Completion
**Status**: PASS (reconfirmed)
**Evidence**:
- research.md documents all technical decisions with rationales
- All "unknowns" from Technical Context resolved
- No business policy decisions required
- Implementation follows existing patterns (no novel architectures)
- decisions.md prepared in project structure if runtime decisions needed

### Post-Design Compliance Summary
**Overall Status**: ✅ ALL GATES PASS
**Readiness**: Design complete, ready for Phase 2 (task generation via /speckit.tasks)
**Confidence**: High - all principles satisfied, no risks identified
