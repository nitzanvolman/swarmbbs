/**
 * Event Types for SwarmBBS Thread Logs
 *
 * All events stored in JSONL format (one JSON object per line)
 */

/**
 * Message Event - A message sent to a thread
 */
export interface MessageEvent {
  type: 'msg';
  ts: string;        // ISO 8601 timestamp
  seq: number;       // Monotonically increasing sequence number
  from: string;      // Handle of sender
  text: string;      // Message content (max 8 KiB)
}

/**
 * Read Receipt Event - Records that a handle read messages up to a seq
 */
export interface ReadReceiptEvent {
  type: 'read';
  ts: string;        // ISO 8601 timestamp
  seq: number;       // Sequence number for this event
  who: string;       // Handle that read
  up_to_seq: number; // Highest message seq read by this handle
}

/**
 * Snapshot Event - Summary of compacted messages
 */
export interface SnapshotEvent {
  type: 'snapshot';
  ts: string;
  seq: number;
  covers: {
    from_seq: number;
    to_seq: number;
  };
  summary: string | Record<string, unknown>;
  meta: Record<string, unknown>;
}

/**
 * System Note Event - System-generated informational message
 */
export interface SystemNoteEvent {
  type: 'sys';
  ts: string;
  seq: number;
  note: string;
}

/**
 * Union type of all event types
 */
export type ThreadEvent = MessageEvent | ReadReceiptEvent | SnapshotEvent | SystemNoteEvent;

/**
 * Type guard for MessageEvent
 */
export function isMessageEvent(event: ThreadEvent): event is MessageEvent {
  return event.type === 'msg';
}

/**
 * Type guard for ReadReceiptEvent
 */
export function isReadReceiptEvent(event: ThreadEvent): event is ReadReceiptEvent {
  return event.type === 'read';
}

/**
 * Type guard for SnapshotEvent
 */
export function isSnapshotEvent(event: ThreadEvent): event is SnapshotEvent {
  return event.type === 'snapshot';
}

/**
 * Type guard for SystemNoteEvent
 */
export function isSystemNoteEvent(event: ThreadEvent): event is SystemNoteEvent {
  return event.type === 'sys';
}
