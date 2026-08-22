# Demo — what to do, and what to watch for

The whole product is one gesture: **turn your head lazily and watch the counter
refuse you by name.**

## Reproduce, exactly

```bash
npm ci
npm run dev
```

Open the page and:

1. Tick the box confirming a clinician prescribed the exercise.
2. Type the eight numbers from `README.md`.
3. Choose a stage.
4. Allow the camera. Let the 10-second light-and-frame-rate check finish.
5. Start.

**There are no flags.** No `MOCK=`, no `--dry-run`, no `OFFLINE=1`, no
environment variables, no keys, no account, no seeded state. The judged
capability executes for real on the default path or it does not execute at all.
A check in `npm test` fails the build if any of those tokens ever appears in this
file or in `README.md`.

**About a minute, not thirty seconds** — the Prescribe form has eight required
fields and no defaults, and that emptiness is the safety property, not an
oversight.

## The thirty seconds that matter

**Turn your head gently — a lazy, comfortable side-to-side.**

Watch three things happen at once:

1. The committed marker on the ring snaps **visibly off the top** and turns
   slate, not red.
2. The newest cell in the cycle strip is drawn as an **outlined, hatched hole**
   rather than a filled block.
3. The status line names the reason and shows both numbers:
   *"Rep not counted — too slow (below 150 °/s; measured 91 °/s)."*

**And the dose numeral does not move.**

Then speed up into the band. Notice what happens: **nothing.** The tone stops
bending and sits at the band-centre pitch. The ring holds still. The strip grows
one solid cell per cycle at a steady rhythm. And one number climbs.

That silence is the design. In-zone is the resting state; out-of-zone is the only
thing that produces change. There is no celebration, because a reward loop that
encourages *more* of a symptom-limited therapy is clinically wrong.

## Two refusal reasons, not one

`too-slow` proves the velocity is measured and the band enforced.

`low-confidence` proves something different and more important: that the biggest
technical risk in the build — head-pose fidelity at 2 Hz on a cheap webcam — is
answered by **refusing to emit rather than by smoothing**. Cover part of your
face, or dim the room, and the instrument declines to produce a number it cannot
stand behind.

One without the other reads as a bug. Both together read as a policy.

## The privacy claim, verifiable in fifteen seconds

Open DevTools → Network. Clear it. Run a full session.

**Zero requests.** Not "no personal data" — no requests at all. The MediaPipe
WASM runtime and the model bundle are vendored same-origin and committed, and
`connect-src 'self'` in the Content-Security-Policy means the browser would block
an upload even if a future commit tried to add one. The `Permissions-Policy`
header denies the microphone outright: the `AudioContext` is output-only.

## The artifact

Finish a session (or press `Esc`) and you get the page a physical therapist
actually receives: delivered vs prescribed per block, a six-row outcome
histogram, the gaze tally with `chance = 25 %` printed beside it, the symptom
entries with the card's own thresholds, and a **"Why?" disclosure on every
criterion** — forced open by the print stylesheet, because a citation behind a
click is worth nothing on paper.

Press **Print report**. It is one letter page, monochrome-safe, and the
limitations print at body size rather than as fine print.

## If your camera does not work

Every camera-failure state, and the Prescribe screen itself, carries
**`See an example session report`**. It loads the developer's own recorded
sessions — labelled `EXAMPLE` in the table, in the sparkline legend, in a
persistent banner, and stamped in the gutter when printed — and opens the report.
No device reaches a wall.

## What you are NOT looking at

<!-- LIMITATIONS-BODY-START -->
Stage is self-reported. Gimbal measures head kinematics, not posture.

Gimbal does not measure eye movement. It measures whether a Landolt C gap could be resolved during head motion.

No visual-acuity (logMAR) score is reported, and none can be: the browser supplies neither viewing distance nor display pixel pitch.

One exercise only — VORx1, yaw axis. It does not implement return-to-learn or return-to-sport protocols, and it does not attempt to encode the PedsConcussion Living Guideline for Pediatric Concussion.

There is no age gate and no age-specific claim.

Single device, single camera, one stated lighting condition. Sessions recorded on a different camera, browser or resolution are stored but never plotted on the same trend line.

Data lives in one browser profile. There is no cross-device history, no clinician-side view, and no upload path of any kind. Clear it with one button.

Every parameter on this page was typed in by the patient from their clinician. Gimbal did not originate any of them.

This is not a diagnosis and not a clearance. It supplements your clinician; it does not replace them.
<!-- LIMITATIONS-BODY-END -->

## What has not been measured yet

**No bench-agreement figure appears anywhere in this repository, because none has
been recorded.** The intended validation is a phone gyroscope logged rigidly at
the temple while the webcam runs Gimbal, the two traces aligned by
cross-correlation and compared per cycle. Until that recording exists, the honest
statement is that it does not exist — and `README.md`, `METHODS.md` and this file
all say so in the same words.

Two instrument thresholds — `qFloor` and `deadbandFraction` — are likewise
provisional, and `PROVISIONAL_FROM_SPIKE` in `src/dsp/limits.ts` names exactly
which ones.
