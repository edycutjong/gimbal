import { createDial, bindDial, Dial } from '../ui/dial.ts';
import { INSTRUMENT_LIMITS } from '../dsp/limits.ts';
import { REASON_LABELS } from '../ui/copy.ts';
import { esc, el, all, reducedMotion } from '../ui/dom.ts';
import {
  TRACE,
  CHAPTERS,
  chapterFor,
  deliveredAfter,
  ILLUSTRATION_CARD,
  PRESCRIBED_SECONDS,
  CREDITED_COUNT,
  REPLAY_MS_PER_CYCLE,
  REPLAY_SLOWDOWN,
} from './trace.ts';

/**
 * The hero replay — the refusal, drawn.
 *
 * THREE RULES GOVERN THIS COMPONENT.
 *
 * 1. It is labelled, permanently and at body size, as an illustration of the
 *    scoring rule rather than a measurement. The label is not a tooltip, not a
 *    footnote and not smaller than the surrounding text.
 *
 * 2. It is built from the instrument's own parts. The ring is `createDial` and
 *    `Dial` from `src/ui/dial.ts`, at the real geometry; the verdicts come from
 *    `scoreCycle`; the sentences from `refusalSentence`; the outcome names from
 *    `REASON_LABELS`. Nothing here re-decides a behaviour in order to depict it.
 *
 *    ONE DELIBERATE EXCEPTION, recorded rather than hidden: the cycle strip is
 *    drawn as ten HTML cells rather than by `CycleStrip`. That component renders
 *    into an SVG with `preserveAspectRatio="none"`, which is right for the block
 *    screen — 240 four-pixel cells, where the distortion is invisible — and
 *    wrong here, where ten cells stretched across a hero panel would shear the
 *    45° refusal hatch into horizontal mush. The RULE is what is being depicted
 *    and the rule is unchanged: a credited cycle is a solid block, a refused one
 *    is an outlined hatched hole at 45 % height, and neither is ever red.
 *
 * 3. MOTION IS OPT-OUT-ABLE AND OPT-IN-ABLE. This is a concussion product and
 *    autoplay motion is symptom-provoking in this population, so:
 *      · `prefers-reduced-motion` starts PAUSED, seeded at the first refusal, so
 *        the whole point is legible without a single frame of movement;
 *      · everyone gets a visible pause control as the first control in the group;
 *      · a step control walks the trace one cycle at a time with no tweening;
 *      · the replay pauses itself when it scrolls out of view or the tab is
 *        hidden, and does not silently restart when it comes back.
 *    There is also a text transcript, always present, carrying every sentence
 *    the panel prints — which is what makes the panel safe to hide from
 *    assistive technology rather than have it narrate at 40 events a minute.
 */

const RING_MAX = ILLUSTRATION_CARD.peakVelocityCeiling.value + ILLUSTRATION_CARD.peakVelocityFloor.value;
const FLOOR = ILLUSTRATION_CARD.peakVelocityFloor.value;
const CEILING = ILLUSTRATION_CARD.peakVelocityCeiling.value;

/** |ω| over one cycle: two sweeps, so two humps. Deterministic, no randomness. */
function omegaAt(peak: number, u: number): number {
  return peak * Math.abs(Math.sin(2 * Math.PI * u));
}

function stripHtml(): string {
  const cells = TRACE.map(
    (c) => `<li data-state="pending" data-cell="${c.index}"><span class="visually-hidden">Rep ${c.index + 1}</span></li>`,
  ).join('');
  return `<ol class="lp-strip" id="rp-strip">${cells}</ol>`;
}

function transcriptHtml(): string {
  const rows = TRACE.map((c) => {
    const verdict = c.credited
      ? `credited · +${c.doseSeconds.toFixed(1)} s`
      : `refused · ${esc(c.sentence)}`;
    return `<li><span class="lp-tr-n tnum">Rep ${c.index + 1}</span>
      <span class="lp-tr-v tnum">${c.peakOmega} °/s</span>
      <span class="lp-tr-t">${verdict}</span></li>`;
  }).join('');
  // Counted, not typed: "the four refused reps" was a literal in the one module
  // whose entire claim is that nothing here is decided by hand.
  const refused = TRACE.length - CREDITED_COUNT;
  return `<ol class="lp-transcript">${rows}</ol>
    <p>Total: ${CREDITED_COUNT} of ${TRACE.length} reps credited,
      ${deliveredAfter(TRACE.length).toFixed(1)} seconds of the
      ${PRESCRIBED_SECONDS} prescribed. The ${refused} refused reps contribute exactly zero.</p>`;
}

export function mountReplay(host: HTMLElement): void {
  const reduce = reducedMotion();
  const dial = createDial(ILLUSTRATION_CARD);

  host.innerHTML = `
  <figure class="lp-replay">
    <p class="lp-replay-tag">
      <span class="chip">Illustration</span>
      <span>Not a measurement. A scripted ten-cycle trace, scored by the same <code>scoreCycle()</code> the instrument runs.</span>
    </p>

    <div class="lp-replay-panel" role="img" aria-label="A velocity dial, a delivered-dose readout, a tracking-quality bar and a strip of one cell per repetition. The text equivalent is below the controls.">
      <div class="lp-replay-dial">
        <div class="ring-stage">${dial.html}</div>
        <p class="lp-replay-scale">
          <span class="tnum">0</span>
          <span class="lp-replay-band tnum">${FLOOR}–${CEILING} °/s</span>
          <span class="tnum">${RING_MAX}</span>
        </p>
        <p class="lp-replay-scalenote">peak head velocity, °/s</p>
      </div>

      <div class="lp-replay-readout">
        <p class="lp-readout-label">Delivered dose</p>
        <p class="lp-readout-value"><span id="rp-dose" class="tnum">0.0</span><span class="lp-readout-unit">s in zone</span></p>
        <p class="lp-readout-sub">
          of <span class="tnum">${PRESCRIBED_SECONDS}</span> s prescribed ·
          <span id="rp-credited" class="tnum">0</span> of <span class="tnum">${TRACE.length}</span> reps credited
        </p>

        <p class="lp-quality-label"><span>Tracking quality</span><span id="rp-q" class="tnum">0.91</span></p>
        <div class="lp-quality">
          <div class="lp-quality-fill" id="rp-qfill"></div>
          <div class="lp-quality-floor" style="left:${(INSTRUMENT_LIMITS.qFloor * 100).toFixed(1)}%"></div>
        </div>
        <p class="lp-quality-note">floor ${INSTRUMENT_LIMITS.qFloor} — below it a cycle is refused, not smoothed</p>
      </div>

      <div class="lp-replay-foot">
        <p class="lp-replay-status" id="rp-status" data-refused="false"></p>
        ${stripHtml()}
        <p class="lp-strip-note">one cell per rep · block credited, hatched hole refused</p>
      </div>
    </div>

    <p class="lp-chapter">
      <span class="lp-chapter-title" id="rp-ch-title">Below the band</span>
      <span class="lp-chapter-detail" id="rp-ch-detail">${esc(CHAPTERS[0]?.detail ?? '')}</span>
    </p>

    <div class="lp-replay-controls">
      <button type="button" id="rp-play" class="lp-ctl lp-ctl-wide" aria-pressed="false"></button>
      <button type="button" id="rp-step" class="lp-ctl">Step one rep</button>
      <button type="button" id="rp-reset" class="lp-ctl">Restart</button>
      <p class="lp-replay-speed">1/${REPLAY_SLOWDOWN} speed</p>
    </div>

    <figcaption class="lp-replay-cap">
      ${reduce ? '<strong>Motion is off because your system asks for reduced motion.</strong> The first refusal is already on the board — use <em>Step one rep</em> to walk the rest. ' : ''}Ten
      peak velocities and ten tracking-quality values are the only things written by hand here.
      Every verdict, sentence and number downstream of them is produced by the instrument's own code.
    </figcaption>

    <details class="lp-replay-text">
      <summary>The same trace, as text</summary>
      <div class="disclosure-body">
        <p>Real cycles at the centre of this card's band last 0.5 s — faster than the refusal
          sentence can be read — so the replay runs at a third of that rate. Nothing else is altered.</p>
        ${transcriptHtml()}
      </div>
    </details>
  </figure>`;

  const els = bindDial(host);
  if (!els) return;
  const ring = new Dial(els, dial.max, reduce);

  const cells = all<HTMLElement>(host, '.lp-strip li');
  const doseEl = el<HTMLElement>(host, '#rp-dose');
  const creditedEl = el<HTMLElement>(host, '#rp-credited');
  const statusEl = el<HTMLElement>(host, '#rp-status');
  const qEl = el<HTMLElement>(host, '#rp-q');
  const qFill = el<HTMLElement>(host, '#rp-qfill');
  const chTitle = el<HTMLElement>(host, '#rp-ch-title');
  const chDetail = el<HTMLElement>(host, '#rp-ch-detail');
  const playBtn = el<HTMLButtonElement>(host, '#rp-play');
  const stepBtn = el<HTMLButtonElement>(host, '#rp-step');
  const resetBtn = el<HTMLButtonElement>(host, '#rp-reset');

  /** Cycles already committed to the strip. */
  let committed = 0;
  let playing = false;
  let raf = 0;
  let cycleStartMs = 0;
  /** Stops the intersection observer restarting a replay the reader chose to stop. */
  let userPaused = reduce;

  const setChapter = (index: number): void => {
    const c = chapterFor(index);
    chTitle.textContent = c.title;
    chDetail.textContent = c.detail;
  };

  const setQuality = (q: number): void => {
    qEl.textContent = q.toFixed(2);
    qFill.style.width = `${(q * 100).toFixed(1)}%`;
    qFill.dataset.below = String(q < INSTRUMENT_LIMITS.qFloor);
  };

  /** Commits cycle `index`: marker, strip cell, dose, status line, chapter. */
  const commit = (index: number): void => {
    const c = TRACE[index];
    if (!c) return;
    ring.setCommitted(c.peakOmega, c.credited);

    const cell = cells[index];
    if (cell) {
      cell.dataset.state = c.credited ? 'credited' : 'refused';
      cell.title = `Rep ${index + 1} · ${c.peakOmega} °/s · ${REASON_LABELS[c.reason]}`;
    }

    setQuality(c.qMin);
    committed = index + 1;
    doseEl.textContent = deliveredAfter(committed).toFixed(1);
    creditedEl.textContent = String(TRACE.slice(0, committed).filter((x) => x.credited).length);
    // In-zone says nothing. The status line only ever carries a refusal, which
    // is why the silence reads as information rather than as a missing feature.
    statusEl.textContent = c.sentence || 'In the band. Nothing to report.';
    statusEl.dataset.refused = String(!c.credited);
    setChapter(index);
  };

  /** Everything back to nothing. Never a resting state — see `reset`. */
  const clear = (): void => {
    committed = 0;
    for (const cell of cells) {
      cell.dataset.state = 'pending';
      cell.removeAttribute('title');
    }
    ring.setCommitted(0, false);
    els.marker.setAttribute('opacity', '0');
    ring.setLive(0, false, 0);
    doseEl.textContent = '0.0';
    creditedEl.textContent = '0';
    statusEl.textContent = 'Waiting for the first full cycle.';
    statusEl.dataset.refused = 'false';
    setQuality(TRACE[0]?.qMin ?? 0.9);
    setChapter(0);
    cycleStartMs = 0;
  };

  /**
   * ONE PICTURE, NOT THREE.
   *
   * `reset` seeds the first refusal rather than leaving the panel blank, and it
   * is the ONLY entry into a resting state: first paint, the Restart button and
   * the end-of-trace loop all land here, so the three of them are the same
   * frame. Before this, Restart and the loop-around left an empty ring reading
   * "Waiting for the first full cycle" while the chapter beneath it still said
   * "Below the band — the marker snaps off the top and goes slate, the strip
   * takes a hatched hole": a caption describing three things that were not on
   * screen. A component that contradicts its own caption in one of its states
   * is worse than one that never had a caption.
   *
   * It is also the state the page is FOR. An empty ring is what a reader saw
   * for the first second and a half, which is most of the attention this page
   * gets; the refusal is the argument.
   */
  const reset = (): void => {
    clear();
    const first = TRACE[0];
    if (!first) return;
    ring.setLive(first.peakOmega, false, 0);
    commit(0);
  };

  const frame = (now: number): void => {
    if (!playing) return;
    if (cycleStartMs === 0) cycleStartMs = now;
    const elapsed = now - cycleStartMs;
    const index = committed;
    const c = TRACE[index];

    if (!c) {
      // End of trace: hold the finished state for a beat, then start over so a
      // reader who arrives mid-cycle still sees the beginning.
      if (elapsed > REPLAY_MS_PER_CYCLE * 2) {
        reset();
        cycleStartMs = now;
      }
      raf = requestAnimationFrame(frame);
      return;
    }

    const u = Math.min(1, elapsed / REPLAY_MS_PER_CYCLE);
    const omega = omegaAt(c.peakOmega, u);
    const inBand = omega >= FLOOR && omega <= CEILING && c.qMin >= INSTRUMENT_LIMITS.qFloor;
    ring.setLive(omega, inBand, now);

    if (u >= 1) {
      commit(index);
      cycleStartMs = now;
    }
    raf = requestAnimationFrame(frame);
  };

  const setPlaying = (next: boolean): void => {
    playing = next;
    playBtn.textContent = next ? 'Pause the illustration' : 'Play the illustration';
    playBtn.setAttribute('aria-pressed', String(next));
    if (next) {
      cycleStartMs = 0;
      raf = requestAnimationFrame(frame);
    } else {
      cancelAnimationFrame(raf);
      // Paused, the live arc HOLDS the last committed peak rather than freezing
      // at whatever instant of the sweep the click landed on — the same rule the
      // block screen's pause follows, and the difference between a paused
      // instrument and a broken one.
      const last = TRACE[committed - 1];
      if (last) ring.setLive(last.peakOmega, last.credited, performance.now());
    }
  };

  playBtn.addEventListener('click', () => {
    userPaused = playing;
    setPlaying(!playing);
  });

  stepBtn.addEventListener('click', () => {
    if (playing) {
      userPaused = true;
      setPlaying(false);
    }
    if (committed >= TRACE.length) reset();
    const index = committed;
    const c = TRACE[index];
    if (c) ring.setLive(c.peakOmega, c.credited, performance.now());
    commit(index);
  });

  resetBtn.addEventListener('click', () => {
    reset();
    if (playing) cycleStartMs = 0;
  });

  // Nothing runs while the panel is off screen or the tab is hidden. Cheap, and
  // it means a page left open in a background tab is not quietly animating.
  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries.some((e) => e.isIntersecting);
      if (!visible && playing) setPlaying(false);
      else if (visible && !playing && !userPaused) setPlaying(true);
    },
    { threshold: 0.2 },
  );
  observer.observe(host);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && playing) setPlaying(false);
  });

  /**
   * FIRST PAINT IS ALREADY THE POINT, for everyone.
   *
   * `reset()` seeds the moment the whole product is about — one refusal
   * committed, the marker slate and off the top, one hatched hole in the strip,
   * the sentence printed, the dose still 0.0 — and it is the same call the
   * Restart button and the end-of-trace loop make, so there is exactly one
   * resting picture rather than one per entry point.
   *
   * Under reduced motion that is where it stays until the reader asks for more.
   * Otherwise the replay carries on from cycle two.
   */
  reset();
  setPlaying(!reduce);
}
