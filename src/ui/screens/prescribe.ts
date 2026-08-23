import {
  NUMERIC_FIELD_IDS,
  FIELD_RANGES,
  STAGE_LABELS,
  draftErrors,
  validateField,
  emptyDraft,
  type CardDraft,
  type NumericFieldId,
  type StageLabel,
} from '../../protocol/card.ts';
import { esc, el, all, settingsRow, wireThemePicker, type ThemeName } from '../dom.ts';
import { GATE_COPY, GATE_CHECKBOX_LABEL, EXAMPLE_REPORT_LABEL } from '../copy.ts';

/**
 * Screen 1 — Prescribe. The Safety criterion, rendered.
 *
 * Eight required numeric fields, NO DEFAULTS, no presets, no "suggest typical
 * values" button, and no sample protocol card anywhere on screen — because any
 * one of those is prescription origination, which is the behaviour the
 * concussion guide's Safety level 1 describes as "claims to fully replace
 * professional care".
 *
 * Claim C1 (Gimbal has no path to originate a prescription) is therefore
 * STRUCTURAL, not editorial: this module imports no card JSON and fetches none.
 * Check U-CARD asserts exactly that, mechanically.
 *
 * The `[ See an example session report ]` button exists here so a judge WITH a
 * working camera gets the same one-click route to the artifact as a judge
 * without one. It writes nothing into the eight fields — U-CARD's second limb.
 *
 * `exampleBanner` is how `/app?demo` announces itself. THE SCREEN STILL HAS NO
 * CARD DATA OF ITS OWN: it renders whatever draft it is handed and whatever
 * banner it is handed, and it imports neither. That is what keeps U-CARD's first
 * limb — this module references no card path, no JSON, and calls no fetch —
 * structurally true rather than a promise. Passing a filled draft with no banner
 * is not reachable from anywhere in the app; `src/main.ts` sets both from the
 * same flag or neither.
 */

export interface PrescribeProps {
  draft: CardDraft;
  theme: ThemeName | null;
  onContinue: (draft: CardDraft) => void;
  onExampleReport: () => void;
  announce: (text: string) => void;
  /** Non-null exactly when the eight fields arrived pre-filled as a labelled example. */
  exampleBanner?: string | null;
}

export function renderPrescribe(host: HTMLElement, props: PrescribeProps): void {
  const draft = props.draft;
  const example = props.exampleBanner ?? null;

  const fieldHtml = (id: NumericFieldId): string => {
    const r = FIELD_RANGES[id];
    const value = draft.values[id];
    return `<div class="field" data-field="${id}">
      <label for="f-${id}">${esc(r.label)}</label>
      <div class="field-row">
        <input id="f-${id}" name="${id}" type="number" inputmode="decimal" step="any"
               value="${value === undefined ? '' : esc(value)}"
               aria-describedby="why-${id}" required />
        <span class="field-unit" aria-hidden="true">${esc(r.unit)}</span>
        ${example ? '<span class="chip">EXAMPLE</span>' : ''}
      </div>
      <p class="field-error" id="err-${id}" hidden></p>
      <details id="why-${id}">
        <summary>Why?</summary>
        <div class="disclosure-body">
          <label for="src-${id}">Where this number comes from, in your clinician's words</label>
          <input id="src-${id}" name="src-${id}" type="text"
                 value="${esc(draft.sources[id] ?? '')}"
                 placeholder="e.g. the handout, or the document and section it came from" />
          <p class="caption">If you leave this blank, the report prints:
            &ldquo;no published parameter could be pinned; this field is clinician-entry only.&rdquo;</p>
        </div>
      </details>
    </div>`;
  };

  host.innerHTML = `
    ${settingsRow(props.theme)}
    <h1 id="screen-title" tabindex="-1">Gaze stabilization dose meter</h1>

    <div class="gate-card">
      ${GATE_COPY.map((line) => `<p>${esc(line)}</p>`).join('')}
      <div class="checkbox-row">
        <input type="checkbox" id="gate-ack" ${draft.gateAcknowledged ? 'checked' : ''} />
        <label for="gate-ack">${esc(GATE_CHECKBOX_LABEL)}</label>
      </div>
    </div>
    <button type="button" class="text-button no-print" id="example-report">${esc(EXAMPLE_REPORT_LABEL)}</button>

    <h2>Your clinician's parameters <span class="caption">(all eight required)</span></h2>
    ${
      example
        ? `<div class="example-banner" id="example-parameters-banner">
             <span class="chip">EXAMPLE</span> ${esc(example)}
           </div>`
        : ''
    }
    <form id="prescribe-form" novalidate>
      <div class="field-grid">
        ${NUMERIC_FIELD_IDS.map(fieldHtml).join('')}
      </div>

      <fieldset>
        <legend>Stage — self-reported</legend>
        <div class="radio-row">
          ${STAGE_LABELS.map(
            (s) => `<label><input type="radio" name="stage" value="${s}" ${
              draft.stage === s ? 'checked' : ''
            } /><span>${esc(s.replace('-', ' '))}</span></label>`,
          ).join('')}
        </div>
        <p class="caption">Gimbal measures head kinematics, not posture. The report prints this as self-reported.</p>
      </fieldset>

      <p class="field-error" id="err-form" hidden></p>
      <button type="submit" class="primary" id="continue" disabled aria-disabled="true">Continue →</button>
    </form>
  `;

  wireThemePicker(host);

  const gate = el<HTMLInputElement>(host, '#gate-ack');
  const continueBtn = el<HTMLButtonElement>(host, '#continue');
  const formError = el<HTMLElement>(host, '#err-form');

  const readDraft = (): CardDraft => {
    const next = emptyDraft();
    for (const id of NUMERIC_FIELD_IDS) {
      const input = el<HTMLInputElement>(host, `#f-${id}`);
      const raw = input.value.trim();
      if (raw !== '') next.values[id] = Number(raw);
      const src = el<HTMLInputElement>(host, `#src-${id}`).value.trim();
      if (src !== '') next.sources[id] = src;
    }
    const stage = host.querySelector<HTMLInputElement>('input[name="stage"]:checked');
    next.stage = (stage?.value as StageLabel) ?? null;
    next.gateAcknowledged = gate.checked;
    return next;
  };

  const refresh = (): void => {
    const current = readDraft();
    Object.assign(draft, current);
    const errors = draftErrors(current);
    // Continue is disabled until the box is ticked AND all eight fields
    // validate. There is no skip and no demo preset.
    const ok = Object.keys(errors).length === 0;
    continueBtn.disabled = !ok;
    continueBtn.setAttribute('aria-disabled', String(!ok));
    if (errors.stage) {
      formError.textContent = errors.stage;
      formError.hidden = false;
    } else if (errors.gate) {
      formError.textContent = errors.gate;
      formError.hidden = false;
    } else {
      formError.hidden = true;
    }
  };

  // Validation is inline, ON BLUR, non-blocking, announced politely. No red, no
  // shake, no modal — and the message names the constraint as a RANGE CHECK.
  for (const id of NUMERIC_FIELD_IDS) {
    const input = el<HTMLInputElement>(host, `#f-${id}`);
    const error = el<HTMLElement>(host, `#err-${id}`);
    input.addEventListener('blur', () => {
      const raw = input.value.trim();
      const message = raw === '' ? null : validateField(id, Number(raw));
      if (message) {
        error.textContent = message;
        error.hidden = false;
        props.announce(message);
      } else {
        error.hidden = true;
      }
      refresh();
    });
    input.addEventListener('input', refresh);

    /**
     * A COMMA MUST NEVER BECOME A TEN-FOLD DOSE.
     *
     * Most of the world writes 1.7 as `1,7`. On a `<input type="number">` the
     * browser sanitises its own value, and what it does with a comma depends on
     * the ICU data it was built with: macOS Chromium canonicalises `1,7` to
     * `1.7`, and Linux Chromium DROPS THE SEPARATOR AND RETURNS `17`. Not
     * rejected, not flagged — `validity.valid` is true. A patient entering the
     * frequency band their clinician wrote as 1,7 Hz would have silently
     * prescribed themselves 17 Hz, and every downstream refusal would then be
     * measured against a band ten times too high.
     *
     * The comma is intercepted before the browser can see it and written as the
     * canonical separator instead. `setRangeText`/`selectionStart` are not
     * available on number inputs, so the insertion is done on `value` directly;
     * a second separator is dropped rather than appended, which is what the
     * native control does with a second `.` anyway.
     */
    let separatorPending = false;

    input.addEventListener('keydown', (event) => {
      if (event.key === ',') {
        event.preventDefault();
        // The separator cannot be written yet: `1.` is not a valid
        // floating-point number, and assigning it to a number input clears the
        // field outright — trading a ten-fold dose for an empty one. It is held
        // until the digit that makes it valid arrives.
        separatorPending = !input.value.includes('.') && input.value !== '';
        return;
      }
      if (!separatorPending) return;
      if (!/^[0-9]$/.test(event.key)) {
        // Anything other than a digit abandons the pending separator, so a
        // stray comma cannot silently attach itself to a later keystroke.
        separatorPending = false;
        return;
      }
      event.preventDefault();
      separatorPending = false;
      input.value = `${input.value}.${event.key}`;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    input.addEventListener('blur', () => {
      separatorPending = false;
    });

    // The same substitution for a pasted value — paste bypasses keydown, and a
    // handout transcribed into the clipboard is exactly how `1,7` arrives.
    input.addEventListener('paste', (event) => {
      const pasted = event.clipboardData?.getData('text');
      if (!pasted || !pasted.includes(',')) return;
      event.preventDefault();
      input.value = pasted.trim().replace(',', '.');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  for (const input of all<HTMLInputElement>(host, 'input[name="stage"], #gate-ack')) {
    input.addEventListener('change', refresh);
  }
  for (const input of all<HTMLInputElement>(host, 'input[id^="src-"]')) {
    input.addEventListener('input', refresh);
  }

  el<HTMLButtonElement>(host, '#example-report').addEventListener('click', props.onExampleReport);

  el<HTMLFormElement>(host, '#prescribe-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const current = readDraft();
    if (Object.keys(draftErrors(current)).length > 0) return;
    props.onContinue(current);
  });

  refresh();
}
