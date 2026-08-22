/**
 * The canonical limitations text.
 *
 * This string has FOUR in-repo copies — this one (which the report prints),
 * `LIMITATIONS.md`, the `README.md` block and the `DEMO.md` block — and check
 * U-LIMITS byte-compares all four. The Devpost description is a fifth surface
 * that no in-repo check can read; it is pasted by hand from `LIMITATIONS.md`.
 *
 * It prints at BODY SIZE, never as small print. Burying a limitation in small
 * type is the opposite of what the Safety criterion rewards.
 */
export const LIMITATIONS_LINES: readonly string[] = [
  'Stage is self-reported. Gimbal measures head kinematics, not posture.',
  'Gimbal does not measure eye movement. It measures whether a Landolt C gap could be resolved during head motion.',
  'No visual-acuity (logMAR) score is reported, and none can be: the browser supplies neither viewing distance nor display pixel pitch.',
  'One exercise only — VORx1, yaw axis. It does not implement return-to-learn or return-to-sport protocols, and it does not attempt to encode the PedsConcussion Living Guideline for Pediatric Concussion.',
  'There is no age gate and no age-specific claim.',
  'Single device, single camera, one stated lighting condition. Sessions recorded on a different camera, browser or resolution are stored but never plotted on the same trend line.',
  'Data lives in one browser profile. There is no cross-device history, no clinician-side view, and no upload path of any kind. Clear it with one button.',
  'Every parameter on this page was typed in by the patient from their clinician. Gimbal did not originate any of them.',
  'This is not a diagnosis and not a clearance. It supplements your clinician; it does not replace them.',
];

export const LIMITATIONS_TEXT = LIMITATIONS_LINES.join('\n');

export const LIMITATIONS_HEADING = 'What this does not measure';
