/**
 * JSON Schema Validation for SwarmBBS
 *
 * Provides runtime validation for event structures and tool inputs
 */

import type { MessageEvent, ReadReceiptEvent, SnapshotEvent, SystemNoteEvent } from './events.js';
import type { Cursor, PresenceRecord, Profile, Announcement } from './state.js';

/**
 * Validate MessageEvent
 */
export function validateMessageEvent(event: unknown): event is MessageEvent {
  if (typeof event !== 'object' || event === null) return false;
  const e = event as Record<string, unknown>;

  return (
    e.type === 'msg' &&
    typeof e.ts === 'string' &&
    typeof e.seq === 'number' && e.seq >= 1 &&
    typeof e.from === 'string' && e.from.length > 0 &&
    typeof e.text === 'string' && Buffer.byteLength(e.text) <= 8192
  );
}

/**
 * Validate Cursor
 */
export function validateCursor(cursor: unknown): cursor is Cursor {
  if (typeof cursor !== 'object' || cursor === null) return false;
  const c = cursor as Record<string, unknown>;

  return (
    typeof c.last_seq === 'number' && c.last_seq >= 0 &&
    typeof c.epoch === 'number' && c.epoch >= 0 &&
    typeof c.updated_ts === 'string'
  );
}

/**
 * Validate PresenceRecord
 */
export function validatePresenceRecord(presence: unknown): presence is PresenceRecord {
  if (typeof presence !== 'object' || presence === null) return false;
  const p = presence as Record<string, unknown>;

  return (
    typeof p.last_request_ts === 'string' &&
    typeof p.last_heartbeat_ts === 'string' &&
    (p.status === 'available' || p.status === 'busy' || p.status === 'away')
  );
}

/**
 * Validate Profile
 */
export function validateProfile(profile: unknown): profile is Profile {
  if (typeof profile !== 'object' || profile === null) return false;
  const p = profile as Record<string, unknown>;

  return (
    typeof p.handle === 'string' && p.handle.length > 0 &&
    typeof p.role === 'string' && p.role.length > 0 &&
    Array.isArray(p.expertise) && p.expertise.every(e => typeof e === 'string') &&
    typeof p.updated_ts === 'string'
  );
}

/**
 * Validate Announcement
 */
export function validateAnnouncement(announcement: unknown): announcement is Announcement {
  if (typeof announcement !== 'object' || announcement === null) return false;
  const a = announcement as Record<string, unknown>;

  return (
    typeof a.version === 'number' && a.version >= 1 &&
    typeof a.ts === 'string' &&
    (a.content_type === 'text/markdown' || a.content_type === 'text/plain') &&
    typeof a.content === 'string' && Buffer.byteLength(a.content) <= 65536
  );
}

/**
 * Validate name patterns (space/thread names)
 * Pattern: ^[A-Za-z0-9._-]+$
 */
export function validateName(name: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(name);
}

/**
 * Validate handle pattern
 */
export function validateHandle(handle: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(handle);
}
