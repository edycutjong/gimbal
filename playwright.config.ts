import { defineConfig, devices } from '@playwright/test';

/**
 * The e2e specs drive a REAL browser against the REAL model over REAL recorded
 * pixels. Nothing is stubbed; the only substitution is the pixel source, and it
 * is a decoded `<video>` of a committed recording handed to the page as a real
 * `MediaStream` via `captureStream()`.
 *
 * `--use-fake-device-for-media-stream` is deliberately NOT used: it would feed
 * Chrome's synthetic rolling-pattern video into the landmarker, which is a
 * simulated measurement. The override happens in page script instead, so what
 * flows through `detectForVideo` is recorded pixels of a real head.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  timeout: 180_000,
  use: {
    baseURL: process.env.GIMBAL_URL ?? 'http://127.0.0.1:5173',
    trace: 'off',
    video: 'off',
    permissions: ['camera'],
    launchOptions: {
      args: ['--autoplay-policy=no-user-gesture-required'],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.GIMBAL_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://127.0.0.1:5173',
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
