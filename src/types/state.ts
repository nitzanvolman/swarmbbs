/**
 * State Types for SwarmBBS Server
 *
 * Covers cursors, presence records, profiles, announcements, and compaction state
 */

/**
 * Cursor - Server-managed read position per handle per thread
 */
export interface Cursor {
  last_seq: number;    // Highest seq delivered to this handle
  epoch: number;       // Thread epoch when cursor was last updated
  updated_ts: string;  // ISO 8601 timestamp of last update
}

/**
 * Presence Record - Agent activity and availability status
 */
export interface PresenceRecord {
  last_request_ts: string;   // ISO 8601 timestamp of last tool invocation
  last_heartbeat_ts: string; // ISO 8601 timestamp of last explicit heartbeat
  status: 'available' | 'busy' | 'away';
}

/**
 * Profile - Agent metadata for discovery
 */
export interface Profile {
  handle: string;
  role: string;
  expertise: string[];
  updated_ts: string;
}

/**
 * Announcement - Space-wide broadcast message
 */
export interface Announcement {
  version: number;
  ts: string;
  content_type: 'text/markdown' | 'text/plain';
  content: string;
}

/**
 * Announcement Seen Marker - Tracks which version a handle has seen
 */
export interface AnnouncementSeen {
  last_seen_version: number;
  seen_at: string;
}

/**
 * Compaction Session - Temporary state during two-phase compaction
 */
export interface CompactionSession {
  compaction_id: string;
  base_seq: number;
  epoch: number;
  delta_file_path: string;
}

/**
 * Thread Metadata - Tracked in memory
 */
export interface ThreadMetadata {
  current_seq: number;
  epoch: number;
  min_available_seq: number;
  compaction_state: CompactionSession | null;
}

/**
 * Cursor State - Inline cursor position snapshot
 * Used in sync validation and error responses
 */
export interface CursorState {
  last_seq: number;  // Sequence number of last message seen
  epoch: number;     // Thread epoch number
}

/**
 * Sync Validation Result - Outcome of cursor synchronization check
 * Returned by validateCursorSync before send operations
 */
export interface SyncValidationResult {
  isSync: boolean;                      // True if cursor matches thread state
  missingMessages?: import('./events.js').MessageEvent[];  // Messages agent hasn't seen (when isSync=false)
  cursorState?: CursorState;            // Current cursor after validation (when isSync=false)
}

/**
 * Sync Error Context - Structured context in sync conflict errors
 * Included in 409 error responses when send fails due to out-of-sync cursor
 */
export interface SyncErrorContext {
  thread: string;                       // Thread name where conflict occurred
  missing_messages: import('./events.js').MessageEvent[];  // Unread messages
  cursor_advanced: CursorState;         // New cursor position after advancement
}
