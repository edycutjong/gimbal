# What Gimbal does not measure

This is the canonical text. It has five in-repo locations — this file, the
string the report prints (`src/report/limitations.ts`), the `README.md` block,
the `DEMO.md` block, and the block on the landing page in `index.html` — and
check **U-LIMITS** byte-compares all of them against
`src/report/limitations.ts`. The landing-page copy was added and registered in
the same change; a visible copy that no check reads is a copy that drifts. The
Devpost description is a sixth surface no in-repo check can reach; it is pasted
by hand from this file.

It prints at body size on the report, never as small print. Burying a limitation
in small type is the opposite of what a safety criterion rewards.

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

## Two further limitations that belong to the instrument rather than the report

**The optotype task demonstrates that a discrimination was made during motion.
It does not prove foveal fixation.** A patient answering from peripheral vision
without fixating is a residual risk. The no-consecutive-repeat randomisation
closes the "hold one arrow key" strategy, and the block tally is scored against
chance with a one-sided exact binomial rather than reported as a raw percentage
— but neither of those turns a behavioural proxy into a measurement of gaze.

**Two instrument thresholds are provisional and labelled as such in the code.**
`INSTRUMENT_LIMITS.qFloor` and `INSTRUMENT_LIMITS.deadbandFraction` are set from
a tracking-spike recording that separates deliberately-good from
deliberately-degraded conditions. Until that recording exists they are
placeholders, `PROVISIONAL_FROM_SPIKE` in `src/dsp/limits.ts` names exactly
which ones, and no claim is made that they are calibrated.

## Regulatory status

**Gimbal is not a medical device.** It does not diagnose, treat, or provide
clearance for any condition. It measures whether a prescribed exercise was
performed at the parameters a clinician wrote down, and reports that
measurement.

This paragraph used to sit at the foot of `LICENSE`, and moving it here was a
correction rather than a demotion: GitHub's licence detector reads the whole of
`LICENSE`, and any text appended after the MIT body drops the file below the
match threshold, so the repository reported its licence as `NOASSERTION`
instead of `MIT`. A licence a machine cannot identify is a licence nobody can
rely on. `LICENSE` is now the unmodified MIT text and nothing else; the
regulatory statement lives on the page that already carries every other
boundary this project states.
