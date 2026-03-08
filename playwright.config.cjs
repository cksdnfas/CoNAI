const { defineConfig, devices } = require('@playwright/test')

module.exports = defineConfig({
  testDir: './frontend/tests/smoke',
  timeout: 30000,
  reporter: 'list',
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        headless: true,
      },
    },
  ],
})
