# Contributing to Gimbal

Thanks for looking at this. Gimbal is a measuring instrument for a prescribed
medical exercise, so it has a few conventions that are stricter than a typical
web project's — and they exist for reasons that are written down rather than
assumed. Read this section before the setup steps; it will save you a rejected
pull request.

## The five rules that will fail your build

Each of these is enforced mechanically by `scripts/checks.mjs`, which runs first
in `npm test`. The check id is in the failure output.

| Rule | Check |
|---|---|
| **No new dependency.** One runtime (`@mediapipe/tasks-vision`), four dev (`vite`, `typescript`, `vitest`, `@playwright/test`). "1 runtime, 4 dev, `npm audit` 0 vulnerabilities" is a claim a reviewer verifies in five seconds by reading `package.json`; a convenience library is not worth trading it for. | reviewed by hand |
| **No third-party origin, anywhere.** No CDN, no font host, no analytics, no remote image — including in the README, whose images resolve to `docs/assets/`. `connect-src 'self'` means the browser blocks a request the code should never have made. | `greppable`, `U-DIST` |
| **No `mock`, `fake`, `simulate` or `stub` in `src/`.** Not as an identifier, not behind a dev flag. There is no fixture-replay route in the application at all: the verification harness feeds recorded pixels by overriding `getUserMedia` from the test runner, so there is nothing to gate and nothing that could survive into the bundle. | `U-DEV` |
| **No flags on the reproduce path.** No `MOCK=`, no `--dry-run`, no `OFFLINE=1`, no environment variable, no key, no account. The judged capability runs on the default path or it does not run. | `U-FLAG` |
| **Focus rings are never removed, and nothing renders below 15 px.** There is no 12/13/14 px tier. Limitations and citations are set at body size. | `U-OUTLINE`, and the tokens in `src/styles/tokens.css` |

Two more that are easy to trip over:

- **Every numeric field on a protocol card carries a non-empty `source` string.**
  The type is `Sourced<T> = { value: T; source: string }`, so a criterion cannot
  reach the printed page without its citation attached — the object would not
  type-check. (`U-SRC`)
- **The limitations text is byte-identical in five places.** Edit
  `src/report/limitations.ts` and copy it into `LIMITATIONS.md`, `README.md`,
  `DEMO.md` and `index.html`. (`U-LIMITS`)

## Design constraints, before you change any UI

The people this is built for have photophobia, motion-provoked dizziness,
headache, and cognitive fatigue. Three consequences that are not negotiable:

- **All three themes must work** — `dark` (default), `dim` (deep photophobia),
  `light` (warm paper, never pure white). Tokens live in `src/styles/themes.css`.
- **`prefers-reduced-motion` is honoured, and any continuous motion has a
  visible pause control.** Nothing flashes, anywhere.
- **A refusal is never red, never a flash, never a shake.** Roughly half of all
  refusals are instrument conditions rather than patient conditions, and telling
  a patient who slowed down because they got dizzy that they made an *error* is
  clinically backwards.

## Getting started

```bash
npm ci
npm run dev
```

There is no `.env` file, no key, and no account. If a change would introduce
one, it is the wrong change.

## Before you open a pull request

```bash
npm run build        # tsc --noEmit, then the production bundle
npm test             # the mechanical checks, then the unit suite
npm run check:build  # builds, then greps the shipped bundle
npm run bench        # the DSP correctness gate and the frame-budget timings
npx playwright test  # the end-to-end suite
```

`npm test` and `npm run bench` run with the network unplugged. `npm run verify`
— the R11 gate — downloads a Chromium build the first time it runs and is
air-gapped on every run after that; the boundary is stated at the top of
`scripts/verify.mjs`.

If you add or remove a test, **update the count in `README.md`**. `U-COUNT`
compares the printed number against the suite and fails the build if they
disagree.

## There is no linter, deliberately

`tsconfig.json` turns on `strict`, `noUnusedLocals`, `noUnusedParameters`,
`noFallthroughCasesInSwitch` and `noUncheckedIndexedAccess`, and `tsc` runs on
every build — which is most of the rule set people install ESLint for. The
twelve mechanical checks cover the project-specific rules a generic rule set
could not know about, the ones in the table above. Adding ESLint plus a
TypeScript parser plus a config preset is three or four dev dependencies to
catch a class of problem this codebase has not had.

**The gap, stated:** `tsconfig.json` includes `src` and `tests` and excludes
`e2e`. The end-to-end specs are TypeScript that Playwright executes but nothing
typechecks, because they import Node builtins and typechecking them needs
`@types/node`. If you change `e2e/`, run the suite — the compiler will not catch
you.

If you hit a real bug a linter would have caught, say so in an issue. That is
the evidence that would change this.

## Commit convention

[Conventional Commits](https://www.conventionalcommits.org) — the subject line
decides the release. `feat:` is a minor, `fix:` / `perf:` / `revert:` are
patches, `feat!:` or a `BREAKING CHANGE:` footer is a major, and
`docs:` / `test:` / `build:` / `ci:` / `refactor:` / `chore:` release nothing but
still deploy. The full table is in `RELEASING.md`.

## Reporting a bug or asking for a feature

Use the issue templates. For a measurement bug, the single most useful thing you
can include is the drive conditions — head frequency, sweep amplitude, lighting,
camera — because `scripts/bench.mjs` can usually reproduce a gate outcome from
an analytic signal without needing your recording.

**Do not attach a real session export, a report page, or a photograph of one.**
See `CODE_OF_CONDUCT.md`.

Security vulnerabilities do not go in issues at all — see `SECURITY.md`.
