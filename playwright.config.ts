import { defineConfig, devices } from '@playwright/test';

const isCI = !!process.env.CI;

export default defineConfig({
  testDir: 'tests/e2e',
  forbidOnly: isCI,
  retries: 0,
  reporter: [['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    // Bahasa dasar aplikasi id; bahasa perangkat diikuti sesuai P1 (#7), jadi tes default memakai id-ID.
    locale: 'id-ID',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
      },
    },
  ],
  webServer: {
    // CI menjalankan build sendiri sebelum tes.
    command: isCI ? 'bun run preview' : 'bun run build && bun run preview',
    port: 4173,
    reuseExistingServer: !isCI,
  },
});
