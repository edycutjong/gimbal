# Demo — what to do, and what to watch for

The whole product is one gesture: **turn your head lazily and watch the counter
refuse you by name.**

## Reproduce, exactly

Open **[gimbal.edycu.dev](https://gimbal.edycu.dev)**, or run it locally:

```bash
npm ci
npm run dev
```

`/` is a page that explains the instrument and replays the refusal as a labelled
illustration. **`/app`** is the instrument itself.

Then:

1. Tick the box confirming a clinician prescribed the exercise.
2. Type the eight numbers from `README.md`.
3. Choose a stage.
4. Allow the camera. Let the 10-second light-and-frame-rate check finish.
5. Start.

**If you have no handout in front of you, open `/app?demo`** and step 2 is
already done. Those eight values announce themselves as an example — a banner
above the form, an `EXAMPLE` chip on each value, and an `EXAMPLE …` source
string that prints on the report — and the route still will not tick step 1 for
you, because that checkbox is an attestation by a human.

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

## The refusal, proved without a camera

You need a webcam to *experience* the refusal. You do not need one to *check* it.

```bash
npm ci
npm run bench
```

Needs **Node 22.7 or newer** — pinned in `package.json`'s `engines`, because the
benchmark imports the shipped TypeScript directly rather than a compiled copy.

That drives the **shipped** DSP modules — imported from `src/`, not
re-implemented — with an analytic yaw signal at 2.0 Hz for 60 seconds at two
amplitudes, and asserts the product's central claim before it prints a single
timing:

| Drive | Analytic peak \|ω\| | Cycles segmented | Credited | Delivered dose |
|---|---|---|---|---|
| ±20° — therapeutic | 251.3 °/s, inside `[150, 350]` | 119 | **119** | 59.506 s |
| ±8° — the lazy rep | 100.5 °/s, below the 150 °/s floor | 119 | **0**, all `too-slow` | **0.000 s** |

Same tempo. Same 119 cycles detected — the smaller sweep still clears the
22.5 °/s hysteresis deadband, so they are *refused*, not *lost*. And the dose is
**exactly** zero, not approximately zero.

The frequency estimate lands at **f̂ = 2.0094 Hz** against a 2.0000 Hz drive,
with the bin width of `30/256` = **0.1172 Hz** printed beside it.

Then the timings, against the **33.33 ms** budget one camera frame gets at 30 fps.
Ranges, not single figures — these were observed across repeat runs on one
machine (Apple M1 Max, 10 cores, darwin/arm64, node v22.22.0), and a benchmark
that publishes a spot value it cannot reproduce is publishing noise:

| Stage | p50 | p95 |
|---|---|---|
| Per-frame path — stream → quality → segmenter → gate | ~0.2–0.7 µs | ~3.1–3.6 µs |
| 256-point Hann FFT + parabolic peak (once per 128 frames) | ~8.2–9.3 µs | ~9.8–12.5 µs |
| `scoreCycle`, the credit/refusal gate | ~0.04 µs | ~0.04–0.10 µs |

Those bounds are deliberately loose. They were widened after a repeat sweep put
three runs below a previously-published p95 floor — a range that its own machine
falsifies is worse than no range, even when it errs in the flattering direction.

**The conclusion is robust to all of that scatter: the per-frame path costs
single-digit microseconds at p95 — under 0.02 % of the frame budget, four
orders of magnitude of headroom.** Which is the whole point. The cost of a frame
is `FaceLandmarker` inference; everything in that table is noise beside it, and
the DSP was never going to be the constraint. Run it yourself and you will get
different microseconds and the same conclusion.

**Three things this benchmark is not.** It is not an accuracy figure. It is not
a clinical result. And it is **not the webcam-versus-gyroscope agreement
measurement** this project still owes — that one needs a physical recording,
it does not exist, and no number above may be quoted as though it were.

What makes the timings mean anything is that the correctness gate runs *first*
and the script exits non-zero if any assertion fails. A pipeline that returned
early would post a beautiful p95; it would not segment 119 cycles, credit
exactly the therapeutic ones, and land f̂ inside one bin. Counts are
byte-deterministic across machines (LCG seed `20260823`, stated in the file);
timings are machine-dependent, as any honest benchmark's are.
Add `-- --json` to emit the whole record, machine included.

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

Verified in desktop Chromium only — the end-to-end suite declares one browser project. The layout is responsive down to 360 px, but phone, tablet and other browsers are untested, and no support for them is claimed.

Data lives in one browser profile. There is no cross-device history, no clinician-side view, and no upload path of any kind. Clear it with one button.

Every parameter on this page was typed in by the patient from their clinician. Gimbal did not originate any of them.

No concussion patient has used this, and no clinician has reviewed it. It has been run by the person who built it, on one machine, and by nobody else. Nothing here has been validated against an independent sensor or against any clinical outcome.

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
