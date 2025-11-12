/**
 * State Operations - Presence, Profiles, and Announcements
 *
 * Manages agent presence, profiles, and space-wide announcements
 */

import { mkdir, readFile, writeFile, readdir } from 'fs/promises';
import { dirname, join } from 'path';
import type {
  PresenceRecord,
  Profile,
  Announcement,
  AnnouncementSeen,
} from '../types/state.js';
import { assertValidName } from '../utils/validation.js';

// ============================================================================
// Presence Operations
// ============================================================================

/**
 * Get presence file path for a handle
 */
export function getPresencePath(rootDir: string, space: string, handle: string): string {
  assertValidName(space, 'space');
  return join(rootDir, 'spaces', space, 'state', 'presence', `${handle}.json`);
}

/**
 * Read presence record for a handle
 *
 * @param rootDir - Root directory for storage
 * @param space - Space name
 * @param handle - Handle identifier
 * @returns PresenceRecord or null if not exists
 */
export async function getPresence(
  rootDir: string,
  space: string,
  handle: string
): Promise<PresenceRecord | null> {
  const presencePath = getPresencePath(rootDir, space, handle);

  try {
    const content = await readFile(presencePath, 'utf8');
    return JSON.parse(content) as PresenceRecord;
  } catch {
    return null;
  }
}

/**
 * Write presence record for a handle
 *
 * @param rootDir - Root directory for storage
 * @param space - Space name
 * @param handle - Handle identifier
 * @param presence - Presence data to write
 */
export async function writePresence(
  rootDir: string,
  space: string,
  handle: string,
  presence: PresenceRecord
): Promise<void> {
  const presencePath = getPresencePath(rootDir, space, handle);

  // Ensure directory exists
  await mkdir(dirname(presencePath), { recursive: true });

  const content = JSON.stringify(presence, null, 2);
  await writeFile(presencePath, content, 'utf8');
}

/**
 * Update last_request_ts for a handle (called on every tool invocation)
 *
 * @param rootDir - Root directory for storage
 * @param space - Space name
 * @param handle - Handle identifier
 */
export async function updateLastRequest(
  rootDir: string,
  space: string,
  handle: string
): Promise<void> {
  const current = await getPresence(rootDir, space, handle);

  const presence: PresenceRecord = {
    last_request_ts: new Date().toISOString(),
    last_heartbeat_ts: current?.last_heartbeat_ts || new Date().toISOString(),
    status: current?.status || 'available',
  };

  await writePresence(rootDir, space, handle, presence);
}

/**
 * Update heartbeat and status for a handle (explicit heartbeat)
 *
 * @param rootDir - Root directory for storage
 * @param space - Space name
 * @param handle - Handle identifier
 * @param status - New status
 */
export async function updateHeartbeat(
  rootDir: string,
  space: string,
  handle: string,
  status: 'available' | 'busy' | 'away'
): Promise<void> {
  const current = await getPresence(rootDir, space, handle);

  const presence: PresenceRecord = {
    last_request_ts: current?.last_request_ts || new Date().toISOString(),
    last_heartbeat_ts: new Date().toISOString(),
    status,
  };

  await writePresence(rootDir, space, handle, presence);
}

/**
 * Check if a handle is currently online
 *
 * @param presence - Presence record
 * @param ttlSeconds - Presence TTL in seconds (default: 60)
 * @returns true if handle is online
 */
export function isOnline(presence: PresenceRecord, ttlSeconds: number = 60): boolean {
  const lastRequestTime = new Date(presence.last_request_ts).getTime();
  const lastHeartbeatTime = new Date(presence.last_heartbeat_ts).getTime();
  const lastActivityTime = Math.max(lastRequestTime, lastHeartbeatTime);

  const now = Date.now();
  const ttlMs = ttlSeconds * 1000;

  return now - lastActivityTime <= ttlMs;
}

// ============================================================================
// Profile Operations
// ============================================================================

/**
 * Get profile file path for a handle
 */
export function getProfilePath(rootDir: string, space: string, handle: string): string {
  assertValidName(space, 'space');
  return join(rootDir, 'spaces', space, 'state', 'profiles', `${handle}.json`);
}

/**
 * Read profile for a handle
 *
 * @param rootDir - Root directory for storage
 * @param space - Space name
 * @param handle - Handle identifier
 * @returns Profile or null if not exists
 */
export async function getProfile(
  rootDir: string,
  space: string,
  handle: string
): Promise<Profile | null> {
  const profilePath = getProfilePath(rootDir, space, handle);

  try {
    const content = await readFile(profilePath, 'utf8');
    return JSON.parse(content) as Profile;
  } catch {
    return null;
  }
}

/**
 * Write or update profile for a handle
 *
 * @param rootDir - Root directory for storage
 * @param space - Space name
 * @param handle - Handle identifier
 * @param role - Agent role
 * @param expertise - Array of expertise areas
 */
export async function writeProfile(
  rootDir: string,
  space: string,
  handle: string,
  role: string,
  expertise: string[]
): Promise<Profile> {
  const profilePath = getProfilePath(rootDir, space, handle);

  // Ensure directory exists
  await mkdir(dirname(profilePath), { recursive: true });

  const profile: Profile = {
    handle,
    role,
    expertise,
    updated_ts: new Date().toISOString(),
  };

  const content = JSON.stringify(profile, null, 2);
  await writeFile(profilePath, content, 'utf8');

  return profile;
}

// ============================================================================
// Announcement Operations
// ============================================================================

/**
 * Get announcement file path for a space
 */
export function getAnnouncementPath(rootDir: string, space: string): string {
  assertValidName(space, 'space');
  return join(rootDir, 'spaces', space, 'state', 'announcement.json');
}

/**
 * Get announcement seen marker path for a handle
 */
export function getAnnouncementSeenPath(
  rootDir: string,
  space: string,
  handle: string
): string {
  assertValidName(space, 'space');
  return join(rootDir, 'spaces', space, 'state', 'announcement_seen', `${handle}.json`);
}

/**
 * Read current announcement
 *
 * @param rootDir - Root directory for storage
 * @param space - Space name
 * @returns Announcement or null if not exists
 */
export async function getAnnouncement(
  rootDir: string,
  space: string
): Promise<Announcement | null> {
  const announcementPath = getAnnouncementPath(rootDir, space);

  try {
    const content = await readFile(announcementPath, 'utf8');
    return JSON.parse(content) as Announcement;
  } catch {
    return null;
  }
}

/**
 * Set announcement (replace content, bump version)
 *
 * @param rootDir - Root directory for storage
 * @param space - Space name
 * @param content - New announcement content
 * @param contentType - Content type
 * @returns Updated announcement
 */
export async function setAnnouncement(
  rootDir: string,
  space: string,
  content: string,
  contentType: 'text/markdown' | 'text/plain' = 'text/markdown'
): Promise<Announcement> {
  const announcementPath = getAnnouncementPath(rootDir, space);

  // Get current announcement to determine next version
  const current = await getAnnouncement(rootDir, space);
  const version = current ? current.version + 1 : 1;

  const announcement: Announcement = {
    version,
    ts: new Date().toISOString(),
    content_type: contentType,
    content,
  };

  // Ensure directory exists
  await mkdir(dirname(announcementPath), { recursive: true });

  const serialized = JSON.stringify(announcement, null, 2);
  await writeFile(announcementPath, serialized, 'utf8');

  return announcement;
}

/**
 * Append to announcement (append to content, bump version)
 *
 * @param rootDir - Root directory for storage
 * @param space - Space name
 * @param additionalContent - Content to append
 * @returns Updated announcement
 */
export async function appendAnnouncement(
  rootDir: string,
  space: string,
  additionalContent: string
): Promise<Announcement> {
  const current = await getAnnouncement(rootDir, space);

  if (!current) {
    // No existing announcement, create new one
    return setAnnouncement(rootDir, space, additionalContent);
  }

  // Append to existing content
  const newContent = current.content + '\n\n' + additionalContent;
  return setAnnouncement(rootDir, space, newContent, current.content_type);
}

/**
 * Get last seen version for a handle
 *
 * @param rootDir - Root directory for storage
 * @param space - Space name
 * @param handle - Handle identifier
 * @returns Last seen version, or 0 if never seen
 */
export async function getAnnouncementSeen(
  rootDir: string,
  space: string,
  handle: string
): Promise<number> {
  const seenPath = getAnnouncementSeenPath(rootDir, space, handle);

  try {
    const content = await readFile(seenPath, 'utf8');
    const seen = JSON.parse(content) as AnnouncementSeen;
    return seen.last_seen_version;
  } catch {
    return 0;
  }
}

/**
 * Mark announcement as seen by a handle
 *
 * @param rootDir - Root directory for storage
 * @param space - Space name
 * @param handle - Handle identifier
 * @param version - Version that was seen
 */
export async function markAnnouncementSeen(
  rootDir: string,
  space: string,
  handle: string,
  version: number
): Promise<void> {
  const seenPath = getAnnouncementSeenPath(rootDir, space, handle);

  // Ensure directory exists
  await mkdir(dirname(seenPath), { recursive: true });

  const seen: AnnouncementSeen = {
    last_seen_version: version,
    seen_at: new Date().toISOString(),
  };

  const content = JSON.stringify(seen, null, 2);
  await writeFile(seenPath, content, 'utf8');
}

// ============================================================================
// "Who's Online" Query
// ============================================================================

/**
 * Result for who's online query
 */
export interface OnlineAgent {
  handle: string;
  presence: PresenceRecord;
  profile: Profile | null;
}

/**
 * Get list of currently online agents in a space
 *
 * @param rootDir - Root directory for storage
 * @param space - Space name
 * @param ttlSeconds - Presence TTL in seconds (default: 60)
 * @returns Array of online agents with presence and profile data
 */
export async function getWhoIsOnline(
  rootDir: string,
  space: string,
  ttlSeconds: number = 60
): Promise<OnlineAgent[]> {
  const presenceDir = join(rootDir, 'spaces', space, 'state', 'presence');

  let presenceFiles: string[];
  try {
    presenceFiles = await readdir(presenceDir);
  } catch {
    // Presence directory doesn't exist yet
    return [];
  }

  const onlineAgents: OnlineAgent[] = [];

  for (const file of presenceFiles) {
    if (!file.endsWith('.json')) continue;

    const handle = file.replace('.json', '');

    const presence = await getPresence(rootDir, space, handle);
    if (!presence) continue;

    // Check if online
    if (!isOnline(presence, ttlSeconds)) continue;

    // Get profile
    const profile = await getProfile(rootDir, space, handle);

    onlineAgents.push({
      handle,
      presence,
      profile,
    });
  }

  return onlineAgents;
}
