// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  esc,
  el,
  all,
  reducedMotion,
  whyDisclosure,
  THEMES,
  loadTheme,
  effectiveTheme,
  applyTheme,
  themePickerHtml,
  wireThemePicker,
  APP_MARK_SVG,
  settingsRow,
} from '../src/ui/dom.ts';
import { THEME_KEY } from '../src/store/local.ts';

/* ---------------------------------------------------------------- harness */

/** A `MediaQueryList` stand-in whose `matches` we own and whose listeners we can fire. */
class FakeMql {
  matches: boolean;
  readonly listeners = new Set<() => void>();
  constructor(matches: boolean) {
    this.matches = matches;
  }
  addEventListener(_type: string, listener: () => void): void {
    this.listeners.add(listener);
  }
  removeEventListener(_type: string, listener: () => void): void {
    this.listeners.delete(listener);
  }
  fire(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

type Global = Record<string, unknown>;

const ORIGINAL_MATCH_MEDIA = Object.getOwnPropertyDescriptor(globalThis, 'matchMedia');
const ORIGINAL_LOCAL_STORAGE = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

function define(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}

function restore(name: string, desc: PropertyDescriptor | undefined): void {
  delete (globalThis as Global)[name];
  if (desc) Object.defineProperty(globalThis, name, desc);
}

/**
 * Installs a `matchMedia` that hands back one stable `FakeMql` per query string,
 * so a test can flip `matches` or fire the change listener the code registered.
 */
function installMatchMedia(matches: Record<string, boolean>): Map<string, FakeMql> {
  const cache = new Map<string, FakeMql>();
  define('matchMedia', (query: string): FakeMql => {
    let mql = cache.get(query);
    if (!mql) {
      mql = new FakeMql(matches[query] ?? false);
      cache.set(query, mql);
    }
    return mql;
  });
  return cache;
}

const COLOR_LIGHT = '(prefers-color-scheme: light)';
const REDUCE = '(prefers-reduced-motion: reduce)';

beforeEach(() => {
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('data-theme');
  restore('matchMedia', ORIGINAL_MATCH_MEDIA);
  restore('localStorage', ORIGINAL_LOCAL_STORAGE);
  globalThis.localStorage.clear();
});

afterEach(() => {
  restore('matchMedia', ORIGINAL_MATCH_MEDIA);
  restore('localStorage', ORIGINAL_LOCAL_STORAGE);
  globalThis.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

/* -------------------------------------------------------------------- esc */

describe('esc', () => {
  it('escapes every character that could break out of an innerHTML template', () => {
    expect(esc('<img src="x" onerror=alert(1)> & </img>')).toBe(
      '&lt;img src=&quot;x&quot; onerror=alert(1)&gt; &amp; &lt;/img&gt;',
    );
  });

  it('escapes the ampersand first, so an escaped entity is not double-decoded', () => {
    // If `<` were replaced before `&`, this would come out as `&amp;lt;`.
    expect(esc('&lt;')).toBe('&amp;lt;');
  });

  it('stringifies non-string input', () => {
    expect(esc(42)).toBe('42');
    expect(esc(null)).toBe('null');
    expect(esc(undefined)).toBe('undefined');
  });

  it('leaves safe text untouched', () => {
    expect(esc("Gimbal's dose meter")).toBe("Gimbal's dose meter");
  });
});

/* ---------------------------------------------------------------- el / all */

describe('el', () => {
  it('returns the first match, typed to the caller element', () => {
    document.body.innerHTML = '<div id="a" class="hit">first</div><div class="hit">second</div>';
    const found = el<HTMLDivElement>(document, '.hit');
    expect(found.id).toBe('a');
    expect(found.textContent).toBe('first');
  });

  it('scopes the query to the root it is given', () => {
    document.body.innerHTML = '<section id="outer"><p>out</p></section><div id="inner"><p>in</p></div>';
    const inner = el<HTMLDivElement>(document, '#inner');
    expect(el<HTMLParagraphElement>(inner, 'p').textContent).toBe('in');
  });

  it('throws a selector-named error when nothing matches', () => {
    document.body.innerHTML = '<div></div>';
    expect(() => el(document, '.nope')).toThrow('missing element: .nope');
  });
});

describe('all', () => {
  it('returns a real Array (not a live NodeList) of every match', () => {
    document.body.innerHTML = '<b class="x">1</b><b class="x">2</b><b class="x">3</b>';
    const found = all<HTMLElement>(document, '.x');
    expect(Array.isArray(found)).toBe(true);
    expect(found.map((node) => node.textContent)).toEqual(['1', '2', '3']);
    // Snapshot semantics: mutating the DOM must not change the array we handed out.
    document.body.innerHTML = '';
    expect(found).toHaveLength(3);
  });

  it('returns an empty array when nothing matches', () => {
    document.body.innerHTML = '<div></div>';
    expect(all(document, '.nope')).toEqual([]);
  });
});

/* --------------------------------------------------------- reducedMotion */

describe('reducedMotion', () => {
  it('reports true when the OS asks for reduced motion', () => {
    installMatchMedia({ [REDUCE]: true });
    expect(reducedMotion()).toBe(true);
  });

  it('reports false when the OS does not', () => {
    installMatchMedia({ [REDUCE]: false });
    expect(reducedMotion()).toBe(false);
  });

  it('falls back to false where matchMedia does not exist', () => {
    define('matchMedia', undefined);
    expect(reducedMotion()).toBe(false);
  });
});

/* --------------------------------------------------------- whyDisclosure */

describe('whyDisclosure', () => {
  it('renders a details/summary disclosure carrying the source text', () => {
    document.body.innerHTML = whyDisclosure('Herdman 2007, Table 3');
    const details = el<HTMLDetailsElement>(document, 'details');
    expect(details.hasAttribute('id')).toBe(false);
    // Collapsed by default in the DOM; the print stylesheet is what forces it open.
    expect(details.open).toBe(false);
    expect(el(details, 'summary').textContent).toBe('Why?');
    expect(el(details, '.disclosure-body').textContent).toBe('Herdman 2007, Table 3');
  });

  it('applies the optional id', () => {
    document.body.innerHTML = whyDisclosure('source', 'why-dose');
    expect(el<HTMLDetailsElement>(document, 'details').id).toBe('why-dose');
  });

  it('escapes both the id and the source, so a citation cannot inject markup', () => {
    document.body.innerHTML = whyDisclosure('<script>x</script>', 'a"b');
    const details = el<HTMLDetailsElement>(document, 'details');
    expect(details.getAttribute('id')).toBe('a"b');
    expect(details.querySelector('script')).toBeNull();
    expect(el(details, '.disclosure-body').textContent).toBe('<script>x</script>');
  });
});

/* -------------------------------------------------------------- loadTheme */

describe('loadTheme', () => {
  it('returns a stored theme that is one of the three names', () => {
    for (const theme of THEMES) {
      globalThis.localStorage.setItem(THEME_KEY, theme);
      expect(loadTheme()).toBe(theme);
    }
  });

  it('returns null when nothing is stored', () => {
    expect(loadTheme()).toBeNull();
  });

  it('returns null for a stored value that is not a known theme', () => {
    globalThis.localStorage.setItem(THEME_KEY, 'neon');
    expect(loadTheme()).toBeNull();
  });

  it('returns null when storage throws (Safari private mode)', () => {
    define('localStorage', {
      getItem(): string {
        throw new Error('SecurityError');
      },
    });
    expect(loadTheme()).toBeNull();
  });

  it('returns null where localStorage does not exist at all', () => {
    define('localStorage', undefined);
    expect(loadTheme()).toBeNull();
  });
});

/* --------------------------------------------------------- effectiveTheme */

describe('effectiveTheme', () => {
  it('prefers the stored theme over the OS', () => {
    installMatchMedia({ [COLOR_LIGHT]: true });
    globalThis.localStorage.setItem(THEME_KEY, 'dim');
    expect(effectiveTheme()).toBe('dim');
  });

  it('follows a light OS when nothing is stored', () => {
    installMatchMedia({ [COLOR_LIGHT]: true });
    expect(effectiveTheme()).toBe('light');
  });

  it('falls back to dark on a non-light OS', () => {
    installMatchMedia({ [COLOR_LIGHT]: false });
    expect(effectiveTheme()).toBe('dark');
  });

  it('falls back to dark where matchMedia does not exist', () => {
    define('matchMedia', undefined);
    expect(effectiveTheme()).toBe('dark');
  });

  it('does not write anything to storage — absence is what keeps the page following the OS', () => {
    installMatchMedia({ [COLOR_LIGHT]: true });
    expect(effectiveTheme()).toBe('light');
    expect(globalThis.localStorage.getItem(THEME_KEY)).toBeNull();
  });
});

/* ------------------------------------------------------------- applyTheme */

describe('applyTheme', () => {
  it('paints the root element and persists the choice', () => {
    applyTheme('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(globalThis.localStorage.getItem(THEME_KEY)).toBe('light');
  });

  it('still paints when storage throws — the session works, only the preference is lost', () => {
    define('localStorage', {
      setItem(): void {
        throw new Error('QuotaExceededError');
      },
    });
    expect(() => applyTheme('dim')).not.toThrow();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dim');
  });

  it('still paints where localStorage does not exist', () => {
    define('localStorage', undefined);
    applyTheme('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});

/* --------------------------------------------------------- themePickerHtml */

describe('themePickerHtml', () => {
  function radios(): HTMLInputElement[] {
    return all<HTMLInputElement>(document, 'input[name="theme"]');
  }

  it('renders one radio per theme, in order, inside a labelled fieldset', () => {
    installMatchMedia({ [COLOR_LIGHT]: false });
    document.body.innerHTML = themePickerHtml('dim');
    const fieldset = el<HTMLFieldSetElement>(document, 'fieldset.theme-picker');
    // The group name is present for screen readers but visually hidden.
    const legend = el<HTMLLegendElement>(fieldset, 'legend');
    expect(legend.textContent).toBe('Theme');
    expect(legend.classList.contains('visually-hidden')).toBe(true);
    expect(radios().map((input) => input.value)).toEqual(['dim', 'dark', 'light']);
    expect(radios().map((input) => input.type)).toEqual(['radio', 'radio', 'radio']);
    expect(all<HTMLElement>(fieldset, 'label span').map((s) => s.textContent)).toEqual([
      'Dim',
      'Dark',
      'Light',
    ]);
  });

  it('every radio is inside its own label, so the visible text is the accessible name', () => {
    installMatchMedia({ [COLOR_LIGHT]: false });
    document.body.innerHTML = themePickerHtml('dark');
    for (const input of radios()) {
      expect(input.closest('label')).not.toBeNull();
    }
  });

  it('checks exactly the theme it was given', () => {
    installMatchMedia({ [COLOR_LIGHT]: false });
    for (const theme of THEMES) {
      document.body.innerHTML = themePickerHtml(theme);
      const checked = radios().filter((input) => input.checked);
      expect(checked.map((input) => input.value)).toEqual([theme]);
    }
  });

  it('never reports "nothing selected": a null theme resolves to the OS palette (light)', () => {
    installMatchMedia({ [COLOR_LIGHT]: true });
    document.body.innerHTML = themePickerHtml(null);
    expect(radios().filter((input) => input.checked).map((input) => input.value)).toEqual(['light']);
  });

  it('never reports "nothing selected": a null theme resolves to the OS palette (dark)', () => {
    installMatchMedia({ [COLOR_LIGHT]: false });
    document.body.innerHTML = themePickerHtml(null);
    expect(radios().filter((input) => input.checked).map((input) => input.value)).toEqual(['dark']);
  });
});

/* --------------------------------------------------------- wireThemePicker */

describe('wireThemePicker', () => {
  function radios(): HTMLInputElement[] {
    return all<HTMLInputElement>(document, 'input[name="theme"]');
  }
  function radio(value: string): HTMLInputElement {
    return el<HTMLInputElement>(document, `input[name="theme"][value="${value}"]`);
  }

  it('applies the theme when a radio becomes checked', () => {
    installMatchMedia({ [COLOR_LIGHT]: false });
    document.body.innerHTML = themePickerHtml(null);
    wireThemePicker(document);

    const light = radio('light');
    light.checked = true;
    light.dispatchEvent(new Event('change'));

    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(globalThis.localStorage.getItem(THEME_KEY)).toBe('light');
  });

  it('ignores a change event on a radio that is not checked (the one being deselected)', () => {
    installMatchMedia({ [COLOR_LIGHT]: false });
    document.body.innerHTML = themePickerHtml(null);
    wireThemePicker(document);

    const dark = radio('dark');
    dark.checked = false;
    dark.dispatchEvent(new Event('change'));

    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(globalThis.localStorage.getItem(THEME_KEY)).toBeNull();
  });

  it('re-checks the radio when the OS flips and no theme has been stored', () => {
    const media = installMatchMedia({ [COLOR_LIGHT]: false });
    document.body.innerHTML = themePickerHtml(null);
    wireThemePicker(document);
    expect(radios().filter((i) => i.checked).map((i) => i.value)).toEqual(['dark']);

    const mql = media.get(COLOR_LIGHT);
    expect(mql).toBeDefined();
    mql!.matches = true;
    mql!.fire();

    expect(radios().filter((i) => i.checked).map((i) => i.value)).toEqual(['light']);
    // Following the OS must not silently create a stored preference.
    expect(globalThis.localStorage.getItem(THEME_KEY)).toBeNull();
  });

  it('leaves the radios alone when a theme HAS been stored', () => {
    const media = installMatchMedia({ [COLOR_LIGHT]: false });
    globalThis.localStorage.setItem(THEME_KEY, 'dim');
    document.body.innerHTML = themePickerHtml('dim');
    wireThemePicker(document);

    const mql = media.get(COLOR_LIGHT)!;
    mql.matches = true;
    mql.fire();

    expect(radios().filter((i) => i.checked).map((i) => i.value)).toEqual(['dim']);
  });

  it('detaches its own OS listener once the picker has left the document', () => {
    const media = installMatchMedia({ [COLOR_LIGHT]: false });
    document.body.innerHTML = themePickerHtml(null);
    wireThemePicker(document);

    const mql = media.get(COLOR_LIGHT)!;
    expect(mql.listeners.size).toBe(1);

    // The app re-renders the settings row on every screen transition.
    document.body.innerHTML = '';
    mql.fire();

    expect(mql.listeners.size).toBe(0);
  });

  it('does not accumulate listeners across screen transitions', () => {
    const media = installMatchMedia({ [COLOR_LIGHT]: false });
    const mql = installedMql(media);

    for (let i = 0; i < 4; i += 1) {
      document.body.innerHTML = themePickerHtml(null);
      wireThemePicker(document);
      mql.fire(); // dead pickers unsubscribe themselves here
    }

    expect(mql.listeners.size).toBe(1);
    expect(radios().filter((i) => i.checked).map((i) => i.value)).toEqual(['dark']);
  });

  it('wires the change handler even where matchMedia does not exist', () => {
    define('matchMedia', undefined);
    document.body.innerHTML = themePickerHtml('dim');
    expect(() => wireThemePicker(document)).not.toThrow();

    const dim = radio('dim');
    dim.checked = true;
    dim.dispatchEvent(new Event('change'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dim');
  });

  it('is a no-op on a root with no theme radios', () => {
    installMatchMedia({ [COLOR_LIGHT]: false });
    document.body.innerHTML = '<div class="empty"></div>';
    expect(() => wireThemePicker(el(document, '.empty'))).not.toThrow();
  });
});

/** Forces the color-scheme query to exist so the test can hold the same object the code gets. */
function installedMql(media: Map<string, FakeMql>): FakeMql {
  (globalThis as unknown as { matchMedia: (q: string) => FakeMql }).matchMedia(COLOR_LIGHT);
  return media.get(COLOR_LIGHT)!;
}

/* ------------------------------------------------- APP_MARK_SVG / settings */

describe('APP_MARK_SVG', () => {
  it('is hidden from assistive tech and unreachable by keyboard', () => {
    document.body.innerHTML = APP_MARK_SVG;
    const svg = el<SVGSVGElement>(document, 'svg.app-mark');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('focusable')).toBe('false');
    expect(svg.getAttribute('viewBox')).toBe('0 0 40 40');
  });

  it('draws the sweep, the prescribed band and the refused marker in theme tokens', () => {
    document.body.innerHTML = APP_MARK_SVG;
    const strokes = all<SVGElement>(document, 'svg.app-mark [stroke]').map((node) =>
      node.getAttribute('stroke'),
    );
    expect(strokes).toEqual(['var(--edge-strong)', 'var(--zone-in)', 'var(--refused)']);
    // Inline, not <img src>: an external SVG cannot read the page's custom properties.
    expect(APP_MARK_SVG).not.toContain('<img');
    expect(all(document, 'svg.app-mark circle')).toHaveLength(2);
    expect(all(document, 'svg.app-mark line')).toHaveLength(1);
  });
});

describe('settingsRow', () => {
  it('renders the brand and the picker, and is excluded from print', () => {
    installMatchMedia({ [COLOR_LIGHT]: false });
    document.body.innerHTML = settingsRow('light');

    const row = el<HTMLDivElement>(document, '.settings-row');
    expect(row.classList.contains('no-print')).toBe(true);
    expect(el(row, '.app-brand .wordmark').textContent).toBe('Gimbal');
    expect(el(row, 'svg.app-mark').getAttribute('aria-hidden')).toBe('true');
    expect(
      all<HTMLInputElement>(row, 'input[name="theme"]')
        .filter((input) => input.checked)
        .map((input) => input.value),
    ).toEqual(['light']);
  });

  // Regression: the brand was a <span>, so `/app` had no route back to `/` —
  // `href="/"` appeared nowhere in src/ or app/. The mark and the wordmark read
  // as a home affordance on every site, so a reader clicks them and nothing
  // happens. It is an anchor now, and this asserts it stays one.
  it('makes the brand a labelled link home, so /app is not a dead end', () => {
    installMatchMedia({ [COLOR_LIGHT]: false });
    document.body.innerHTML = settingsRow('light');

    const brand = el<HTMLAnchorElement>(document, '.app-brand');
    expect(brand.tagName).toBe('A');
    expect(brand.getAttribute('href')).toBe('/');
    // The mark is aria-hidden, so the link carries its own accessible name.
    expect(brand.getAttribute('aria-label')).toBe('Gimbal, home');
  });

  it('resolves a null theme through the OS, so the row never paints an empty picker', () => {
    installMatchMedia({ [COLOR_LIGHT]: true });
    document.body.innerHTML = settingsRow(null);
    expect(
      all<HTMLInputElement>(document, '.settings-row input[name="theme"]')
        .filter((input) => input.checked)
        .map((input) => input.value),
    ).toEqual(['light']);
  });
});
