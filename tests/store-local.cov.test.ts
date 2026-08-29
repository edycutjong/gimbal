// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { SESSION_SCHEMA, type DeviceSignature, type PersistedSession } from '../src/store/session.ts';
import {
  SESSIONS_KEY,
  EXAMPLE_FLAG_KEY,
  THEME_KEY,
  SESSION_CAP,
  loadSessions,
  saveSessions,
  upsertSession,
  addExampleSessions,
  exampleLoaded,
  clearAllData,
} from '../src/store/local.ts';
import { testCard } from './helpers.ts';

/**
 * The failure paths of `store/local.ts` — an absent `localStorage`, a storage
 * that exposes the API and throws on write, a corrupt value someone else left
 * in the key, a quota that is already full.
 *
 * Every one of them is driven through the REAL `localStorage` of this jsdom
 * page: the stubs below replace exactly one `Storage.prototype` method for the
 * duration of one call and put it back in a `finally`, so what is under test is
 * still the module's own control flow rather than a mock of it.
 */

const sig: DeviceSignature = {
  userAgent: 'test-agent',
  cameraLabel: 'test-cam',
  resolution: '640x480',
  medianFps: 29.8,
  sigHash: 'fnv1a:0000000000000000',
};

function row(overrides: Partial<PersistedSession> = {}): PersistedSession {
  const startedAt = overrides.startedAt ?? '2026-08-27T09:14:22.512Z';
  return {
    schema: SESSION_SCHEMA,
    id: `s-${startedAt}`,
    provenance: 'live',
    startedAt,
    cardId: 'test-card',
    cardHash: 'fnv1a:0000000000000000',
    card: testCard(),
    device: sig,
    blocks: [],
    symptom: { baseline: 2, gates: [], final: 3 },
    totals: { prescribedSeconds: 360, deliveredSeconds: 246, ratio: 0.683 },
    appVersion: 'gimbal test',
    methodsRev: 'METHODS.md@test',
    ...overrides,
  };
}

/** Reads the key back as the app's own loader will see it. */
function stored(): unknown {
  const raw = localStorage.getItem(SESSIONS_KEY);
  return raw === null ? null : JSON.parse(raw);
}

/**
 * Runs `fn` with no `localStorage` on the global at all — the cleared-profile
 * case, distinct from a storage that exists and refuses to write.
 */
function withoutLocalStorage<T>(fn: () => T): T {
  const own = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true });
  try {
    return fn();
  } finally {
    if (own) Object.defineProperty(globalThis, 'localStorage', own);
    else delete (globalThis as { localStorage?: Storage }).localStorage;
  }
}

type Method = 'setItem' | 'getItem' | 'removeItem';

/**
 * Makes ONE `Storage` method throw for the keys `hits` selects, for the
 * duration of `fn`. Selecting by key is what lets a test fail the real write
 * while the module's private probe still succeeds — which is precisely the
 * private-browsing-versus-full-quota distinction the module draws.
 */
function throwingOn<T>(method: Method, hits: (key: string) => boolean, fn: () => T): T {
  const real = Storage.prototype[method];
  Object.defineProperty(Storage.prototype, method, {
    configurable: true,
    writable: true,
    value: function (this: Storage, key: string, value?: string): string | null | void {
      if (hits(key)) throw new DOMException('exceeded the quota', 'QuotaExceededError');
      return (real as (this: Storage, k: string, v?: string) => string | null | void).call(this, key, value);
    },
  });
  try {
    return fn();
  } finally {
    Object.defineProperty(Storage.prototype, method, {
      configurable: true,
      writable: true,
      value: real,
    });
  }
}

const always = (): boolean => true;

beforeEach(() => {
  localStorage.clear();
});

describe('the keys and the cap are stated, not implied', () => {
  it('namespaces every key under one version and states the cap', () => {
    expect(SESSIONS_KEY).toBe('gimbal.v1.sessions');
    expect(EXAMPLE_FLAG_KEY).toBe('gimbal.v1.exampleLoaded');
    expect(THEME_KEY).toBe('gimbal.v1.theme');
    expect(SESSION_CAP).toBe(100);
  });
});

describe('storage unavailable', () => {
  it('reports unavailable rather than empty when there is no localStorage at all', () => {
    withoutLocalStorage(() => {
      expect(loadSessions()).toEqual({ sessions: [], unknownSchemaCount: 0, unavailable: true });
    });
  });

  it('reports unavailable when the API exists but the probe write throws', () => {
    throwingOn('setItem', always, () => {
      expect(loadSessions()).toEqual({ sessions: [], unknownSchemaCount: 0, unavailable: true });
    });
  });

  it('does not lose a readable row just because the probe failed — it says unavailable', () => {
    expect(saveSessions([row()])).toBe(true);
    throwingOn('setItem', always, () => {
      const r = loadSessions();
      expect(r.unavailable).toBe(true);
      expect(r.sessions).toEqual([]);
    });
    // The row is still there once storage recovers: nothing was deleted.
    expect(loadSessions().sessions.length).toBe(1);
  });

  it('fails the save loudly (false) instead of pretending it wrote', () => {
    withoutLocalStorage(() => {
      expect(saveSessions([row()])).toBe(false);
    });
    expect(stored()).toBeNull();
  });

  it('reports the example flag as unset when there is no storage to read it from', () => {
    withoutLocalStorage(() => {
      expect(exampleLoaded()).toBe(false);
    });
  });

  it('makes clearAllData a silent no-op rather than a thrown error', () => {
    withoutLocalStorage(() => {
      expect(() => clearAllData()).not.toThrow();
    });
  });
});

describe('loadSessions', () => {
  it('returns an available-but-empty result when the key was never written', () => {
    expect(localStorage.getItem(SESSIONS_KEY)).toBeNull();
    expect(loadSessions()).toEqual({ sessions: [], unknownSchemaCount: 0, unavailable: false });
  });

  it('treats a corrupt value as empty WITHOUT claiming storage is unavailable', () => {
    localStorage.setItem(SESSIONS_KEY, '{ this is not json');
    const r = loadSessions();
    expect(r).toEqual({ sessions: [], unknownSchemaCount: 0, unavailable: false });
    // The distinction matters: the UI banner for "unavailable" is a different
    // message from the one for "your stored data did not parse".
    expect(r.unavailable).toBe(false);
  });

  it('refuses well-formed JSON that is not a list of rows', () => {
    for (const notAList of ['{}', '"rows"', '42', 'null', 'true']) {
      localStorage.setItem(SESSIONS_KEY, notAList);
      expect(loadSessions()).toEqual({ sessions: [], unknownSchemaCount: 0, unavailable: false });
    }
  });

  it('skips a null or schema-less row without throwing on it', () => {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify([null, {}, { schema: 7 }, row()]));
    const r = loadSessions();
    expect(r.sessions.map((s) => s.id)).toEqual([row().id]);
    expect(r.unknownSchemaCount).toBe(0);
  });

  it('counts a row from a schema this build does not know instead of hiding it', () => {
    localStorage.setItem(
      SESSIONS_KEY,
      JSON.stringify([
        row({ id: 'keep' }),
        { ...row({ id: 'future-1' }), schema: 'gimbal.session/2' },
        { ...row({ id: 'future-2' }), schema: 'gimbal.session/9' },
      ]),
    );
    const r = loadSessions();
    expect(r.sessions.map((s) => s.id)).toEqual(['keep']);
    expect(r.unknownSchemaCount).toBe(2);
    // Surfaced, never dropped silently: the rows are still in storage.
    expect((stored() as unknown[]).length).toBe(3);
  });

  it('keeps both provenances and drops a row whose provenance it cannot vouch for', () => {
    localStorage.setItem(
      SESSIONS_KEY,
      JSON.stringify([
        row({ id: 'live-1', provenance: 'live' }),
        row({ id: 'ex-1', provenance: 'example' }),
        { ...row({ id: 'bogus' }), provenance: 'imported' },
        { ...row({ id: 'absent' }), provenance: undefined },
      ]),
    );
    const r = loadSessions();
    expect(r.sessions.map((s) => s.id)).toEqual(['live-1', 'ex-1']);
    expect(r.unknownSchemaCount).toBe(0);
  });
});

describe('saveSessions', () => {
  it('round-trips rows and orders them oldest first by startedAt', () => {
    const b = row({ id: 'b', startedAt: '2026-08-02T09:00:00.000Z' });
    const a = row({ id: 'a', startedAt: '2026-08-01T09:00:00.000Z' });
    expect(saveSessions([b, a])).toBe(true);
    expect(loadSessions().sessions.map((s) => s.id)).toEqual(['a', 'b']);
    expect(stored()).toEqual([a, b]);
  });

  it('breaks a startedAt tie by id so the order is total, not arbitrary', () => {
    const at = '2026-08-01T09:00:00.000Z';
    const z = row({ id: 'z', startedAt: at });
    const m = row({ id: 'm', startedAt: at });
    const a = row({ id: 'a', startedAt: at });
    expect(saveSessions([z, m, a])).toBe(true);
    expect(loadSessions().sessions.map((s) => s.id)).toEqual(['a', 'm', 'z']);
  });

  it('does not mutate the array it was handed', () => {
    const input = [row({ id: 'b', startedAt: '2026-08-02T09:00:00.000Z' }), row({ id: 'a', startedAt: '2026-08-01T09:00:00.000Z' })];
    saveSessions(input);
    expect(input.map((s) => s.id)).toEqual(['b', 'a']);
  });

  it('writes an empty list as an empty list', () => {
    expect(saveSessions([])).toBe(true);
    expect(stored()).toEqual([]);
    expect(loadSessions().sessions).toEqual([]);
  });

  it('evicts the OLDEST rows first once the cap is passed', () => {
    const many = Array.from({ length: SESSION_CAP + 5 }, (_, i) =>
      row({ id: `s-${String(i).padStart(3, '0')}`, startedAt: `2026-08-01T09:00:00.${String(i).padStart(3, '0')}Z` }),
    );
    expect(saveSessions(many)).toBe(true);
    const kept = loadSessions().sessions;
    expect(kept.length).toBe(SESSION_CAP);
    expect(kept[0]?.id).toBe('s-005');
    expect(kept[SESSION_CAP - 1]?.id).toBe(`s-${String(SESSION_CAP + 4).padStart(3, '0')}`);
  });

  it('keeps everything when the count is exactly the cap', () => {
    const many = Array.from({ length: SESSION_CAP }, (_, i) =>
      row({ id: `s-${String(i).padStart(3, '0')}`, startedAt: `2026-08-01T09:00:00.${String(i).padStart(3, '0')}Z` }),
    );
    expect(saveSessions(many)).toBe(true);
    expect(loadSessions().sessions.length).toBe(SESSION_CAP);
  });

  it('returns false on a quota failure and leaves the previous value intact', () => {
    expect(saveSessions([row({ id: 'first' })])).toBe(true);
    throwingOn('setItem', (key) => key === SESSIONS_KEY, () => {
      expect(saveSessions([row({ id: 'second' })])).toBe(false);
    });
    expect(loadSessions().sessions.map((s) => s.id)).toEqual(['first']);
  });
});

describe('upsertSession', () => {
  it('appends a session that is not stored yet', () => {
    expect(upsertSession(row({ id: 'a', startedAt: '2026-08-01T09:00:00.000Z' }))).toBe(true);
    expect(upsertSession(row({ id: 'b', startedAt: '2026-08-02T09:00:00.000Z' }))).toBe(true);
    expect(loadSessions().sessions.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('replaces the row carrying the same id rather than duplicating it', () => {
    upsertSession(row({ id: 'a', symptom: { baseline: 1, gates: [], final: null } }));
    expect(upsertSession(row({ id: 'a', symptom: { baseline: 4, gates: [], final: 6 } }))).toBe(true);
    const sessions = loadSessions().sessions;
    expect(sessions.length).toBe(1);
    expect(sessions[0]?.symptom).toEqual({ baseline: 4, gates: [], final: 6 });
  });

  it('leaves the other rows alone while replacing one', () => {
    saveSessions([
      row({ id: 'a', startedAt: '2026-08-01T09:00:00.000Z' }),
      row({ id: 'b', startedAt: '2026-08-02T09:00:00.000Z' }),
    ]);
    upsertSession(row({ id: 'b', startedAt: '2026-08-02T09:00:00.000Z', appVersion: 'gimbal edited' }));
    const sessions = loadSessions().sessions;
    expect(sessions.map((s) => s.id)).toEqual(['a', 'b']);
    expect(sessions[0]?.appVersion).toBe('gimbal test');
    expect(sessions[1]?.appVersion).toBe('gimbal edited');
  });

  it('reports false when the write behind it failed', () => {
    throwingOn('setItem', (key) => key === SESSIONS_KEY, () => {
      expect(upsertSession(row({ id: 'a' }))).toBe(false);
    });
    expect(stored()).toBeNull();
  });
});

describe('addExampleSessions', () => {
  const ex = (id: string, day: string): PersistedSession =>
    row({ id, provenance: 'example', capturedBy: 'developer', startedAt: `2026-08-${day}T09:00:00.000Z` });

  it('adds the rows, reports the count, and raises the flag', () => {
    expect(addExampleSessions([ex('ex-1', '01'), ex('ex-2', '02')])).toBe(2);
    expect(loadSessions().sessions.map((s) => s.id)).toEqual(['ex-1', 'ex-2']);
    expect(localStorage.getItem(EXAMPLE_FLAG_KEY)).toBe('true');
    expect(exampleLoaded()).toBe(true);
  });

  it('adds nothing and touches no flag when every id is already stored', () => {
    saveSessions([ex('ex-1', '01')]);
    expect(addExampleSessions([ex('ex-1', '01')])).toBe(0);
    expect(localStorage.getItem(EXAMPLE_FLAG_KEY)).toBeNull();
    expect(loadSessions().sessions.length).toBe(1);
  });

  it('returns 0 for an empty offering', () => {
    expect(addExampleSessions([])).toBe(0);
    expect(stored()).toBeNull();
  });

  it('adds only the ids that are new and never reorders the live rows', () => {
    const live = row({ id: 's-live', startedAt: '2026-08-05T09:00:00.000Z' });
    saveSessions([live]);
    expect(addExampleSessions([ex('ex-1', '01'), ex('ex-2', '02')])).toBe(2);
    expect(addExampleSessions([ex('ex-1', '01'), ex('ex-3', '03')])).toBe(1);
    expect(loadSessions().sessions.map((s) => s.id)).toEqual(['ex-1', 'ex-2', 'ex-3', 's-live']);
  });

  it('still reports the rows it added when only the convenience flag failed to write', () => {
    throwingOn('setItem', (key) => key === EXAMPLE_FLAG_KEY, () => {
      expect(addExampleSessions([ex('ex-1', '01')])).toBe(1);
    });
    // The per-row provenance is the truth, and it survived.
    expect(loadSessions().sessions.map((s) => s.provenance)).toEqual(['example']);
    expect(localStorage.getItem(EXAMPLE_FLAG_KEY)).toBeNull();
    expect(exampleLoaded()).toBe(false);
  });

  it('counts the rows it was given even when storage refuses everything', () => {
    throwingOn('setItem', always, () => {
      expect(addExampleSessions([ex('ex-1', '01'), ex('ex-2', '02')])).toBe(2);
    });
    expect(stored()).toBeNull();
    expect(localStorage.getItem(EXAMPLE_FLAG_KEY)).toBeNull();
  });
});

describe('exampleLoaded', () => {
  it('is false until the flag is exactly the string true', () => {
    expect(exampleLoaded()).toBe(false);
    localStorage.setItem(EXAMPLE_FLAG_KEY, 'false');
    expect(exampleLoaded()).toBe(false);
    localStorage.setItem(EXAMPLE_FLAG_KEY, '1');
    expect(exampleLoaded()).toBe(false);
    localStorage.setItem(EXAMPLE_FLAG_KEY, 'true');
    expect(exampleLoaded()).toBe(true);
  });

  it('answers false rather than throwing when the read itself throws', () => {
    localStorage.setItem(EXAMPLE_FLAG_KEY, 'true');
    throwingOn('getItem', (key) => key === EXAMPLE_FLAG_KEY, () => {
      expect(exampleLoaded()).toBe(false);
    });
    expect(exampleLoaded()).toBe(true);
  });
});

describe('clearAllData', () => {
  it('removes both populations, the flag, and the theme — everything Gimbal wrote', () => {
    saveSessions([row()]);
    localStorage.setItem(EXAMPLE_FLAG_KEY, 'true');
    localStorage.setItem(THEME_KEY, 'dark');
    localStorage.setItem('someone.else', 'keep me');

    clearAllData();

    expect(localStorage.getItem(SESSIONS_KEY)).toBeNull();
    expect(localStorage.getItem(EXAMPLE_FLAG_KEY)).toBeNull();
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
    expect(loadSessions().sessions).toEqual([]);
    expect(exampleLoaded()).toBe(false);
    // Only this app's namespace: another app's key on the same profile survives.
    expect(localStorage.getItem('someone.else')).toBe('keep me');
  });

  it('keeps going when one key refuses to be removed', () => {
    saveSessions([row()]);
    localStorage.setItem(EXAMPLE_FLAG_KEY, 'true');
    localStorage.setItem(THEME_KEY, 'dark');

    throwingOn('removeItem', (key) => key === SESSIONS_KEY, () => {
      expect(() => clearAllData()).not.toThrow();
    });

    // The two that could be removed were removed; the stubborn one is untouched.
    expect(localStorage.getItem(EXAMPLE_FLAG_KEY)).toBeNull();
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
    expect(loadSessions().sessions.length).toBe(1);
  });
});
