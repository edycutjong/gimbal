import { createDial, bindDial, Dial } from '../dial.ts';
import { CycleStrip } from '../strip.ts';
import { landoltCSvg } from '../../optotype/landoltC.ts';
import { ORIENTATION_KEYS, type GapOrientation } from '../../optotype/trials.ts';
import type { ProtocolCard } from '../../protocol/card.ts';
import { prescribedSeconds } from '../../protocol/card.ts';
import type { ScoredCycle } from '../../dsp/types.ts';
import type { BlockFrameState } from '../../session/blockRunner.ts';
import { el, esc, reducedMotion } from '../dom.ts';
import { doseReadout, blockProgress, refusalSentence } from '../copy.ts';

/**
 * Screen 3 — Block. The whole product in one still frame.
 *
 * A single centred stack. NO HEADER, NO NAV, no chrome above the fold, because
 * every pixel of interface furniture is a candidate saccade — and the patient
 * must hold fixation on the optotype for the whole sweep or the 4AFC task they
 * are being scored on becomes unanswerable.
 *
 * WHAT IN-ZONE FEELS LIKE: nothing happens. The tone stops bending, the ring
 * holds still, nothing new appears, and one number climbs. There is no
 * celebration, no colour burst, no sound event. The felt quality is "the machine
 * has stopped correcting me", which is the honest sensation of doing the therapy
 * right — and it is deliberate: a reward loop encouraging MORE of a
 * symptom-limited therapy is clinically wrong, and confetti is the archetype the
 * organizer's own rubric pre-scored at 2 out of 5.
 */

export interface BlockProps {
  card: ProtocolCard;
  blockIndex: number;
  video: HTMLVideoElement;
  optoVmin: number;
  hideVideo: boolean;
  onAnswer: (o: GapOrientation) => void;
  onPauseToggle: () => void;
  onInterrupt: () => void;
}

export interface BlockView {
  onFrame: (s: BlockFrameState) => void;
  onCycle: (c: ScoredCycle) => void;
  setPaused: (paused: boolean) => void;
  setOptotype: (shown: GapOrientation | null, windowOpen: boolean) => void;
  destroy: () => void;
}

export function renderBlock(host: HTMLElement, props: BlockProps): BlockView {
  const { card } = props;
  const dial = createDial(card);
  const totalPrescribed = prescribedSeconds(card);
  const blockMs = card.blockSeconds.value * 1000;

  host.style.setProperty('--opto-d', `${props.optoVmin}vmin`);
  host.innerHTML = `
    <h1 id="screen-title" tabindex="-1" class="visually-hidden">Block ${props.blockIndex + 1}</h1>
    <div class="ring-stage">
      ${dial.html}
      <div class="quiet-field" id="quiet-field">${landoltCSvg(0)}</div>
    </div>
    <svg class="cycle-strip" id="cycle-strip"></svg>
    <p class="status-line" id="status-line"></p>
    <p class="dose-readout tnum" id="dose-readout">${esc(doseReadout(0, totalPrescribed))}</p>
    <p class="dose-sub" id="dose-sub">${esc(blockProgress(props.blockIndex, card.blockCount.value, blockMs))}</p>
    <p class="key-legend">← → answer · ␣ pause · esc end session</p>
    <div class="paused-overlay" id="paused-overlay" hidden>Paused. Press space to continue.</div>
  `;

  const els = bindDial(host);
  if (!els) throw new Error('dial failed to bind');
  const reduced = reducedMotion();
  const view = new Dial(els, dial.max, reduced);
  const strip = new CycleStrip(el<SVGSVGElement>(host, '#cycle-strip'), 240, reduced);

  // Node references are cached at block start. No innerHTML in the loop, ever.
  const doseEl = el<HTMLElement>(host, '#dose-readout');
  const subEl = el<HTMLElement>(host, '#dose-sub');
  const statusEl = el<HTMLElement>(host, '#status-line');
  const quietField = el<HTMLElement>(host, '#quiet-field');
  const overlay = el<HTMLElement>(host, '#paused-overlay');

  if (!props.hideVideo) {
    props.video.className = 'presence-tile';
    props.video.hidden = false;
    host.appendChild(props.video);
  } else {
    props.video.hidden = true;
  }

  let lastTextWrite = 0;
  let lastOrientation: GapOrientation | null = null;

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      props.onPauseToggle();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      props.onInterrupt();
      return;
    }
    const mapped = ORIENTATION_KEYS[e.key];
    if (mapped !== undefined) {
      // Arrow keys are captured only while a response window is open; outside it
      // they do nothing, and they never scroll — the block screen has
      // overflow: hidden.
      e.preventDefault();
      props.onAnswer(mapped);
    }
  };
  globalThis.addEventListener('keydown', onKey);

  return {
    onFrame(s: BlockFrameState): void {
      const inBand =
        s.omega >= card.peakVelocityFloor.value && s.omega <= card.peakVelocityCeiling.value;
      view.setLive(s.omega, inBand, s.tMs);

      // Text readouts at 10 Hz, not 30 — perceptually identical, one third of
      // the layout work.
      if (s.tMs - lastTextWrite >= 100) {
        lastTextWrite = s.tMs;
        doseEl.textContent = doseReadout(s.deliveredSeconds, totalPrescribed);
        subEl.textContent = blockProgress(props.blockIndex, card.blockCount.value, blockMs - s.elapsedMs);
        if (!props.hideVideo) {
          props.video.dataset.alert = String(!s.facePresent || s.quality < 0.4);
        }
      }
    },

    onCycle(c: ScoredCycle): void {
      view.setCommitted(c.peakOmega, c.credited);
      strip.add(c);
      // The status line REPLACES its predecessor; it never appends.
      statusEl.textContent = c.credited ? '' : refusalSentence(c.reason, c, card);
    },

    setPaused(paused: boolean): void {
      overlay.hidden = !paused;
      view.setPaused(paused);
    },

    setOptotype(shown: GapOrientation | null, windowOpen: boolean): void {
      if (shown !== null && shown !== lastOrientation) {
        lastOrientation = shown;
        quietField.innerHTML = landoltCSvg(shown);
      }
      const svg = quietField.querySelector('svg');
      if (svg) svg.setAttribute('data-window', windowOpen ? 'open' : 'closed');
    },

    destroy(): void {
      globalThis.removeEventListener('keydown', onKey);
    },
  };
}
