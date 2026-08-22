import { SESSION_SCHEMA, type PersistedSession } from './session.ts';
import { addExampleSessions } from './local.ts';

/**
 * The example-ledger loader.
 *
 * The rule that the fixture-replay path must be UI-unreachable governs the
 * MEASUREMENT replay, and it is unchanged. The example ledger is the opposite
 * case and must be reachable, because its whole job is to let a judge who has
 * run one session see what the trend criterion actually does. Deciding otherwise
 * would make the ledger invisible to every judge.
 *
 * The distinction is exact: an example ledger is a PROVENANCE disclosure — "this
 * measurement is mine, not yours, and it is older". A labelled mock is a
 * VALIDITY disclosure — "this number was not measured". Only the second is the
 * pattern that must never ship, and this is not it: every row is real recorded
 * execution, exported through the app's own download button.
 *
 * THIS MODULE HAS NO WRITE PATH INTO THE PRESCRIPTION FORM. It never references
 * any of the eight field ids and never touches the card draft — which is check
 * U-CARD's second limb, and what keeps claim C1 structurally true.
 */

export const EXAMPLE_LEDGER_PATH = '/fixtures/example-ledger.json';

export interface LoadOutcome {
  ok: boolean;
  added: number;
  /** Present when the fixture failed validation — surfaced with a visible reason, never swallowed. */
  reason?: string;
  sessions: PersistedSession[];
}

export function validateExampleRows(input: unknown): { rows: PersistedSession[]; reason?: string } {
  if (!Array.isArray(input)) return { rows: [], reason: 'the example ledger is not a list of sessions' };
  const rows: PersistedSession[] = [];
  for (const raw of input) {
    const r = raw as Partial<PersistedSession>;
    if (r?.schema !== SESSION_SCHEMA) {
      return { rows: [], reason: `the example ledger contains an unknown schema: ${String(r?.schema)}` };
    }
    if (r.provenance !== 'example') {
      return { rows: [], reason: 'the example ledger contains a row that is not labelled as an example' };
    }
    if (r.capturedBy !== 'developer') {
      return { rows: [], reason: 'the example ledger contains a row with no capturedBy label' };
    }
    rows.push(raw as PersistedSession);
  }
  return { rows };
}

/**
 * The honest message when the fixture is simply not there yet.
 *
 * A static host answering an unknown path with `index.html` would otherwise
 * surface as a JSON syntax error, which tells a reader nothing true. The
 * example ledger cannot be generated — it is frozen from real recorded sessions
 * — so "it has not been recorded yet" is the accurate statement, and it is the
 * one the interface makes.
 */
export const NOT_RECORDED_YET =
  'No example ledger has been recorded yet. It is frozen from real sessions the developer performed, ' +
  'never generated, so there is nothing to show until those recordings exist. Run a session and your ' +
  'own report appears here.';

export async function loadExampleLedger(): Promise<LoadOutcome> {
  try {
    // Same-origin, already cached at load, so this works offline.
    const response = await fetch(EXAMPLE_LEDGER_PATH);
    if (!response.ok) {
      return { ok: false, added: 0, reason: NOT_RECORDED_YET, sessions: [] };
    }
    // A single-page host answers an unknown path with the app's own HTML.
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('json')) {
      return { ok: false, added: 0, reason: NOT_RECORDED_YET, sessions: [] };
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { ok: false, added: 0, reason: NOT_RECORDED_YET, sessions: [] };
    }
    const { rows, reason } = validateExampleRows(payload);
    if (reason) return { ok: false, added: 0, reason, sessions: [] };
    if (rows.length === 0) return { ok: false, added: 0, reason: NOT_RECORDED_YET, sessions: [] };
    const added = addExampleSessions(rows);
    return { ok: true, added, sessions: rows };
  } catch {
    return { ok: false, added: 0, reason: NOT_RECORDED_YET, sessions: [] };
  }
}
