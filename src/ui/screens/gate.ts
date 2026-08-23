import type { ProtocolCard } from '../../protocol/card.ts';
import { evaluateStopRule, stopRuleHeading, stopRuleSentence, type StopRuleOutcome } from '../../protocol/stopRule.ts';
import { esc, el, all, whyDisclosure, settingsRow, wireThemePicker, type ThemeName } from '../dom.ts';

/**
 * Screen 4 — Gate. The symptom rating and the stop rule.
 *
 * ELEVEN REAL RADIO BUTTONS, 0–10. Not a slider: a range input is hostile to a
 * dizzy user's fine motor control, ambiguous to read back, and awkward with a
 * screen reader. Radios are keyboard-native, announce their value, and have no
 * drag.
 *
 * No timeout, no auto-advance, no default selection. The two thresholds this
 * rating is compared against are the two the patient typed on screen 1 — Gimbal
 * supplies neither.
 */

export interface GateProps {
  card: ProtocolCard;
  /** `null` on the pre-session baseline rating. */
  baseline: number | null;
  /** The block this gate follows, or `null` for the pre-session baseline. */
  afterBlock: number | null;
  /** True for the end-of-session rating: recorded and printed, but no block left to gate. */
  isFinal: boolean;
  theme: ThemeName | null;
  onRuling: (rating: number, outcome: StopRuleOutcome | null) => void;
  announce: (text: string) => void;
  alertEndSession: (text: string) => void;
}

export function renderGate(host: HTMLElement, props: GateProps): void {
  const { card } = props;
  const question = props.baseline === null
    ? 'Before you start: how are your symptoms right now?'
    : props.isFinal
      ? 'Last one: how are your symptoms now the session is over?'
      : 'How are your symptoms right now?';

  host.innerHTML = `
    ${settingsRow(props.theme)}
    <p class="eyebrow">Symptom check</p>
    <h1 id="screen-title" tabindex="-1">${esc(question)}</h1>
    <p class="muted">0 is none. 10 is the worst you have felt.</p>

    <fieldset class="symptom-scale" id="scale">
      <legend class="visually-hidden">Symptom rating, 0 to 10</legend>
      ${Array.from({ length: 11 }, (_, i) => `<label><input type="radio" name="rating" value="${i}" /><span>${i}</span></label>`).join('')}
    </fieldset>
    <div class="scale-anchors" aria-hidden="true"><span>none</span><span>worst</span></div>

    <div id="outcome" hidden></div>

    <div class="button-row">
      <button type="button" class="primary" id="gate-continue" disabled aria-disabled="true">Continue</button>
    </div>
  `;

  wireThemePicker(host);

  const outcomeEl = el<HTMLElement>(host, '#outcome');
  const continueBtn = el<HTMLButtonElement>(host, '#gate-continue');
  let rating: number | null = null;
  let outcome: StopRuleOutcome | null = null;

  for (const input of all<HTMLInputElement>(host, 'input[name="rating"]')) {
    input.addEventListener('change', () => {
      rating = Number(input.value);
      continueBtn.disabled = false;
      continueBtn.setAttribute('aria-disabled', 'false');

      if (props.baseline === null || props.isFinal) {
        // The baseline sets the reference; the final rating is recorded and
        // printed but has no block left to gate.
        outcome = null;
        outcomeEl.hidden = true;
        continueBtn.textContent = props.isFinal ? 'See your report' : 'Continue';
        return;
      }

      outcome = evaluateStopRule(props.baseline, rating, card);
      const sentence = stopRuleSentence(outcome, props.baseline, rating, card);
      const heading = stopRuleHeading(outcome);

      outcomeEl.hidden = false;
      outcomeEl.innerHTML = `
        <h2 class="${outcome === 'end-session' ? 'outcome-halt' : ''}">${esc(heading)}</h2>
        <p>${esc(sentence)}</p>
        ${
          outcome === 'end-session'
            ? `<p><strong>Tell your PT about this.</strong></p>`
            : outcome === 'rest'
              ? `<p class="rest-countdown tnum" id="rest-countdown" aria-live="off">0:00</p>
                 <p class="caption">Your clinician's card does not specify how long to rest.
                    This counts the time you have taken; there is no target, and nothing is waiting on it.
                    Continue when you are ready.</p>`
              : ''
        }
        ${whyDisclosure(card.symptomStopRule.baselineRise.source)}
      `;

      // There is no override and no "continue anyway". Ending on symptom
      // provocation is the clinically correct behaviour, and putting an
      // "are you sure?" in front of it would be pressure.
      continueBtn.textContent = outcome === 'end-session' ? 'See your report' : 'Continue';

      if (outcome === 'end-session') {
        props.alertEndSession(`${heading}. ${sentence}`);
      } else {
        props.announce(`${heading}. ${sentence}`);
      }

      if (outcome === 'rest') startRestCountdown(host);
    });
  }

  continueBtn.addEventListener('click', () => {
    if (rating === null) return;
    props.onRuling(rating, outcome);
  });
}

/**
 * A 1 Hz numeral, not an animated ring — this is a rest, not a progress bar.
 *
 * It counts UP, and that is a safety decision rather than a stylistic one. The
 * eight-field protocol card carries NO rest duration, so a countdown would mean
 * Gimbal had chosen one and displayed it as if a clinician had prescribed it —
 * the exact behaviour claim C1 exists to make structurally impossible. Counting
 * elapsed time states a fact about what the patient did; counting down would
 * state a target nobody wrote.
 *
 * Nothing is gated on it. The Continue button is already enabled.
 */
function startRestCountdown(host: HTMLElement): void {
  const node = host.querySelector<HTMLElement>('#rest-countdown');
  if (!node) return;
  let elapsed = 0;
  const tick = setInterval(() => {
    elapsed += 1;
    const mm = Math.floor(elapsed / 60);
    const ss = String(elapsed % 60).padStart(2, '0');
    node.textContent = `${mm}:${ss}`;
    // The screen is gone; stop the timer rather than leaking it.
    if (!node.isConnected) clearInterval(tick);
  }, 1000);
}
