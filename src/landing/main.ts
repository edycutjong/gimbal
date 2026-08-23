import '../styles/fonts.css';
import '../styles/tokens.css';
import '../styles/themes.css';
import '../styles/screen.css';
import '../styles/landing.css';

import { loadTheme, applyTheme, themePickerHtml, wireThemePicker, el } from '../ui/dom.ts';
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
 * No router, no framework, no hydration — the same reasoning as the app, and the
 * same four style sheets, so the landing page cannot drift into being a
 * different product visually.
 */

const theme = loadTheme();
if (theme) applyTheme(theme);

const themeSlot = el<HTMLElement>(document, '#theme-slot');
themeSlot.innerHTML = themePickerHtml(theme);
wireThemePicker(themeSlot);

el<HTMLElement>(document, '#band-figure').innerHTML = bandFigure();
el<HTMLElement>(document, '#report-figure').innerHTML = reportFigure();

mountReplay(el<HTMLElement>(document, '#replay-slot'));
