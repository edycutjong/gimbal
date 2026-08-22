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

export function applyTheme(theme: ThemeName): void {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    globalThis.localStorage?.setItem(THEME_KEY, theme);
  } catch {
    /* the picker still works for this session; only the preference is lost */
  }
}

/** The picker lives on every screen's settings row. */
export function themePickerHtml(current: ThemeName | null): string {
  const labels: Record<ThemeName, string> = { dim: 'Dim', dark: 'Dark', light: 'Light' };
  const radios = THEMES.map(
    (t) => `<label>
      <input type="radio" name="theme" value="${t}"${current === t ? ' checked' : ''} />
      <span>${labels[t]}</span>
    </label>`,
  ).join('');
  return `<fieldset class="theme-picker">
    <legend class="visually-hidden">Theme</legend>${radios}
  </fieldset>`;
}

export function wireThemePicker(root: ParentNode): void {
  for (const input of all<HTMLInputElement>(root, 'input[name="theme"]')) {
    input.addEventListener('change', () => {
      if (input.checked) applyTheme(input.value as ThemeName);
    });
  }
}

export function settingsRow(current: ThemeName | null): string {
  return `<div class="settings-row no-print">
    <span class="wordmark">Gimbal</span>
    ${themePickerHtml(current)}
  </div>`;
}
