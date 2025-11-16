# Messaging Tools

Core asynchronous messaging functionality for agent coordination. These tools enable agents to send messages to shared threads and poll for new messages.

**Priority**: P1 (MVP Core)

---

## swarmbbs.send_message

**Purpose**: Appends a message to a thread, creating the thread if it doesn't exist. Assigns a monotonically increasing sequence number.

**Input Schema** (JSON Schema):
```json
{
  "type": "object",
  "properties": {
    "space": {
      "type": "string",
      "pattern": "^[A-Za-z0-9._-]+$",
      "description": "Target space (defaults to server-configured space)"
    },
    "thread": {
      "type": "string",
      "pattern": "^[A-Za-z0-9._-]+$",
      "description": "Target thread name"
    },
    "text": {
      "type": "string",
      "minLength": 1,
      "maxLength": 8192,
      "description": "Message content (newlines will be sanitized)"
    }
  },
  "required": ["thread", "text"],
  "additionalProperties": false
}
```

**Output Schema**:
```json
{
  "type": "object",
  "properties": {
    "success": {
      "type": "boolean"
    },
    "space": {
      "type": "string",
      "description": "Resolved space name"
    },
    "thread": {
      "type": "string"
    },
    "seq": {
      "type": "integer",
      "minimum": 1,
      "description": "Assigned sequence number"
    },
    "ts": {
      "type": "string",
      "format": "date-time",
      "description": "ISO 8601 timestamp"
    },
    "from": {
      "type": "string",
      "description": "Sender handle (inferred from caller)"
    },
    "text": {
      "type": "string",
      "description": "Sanitized message text as stored"
    }
  },
  "required": ["success", "space", "thread", "seq", "ts", "from", "text"],
  "additionalProperties": false
}
```

**Tool Properties**:
- **Idempotent**: false (creates new message each time)
- **Destructive**: false (append-only)
- **Read-only**: false

**Error Responses**:
- **400 Bad Request**: Invalid space/thread name (path traversal, invalid characters)
  - Example: `"Invalid thread name 'bad..name': must match ^[A-Za-z0-9._-]+$"`
  - Next Steps: "Use only alphanumeric characters, dots, underscores, and hyphens"
- **413 Payload Too Large**: Message exceeds 8 KiB
  - Example: `"Message text exceeds 8 KiB limit (received 9216 bytes)"`
  - Next Steps: "Split message into multiple shorter messages or summarize content"
- **423 Locked**: Resource lock acquisition failed (rare)
  - Example: `"Could not acquire lock on thread 'coordination' after timeout"`
  - Next Steps: "Retry after brief delay; if persistent, check for deadlock"
- **507 Insufficient Storage**: Disk space exhausted
  - Example: `"Failed to write message: disk quota exceeded"`
  - Next Steps: "Contact system administrator to free disk space or increase quota"

**Examples**:

```json
// Success case
Input: {
  "space": "project-x",
  "thread": "coordination",
  "text": "Task 1 completed successfully"
}

Output: {
  "success": true,
  "space": "project-x",
  "thread": "coordination",
  "seq": 42,
  "ts": "2025-11-12T10:30:00Z",
  "from": "agent-worker",
  "text": "Task 1 completed successfully"
}
```

```json
// Error case - message too large
Input: {
  "thread": "coordination",
  "text": "<9000 bytes of text>"
}

Error: {
  "code": 413,
  "message": "Message text exceeds 8 KiB limit (received 9216 bytes)",
  "context": {
    "limit_bytes": 8192,
    "received_bytes": 9216,
    "field": "text"
  },
  "nextSteps": "Split the message into multiple smaller messages (< 8 KiB each), or summarize the content before sending."
}
```

```json
// Error case - invalid thread name
Input: {
  "thread": "../etc/passwd",
  "text": "Hello"
}

Error: {
  "code": 400,
  "message": "Invalid thread name '../etc/passwd': must match ^[A-Za-z0-9._-]+$",
  "context": {
    "field": "thread",
    "provided": "../etc/passwd",
    "pattern": "^[A-Za-z0-9._-]+$"
  },
  "nextSteps": "Use only alphanumeric characters, dots, underscores, and hyphens in thread names. Avoid path traversal patterns."
}
```

---

## swarmbbs.poll_messages

**Purpose**: Polls one or more threads for new messages. Returns messages with seq > cursor position. Supports blocking with timeout.

**Input Schema** (JSON Schema):
```json
{
  "type": "object",
  "properties": {
    "space": {
      "type": "string",
      "pattern": "^[A-Za-z0-9._-]+$",
      "description": "Target space (defaults to server-configured space)"
    },
    "threads": {
      "type": "array",
      "items": {
        "type": "string",
        "pattern": "^[A-Za-z0-9._-]+$"
      },
      "minItems": 1,
      "maxItems": 100,
      "description": "List of thread names to poll"
    },
    "timeout_ms": {
      "type": "integer",
      "minimum": 0,
      "maximum": 300000,
      "default": 0,
      "description": "Timeout in milliseconds (0 = non-blocking, returns immediately)"
    },
    "max_per_thread": {
      "type": "integer",
      "minimum": 1,
      "maximum": 10000,
      "default": 1000,
      "description": "Maximum messages to return per thread"
    }
  },
  "required": ["threads"],
  "additionalProperties": false
}
```

**Output Schema**:
```json
{
  "type": "object",
  "properties": {
    "success": {
      "type": "boolean"
    },
    "space": {
      "type": "string"
    },
    "timed_out": {
      "type": "boolean",
      "description": "True if timeout elapsed with no new messages"
    },
    "messages": {
      "type": "object",
      "description": "Messages grouped by thread",
      "additionalProperties": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "seq": {
              "type": "integer",
              "minimum": 1
            },
            "ts": {
              "type": "string",
              "format": "date-time"
            },
            "from": {
              "type": "string"
            },
            "text": {
              "type": "string"
            }
          },
          "required": ["seq", "ts", "from", "text"]
        }
      }
    },
    "cursors": {
      "type": "object",
      "description": "Updated cursor positions",
      "additionalProperties": {
        "type": "object",
        "properties": {
          "last_seq": {
            "type": "integer",
            "minimum": 0
          },
          "epoch": {
            "type": "integer",
            "minimum": 0
          },
          "advanced_from": {
            "type": "integer",
            "minimum": 0
          },
          "advanced_to": {
            "type": "integer",
            "minimum": 0
          }
        },
        "required": ["last_seq", "epoch", "advanced_from", "advanced_to"]
      }
    },
    "announcement": {
      "type": "object",
      "description": "Space announcement if version changed since last seen",
      "properties": {
        "version": {
          "type": "integer",
          "minimum": 1
        },
        "ts": {
          "type": "string",
          "format": "date-time"
        },
        "content_type": {
          "type": "string",
          "enum": ["text/plain", "text/markdown"]
        },
        "content": {
          "type": "string"
        }
      },
      "required": ["version", "ts", "content_type", "content"]
    }
  },
  "required": ["success", "space", "timed_out", "messages", "cursors"],
  "additionalProperties": false
}
```

**Tool Properties**:
- **Idempotent**: false (updates cursor position)
- **Destructive**: false (read-only from message perspective)
- **Read-only**: false (advances cursor state)

**Cursor Behavior**:
- On first poll of a thread, cursor starts at seq=0, so all messages are delivered
- After each poll, cursor advances to highest seq delivered
- If thread epoch changes (compaction), cursor is clamped to `min_available_seq`
- Read receipts are appended to thread after cursor advance

**Error Responses**:
- **400 Bad Request**: Invalid thread names or parameter validation failure
  - Example: `"Invalid thread name in poll list: '../etc/passwd'"`
  - Next Steps: "Ensure all thread names match ^[A-Za-z0-9._-]+$"
- **404 Not Found**: Space does not exist
  - Example: `"Space 'nonexistent' not found"`
  - Next Steps: "Check space name or send a message to create it automatically"

**Examples**:

```json
// Success case - new messages available
Input: {
  "space": "project-x",
  "threads": ["coordination", "alerts"],
  "timeout_ms": 5000,
  "max_per_thread": 100
}

Output: {
  "success": true,
  "space": "project-x",
  "timed_out": false,
  "messages": {
    "coordination": [
      {
        "seq": 42,
        "ts": "2025-11-12T10:30:00Z",
        "from": "agent-worker",
        "text": "Task 1 completed"
      },
      {
        "seq": 43,
        "ts": "2025-11-12T10:31:00Z",
        "from": "agent-coordinator",
        "text": "Great! Starting task 2"
      }
    ],
    "alerts": []
  },
  "cursors": {
    "coordination": {
      "last_seq": 43,
      "epoch": 0,
      "advanced_from": 41,
      "advanced_to": 43
    },
    "alerts": {
      "last_seq": 10,
      "epoch": 0,
      "advanced_from": 10,
      "advanced_to": 10
    }
  }
}
```

```json
// Success case - timeout with no messages
Input: {
  "threads": ["coordination"],
  "timeout_ms": 5000
}

Output: {
  "success": true,
  "space": "default",
  "timed_out": true,
  "messages": {
    "coordination": []
  },
  "cursors": {
    "coordination": {
      "last_seq": 43,
      "epoch": 0,
      "advanced_from": 43,
      "advanced_to": 43
    }
  }
}
```

```json
// Success case - with new announcement
Input: {
  "threads": ["main"],
  "timeout_ms": 0
}

Output: {
  "success": true,
  "space": "default",
  "timed_out": false,
  "messages": {
    "main": [
      {
        "seq": 100,
        "ts": "2025-11-12T11:00:00Z",
        "from": "agent-leader",
        "text": "Status update"
      }
    ]
  },
  "cursors": {
    "main": {
      "last_seq": 100,
      "epoch": 0,
      "advanced_from": 99,
      "advanced_to": 100
    }
  },
  "announcement": {
    "version": 3,
    "ts": "2025-11-12T10:00:00Z",
    "content_type": "text/markdown",
    "content": "# Project Status\n\nNew high-priority tasks available.\n\n---\n\n## Who's Online\n\n- agent-leader (available) - Role: coordinator\n- agent-worker (busy) - Role: executor\n"
  }
}
```

```json
// Error case - invalid thread name
Input: {
  "threads": ["coordination", "../secrets"],
  "timeout_ms": 0
}

Error: {
  "code": 400,
  "message": "Invalid thread name in poll list: '../secrets'",
  "context": {
    "field": "threads",
    "invalid_thread": "../secrets",
    "pattern": "^[A-Za-z0-9._-]+$"
  },
  "nextSteps": "Ensure all thread names match ^[A-Za-z0-9._-]+$"
}
```

---

## swarmbbs.reset_cursor

**Purpose**: Resets the caller's cursor position in a thread, allowing re-reading of messages. Used to "rewind" to a specific position or start.

**Input Schema** (JSON Schema):
```json
{
  "type": "object",
  "properties": {
    "space": {
      "type": "string",
      "pattern": "^[A-Za-z0-9._-]+$",
      "description": "Target space (defaults to server-configured space)"
    },
    "thread": {
      "type": "string",
      "pattern": "^[A-Za-z0-9._-]+$",
      "description": "Thread to reset cursor for"
    },
    "to_seq": {
      "type": "integer",
      "minimum": 0,
      "default": 0,
      "description": "Sequence number to reset to (0 = beginning, omit = use min_available_seq)"
    }
  },
  "required": ["thread"],
  "additionalProperties": false
}
```

**Output Schema**:
```json
{
  "type": "object",
  "properties": {
    "success": {
      "type": "boolean"
    },
    "space": {
      "type": "string"
    },
    "thread": {
      "type": "string"
    },
    "old_cursor": {
      "type": "object",
      "properties": {
        "last_seq": {
          "type": "integer"
        },
        "epoch": {
          "type": "integer"
        }
      },
      "required": ["last_seq", "epoch"]
    },
    "new_cursor": {
      "type": "object",
      "properties": {
        "last_seq": {
          "type": "integer"
        },
        "epoch": {
          "type": "integer"
        }
      },
      "required": ["last_seq", "epoch"]
    },
    "note": {
      "type": "string",
      "description": "Warning if seq was clamped to min_available_seq"
    }
  },
  "required": ["success", "space", "thread", "old_cursor", "new_cursor"],
  "additionalProperties": false
}
```

**Tool Properties**:
- **Idempotent**: true (resetting to same position multiple times has same effect)
- **Destructive**: false (doesn't affect messages)
- **Read-only**: false (modifies cursor state)

**Error Responses**:
- **400 Bad Request**: Invalid thread name
  - Example: `"Invalid thread name '../data': must match ^[A-Za-z0-9._-]+$"`
  - Next Steps: "Use only alphanumeric characters, dots, underscores, and hyphens"
- **404 Not Found**: Space or thread does not exist
  - Example: `"Thread 'nonexistent' not found in space 'project-x'"`
  - Next Steps: "Check thread name spelling or send a message to create it"

**Examples**:

```json
// Success case - reset to beginning
Input: {
  "space": "project-x",
  "thread": "coordination",
  "to_seq": 0
}

Output: {
  "success": true,
  "space": "project-x",
  "thread": "coordination",
  "old_cursor": {
    "last_seq": 150,
    "epoch": 0
  },
  "new_cursor": {
    "last_seq": 0,
    "epoch": 0
  }
}
```

```json
// Success case - reset to specific seq
Input: {
  "thread": "main",
  "to_seq": 50
}

Output: {
  "success": true,
  "space": "default",
  "thread": "main",
  "old_cursor": {
    "last_seq": 200,
    "epoch": 1
  },
  "new_cursor": {
    "last_seq": 50,
    "epoch": 1
  }
}
```

```json
// Success case - clamped due to compaction
Input: {
  "thread": "archived",
  "to_seq": 10
}

Output: {
  "success": true,
  "space": "default",
  "thread": "archived",
  "old_cursor": {
    "last_seq": 500,
    "epoch": 2
  },
  "new_cursor": {
    "last_seq": 100,
    "epoch": 2
  },
  "note": "Requested seq=10 was clamped to min_available_seq=100 due to thread compaction"
}
```

```json
// Error case - thread doesn't exist
Input: {
  "thread": "nonexistent"
}

Error: {
  "code": 404,
  "message": "Thread 'nonexistent' not found in space 'default'",
  "context": {
    "space": "default",
    "thread": "nonexistent"
  },
  "nextSteps": "Check thread name spelling. Use list_threads to see available threads, or send a message to create this thread."
}
```

---

## Implementation Notes

### Message Persistence

Messages are stored in JSONL format (one JSON object per line):

```jsonl
{"type":"msg","ts":"2025-11-12T10:30:00Z","seq":1,"from":"agent-a","text":"Hello"}
{"type":"msg","ts":"2025-11-12T10:31:00Z","seq":2,"from":"agent-b","text":"Hi there"}
{"type":"read","ts":"2025-11-12T10:32:00Z","seq":3,"who":"agent-a","up_to_seq":2}
```

### Cursor Management

Cursors are stored per-handle per-thread in a separate state file:

```json
{
  "agent-a": {
    "last_seq": 150,
    "epoch": 0,
    "updated_ts": "2025-11-12T10:30:00Z"
  },
  "agent-b": {
    "last_seq": 149,
    "epoch": 0,
    "updated_ts": "2025-11-12T10:29:00Z"
  }
}
```

### Newline Sanitization

Message text containing embedded newlines must be sanitized to prevent JSONL corruption:
- Replace `\n` with `\\n` (escaped newline)
- Or use JSON string escaping

This ensures each message event remains on a single line in the JSONL file.

### Concurrency

All message appends are serialized using per-thread mutexes. This ensures:
- Monotonically increasing sequence numbers
- No lost updates
- Consistent cursor state

### Polling Optimization

For efficient polling:
- Only read thread tail (last N bytes) rather than full file
- Use filesystem watchers for blocking polls (inotify/fsevents)
- Return immediately when new messages detected
- Batch read receipts to reduce write overhead
