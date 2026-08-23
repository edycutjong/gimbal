## Summary

What does this change, and which constraint made it the right change?

## Changes

-

## Gates

All six run offline once a Chromium build exists on the machine — the two that
need a browser download one the first time and never again. Tick what you ran.

- [ ] `npm run build` — `tsc --noEmit` in strict mode, then the production bundle
- [ ] `npm test` — the mechanical checks, then the unit suite
- [ ] `npm run check:build` — builds, then greps the shipped bundle (`U-DIST`)
- [ ] `npm run bench` — the six-outcome correctness gate, then the frame-budget timings
- [ ] `npx playwright test` — the end-to-end suite
- [ ] `npm run verify` — the R11 gate, if this touches capture, the model bundle, or the report

## Constraints

- [ ] **No dependency added.** `package.json` still reads one runtime and four dev.
- [ ] **No third-party origin added** — no CDN, no font host, no remote image, in code or in a document.
- [ ] Tests added or updated for any behaviour change, and `README.md`'s test count updated with them (`U-COUNT`).
- [ ] If the limitations text changed, all five copies changed with it (`U-LIMITS`).
- [ ] If any UI changed: all three themes checked, nothing below 15 px, focus ring intact, `prefers-reduced-motion` path still legible.
- [ ] Commit subjects follow Conventional Commits — the release is derived from them.

## Related issues

Closes #
