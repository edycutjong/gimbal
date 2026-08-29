// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderGate, type GateProps } from '../src/ui/screens/gate.ts';
import { renderLedger, type LedgerProps } from '../src/ui/screens/ledger.ts';
import { SESSION_SCHEMA, type PersistedSession } from '../src/store/session.ts';
import { buildDeviceSignature, describeSignature } from '../src/store/deviceSignature.ts';
import { evaluateStopRule } from '../src/protocol/stopRule.ts';
import { SESSION_CAP } from '../src/store/local.ts';
import { EXAMPLE_LOADER_LABEL } from '../src/ui/copy.ts';
import { testCard } from './helpers.ts';

/**
 * Screen 4 (gate) and screen 6 (ledger) rendered into a real DOM.
 *
 * Both screens are pure `innerHTML` + listeners, so every assertion here reads
 * the DOM the patient would actually see rather than a returned string.
 */

/**
 * jsdom ships `<dialog open>` reflection but neither `showModal()` nor
 * `close()`. The screen uses the native element deliberately (focus trap, Esc),
 * so the missing methods are supplied here, on the test side only, with the
 * open-state semantics the assertions read back.
 */
const dialogProto = HTMLDialogElement.prototype as unknown as {
  showModal?: (this: HTMLDialogElement) => void;
  close?: (this: HTMLDialogElement) => void;
};
if (typeof dialogProto.showModal !== 'function') {
  dialogProto.showModal = function showModal(this: HTMLDialogElement): void {
    this.open = true;
  };
}
if (typeof dialogProto.close !== 'function') {
  dialogProto.close = function close(this: HTMLDialogElement): void {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
}

const card = testCard();

const sig = buildDeviceSignature({
  userAgent: 'gate-ledger-agent',
  cameraLabel: 'built-in cam',
  resolution: '640x480',
  medianFps: 29.8,
});

const otherSig = buildDeviceSignature({
  userAgent: 'someone-elses-agent',
  cameraLabel: 'usb cam',
  resolution: '1280x720',
  medianFps: 24.2,
});

let host: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  host = document.createElement('div');
  document.body.appendChild(host);
});

// ---------------------------------------------------------------- gate ----

interface GateHarness {
  props: GateProps;
  onRuling: ReturnType<typeof vi.fn>;
  announce: ReturnType<typeof vi.fn>;
  alertEndSession: ReturnType<typeof vi.fn>;
}

function gate(overrides: Partial<GateProps> = {}): GateHarness {
  const onRuling = vi.fn();
  const announce = vi.fn();
  const alertEndSession = vi.fn();
  const props: GateProps = {
    card,
    baseline: 2,
    afterBlock: 0,
    isFinal: false,
    theme: null,
    onRuling,
    announce,
    alertEndSession,
    ...overrides,
  };
  renderGate(host, props);
  return { props, onRuling, announce, alertEndSession };
}

/** Picks a rating the way a keyboard user does: check the radio, fire `change`. */
function rate(value: number): void {
  const input = host.querySelector<HTMLInputElement>(`input[name="rating"][value="${value}"]`);
  if (!input) throw new Error(`no radio for rating ${value}`);
  input.checked = true;
  input.dispatchEvent(new Event('change'));
}

const continueBtn = (): HTMLButtonElement => {
  const btn = host.querySelector<HTMLButtonElement>('#gate-continue');
  if (!btn) throw new Error('no continue button');
  return btn;
};

const outcomeBox = (): HTMLElement => {
  const box = host.querySelector<HTMLElement>('#outcome');
  if (!box) throw new Error('no outcome box');
  return box;
};

describe('gate screen', () => {
  it('offers eleven radios and no default selection, and does nothing until one is picked', () => {
    const h = gate({ baseline: null, afterBlock: null });

    const radios = host.querySelectorAll<HTMLInputElement>('input[name="rating"]');
    expect(radios.length).toBe(11);
    expect(Array.from(radios).map((r) => r.value)).toEqual(
      ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
    );
    expect(Array.from(radios).some((r) => r.checked)).toBe(false);
    expect(host.querySelector('#screen-title')?.textContent).toBe(
      'Before you start: how are your symptoms right now?',
    );
    expect(continueBtn().disabled).toBe(true);
    expect(continueBtn().getAttribute('aria-disabled')).toBe('true');

    // No rating yet: the button is inert even if a click reaches it anyway —
    // dispatched directly, since jsdom drops `click()` on a disabled control.
    continueBtn().click();
    continueBtn().dispatchEvent(new MouseEvent('click'));
    expect(h.onRuling).not.toHaveBeenCalled();
  });

  it('records the baseline rating without ruling on it', () => {
    const h = gate({ baseline: null, afterBlock: null });

    rate(4);
    expect(continueBtn().disabled).toBe(false);
    expect(continueBtn().getAttribute('aria-disabled')).toBe('false');
    expect(continueBtn().textContent).toBe('Continue');
    expect(outcomeBox().hidden).toBe(true);
    expect(h.announce).not.toHaveBeenCalled();
    expect(h.alertEndSession).not.toHaveBeenCalled();

    continueBtn().click();
    expect(h.onRuling).toHaveBeenCalledTimes(1);
    expect(h.onRuling).toHaveBeenCalledWith(4, null);
  });

  it('records the final rating with no ruling, even when it would have ended the session', () => {
    const h = gate({ baseline: 2, isFinal: true, afterBlock: 2 });

    expect(host.querySelector('#screen-title')?.textContent).toBe(
      'Last one: how are your symptoms now the session is over?',
    );

    // 6 against a baseline of 2 is a rise of 4, past the card's rise limit of 3 —
    // but there is no block left to gate, so nothing is ruled.
    expect(evaluateStopRule(2, 6, card)).toBe('end-session');
    rate(6);
    expect(outcomeBox().hidden).toBe(true);
    expect(continueBtn().textContent).toBe('See your report');
    expect(h.alertEndSession).not.toHaveBeenCalled();
    expect(h.announce).not.toHaveBeenCalled();

    continueBtn().click();
    expect(h.onRuling).toHaveBeenCalledWith(6, null);
  });

  it('rules "continue" against the session\'s own baseline and cites the card', () => {
    const h = gate({ baseline: 2 });

    expect(host.querySelector('#screen-title')?.textContent).toBe('How are your symptoms right now?');

    rate(2);
    const box = outcomeBox();
    expect(box.hidden).toBe(false);
    expect(box.querySelector('h2')?.textContent).toBe('Next block');
    expect(box.querySelector('h2')?.className).toBe('');
    expect(box.querySelector('p')?.textContent).toBe(
      'Your rating is at or below your baseline of 2. Next block.',
    );
    expect(box.querySelector('#rest-countdown')).toBeNull();
    expect(box.querySelector('strong')).toBeNull();
    expect(box.querySelector('details .disclosure-body')?.textContent).toBe(
      card.symptomStopRule.baselineRise.source,
    );
    expect(continueBtn().textContent).toBe('Continue');
    expect(h.announce).toHaveBeenCalledWith(
      'Next block. Your rating is at or below your baseline of 2. Next block.',
    );
    expect(h.alertEndSession).not.toHaveBeenCalled();

    continueBtn().click();
    expect(h.onRuling).toHaveBeenCalledWith(2, 'continue');
  });

  it('rules "rest" and counts elapsed rest time upward at 1 Hz until the screen goes away', () => {
    vi.useFakeTimers();
    try {
      const h = gate({ baseline: 2 });

      rate(3);
      const box = outcomeBox();
      expect(box.querySelector('h2')?.textContent).toBe('Rest before the next block');
      expect(h.announce).toHaveBeenCalledWith(
        'Rest before the next block. Your rating rose 1 point above your baseline of 2, ' +
          'below the rise limit of 3. Rest before the next block.',
      );
      expect(h.alertEndSession).not.toHaveBeenCalled();
      // Nothing is gated on the rest: Continue is already live.
      expect(continueBtn().disabled).toBe(false);
      expect(continueBtn().textContent).toBe('Continue');

      const node = host.querySelector<HTMLElement>('#rest-countdown');
      expect(node?.textContent).toBe('0:00');
      expect(node?.getAttribute('aria-live')).toBe('off');

      vi.advanceTimersByTime(1000);
      expect(node?.textContent).toBe('0:01');
      vi.advanceTimersByTime(59_000);
      expect(node?.textContent).toBe('1:00');

      // The screen is replaced; the interval must not outlive it.
      host.innerHTML = '';
      expect(node?.isConnected).toBe(false);
      vi.advanceTimersByTime(1000);
      expect(node?.textContent).toBe('1:01');
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(10_000);
      expect(node?.textContent).toBe('1:01');
    } finally {
      vi.useRealTimers();
    }
  });

  it('starts no rest timer when the countdown node is not in the tree', () => {
    vi.useFakeTimers();
    try {
      gate({ baseline: 2 });
      // Stand in for a screen torn down between render and ruling.
      (host as unknown as { querySelector: (selectors: string) => Element | null }).querySelector =
        () => null;

      const input = document.querySelector<HTMLInputElement>('input[name="rating"][value="3"]');
      input!.checked = true;
      input!.dispatchEvent(new Event('change'));

      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ends the session on a rise to the card\'s limit, with no override offered', () => {
    const h = gate({ baseline: 2 });

    rate(5);
    const box = outcomeBox();
    expect(box.querySelector('h2')?.textContent).toBe('Session ended');
    expect(box.querySelector('h2')?.className).toBe('outcome-halt');
    expect(box.textContent).toContain('reaching the rise limit of 3 your clinician wrote down');
    expect(box.querySelector('strong')?.textContent).toBe('Tell your PT about this.');
    expect(box.querySelector('#rest-countdown')).toBeNull();
    expect(continueBtn().textContent).toBe('See your report');

    // Ending is correct behaviour: it is alerted, not announced, and there is no
    // "continue anyway" control anywhere on the screen.
    expect(h.alertEndSession).toHaveBeenCalledTimes(1);
    expect(h.alertEndSession.mock.calls[0]?.[0]).toContain('Session ended.');
    expect(h.announce).not.toHaveBeenCalled();
    expect(host.querySelectorAll('button').length).toBe(1);

    continueBtn().click();
    expect(h.onRuling).toHaveBeenCalledWith(5, 'end-session');
  });

  it('ends the session at the card\'s absolute ceiling', () => {
    const h = gate({ baseline: 1 });

    rate(7);
    expect(outcomeBox().textContent).toContain(
      'Your rating of 7 reached the absolute ceiling of 7 your clinician wrote down.',
    );
    expect(h.alertEndSession).toHaveBeenCalledTimes(1);

    continueBtn().click();
    expect(h.onRuling).toHaveBeenCalledWith(7, 'end-session');
  });

  it('re-rules when the rating is changed before continuing', () => {
    const h = gate({ baseline: 2 });

    rate(5);
    expect(outcomeBox().querySelector('h2')?.textContent).toBe('Session ended');
    rate(1);
    expect(outcomeBox().querySelector('h2')?.textContent).toBe('Next block');
    expect(continueBtn().textContent).toBe('Continue');

    continueBtn().click();
    expect(h.onRuling).toHaveBeenCalledTimes(1);
    expect(h.onRuling).toHaveBeenCalledWith(1, 'continue');
  });

  it('renders the settings row and applies a picked theme', () => {
    gate({ baseline: null, afterBlock: null, theme: 'light' });

    const light = host.querySelector<HTMLInputElement>('input[name="theme"][value="light"]');
    expect(light?.checked).toBe(true);

    const dim = host.querySelector<HTMLInputElement>('input[name="theme"][value="dim"]');
    dim!.checked = true;
    dim!.dispatchEvent(new Event('change'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dim');
  });
});

// -------------------------------------------------------------- ledger ----

function session(overrides: Partial<PersistedSession> = {}): PersistedSession {
  const startedAt = overrides.startedAt ?? '2026-08-20T09:00:00Z';
  const ratio = overrides.totals?.ratio ?? 0.5;
  return {
    schema: SESSION_SCHEMA,
    id: `s-${startedAt}`,
    provenance: 'live',
    startedAt,
    cardId: 'card-abc',
    cardHash: 'fnv1a:0000000000000000',
    card,
    device: sig,
    blocks: [],
    symptom: { baseline: 2, gates: [], final: 3 },
    totals: { prescribedSeconds: 360, deliveredSeconds: Math.round(360 * ratio), ratio },
    appVersion: 'gimbal test',
    methodsRev: 'METHODS.md@test',
    ...overrides,
  };
}

interface LedgerHarness {
  onLoadExamples: ReturnType<typeof vi.fn>;
  onClearAll: ReturnType<typeof vi.fn>;
  onBack: ReturnType<typeof vi.fn>;
}

function ledger(overrides: Partial<LedgerProps> = {}): LedgerHarness {
  const onLoadExamples = vi.fn();
  const onClearAll = vi.fn();
  const onBack = vi.fn();
  const props: LedgerProps = {
    sessions: [],
    device: sig,
    unknownSchemaCount: 0,
    storageUnavailable: false,
    notice: null,
    hasReport: true,
    theme: null,
    onLoadExamples,
    onClearAll,
    onBack,
    ...overrides,
  };
  renderLedger(host, props);
  return { onLoadExamples, onClearAll, onBack };
}

const rows = (): HTMLTableRowElement[] =>
  Array.from(host.querySelectorAll<HTMLTableRowElement>('tbody tr'));

describe('ledger screen', () => {
  it('offers the example loader when nothing is stored on this device', () => {
    const h = ledger({ sessions: [], hasReport: true });

    expect(host.querySelector('#screen-title')?.textContent).toBe('Session history');
    expect(host.querySelector('table')).toBeNull();
    expect(host.querySelector('.check-card h2')?.textContent).toBe(
      'Nothing recorded on this device yet',
    );
    expect(host.querySelectorAll('.banner').length).toBe(0);
    expect(host.querySelector('.example-banner')).toBeNull();
    expect(host.querySelector('#back-to-report')?.textContent).toBe('Back to report');
    expect(host.querySelector('#confirm-clear')?.textContent).toContain('removes 0 stored sessions');

    const loader = host.querySelector<HTMLButtonElement>('#load-examples');
    expect(loader?.textContent).toBe(EXAMPLE_LOADER_LABEL);
    loader!.click();
    expect(h.onLoadExamples).toHaveBeenCalledTimes(1);
  });

  it('renders one own session with every banner shown and no report to return to', () => {
    ledger({
      sessions: [session({ totals: { prescribedSeconds: 360, deliveredSeconds: 288, ratio: 0.8 } })],
      unknownSchemaCount: 1,
      storageUnavailable: true,
      notice: 'Import refused: <unknown> schema',
      hasReport: false,
    });

    const banners = Array.from(host.querySelectorAll('.banner')).map((n) => n.textContent ?? '');
    expect(banners.length).toBe(3);
    expect(banners[0]).toContain('History could not be saved in this browser');
    expect(banners[1]).toContain('1 session from a newer version of Gimbal are present');
    expect(banners[2]).toBe('Import refused: <unknown> schema');
    // The notice is escaped, not injected.
    expect(host.querySelectorAll('unknown').length).toBe(0);
    expect(host.querySelector('.example-banner')).toBeNull();

    expect(host.querySelector('#load-examples')).toBeNull();
    expect(host.querySelector('#back-to-report')?.textContent).toBe('Back to the start');
    expect(host.querySelector('caption')?.textContent).toContain('1 session on this device signature');
    expect(host.querySelector('caption')?.textContent).toContain(describeSignature(sig));
    expect(host.querySelector('caption')?.textContent).not.toContain('deliberately not plotted');
    expect(host.querySelector('#confirm-clear')?.textContent).toContain('removes 1 stored session,');

    const row = rows()[0];
    expect(row?.getAttribute('data-provenance')).toBe('live');
    expect(Array.from(row?.children ?? []).map((c) => c.textContent?.trim())).toEqual([
      '2026-08-20',
      '4.8 min',
      '6.0 min',
      '80 %',
      'yours',
    ]);
    expect(row?.querySelector('.chip')).toBeNull();
    expect(host.querySelector('.sparkline')?.getAttribute('aria-label')).toBe(
      'Delivered dose ratio across 1 sessions on this device',
    );
    expect(host.querySelectorAll('.sparkline circle').length).toBe(1);
    expect(host.querySelector('.table-scroll ~ .caption')?.textContent).toContain(
      `1 of ${SESSION_CAP} sessions stored on this device`,
    );
  });

  it('marks example rows and keeps one off-device session off the trend line', () => {
    ledger({
      sessions: [
        session({
          id: 'ex-1',
          provenance: 'example',
          startedAt: '2026-08-18T09:00:00Z',
          totals: { prescribedSeconds: 360, deliveredSeconds: 180, ratio: 0.5 },
        }),
        session({ startedAt: '2026-08-19T09:00:00Z' }),
        session({ startedAt: '2026-08-21T09:00:00Z', device: otherSig }),
      ],
      unknownSchemaCount: 2,
    });

    expect(host.querySelector('.banner')?.textContent).toContain(
      '2 sessions from a newer version of Gimbal are present',
    );
    expect(host.querySelector('.example-banner')?.textContent).toContain(
      'This ledger contains 1 example sessions recorded by the developer on this device, ' +
        '2026-08-18 to 2026-08-18.',
    );

    // The off-device row is stored, counted, and never plotted.
    const dates = rows().map((r) => r.querySelector('th')?.textContent);
    expect(dates).toEqual(['2026-08-18', '2026-08-19']);
    expect(dates).not.toContain('2026-08-21');
    expect(host.querySelectorAll('.sparkline circle').length).toBe(2);

    const caption = host.querySelector('caption')?.textContent ?? '';
    expect(caption).toContain('2 sessions on this device signature');
    expect(caption).toContain(
      '1 more is stored from a different camera, browser or',
    );
    expect(caption).toContain('is deliberately not plotted on the same line');

    expect(rows()[0]?.getAttribute('data-provenance')).toBe('example');
    expect(rows()[0]?.querySelector('.chip')?.textContent).toBe('EXAMPLE');
    expect(rows()[1]?.querySelector('.chip')).toBeNull();
    expect(host.querySelector('.sparkline + .caption')?.textContent).toBe(
      'solid point = your own session · hollow point on a dashed line = EXAMPLE, recorded by the developer',
    );
    expect(host.querySelector('#confirm-clear')?.textContent).toContain('removes 3 stored sessions');
  });

  it('pluralises the off-device sentence when more than one session is withheld', () => {
    ledger({
      sessions: [
        session({ startedAt: '2026-08-19T09:00:00Z' }),
        session({ startedAt: '2026-08-20T09:00:00Z', device: otherSig }),
        session({ startedAt: '2026-08-21T09:00:00Z', device: otherSig }),
      ],
    });

    const caption = host.querySelector('caption')?.textContent ?? '';
    expect(caption).toContain('1 session on this device signature');
    expect(caption).toContain('2 more are stored from a different camera, browser or');
    expect(caption).toContain('are deliberately not plotted on the same line');
    expect(rows().length).toBe(1);
  });

  it('confirms before clearing, and keeps the data when the dialog is dismissed', () => {
    const h = ledger({ sessions: [session()] });

    const dialog = host.querySelector<HTMLDialogElement>('#confirm-clear');
    expect(dialog?.open).toBe(false);

    host.querySelector<HTMLButtonElement>('#clear-all')!.click();
    expect(dialog?.open).toBe(true);

    host.querySelector<HTMLButtonElement>('#confirm-no')!.click();
    expect(dialog?.open).toBe(false);
    expect(h.onClearAll).not.toHaveBeenCalled();

    host.querySelector<HTMLButtonElement>('#clear-all')!.click();
    host.querySelector<HTMLButtonElement>('#confirm-yes')!.click();
    expect(dialog?.open).toBe(false);
    expect(h.onClearAll).toHaveBeenCalledTimes(1);

    host.querySelector<HTMLButtonElement>('#back-to-report')!.click();
    expect(h.onBack).toHaveBeenCalledTimes(1);
  });

  it('renders the settings row and applies a picked theme', () => {
    ledger({ theme: 'dark' });

    expect(host.querySelector<HTMLInputElement>('input[name="theme"][value="dark"]')?.checked).toBe(
      true,
    );
    const light = host.querySelector<HTMLInputElement>('input[name="theme"][value="light"]');
    light!.checked = true;
    light!.dispatchEvent(new Event('change'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});
