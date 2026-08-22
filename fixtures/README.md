# Fixtures — what has to be recorded, and why none of it can be generated

**`fixtures/` may not synthesise. `tests/` may.**

That distinction is enforced by directory and it is the whole difference between
testing and fabricating. A synthetic input to a pure function under test — an
FFT fed `sin(2π·2·t)` whose answer is known analytically, a `scoreCycle` truth
table — is testing. A synthetic *session* is a fabricated measurement, and there
is no script in this repository that produces one.

So every file described below has to be **recorded from a real person**. None of
it is blocked on anything but a camera and about twenty minutes.

Until a recording exists, the assertion that reads it **skips with a named
reason**. It never passes. `npm run verify` prints which ones are absent.

---

## What is missing right now

| File | What it is | What it gates |
|---|---|---|
| `compliant.mp4` | ~30 s of head yaw oscillation **inside** the prescribed band | P1 (a credited cycle), the print gate |
| `still-face.mp4` | ~20 s of a **stationary** face at normal lighting | GT-3, the negative control |
| `no-face.mp4` | ~10 s of an **empty room** | GT-4, the other negative control |
| `metronome-2hz.mp4` | 60 s of oscillation against an audible **2.000 Hz** metronome | GT-2, frequency ground truth |
| `bench/webcam.mp4` + `bench/gyro.csv` | the bench validation, below | A1, A5 — the one headline number |
| `bench/sub-therapeutic.mp4` | ~25 s at the same tempo, **visibly reduced amplitude** | **A3 — this one is the product** |
| `../public/fixtures/example-ledger.json` | the frozen example ledger | V1–V4 |

---

## Recording protocol

**Format:** 640×480, 30 fps requested, `.mp4` (H.264). Face the camera, seated,
with the whole head in frame.

**Record on the OLDEST machine available, not the demo machine.** This is
deliberate. A low-end machine drops frames under auto-exposure, so the fixture
contains *real* inter-frame jitter — and a pipeline that assumed a constant
33.3 ms `dt` would pass on a clean fixture and fail on this one. The fixture is
chosen to be hostile to the most likely silent bug.

### The four clips

1. **`compliant.mp4`** — turn your head side to side at roughly the prescribed
   tempo and a comfortable amplitude, for about 30 seconds.
2. **`still-face.mp4`** — sit still, looking at the camera, for 20 seconds.
   Normal room lighting. Blink normally; do not hold rigid.
3. **`no-face.mp4`** — point the camera at an empty room for 10 seconds.
4. **`metronome-2hz.mp4`** — set a metronome to exactly 120 bpm (2.000 Hz) and
   oscillate with it for 60 seconds. Human cycle-to-cycle timing jitters; the
   *mean* frequency over 60 s does not, which is exactly what a Hann-windowed
   FFT over the record measures.

### The bench validation — the only part that needs hardware

This is the assertion that a staff-engineer judge will care about most, because
it compares Gimbal against **a sensor of a different physical modality that
Gimbal does not control**.

1. Hold a phone **rigidly against the temple** — an elastic band, not a hand.
   Hand-held introduces exactly the relative motion the comparison is measuring.
2. Log the phone's `Gyroscope` angular rate at ~60 Hz to `bench/gyro.csv`, with
   the header `t_ms,wx,wy,wz`.
3. Record `bench/webcam.mp4` from the laptop camera at the same time.
4. **Script the session into three segments, in one continuous take:**
   - **S1, compliant (~40 s)** — yaw oscillation at the prescribed frequency and
     amplitude. Expected: cycles credited.
   - **S2, deliberately sub-therapeutic (~25 s)** — the same tempo at visibly
     reduced amplitude, below the peak-velocity floor. Expected: **every** cycle
     refused `too-slow`, dose contribution exactly 0.000 s. Save this segment
     separately as `bench/sub-therapeutic.mp4`.
   - **S3, deliberately too fast (~15 s)** — above the band. Expected: refused
     `too-fast`.
5. **Record two takes, not one.** Take 1 sets the tolerance; take 2 is the
   published figure, held out from the tolerance-setting step. One extra
   ~80-second take is the difference between a benchmark and a self-report.
6. Write `bench/manifest.json` with the SHA-256 of every file, the camera model,
   the browser build, an estimated lux, and which machine it was.

**No agreement figure may be written into `README.md`, `METHODS.md`, a video
script, or any submission field before that recording exists.** The tolerance
(`A1_TOLERANCE_DEG_PER_SEC = 6.0` in `e2e/verify.spec.ts`) was chosen *before*
the measurement, and it is set below the 7.3 °/s size of the bias-correction
effect precisely so that deleting the correction fails the gate. **If the
recording measures worse than 6.0 °/s, publish the measured number and lower the
prescribed band — never raise the tolerance to fit.**

---

## The example ledger

`public/fixtures/example-ledger.json` is **frozen from real sessions**, exported
through the app's own Download JSON button, by `npm run build:example-ledger`.
That script sorts, validates and re-serialises. **It does not generate,
interpolate, smooth, fill, randomise, or adjust any measurement, and there is no
PRNG import in it** — that is a reviewable property, not a promise.

The trend annotation needs **six sessions on one device signature** before it
renders anything at all. Below that the ledger honestly says so on screen.

**If fewer than six real sessions exist, ship what exists. Do not generate the
difference.** A seven-row ledger that is real beats an eighteen-row ledger that
is not, and the difference is invisible to a judge but fatal if probed.

Every example row is labelled in six places: the loader button's own text, a
persistent banner, a per-row chip, a distinct sparkline shape, the print gutter,
and anywhere the ledger appears in a video or screenshot. Assertion V4 checks the
**disclosure**, not the data, because the label silently disappearing after a
refactor is the most likely way this project would accidentally mislabel
developer history as patient data.

---

## Consent

The only subject in any fixture is the builder. No third party is recorded, and
`METHODS.md` says so. Before the repository goes public, confirm the clips
contain no identifying background.
