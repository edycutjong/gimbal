import type { Cycle, CycleOutcome } from '../dsp/types.ts';
import type { ProtocolCard } from '../protocol/card.ts';

/**
 * Every patient-facing string.
 *
 * COPY RULES, applied throughout: second person, present tense, no exclamation
 * marks, no encouragement. "Rep not counted — too slow." Not "Oops! Let's try
 * that again". Never a bare number without its unit and its origin. Every
 * clinical noun traces to the card's `source` string — the interface has no
 * clinical vocabulary of its own. And no shipped string hard-codes a count:
 * counts are template slots filled at render from what was actually measured.
 *
 * Written for cognitive fatigue: one idea per sentence, no sentence over 22
 * words, no nested clauses on the block screen at all. Sentence case
 * throughout, never ALL CAPS — all-caps destroys word-shape cues and is
 * measurably slower to read.
 */

/** The five refusal templates. Every bracketed value is card-sourced or measured. */
export function refusalSentence(reason: CycleOutcome, cycle: Cycle, card: ProtocolCard): string {
  const measured = Number.isFinite(cycle.peakOmega) ? cycle.peakOmega.toFixed(0) : '—';
  switch (reason) {
    case 'too-slow':
      return `Rep not counted — too slow (below ${card.peakVelocityFloor.value} °/s; measured ${measured} °/s).`;
    case 'too-fast':
      return `Rep not counted — too fast (above ${card.peakVelocityCeiling.value} °/s; measured ${measured} °/s).`;
    case 'off-cadence':
      return 'Rep not counted — off the pacing tempo.';
    case 'low-confidence':
      return 'Rep not counted — tracking unreliable. Try more light.';
    case 'face-lost':
      return 'Rep not counted — your face left the frame.';
    case 'ok':
      return '';
  }
}

/** The short phrase the live region coalesces on. */
export function refusalPhrase(reason: CycleOutcome): string {
  switch (reason) {
    case 'too-slow':
      return 'too slow';
    case 'too-fast':
      return 'too fast';
    case 'off-cadence':
      return 'off the pacing tempo';
    case 'low-confidence':
      return 'tracking unreliable';
    case 'face-lost':
      return 'your face left the frame';
    case 'ok':
      return '';
  }
}

export const REASON_LABELS: Record<CycleOutcome, string> = {
  ok: 'Credited',
  'too-slow': 'Too slow',
  'too-fast': 'Too fast',
  'off-cadence': 'Off cadence',
  'low-confidence': 'Tracking unreliable',
  'face-lost': 'Face left the frame',
};

/** The gate copy. The Safety criterion, rendered. */
export const GATE_COPY = [
  'Gimbal is for people whose clinician prescribed gaze-stabilization exercises.',
  'It does not choose your exercise, decide your parameters, diagnose anything, or replace your clinician.',
  'It measures whether the exercise you were given was actually delivered.',
];

export const GATE_CHECKBOX_LABEL =
  'My clinician prescribed these exercises and I am entering their parameters.';

export const CAMERA_PRIVACY_COPY =
  'Video is processed in this browser tab and discarded frame by frame. No frames are stored, uploaded, or sent anywhere. Nothing leaves this device.';

export const EXAMPLE_LOADER_LABEL =
  'Load example ledger — sessions I recorded myself while building this. Not patient data.';

export const EXAMPLE_REPORT_LABEL = 'See an example session report';

export const AUDIO_OFF_REPORT_LINE =
  'coached without audio — zone feedback was visual only, which is degraded because reading the ring costs a glance away from the target.';

export const OPTOTYPE_SIZER_COPY = 'Make this as small as you can still read comfortably.';

export const OPTOTYPE_NO_ACUITY_COPY =
  'This sets a comfortable target size. Gimbal does not measure or report visual acuity.';

export const FPS_FIX_COPY = 'Add a lamp or face a window.';

export const GAZE_HONESTY_LINE =
  'Gimbal does not measure eye movement. This is a forced-choice identification task performed during head motion.';

export const GAZE_CHANCE_LINE = '4 response options; chance = 25 %.';

export const REPORT_FOOTER =
  'Not a diagnostic device. All processing happened in this browser; no data left this device.';

/** `{X} / {Y} min in zone` — a template, never a hard-coded count. */
export function doseReadout(deliveredSeconds: number, prescribedSeconds: number): string {
  return `${(deliveredSeconds / 60).toFixed(1)} / ${(prescribedSeconds / 60).toFixed(1)} min in zone`;
}

/** "delivered {X} of the prescribed {Y} minutes" — the report's own template. */
export function deliveredSentence(deliveredSeconds: number, prescribedSeconds: number): string {
  return `delivered ${(deliveredSeconds / 60).toFixed(1)} of the prescribed ${(prescribedSeconds / 60).toFixed(1)} minutes`;
}

export function blockProgress(index: number, total: number, remainingMs: number): string {
  const s = Math.max(0, Math.round(remainingMs / 1000));
  const mm = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, '0');
  return `Block ${index + 1} of ${total} · ${mm}:${ss} left`;
}
