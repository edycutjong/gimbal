// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SESSION_SCHEMA, type PersistedSession } from '../src/store/session.ts';
import { SESSIONS_KEY, EXAMPLE_FLAG_KEY, loadSessions, saveSessions } from '../src/store/local.ts';
import { buildDeviceSignature } from '../src/store/deviceSignature.ts';
import {
  EXAMPLE_LEDGER_PATH,
  NOT_RECORDED_YET,
  validateExampleRows,
  loadExampleLedger,
} from '../src/store/exampleLedger.ts';
import { downloadSessionJson } from '../src/store/export.ts';
import { testCard } from './helpers.ts';

const sig = buildDeviceSignature({
  userAgent: 'test-agent',
  cameraLabel: 'test-cam',
  resolution: '640x480',
  medianFps: 29.8,
});

/**
 * A SYNTHETIC persisted row, built here in `tests/` rather than read from
 * `fixtures/` — `scripts/build-example-ledger.mjs` refuses synthetic input by
 * design, so the real ledger cannot be manufactured for a unit test. These rows
 * exercise the loader's shape checks and never reach the app.
 */
function exampleRow(overrides: Partial<PersistedSession> = {}): PersistedSession {
  const startedAt = overrides.startedAt ?? '2026-08-27T09:14:22.512Z';
  return {
    schema: SESSION_SCHEMA,
    id: overrides.id ?? `ex-${startedAt}`,
    provenance: 'example',
    capturedBy: 'developer',
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

/** A same-origin JSON answer, built from the real `Response` the loader reads. */
function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

const realFetch = globalThis.fetch;
let requested: string[] = [];

/** Installs a fetch that never touches the network and records what was asked for. */
function serve(make: () => Response | Promise<Response>): void {
  globalThis.fetch = ((input: RequestInfo | URL) => {
    requested.push(String(input));
    return Promise.resolve(make());
  }) as typeof fetch;
}

beforeEach(() => {
  requested = [];
  localStorage.clear();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('validateExampleRows', () => {
  it('refuses a payload that is not a list of sessions', () => {
    for (const bad of [{}, 'rows', 42, null]) {
      const r = validateExampleRows(bad);
      expect(r.rows).toEqual([]);
      expect(r.reason).toBe('the example ledger is not a list of sessions');
    }
  });

  it('accepts an empty list with no reason — emptiness is not a validation failure', () => {
    const r = validateExampleRows([]);
    expect(r.rows).toEqual([]);
    expect(r.reason).toBeUndefined();
  });

  it('returns every well-formed row, by identity, in order', () => {
    const a = exampleRow({ id: 'ex-a', startedAt: '2026-08-01T09:00:00.000Z' });
    const b = exampleRow({ id: 'ex-b', startedAt: '2026-08-02T09:00:00.000Z' });
    const r = validateExampleRows([a, b]);
    expect(r.reason).toBeUndefined();
    expect(r.rows.length).toBe(2);
    expect(r.rows[0]).toBe(a);
    expect(r.rows[1]).toBe(b);
  });

  it('names the unknown schema it saw rather than dropping the row', () => {
    const r = validateExampleRows([exampleRow(), { ...exampleRow({ id: 'ex-2' }), schema: 'gimbal.session/9' }]);
    expect(r.rows).toEqual([]);
    expect(r.reason).toBe('the example ledger contains an unknown schema: gimbal.session/9');
  });

  it('reports `undefined` for a null or schema-less row instead of throwing', () => {
    expect(validateExampleRows([null]).reason).toBe('the example ledger contains an unknown schema: undefined');
    expect(validateExampleRows([undefined]).reason).toBe('the example ledger contains an unknown schema: undefined');
    expect(validateExampleRows([{}]).reason).toBe('the example ledger contains an unknown schema: undefined');
  });

  it('refuses a row that is not labelled as an example', () => {
    const r = validateExampleRows([{ ...exampleRow(), provenance: 'live' }]);
    expect(r.rows).toEqual([]);
    expect(r.reason).toBe('the example ledger contains a row that is not labelled as an example');
  });

  it('refuses an example row with no capturedBy label', () => {
    const missing = validateExampleRows([{ ...exampleRow(), capturedBy: undefined }]);
    expect(missing.rows).toEqual([]);
    expect(missing.reason).toBe('the example ledger contains a row with no capturedBy label');
    const wrong = validateExampleRows([{ ...exampleRow(), capturedBy: 'patient' }]);
    expect(wrong.reason).toBe('the example ledger contains a row with no capturedBy label');
  });

  it('rejects the whole ledger when any later row is bad — no partial import', () => {
    const good = exampleRow({ id: 'ex-good' });
    const r = validateExampleRows([good, { ...exampleRow({ id: 'ex-bad' }), provenance: 'live' }]);
    expect(r.rows).toEqual([]);
    expect(r.reason).toBeDefined();
  });
});

describe('loadExampleLedger', () => {
  it('adds the fixture rows to storage and reports what it added', async () => {
    const rows = [
      exampleRow({ id: 'ex-1', startedAt: '2026-08-01T09:00:00.000Z' }),
      exampleRow({ id: 'ex-2', startedAt: '2026-08-02T09:00:00.000Z' }),
    ];
    serve(() => jsonResponse(rows));

    const out = await loadExampleLedger();
    expect(requested).toEqual([EXAMPLE_LEDGER_PATH]);
    expect(out.ok).toBe(true);
    expect(out.added).toBe(2);
    expect(out.reason).toBeUndefined();
    expect(out.sessions.map((s) => s.id)).toEqual(['ex-1', 'ex-2']);

    const stored = loadSessions();
    expect(stored.sessions.map((s) => s.id).sort()).toEqual(['ex-1', 'ex-2']);
    for (const s of stored.sessions) expect(s.provenance).toBe('example');
    expect(localStorage.getItem(EXAMPLE_FLAG_KEY)).toBe('true');
  });

  it('is idempotent — a second load adds nothing but still succeeds', async () => {
    const rows = [exampleRow({ id: 'ex-1' })];
    serve(() => jsonResponse(rows));

    await loadExampleLedger();
    const again = await loadExampleLedger();
    expect(again.ok).toBe(true);
    expect(again.added).toBe(0);
    expect(again.sessions.length).toBe(1);
    expect(loadSessions().sessions.length).toBe(1);
  });

  it('leaves an existing live row untouched', async () => {
    const live = exampleRow({ id: 's-live', provenance: 'live', capturedBy: undefined });
    saveSessions([live]);
    serve(() => jsonResponse([exampleRow({ id: 'ex-1', startedAt: '2026-08-02T09:00:00.000Z' })]));

    const out = await loadExampleLedger();
    expect(out.added).toBe(1);
    const ids = loadSessions().sessions.map((s) => s.id).sort();
    expect(ids).toEqual(['ex-1', 's-live']);
  });

  it('says the ledger has not been recorded yet when the fixture is missing', async () => {
    serve(() => new Response('', { status: 404 }));
    const out = await loadExampleLedger();
    expect(out).toEqual({ ok: false, added: 0, reason: NOT_RECORDED_YET, sessions: [] });
    expect(localStorage.getItem(SESSIONS_KEY)).toBeNull();
  });

  it('does not mistake a single-page host answering with the app HTML for a ledger', async () => {
    serve(
      () =>
        new Response('<!doctype html><html><body>gimbal</body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        }),
    );
    const out = await loadExampleLedger();
    expect(out.ok).toBe(false);
    expect(out.reason).toBe(NOT_RECORDED_YET);
    expect(out.sessions).toEqual([]);
  });

  it('treats a response with no content-type at all as not-recorded-yet', async () => {
    serve(() => {
      const r = new Response(null, { status: 200 });
      r.headers.delete('content-type');
      expect(r.headers.get('content-type')).toBeNull();
      return r;
    });
    const out = await loadExampleLedger();
    expect(out.ok).toBe(false);
    expect(out.reason).toBe(NOT_RECORDED_YET);
  });

  it('reports not-recorded-yet rather than a JSON syntax error on a malformed body', async () => {
    serve(
      () =>
        new Response('{ this is not json', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const out = await loadExampleLedger();
    expect(out.ok).toBe(false);
    expect(out.reason).toBe(NOT_RECORDED_YET);
    expect(out.added).toBe(0);
  });

  it('surfaces the validation reason visibly instead of swallowing it', async () => {
    serve(() => jsonResponse([{ ...exampleRow(), provenance: 'live' }]));
    const out = await loadExampleLedger();
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('the example ledger contains a row that is not labelled as an example');
    expect(out.sessions).toEqual([]);
    expect(localStorage.getItem(SESSIONS_KEY)).toBeNull();
  });

  it('treats a well-formed but empty ledger as nothing recorded yet', async () => {
    serve(() => jsonResponse([]));
    const out = await loadExampleLedger();
    expect(out.ok).toBe(false);
    expect(out.added).toBe(0);
    expect(out.reason).toBe(NOT_RECORDED_YET);
    expect(localStorage.getItem(EXAMPLE_FLAG_KEY)).toBeNull();
  });

  it('reports not-recorded-yet when fetch itself rejects', async () => {
    globalThis.fetch = (() => Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch;
    const out = await loadExampleLedger();
    expect(out).toEqual({ ok: false, added: 0, reason: NOT_RECORDED_YET, sessions: [] });
  });

  it('reports not-recorded-yet when fetch throws synchronously', async () => {
    globalThis.fetch = (() => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    const out = await loadExampleLedger();
    expect(out.ok).toBe(false);
    expect(out.reason).toBe(NOT_RECORDED_YET);
  });

  it('states the honest reason — frozen from real sessions, never generated', () => {
    expect(EXAMPLE_LEDGER_PATH).toBe('/fixtures/example-ledger.json');
    expect(NOT_RECORDED_YET).toContain('never generated');
    expect(NOT_RECORDED_YET).toContain('Run a session and your own report appears here.');
  });
});

describe('downloadSessionJson', () => {
  const realCreate = URL.createObjectURL;
  const realRevoke = URL.revokeObjectURL;

  interface ClickRecord {
    href: string;
    download: string;
    inBody: boolean;
  }

  /**
   * Drives the real DOM path and records what the anchor looked like at the
   * moment it was clicked — the only point at which the browser reads it.
   */
  async function capture(session: PersistedSession): Promise<{
    blobs: Blob[];
    clicks: ClickRecord[];
    revoked: string[];
    text: string;
    type: string;
  }> {
    const blobs: Blob[] = [];
    const revoked: string[] = [];
    const clicks: ClickRecord[] = [];
    URL.createObjectURL = ((b: Blob) => {
      blobs.push(b);
      return `blob:gimbal/${blobs.length}`;
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = ((u: string) => {
      revoked.push(u);
    }) as typeof URL.revokeObjectURL;
    const onClick = (e: Event): void => {
      e.preventDefault();
      const a = e.target as HTMLAnchorElement;
      clicks.push({ href: a.href, download: a.download, inBody: document.body.contains(a) });
    };
    document.addEventListener('click', onClick, true);
    try {
      downloadSessionJson(session);
    } finally {
      document.removeEventListener('click', onClick, true);
      URL.createObjectURL = realCreate;
      URL.revokeObjectURL = realRevoke;
    }
    const blob = blobs[0] as Blob;
    return { blobs, clicks, revoked, text: await blob.text(), type: blob.type };
  }

  it('writes the whole session as pretty-printed JSON into the blob', async () => {
    const session = exampleRow({ id: 'ex-export' });
    const { blobs, text, type } = await capture(session);
    expect(blobs.length).toBe(1);
    expect(type).toBe('application/json');
    expect(text).toBe(JSON.stringify(session, null, 2));
    expect(JSON.parse(text)).toEqual(session);
    // Pretty-printed: a reader opening the file sees indented lines, not one.
    expect(text.split('\n').length).toBeGreaterThan(10);
  });

  it('clicks an anchor that is in the document and carries the object URL', async () => {
    const { clicks } = await capture(exampleRow());
    expect(clicks.length).toBe(1);
    const click = clicks[0] as ClickRecord;
    expect(click.inBody).toBe(true);
    expect(click.href).toBe('blob:gimbal/1');
  });

  it('names the file from startedAt with colons and dots made filename-safe', async () => {
    const { clicks } = await capture(exampleRow({ startedAt: '2026-08-27T09:14:22.512Z' }));
    expect((clicks[0] as ClickRecord).download).toBe('gimbal-session-2026-08-27T09-14-22-512Z.json');
  });

  it('leaves no anchor behind and revokes the object URL it created', async () => {
    const before = document.body.querySelectorAll('a').length;
    const { revoked } = await capture(exampleRow());
    expect(document.body.querySelectorAll('a').length).toBe(before);
    expect(revoked).toEqual(['blob:gimbal/1']);
  });
});
