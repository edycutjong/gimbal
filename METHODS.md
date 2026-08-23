# Methods

How Gimbal turns webcam pixels into a delivered-dose number, and where that
number stops being trustworthy. Every signal-processing figure below is derived
inline from arithmetic that is shown. **No clinical numeric value is chosen
anywhere in this system**: every threshold the product enforces lives on the
protocol card with a mandatory `source` string, typed in by the patient from
their clinician's handout.

---

## 1. What is measured

One quantity: **the rigid orientation of the skull relative to the camera**,
sampled at a rate the prescribed band requires, during oscillation at the
prescribed frequency. Not eye position, not facial expression, not body pose,
not identity, not metric depth.

`FaceLandmarker` is configured with `outputFacialTransformationMatrixes: true`
and `outputFaceBlendshapes: false`. The task fits the canonical face model to
the detected landmarks and returns a 4×4 transform whose upper-left 3×3 block is
the rotation — already solved, already temporally coherent in VIDEO mode, with
no camera intrinsics, no chessboard, no PnP solve and no OpenCV.

**Recorded before anyone finds it:** the 478-landmark mesh includes 10 iris
landmarks (indices 468–477). Gimbal reads none of them. Iris tracking is refused
by design and the code path that would use them does not exist. Availability is
not usage.

### 1.1 Angle extraction, and why the ordering is a measurement decision

Angles are intrinsic Tait–Bryan angles in **Y–X–Z order, yaw outermost**:

```
pitch θ = asin( −R[1][2] )
yaw   ψ = atan2( R[0][2], R[2][2] )
```

The singularity of this ordering — gimbal lock, which is where the codename
comes from — sits at **pitch = ±90°**, a head tipped fully back, which is
unreachable during seated VORx1 and would be refused by the plausibility term in
any case. A pitch-outermost ordering would instead put the singularity at
**yaw = ±90°**, inside the range the exercise actually sweeps.

**The mirror.** The preview is mirrored for the user (`transform: scaleX(-1)`),
which inverts the sign of yaw. The correction lives at exactly one place in
`src/capture/pose.ts`, as the constant `MIRROR_SIGN`, and a unit test asserts
that a synthesised rightward head turn yields positive yaw and does not
double-invert. Row/column-major layout and handedness of the MediaPipe matrix
are pinned by that test rather than assumed from documentation.

**Honestly noted:** the bench comparison uses |ω|, so it does **not** catch an
inverted mirror sign. The `pose.ts` sign test is the only guard against that
failure, which is why it is called out here rather than buried in a suite.

---

## 2. The published bias correction

The velocity path is: smooth the **angle** series with a symmetric 5-point
Savitzky–Golay filter, differentiate with a **3-point central difference on
measured `dt`**, then correct that operator's bias explicitly.

The rule that generated this ordering: *smooth the quantity that is noisy,
differentiate with the operator whose bias is a closed-form expression, and then
correct that bias.*

A 3-point central difference on a sinusoid of frequency `f` sampled at interval
`T` reports exactly

```
gain = sin(2πfT) / (2πfT)
```

of the true peak. At 2 Hz and 30 fps that is `sin(0.41888)/0.41888` = **0.9710**
— a **2.90 %** under-read, corrected by **×1.0299**.

| f (Hz) | samples/cycle at 30 fps | gain | under-read | correction |
|---|---|---|---|---|
| 1.0 | 30 | 0.9927 | 0.73 % | ×1.0073 |
| 1.5 | 20 | 0.9836 | 1.66 % | ×1.0166 |
| **2.0** | **15** | **0.9710** | **2.90 %** | **×1.0299** |
| 3.0 | 10 | 0.9355 | 6.45 % | ×1.0690 |
| 5.0 | 6 | 0.8270 | 17.3 % | — |

The correction is applied **once**, per cycle, using the median frame interval
over that cycle and the FFT's dominant-frequency estimate. A unit test asserts
the identity at 1.0, 1.5, 2.0 and 2.5 Hz, and asserts that it is not applied
twice.

### 2.1 Alternatives, and why each loses

| Candidate | Attenuation at 2 Hz / 30 fps | Verdict |
|---|---|---|
| 3-point central difference on measured `dt` | 0.9710 → 2.90 % | **Chosen.** Analytic, one line, publishable, correctable. |
| 5-point Savitzky–Golay *derivative* | ≈ 0.904 → 9.6 % | Rejected: three times the bias, for smoothing that belongs upstream. |
| One-Euro filter on ω | adaptive, signal-dependent | Rejected: a filter whose frequency response cannot be written in one line cannot be defended. |
| Butterworth / IIR low-pass on ω | phase lag varying with cutoff | Rejected: group delay would shift peak timing relative to the audio coaching. |
| No filtering | — | Rejected. Landmark jitter differentiates into large spurious spikes — though note the jitter is not removed *silently*: residual spikes are what the kinematic-plausibility term catches. |

### 2.2 Latency, stated rather than hidden

The symmetric 5-point smoother costs 2 frames and the central difference costs
1 more, so ω is reported **3 frames — about 100 ms at 30 fps — behind the head
that produced it**. One sweep at 2 Hz is 250 ms, so the audio coaching still
lands inside the same head turn. Widening the smoothing window changes this
number, which is why it is computed in `src/dsp/stream.ts` rather than asserted.

---

## 3. Frequency estimate

A hand-written **256-point Hann-windowed real FFT** (radix-2) over the ω series,
at 50 % overlap, with parabolic interpolation of the peak bin.

- At 30 fps the window spans **8.53 s** and the bin width is
  `30/256` = **0.1172 Hz**. Every reported `f̂` prints with that resolution
  attached.
- Hann coherent gain is **0.5**, and amplitudes are divided by it.
- An all-zero or DC series returns **no peak**, not `NaN` and not 0 Hz. The
  absence of a dominant frequency and a dominant frequency of zero are different
  statements.

Hand-written rather than imported because it can be unit-tested against
`sin(2π·2·t)`, whose answer is known analytically — and because a claim that has
to be explained to a judge gets built, while a claim that is a research problem
gets bought.

**Non-stationarity, bounded rather than denied.** An 8.53 s window assumes
roughly constant frequency; a patient who speeds up mid-window gets a smeared
`f̂` and therefore a mis-applied gain. The error is second-order and bounded by
construction: the correction spans a few percent across the whole legal band
(2.90 % at 2 Hz, 6.45 % at 3 Hz), so even a badly-estimated `f̂` moves the answer
by single-digit percent.

---

## 4. Cycle segmentation

- A **sweep** is the interval between two consecutive sign changes of ω.
- A **cycle** is **two sweeps** — one full oscillation — and the cycle is the
  credit unit. The prescription is written in frequency, and crediting
  half-oscillations would let a patient bank credit for a one-way turn they
  never returned from.
- Cycles are **non-overlapping** and share their endpoints: the boundary that
  closes one opens the next.
- Zero-crossing detection is **hysteretic**. A sign change registers only once
  |ω| exceeds a deadband expressed as a **fraction of the card's peak-velocity
  floor**, never as an absolute °/s figure — so it scales with the prescription
  instead of being a magic number. Without hysteresis, near-zero jitter at the
  turnaround manufactures dozens of phantom sweeps per second and inflates the
  dose, which attacks the one number the product is about.
- A stall — the head stopped, or tracking dropped out — **abandons** the
  in-progress cycle rather than producing one long cycle spanning the gap.

---

## 5. Tracking quality `q`, computed from observables

**The MediaPipe JS API does not expose a per-detection confidence value.**
`minFaceDetectionConfidence`, `minFacePresenceConfidence` and
`minTrackingConfidence` are thresholds Gimbal *supplies*; they are not readings
it *receives*. A quality score claiming to be "the model's confidence" would be
a fabrication, so `q` is built from four genuinely observable things:

```
q = min(q_presence, q_cadence, q_fit, q_kinematic) ∈ [0, 1]
```

1. **`q_presence`** — binary. A zero-face frame sets `q = 0` and flags the cycle
   `face-lost`. This is the only place the model's internal thresholds surface:
   when presence drops below `minFacePresenceConfidence`, MediaPipe emits
   nothing, and that absence *is* the signal.
2. **`q_cadence`** — the measured inter-frame interval from
   `requestVideoFrameCallback`, normalised against the interval the derived
   sampling floor implies. A frame that arrives late scores below 1. **This term
   is why `getSettings().frameRate` is never used: it reports the requested
   rate, not the achieved one.**
3. **`q_fit`** — the orthonormality residual of the rotation block,
   `‖RᵀR − I‖_F`, normalised. Nine multiply-adds, and it catches a degenerate or
   wildly extrapolated fit that nothing else sees.
4. **`q_kinematic`** — physiological plausibility of the frame's angular
   acceleration against `(2πf)²A` for the prescribed motion. A single-frame
   acceleration several times that is landmark flicker, not a neck. Its effect is
   always **refusal, never correction**.

---

## 6. The credit / refusal gate

```ts
scoreCycle(cycle, card, limits) → { credited, reason, doseSeconds }
```

Six outcomes: `ok` plus **five refusal reasons**. Refused cycles contribute
**exactly 0.000 s** to dose and render as a labelled gap.

| Reason | Test | Where the threshold comes from |
|---|---|---|
| `too-slow` | `ω_peak < card.peakVelocityFloor` | **Card field, mandatory `source`.** |
| `too-fast` | `ω_peak > card.peakVelocityCeiling` **or** `f̂ > maxCycleHz` | Ceiling is a card field; `maxCycleHz` is an **instrument** limit, derived below. |
| `off-cadence` | `1/period` outside `card.frequencyBand` | **Card field, mandatory `source`.** |
| `low-confidence` | `qMin < qFloor`, `sampleCount < nMin`, or a saturated velocity | Engineering thresholds. |
| `face-lost` | any frame in the cycle returned zero faces | Structural. |

Precedence when more than one holds:
**`face-lost` > `low-confidence` > velocity > cadence.** The order runs from "the
instrument could not see", through "the instrument does not trust itself", to
"the measurement is good and the motion missed the prescription" — because
reporting an instrument failure as a patient failure would be the wrong way
round, and half of all refusals in practice are instrument conditions.

**Boundary equality at both band edges is credited.** A documented convention,
not an accident.

`src/dsp/score.ts` contains no numeric literal other than `0` (a refusal's dose
contribution) and `1000` (the ms→s conversion). A unit test greps the module and
fails if any other numeral appears, which is how "every clinical threshold comes
from the card" is *checked* rather than believed.

---

## 7. Instrument limits — derived, and labelled as instrument limits

### 7.1 The measurement-validity ceiling: 3.0 Hz

Two independent arithmetic reasons:

1. At 3.0 Hz and 30 fps a cycle spans **10 samples — exactly `nMin`** — and the
   central-difference correction is already 6.45 %.
2. The sampling rule below returns `F_min(3.0) = 35 fps`, which a 30 fps camera
   cannot deliver.

Cycles above 3.0 Hz are refused `too-fast` **regardless of what the card says**.
This is an instrument limit. The report labels it as one, and it is deliberately
not dressed up as a clinical rule.

### 7.2 The sampling floor

```
F_min(f) = ceil( max( nMin · f , 2πf / 0.5519 ) )      with nMin = 10
```

evaluated at the **upper edge of the card's prescribed band**. The first term is
the samples-per-cycle requirement. The second is the frame rate at which the
central-difference correction reaches 5 %: setting `sin(x)/x = 0.95` gives
`x = 0.5519`, and `x = 2πf/F`.

| band upper edge | `F_min` |
|---|---|
| 1.0 Hz | 12 fps |
| 1.5 Hz | 18 fps |
| 2.0 Hz | 23 fps |
| 2.5 Hz | 29 fps |
| 2.6 Hz | 30 fps |
| 3.0 Hz | 35 fps |

**The floor is a sampling requirement derived from the prescription. Measured
hardware speed determines whether a machine clears it; it never sets it.** A
floor set from your own hardware's speed is marking your own homework.

The cheap consequence, made explicit: a card whose band upper edge exceeds
**2.6 Hz** fails the setup check with a named reason — *"this prescription needs
more than 30 frames per second and this camera cannot supply them"* — rather
than being silently mis-measured.

### 7.3 Two thresholds that are PROVISIONAL

`qFloor` and `deadbandFraction` are meant to be set from a tracking-spike
recording, as the values that separate cycles performed deliberately-well from
cycles performed under deliberately-degraded conditions (dim room, off-axis,
partial occlusion). **That recording does not exist yet.** The shipped values are
placeholders; `PROVISIONAL_FROM_SPIKE` in `src/dsp/limits.ts` names exactly which
ones, and no claim is made that they are calibrated. Setting them from data is
the difference between an integrity feature and a magic number, and this document
will not pretend the difference has been paid for.

---

## 8. Storage and quantisation

Per-cycle peak velocities are stored as **`Int16` at scale 50** — a **±655.34 °/s**
range at **0.02 °/s** resolution — packed and base64-encoded.

**Scale 100 was rejected**: it caps at 327.67 °/s, and a vigorous 2.5 Hz / ±25°
turn reaches `2π·2.5·25` ≈ 393 °/s, which would silently saturate. Any cycle that
*does* saturate increments `saturatedCycles` and is **refused, never clipped** —
a clipped velocity is a wrong number, and a wrong number is worse than no number.
The round-trip unit test's tolerance is 0.01 °/s, half an LSB.

A 6-minute session at 2 Hz holds ~720 cycles → 1.44 KB → ~1.9 KB base64, plus
~1 KB of block summaries and ~0.6 KB for the embedded card ≈ **3.5 KB per
session**. The 100-session cap is therefore ≈ 350 KB against a ~5 MB budget. At
that size, IndexedDB is async machinery for a problem that does not exist.

The card is embedded **in full** in every persisted session *and* hashed
alongside. The embedding makes a past session's verdict reproducible without the
current card — a later edit must never retroactively change what a past session
was scored against — and the hash makes trend-grouping a one-field comparison.
This is the same discipline as storing the exchange rate on the invoice.

---

## 9. Privacy, as an architectural property rather than a policy

There is no backend. Camera frames are processed and discarded frame by frame.

`connect-src 'self'` in the Content-Security-Policy turns "no data leaves the
device" from a promise into a **browser-enforced invariant**: if a future commit
added a `fetch()` to an analytics endpoint, the browser would block it.
`microphone=()` in the Permissions-Policy pre-empts the obvious question — *it
uses audio, is it listening?* — with a header rather than a sentence. The
`AudioContext` is output-only.

**`'wasm-unsafe-eval'` is the only relaxation in the policy.** It is required by
MediaPipe's WASM instantiation, and it is documented here as such rather than
quietly widened to `'unsafe-eval'`.

The WASM runtime and the model bundle are **vendored same-origin** under
`/model/`, with the model content-addressed (`face_landmarker.<sha8>.task`) so a
swapped bundle cannot be cached over silently. Nothing is fetched from a CDN,
which is what makes "zero third-party requests" verifiable in fifteen seconds
with DevTools open rather than aspirational.

The bundle is **single-threaded WASM** — there is no `SharedArrayBuffer`
reference in it — so no COOP/COEP cross-origin isolation is required and the app
runs from a plain static host.

---

## 10. What this does not measure

See `LIMITATIONS.md`, which is the canonical text and is reproduced verbatim on
the printed report.

---

## 11. Sources

**No citation below was written before it was opened.** Every one carries a DOI
or PMID, and every entry says what the source supports **and what it does not** —
because the second half is where a reference list stops being decoration.

Read §11.6 first if you read only one part of this section. It is the list of
things this literature does **not** license, and it is longer than the list of
things it does.

### 11.1 That the problem exists: cervicovestibular rehabilitation is indicated

**[G1]** Patricios JS, Schneider KJ, Dvorak J, et al. *Consensus statement on
concussion in sport: the 6th International Conference on Concussion in Sport —
Amsterdam, October 2022.* Br J Sports Med. 2023;57(11):695–711.
doi:10.1136/bjsports-2023-106898 · PMID 37316210

> "If dizziness, neck pain and/or headaches persist for more than 10 days,
> cervicovestibular rehabilitation is recommended."
> "For children, adolescents and adults with dizziness/balance problems, either
> vestibular rehabilitation or cervicovestibular rehabilitation may be of
> benefit."

**Note the hedged verb in the second sentence.** *May be of benefit* is what the
consensus says, and it is what this document says. [G1] prescribes no dose, no
exercise velocity, no device and no home-program format.

**[G2]** *Living Concussion Guidelines: Guideline for Concussion & Prolonged
Symptoms for Adults 18 Years of Age or Older*, §10 (Vestibular & Vision
Dysfunction), fourth edition, living guideline. Ontario Neurotrauma Foundation /
Ontario Ministry of Health. Recommendation **10.5**, evidence level **A**:

> "Vestibular rehabilitation therapy is recommended for patients experiencing
> functionally limiting dizziness."

A living web guideline has no volume, page or DOI, and its recommendation
numbering can change between updates. Accessed 2026-08-23 at
`concussionsontario.org`.

**[G3]** Reed N\*, Zemek R\*, Dawson J, et al. *Living Guideline for Pediatric
Concussion.* 2024. doi:10.17605/OSF.IO/3VWN9 (\*co-first authors)

Cited here **only** to record that a pediatric guideline exists and that Gimbal
does not attempt to encode it — see `LIMITATIONS.md`. No specific pediatric
recommendation is attributed to it.

**[R1]** Schneider KJ, Meeuwisse WH, Nettel-Aguirre A, et al. *Cervicovestibular
rehabilitation in sport-related concussion: a randomised controlled trial.*
Br J Sports Med. 2014;48(17):1294–1298. doi:10.1136/bjsports-2013-093267 ·
PMID 24855132

n = 31, aged 12–30, persistent dizziness / neck pain / headache after
sport-related concussion, up to 8 weeks of weekly physiotherapy. 73 % (11/15) of
the treatment group were medically cleared within 8 weeks against 7 % (1/14) of
the control group.

**What [R1] does not support:** it is a small single-centre trial of a
**therapist-delivered combined cervical + vestibular** programme. It does not
isolate gaze stabilization, specifies no head velocity, and says nothing about
home-exercise delivery or adherence.

### 11.2 That the dose is the thing: it is written in minutes and repetitions

**[D1]** Hall CD, Herdman SJ, Whitney SL, et al. *Vestibular Rehabilitation for
Peripheral Vestibular Hypofunction: An Updated Clinical Practice Guideline From
the Academy of Neurologic Physical Therapy of the American Physical Therapy
Association.* J Neurol Phys Ther. 2022;46(2):118–177.
doi:10.1097/NPT.0000000000000382 · PMID 34864777

> "Based on moderate to weak evidence, clinicians **may prescribe** weekly clinic
> visits plus a home exercise program of gaze stabilization exercises consisting
> of a minimum of: (1) 3 times per day for a total of at least 12 minutes daily
> for individuals with acute/subacute unilateral vestibular hypofunction; (2) 3
> to 5 times per day for a total of at least 20 minutes daily for 4 to 6 weeks
> for individuals with chronic unilateral vestibular hypofunction; (3) 3 to 5
> times per day for a total of 20 to 40 minutes daily for approximately 5 to 7
> weeks for individuals with bilateral vestibular hypofunction."

**This is the single most load-bearing citation in the project, and it is also
the one most easily mis-cited.** Three qualifiers travel with it and are never
dropped:

1. The evidence grade is the guideline's own — **"moderate to weak"** — and the
   verb is **"may prescribe"**, not "should".
2. The population is **peripheral vestibular hypofunction, not concussion.**
   Carrying this dose across to concussion is an extrapolation [D1] does not make
   and Gimbal does not make either.
3. **[D1] specifies no head velocity.** Gimbal's peak-velocity floor and ceiling
   are **not** drawn from it. They are card fields, typed in by the patient from
   their clinician's handout, and the report says so.

What [D1] does establish, and it is all Gimbal needs from it: **gaze-stabilization
exercise is prescribed as a quantity — sessions per day, minutes per day, weeks —
exactly like a drug.** A quantity that is prescribed is a quantity that can be
under-delivered, and nothing in the clinical pathway measures it.

**[D2]** Academy of Neurologic Physical Therapy. *APTA's Updated Evidence-Based
Clinical Practice Guideline for Peripheral Vestibular Hypofunction* — the
three-page clinical **algorithm** summarising [D1]. Reached from `neuropt.org` →
Practice Resources → ANPT Clinical Practice Guidelines → Peripheral Vestibular
Hypofunction → **CPG Summaries**, where it is linked as *"CPG Outcome Assessment
Measures and Treatment Algorithms"* rather than by its own title. Accessed
2026-08-23.

**Why cite the algorithm as well as the paper.** Not because it grades anything
the abstract does not — it grades *less*. [D1]'s abstract carries the evidence
statement quoted above (*"moderate to weak"*, *"may prescribe"*) and the
algorithm's dose boxes carry **no grade at all**. The algorithm is cited for two
narrower things: it breaks the dose out by presentation, which the abstract
compresses into one sentence, and it prints two recommendations in a form that
can be quoted exactly.

| Presentation | Home gaze-stability dose |
|---|---|
| Acute / subacute unilateral | minimum **3×/day, at least 12 min/day** |
| Chronic unilateral | **3–5×/day, at least 20 min/day, for 4–6 weeks** |
| Bilateral | **3–5×/day, 20–40 min/day, for 5–7 weeks** |

**The grade on that dose, stated here so the table above cannot be misread.** In
the parent guideline the dose is **Action Statement 6b: evidence quality II, II
and III; recommendation strength *weak*** — the weakest form the guideline uses.
The algorithm page prints the boxes without that grade, and printing them next to
anything marked *Level I* would invite exactly the wrong reading. **The dose is
weak evidence. It is quoted here as proof that a dose is *prescribed at all*,
never as proof that this particular dose is right.**

The two graded recommendations on that page are separate boxes, and they belong
to different claims:

> **STRONG RECOMMENDATION (LEVEL I)** that "voluntary saccadic or smooth pursuit
> eye exercises should **NOT** be offered in isolation as gaze stabilization
> exercises. It is more effective to use the adaptation and substitution forms of
> gaze stability exercises."

**Verified against the parent guideline: Action Statement 4, evidence quality I,
recommendation strength strong.** The algorithm and the paper agree, and this is
the one load-bearing recommendation in this entry.

> **STRONG RECOMMENDATION (LEVEL I)** for use of targeted exercise techniques for
> acute and chronic unilateral peripheral vestibular hypofunction.

**This second one does not survive checking, and saying so is cheaper than being
caught.** The algorithm prints *Level I / strong*; the parent guideline grades
the same claim **Action Statement 5: evidence quality II, recommendation strength
*moderate*** — *"clinicians **may provide** targeted exercise techniques."* The
discrepancy is ANPT's own, between its summary sheet and its guideline, and it is
recorded here rather than inherited silently. **Gimbal relies on the first
recommendation only.**

**That first recommendation is the strongest single sentence in this reference
list, and it is what makes Gimbal's most-questioned design decision the correct
one.**
Gimbal refuses to do eye tracking — see §1's note that the 478-landmark mesh
includes 10 iris landmarks and Gimbal reads none of them. The obvious criticism
is that a *gaze*-stabilization tool that does not measure gaze is missing the
point. [D2] says the opposite at Level I: eye movement **in isolation, without
head movement, is not the exercise.** What matters is the head movement coupled
to a held visual target — which is exactly and only what Gimbal measures.

The same algorithm lists **Dynamic Visual Acuity** and the **Gaze Stabilization
Test** as the recommended objective measures on the "visual blurring with head
movement" branch. That is the lane §11.5's optotype task borrows its *shape*
from, and it is why it borrows from there rather than from anywhere else.

**What [D2] still does not do:** it names no head velocity, and it is still
scoped to peripheral vestibular hypofunction rather than concussion. Both
qualifiers from [D1] carry over unchanged.

### 11.3 That the delivered dose is not the prescribed dose

**[A1]** Nicolson PJA, Hinman RS, Wrigley TV, Stratford PW, Bennell KL.
*Self-reported Home Exercise Adherence: A Validity and Reliability Study Using
Concealed Accelerometers.* J Orthop Sports Phys Ther. 2018;48(12):943–950.
doi:10.2519/jospt.2018.8275 · PMID 30053792

54 adults aged 45+ with chronic knee pain, 12-week home quadriceps programme,
paper diary and an 11-point self-rating measured against a triaxial accelerometer
**concealed inside the ankle cuff weight**:

> "exercise adherence was significantly overestimated in diaries"

Diary median **220** exercises against accelerometer **176** (P < .001).
Diary-to-accelerometer agreement r = 0.52; the self-report rating scale was worse
still (r = 0.23–0.39) with inadequate test–retest reliability.

**[A2]** Argent R, Daly A, Caulfield B. *Patient Involvement With Home-Based
Exercise Programs: Can Connected Health Interventions Influence Adherence?*
JMIR Mhealth Uhealth. 2018;6(3):e47. doi:10.2196/mhealth.8518 · PMID 29496655

> "Evidence suggests that noncompliance to these home exercises in
> musculoskeletal cohorts can be between 30% and 50%."
> "there is no gold standard for the measurement of adherence to unsupervised
> home-based exercise, as the significant proportion of outcome measures used in
> the literature rely on patient self-report and are therefore susceptible to
> bias."

**What [A1] and [A2] do not support:** both are **musculoskeletal, not
vestibular**. No study measuring *vestibular* home-exercise adherence against an
objective reference was found, and none is claimed. [A2] is a Viewpoint article,
so the 30–50 % figure is a narrative estimate, not pooled evidence. Neither paper
shows that objective monitoring *improves* adherence or outcomes — [A2]
explicitly frames that as an opportunity rather than a finding, and Gimbal makes
no claim that it does either.

**[A1]'s own caution, which cuts against the tidy summary and is therefore
printed here rather than left out.** Its abstract reports that "a Bland-Altman
plot indicated **large between-participant variability in agreement**", and it
concludes that self-reported adherence has "questionable validity and variable
levels of agreement". **The finding is that the bias is unstable from person to
person — not that diaries inflate by a fixed factor.** Dividing the two medians
gives 1.25, and this document deliberately does **not** quote that ratio as
[A1]'s result: the paper states no percentage anywhere, and a number the source
did not compute must not be attributed to it.

That instability is the stronger argument anyway. A fixed inflation factor could
be corrected for on paper. One that varies per person cannot — which is why the
delivered dose has to be *measured* on the person in front of you rather than
inferred from what they report.

### 11.4 Why measuring the *kinematics* is the right thing to measure

**[V1]** Gonshor A, Jones GM. *Short-term adaptive changes in the human
vestibulo-ocular reflex arc.* J Physiol. 1976;256(2):361–379.
doi:10.1113/jphysiol.1976.sp011329 · PMID 16992507

**[V1b]** Gonshor A, Jones GM. *Extreme vestibulo-ocular adaptation induced by
prolonged optical reversal of vision.* J Physiol. 1976;256(2):381–414.
doi:10.1113/jphysiol.1976.sp011330 · PMID 16992508 — the companion paper, named
in full because one of the quotations below is **its** sentence and not [V1]'s

Repeated vestibular stimulation **alone** produced "no consistent change of VOR
gain"; combined with reversed visual input it produced "a substantial (approx.
25 %) and highly significant (P ≪ 0.001) reduction of VOR gain", attributed to
"an adaptive change in the VOR induced at least in part by **retinal image
slip**" — all three verbatim from **[V1]**, pp. 361–379.

The fourth sentence usually quoted alongside them, that the changes were "always
goal-directed towards the requirements of retinal image stabilization during head
movement", is verbatim from **[V1b]**, pp. 381–414 — *not* from [V1]. Split out
because a reader resolving it against the first title would not find it.

Retinal slip is the error signal. **Head motion without a visual target is not
the exercise** — which is why Gimbal's optotype task runs *during* the motion and
not before or after it.

**[V2]** Todd CJ, Schubert MC, Figtree WVC, Migliaccio AA. *Incremental
Vestibulo-ocular Reflex Adaptation Training Dynamically Tailored for Each
Individual.* J Neurol Phys Ther. 2019;43(Suppl 2):S2–S7.
doi:10.1097/NPT.0000000000000269 · PMID 30883486

> "Our data suggest that 17°/s retinal image slip … is sufficient to drive robust
> VOR adaptation."

A specific head-impulse laser paradigm in 8 healthy subjects. **Not a general
clinical threshold, and not a number Gimbal uses anywhere.**

**[V3]** Rinaudo CN, Schubert MC, Figtree WVC, Todd CJ, Migliaccio AA. *Human
vestibulo-ocular reflex adaptation is frequency selective.* J Neurophysiol.
2019;122(3):984–993. doi:10.1152/jn.00162.2019 · PMID 31339801

> "if one seeks to increase the higher-frequency VOR response, where it is
> physiologically most relevant, then higher-frequency head movements are
> required during training."

**[V4]** Hübner PP, Khan SI, Migliaccio AA. *Velocity-selective adaptation of the
horizontal and cross-axis vestibulo-ocular reflex in the mouse.* Exp Brain Res.
2014;232(10):3035–3046. doi:10.1007/s00221-014-3988-8 · PMID 24862508

"pronounced velocity selectivity of VOR adaptation" — the gain difference after
adaptation "was maximal when the sinusoidal testing stimulus **matched** the
adaptation training stimulus peak velocity."

**[V3] and [V4] together are the argument for this whole instrument, and they
must be stated in exactly the form the evidence takes: adaptation is SPECIFIC TO
THE PARAMETERS IT WAS TRAINED AT.** Frequency-selectivity is demonstrated in
humans [V3]; velocity-selectivity is demonstrated **in mouse** [V4]. It follows
that *the head movement performed has to match the head movement the prescription
intended* — and therefore that the frequency and peak velocity a patient actually
achieves at home are not incidental to the therapy, they are the therapy's active
parameters. That is the entire reason Gimbal measures °/s and Hz rather than
minutes.

**What [V3] and [V4] do NOT support, stated plainly because it is the tempting
over-claim:** they do **not** say that faster head movement produces greater
adaptation. Nothing in this reference list says that. The supported claim is
matching, not maximising — which is also why Gimbal enforces a **band with a
ceiling** rather than a floor alone, and why it refuses `too-fast` as readily as
`too-slow`.

### 11.5 The optotype task, and what Gimbal borrowed from it

**[O1]** Herdman SJ, Schubert MC, Das VE, Tusa RJ. *Recovery of dynamic visual
acuity in unilateral vestibular hypofunction.* Arch Otolaryngol Head Neck Surg.
2003;129(8):819–824. doi:10.1001/archotol.129.8.819 · PMID 12925338

Prospective, randomised, double-blind, 21 patients: "Patients who performed
vestibular exercises showed a significant improvement in DVA-predictable
(P < .001) and DVA-unpredictable (P < .001), while those performing placebo
exercises did not."

**[O2]** Schubert MC, Migliaccio AA, Clendaniel RA, Allak A, Carey JP. *Mechanism
of Dynamic Visual Acuity Recovery With Vestibular Rehabilitation.* Arch Phys Med
Rehabil. 2008;89(3):500–507. doi:10.1016/j.apmr.2007.11.010 · PMID 18295629 ·
PMCID PMC2951478

The method matters more here than the result — and it has to be quoted with its
seams showing, because the two fragments below come from **different sub-tests**
and are easy to splice into one sentence that no source contains. The static
acuity test uses "a single optotype (the letter E, randomly rotated each trial by
0°, 90°, 180°, or 270°)". The **dynamic** component presents "an optotype E
randomly oriented in 1 of 4 directions", displayed "when head velocity was
between 120° and 180°/s" — and, elided from that quotation for brevity but
recorded here so the elision is not silent, the mirrored −180° to −120° window
for the other direction, and a display-duration criterion.

**This is the precedent for the shape of Gimbal's measurement, and it is the only
thing claimed from it:** the established dynamic-visual-acuity paradigm presents
a **forced-choice orientation judgement on a single optotype, gated on measured
head velocity**. A four-alternative gap-orientation task during motion, credited
only inside a velocity window, is that paradigm's shape — not an invention, and
not a clinical equivalent either.

**[O3]** Herdman SJ, Tusa RJ, Blatt P, Suzuki A, Venuto PJ, Roberts D.
*Computerized dynamic visual acuity test in the assessment of vestibular
deficits.* Am J Otol. 1998;19(6):790–796. PMID 9831156

Test validation in 42 healthy subjects and 55 vestibular patients: reliability
**ICC** = 0.87 and 0.83 — intraclass correlation coefficients, which is what the
source reports, not Pearson's r; sensitivity 94.5 %, specificity 95.2 %.

**[O4]** BS EN ISO 8596:2018+A1:2020 — *Ophthalmic optics. Visual acuity testing.
Standard and clinical optotypes and their presentation* (underlying edition
ISO 8596:2017).

> "specifies a range of Landolt ring optotypes and describes a method for
> measuring distance visual acuity under photopic conditions for the purposes of
> certification or licensing"

and, in the same scope, that it is "neither intended as a standard for clinical
measurements nor for the certification of blindness or partial sight."

**[O4] therefore supports exactly one sentence: the Landolt ring is the
standardised optotype.** It does **not** make Gimbal's task an ISO-conformant
measurement, and Gimbal reports no acuity score at all — see `LIMITATIONS.md`.
Sourcing note: iso.org and the ANSI webstore refused automated access (HTTP 403);
the designation, title and scope wording above were read from the BSI reseller
listing, which reproduces the ISO scope verbatim. This is the one entry in §11
not read from a primary source, and it is also the one carrying the least weight
— it supports a single sentence about which optotype is standardised. The Landolt ring's precise
geometry (gap = 1/5 of the outer diameter) is **not** verified here and is not
relied on.

**[O5]** Skerswetat J, He J, Shah JB, Aycardi N, Freeman M, Bex PJ. *A new,
adaptive, self-administered, and generalizable method used to measure visual
acuity.* Optom Vis Sci. 2024;101(7):451–463. doi:10.1097/OPX.0000000000002160 ·
PMID 39110980 · PMCID PMC11323045

> "Observers who are non-literate or unfamiliar with the Roman alphabet may be
> asked to identify the orientation of the gap of tumbling E or Landolt C
> optotypes in four or eight alternative forced choice tasks"

Forced-choice optotype presentation is established practice. The chance level
that follows from it — **25 % for four alternatives** — is arithmetic, and it is
printed on the report beside the tally rather than left for a reader to work out.

### 11.6 What this literature does NOT license — the boundary, in one place

Every line here is a claim Gimbal could plausibly have made and does not.

| Not claimed | Why not |
|---|---|
| That any number on the protocol card comes from a guideline | **No published parameter could be pinned for any of the eight fields.** Every one is clinician-entry only, with a mandatory `source` string, and check `U-SRC` fails the build if one is empty. [D1] gives a dose in *minutes and sessions*; it gives no velocity band and no frequency band. |
| That the dose in [D1] applies to concussion | [D1]'s population is peripheral vestibular hypofunction. Gimbal makes the extrapolation nowhere, and neither does [D1]. |
| That faster head movement produces better outcomes | Not supported by [V3], [V4] or anything else opened. The supported claim is parameter **matching**, which is why the card has a ceiling. |
| That the VOR gain deficit is velocity-dependent in hypofunction | Searched and **not verified** — the vHIT literature sampled was mixed rather than settled. Not asserted. |
| That vestibular home-exercise adherence specifically is poor | [A1] and [A2] are musculoskeletal. The vestibular-specific version of that measurement was not found and is not claimed. |
| That measuring adherence improves it | [A2] frames this as an opportunity, not a finding. Gimbal measures delivery; it makes no outcome claim whatsoever. |
| That eye tracking would make Gimbal better | The opposite is the Level I recommendation. [D2]: voluntary saccadic or smooth-pursuit eye exercises "should **NOT** be offered in isolation as gaze stabilization exercises." Gimbal's refusal to read the iris is not a shortcut around a hard problem; it is the guideline's own position, and §11.5 is how functional gaze is evidenced without measuring it. |
| That Gimbal performs a dynamic visual acuity test | It does not. It reports **no logMAR score and none can be reported** — the browser supplies neither viewing distance nor display pixel pitch. [O1]–[O3] are cited for the paradigm's *shape*, not as a claim of equivalence. |
| That the optotype task is ISO-conformant | [O4] explicitly disclaims clinical use, and Gimbal claims none. |
| That DVA is validated as a concussion outcome measure | [O1]–[O3] are peripheral vestibular hypofunction. Not claimed. |
| Any agreement, accuracy, correlation or validation figure for Gimbal itself | **No such measurement exists.** See §7.3 and `LIMITATIONS.md`. |

### 11.7 And the arithmetic

Every signal-processing number in this document is derived inline from arithmetic
that is shown, and cites nothing, because it needs to cite nothing: `sin(x)/x`
is not a matter of opinion. **The separation is deliberate and it runs through
the whole system.** Instrument limits are derived and labelled as instrument
limits (§7). Clinical thresholds come from the card and are labelled with their
source. And the literature above establishes *why the measurement is worth
making* — never *what number to enforce*.
