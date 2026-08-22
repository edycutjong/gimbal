import type { ScoredCycle } from '../dsp/types.ts';

/**
 * The cycle strip.
 *
 * A refused rep is drawn as an ABSENCE — an unfilled, hatched cell — and named
 * in words. The dose numeral simply does not advance. That is the correct
 * emotional register: the ledger has a hole in it, and the hole has a reason.
 *
 * Not red. Red says "you did something wrong". Half of all refusals in practice
 * are `low-confidence` and `face-lost` — the INSTRUMENT's problem, not the
 * patient's — and telling a patient who slowed down because they got dizzy that
 * they made an error is clinically backwards.
 *
 * Not a flash, not a shake, not a buzz either: a screen-shake in front of a
 * dizzy user is indefensible, and WCAG 2.3.1's three-flash threshold is a hard
 * constraint in this population.
 */
const NS = 'http://www.w3.org/2000/svg';

export const STRIP_DEFS = `<defs>
  <pattern id="refused-hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
    <line x1="0" y1="0" x2="0" y2="4" stroke="var(--refused)" stroke-width="1.5" />
  </pattern>
</defs>`;

export class CycleStrip {
  private cells = 0;

  constructor(
    private readonly svg: SVGSVGElement,
    private readonly maxCells = 240,
    private readonly reducedMotion = false,
  ) {
    this.svg.setAttribute('viewBox', `0 0 ${maxCells} 20`);
    this.svg.setAttribute('preserveAspectRatio', 'none');
    this.svg.setAttribute('aria-hidden', 'true');
    this.svg.innerHTML = STRIP_DEFS;
  }

  add(cycle: ScoredCycle): void {
    if (this.cells >= this.maxCells) return;
    const x = this.cells;
    const rect = document.createElementNS(NS, 'rect');
    rect.setAttribute('x', String(x));
    rect.setAttribute('width', '0.85');

    if (cycle.credited) {
      rect.setAttribute('y', '0');
      rect.setAttribute('height', '20');
      rect.setAttribute('fill', 'var(--zone-in)');
      rect.setAttribute('stroke', 'none');
    } else {
      // Outline-only at 45 % height with a 45° hatch. It is a HOLE, not a mark.
      rect.setAttribute('y', String(20 * 0.275));
      rect.setAttribute('height', String(20 * 0.45));
      rect.setAttribute('fill', 'url(#refused-hatch)');
      rect.setAttribute('stroke', 'var(--refused)');
      rect.setAttribute('stroke-width', '0.15');
    }
    rect.setAttribute('data-reason', cycle.reason);
    if (!this.reducedMotion) rect.style.transition = 'height 120ms ease';
    this.svg.appendChild(rect);
    this.cells += 1;
  }

  clear(): void {
    this.svg.innerHTML = STRIP_DEFS;
    this.cells = 0;
  }
}

/** The report's static version: one rect per cycle, rendered from the stored series. */
export function stripSvg(cycles: readonly ScoredCycle[]): string {
  const n = Math.max(1, cycles.length);
  const parts = cycles.map((c, i) =>
    c.credited
      ? `<rect x="${i}" y="0" width="0.85" height="20" fill="var(--zone-in)" stroke="var(--zone-in)" stroke-width="0.1" />`
      : `<rect x="${i}" y="5.5" width="0.85" height="9" fill="none" stroke="var(--refused)" stroke-width="0.15" />`,
  );
  return `<svg class="cycle-strip" viewBox="0 0 ${n} 20" preserveAspectRatio="none" aria-hidden="true">${STRIP_DEFS}${parts.join('')}</svg>`;
}
