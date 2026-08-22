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

**No citation in this document is asserted that has not been opened.** The
guideline documents relevant to this domain are the *Consensus statement on
concussion in sport: the 6th International Conference on Concussion in Sport*
(the Amsterdam consensus statement), the *Living Concussion Guidelines*, and the
*PedsConcussion Living Guideline for Pediatric Concussion*.

For the VORx1 protocol material specifically — gaze-stabilization parameters,
staged progression, retinal slip as the VOR-adaptation error signal, and the
dynamic-visual-acuity task form the Landolt C check borrows — this document
makes no citation claim: **stated as background from vestibular-rehabilitation
practice; no specific published source has been verified for this claim, and no
numeric threshold is drawn from it.**

For every numeric field on the protocol card: **no published parameter could be
pinned; this field is clinician-entry only.** That sentence is what the app
prints beside a field whose source the patient left blank, and it is the honest
statement rather than a gesture at a literature.

Every signal-processing number in this document is derived inline from
arithmetic that is shown.
