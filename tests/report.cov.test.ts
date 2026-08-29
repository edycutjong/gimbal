import { describe, it, expect } from 'vitest';
import { buildReport, missingCitations, arithmeticProblems } from '../src/report/report.ts';
import type { ReportModel } from '../src/report/report.ts';
import type { PersistedBlock, PersistedSession } from '../src/store/session.ts';
import { SESSION_SCHEMA } from '../src/store/session.ts';
import { ALL_OUTCOMES } from '../src/dsp/types.ts';
import { CHANCE } from '../src/optotype/trials.ts';
import { LIMITATIONS_LINES, LIMITATIONS_TEXT, LIMITATIONS_HEADING } from '../src/report/limitations.ts';
import { testCard } from './helpers.ts';

/** A block with every field defaulted to the inert value, so each test states only what it means. */
function block(overrides: Partial<PersistedBlock> = {}): PersistedBlock {
  return {
    index: 0,
    prescribedSeconds: 0,
    deliveredSeconds: 0,
    cyclesAttempted: 0,
    cyclesCredited: 0,
    refusals: { 'too-slow': 0, 'too-fast': 0, 'off-cadence': 0, 'low-confidence': 0, 'face-lost': 0 },
    fHatHz: 0,
    fHatBinWidthHz: 0,
    gaze: { correct: 0, total: 0, chance: CHANCE },
    peakVelocitiesQ: '',
    peakVelocityScale: 50,
    saturatedCycles: 0,
    interruptions: [],
    ...overrides,
  };
}

function session(overrides: Partial<PersistedSession> = {}): PersistedSession {
  return {
    schema: SESSION_SCHEMA,
    id: 's-20260101T090000-01',
    provenance: 'live',
    startedAt: '2026-01-01T09:00:00.000Z',
    cardId: 'card-abc',
    cardHash: 'fnv1a:0000000000000000',
    card: testCard(),
    device: {
      userAgent: 'test-agent',
      cameraLabel: 'Integrated Camera',
      resolution: '640x480',
      medianFps: 29.7,
      sigHash: 'fnv1a:1111111111111111',
    },
    blocks: [],
    symptom: { baseline: 2, gates: [{ afterBlock: 0, rating: 3, ruling: 'continue' }], final: 4 },
    totals: { prescribedSeconds: 0, deliveredSeconds: 0, ratio: 0 },
    appVersion: '1.3.0',
    methodsRev: 'methods-7',
    ...overrides,
  };
}

/**
 * A two-block session that is arithmetically self-consistent: block 0 carries the
 * whole dose, block 1 was interrupted before it delivered anything.
 */
function consistentSession(overrides: Partial<PersistedSession> = {}): PersistedSession {
  return session({
    blocks: [
      block({
        index: 0,
        prescribedSeconds: 120,
        deliveredSeconds: 96,
        cyclesAttempted: 40,
        cyclesCredited: 30,
        refusals: { 'too-slow': 4, 'too-fast': 3, 'off-cadence': 2, 'low-confidence': 1, 'face-lost': 0 },
        fHatHz: 2.05,
        fHatBinWidthHz: 0.0625,
        gaze: { correct: 8, total: 10, chance: CHANCE },
        saturatedCycles: 2,
        interruptions: [
          { kind: 'pause', atSeconds: 30, durationMs: 12000 },
          { kind: 'pause', atSeconds: 60, durationMs: 3400 },
        ],
      }),
      block({
        index: 1,
        prescribedSeconds: 0,
        deliveredSeconds: 0,
        saturatedCycles: 1,
        interruptions: [{ kind: 'interrupt', atSeconds: 5, durationMs: 0 }],
      }),
    ],
    totals: { prescribedSeconds: 120, deliveredSeconds: 96, ratio: 0.8 },
    ...overrides,
  });
}

describe('buildReport — prescription', () => {
  it('renders all seven prescribed criteria with the card values and carries every source through', () => {
    const m = buildReport(session());
    expect(m.prescription.map((c) => [c.label, c.value])).toEqual([
      ['Frequency band', '1.7–2.3 Hz'],
      ['Peak velocity floor', '150 °/s'],
      ['Peak velocity ceiling', '350 °/s'],
      ['Block length', '120 s'],
      ['Blocks', '3'],
      ['Stop rule: rise over baseline', '3 points'],
      ['Stop rule: absolute ceiling', '7 points'],
    ]);
    for (const c of m.prescription) {
      expect(c.source).toBe('synthetic value for a unit test; not a clinical parameter');
    }
  });

  it('reads the band edges and stop-rule numbers off the card rather than hard-coding them', () => {
    const card = testCard({ bandLo: 1.5, bandHi: 2.75, floor: 120, ceiling: 400, blockSeconds: 90, blockCount: 2, baselineRise: 2, absoluteCeiling: 6 });
    const m = buildReport(session({ card }));
    expect(m.prescription.map((c) => c.value)).toEqual([
      '1.5–2.75 Hz',
      '120 °/s',
      '400 °/s',
      '90 s',
      '2',
      '2 points',
      '6 points',
    ]);
  });
});

describe('buildReport — blocks', () => {
  it('copies the identity and provenance fields off the session unchanged', () => {
    const m = buildReport(consistentSession());
    expect(m.startedAt).toBe('2026-01-01T09:00:00.000Z');
    expect(m.cardId).toBe('card-abc');
    expect(m.appVersion).toBe('1.3.0');
    expect(m.methodsRev).toBe('methods-7');
    expect(m.totals).toEqual({ prescribedSeconds: 120, deliveredSeconds: 96, ratio: 0.8 });
    expect(m.symptom).toEqual({ baseline: 2, gates: [{ afterBlock: 0, rating: 3, ruling: 'continue' }], final: 4 });
    expect(m.conditions).toEqual({ medianFps: 29.7, cameraLabel: 'Integrated Camera', resolution: '640x480' });
  });

  it('derives the delivered ratio per block and yields 0 rather than NaN when nothing was prescribed', () => {
    const m = buildReport(consistentSession());
    expect(m.blocks).toHaveLength(2);
    expect(m.blocks[0]?.ratio).toBeCloseTo(0.8, 12);
    // 0 / 0 would be NaN; the guard returns a printable zero instead.
    expect(m.blocks[1]?.prescribedSeconds).toBe(0);
    expect(m.blocks[1]?.ratio).toBe(0);
  });

  it('carries the per-block counts and frequency estimate through untouched', () => {
    const b = buildReport(consistentSession()).blocks[0];
    expect(b?.index).toBe(0);
    expect(b?.prescribedSeconds).toBe(120);
    expect(b?.deliveredSeconds).toBe(96);
    expect(b?.cyclesAttempted).toBe(40);
    expect(b?.cyclesCredited).toBe(30);
    expect(b?.fHatHz).toBe(2.05);
    expect(b?.fHatBinWidthHz).toBe(0.0625);
  });

  it('summarises pauses and flags interrupts per block', () => {
    const m = buildReport(consistentSession());
    // 12000 + 3400 ms rounds to 15 s.
    expect(m.blocks[0]?.pauseNote).toBe('paused 2× (15 s)');
    expect(m.blocks[0]?.interrupted).toBe(false);
    expect(m.blocks[1]?.pauseNote).toBeNull();
    expect(m.blocks[1]?.interrupted).toBe(true);
  });

  it('derives the binomial p on render from the stored tally', () => {
    const m = buildReport(consistentSession());
    const g = m.blocks[0]?.gaze;
    expect(g?.correct).toBe(8);
    expect(g?.total).toBe(10);
    expect(g?.chance).toBe(0.25);
    // P(X >= 8 | n = 10, p = 0.25) ~ 4.16e-4.
    expect(g?.binomialP).toBeCloseTo(0.00041580200195, 10);
    expect(g?.demonstrated).toBe(true);
  });

  it('reports p = 1 and "not demonstrated" for a block with no trials', () => {
    const g = buildReport(consistentSession()).blocks[1]?.gaze;
    expect(g?.total).toBe(0);
    expect(g?.binomialP).toBe(1);
    expect(g?.demonstrated).toBe(false);
  });

  it('computes the printed p against the STORED chance while demonstration always uses 25 %', () => {
    const s = consistentSession();
    // A 4AFC tally recorded against a two-alternative chance rate: 8/10 clears the
    // 0.05 cut at p = 0.25 but not at p = 0.5, and the two figures must not agree.
    (s.blocks[0] as PersistedBlock).gaze = { correct: 8, total: 10, chance: 0.5 };
    const g = buildReport(s).blocks[0]?.gaze;
    expect(g?.chance).toBe(0.5);
    expect(g?.binomialP).toBeCloseTo(56 / 1024, 10);
    expect(g?.binomialP as number).toBeGreaterThan(0.05);
    expect(g?.demonstrated).toBe(true);
  });

  it('sums saturated cycles across every block', () => {
    expect(buildReport(consistentSession()).saturatedCycles).toBe(3);
    expect(buildReport(session()).saturatedCycles).toBe(0);
  });
});

describe('buildReport — outcome histogram', () => {
  it('emits six rows in ALL_OUTCOMES order with counts and shares over attempted cycles', () => {
    const m = buildReport(consistentSession());
    expect(m.outcomes.map((o) => o.reason)).toEqual([...ALL_OUTCOMES]);
    expect(m.outcomes.map((o) => o.count)).toEqual([30, 4, 3, 2, 1, 0]);
    expect(m.outcomes.reduce((a, o) => a + o.count, 0)).toBe(40);
    expect(m.outcomes[0]?.share).toBeCloseTo(0.75, 12);
    expect(m.outcomes[1]?.share).toBeCloseTo(0.1, 12);
    expect(m.outcomes[5]?.share).toBe(0);
    expect(m.outcomes.reduce((a, o) => a + o.share, 0)).toBeCloseTo(1, 12);
  });

  it('accumulates credits and refusals across blocks', () => {
    const s = consistentSession();
    s.blocks.push(
      block({
        index: 2,
        cyclesAttempted: 5,
        cyclesCredited: 3,
        refusals: { 'too-slow': 0, 'too-fast': 0, 'off-cadence': 0, 'low-confidence': 0, 'face-lost': 2 },
      }),
    );
    const m = buildReport(s);
    expect(m.outcomes.map((o) => o.count)).toEqual([33, 4, 3, 2, 1, 2]);
  });

  it('reports every share as 0 rather than NaN when no cycle was attempted', () => {
    const m = buildReport(session());
    expect(m.outcomes).toHaveLength(6);
    for (const o of m.outcomes) {
      expect(o.count).toBe(0);
      expect(o.share).toBe(0);
    }
  });
});

describe('buildReport — flags', () => {
  it('marks audioOff only when the stored flag is exactly true', () => {
    expect(buildReport(session({ audioOff: true })).audioOff).toBe(true);
    expect(buildReport(session({ audioOff: false })).audioOff).toBe(false);
    expect(buildReport(session()).audioOff).toBe(false);
  });

  it('marks isExample only for example provenance', () => {
    expect(buildReport(session({ provenance: 'example' })).isExample).toBe(true);
    expect(buildReport(session({ provenance: 'live' })).isExample).toBe(false);
  });
});

describe('missingCitations', () => {
  it('returns nothing when every criterion carries a source', () => {
    expect(missingCitations(buildReport(session()))).toEqual([]);
  });

  it('names a criterion whose source is the empty string', () => {
    const m = buildReport(session());
    (m.prescription[0] as { source: string }).source = '';
    expect(missingCitations(m)).toEqual(['Frequency band']);
  });

  it('names a criterion whose source is only whitespace', () => {
    const m = buildReport(session());
    (m.prescription[3] as { source: string }).source = ' \n\t ';
    expect(missingCitations(m)).toEqual(['Block length']);
  });

  it('names every uncited criterion, in prescription order', () => {
    const m = buildReport(session());
    (m.prescription[6] as { source: string }).source = '   ';
    (m.prescription[1] as { source: string }).source = '';
    expect(missingCitations(m)).toEqual(['Peak velocity floor', 'Stop rule: absolute ceiling']);
  });
});

describe('arithmeticProblems', () => {
  it('finds nothing wrong with a self-consistent session', () => {
    expect(arithmeticProblems(buildReport(consistentSession()))).toEqual([]);
  });

  it('finds nothing wrong with an empty session and skips the ratio identity when nothing was prescribed', () => {
    const m = buildReport(session());
    expect(m.totals.prescribedSeconds).toBe(0);
    expect(arithmeticProblems(m)).toEqual([]);
  });

  it('tolerates rounding of up to 0.05 s in the delivered and prescribed sums', () => {
    const m = buildReport(consistentSession());
    m.totals.deliveredSeconds = 96.04;
    m.totals.prescribedSeconds = 119.96;
    m.totals.ratio = 96.04 / 119.96;
    expect(arithmeticProblems(m)).toEqual([]);
  });

  it('flags delivered seconds that do not sum to the session total', () => {
    const m = buildReport(consistentSession());
    m.totals.deliveredSeconds = 96.06;
    m.totals.ratio = 96.06 / 120;
    expect(arithmeticProblems(m)).toEqual(['block delivered seconds do not sum to the session total']);
  });

  it('flags prescribed seconds that do not sum to the session total', () => {
    const m = buildReport(consistentSession());
    m.totals.prescribedSeconds = 240;
    m.totals.ratio = 96 / 240;
    expect(arithmeticProblems(m)).toEqual(['block prescribed seconds do not sum to the session total']);
  });

  it('flags a histogram whose credited count disagrees with the blocks', () => {
    const m = buildReport(consistentSession());
    (m.outcomes[0] as { count: number }).count = 29;
    expect(arithmeticProblems(m)).toEqual([
      'credited cycles disagree between the histogram and the blocks',
      'refusal counts do not sum to attempted minus credited',
    ]);
  });

  it('flags refusal counts that do not close the attempted total', () => {
    const m = buildReport(consistentSession());
    (m.outcomes[1] as { count: number }).count = 5;
    expect(arithmeticProblems(m)).toEqual(['refusal counts do not sum to attempted minus credited']);
  });

  it('treats a histogram with no ok row as zero credited cycles', () => {
    const m = buildReport(consistentSession());
    m.outcomes = m.outcomes.filter((o) => o.reason !== 'ok');
    expect(arithmeticProblems(m)).toEqual([
      'credited cycles disagree between the histogram and the blocks',
      'refusal counts do not sum to attempted minus credited',
    ]);
  });

  it('flags a stored ratio that does not match delivered over prescribed', () => {
    const m = buildReport(consistentSession());
    m.totals.ratio = 0.81;
    expect(arithmeticProblems(m)).toEqual(['the delivered ratio does not match the totals']);
  });

  it('tolerates a stored ratio within half a percentage point', () => {
    const m = buildReport(consistentSession());
    m.totals.ratio = 0.804;
    expect(arithmeticProblems(m)).toEqual([]);
  });

  it('flags a block whose gaze correct count exceeds its total, naming the 1-based block', () => {
    const m = buildReport(consistentSession());
    (m.blocks[1] as { gaze: { correct: number } }).gaze.correct = 3;
    expect(arithmeticProblems(m)).toEqual(['block 2: gaze correct exceeds gaze total']);
  });

  it('flags a block whose gaze chance is not the 4AFC rate', () => {
    const m = buildReport(consistentSession());
    (m.blocks[0] as { gaze: { chance: number } }).gaze.chance = 0.5;
    expect(arithmeticProblems(m)).toEqual(['block 1: gaze chance is not 25 %']);
    expect(CHANCE).toBe(0.25);
  });

  it('reports every broken identity at once', () => {
    const m = buildReport(consistentSession());
    m.totals = { prescribedSeconds: 240, deliveredSeconds: 50, ratio: 0.9 };
    (m.outcomes[0] as { count: number }).count = 1;
    const g = (m.blocks[0] as { gaze: { correct: number; chance: number } }).gaze;
    g.correct = 99;
    g.chance = 0.1;
    expect(arithmeticProblems(m)).toEqual([
      'block delivered seconds do not sum to the session total',
      'block prescribed seconds do not sum to the session total',
      'credited cycles disagree between the histogram and the blocks',
      'refusal counts do not sum to attempted minus credited',
      'the delivered ratio does not match the totals',
      'block 1: gaze correct exceeds gaze total',
      'block 1: gaze chance is not 25 %',
    ]);
  });

  it('is a pure read over the model', () => {
    const m: ReportModel = buildReport(consistentSession());
    const before = JSON.stringify(m);
    arithmeticProblems(m);
    missingCitations(m);
    expect(JSON.stringify(m)).toBe(before);
  });
});

describe('limitations text', () => {
  it('is a non-empty list of single-line, non-blank statements', () => {
    expect(LIMITATIONS_LINES.length).toBe(11);
    for (const line of LIMITATIONS_LINES) {
      expect(line.trim()).toBe(line);
      expect(line.length).toBeGreaterThan(0);
      expect(line).not.toContain('\n');
      expect(line).not.toContain('\r');
    }
  });

  it('joins to newline-separated text that round-trips back to the lines', () => {
    expect(LIMITATIONS_TEXT.split('\n')).toEqual([...LIMITATIONS_LINES]);
    expect(LIMITATIONS_TEXT).toContain(LIMITATIONS_LINES[0] as string);
    expect(LIMITATIONS_TEXT.endsWith(LIMITATIONS_LINES[LIMITATIONS_LINES.length - 1] as string)).toBe(true);
  });

  it('states the refusals the Safety criterion is read against', () => {
    expect(LIMITATIONS_TEXT).toContain('not a diagnosis');
    expect(LIMITATIONS_TEXT).toContain('logMAR');
    expect(LIMITATIONS_TEXT).toContain('does not measure eye movement');
  });

  it('has a heading that names the section', () => {
    expect(LIMITATIONS_HEADING).toBe('What this does not measure');
  });
});
