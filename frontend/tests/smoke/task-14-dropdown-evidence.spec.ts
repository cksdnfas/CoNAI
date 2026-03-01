import path from 'node:path'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page, type Route } from '@playwright/test'

const APP_URL = process.env.E2E_APP_URL ?? 'http://127.0.0.1:5666'
const IMAGE_GENERATION_HASH = '#/image-generation'

function imageGenerationUrl(): string {
  return `${APP_URL.replace(/\/$/, '')}/${IMAGE_GENERATION_HASH}`
}

function evidencePath(fileName: string): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url))
  return path.resolve(currentDir, '../../../../.sisyphus/evidence', fileName)
}

async function jsonRoute(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

async function mockBaseline(page: Page): Promise<void> {
  await page.route('**/api/auth/status', async (route) => {
    await jsonRoute(route, {
      hasCredentials: false,
      authenticated: false,
      username: null,
    })
  })

  await page.route('**/api/workflows*', async (route) => {
    await jsonRoute(route, {
      success: true,
      data: [],
    })
  })

  await page.route('**/api/comfyui-servers*', async (route) => {
    await jsonRoute(route, {
      success: true,
      data: [],
    })
  })
}

test('task-14 dropdown happy screenshot', async ({ page }) => {
  await fs.mkdir(path.dirname(evidencePath('task-14-dropdown-happy.png')), { recursive: true })
  await mockBaseline(page)
  await page.route('**/api/custom-dropdown-lists*', async (route) => {
    await jsonRoute(route, {
      success: true,
      data: [
        {
          id: 11,
          name: 'Auto Evidence List',
          description: 'auto list for screenshot',
          items: ['model-a', 'model-b'],
          is_auto_collected: true,
          source_path: 'models/checkpoints',
          created_date: '2026-01-01',
          updated_date: '2026-01-01',
        },
        {
          id: 12,
          name: 'Manual Evidence List',
          description: 'manual list for screenshot',
          items: ['manual-a', 'manual-b'],
          is_auto_collected: false,
          source_path: null,
          created_date: '2026-01-01',
          updated_date: '2026-01-01',
        },
      ],
    })
  })

  await page.goto(imageGenerationUrl())
  const comfyuiTab = page.getByRole('tab', { name: 'ComfyUI', exact: true })
  await comfyuiTab.click()
  await expect(page.getByRole('heading', { name: 'Custom Dropdown Lists', exact: true })).toBeVisible()
  await expect(page.getByText('Auto Evidence List')).toBeVisible()

  await page.screenshot({
    path: evidencePath('task-14-dropdown-happy.png'),
    fullPage: true,
  })
})

test('task-14 dropdown error screenshot', async ({ page }) => {
  await fs.mkdir(path.dirname(evidencePath('task-14-dropdown-error.png')), { recursive: true })
  await mockBaseline(page)
  await page.route('**/api/custom-dropdown-lists*', async (route) => {
    await jsonRoute(route, {
      success: false,
      message: 'Custom dropdown load failed',
    }, 500)
  })

  await page.goto(imageGenerationUrl())
  const comfyuiTab = page.getByRole('tab', { name: 'ComfyUI', exact: true })
  await comfyuiTab.click()
  await expect(page.getByText('Custom dropdown error')).toBeVisible()
  await expect(page.getByText(/Custom dropdown load failed|Request failed with status code 500/i).first()).toBeVisible()

  await page.screenshot({
    path: evidencePath('task-14-dropdown-error.png'),
    fullPage: true,
  })
})
