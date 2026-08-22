import type { PersistedSession } from '../store/session.ts';

/**
 * The dose-trend sparkline.
 *
 * Example points are HOLLOW with a DASHED connector; live points are solid.
 * Encoded by shape and fill, NEVER by colour alone — so it survives monochrome
 * print, deuteranopia, and a photocopier in a clinic.
 */
export function sparklineSvg(sessions: readonly PersistedSession[]): string {
  if (sessions.length === 0) {
    return '<svg class="sparkline" aria-hidden="true" viewBox="0 0 100 40"></svg>';
  }
  const w = 100;
  const h = 40;
  const pad = 4;
  const n = sessions.length;
  const x = (i: number): number => (n === 1 ? w / 2 : pad + (i * (w - 2 * pad)) / (n - 1));
  const y = (ratio: number): number => h - pad - Math.max(0, Math.min(1, ratio)) * (h - 2 * pad);

  const points = sessions.map((s, i) => `${x(i).toFixed(2)},${y(s.totals.ratio).toFixed(2)}`).join(' ');
  const anyExample = sessions.some((s) => s.provenance === 'example');

  const dots = sessions
    .map((s, i) => {
      const cx = x(i).toFixed(2);
      const cy = y(s.totals.ratio).toFixed(2);
      return s.provenance === 'example'
        ? `<circle cx="${cx}" cy="${cy}" r="1.8" fill="none" stroke="var(--ink-2)" stroke-width="0.7" />`
        : `<circle cx="${cx}" cy="${cy}" r="1.8" fill="var(--ink-1)" stroke="var(--ink-1)" stroke-width="0.7" />`;
    })
    .join('');

  return `<svg class="sparkline" viewBox="0 0 ${w} ${h}" role="img"
       aria-label="Delivered dose ratio across ${n} sessions on this device">
  <polyline points="${points}" fill="none" stroke="var(--ink-2)" stroke-width="0.8"
            ${anyExample ? 'stroke-dasharray="2 1.5"' : ''} />
  ${dots}
</svg>`;
}

export function sparklineLegend(sessions: readonly PersistedSession[]): string {
  const hasExample = sessions.some((s) => s.provenance === 'example');
  const hasLive = sessions.some((s) => s.provenance === 'live');
  const parts: string[] = [];
  if (hasLive) parts.push('solid point = your own session');
  if (hasExample) parts.push('hollow point on a dashed line = EXAMPLE, recorded by the developer');
  return parts.join(' · ');
}
