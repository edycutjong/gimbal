import type { PersistedSession } from './session.ts';

/**
 * Export. Two formats, both offline, deliberately mirroring the two things a
 * clinic actually uses: the printed page, and a file.
 *
 * There is no share link, no QR handoff, and no "email my PT" — each is an
 * upload with better manners, and each falsifies the claim the safety posture
 * rests on.
 */
export function downloadSessionJson(session: PersistedSession): void {
  const blob = new Blob([JSON.stringify(session, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `gimbal-session-${session.startedAt.replace(/[:.]/g, '-')}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
