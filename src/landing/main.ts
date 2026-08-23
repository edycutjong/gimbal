import '../styles/fonts.css';
import '../styles/tokens.css';
import '../styles/themes.css';
import '../styles/screen.css';
import '../styles/landing.css';

import { loadTheme, applyTheme, themePickerHtml, all, el, type ThemeName } from '../ui/dom.ts';
import { mountReplay } from './replay.ts';
import { bandFigure, reportFigure } from './figures.ts';

/**
 * The landing page.
 *
 * `/` explains the instrument; `/app` is the instrument. Serving the app at the
 * root meant a judge's first screen was eight empty required fields with no
 * prescription to type into them, which is the correct product behaviour and the
 * wrong front door.
 *
 * ALL PROSE IS STATIC HTML in `index.html`. This module adds exactly three
 * things: the theme picker (shared with the app, so a photophobic reader's
 * choice survives the click through to `/app`), the two diagrams, and the hero
 * replay. If this script fails to run, every word on the page is still there.
 *
 * No router, no framework, no hydration — the same reasoning as the app.
 */

/**
 * `/` IS DARK BY DEFAULT; `/app` STILL FOLLOWS THE OS.
 *
 * The three palettes exist for a photophobic patient reading an instrument at
 * 60 cm in a dark room. On the landing page the warm-paper palette is a clinical
 * print surface being asked to be a hero, and it is the weakest of the three
 * there — so `/` picks one and commits to it, which is a design decision about
 * one page rather than a change to the product's accessibility contract.
 *
 * WHAT IS NOT DONE HERE, deliberately:
 *
 *   · Nothing is written to storage. `applyTheme` persists, and persisting
 *     "dark" on arrival would silently overwrite a reader's OS preference for
 *     `/app` too — the page they will actually exercise in. The attribute is set
 *     directly instead, so a first visit to `/` is dark and `/app` is still
 *     whatever the machine asks for.
 *
 *   · The OS is not watched. `wireThemePicker` re-checks the radio when
 *     `prefers-color-scheme` flips, which is right on a surface that follows the
 *     OS and wrong on one that does not: it would tick "Light" on a page that
 *     had stayed dark. The three change listeners below are the whole of the
 *     wiring this page needs.
 *
 * `index.html` carries `data-theme="dark"` on the element so the first paint is
 * already correct — the CSP forbids an inline script, and a module runs too late
 * to prevent a full-brightness flash. This line only matters when a STORED
 * preference has to replace it.
 */
const stored = loadTheme();
const shown: ThemeName = stored ?? 'dark';
document.documentElement.setAttribute('data-theme', shown);

const themeSlot = el<HTMLElement>(document, '#theme-slot');
themeSlot.innerHTML = themePickerHtml(shown);
for (const input of all<HTMLInputElement>(themeSlot, 'input[name="theme"]')) {
  input.addEventListener('change', () => {
    // A deliberate pick DOES persist, and travels with the reader into `/app`.
    if (input.checked) applyTheme(input.value as ThemeName);
  });
}

el<HTMLElement>(document, '#band-figure').innerHTML = bandFigure();
el<HTMLElement>(document, '#report-figure').innerHTML = reportFigure();

mountReplay(el<HTMLElement>(document, '#replay-slot'), el<HTMLElement>(document, '#chapter-slot'));
