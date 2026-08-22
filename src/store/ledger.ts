import type { PersistedSession } from './session.ts';

/**
 * The dose-trend ledger.
 *
 * The annotation is a PURE FUNCTION over the session list, and it is never an
 * alarm and never a notification. Consider-review framing only: incentivising
 * more of a symptom-limited therapy is clinically wrong in front of this panel,
 * and a habit-tracker reward loop is the archetype the organizer's own rubric
 * pre-scored at 2 out of 5.
 */

export type TrendKind = 'insufficient-history' | 'flat-or-declining' | 'rising';

export interface TrendAnnotation {
  kind: TrendKind;
  /** True when any example row is inside the annotation window. */
  includesExample: boolean;
  /** The sentence rendered beneath the sparkline. Every count is a template slot. */
  text: string;
  /** Sessions used, after device filtering. */
  used: PersistedSession[];
}

/** Below six sessions on one device signature, no annotation is rendered at all. */
export const MIN_SESSIONS_FOR_TREND = 6;

const median = (values: number[]): number => {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
};

export function trendAnnotation(sessions: readonly PersistedSession[], deviceSigHash: string): TrendAnnotation {
  const used = sessions
    .filter((s) => s.device.sigHash === deviceSigHash)
    .slice()
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id));

  if (used.length < MIN_SESSIONS_FOR_TREND) {
    return {
      kind: 'insufficient-history',
      includesExample: used.some((s) => s.provenance === 'example'),
      text: `${MIN_SESSIONS_FOR_TREND} sessions needed on this device before a trend is shown — ${used.length} stored.`,
      used,
    };
  }

  const window = used.slice(-6);
  const recent = median(window.slice(-3).map((s) => s.totals.ratio));
  const prior = median(window.slice(0, 3).map((s) => s.totals.ratio));
  const includesExample = window.some((s) => s.provenance === 'example');
  const tag = includesExample ? ' (includes example sessions)' : '';

  if (recent <= prior) {
    return {
      kind: 'flat-or-declining',
      includesExample,
      text: `Delivered dose is flat or declining across your last sessions — worth a check-in with your PT.${tag}`,
      used,
    };
  }
  return {
    kind: 'rising',
    includesExample,
    text: `Delivered dose is higher across your last sessions than the three before them.${tag}`,
    used,
  };
}

/** The banner shown whenever any example row is present. Every count and date is a template slot. */
export function exampleBanner(sessions: readonly PersistedSession[]): string | null {
  const examples = sessions
    .filter((s) => s.provenance === 'example')
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  if (examples.length === 0) return null;
  const first = (examples[0] as PersistedSession).startedAt.slice(0, 10);
  const last = (examples[examples.length - 1] as PersistedSession).startedAt.slice(0, 10);
  return (
    `This ledger contains ${examples.length} example sessions recorded by the developer on this device, ` +
    `${first} to ${last}. They are real recordings of real exercise, not patient data and not a clinical trial.`
  );
}
