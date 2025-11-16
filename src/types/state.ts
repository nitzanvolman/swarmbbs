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
