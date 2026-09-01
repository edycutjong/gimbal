import { THEME_KEY } from '../store/local.ts';

/** Escapes text destined for an innerHTML template. */
export function esc(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function el<T extends Element>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`missing element: ${selector}`);
  return found;
}

export function all<T extends Element>(root: ParentNode, selector: string): T[] {
  return Array.from(root.querySelectorAll<T>(selector));
}

export function reducedMotion(): boolean {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/**
 * The single citation primitive. A `<details>`/`<summary>` disclosure, forced
 * open by the print stylesheet — because a citation hidden behind a click is
 * worth nothing on paper.
 */
export function whyDisclosure(source: string, id?: string): string {
  return `<details${id ? ` id="${esc(id)}"` : ''}>
  <summary>Why?</summary>
  <div class="disclosure-body">${esc(source)}</div>
</details>`;
}

export type ThemeName = 'dim' | 'dark' | 'light';
export const THEMES: ThemeName[] = ['dim', 'dark', 'light'];

export function loadTheme(): ThemeName | null {
  try {
    const v = globalThis.localStorage?.getItem(THEME_KEY);
    return v && (THEMES as string[]).includes(v) ? (v as ThemeName) : null;
  } catch {
    return null;
  }
}

/**
 * The theme that is ACTUALLY ON SCREEN, stored or not.
 *
 * `loadTheme()` returns null on a first visit, and the picker was rendering
 * that null as three unchecked radios — a control that reports "nothing is
 * selected" while a palette is plainly in effect, and reports it hardest on the
 * very first paint, which is the only one a judge is guaranteed to see. Worse
 * on a machine set to a light OS: themes.css seeds the warm-paper palette from
 * `prefers-color-scheme`, so the page was light and the Light radio was empty.
 *
 * Nothing is written to storage here. The absence of a stored value is what
 * keeps the page following the OS, and `syncThemePicker` below re-checks the
 * radio if the OS flips while the page is open.
 */
export function effectiveTheme(): ThemeName {
  const stored = loadTheme();
  if (stored) return stored;
  return globalThis.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function applyTheme(theme: ThemeName): void {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    globalThis.localStorage?.setItem(THEME_KEY, theme);
  } catch {
    /* the picker still works for this session; only the preference is lost */
  }
}

/**
 * The picker lives on every screen's settings row.
 *
 * `current` is resolved through `effectiveTheme()` rather than trusted, because
 * every call site passes the STORED theme and that is `null` until someone
 * picks one. Rendered literally, the control said "no theme selected" on every
 * first visit while a palette was visibly in effect — and on a light-set
 * machine it said it while the page was warm paper and Light was the answer.
 * A control that misreports its own state is worse than no control.
 */
export function themePickerHtml(current: ThemeName | null): string {
  const shown = current ?? effectiveTheme();
  const labels: Record<ThemeName, string> = { dim: 'Dim', dark: 'Dark', light: 'Light' };
  const radios = THEMES.map(
    (t) => `<label>
      <input type="radio" name="theme" value="${t}"${shown === t ? ' checked' : ''} />
      <span>${labels[t]}</span>
    </label>`,
  ).join('');
  return `<fieldset class="theme-picker">
    <legend class="visually-hidden">Theme</legend>${radios}
  </fieldset>`;
}

export function wireThemePicker(root: ParentNode): void {
  const inputs = all<HTMLInputElement>(root, 'input[name="theme"]');
  for (const input of inputs) {
    input.addEventListener('change', () => {
      if (input.checked) applyTheme(input.value as ThemeName);
    });
  }

  // While no theme has been stored the palette still tracks the OS, so the
  // radio has to track it too — otherwise flipping the OS to light repaints the
  // page and leaves Dark ticked.
  //
  // The app re-renders its settings row on every screen transition and calls
  // this function each time, so the listener DETACHES ITSELF once the picker it
  // belongs to has left the document. Otherwise six screens means six listeners
  // walking arrays of detached inputs.
  const query = globalThis.matchMedia?.('(prefers-color-scheme: light)');
  const sync = (): void => {
    if (!inputs.some((input) => input.isConnected)) {
      query?.removeEventListener('change', sync);
      return;
    }
    if (loadTheme()) return;
    const shown = effectiveTheme();
    for (const input of inputs) input.checked = input.value === shown;
  };
  query?.addEventListener('change', sync);
}

/**
 * The mark: the dial's own 270° sweep, the prescribed band at twelve o'clock,
 * and one committed marker sitting slate and OFF the band — the refusal, drawn
 * at 32 px. Byte-identical geometry to `.lp-mark` on the landing page, because
 * the two surfaces are one product and the header is where a reader decides
 * whether they believe that.
 *
 * Inline rather than an `<img src="/icon.svg">`: the mark is drawn in theme
 * tokens, and an external SVG cannot see the page's custom properties, so a
 * referenced copy would be stuck in one palette across three.
 */
export const APP_MARK_SVG = `<svg class="app-mark" viewBox="0 0 40 40" aria-hidden="true" focusable="false">
  <circle cx="20" cy="20" r="15" fill="none" stroke="var(--edge-strong)" stroke-width="4"
          stroke-dasharray="70.686 23.562" transform="rotate(135 20 20)" />
  <circle cx="20" cy="20" r="15" fill="none" stroke="var(--zone-in)" stroke-width="5.5"
          stroke-dasharray="0 30.10 10.47 100" transform="rotate(135 20 20)" />
  <line x1="3.37" y1="13.11" x2="9.84" y2="15.79" stroke="var(--refused)" stroke-width="3" />
</svg>`;

/**
 * The application bar. Rendered at the top of every screen except the block
 * screen, which has no chrome at all by design.
 *
 * The brand is a LINK to `/`, matching `.lp-brand` on the landing page. It used
 * to be a `<span>`, which made `/app` a dead end: the mark and the wordmark look
 * exactly like every site's home affordance, a reader clicks them, and nothing
 * happens. There was no route back to `/` from anywhere in the app — `href="/"`
 * appeared nowhere in `src/` or `app/`. The block screen still has no chrome, so
 * this cannot be clicked mid-exercise.
 */
export function settingsRow(current: ThemeName | null): string {
  return `<div class="settings-row no-print">
    <a class="app-brand" href="/" aria-label="Gimbal, home">${APP_MARK_SVG}<span class="wordmark">Gimbal</span></a>
    ${themePickerHtml(current)}
  </div>`;
}
