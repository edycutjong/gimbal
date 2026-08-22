import type { PersistedSession, DeviceSignature } from '../../store/session.ts';
import { trendAnnotation, exampleBanner } from '../../store/ledger.ts';
import { sparklineSvg, sparklineLegend } from '../sparkline.ts';
import { describeSignature } from '../../store/deviceSignature.ts';
import { SESSION_CAP } from '../../store/local.ts';
import { esc, el, settingsRow, wireThemePicker, type ThemeName } from '../dom.ts';
import { EXAMPLE_LOADER_LABEL } from '../copy.ts';

/**
 * Screen 6 — Ledger.
 *
 * The trend plots ONLY sessions matching the current device signature, and says
 * why. Cross-device comparison would contaminate the exact property that
 * differentiates this product, so sessions from a different camera, browser or
 * resolution are stored but never plotted together.
 *
 * Example rows carry an EXAMPLE chip in the table and in the sparkline legend,
 * so a judge can never mistake developer-recorded history for their own.
 */

export interface LedgerProps {
  sessions: PersistedSession[];
  device: DeviceSignature;
  unknownSchemaCount: number;
  storageUnavailable: boolean;
  /** A visible reason when a requested load did not happen. Shown, not only announced. */
  notice: string | null;
  /** False when there is no report to return to, so the button does not promise one. */
  hasReport: boolean;
  theme: ThemeName | null;
  onLoadExamples: () => void;
  onClearAll: () => void;
  onBack: () => void;
}

export function renderLedger(host: HTMLElement, props: LedgerProps): void {
  const trend = trendAnnotation(props.sessions, props.device.sigHash);
  const banner = exampleBanner(props.sessions);
  const plotted = trend.used;
  const offDevice = props.sessions.length - plotted.length;

  host.innerHTML = `
    ${settingsRow(props.theme)}
    <h1 id="screen-title" tabindex="-1">Session history</h1>

    ${
      props.storageUnavailable
        ? `<p class="banner">History could not be saved in this browser — your report still prints.</p>`
        : ''
    }
    ${
      props.unknownSchemaCount > 0
        ? `<p class="banner">${props.unknownSchemaCount} session${
            props.unknownSchemaCount === 1 ? '' : 's'
          } from a newer version of Gimbal are present and not shown.</p>`
        : ''
    }
    ${props.notice ? `<p class="banner">${esc(props.notice)}</p>` : ''}
    ${banner ? `<p class="example-banner">${esc(banner)}</p>` : ''}

    ${
      props.sessions.length === 0
        ? `<div class="check-card">
             <h2>Nothing recorded on this device yet</h2>
             <p>Run a session and it appears here. Or load the developer's own recorded sessions to see
                what the trend looks like:</p>
             <button type="button" id="load-examples">${esc(EXAMPLE_LOADER_LABEL)}</button>
           </div>`
        : `
      ${sparklineSvg(plotted)}
      <p class="caption">${esc(sparklineLegend(plotted))}</p>
      <p class="muted">${esc(trend.text)}</p>

      <table>
        <caption>${plotted.length} session${plotted.length === 1 ? '' : 's'} on this device signature —
          ${esc(describeSignature(props.device))}.
          ${
            offDevice > 0
              ? `${offDevice} more ${offDevice === 1 ? 'is' : 'are'} stored from a different camera, browser or
                 resolution and ${offDevice === 1 ? 'is' : 'are'} deliberately not plotted on the same line.`
              : ''
          }</caption>
        <thead>
          <tr>
            <th scope="col">Date</th><th scope="col">Delivered</th><th scope="col">Prescribed</th>
            <th scope="col">Ratio</th><th scope="col">Source</th>
          </tr>
        </thead>
        <tbody>
          ${plotted
            .map(
              (s) => `<tr data-provenance="${esc(s.provenance)}">
                <th scope="row">${esc(s.startedAt.slice(0, 10))}</th>
                <td class="num">${(s.totals.deliveredSeconds / 60).toFixed(1)} min</td>
                <td class="num">${(s.totals.prescribedSeconds / 60).toFixed(1)} min</td>
                <td class="num">${(s.totals.ratio * 100).toFixed(0)} %</td>
                <td>${s.provenance === 'example' ? '<span class="chip">EXAMPLE</span>' : 'yours'}</td>
              </tr>`,
            )
            .join('')}
        </tbody>
      </table>

      <p class="caption">${props.sessions.length} of ${SESSION_CAP} sessions stored on this device.
         The oldest is removed when the cap is reached.</p>
      `
    }

    <div class="button-row no-print">
      <button type="button" class="primary" id="back-to-report">${
        props.hasReport ? 'Back to report' : 'Back to the start'
      }</button>
      <button type="button" id="clear-all">Clear all data</button>
    </div>

    <dialog id="confirm-clear">
      <h2>Clear all data?</h2>
      <p>This removes ${props.sessions.length} stored session${props.sessions.length === 1 ? '' : 's'},
         both your own and any example rows.</p>
      <p>It also clears your theme preference, which returns to your system setting.</p>
      <div class="button-row">
        <button type="button" id="confirm-yes">Clear everything</button>
        <button type="button" class="primary" id="confirm-no">Keep my data</button>
      </div>
    </dialog>
  `;

  wireThemePicker(host);

  host.querySelector<HTMLButtonElement>('#load-examples')?.addEventListener('click', props.onLoadExamples);
  el<HTMLButtonElement>(host, '#back-to-report').addEventListener('click', props.onBack);

  // A native <dialog>: free focus trapping, and Esc closes it.
  const dialog = el<HTMLDialogElement>(host, '#confirm-clear');
  el<HTMLButtonElement>(host, '#clear-all').addEventListener('click', () => dialog.showModal());
  el<HTMLButtonElement>(host, '#confirm-no').addEventListener('click', () => dialog.close());
  el<HTMLButtonElement>(host, '#confirm-yes').addEventListener('click', () => {
    dialog.close();
    props.onClearAll();
  });
}
