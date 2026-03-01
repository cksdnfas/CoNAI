const { defineConfig, devices } = require('./frontend/node_modules/@playwright/test')

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
