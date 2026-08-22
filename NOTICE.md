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

## Typeface

The interface requests *Inter* by name and then falls back to the reader's own
system UI font stack. **No font file is vendored, bundled, or fetched** — there
is no `@font-face` rule in `src/styles/`, and no third-party font origin, which
is consistent with the zero-network-requests claim. On a machine without Inter
installed, the page renders in `system-ui` and nothing about the measurement
changes.

If a subset Inter `woff2` is vendored later, its licence is the SIL Open Font
License 1.1 and this section is to be updated with the exact file and its hash
at that time — not before.

## Development dependencies

`vite`, `typescript`, `vitest` and `@playwright/test` are build- and test-time
only. They are not vendored, not bundled into the shipped output, and ship no
code to any user.
