# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| latest (`main`) | ✅ |

Releases are cut automatically from Conventional Commits; see `RELEASING.md`.

## What the threat model actually is

Gimbal has no server, no account, no database, and no upload path. It is a
static site plus a WebAssembly model bundle, and every measurement it makes
stays in the browser profile that made it. That removes most of the categories a
security policy usually covers and leaves three that genuinely apply:

1. **Anything that would cause the application to make a network request.** The
   product's central safety claim is that it makes none after page load. The
   Content-Security-Policy shipped in `vercel.json` and duplicated as a
   `<meta http-equiv>` on both pages is `connect-src 'self'`, so the browser
   blocks an upload rather than merely disallowing it — but a report of a way
   around that is a report worth making, and it is the highest-severity class
   of bug this project has.
2. **Anything that would put a measurement somewhere the patient did not put
   it.** `localStorage` is the only store. There is no share link, no QR
   handoff, and no "email my PT".
3. **Supply chain.** One runtime dependency, four dev dependencies, and two
   vendored artifacts (`@mediapipe/tasks-vision`'s WASM runtime, and the
   `face_landmarker` model bundle). `scripts/verify.mjs` step 0 fails the R11
   gate if the model bundle's SHA-256 does not match the committed
   content-addressed filename, so a substituted bundle cannot pass CI.

## Reporting a vulnerability

Please **do not** open a public issue for a security vulnerability. Instead:

- email **edy.cu@live.com**, or
- use GitHub's private vulnerability reporting: the repository's **Security**
  tab → **Report a vulnerability**.

You will get an acknowledgement within 48 hours and a resolution timeline after
triage. Please allow a reasonable window to patch before public disclosure.

## Repository security settings

The workflow files in `.github/workflows/` are inert until the matching
repository features are switched on, and those are settings rather than files —
they cannot be committed. A maintainer with admin rights enables them once,
under **Settings → Code security**:

| Setting | Why |
|---|---|
| Dependabot alerts | Turns `.github/dependabot.yml` from a version-bump schedule into a vulnerability feed. To check the current state: `gh api repos/edycutjong/gimbal/vulnerability-alerts` returns 204 when it is on and 404 when it is off. |
| Dependabot security updates | Opens a patch PR for an alert without waiting for the monthly window. |
| Secret scanning + push protection | Available on public repositories at no cost; on a private repository it needs GitHub Advanced Security. This repository is private until submission, so `.github/workflows/gitleaks.yml` covers the gap in the meantime and scans full history rather than only new pushes. |
| Code scanning (CodeQL) | Runs from the committed `.github/workflows/codeql.yml` once the workflow has run on the default branch. |

The equivalent commands, for a maintainer who would rather not click:

```bash
gh api -X PUT repos/edycutjong/gimbal/vulnerability-alerts
gh api -X PUT repos/edycutjong/gimbal/automated-security-fixes

gh api -X PATCH repos/edycutjong/gimbal --input - <<'JSON'
{
  "security_and_analysis": {
    "secret_scanning": { "status": "enabled" },
    "secret_scanning_push_protection": { "status": "enabled" }
  }
}
JSON
```

All three are idempotent. The last one needs the repository to be public, or
Advanced Security enabled on it, so run it as part of the private→public flip
rather than before. It takes a JSON body on stdin rather than `-f` flags,
because `gh api` does not flatten nested objects.

## Before the repository goes public

The rule this project runs on is that history is scanned, not just the working
tree. `.github/workflows/gitleaks.yml` checks out with `fetch-depth: 0` for
exactly that reason, and it must be green on `main` before the visibility change.
