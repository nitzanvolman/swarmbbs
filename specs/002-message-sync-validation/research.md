# Research: Message Synchronization Validation

**Feature**: Message Synchronization Validation
**Date**: 2025-11-14
**Status**: Complete

## Purpose

This document captures research findings and design decisions for implementing synchronization validation in SwarmBBS message sending operations. The goal is to ensure agents always have full conversation context before contributing messages to threads.

## Research Questions Investigated

### 1. How to validate cursor synchronization before send operations?

**Decision**: Extend cursor-ops.ts with `validateCursorSync` function that compares handle's cursor with current thread state

**Rationale**:
- Existing `getCursor()` and `getThreadMetadata()` functions provide necessary data
- Validation logic is reusable across both `messaging.ts` and `p2p.ts` tools
- Centralizing in cursor-ops.ts keeps cursor logic together (cohesion)
- Can leverage existing per-thread mutexes for atomicity

**Alternatives Considered**:
- **Inline validation in each tool handler**: Rejected because duplicates logic across messaging.ts and p2p.ts
- **Separate sync-validation module**: Rejected as overkill for ~50 lines of code; cursor-ops.ts is the natural home

**Implementation Approach**:
```typescript
// Add to src/storage/cursor-ops.ts
export async function validateCursorSync(
  rootDir: string,
  space: string,
  handle: string,
  thread: string
): Promise<{
  isSync: boolean;
  missingMessages?: MessageEvent[];
  cursorState?: { last_seq: number; epoch: number };
}> {
  // 1. Get handle's cursor (null if first time)
  // 2. Get thread metadata (last_seq, epoch)
  // 3. If cursor is null, isSync=true (first message is always ok)
  // 4. If cursor.last_seq === thread.last_seq, isSync=true
  // 5. Else, read missing messages using readThreadAfterSeq
  // 6. Return { isSync: false, missingMessages: [...], cursorState: {...} }
}
```

**Dependencies**: Leverages existing functions:
- `getCursor(rootDir, space, handle, thread)` - cursor-ops.ts
- `getThreadMetadata(rootDir, space, thread)` - thread-ops.ts
- `readThreadAfterSeq(rootDir, space, thread, afterSeq, maxMessages)` - thread-ops.ts

---

### 2. What format should sync error responses use?

**Decision**: Extend existing SwarmBBSError pattern with specialized sync error factory function

**Rationale**:
- SwarmBBS already uses 409 Conflict for resource conflicts (compaction.ts line 156)
- Existing error framework provides code, message, context, nextSteps structure
- AI agents can parse JSON error responses programmatically
- MCP SDK automatically converts errors to proper MCP error format

**Alternatives Considered**:
- **New error class hierarchy**: Rejected as over-engineering; factory function suffices
- **Plain Error object with metadata**: Rejected because loses structured error format benefits

**Implementation Approach**:
```typescript
// Add to src/utils/errors.ts
export function syncConflict(
  thread: string,
  missingMessages: MessageEvent[],
  cursorAdvanced: { last_seq: number; epoch: number }
): SwarmBBSError {
  return new SwarmBBSError(
    409,
    'Cannot send: you have unread messages in this thread. Your cursor has been advanced. Please review the messages below and retry if still relevant.',
    {
      thread,
      missing_messages: missingMessages,
      cursor_advanced: cursorAdvanced,
    },
    'Review the missing messages and retry your send operation if still appropriate given the new context.'
  );
}
```

**Error Response Structure**:
```json
{
  "error": "SwarmBBSError",
  "code": 409,
  "message": "Cannot send: you have unread messages in this thread...",
  "context": {
    "thread": "coordination",
    "missing_messages": [
      { "type": "msg", "seq": 2, "from": "agent-b", "ts": "2025-11-14T10:00:00Z", "text": "...", "up_to_seq": 1 }
    ],
    "cursor_advanced": { "last_seq": 2, "epoch": 0 }
  },
  "nextSteps": "Review the missing messages and retry your send operation..."
}
```

---

### 3. How to advance cursor atomically during sync error?

**Decision**: Call existing `writeCursor()` function before throwing sync error, within thread mutex

**Rationale**:
- cursor-ops.ts already provides `writeCursor()` with atomic file write
- Performing within send operation's thread mutex ensures no race conditions
- Cursor advancement before throw ensures it persists even if error bubbles up
- Simple, leverages existing infrastructure

**Alternatives Considered**:
- **New combined "advance-and-throw" function**: Rejected as unnecessary abstraction
- **Cursor advancement in error handler**: Rejected because error might not be caught, losing advancement
- **Cursor advancement in poll operation**: Rejected because delays sync state update

**Implementation Flow**:
1. Acquire thread mutex (already done in appendMessage path)
2. Validate cursor sync (new step)
3. If out of sync:
   a. Retrieve missing messages
   b. Write new cursor with advanced last_seq
   c. Throw syncConflict error with missing messages
4. If in sync, proceed with appendMessage as normal

---

### 4. How to handle epoch changes during sync validation?

**Decision**: Reuse existing epoch clamping logic from cursor advancement

**Rationale**:
- cursor-ops.ts line 124 already handles epoch mismatch (cursor.epoch < thread.epoch)
- When epoch differs, clamp cursor to min_available_seq (post-compaction)
- Retrieve messages from min_available_seq to current last_seq
- This ensures messages aren't lost due to compaction during sync check

**Alternatives Considered**:
- **Fail sync validation on epoch mismatch**: Rejected because too restrictive, breaks usability after compaction
- **Special compaction-aware sync error**: Rejected as unnecessary complexity

**Implementation Note**:
- Check `cursor.epoch !== thread.epoch` in validateCursorSync
- If mismatch, start reading from `thread.min_available_seq` instead of `cursor.last_seq + 1`
- Include note in error context about compaction if epoch changed

---

### 5. How to test parallel coordination without strict turns?

**Decision**: Create new e2e test `fizzbuzz-parallel.test.ts` based on existing `fizzbuzz-turns.test.ts` pattern

**Rationale**:
- Existing e2e infrastructure (agent-runner.ts, e2e-helpers.ts) is proven and reusable
- FizzBuzz is simple enough to verify correctness programmatically
- Parallel version removes turn enforcement, allowing race conditions
- Demonstrates sync validation handles real concurrency gracefully

**Test Design**:
```typescript
// tests/e2e/fizzbuzz-parallel.test.ts
// 3 agents race to post FizzBuzz numbers 1-100
// No turn enforcement - agents can attempt to post simultaneously
// Sync validation ensures only one agent posts each number
// Agent prompts: "You are playing FizzBuzz. Monitor the thread and post
// the next number when you see a gap. If you get a sync error,
// read the new messages and try the next appropriate number."
```

**Verification**:
- Thread contains exactly 100 messages (1 per number)
- All messages are in sequence (seq 1-100)
- Fizz/Buzz/FizzBuzz substitutions are correct
- No duplicate numbers (sync validation prevented duplicates)
- Sync errors were successfully recovered (agents didn't give up)

**Alternatives Considered**:
- **Stress test with 100 agents**: Rejected as too slow/expensive for e2e tests
- **Unit test with mocked race conditions**: Rejected as insufficient; need real agent behavior

---

### 6. What limits should apply to missing messages in sync errors?

**Decision**: Respect existing max_per_thread limit (default 1000) when retrieving missing messages

**Rationale**:
- Consistent with poll_messages behavior (line 151 in messaging.ts uses max_per_thread)
- Prevents unbounded memory/response size if agent is very far behind
- If >1000 messages behind, cursor still advances, agent can poll separately for full history
- Fail-fast: agent learns immediately they're very out of sync

**Alternatives Considered**:
- **No limit, return all missing messages**: Rejected due to unbounded response size risk
- **Fixed small limit (e.g., 10 messages)**: Rejected as too restrictive for normal use
- **Different limit for sync errors vs polls**: Rejected as confusing inconsistency

**Implementation**: Pass `maxMessages = config.maxPerThread` to `readThreadAfterSeq()` when retrieving missing messages

---

## Best Practices Applied

### TypeScript Error Handling
- **Pattern**: Extend existing SwarmBBSError class with factory functions
- **Source**: Existing errors.ts demonstrates this pattern (badRequest, notFound, conflict, etc.)
- **Benefit**: Consistent error structure, type safety, clear next steps for agents

### MCP Tool Design
- **Pattern**: Validate input, perform operation within mutex, return structured response
- **Source**: All existing tools in tools/ directory follow this pattern
- **Benefit**: Thread safety, clear error messages, predictable behavior

### Test Organization
- **Pattern**: Contract tests for interfaces, integration tests for multi-component behavior, e2e tests for agent coordination
- **Source**: Existing test structure (tests/contract/, tests/integration/, tests/e2e/)
- **Benefit**: Tests match abstraction levels, failures are easy to diagnose

### File-based Concurrency
- **Pattern**: Per-resource mutexes, atomic file writes, filesystem as source of truth
- **Source**: Constitution principle + thread-ops.ts locking implementation
- **Benefit**: Multi-process safety, no need for external coordination service

---

## Integration Points

### Modified Components

1. **src/storage/cursor-ops.ts** - Add validateCursorSync function (~50 lines)
2. **src/utils/errors.ts** - Add syncConflict factory function (~15 lines)
3. **src/types/state.ts** - Add SyncErrorContext type definition (~10 lines)
4. **src/tools/messaging.ts** - Add pre-send validation in handler (~10 lines)
5. **src/tools/p2p.ts** - Add pre-send validation in handler (~10 lines)

### New Components

1. **tests/contract/sync-validation.contract.test.ts** - Error format verification
2. **tests/integration/sync-validation.integration.test.ts** - Cursor validation logic tests
3. **tests/unit/sync-error-formatting.test.ts** - Error construction tests
4. **tests/e2e/fizzbuzz-parallel.test.ts** - Parallel coordination test

### Unchanged Components (Dependencies Only)

- **src/storage/thread-ops.ts** - Reuse getThreadMetadata, readThreadAfterSeq
- **src/storage/tail-reader.ts** - Used indirectly through thread-ops
- **tests/e2e/lib/agent-runner.ts** - Reuse for parallel FizzBuzz test
- **tests/e2e/fixtures/e2e-helpers.ts** - Reuse verification utilities

---

## Performance Considerations

### Sync Validation Overhead

**Happy Path (agent is current)**:
- 1 cursor file read (~1ms)
- 1 thread metadata read (~1ms)
- Comparison operation (<0.1ms)
- **Total: ~2ms overhead** (well under 10ms goal)

**Sync Error Path (agent is behind)**:
- 1 cursor file read (~1ms)
- 1 thread metadata read (~1ms)
- Read missing messages from thread tail (~10-20ms for 100 messages)
- 1 cursor file write (~2ms)
- Error construction and throw (<0.1ms)
- **Total: ~15-25ms** (well under 50ms goal)

**Concurrent Sync Errors**:
- Each thread has independent mutex (no contention across threads)
- Cursor files are per-handle (no write contention)
- Thread reads use tail-reader (efficient, only reads relevant portion)
- **Can handle 10+ concurrent sync errors on different threads easily**

### Memory Impact

**Per sync error response**:
- Missing messages array: ~1 KB per message * N messages
- Default limit: 1000 messages = ~1 MB max
- Cursor state: <1 KB
- Error overhead: <1 KB
- **Total: ~1 MB max per sync error** (acceptable)

---

## Security Considerations

### Path Traversal Prevention
- All thread names validated with `validateName()` before use
- Pattern: `^[A-Za-z0-9._-]+$`
- Prevents "../../../etc/passwd" attacks
- Existing validation applies to sync validation code paths

### Information Disclosure
- Missing messages in error response only include agent's own unread messages
- No leak of messages from threads agent doesn't have access to
- Cursor paths already scoped to handle (privacy preserved)

### Denial of Service
- max_per_thread limit prevents unbounded response sizes
- Thread mutexes prevent lock contention DoS
- File I/O is bounded by message count limits

---

## Risks and Mitigations

### Risk: Agents ignore sync errors and retry blindly
**Mitigation**:
- Cursor is advanced in error response, preventing repeated sync errors
- Agent can choose to ignore context but won't spam sync errors
- Clear error message prompts agent to review before retrying

### Risk: Sync validation breaks existing agents
**Mitigation**:
- Only affects send operations (polls unchanged)
- Agents that always poll before sending are unaffected
- Sync errors are recoverable (not fatal)
- Testing with existing 3-hats e2e test ensures backward compatibility

### Risk: Performance degradation on slow filesystems
**Mitigation**:
- Validation uses same I/O operations as normal send flow
- Tail reading is already optimized (doesn't read entire file)
- Mutexes prevent thundering herd on same thread
- Can tune max_per_thread limit if needed

---

## Open Questions

None. All technical unknowns from plan.md Technical Context have been resolved through research.

---

## References

- SwarmBBS spec: `specs/001-mcp-bbs-server/spec.md`
- Constitution: `.specify/memory/constitution.md` (Principle VI: Fail-Fast Error Handling)
- Existing error patterns: `src/utils/errors.ts`
- Existing cursor operations: `src/storage/cursor-ops.ts`
- Existing e2e tests: `tests/e2e/fizzbuzz-turns.test.ts`, `tests/e2e/three-hats.test.ts`
- MCP SDK docs: https://github.com/modelcontextprotocol/servers
