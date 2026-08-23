/**
 * The canonical limitations text.
 *
 * This string has FIVE in-repo locations — this one (which the report prints),
 * `LIMITATIONS.md`, the `README.md` block, the `DEMO.md` block, and the block on
 * the landing page in `index.html` — and check U-LIMITS byte-compares this
 * canonical array against the other four. The landing-page copy was added on
 * 2026-08-23 and registered with U-LIMITS in the same change: a visible copy
 * that no check reads is a copy that drifts, and that one is on the most-read
 * surface in the project. The Devpost description is a sixth surface that no
 * in-repo check can reach; it is pasted by hand from `LIMITATIONS.md`.
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
  'Verified in desktop Chromium only — the end-to-end suite declares one browser project. The layout is responsive down to 360 px, but phone, tablet and other browsers are untested, and no support for them is claimed.',
  'Data lives in one browser profile. There is no cross-device history, no clinician-side view, and no upload path of any kind. Clear it with one button.',
  'Every parameter on this page was typed in by the patient from their clinician. Gimbal did not originate any of them.',
  'No concussion patient has used this, and no clinician has reviewed it. It has been run by the person who built it, on one machine, and by nobody else. Nothing here has been validated against an independent sensor or against any clinical outcome.',
  'This is not a diagnosis and not a clearance. It supplements your clinician; it does not replace them.',
];

export const LIMITATIONS_TEXT = LIMITATIONS_LINES.join('\n');

export const LIMITATIONS_HEADING = 'What this does not measure';
