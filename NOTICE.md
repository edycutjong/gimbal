# Third-party attribution

Gimbal has **one runtime dependency** and vendors two artifacts from it
same-origin. Each licence below is stated as it appears in the vendored files or
in the upstream package metadata. Where a licence file could not be located in
the distributed package, this file says exactly that and points at the upstream
page rather than guessing.

---

## `@mediapipe/tasks-vision`

- **Version vendored:** `0.10.22-rc.20250304` (see `package.json`)
- **Licence:** Apache License 2.0, as declared in the package's own metadata.
- **Upstream:** https://github.com/google-ai-edge/mediapipe
- **What is vendored:** the WebAssembly runtime files
  `vision_wasm_internal.js`, `vision_wasm_internal.wasm`,
  `vision_wasm_nosimd_internal.js` and `vision_wasm_nosimd_internal.wasm`,
  copied unmodified from the installed package into `public/model/` so the
  application makes zero third-party network requests.

## `face_landmarker.task` model bundle

- **File as vendored:** `public/model/face_landmarker.64184e22.task`
- **SHA-256:** `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`
- **Source:** the MediaPipe Face Landmarker float16 model bundle, published by
  Google at
  https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
- **Licence:** Apache License 2.0, per the MediaPipe Solutions model card for
  Face Landmarker.
- **Modification:** none. The filename is content-addressed with the first eight
  hex digits of the SHA-256 above so a swapped bundle cannot be cached over
  silently; the bytes are unmodified.

## Typeface — Inter

- **File as vendored:** `public/fonts/InterVariable.woff2`
- **Upstream:** Inter 4.1, https://github.com/rsms/inter
- **Licence:** SIL Open Font License 1.1. The full licence text ships beside the
  font at `public/fonts/Inter-OFL.txt` and is served at `/fonts/Inter-OFL.txt`,
  linked from the landing page footer.
- **Modification:** SUBSET, not otherwise altered. Reduced to Latin-1, the
  punctuation this interface prints (`° · — – → × ≥ ≈ ✓ “ ”`) and the Greek this
  project's own derivations print (`π ω μ Δ`), which is 73.9 kB rather than
  352 kB. Both variable axes survive the subset — `wght` 100–900 and `opsz`
  14–32 — and no outline is redrawn. Every non-ASCII character rendered by
  either page is covered; none falls back.
- **Why vendored at all:** `--font-stack` has always named Inter first, and until
  it was vendored every machine fell through to `system-ui`, so the numerals — the
  product's actual output — took whatever shape the operating system felt like.
  `font-src 'self'` in the CSP means a Google Fonts URL would be *blocked by the
  browser*, so a self-hosted copy is the only kind of web font this project can
  have. It is served same-origin and counts toward the zero-third-party-origins
  claim exactly like the model bundle does.

## GitHub mark — Octicons

- **Where it appears:** inline `<svg>` in `index.html`, the footer's
  *"Source on GitHub"* link. One path, no file, no request.
- **Upstream:** the `mark-github` icon from https://github.com/primer/octicons
- **Licence:** MIT, as declared in the Octicons repository.
- **Modification:** none to the path data. It is rendered at `1.15em` with
  `fill="currentColor"` so it takes the link's own colour.
- **Why inline rather than vendored as a file:** `img-src 'self'` would permit a
  local file, but an `<img>` is a second request for a mark that decorates a link
  and can 404 independently of it. Inlining makes the icon and the link one
  object. It also keeps the zero-third-party-origins claim trivially true for it.

**Trademark note.** The GitHub logo is a GitHub, Inc. trademark. It is used here
only to label a link that points at GitHub, which is what the mark is for. It is
not used as this project's own mark, and it does not imply that GitHub endorses,
sponsors or is affiliated with Gimbal.

## Development dependencies

`vite`, `typescript`, `vitest` and `@playwright/test` are build- and test-time
only. They are not vendored, not bundled into the shipped output, and ship no
code to any user.
