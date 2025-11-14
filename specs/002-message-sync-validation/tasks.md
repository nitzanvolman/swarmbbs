# Tasks: Message Synchronization Validation

**Input**: Design documents from `/specs/002-message-sync-validation/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: This feature follows Test-Driven Development per Constitution Principle II. All test tasks are included and MUST be completed before implementation tasks.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Single project structure**: `src/`, `tests/` at repository root
- TypeScript/Node.js project with Vitest testing framework
- Paths follow existing SwarmBBS structure documented in plan.md

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization - no infrastructure changes needed, codebase already exists

*Note: No setup tasks required. Feature extends existing SwarmBBS codebase.*

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core type definitions and infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T001 [P] Add CursorState type definition to src/types/state.ts
- [ ] T002 [P] Add SyncValidationResult type definition to src/types/state.ts
- [ ] T003 [P] Add SyncErrorContext type definition to src/types/state.ts
- [ ] T004 [P] Add syncConflict error factory function to src/utils/errors.ts
- [ ] T005 Add validateCursorSync function to src/storage/cursor-ops.ts

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Agent attempts to send message without reading latest messages (Priority: P1) 🎯 MVP

**Goal**: Implement core synchronization validation that detects when an agent's cursor is out of sync with thread state, rejects the send, returns missing messages, and advances cursor automatically.

**Independent Test**: Can be fully tested by having agent-a send message #1, agent-b send message #2, then agent-a (still at cursor seq=1) try to send message #3. System should reject with 409 error and return message #2, then agent-a can retry successfully after processing message #2.

### Tests for User Story 1 (TDD: Write tests FIRST, verify they FAIL)

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [ ] T006 [P] [US1] Contract test for sync error response format in tests/contract/sync-validation.contract.test.ts
- [ ] T007 [P] [US1] Unit test for syncConflict error factory in tests/unit/sync-error-formatting.test.ts
- [ ] T008 [US1] Integration test for validateCursorSync function in tests/integration/sync-validation.integration.test.ts
- [ ] T009 [US1] Integration test for cursor advancement during sync error in tests/integration/sync-validation.integration.test.ts
- [ ] T010 [US1] Integration test for send rejection when cursor behind in tests/integration/sync-validation.integration.test.ts

**Checkpoint - RED Phase**: All User Story 1 tests should FAIL (no implementation yet)

### Implementation for User Story 1

- [ ] T011 [US1] Implement validateCursorSync function body in src/storage/cursor-ops.ts (cursor read, thread metadata read, comparison logic)
- [ ] T012 [US1] Implement missing message retrieval in validateCursorSync using readThreadAfterSeq
- [ ] T013 [US1] Implement syncConflict error factory in src/utils/errors.ts (construct SwarmBBSError with 409, context, missing_messages)
- [ ] T014 [US1] Add pre-send sync validation call in src/tools/messaging.ts sendMessage handler
- [ ] T015 [US1] Add cursor advancement before throwing sync error in src/tools/messaging.ts
- [ ] T016 [US1] Add error handling and sync error throw in src/tools/messaging.ts

**Checkpoint - GREEN Phase**: All User Story 1 tests should PASS

**Checkpoint - REFACTOR Phase**: Review and refactor for clarity, run tests again to ensure still passing

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently - agents can send to regular threads with sync validation

---

## Phase 4: User Story 2 - Agent receives actionable sync error with missing context (Priority: P1)

**Goal**: Ensure sync error responses have clear, actionable format with all necessary metadata for AI agents to parse and self-correct autonomously.

**Independent Test**: Can be fully tested by triggering a sync error and verifying the error response contains: error type (409 Conflict), clear explanation, all missing messages with full metadata (seq, from, ts, text), and suggested next action.

### Tests for User Story 2 (TDD: Write tests FIRST, verify they FAIL)

- [ ] T017 [P] [US2] Contract test validating error response matches schema in tests/contract/sync-validation.contract.test.ts
- [ ] T018 [P] [US2] Integration test verifying error message clarity in tests/integration/sync-validation.integration.test.ts
- [ ] T019 [US2] Integration test checking missing_messages array completeness in tests/integration/sync-validation.integration.test.ts

**Checkpoint - RED Phase**: All User Story 2 tests should FAIL

### Implementation for User Story 2

- [ ] T020 [US2] Add JSON Schema validation test using contracts/sync-error-response.schema.json
- [ ] T021 [US2] Ensure error context includes complete message metadata (seq, from, ts, text, up_to_seq)
- [ ] T022 [US2] Verify error messages are ordered by seq in ascending order
- [ ] T023 [US2] Add nextSteps field to sync error responses with actionable guidance

**Checkpoint - GREEN Phase**: All User Story 2 tests should PASS

**Checkpoint**: At this point, User Stories 1 AND 2 should both work - sync errors are clear and actionable

---

## Phase 5: User Story 3 - Agent cursor automatically advances when sync error occurs (Priority: P1)

**Goal**: Implement automatic cursor advancement during sync error to prevent repeated sync errors and improve recovery UX.

**Independent Test**: Can be fully tested by triggering sync error at cursor seq=1 when thread is at seq=5, verifying cursor advances to seq=5, then having agent retry send operation and confirming it succeeds (no second sync error).

### Tests for User Story 3 (TDD: Write tests FIRST, verify they FAIL)

- [ ] T024 [US3] Integration test for cursor advancement to thread last_seq in tests/integration/sync-validation.integration.test.ts
- [ ] T025 [US3] Integration test for cursor persistence after sync error in tests/integration/sync-validation.integration.test.ts
- [ ] T026 [US3] Integration test for successful retry after cursor advancement in tests/integration/sync-validation.integration.test.ts

**Checkpoint - RED Phase**: All User Story 3 tests should FAIL

### Implementation for User Story 3

- [ ] T027 [US3] Implement cursor writeCursor call before throwing sync error in validateCursorSync
- [ ] T028 [US3] Ensure cursor_advanced field in error response reflects new cursor state
- [ ] T029 [US3] Handle epoch changes gracefully during cursor advancement (clamp to min_available_seq if needed)

**Checkpoint - GREEN Phase**: All User Story 3 tests should PASS

**Checkpoint**: All three P1 user stories should now work together - full sync validation with recovery flow

---

## Phase 6: User Story 4 - Multiple agents coordinate in parallel without strict turn-taking (Priority: P2)

**Goal**: Demonstrate that sync validation enables flexible, parallel coordination patterns where agents can send messages simultaneously and the system ensures consistency through sync validation.

**Independent Test**: Can be fully tested with FizzBuzz e2e test where agents race to post numbers - first agent posts "1", both try to post "2" simultaneously, one succeeds, other gets sync error with "1" and "2", realizes "2" is posted, skips to "3" or "4" based on rules.

### Tests for User Story 4 (TDD: Write tests FIRST, verify they FAIL)

- [ ] T030 [US4] E2E test for parallel FizzBuzz coordination in tests/e2e/fizzbuzz-parallel.test.ts
- [ ] T031 [US4] E2E test verification for correct FizzBuzz sequence (1-100) with no duplicates
- [ ] T032 [US4] E2E test verification for agent recovery from sync errors

**Checkpoint - RED Phase**: E2E test should FAIL (test framework ready, but sync validation behavior not yet tested in parallel scenario)

### Implementation for User Story 4

- [ ] T033 [US4] Create FizzBuzz parallel e2e test file in tests/e2e/fizzbuzz-parallel.test.ts
- [ ] T034 [US4] Implement agent prompts for parallel FizzBuzz (no turn enforcement)
- [ ] T035 [US4] Add test verification for sequence correctness (1-100, Fizz/Buzz/FizzBuzz rules)
- [ ] T036 [US4] Add test verification for no duplicate numbers (sync validation prevented races)
- [ ] T037 [US4] Add test verification for all agents participated despite sync conflicts

**Checkpoint - GREEN Phase**: E2E test should PASS - parallel FizzBuzz completes correctly

**Checkpoint**: At this point, parallel coordination is proven to work with sync validation

---

## Phase 7: User Story 5 - Sync validation works identically for regular threads and P2P threads (Priority: P2)

**Goal**: Ensure consistency across all thread types - both regular named threads and P2P threads use identical sync validation logic.

**Independent Test**: Can be fully tested by repeating basic sync validation test (User Story 1 scenarios) on a P2P thread between agent-a and agent-b, verifying identical error handling and cursor advancement behavior.

### Tests for User Story 5 (TDD: Write tests FIRST, verify they FAIL)

- [ ] T038 [P] [US5] Integration test for P2P sync validation in tests/integration/sync-validation.integration.test.ts
- [ ] T039 [P] [US5] Integration test for P2P cursor advancement in tests/integration/sync-validation.integration.test.ts
- [ ] T040 [US5] Integration test comparing regular and P2P sync error format equivalence in tests/integration/sync-validation.integration.test.ts

**Checkpoint - RED Phase**: P2P tests should FAIL

### Implementation for User Story 5

- [ ] T041 [US5] Add pre-send sync validation call in src/tools/p2p.ts sendP2P handler
- [ ] T042 [US5] Add cursor advancement before throwing sync error in src/tools/p2p.ts
- [ ] T043 [US5] Add error handling and sync error throw in src/tools/p2p.ts
- [ ] T044 [US5] Verify P2P cursor paths handled correctly in cursor-ops.ts (already supported)

**Checkpoint - GREEN Phase**: All P2P tests should PASS

**Checkpoint**: All user stories should now be independently functional - sync validation works across all thread types

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] T045 [P] Add error size limit handling (cap missing_messages at max_per_thread) in src/storage/cursor-ops.ts
- [ ] T046 [P] Add performance logging for sync validation operations in src/storage/cursor-ops.ts
- [ ] T047 [P] Update quickstart.md examples with real test results
- [ ] T048 Code review and refactoring for clarity (ensure all files remain <500 lines per Constitution IV)
- [ ] T049 [P] Add JSDoc comments to new functions (validateCursorSync, syncConflict)
- [ ] T050 Run full test suite (unit, integration, contract, e2e) and verify all pass
- [ ] T051 Verify performance goals met (<10ms validation overhead, <50ms sync error generation)
- [ ] T052 Run quickstart.md validation and update any outdated examples

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - SKIPPED (no setup needed)
- **Foundational (Phase 2)**: No dependencies - BLOCKS all user stories
- **User Stories (Phase 3-7)**: All depend on Foundational phase completion
  - User Story 1 (P1): Core sync validation - MVP foundation
  - User Story 2 (P1): Error format clarity - extends US1
  - User Story 3 (P1): Cursor advancement - extends US1
  - User Story 4 (P2): Parallel coordination proof - depends on US1-3 working
  - User Story 5 (P2): P2P support - independent of US4, depends on US1-3
- **Polish (Phase 8)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P1)**: Can start after US1 tests written - Extends US1 error formatting
- **User Story 3 (P1)**: Can start after US1 tests written - Extends US1 cursor logic
- **User Story 4 (P2)**: Can start after US1-3 complete - Depends on full sync validation working
- **User Story 5 (P2)**: Can start after US1-3 complete - Independent of US4, can be parallel

### Within Each User Story

- Tests MUST be written and FAIL before implementation (TDD Red phase)
- Tests marked [P] can run in parallel (different files)
- Implementation tasks follow dependency order (foundation before extensions)
- All tests must PASS after implementation (TDD Green phase)
- Refactor for clarity while keeping tests passing

### Parallel Opportunities

- **Foundational Phase**: T001, T002, T003, T004 can all run in parallel (different type definitions)
- **Within User Story 1 Tests**: T006, T007 can run in parallel (different test files)
- **Within User Story 2 Tests**: T017, T018, T019 can all run in parallel
- **Within User Story 5 Tests**: T038, T039 can run in parallel
- **User Story 4 and User Story 5**: Can be worked on in parallel by different developers (independent)
- **Polish Phase**: T045, T046, T047, T049 can all run in parallel

---

## Parallel Example: User Story 1

```bash
# Launch all parallel tests for User Story 1 together:
Task: "Contract test for sync error response format in tests/contract/sync-validation.contract.test.ts"
Task: "Unit test for syncConflict error factory in tests/unit/sync-error-formatting.test.ts"

# Then sequentially:
Task: "Integration test for validateCursorSync function"
Task: "Integration test for cursor advancement during sync error"
Task: "Integration test for send rejection when cursor behind"

# After tests FAIL (Red), launch parallel implementations:
Task: "Implement validateCursorSync function body" (can work on simultaneously with others)
Task: "Implement syncConflict error factory" (independent file)

# Then sequential implementation tasks that depend on above
```

---

## Parallel Example: User Story 4 + User Story 5 (Team parallelization)

```bash
# If you have 2 developers, they can work simultaneously after US1-3 complete:

Developer A: Phase 6 (User Story 4 - Parallel FizzBuzz e2e test)
- T030-T037 (parallel coordination proof)

Developer B: Phase 7 (User Story 5 - P2P sync validation)
- T038-T044 (P2P support)

# Both stories are independent and can integrate later
```

---

## Implementation Strategy

### MVP First (User Stories 1-3 Only) - Recommended

1. Complete Phase 2: Foundational types and infrastructure
2. Complete Phase 3: User Story 1 (core sync validation)
3. Complete Phase 4: User Story 2 (error format clarity)
4. Complete Phase 5: User Story 3 (cursor advancement)
5. **STOP and VALIDATE**: Test US1-3 together independently
6. **MVP READY**: Core sync validation working for regular threads

**Deliverable**: Agents can send messages with sync validation, receive actionable errors, and recover automatically. This is the minimum viable feature.

### Incremental Delivery (Add P2 stories)

7. Add Phase 6: User Story 4 (parallel coordination proof)
8. Add Phase 7: User Story 5 (P2P thread support)
9. **VALIDATE**: Test all stories together
10. **FEATURE COMPLETE**: Full sync validation across all thread types with parallel coordination proven

### Final Polish

11. Complete Phase 8: Polish & cross-cutting concerns
12. **PRODUCTION READY**: Performance verified, documentation updated, all tests passing

### Parallel Team Strategy

With 2+ developers after Foundational phase:

1. **Team completes Foundational together** (T001-T005)
2. **Developer A takes US1**: Core sync validation (T006-T016)
3. **Developer B takes US2+US3**: Error format + cursor advancement (T017-T029) - starts after US1 tests exist
4. **Developer A takes US4**: Parallel FizzBuzz (T030-T037) - after US1-3 done
5. **Developer B takes US5**: P2P support (T038-T044) - after US1-3 done, parallel with US4
6. **Team completes Polish together** (T045-T052)

---

## Notes

- **[P] tasks**: Different files, no dependencies - can run in parallel
- **[Story] label**: Maps task to specific user story for traceability
- **Each user story is independently testable**: Can verify US1 works without US2-5
- **TDD strictly enforced**: Write tests first, verify they fail, implement, verify they pass, refactor
- **Commit after each task**: Or logical group of related tasks
- **Stop at checkpoints**: To validate story independently before proceeding
- **Constitution compliance**: All files remain <500 lines (Principle IV), parallel execution used (Principle I), fail-fast errors (Principle VI)

---

## Test Coverage Summary

- **Contract Tests**: 2 files (sync error format, schema validation)
- **Unit Tests**: 1 file (error factory formatting)
- **Integration Tests**: 1 file with multiple test cases (cursor validation, advancement, send rejection, P2P)
- **E2E Tests**: 1 file (parallel FizzBuzz coordination)
- **Total Test Files**: 5 new test files covering all 5 user stories

---

## File Modifications Summary

**New Files** (5):
- tests/contract/sync-validation.contract.test.ts
- tests/unit/sync-error-formatting.test.ts
- tests/integration/sync-validation.integration.test.ts
- tests/e2e/fizzbuzz-parallel.test.ts
- contracts/sync-error-response.schema.json (already created in planning phase)

**Modified Files** (5):
- src/types/state.ts (+20 lines: type definitions)
- src/utils/errors.ts (+15 lines: syncConflict factory)
- src/storage/cursor-ops.ts (+60 lines: validateCursorSync function)
- src/tools/messaging.ts (+15 lines: pre-send validation)
- src/tools/p2p.ts (+15 lines: pre-send validation)

**Total LOC Impact**: ~125 new lines across 5 files (well within Constitution limits)

---

## Estimated Task Count by Phase

- Phase 1 (Setup): 0 tasks (no setup needed)
- Phase 2 (Foundational): 5 tasks (T001-T005)
- Phase 3 (US1): 11 tasks (T006-T016)
- Phase 4 (US2): 7 tasks (T017-T023)
- Phase 5 (US3): 6 tasks (T024-T029)
- Phase 6 (US4): 8 tasks (T030-T037)
- Phase 7 (US5): 7 tasks (T038-T044)
- Phase 8 (Polish): 8 tasks (T045-T052)

**Total: 52 tasks**

---

## MVP Scope (Minimum Viable Feature)

**Recommended MVP**: Phases 2-5 (User Stories 1-3)
- **Task Count**: 29 tasks (T001-T029)
- **Deliverable**: Core sync validation working for regular threads with actionable errors and automatic cursor advancement
- **Independent Test**: Can verify agent send operations are validated and recoverable
- **Value**: Prevents agents from sending messages without full context, enabling reliable coordination

**Extended Feature** (add US4-5):
- **Additional Tasks**: 15 tasks (T030-T044)
- **Deliverable**: Parallel coordination proven + P2P thread support
- **Value**: Demonstrates flexibility and comprehensive thread type coverage
