// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderPrescribe, type PrescribeProps } from '../src/ui/screens/prescribe.ts';
import {
  NUMERIC_FIELD_IDS,
  STAGE_LABELS,
  FIELD_RANGES,
  emptyDraft,
  type CardDraft,
  type NumericFieldId,
} from '../src/protocol/card.ts';
import {
  exampleDraft,
  EXAMPLE_DRAFT_BANNER,
  EXAMPLE_SOURCE,
  EXAMPLE_VALUES,
  EXAMPLE_STAGE,
} from '../src/protocol/exampleParameters.ts';
import {
  GATE_COPY,
  GATE_CHECKBOX_LABEL,
  EXAMPLE_REPORT_LABEL,
  BLANK_CARD_HREF,
  BLANK_CARD_LABEL,
} from '../src/ui/copy.ts';
import { el, all } from '../src/ui/dom.ts';

/* ---------------------------------------------------------------- harness */

interface Harness {
  host: HTMLElement;
  draft: CardDraft;
  onContinue: ReturnType<typeof vi.fn>;
  onExampleReport: ReturnType<typeof vi.fn>;
  announce: ReturnType<typeof vi.fn>;
}

/** Mounts the screen into a real, document-attached host — blur only fires on attached nodes. */
function mount(draft: CardDraft, overrides: Partial<PrescribeProps> = {}): Harness {
  const host = document.createElement('div');
  document.body.append(host);
  const onContinue = vi.fn();
  const onExampleReport = vi.fn();
  const announce = vi.fn();
  const props: PrescribeProps = {
    draft,
    theme: 'dark',
    onContinue,
    onExampleReport,
    announce,
    ...overrides,
  };
  renderPrescribe(host, props);
  return { host, draft, onContinue, onExampleReport, announce };
}

function field(host: HTMLElement, id: NumericFieldId): HTMLInputElement {
  return el<HTMLInputElement>(host, `#f-${id}`);
}

function source(host: HTMLElement, id: NumericFieldId): HTMLInputElement {
  return el<HTMLInputElement>(host, `#src-${id}`);
}

function errorFor(host: HTMLElement, id: NumericFieldId): HTMLElement {
  return el<HTMLElement>(host, `#err-${id}`);
}

function gate(host: HTMLElement): HTMLInputElement {
  return el<HTMLInputElement>(host, '#gate-ack');
}

function continueButton(host: HTMLElement): HTMLButtonElement {
  return el<HTMLButtonElement>(host, '#continue');
}

function formError(host: HTMLElement): HTMLElement {
  return el<HTMLElement>(host, '#err-form');
}

function stageRadio(host: HTMLElement, value: string): HTMLInputElement {
  return el<HTMLInputElement>(host, `input[name="stage"][value="${value}"]`);
}

function blur(input: HTMLInputElement): void {
  input.dispatchEvent(new FocusEvent('blur'));
}

function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function key(input: HTMLInputElement, k: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
  input.dispatchEvent(event);
  return event;
}

/** A paste event carrying `text`, or — when `text` is null — one with no clipboardData at all. */
function paste(input: HTMLInputElement, text: string | null): Event {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  if (text !== null) {
    Object.defineProperty(event, 'clipboardData', {
      value: { getData: (_type: string): string => text },
    });
  }
  input.dispatchEvent(event);
  return event;
}

/** Fills the form to a fully valid state: eight values, a stage, and a human-ticked gate. */
function completeTheForm(host: HTMLElement): void {
  for (const id of NUMERIC_FIELD_IDS) type(field(host, id), String(EXAMPLE_VALUES[id]));
  const radio = stageRadio(host, EXAMPLE_STAGE);
  radio.checked = true;
  radio.dispatchEvent(new Event('change', { bubbles: true }));
  const box = gate(host);
  box.checked = true;
  box.dispatchEvent(new Event('change', { bubbles: true }));
}

beforeEach(() => {
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('data-theme');
});

/* ------------------------------------------------- C1: the blank card route */

describe('renderPrescribe — the blank card (claim C1: no path to originate a prescription)', () => {
  it('renders eight EMPTY numeric fields with no defaults and no numeric placeholders', () => {
    const { host } = mount(emptyDraft());

    const inputs = all<HTMLInputElement>(host, '.field-grid input[type="number"]');
    expect(inputs).toHaveLength(8);
    expect(inputs.map((input) => input.name)).toEqual([...NUMERIC_FIELD_IDS]);

    for (const input of inputs) {
      expect(input.value).toBe('');
      expect(input.getAttribute('value')).toBe('');
      // A numeric placeholder would be a suggested dose by another name.
      expect(input.getAttribute('placeholder')).toBeNull();
      expect(input.required).toBe(true);
      expect(input.step).toBe('any');
      expect(input.inputMode).toBe('decimal');
    }
  });

  it('leaves every source field empty and every stage radio unchecked', () => {
    const { host } = mount(emptyDraft());
    for (const id of NUMERIC_FIELD_IDS) expect(source(host, id).value).toBe('');
    expect(all<HTMLInputElement>(host, 'input[name="stage"]').filter((r) => r.checked)).toEqual([]);
  });

  it('shows NO example banner and NO EXAMPLE chip when no banner was handed in', () => {
    const { host } = mount(emptyDraft());
    expect(host.querySelector('#example-parameters-banner')).toBeNull();
    expect(host.querySelector('#blank-card')).toBeNull();
    expect(all(host, '.field .chip')).toHaveLength(0);
  });

  it('does not tick the clinician attestation, and Continue starts disabled', () => {
    const { host } = mount(emptyDraft());
    expect(gate(host).checked).toBe(false);
    expect(continueButton(host).disabled).toBe(true);
    expect(continueButton(host).getAttribute('aria-disabled')).toBe('true');
  });

  it('fetches nothing while rendering — the screen holds no card data of its own', () => {
    const fetchSpy = vi.fn();
    const original = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
    Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: fetchSpy });
    try {
      const { host } = mount(emptyDraft());
      completeTheForm(host);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      delete (globalThis as Record<string, unknown>)['fetch'];
      if (original) Object.defineProperty(globalThis, 'fetch', original);
    }
  });

  it('renders the gate copy, the checkbox label, and the example-report button', () => {
    const { host } = mount(emptyDraft());
    const lines = all<HTMLElement>(host, '.gate-card p').map((p) => p.textContent);
    expect(lines).toEqual([...GATE_COPY]);
    expect(el<HTMLElement>(host, 'label[for="gate-ack"]').textContent).toBe(GATE_CHECKBOX_LABEL);
    expect(el<HTMLButtonElement>(host, '#example-report').textContent).toBe(EXAMPLE_REPORT_LABEL);
  });

  it('renders one labelled field per range, with its unit and its Why? disclosure', () => {
    const { host } = mount(emptyDraft());
    for (const id of NUMERIC_FIELD_IDS) {
      const wrapper = el<HTMLElement>(host, `.field[data-field="${id}"]`);
      expect(el<HTMLLabelElement>(wrapper, `label[for="f-${id}"]`).textContent).toBe(
        FIELD_RANGES[id].label,
      );
      expect(el<HTMLElement>(wrapper, '.field-unit').textContent).toBe(FIELD_RANGES[id].unit);
      expect(el<HTMLElement>(wrapper, '.field-unit').getAttribute('aria-hidden')).toBe('true');
      expect(field(host, id).getAttribute('aria-describedby')).toBe(`why-${id}`);
      expect(el<HTMLDetailsElement>(wrapper, `details#why-${id}`).open).toBe(false);
      expect(errorFor(host, id).hidden).toBe(true);
    }
  });

  it('renders one radio per stage label and the settings row', () => {
    const { host } = mount(emptyDraft());
    expect(all<HTMLInputElement>(host, 'input[name="stage"]').map((r) => r.value)).toEqual([
      ...STAGE_LABELS,
    ]);
    expect(
      all<HTMLInputElement>(host, '.settings-row input[name="theme"]')
        .filter((r) => r.checked)
        .map((r) => r.value),
    ).toEqual(['dark']);
  });

  it('resolves a null theme through the OS rather than painting an empty picker', () => {
    const { host } = mount(emptyDraft(), { theme: null });
    expect(
      all<HTMLInputElement>(host, '.settings-row input[name="theme"]').filter((r) => r.checked),
    ).toHaveLength(1);
  });
});

/* ------------------------------------------------ the labelled example route */

describe('renderPrescribe — the labelled example route', () => {
  it('labels itself three ways: banner, an EXAMPLE chip on each of the eight, and EXAMPLE sources', () => {
    const { host } = mount(exampleDraft(), { exampleBanner: EXAMPLE_DRAFT_BANNER });

    const banner = el<HTMLElement>(host, '#example-parameters-banner');
    expect(banner.classList.contains('example-banner')).toBe(true);
    expect(el<HTMLElement>(banner, '.chip').textContent).toBe('EXAMPLE');
    expect(banner.textContent).toContain(EXAMPLE_DRAFT_BANNER);

    const chips = all<HTMLElement>(host, '.field .chip');
    expect(chips).toHaveLength(8);
    expect(chips.map((chip) => chip.textContent)).toEqual(Array(8).fill('EXAMPLE'));

    for (const id of NUMERIC_FIELD_IDS) {
      expect(source(host, id).value).toBe(EXAMPLE_SOURCE);
      expect(source(host, id).value.startsWith('EXAMPLE')).toBe(true);
    }
  });

  it('pre-fills the eight fields with exactly the published example values, and the stage', () => {
    const { host } = mount(exampleDraft(), { exampleBanner: EXAMPLE_DRAFT_BANNER });
    for (const id of NUMERIC_FIELD_IDS) {
      expect(field(host, id).value).toBe(String(EXAMPLE_VALUES[id]));
    }
    expect(
      all<HTMLInputElement>(host, 'input[name="stage"]')
        .filter((r) => r.checked)
        .map((r) => r.value),
    ).toEqual([EXAMPLE_STAGE]);
  });

  it('keeps the blank-card escape hatch one visible click away', () => {
    const { host } = mount(exampleDraft(), { exampleBanner: EXAMPLE_DRAFT_BANNER });
    const link = el<HTMLAnchorElement>(host, '#blank-card');
    expect(link.getAttribute('href')).toBe(BLANK_CARD_HREF);
    expect(link.textContent).toBe(BLANK_CARD_LABEL);
  });

  it('NEVER ticks the clinician attestation, even with all eight values filled in', () => {
    const { host } = mount(exampleDraft(), { exampleBanner: EXAMPLE_DRAFT_BANNER });
    expect(gate(host).checked).toBe(false);
    // The eight fields validate; the gate is the only thing left, and only a human can supply it.
    expect(continueButton(host).disabled).toBe(true);
    expect(formError(host).hidden).toBe(false);
    expect(formError(host).textContent).toBe('Confirm your clinician prescribed these exercises.');
  });

  it('escapes the banner text, so a banner string cannot inject markup', () => {
    const { host } = mount(exampleDraft(), { exampleBanner: '<img src=x onerror=alert(1)>' });
    const banner = el<HTMLElement>(host, '#example-parameters-banner');
    expect(banner.querySelector('img')).toBeNull();
    expect(banner.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('treats an explicit null banner exactly like an absent one', () => {
    const { host } = mount(exampleDraft(), { exampleBanner: null });
    expect(host.querySelector('#example-parameters-banner')).toBeNull();
    expect(all(host, '.field .chip')).toHaveLength(0);
  });

  it('reflects a pre-acknowledged gate flag rather than hard-coding it', () => {
    // Constructed here, in the test, precisely because nothing in src/ produces it:
    // both emptyDraft() and exampleDraft() ship gateAcknowledged false.
    expect(emptyDraft().gateAcknowledged).toBe(false);
    expect(exampleDraft().gateAcknowledged).toBe(false);

    const acknowledged: CardDraft = { ...exampleDraft(), gateAcknowledged: true };
    const { host } = mount(acknowledged);
    expect(gate(host).checked).toBe(true);
    // Eight valid values + stage + gate = the form is complete.
    expect(continueButton(host).disabled).toBe(false);
    expect(continueButton(host).getAttribute('aria-disabled')).toBe('false');
    expect(formError(host).hidden).toBe(true);
  });
});

/* ------------------------------------------------------- inline validation */

describe('renderPrescribe — on-blur range checks', () => {
  it('shows and announces a range-check message for an out-of-range value', () => {
    const { host, announce } = mount(emptyDraft());
    const input = field(host, 'frequencyBandLow');
    type(input, '9');
    blur(input);

    const error = errorFor(host, 'frequencyBandLow');
    expect(error.hidden).toBe(false);
    expect(error.textContent).toBe(
      'Frequency band, low must be between 0.1 and 5 Hz — this is a range check, not a clinical recommendation.',
    );
    expect(announce).toHaveBeenCalledWith(error.textContent);
  });

  it('clears the message once the value comes back into range', () => {
    const { host, announce } = mount(emptyDraft());
    const input = field(host, 'blockCount');
    type(input, '99');
    blur(input);
    expect(errorFor(host, 'blockCount').hidden).toBe(false);

    type(input, '3');
    blur(input);
    expect(errorFor(host, 'blockCount').hidden).toBe(true);
    expect(announce).toHaveBeenCalledTimes(1);
  });

  it('says nothing about an empty field on blur — required is not a scolding', () => {
    const { host, announce } = mount(emptyDraft());
    const input = field(host, 'blockSeconds');
    blur(input);
    expect(errorFor(host, 'blockSeconds').hidden).toBe(true);
    expect(announce).not.toHaveBeenCalled();
  });

  it('enables Continue only once all eight validate AND the box is ticked', () => {
    const { host } = mount(emptyDraft());
    const button = continueButton(host);
    expect(button.disabled).toBe(true);

    for (const id of NUMERIC_FIELD_IDS) type(field(host, id), String(EXAMPLE_VALUES[id]));
    expect(button.disabled).toBe(true);
    expect(formError(host).textContent).toBe('Choose the stage your clinician wrote down.');
    expect(formError(host).hidden).toBe(false);

    const radio = stageRadio(host, 'standing');
    radio.checked = true;
    radio.dispatchEvent(new Event('change', { bubbles: true }));
    expect(button.disabled).toBe(true);
    expect(formError(host).textContent).toBe('Confirm your clinician prescribed these exercises.');

    const box = gate(host);
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    expect(button.disabled).toBe(false);
    expect(button.getAttribute('aria-disabled')).toBe('false');
    expect(formError(host).hidden).toBe(true);
  });

  it('mirrors the live form back into the draft object it was handed', () => {
    const draft = emptyDraft();
    const { host } = mount(draft);
    completeTheForm(host);
    type(source(host, 'blockCount'), 'the handout, page 2');

    expect(draft.values.blockCount).toBe(EXAMPLE_VALUES.blockCount);
    expect(draft.sources.blockCount).toBe('the handout, page 2');
    expect(draft.stage).toBe(EXAMPLE_STAGE);
    expect(draft.gateAcknowledged).toBe(true);
  });

  it('drops a blank source rather than storing an empty string', () => {
    const draft = exampleDraft();
    const { host } = mount(draft, { exampleBanner: EXAMPLE_DRAFT_BANNER });
    type(source(host, 'blockCount'), '   ');
    expect(draft.sources.blockCount).toBeUndefined();
  });
});

/* ------------------------------------- the comma guard (never a ten-fold dose) */

describe('renderPrescribe — a comma must never become a ten-fold dose', () => {
  it('turns `1` + `,` + `7` into 1.7, not 17', () => {
    const draft = emptyDraft();
    const { host } = mount(draft);
    const input = field(host, 'frequencyBandLow');

    type(input, '1');
    const comma = key(input, ',');
    expect(comma.defaultPrevented).toBe(true);
    // The separator is held: `1.` would be assigned to a number input and clear it outright.
    expect(input.value).toBe('1');

    const digit = key(input, '7');
    expect(digit.defaultPrevented).toBe(true);
    expect(input.value).toBe('1.7');
    expect(draft.values.frequencyBandLow).toBe(1.7);
    expect(draft.values.frequencyBandLow).not.toBe(17);
  });

  it('does not arm on an empty field — a leading comma has no number to attach to', () => {
    const { host } = mount(emptyDraft());
    const input = field(host, 'frequencyBandLow');
    key(input, ',');
    const digit = key(input, '7');
    expect(digit.defaultPrevented).toBe(false);
    expect(input.value).toBe('');
  });

  it('does not arm when a separator is already present — a second one is dropped', () => {
    const { host } = mount(emptyDraft());
    const input = field(host, 'frequencyBandLow');
    type(input, '1.7');
    const comma = key(input, ',');
    expect(comma.defaultPrevented).toBe(true);
    const digit = key(input, '5');
    expect(digit.defaultPrevented).toBe(false);
    expect(input.value).toBe('1.7');
  });

  it('abandons a pending separator when the next keystroke is not a digit', () => {
    const { host } = mount(emptyDraft());
    const input = field(host, 'peakVelocityFloor');
    type(input, '15');
    key(input, ',');
    const backspace = key(input, 'Backspace');
    expect(backspace.defaultPrevented).toBe(false);
    expect(input.value).toBe('15');

    // And the abandoned comma cannot silently attach itself to a later digit.
    const later = key(input, '0');
    expect(later.defaultPrevented).toBe(false);
    expect(input.value).toBe('15');
  });

  it('abandons a pending separator on blur', () => {
    const { host } = mount(emptyDraft());
    const input = field(host, 'peakVelocityFloor');
    type(input, '15');
    key(input, ',');
    blur(input);
    const digit = key(input, '0');
    expect(digit.defaultPrevented).toBe(false);
    expect(input.value).toBe('15');
  });

  it('ignores ordinary typing when no separator is pending', () => {
    const { host } = mount(emptyDraft());
    const input = field(host, 'blockSeconds');
    const digit = key(input, '6');
    expect(digit.defaultPrevented).toBe(false);
  });

  it('rewrites a pasted `1,7` to 1.7', () => {
    const draft = emptyDraft();
    const { host } = mount(draft);
    const input = field(host, 'frequencyBandLow');
    const event = paste(input, '  1,7  ');
    expect(event.defaultPrevented).toBe(true);
    expect(input.value).toBe('1.7');
    expect(draft.values.frequencyBandLow).toBe(1.7);
  });

  /*
   * A THOUSANDS SEPARATOR IS NOT A DECIMAL COMMA, and the difference is a
   * dose. The guard used to call `replace(',', '.')`, which rewrites only the
   * FIRST comma: `1,000` became `1.000` and was read as ONE — a thousand-fold
   * under-dose from a clipboard — and `1,7,5` became `1.7,5`, which the number
   * input silently sanitised to empty, clearing the field with no explanation.
   * More than one separator is not a number this field can take, so the paste
   * is refused and the field is left for the range check to report.
   */
  it('refuses a paste carrying a thousands separator rather than reading 1,000 as 1', () => {
    const draft = emptyDraft();
    const { host } = mount(draft);
    const input = field(host, 'peakVelocityFloor');
    input.value = '';
    const event = paste(input, '1,000');
    expect(event.defaultPrevented).toBe(true);
    expect(input.value).toBe('');
    expect(draft.values.peakVelocityFloor).toBeUndefined();
  });

  it('refuses a paste with more than one comma rather than clearing the field', () => {
    const draft = emptyDraft();
    const { host } = mount(draft);
    const input = field(host, 'frequencyBandLow');
    input.value = '';
    const event = paste(input, '1,7,5');
    expect(event.defaultPrevented).toBe(true);
    expect(input.value).toBe('');
    expect(draft.values.frequencyBandLow).toBeUndefined();
  });

  it('leaves a comma-free paste to the browser', () => {
    const { host } = mount(emptyDraft());
    const input = field(host, 'frequencyBandLow');
    const event = paste(input, '2.3');
    expect(event.defaultPrevented).toBe(false);
    // Untouched: the native paste, which jsdom does not perform, would have filled it.
    expect(input.value).toBe('');
  });

  it('leaves an empty paste alone', () => {
    const { host } = mount(emptyDraft());
    const input = field(host, 'frequencyBandLow');
    const event = paste(input, '');
    expect(event.defaultPrevented).toBe(false);
    expect(input.value).toBe('');
  });

  it('survives a paste event carrying no clipboardData at all', () => {
    const { host } = mount(emptyDraft());
    const input = field(host, 'frequencyBandLow');
    const event = paste(input, null);
    expect(event.defaultPrevented).toBe(false);
    expect(input.value).toBe('');
  });
});

/* ------------------------------------------------------- buttons and submit */

describe('renderPrescribe — example report and submit', () => {
  it('routes the example-report button without writing into the eight fields', () => {
    const { host, onExampleReport } = mount(emptyDraft());
    el<HTMLButtonElement>(host, '#example-report').click();
    expect(onExampleReport).toHaveBeenCalledTimes(1);
    for (const id of NUMERIC_FIELD_IDS) expect(field(host, id).value).toBe('');
    expect(gate(host).checked).toBe(false);
  });

  it('refuses to submit an incomplete draft', () => {
    const { host, onContinue } = mount(emptyDraft());
    const form = el<HTMLFormElement>(host, '#prescribe-form');
    const event = new Event('submit', { bubbles: true, cancelable: true });
    form.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(onContinue).not.toHaveBeenCalled();
  });

  it('refuses to submit a fully-filled form whose gate is unticked', () => {
    const { host, onContinue } = mount(exampleDraft(), { exampleBanner: EXAMPLE_DRAFT_BANNER });
    el<HTMLFormElement>(host, '#prescribe-form').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    expect(onContinue).not.toHaveBeenCalled();
  });

  it('hands the completed draft to onContinue exactly once', () => {
    const { host, onContinue } = mount(emptyDraft());
    completeTheForm(host);
    type(source(host, 'frequencyBandLow'), 'clinic handout, section 2');

    el<HTMLFormElement>(host, '#prescribe-form').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );

    expect(onContinue).toHaveBeenCalledTimes(1);
    const submitted = onContinue.mock.calls[0]?.[0] as CardDraft;
    expect(submitted.values).toEqual(EXAMPLE_VALUES);
    expect(submitted.stage).toBe(EXAMPLE_STAGE);
    expect(submitted.gateAcknowledged).toBe(true);
    expect(submitted.sources).toEqual({ frequencyBandLow: 'clinic handout, section 2' });
  });

  it('reports the cross-field errors the ranges alone cannot catch', () => {
    const { host } = mount(emptyDraft());
    completeTheForm(host);
    expect(continueButton(host).disabled).toBe(false);

    // Low edge above the high edge: both are in range, the pair is not.
    type(field(host, 'frequencyBandLow'), '2.5');
    expect(continueButton(host).disabled).toBe(true);

    type(field(host, 'frequencyBandLow'), String(EXAMPLE_VALUES.frequencyBandLow));
    expect(continueButton(host).disabled).toBe(false);
  });
});
