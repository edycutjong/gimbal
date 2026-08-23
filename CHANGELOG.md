# Changelog

Generated from Conventional Commits by `scripts/version.mjs`.

## 1.0.0 — 2026-08-23

First stable release. The version line starts here by decision rather than by
bump: everything the instrument claims is now measured, checked or cited, and
the public API — the protocol card, the report, and the eight prescribed
parameters — is one a clinician could be handed.

### Breaking changes

- The application moved from `/` to `/app`. `/` now serves the landing page.
  Any bookmark or link pointing at `/` for the prescribe screen must be
  updated to `/app`.

### Features

- **landing:** a real landing page at /, app moved to /app

### Fixes

- **qa:** accessibility, specificity and check-hardening from two adversarial passes
- **dial:** the committed marker pointed 135 degrees from the velocity it reported
- **gate:** the rest timer counts up, because no rest period was prescribed
- **ci:** enforce one canonical URL — no platform address anywhere
- **ci:** separate U-CFG from U-DOC so preview deploys do not fail on correct docs

### Performance

- **bench:** a deterministic DSP benchmark with p50/p95/p99

### Documentation

- **methods:** ground the instrument in the literature

### CI

- read Vercel identifiers from repository variables, with literal fallbacks

## 0.1.0 — 2026-08-22

Initial instrument bench: Vite + TypeScript skeleton, MediaPipe vendored
same-origin, the DSP path, the credit gate and the stop rule.
