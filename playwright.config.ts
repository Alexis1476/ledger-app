import { defineConfig, devices } from '@playwright/test'
import { join } from 'node:path'

/**
 * E2E against the dev server in "local folder" mode, on a throwaway copy of ledger-data
 * (tests/e2e/.data, recreated by global-setup). Uses the installed Edge/Chrome
 * (PW_CHANNEL=msedge|chrome) or Playwright's Chromium (`npx playwright install chromium`).
 */
const port = 5174
const dataDir = join(import.meta.dirname, 'tests', 'e2e', '.data')

export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${port}`,
    channel: process.env.PW_CHANNEL || undefined,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  },
  projects: [
    { name: 'phone', use: { ...devices['Pixel 7'], channel: process.env.PW_CHANNEL || undefined } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel: process.env.PW_CHANNEL || undefined } }
  ],
  workers: 1,
  webServer: {
    command: `npx vite --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    env: { LEDGER_DATA_DIR: dataDir, HLEDGER: process.env.HLEDGER ?? 'hledger' }
  }
})
