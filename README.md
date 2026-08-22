<div align="center">

# Gimbal

**A webcam dose meter that proves you actually did your prescribed vestibular rehab at therapeutic velocity.**

*No LLM. No server. No account. No upload path. On purpose.*

**[https://gimbal.edycu.dev](https://gimbal.edycu.dev)**

</div>

---

Six weeks after the collision, Maya still cannot turn her head to check a blind
spot without the room sliding sideways — and the exercise that would fix that is
a folded paper handout she has been doing at half speed, every day, for nothing.

*(Maya is a composite of the patient this is built for, not a real named
individual. No testimonial, quote, or record in this project is attributed to a
real person.)*

## The problem, in three sentences

Gaze-stabilization exercise is prescribed with **parameters** — head frequency,
duration, repetitions per day — exactly like a drug. The clinic measures none of
them at home; the only instrument is the question *"how did the home exercises
go?"*, answered from memory, in minutes-claimed. **Every tool in this space
watches, asks, or chats. Nothing measures the delivered dose of the prescribed
treatment.**

## What Gimbal does

It turns a laptop webcam into a **dosimeter for a prescribed exercise**. It does
not decide the therapy. It measures whether the therapy was delivered.

| Stage | What happens |
|---|---|
| **Prescription in** | The patient types their clinician's parameters into a protocol card. Eight required numeric fields, **no defaults, no presets, no sample card on screen.** Gimbal has no path to originate a prescription. |
| **Measure** | `FaceLandmarker` at ~30 Hz → yaw in degrees on the camera's own frame clock → central-difference angular velocity → cycle segmentation → bias-corrected peak \|ω\| per cycle |
| **Coach, eyes-free** | A Web Audio click train sets tempo; one oscillator's pitch bends continuously as peak velocity leaves the prescribed band |
| **Verify gaze without measuring gaze** | A Landolt C re-randomises every 2.5–5.0 s; the patient answers its gap orientation with an arrow key, during motion |
| **Refuse** | Cycles outside the band, off cadence, or below the tracking-confidence floor are **credited zero** and painted as a gap with a named reason |
| **Gate** | A 0–10 symptom rating at every block boundary runs a pure stop-rule function against the session's own baseline |
| **Report out** | One printable page: delivered vs prescribed per block, refusal histogram, gaze tally, symptom entries, a "Why?" citation on every criterion |

**The product is the refusal.** A dose meter that credits everything is a
stopwatch.

## Try it in about a minute

Open **[gimbal.edycu.dev](https://gimbal.edycu.dev)** — nothing to install.

Or run it locally:

```bash
npm ci
npm run dev
```

Either way:

1. Tick the box confirming a clinician prescribed the exercise.
2. Type the eight numbers below.
3. Choose a stage.
4. Allow the camera and let the 10-second light-and-frame-rate check run.
5. Start, and turn your head from side to side.

**Turn your head lazily and watch the counter refuse you by name inside thirty
seconds.** That is the whole product in one gesture.

### The eight numbers, for evaluation only

These are **numbers a clinician would have written**, supplied here so you have
something to type. They are **not a recommendation, not a default, and they do
not exist anywhere in the application** — the app ships zero defaults and zero
presets, which is what makes "Gimbal cannot originate a prescription" a
structural property rather than a claim.

| Field | Value |
|---|---|
| Frequency band, low | `1.7` Hz |
| Frequency band, high | `2.3` Hz |
| Peak velocity floor | `150` °/s |
| Peak velocity ceiling | `350` °/s |
| Block length | `60` sec |
| Blocks | `1` |
| Stop rule: rise over baseline | `3` points |
| Stop rule: absolute ceiling | `7` points |

*Block length 60 and one block make the evaluation run a minute rather than six.
Both are card fields, so choosing them is exactly the act the product is built
around.*

**No flags. No environment variables. No keys. No account.** The judged
capability executes for real on the default path, or it does not execute at all.

## Verify the engineering

```bash
npm test            # unit tests against analytic ground truth + the mechanical source checks
npm run check:build # builds the production bundle, then greps it
```

`npm test` runs **76** automated tests plus seven mechanical source checks. It is
**fully offline** and reads only files committed in this repo — no network, no
build artifact, no file outside the clone. A check that passes vacuously on a
clean clone is worse than no check, so any that would have are in
`check:build`/`check:deploy` instead.

Highlights of what those tests actually claim:

- The hand-written 256-point Hann FFT recovers `sin(2π·2·t)` at 30 fps into the
  bin containing 2.0 Hz, with a bin width of exactly `30/256` = **0.1172 Hz**,
  and returns **no peak** — not `NaN`, not 0 Hz — for an all-zero input.
- A 3-point central difference under-reports peak velocity by exactly
  `1 − sin(2πfT)/(2πfT)` = **2.90 %** at 2 Hz / 30 fps, and the published
  correction is **×1.0299**. The same identity holds at 1.0, 1.5 and 2.5 Hz, and
  a test asserts the correction is applied **once, not twice**.
- `dt` is used **as measured**, never assumed to be 33.3 ms.
- `scoreCycle` reaches all six outcomes, credits boundary equality at both band
  edges, and has deterministic reason precedence. **A test greps the module and
  fails if any numeral other than `0` and `1000` appears in it** — which is how
  "every clinical threshold comes from the card" is checked rather than
  believed.
- `evaluateStopRule` partitions the whole 0–10 × 0–10 integer grid with no gap
  and no overlap, and the only constant in the function is zero.
- Int16 quantisation at scale 50 round-trips within **0.01 °/s**, half an LSB,
  and a velocity beyond ±655.34 °/s is **refused, never clipped**.

## Architecture, in one paragraph

One 30 Hz measurement loop, six screens, and one printable page, running entirely
inside a browser tab with **one runtime dependency and zero network requests
after page load**. There is no backend because a backend would falsify the
product's central safety claim. There is no LLM because the output is a *count*,
and a count has no use for a generative model — while an LLM would import the
entire hallucination surface into a submission judged on safety. There is no
framework because the only code path being judged is a hot loop, and a re-render
model is a hazard inside it.

```
src/
├─ capture/   camera.ts · landmarker.ts · pose.ts
├─ dsp/       ring · smooth · velocity · fft · segment · quality · score · limits · stream
├─ audio/     scheduler.ts
├─ optotype/  landoltC.ts · trials.ts
├─ protocol/  card.ts · stopRule.ts
├─ session/   blockRunner.ts · dose.ts
├─ store/     local · session · ledger · deviceSignature · exampleLedger · export
├─ report/    report.ts · limitations.ts
├─ styles/    tokens · themes · screen · print
└─ ui/        screens/* · dial · strip · sparkline · live · copy · dom
```

**Dependencies: 1 runtime (`@mediapipe/tasks-vision`), 4 dev (`vite`,
`typescript`, `vitest`, `@playwright/test`).** Greppable in `package.json`,
which is how you check it. `npm audit` reports zero vulnerabilities.

The MediaPipe WASM runtime and the `face_landmarker` model bundle are **vendored
same-origin** under `/model/`, content-addressed, and committed. Nothing is
fetched from a CDN — which is what makes the DevTools-Network privacy proof
honest rather than a stunt. The bundle is single-threaded WASM, so no COOP/COEP
cross-origin isolation is required and the app runs from a plain static host.

`METHODS.md` has the full derivations: the bias correction, the sampling floor,
the tracking-quality score, and where each stops being trustworthy.

## Accessibility is the design constraint, not a checklist bolted to it

The population this is built for has **photophobia, screen sensitivity,
motion-provoked dizziness, headache and cognitive fatigue.**

The single fact that determines the whole interface: **during the exercise the
patient's eyes are on the optotype and cannot reach a dial.** So the coaching
signal had to be audio — which means **the primary feedback loop of this product
works with the screen off.** That is not a feature bolted on for an
accessibility score; the exercise demanded it.

- **Dark-first with a Dim (deep-photophobia) theme**, and a warm-paper Light
  theme. Three palettes, 33 token/surface pairs, **every contrast ratio computed
  and verified** — all text ≥ 4.5:1, all state and boundary colours ≥ 3:1.
- **The two zone-state colours are deliberately near-iso-luminant** (1.26:1 in
  Dark, 1.06:1 in Dim, 1.15:1 in Light). The zone flips many times per block; if
  the two states differed sharply in luminance the ring would strobe in the
  peripheral field of a photophobic, dizziness-prone user. It also forces the
  redundant encodings to be real: state is carried by geometry and audio, and
  colour is the third cue, never the first.
- **Nothing flashes. Anywhere.** WCAG 2.3.1's three-flash threshold is treated as
  a hard architectural constraint, and no state in the app has a flash as its
  only representation.
- **A 15 px absolute type floor**, with the limitations and the citations at
  **body size** — because burying a caveat in small type is the opposite of what
  a safety criterion rewards.
- **No modals, no toasts, no tooltips, no timeouts** outside the therapy itself,
  and the app never auto-advances. Transient UI punishes a slow reader.
- **A refusal is never red, never a flash, never a shake.** Red says *you did
  something wrong*; half of all refusals are instrument conditions, and telling a
  patient who slowed down because they got dizzy that they made an *error* is
  clinically backwards.
- **`Esc` ends the session instantly**, with no confirmation and no penalty,
  because ending on symptom provocation is the clinically correct behaviour.
- **Two live regions with strict discipline** — a polite `role="status"` that
  carries the ring's information in words (the ring itself is `aria-hidden`; an
  SVG changing 30 times a second is hostile to assistive technology), and an
  assertive `role="alert"` reserved for exactly two events.
- **No `outline: none` exists in `src/styles/`**, and a check in `npm test`
  fails the build if one appears.

**The honest boundary:** every screen is fully keyboard-operable, and on the
block screen the keyboard is the only input. Screen-reader operation covers every
screen except the block screen, whose task is a visual discrimination — that is a
stated limitation, not an omission. And the prescribed exercise itself requires
head movement and functional vision. Gimbal does not claim to serve a user who
cannot perform the exercise it measures.

## What this does not measure

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

## Status

This is a hackathon build in progress. Two things a reader should know before
drawing conclusions from it:

- **Two instrument thresholds are provisional.** `qFloor` and
  `deadbandFraction` are meant to be set from a tracking-spike recording that
  separates deliberately-good from deliberately-degraded conditions. That
  recording does not exist yet, the shipped values are placeholders, and
  `PROVISIONAL_FROM_SPIKE` in `src/dsp/limits.ts` names exactly which ones.
- **The bench validation against an independent sensor has not been recorded.**
  The intended comparison is a phone gyroscope logged at the temple while the
  webcam runs Gimbal, aligned by cross-correlation. **No agreement figure is
  quoted anywhere in this repository, because none has been measured.** When it
  exists it will be stated as a bench validation — single subject, one camera,
  one lighting condition — never as a study.

## Deliberate non-features

Each absence is load-bearing.

| Not built | Why the absence is strategic |
|---|---|
| **Any LLM, anywhere** — including "just for the report summary" | Removes the entire hallucination surface. One call to summarise a paragraph nobody asked for gives it all back. `grep -ri "openai\|anthropic\|gemini\|llm" src/` returns nothing. |
| **Eye / gaze / iris tracking** | Webcam iris tracking during 250 °/s head motion is not a solved problem on commodity hardware, and any error is confounded with the rotation being measured. The forced-choice Landolt C **is** the answer: it proves functional gaze without measuring it. |
| **Diagnosis, clearance, prescription origination** | Gimbal reports a delivered dose against a prescribed one and nothing else. |
| **Any server, account, database, PT portal, or "email my PT"** | Each falsifies the on-device claim. A share link is an upload with better manners. |
| **An exercise library** | One exercise done devastatingly beats six done adequately, and each extra one multiplies the DSP, citation and QA surface. |
| **Streaks, badges, XP, daily-goal confetti** | Incentivising *more* of a symptom-limited therapy is clinically wrong. |
| **Posture / standing detection** | Unverifiable from a face mesh. Building it means claiming it. Stage is self-attested and the report says so. |
| **Any acuity (logMAR) score** | Requires viewing distance and display pixel pitch; the browser supplies neither. |
| **Calibration wizard / camera intrinsics / PnP** | Angular velocity is a *difference* of rotations, so constant bias differentiates away to first order. |
| **Signed exports, blockchain receipts** | Ceremony that proves nothing. The real anti-gaming property is structural: **the only way to fake the dose is to perform the therapy.** |

## Licence

MIT — see `LICENSE`. Third-party attribution is in `NOTICE.md`.
