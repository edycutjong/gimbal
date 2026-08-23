import { createDial, bindDial, arcAngleDeg, Dial } from '../ui/dial.ts';
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
 *    TWO DELIBERATE ADDITIONS, recorded rather than hidden.
 *
 *    (a) The cycle strip is drawn as ten HTML cells rather than by `CycleStrip`.
 *        That component renders into an SVG with `preserveAspectRatio="none"`,
 *        which is right for the block screen — 240 four-pixel cells, where the
 *        distortion is invisible — and wrong here, where ten cells stretched
 *        across a hero panel would shear the 45° refusal hatch into horizontal
 *        mush. The RULE is what is being depicted and the rule is unchanged: a
 *        credited cycle is a solid block, a refused one is an outlined hatched
 *        hole at 45 % height, and neither is ever red.
 *
 *    (b) `platePath()` draws the gauge's SCALE PLATE — tick marks every 50 °/s
 *        and a thin arc marking the prescribed band — concentric with the
 *        instrument's own ring and outside it. It is a printed scale, exactly as
 *        a physical gauge has one, and every number in it is read off
 *        `ILLUSTRATION_CARD`: nothing is positioned by eye. Its angles come from
 *        `arcAngleDeg`, the same exported function `Dial` uses and
 *        `tests/dial.test.ts` pins, so the plate and the arc cannot drift apart.
 *
 *        It exists because the prescribed band is a property of the CARD, and
 *        the instrument's own band arc doubles as a verdict channel — it goes
 *        `--zone-in` only while the last cycle was credited. Drawing the band
 *        twice separates the two facts instead of conflating them, and the
 *        verdict channels (marker colour, strip cell, sentence, dose numeral)
 *        are untouched.
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

/* ── The scale plate ─────────────────────────────────────────────────────── */

const PLATE_R = 48.4;
const TICK_STEP = 50;
/** Inside the ring, outside the readout. See `.lp-dial-core` in landing.css. */
const GAP_R = 34;
/** Where the bracket's end ticks stop: the inner edge of the instrument's ring. */
const GAP_REACH = 38.6;

/** A point on the plate, in the dial's own viewBox units. */
function platePoint(fraction: number, radius: number): [number, number] {
  const radians = (arcAngleDeg(fraction) * Math.PI) / 180;
  return [50 + radius * Math.cos(radians), 50 + radius * Math.sin(radians)];
}

/**
 * A DIMENSION BRACKET along the dial's own sweep — an arc between two velocity
 * fractions with a short radial tick at each end, turned outward until it meets
 * the inner edge of the ring.
 *
 * The ticks are the whole reason this is a bracket rather than a bare arc. Drawn
 * without them the dashed segment floated in the middle of the dial, visually
 * unattached to either the marker it starts at or the band it ends at, and a
 * measurement that does not touch what it measures reads as debris.
 */
function bracketPath(from: number, to: number, radius: number, reach: number): string {
  const point = (f: number, r: number): string => {
    const [x, y] = platePoint(f, r);
    return `${x.toFixed(2)} ${y.toFixed(2)}`;
  };
  const large = Math.abs(to - from) * 270 > 180 ? 1 : 0;
  const sweep = to > from ? 1 : 0;
  return `M ${point(from, reach)} L ${point(from, radius)}
    A ${radius} ${radius} 0 ${large} ${sweep} ${point(to, radius)}
    L ${point(to, reach)}`;
}

/*
 * Ticks live entirely OUTSIDE the instrument's ring, whose outer edge is at
 * r = 45 in these units. Drawn from r = 44.6 they were half buried under a 6-unit
 * stroke and rendered as scattered debris rather than as a scale.
 */
function tick(velocity: number, major: boolean): string {
  const f = velocity / RING_MAX;
  const [x1, y1] = platePoint(f, major ? 46 : 47.2);
  const [x2, y2] = platePoint(f, PLATE_R + 1.4);
  return `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}"
    stroke="${major ? 'var(--lp-line-2)' : 'var(--lp-track)'}" stroke-width="${major ? 1.5 : 1}" />`;
}

/**
 * Ticks every 50 °/s plus a green arc over the prescribed band. The band's ends
 * are `card.peakVelocityFloor` and `card.peakVelocityCeiling`; the sweep is the
 * dial's own 270°, taken from `arcAngleDeg` rather than restated.
 */
function platePath(): string {
  const circumference = 2 * Math.PI * PLATE_R;
  const arc = circumference * 0.75;
  const start = (FLOOR / RING_MAX) * arc;
  const length = ((CEILING - FLOOR) / RING_MAX) * arc;

  const ticks: string[] = [];
  for (let v = 0; v <= RING_MAX; v += TICK_STEP) {
    ticks.push(tick(v, v === 0 || v === RING_MAX || v === FLOOR || v === CEILING));
  }

  /*
   * `#rp-gap` IS THE ARGUMENT, DRAWN.
   *
   * A dashed arc from where the rep actually landed to the edge of the band it
   * failed to reach. The distance between marker and band is the entire pitch of
   * this product, and until now the page depended on a reader noticing it; this
   * annotates it instead. Its endpoints are the committed peak and the card's own
   * floor or ceiling — both derived, neither positioned by hand — and it is
   * emptied whenever the cycle is inside the band, because then there is no gap
   * and drawing one would be a fabrication.
   */
  return `<svg class="lp-dial-plate" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
    ${ticks.join('')}
    <circle cx="50" cy="50" r="${PLATE_R}" fill="none" stroke="var(--zone-in)" stroke-width="2.6"
            stroke-dasharray="0 ${start.toFixed(3)} ${length.toFixed(3)} ${circumference.toFixed(3)}"
            transform="rotate(135 50 50)" />
    <path id="rp-gap" d="" fill="none" stroke="var(--zone-out)" stroke-width="1.6"
          stroke-dasharray="3 3" stroke-linecap="round" opacity="0" />
  </svg>`;
}

/* ── The strip and the transcript ────────────────────────────────────────── */

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

/**
 * @param host        the hero's instrument slot.
 * @param chapterHost where the narration goes. It sits OUTSIDE the panel, in the
 *                    prose column, because the sentence describing the picture
 *                    belongs next to the sentence making the claim — and because
 *                    a 130 px block at the foot of the left column is what closes
 *                    it against a much taller instrument instead of leaving a
 *                    quarter of the fold empty.
 */
export function mountReplay(host: HTMLElement, chapterHost: HTMLElement): void {
  const reduce = reducedMotion();
  const dial = createDial(ILLUSTRATION_CARD);

  /*
   * THE PAUSE CONTROL IS IN THE PANEL'S TOP BAR, not with the other two.
   *
   * The replay autoplays for anyone who has not asked for reduced motion, and
   * this is a product for people whose presenting symptom includes
   * visually-induced dizziness. A pause that is only reachable after a scroll is
   * a pause that arrives after the symptom, so it sits in the first row of the
   * panel — above the fold at every viewport this page is checked at. Step and
   * Restart are navigation rather than relief and stay below.
   */
  host.innerHTML = `
  <figure class="lp-replay">
    <div class="lp-replay-head">
      <p class="lp-replay-head-text">
        <span class="chip">Illustration</span>
        <span>Not a measurement. A scripted ten-cycle trace, scored by the same <code>scoreCycle()</code> the instrument runs.</span>
      </p>
      <button type="button" id="rp-play" class="lp-ctl lp-ctl-play" aria-pressed="false"></button>
    </div>

    <div class="lp-replay-stage" role="img" aria-label="A velocity dial with the delivered dose at its centre, a strip of one cell per repetition and a tracking-quality meter. The text equivalent is below the controls.">
      <p class="lp-band-tag"><span class="tnum">${FLOOR}–${CEILING} °/s</span> prescribed band</p>

      <div class="lp-dial">
        <div class="ring-stage">${dial.html}</div>
        ${platePath()}
        <div class="lp-dial-core">
          <p class="lp-readout-label">Delivered dose</p>
          <p class="lp-readout-value"><span id="rp-dose" class="tnum">0.0</span><span class="lp-readout-unit">s</span></p>
          <p class="lp-readout-sub">in zone, of <span class="tnum">${PRESCRIBED_SECONDS}</span> s prescribed</p>
        </div>
        <p class="lp-dial-end lp-dial-end-min tnum">0</p>
        <p class="lp-dial-end lp-dial-end-max tnum">${RING_MAX}</p>
      </div>

      <p class="lp-deficit" id="rp-deficit"></p>
      <p class="lp-dial-note">peak head velocity, °/s</p>
    </div>

    <div class="lp-replay-meta">
      <div class="lp-meta-head">
        <p class="lp-meta-label">Repetitions</p>
        <p class="lp-meta-count"><span id="rp-credited" class="tnum">0</span> of <span class="tnum">${TRACE.length}</span> credited</p>
      </div>
      ${stripHtml()}

      <!--
        EVERY STATE IS COLOUR + SHAPE + WORD, and the legend is what makes the
        third of those true. A greyscale screenshot of this strip still resolves:
        the cells differ in height, in fill and in outline before they differ in
        hue, and each one is named here in text.
      -->
      <ul class="lp-legend-states">
        <li><span class="lp-swatch lp-swatch-in" aria-hidden="true"></span>Credited — in the band</li>
        <li><span class="lp-swatch lp-swatch-refused" aria-hidden="true"></span>Refused — not counted</li>
        <li><span class="lp-swatch lp-swatch-pending" aria-hidden="true"></span>Not yet run</li>
      </ul>

      <div class="lp-quality-row">
        <p class="lp-quality-label"><span>Tracking quality</span><span id="rp-q" class="tnum">0.91</span></p>
        <div class="lp-quality">
          <div class="lp-quality-fill" id="rp-qfill"></div>
          <div class="lp-quality-floor" style="left:${(INSTRUMENT_LIMITS.qFloor * 100).toFixed(1)}%"></div>
        </div>
        <p class="lp-quality-note">floor ${INSTRUMENT_LIMITS.qFloor} — below it a cycle is refused, not smoothed</p>
      </div>
    </div>

    <!--
      THE STATUS BAR SPANS BOTH BAYS, and the spanning is the point: the sentence
      reads as a verdict on everything above it rather than as a caption on the
      dial alone.
    -->
    <p class="lp-replay-status" id="rp-status" data-refused="false"></p>

    <div class="lp-replay-controls">
      <button type="button" id="rp-step" class="lp-ctl">Step one rep</button>
      <button type="button" id="rp-reset" class="lp-ctl">Restart</button>
      <p class="lp-replay-speed">1/${REPLAY_SLOWDOWN} speed</p>
    </div>

    <figcaption class="lp-replay-cap">
      ${reduce ? '<strong>Motion is off because your system asks for reduced motion.</strong> Use <em>Step one rep</em> to walk the rest. ' : ''}Ten
      peak velocities and ten tracking-quality values are the only things written by hand.
      Every verdict, sentence and number downstream of them comes from the instrument's own code.
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

  chapterHost.innerHTML = `
    <span class="lp-chapter-eyebrow">On the dial right now</span>
    <span class="lp-chapter-title" id="rp-ch-title">Below the band</span>
    <span class="lp-chapter-detail" id="rp-ch-detail">${esc(CHAPTERS[0]?.detail ?? '')}</span>`;

  const els = bindDial(host);
  if (!els) return;
  const ring = new Dial(els, dial.max, reduce);

  const cells = all<HTMLElement>(host, '.lp-strip li');
  const doseEl = el<HTMLElement>(host, '#rp-dose');
  const creditedEl = el<HTMLElement>(host, '#rp-credited');
  const statusEl = el<HTMLElement>(host, '#rp-status');
  const qEl = el<HTMLElement>(host, '#rp-q');
  const qFill = el<HTMLElement>(host, '#rp-qfill');
  const chTitle = el<HTMLElement>(chapterHost, '#rp-ch-title');
  const chDetail = el<HTMLElement>(chapterHost, '#rp-ch-detail');
  const gapEl = el<SVGPathElement>(host, '#rp-gap');
  const deficitEl = el<HTMLElement>(host, '#rp-deficit');
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

  /**
   * The gap between where the rep landed and the band it had to reach, as an arc
   * and as a sentence.
   *
   * Both numbers are read off the committed cycle and off the card — never
   * typed — and both are EMPTIED when the peak is inside the band, including for
   * the cycle refused on tracking confidence. There is no velocity gap in that
   * case, and drawing one because a refusal happened would be inventing a
   * shortfall the instrument never measured. The element keeps its line, so
   * nothing on the panel moves when the text comes and goes.
   */
  const setGap = (peak: number): void => {
    const edge = peak < FLOOR ? FLOOR : peak > CEILING ? CEILING : null;
    if (edge === null) {
      gapEl.setAttribute('opacity', '0');
      deficitEl.textContent = '';
      return;
    }
    gapEl.setAttribute('d', bracketPath(peak / RING_MAX, edge / RING_MAX, GAP_R, GAP_REACH));
    gapEl.setAttribute('opacity', '1');
    deficitEl.textContent =
      peak < FLOOR
        ? `${edge - peak} °/s short of the ${edge} °/s floor`
        : `${peak - edge} °/s past the ${edge} °/s ceiling`;
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
    setGap(c.peakOmega);
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
    /*
     * NO `setLive` HERE, AND THAT IS THE FIX FOR A BUG THAT COST THE HERO ITS
     * ONE SATURATED SHAPE.
     *
     * `Dial.setLive` throttles to 10 Hz under reduced motion: it returns early
     * when `nowMs - lastLiveWrite < 100`. `lastLiveWrite` starts at 0, and this
     * function used to call `setLive(0, false, 0)` immediately before `reset`
     * called `setLive(peak, …, 0)` — so BOTH calls returned early and the live
     * arc was never written at all. Under `prefers-reduced-motion` the first and
     * only frame a reader ever saw had no amber arc on it: the picture the whole
     * page is about, minus the part that shows the rep falling short.
     *
     * `clear` has nothing to zero here anyway — `reset` is its only caller and
     * always writes the arc immediately afterwards, with a real timestamp.
     */
    doseEl.textContent = '0.0';
    creditedEl.textContent = '0';
    statusEl.textContent = 'Waiting for the first full cycle.';
    statusEl.dataset.refused = 'false';
    setQuality(TRACE[0]?.qMin ?? 0.9);
    gapEl.setAttribute('opacity', '0');
    deficitEl.textContent = '';
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
    ring.setLive(first.peakOmega, false, performance.now());
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

  /*
   * ONE RE-ISSUE OF THE SEEDING FRAME, UNDER REDUCED MOTION ONLY.
   *
   * `Dial` initialises its 10 Hz throttle stamp to 0 rather than to -Infinity,
   * so the first `setLive` of a document's life is discarded whenever this
   * module happens to run inside the first 100 ms after navigation start. In the
   * application that is invisible — the measurement loop writes thirty times a
   * second and the next one lands. Here, under reduced motion, there IS no next
   * one: the panel holds a single frame until the reader asks for another, and
   * that frame is the whole argument of the page.
   *
   * So the write is re-issued once, with a real timestamp, after the throttle
   * window has certainly passed. It is idempotent — the same three attributes
   * with the same values — and nothing moves if the first write already landed.
   * A fictional `performance.now() + 200` would have been one line shorter and
   * would have put a lie in the only argument this component makes.
   *
   * The underlying `lastLiveWrite = 0` belongs to shared code that `/app`
   * depends on and is reported rather than edited from here.
   */
  const first = TRACE[0];
  if (reduce && first) {
    globalThis.setTimeout(() => {
      if (committed === 1) ring.setLive(first.peakOmega, false, performance.now());
    }, 150);
  }
}
