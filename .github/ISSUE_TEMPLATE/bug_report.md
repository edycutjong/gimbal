---
name: Bug report
about: Something the instrument does that it should not, or does not do that it should
title: "[Bug] "
labels: bug
---

**Please do not attach a real session export, a report page, or a photograph of
one.** Gimbal has no upload path on purpose, and an issue tracker should not
become one. Describe the conditions instead — that is almost always enough to
reproduce a gate outcome from an analytic drive signal.

## What happened

## What you expected instead

## Which surface

- [ ] `/` — the landing page
- [ ] `/app` — the instrument
- [ ] The printed report
- [ ] A command (`npm test`, `npm run bench`, `npm run verify`, `npm run check:build`)

## Steps to reproduce

1.
2.
3.

## If it is a measurement bug

The gate has six outcomes — `ok`, `too-slow`, `too-fast`, `off-cadence`,
`low-confidence`, `face-lost`. Knowing which one you got, and which one you
expected, narrows this faster than anything else.

- Outcome shown on screen:
- Outcome you expected:
- Approximate head frequency and sweep size:
- Lighting, and whether anything was covering part of your face:
- The eight numbers from the protocol card you were using:

## Environment

- OS:
- Browser and version:
- Camera (built-in or model):
- Node version, if the bug is in a command:

## Anything the checks said

Paste the failing check id and its output if `npm test`, `npm run bench` or
`npm run check:build` reported one.
