import { defineConfig, devices } from '@playwright/test';

const isCI = !!process.env.CI;

export default defineConfig({
  testDir: 'tests/e2e',
  forbidOnly: isCI,
  retries: 0,
  reporter: [['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: 'http://localhost:4174',
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
    // Satu build debug (--mode e2e) ke dist-e2e, terpisah dari dist produksi dan port 4173 milik pemilik.
    // CI membangun sendiri sebelum tes (langkah build:e2e di ci.yml); lokal membangun di sini.
    command: isCI ? 'bun run preview:e2e' : 'bun run build:e2e && bun run preview:e2e',
    port: 4174,
    reuseExistingServer: !isCI,
  },
});
