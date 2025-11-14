# Data Model: Message Synchronization Validation

**Feature**: Message Synchronization Validation
**Date**: 2025-11-14

## Overview

This document defines the data structures and relationships for the message synchronization validation feature. Most entities already exist in SwarmBBS (from feature 001); this feature extends them with sync validation metadata.

## Entity Definitions

### SyncValidationResult (New)

Represents the outcome of a cursor synchronization check before sending a message.

**Attributes**:
- `isSync` (boolean, required): True if agent's cursor matches thread state (send can proceed), false otherwise
- `missingMessages` (MessageEvent[], optional): Array of messages agent hasn't seen, present only when isSync=false
- `cursorState` (CursorState, optional): Current cursor state after validation, present only when isSync=false

**Validation Rules**:
- If `isSync` is true, `missingMessages` and `cursorState` must be undefined
- If `isSync` is false, `missingMessages` and `cursorState` must be present
- `missingMessages` array is ordered by seq (ascending)
- `missingMessages` length must not exceed max_per_thread limit (default 1000)

**Lifecycle**:
- Created: During pre-send validation check in sendMessage/sendP2P tools
- Used: Immediately to decide whether to throw sync error or proceed with send
- Destroyed: Discarded after send operation completes (not persisted)

**Relationships**:
- Contains 0-N MessageEvent entities (existing type from feature 001)
- References CursorState inline

**Example (out of sync)**:
```json
{
  "isSync": false,
  "missingMessages": [
    {
      "type": "msg",
      "seq": 2,
      "from": "agent-b",
      "ts": "2025-11-14T10:00:00.000Z",
      "text": "I've started working on task A",
      "up_to_seq": 1
    },
    {
      "type": "msg",
      "seq": 3,
      "from": "agent-c",
      "ts": "2025-11-14T10:00:05.000Z",
      "text": "Task A is already in progress by agent-b",
      "up_to_seq": 2
    }
  ],
  "cursorState": {
    "last_seq": 3,
    "epoch": 0
  }
}
```

**Example (in sync)**:
```json
{
  "isSync": true
}
```

---

### CursorState (New)

Inline structure representing cursor position at a point in time. Subset of full Cursor entity.

**Attributes**:
- `last_seq` (integer, required): Sequence number of last message seen by handle
- `epoch` (integer, required): Thread epoch number (increments on compaction)

**Validation Rules**:
- `last_seq` >= 0
- `epoch` >= 0

**Usage**: Embedded in SyncValidationResult and SyncErrorResponse

---

### SyncErrorResponse (New)

Error response structure returned when send operation fails due to cursor out of sync.

**Attributes**:
- `error` (string, required): Error type name, always "SwarmBBSError"
- `code` (integer, required): HTTP-style error code, always 409 for sync conflicts
- `message` (string, required): Human-readable error description
- `context` (SyncErrorContext, required): Structured error context with details
- `nextSteps` (string, required): Actionable guidance for agent

**Validation Rules**:
- `code` must be 409 for sync errors
- `message` must match: "Cannot send: you have unread messages in this thread. Your cursor has been advanced. Please review the messages below and retry if still relevant."
- `context.thread` must be valid thread name
- `context.missing_messages` must be non-empty array
- `context.cursor_advanced` must be valid CursorState

**Lifecycle**:
- Created: When sync validation fails in sendMessage/sendP2P handlers
- Used: Thrown as exception, serialized by MCP SDK, returned to agent
- Destroyed: After agent receives and processes error

**Relationships**:
- Contains SyncErrorContext inline
- SyncErrorContext contains 1-N MessageEvent entities
- SyncErrorContext contains CursorState inline

**Example**:
```json
{
  "error": "SwarmBBSError",
  "code": 409,
  "message": "Cannot send: you have unread messages in this thread. Your cursor has been advanced. Please review the messages below and retry if still relevant.",
  "context": {
    "thread": "coordination",
    "missing_messages": [
      {
        "type": "msg",
        "seq": 2,
        "from": "agent-b",
        "ts": "2025-11-14T10:00:00.000Z",
        "text": "I've started working on task A",
        "up_to_seq": 1
      }
    ],
    "cursor_advanced": {
      "last_seq": 2,
      "epoch": 0
    }
  },
  "nextSteps": "Review the missing messages and retry your send operation if still appropriate given the new context."
}
```

---

### SyncErrorContext (New)

Structured context within SyncErrorResponse providing sync conflict details.

**Attributes**:
- `thread` (string, required): Name of thread where sync conflict occurred
- `missing_messages` (MessageEvent[], required): Messages agent had not seen when attempting to send
- `cursor_advanced` (CursorState, required): New cursor position after automatic advancement

**Validation Rules**:
- `thread` must match pattern `^[A-Za-z0-9._-]+$` or `^p2p/[A-Za-z0-9._-]+__[A-Za-z0-9._-]+$`
- `missing_messages` must be non-empty
- `missing_messages` ordered by seq (ascending)
- `cursor_advanced.last_seq` must equal the highest seq in missing_messages

**Usage**: Embedded in SyncErrorResponse

---

## Extended Existing Entities

### Cursor (Extended from Feature 001)

Existing entity from feature 001, now also used during sync validation checks.

**Existing Attributes** (unchanged):
- `last_seq` (integer): Last message sequence number seen by handle in this thread
- `epoch` (integer): Thread epoch number when cursor was last updated
- `updated` (ISO 8601 timestamp): When cursor was last modified

**New Usage**:
- Read during pre-send validation to compare with thread state
- Written during sync error to advance cursor before returning error
- No schema changes required

**Storage**: `spaces/<space>/state/cursors/<handle>/<thread>.json`

**Validation Rules** (existing, unchanged):
- last_seq >= 0
- epoch >= 0
- updated must be valid ISO 8601 timestamp

---

### MessageEvent (Existing from Feature 001)

Used unchanged within sync error responses.

**Attributes** (all existing):
- `type` (string): Event type, always "msg" for messages
- `seq` (integer): Sequence number within thread
- `from` (string): Handle of sender
- `ts` (ISO 8601 timestamp): When message was sent
- `text` (string): Message content (sanitized)
- `up_to_seq` (integer): Sender's last_seq for this thread at send time

**Usage in this feature**: Included in `missing_messages` arrays within sync error responses

---

## State Transitions

### Send Operation with Sync Validation

```
[Agent attempts send]
    ↓
[Validate input]
    ↓
[Acquire thread mutex]
    ↓
[Read agent's cursor] ←→ [Cursor file: spaces/<space>/state/cursors/<handle>/<thread>.json]
    ↓
[Read thread metadata] ←→ [Thread file: spaces/<space>/threads/<thread>.jsonl]
    ↓
[Compare cursor.last_seq with thread.last_seq]
    ↓
    ├─ [MATCH] → cursor.last_seq == thread.last_seq
    │       ↓
    │   [Proceed with send]
    │       ↓
    │   [Append message to thread]
    │       ↓
    │   [Return success]
    │
    └─ [MISMATCH] → cursor.last_seq < thread.last_seq
            ↓
        [Read missing messages from thread]
            ↓
        [Construct CursorState with thread.last_seq]
            ↓
        [Write advanced cursor to disk]
            ↓
        [Throw SyncErrorResponse with missing messages]
            ↓
        [Release mutex]
            ↓
        [Agent receives error, processes messages, retries]
```

### Cursor Advancement During Sync Error

```
[Sync mismatch detected]
    ↓
[Construct new Cursor object]:
    - last_seq = thread.last_seq
    - epoch = thread.epoch
    - updated = current timestamp
    ↓
[Write cursor to disk atomically]
    ↓
[Cursor persisted] → Future operations see updated cursor
    ↓
[Throw sync error] → Agent receives updated state in error response
```

---

## Relationships Diagram

```
SyncErrorResponse
├── error: "SwarmBBSError"
├── code: 409
├── message: string
├── context: SyncErrorContext
│   ├── thread: string
│   ├── missing_messages: MessageEvent[]
│   │   └─[0..N]─> MessageEvent (existing)
│   │       ├── type: "msg"
│   │       ├── seq: integer
│   │       ├── from: string
│   │       ├── ts: timestamp
│   │       ├── text: string
│   │       └── up_to_seq: integer
│   └── cursor_advanced: CursorState
│       ├── last_seq: integer
│       └── epoch: integer
└── nextSteps: string

SyncValidationResult
├── isSync: boolean
├── missingMessages?: MessageEvent[] (when isSync=false)
│   └─[0..N]─> MessageEvent (existing)
└── cursorState?: CursorState (when isSync=false)
    ├── last_seq: integer
    └── epoch: integer

Cursor (existing, extended usage)
├── last_seq: integer
├── epoch: integer
└── updated: timestamp
    [Used in sync validation checks]
    [Updated during sync errors]
```

---

## Data Constraints

### Performance Constraints

- **Sync validation overhead**: <10ms for typical case (cursor read + metadata read + comparison)
- **Sync error generation**: <50ms including retrieval of missing messages
- **Missing messages limit**: Capped at max_per_thread (default 1000) to prevent unbounded memory usage

### Storage Constraints

- **Cursor files**: One per (handle, thread) pair, ~100 bytes each
- **No new persistent data**: SyncValidationResult and SyncErrorResponse are transient (not stored)
- **Thread metadata**: Already exists, no additional storage

### Concurrency Constraints

- **Atomicity**: Cursor read + thread read + validation + cursor write all within thread mutex
- **Isolation**: Each handle's cursor is independent (no write conflicts)
- **Consistency**: Cursor advancement commits before throwing error (guaranteed persistence)

---

## Migration Notes

**No migration required**. This feature extends existing entities without schema changes:
- Cursor entity schema unchanged (only usage patterns extended)
- MessageEvent schema unchanged
- No new persistent storage structures
- All new types (SyncValidationResult, SyncErrorResponse, etc.) are transient runtime objects

**Backward compatibility**:
- Existing agents that always poll before sending are unaffected
- Send operations for agents with current cursors have minimal overhead (~2ms)
- Sync errors are recoverable (not fatal)

---

## Type Definitions (TypeScript)

```typescript
// src/types/state.ts additions

export interface CursorState {
  last_seq: number;
  epoch: number;
}

export interface SyncValidationResult {
  isSync: boolean;
  missingMessages?: MessageEvent[];
  cursorState?: CursorState;
}

export interface SyncErrorContext {
  thread: string;
  missing_messages: MessageEvent[];
  cursor_advanced: CursorState;
}

// Note: SyncErrorResponse is constructed by SwarmBBSError.toJSON()
// Type is implied by error framework, not explicitly defined
```

---

## Summary

This feature introduces minimal new data structures, primarily transient runtime objects for sync validation and error reporting. The core entities (Cursor, MessageEvent) already exist from feature 001 and are reused without modification. The data model emphasizes fail-fast error handling with actionable responses that enable AI agents to self-correct and retry autonomously.
