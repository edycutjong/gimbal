import { SESSION_SCHEMA, type PersistedSession } from './session.ts';

/**
 * `localStorage`, ONE versioned key, written exactly twice per session — block
 * end and session end. Never inside the 30 Hz loop: a synchronous write would
 * stall a frame and corrupt the cadence term of the very score that judges
 * frames.
 *
 * At ≈3.5 KB per session, IndexedDB is async machinery for a problem that does
 * not exist.
 */
export const SESSIONS_KEY = 'gimbal.v1.sessions';
export const EXAMPLE_FLAG_KEY = 'gimbal.v1.exampleLoaded';
export const THEME_KEY = 'gimbal.v1.theme';

/** Storage that silently evicts is storage that lies — the count is visible in the UI. */
export const SESSION_CAP = 100;

export interface LoadResult {
  sessions: PersistedSession[];
  /** Rows carrying a `gimbal.session/N` this build does not know. Surfaced, never dropped silently. */
  unknownSchemaCount: number;
  /** Set when localStorage itself is unavailable (private browsing, quota, a cleared profile). */
  unavailable: boolean;
}

function storage(): Storage | null {
  try {
    const s = globalThis.localStorage;
    if (!s) return null;
    // Private browsing can expose the API and throw on write.
    const probe = '__gimbal_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

export function loadSessions(): LoadResult {
  const s = storage();
  if (!s) return { sessions: [], unknownSchemaCount: 0, unavailable: true };
  let raw: unknown;
  try {
    raw = JSON.parse(s.getItem(SESSIONS_KEY) ?? '[]');
  } catch {
    return { sessions: [], unknownSchemaCount: 0, unavailable: false };
  }
  if (!Array.isArray(raw)) return { sessions: [], unknownSchemaCount: 0, unavailable: false };

  const sessions: PersistedSession[] = [];
  let unknownSchemaCount = 0;
  for (const row of raw) {
    const r = row as Partial<PersistedSession>;
    if (typeof r?.schema !== 'string') continue;
    if (r.schema !== SESSION_SCHEMA) {
      unknownSchemaCount += 1;
      continue;
    }
    if (r.provenance !== 'live' && r.provenance !== 'example') continue;
    sessions.push(row as PersistedSession);
  }
  return { sessions, unknownSchemaCount, unavailable: false };
}

/** Returns false when the write failed — the caller shows a banner and the report still prints. */
export function saveSessions(sessions: readonly PersistedSession[]): boolean {
  const s = storage();
  if (!s) return false;
  // FIFO: oldest evicted first, and the cap is stated on screen.
  const ordered = [...sessions].sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id));
  const capped = ordered.slice(Math.max(0, ordered.length - SESSION_CAP));
  try {
    s.setItem(SESSIONS_KEY, JSON.stringify(capped));
    return true;
  } catch {
    return false;
  }
}

export function upsertSession(session: PersistedSession): boolean {
  const { sessions } = loadSessions();
  const next = sessions.filter((s) => s.id !== session.id);
  next.push(session);
  return saveSessions(next);
}

/**
 * Adds example rows WITHOUT overwriting or reordering live rows.
 * Returns the number actually added.
 */
export function addExampleSessions(rows: readonly PersistedSession[]): number {
  const { sessions } = loadSessions();
  const existing = new Set(sessions.map((s) => s.id));
  const fresh = rows.filter((r) => !existing.has(r.id));
  if (fresh.length === 0) return 0;
  saveSessions([...sessions, ...fresh]);
  const s = storage();
  try {
    s?.setItem(EXAMPLE_FLAG_KEY, 'true');
  } catch {
    /* the flag is a convenience; the per-row provenance is the truth */
  }
  return fresh.length;
}

export function exampleLoaded(): boolean {
  try {
    return storage()?.getItem(EXAMPLE_FLAG_KEY) === 'true';
  } catch {
    return false;
  }
}

/**
 * `[ Clear all data ]` — removes EVERYTHING Gimbal wrote into this browser
 * profile: both stored populations, the example flag, and the theme preference,
 * which shares this key namespace. That is what makes "data never leaves this
 * browser profile; clear it with one button" literally true rather than
 * approximately true. The theme then re-seeds from `prefers-color-scheme`.
 */
export function clearAllData(): void {
  const s = storage();
  if (!s) return;
  for (const key of [SESSIONS_KEY, EXAMPLE_FLAG_KEY, THEME_KEY]) {
    try {
      s.removeItem(key);
    } catch {
      /* nothing left to do — the key is gone or was never writable */
    }
  }
}
