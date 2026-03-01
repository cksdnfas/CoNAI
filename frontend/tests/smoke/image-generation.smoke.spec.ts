import { expect, test, type Page, type Route } from '@playwright/test'

const APP_URL = process.env.E2E_APP_URL ?? 'http://127.0.0.1:5666'
const IMAGE_GENERATION_HASH = '#/image-generation'

function imageGenerationUrl(): string {
  return `${APP_URL.replace(/\/$/, '')}/${IMAGE_GENERATION_HASH}`
}

async function jsonRoute(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

function mockAuthStatus(page: Page, hasCredentials = false, authenticated = false) {
  return page.route('**/api/auth/status', async (route) => {
    await jsonRoute(route, {
      hasCredentials,
      authenticated,
      username: authenticated ? 'admin' : null,
    })
  })
}

function mockImageGenerationBaseline(page: Page) {
  const setup = [
    page.route('**/api/workflows*', async (route) => {
      await jsonRoute(route, {
        success: true,
        data: [],
      })
    }),
    page.route('**/api/comfyui-servers*', async (route) => {
      await jsonRoute(route, {
        success: true,
        data: [],
      })
    }),
    page.route('**/api/custom-dropdown-lists*', async (route) => {
      await jsonRoute(route, {
        success: true,
        data: [],
      })
    }),
  ]

  return Promise.all(setup)
}

function mockWorkflowsFailure(page: Page) {
  return page.route('**/api/workflows*', async (route) => {
    await jsonRoute(route, {
      success: false,
      message: 'Test failure',
    }, 500)
  })
}

test('@smoke-generation image generation route renders and switches generation tabs', async ({ page }) => {
  await mockAuthStatus(page)
  await mockImageGenerationBaseline(page)

  await page.goto(imageGenerationUrl())

  await expect(page.getByRole('heading', { name: 'Image Generation', exact: true })).toBeVisible()

  const tabs = ['NovelAI', 'ComfyUI', 'Wildcards']
  for (const tabName of tabs) {
    const tab = page.getByRole('tab', { name: tabName, exact: true })
    await expect(tab).toBeVisible()
    await tab.click()
    await expect(tab).toHaveAttribute('aria-selected', 'true')
  }

  const novelaiTab = page.getByRole('tab', { name: 'NovelAI', exact: true })
  await novelaiTab.click()
  await expect(novelaiTab).toHaveAttribute('aria-selected', 'true')

  const comfyuiTab = page.getByRole('tab', { name: 'ComfyUI', exact: true })
  await comfyuiTab.click()
  await expect(comfyuiTab).toHaveAttribute('aria-selected', 'true')

  await expect(page.getByRole('heading', { name: 'Custom Dropdown Lists', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add List', exact: true })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'ComfyUI', exact: true })).toHaveAttribute('aria-selected', 'true')

  const wildcardsTab = page.getByRole('tab', { name: 'Wildcards', exact: true })
  await wildcardsTab.click()
  await expect(wildcardsTab).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('heading', { level: 2, name: /Wildcard|와일드카드|wildcards:tabs\.manual/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /Refresh|새로고침|common:refresh/i })).toBeVisible()
})

test('@smoke-generation custom dropdown section shows visible error when dropdown API fails', async ({ page }) => {
  await mockAuthStatus(page)
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
  await page.route('**/api/custom-dropdown-lists*', async (route) => {
    await jsonRoute(route, {
      success: false,
      message: 'Custom dropdown load failed',
    }, 500)
  })

  await page.goto(imageGenerationUrl())

  const comfyuiTab = page.getByRole('tab', { name: 'ComfyUI', exact: true })
  await comfyuiTab.click()
  await expect(comfyuiTab).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('custom-dropdown-error')).toBeVisible()
  await expect(page.getByText('Custom dropdown error', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add List', exact: true })).toBeVisible()
})

test('@smoke-generation image generation route stays stable when ComfyUI workflow bootstrap fails', async ({ page }) => {
  await mockAuthStatus(page)
  await mockWorkflowsFailure(page)

  await page.route('**/api/comfyui-servers*', async (route) => {
    await jsonRoute(route, {
      success: true,
      data: [],
    })
  })

  await page.goto(imageGenerationUrl())

  await expect(page.getByRole('heading', { name: 'Image Generation', exact: true })).toBeVisible()

  const comfyuiTab = page.getByRole('tab', { name: 'ComfyUI', exact: true })
  await comfyuiTab.click()

  await expect(
    page.getByText(/Request failed with status code 500|Failed to load workflows|Failed to load servers/i),
  ).toBeVisible()

  const wildcardsTab = page.getByRole('tab', { name: 'Wildcards', exact: true })
  await wildcardsTab.click()
  await expect(wildcardsTab).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('heading', { level: 2, name: /Wildcard|와일드카드|wildcards:tabs\.manual/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /Refresh|새로고침|common:refresh/i })).toBeVisible()
})
