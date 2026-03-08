import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Route } from '@playwright/test'

const APP_URL = process.env.E2E_APP_URL ?? 'http://127.0.0.1:5666'

function routeUrl(hashPath: string): string {
  const normalizedBaseUrl = APP_URL.replace(/\/$/, '')
  const normalizedHashPath = hashPath.startsWith('#') ? hashPath : `#${hashPath}`

  return `${normalizedBaseUrl}/${normalizedHashPath}`
}

async function jsonRoute(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

test('@smoke-task19 settings/login route contract remains intact after route cleanup', async ({ page }) => {
  await page.route('**/api/auth/status', async (route) => {
    await jsonRoute(route, {
      hasCredentials: true,
      authenticated: false,
      username: null,
    })
  })

  await page.route('**/api/auth/database-info', async (route) => {
    await jsonRoute(route, {
      authDbPath: '/tmp/auth.db',
      exists: false,
      recoveryInstructions: {
        ko: 'auth_db_path',
        en: 'auth_db_path',
      },
    })
  })

  await page.goto(routeUrl('#/settings'))
  await expect(page).toHaveURL(/#\/login$/)
  await expect(page.getByText('CoNAI')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible()

  await page.goto(routeUrl('#/login'))
  await expect(page).toHaveURL(/#\/login$/)
  await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible()

  const evidencePath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../.sisyphus/evidence/task-19-route-cleanup-smoke.png',
  )
  await page.screenshot({ path: evidencePath, fullPage: true })
})
