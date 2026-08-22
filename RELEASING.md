# Releasing

Versioning is automatic and derived from commit messages. There is no manual
version bump, and `package.json`'s `version` field is written by CI, not by hand.

## Commit convention

[Conventional Commits](https://www.conventionalcommits.org). The subject line
decides the release:

| Commit | Bump |
|---|---|
| `feat!: …` or a `BREAKING CHANGE:` footer | **major** (minor while below 1.0.0 — the API is explicitly not stable yet) |
| `feat: …` | **minor** |
| `fix: …`, `perf: …`, `revert: …` | **patch** |
| `docs:`, `test:`, `build:`, `ci:`, `refactor:`, `chore:` | **no release** — the commit still deploys |

Scopes are free-form and appear in the changelog: `fix(dsp): correct the
median frame interval over a cycle`.

## What happens on a push to `main`

1. `npm test` — 76 unit tests plus the seven mechanical greps.
2. `npm run check:build` — the production bundle, then `U-DIST` over it.
3. `npm run verify` — the R11 gate, including the model-bundle hash.
4. `scripts/version.mjs` reads the tags and the commits since the last one, and
   decides the bump.
5. If there is one: `package.json` and `CHANGELOG.md` are written, committed as
   `chore(release): vX.Y.Z`, tagged, pushed, and a GitHub release is published.
6. **Every** push deploys to Vercel production, bump or not — a docs-only commit
   still belongs on the canonical URL.
7. The deployed headers are re-verified with `npm run check:deploy`.

The release commit is skipped by the workflow's own `if:` guard, so pushing it
back to `main` does not loop.

## Why this is hand-written

`scripts/version.mjs` uses Node builtins and `git`, and adds **zero
dependencies**. `semantic-release` and its plugin set would add a dozen, and the
"1 runtime, 4 dev" line in `package.json` is greppable evidence — the sort a
reviewer checks in five seconds. Trading it away for release automation would
cost more than the automation is worth.

Try it without changing anything:

```bash
node scripts/version.mjs --dry-run
```

## Secrets

**One secret: `VERCEL_TOKEN`**, at Settings → Secrets and variables → Actions.

`VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` are inline in the workflows on purpose.
They are identifiers, not credentials — useless without the token, and present in
`.vercel/project.json` on any machine that has run `vercel link`. Keeping them
inline means one secret to configure instead of three.

## Rollback

Every Vercel deployment keeps a permanent, immutable URL. If production regresses,
promote the previous deployment — atomic, under a minute, no rebuild. That is the
whole incident plan, and it is why the demo recording's deployment URL and git
SHA are worth writing down at the time.
