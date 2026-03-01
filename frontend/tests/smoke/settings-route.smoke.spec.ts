import { expect, test, type Page, type Route } from '@playwright/test'

const APP_URL = process.env.E2E_APP_URL ?? 'http://127.0.0.1:5666'
const SETTINGS_HASH = '#/settings'
const SIMILARITY_TEST_HASH = '0123456789abcdef0123456789abcdef0123456789abcdef'
const PNG_DATA_URL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='

function settingsUrl(): string {
  return `${APP_URL.replace(/\/$/, '')}/${SETTINGS_HASH}`
}

async function jsonRoute(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

function collectBrowserErrors(page: Page) {
  const errors: string[] = []

  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text())
    }
  })

  page.on('pageerror', (error) => {
    errors.push(error.message)
  })

  return errors
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

function mockAuthDatabaseInfo(page: Page) {
  return page.route('**/api/auth/database-info', (route) => {
    void jsonRoute(route, {
      authDbPath: '/tmp/auth.db',
      exists: false,
      recoveryInstructions: {
        ko: 'auth_db_path',
        en: 'auth_db_path',
      },
    })
  })
}

function mockSettingsSuccess(page: Page) {
  return page.route('**/api/settings**', async (route) => {
    const { pathname } = new URL(route.request().url())
    if (pathname !== '/api/settings' && pathname !== '/api/settings/') {
      await route.continue()
      return
    }

    await jsonRoute(route, {
      success: true,
      data: {
        general: {
          language: 'en',
          deleteProtection: {
            enabled: true,
            recycleBinPath: 'RecycleBin',
          },
          enableGallery: true,
          autoCleanupCanvasOnShutdown: false,
          showRatingBadges: true,
        },
        tagger: {
          enabled: false,
          autoTagOnUpload: false,
          model: 'vit',
          device: 'auto',
          generalThreshold: 0.2,
          characterThreshold: 0.5,
          pythonPath: 'python',
          keepModelLoaded: false,
          autoUnloadMinutes: 30,
        },
        kaloscope: {
          enabled: false,
          autoTagOnUpload: false,
          device: 'auto',
          topK: 5,
        },
        similarity: {
          autoGenerateHashOnUpload: false,
        },
        metadataExtraction: {
          enableSecondaryExtraction: false,
          stealthScanMode: 'fast',
          stealthMaxFileSizeMB: 30,
          stealthMaxResolutionMP: 8,
          skipStealthForComfyUI: true,
          skipStealthForWebUI: false,
        },
        thumbnail: {
          size: '1080',
          quality: 90,
        },
      },
    })
  })
}

function mockPromptEndpoints(page: Page) {
  return page.route('**/api/prompt-*', async (route) => {
    const { pathname } = new URL(route.request().url())

    if (pathname.includes('/api/prompt-groups')) {
      await jsonRoute(route, {
        success: true,
        data: [],
      })
      return
    }

    if (pathname.includes('/api/prompt-collection')) {
      await jsonRoute(route, {
        success: true,
        data: [],
      })
      return
    }

    await route.continue()
  })
}

function mockSettingsFailure(page: Page) {
  return page.route('**/api/settings**', async (route) => {
    const { pathname } = new URL(route.request().url())
    if (pathname !== '/api/settings' && pathname !== '/api/settings/') {
      await route.continue()
      return
    }

    await jsonRoute(route, { success: false, message: 'Mock failure' }, 500)
  })
}

function mockSimilarityHappyPathEndpoints(page: Page) {
  return Promise.all([
    page.route('**/api/images/similarity/stats', async (route) => {
      await jsonRoute(route, {
        success: true,
        data: {
          totalImages: 12,
          imagesWithHash: 9,
          imagesWithoutHash: 3,
          completionPercentage: 75,
        },
      })
    }),
    page.route(`**/api/images/${SIMILARITY_TEST_HASH}`, async (route) => {
      await jsonRoute(route, {
        success: true,
        data: {
          composite_hash: SIMILARITY_TEST_HASH,
          original_file_path: 'query-image.png',
          width: 1024,
          height: 1024,
          thumbnail_url: PNG_DATA_URL,
        },
      })
    }),
    page.route(`**/api/images/${SIMILARITY_TEST_HASH}/similar**`, async (route) => {
      await jsonRoute(route, {
        success: true,
        data: {
          similar: [
            {
              image: {
                file_id: 77,
                composite_hash: 'feedfacefeedfacefeedfacefeedfacefeedfacefeedface',
                original_file_path: 'result-image.png',
                width: 1024,
                height: 1024,
                thumbnail_url: PNG_DATA_URL,
              },
              similarity: 98.4,
              colorSimilarity: 96.2,
              matchType: 'near-duplicate',
            },
          ],
        },
      })
    }),
    page.route('**/api/images/duplicates/all**', async (route) => {
      await jsonRoute(route, {
        success: true,
        data: {
          groups: [
            {
              groupId: 'dup-1',
              similarity: 99.9,
              matchType: 'near-duplicate',
              images: [
                {
                  file_id: 101,
                  composite_hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                  original_file_path: 'duplicate-a.png',
                  width: 768,
                  height: 768,
                  thumbnail_url: PNG_DATA_URL,
                },
                {
                  file_id: 102,
                  composite_hash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
                  original_file_path: 'duplicate-b.png',
                  width: 768,
                  height: 768,
                  thumbnail_url: PNG_DATA_URL,
                },
              ],
            },
          ],
        },
      })
    }),
  ])
}

function mockSimilarityDuplicateScanFailure(page: Page) {
  return Promise.all([
    page.route('**/api/images/similarity/stats', async (route) => {
      await jsonRoute(route, {
        success: true,
        data: {
          totalImages: 8,
          imagesWithHash: 6,
          imagesWithoutHash: 2,
          completionPercentage: 75,
        },
      })
    }),
    page.route('**/api/images/duplicates/all**', async (route) => {
      await jsonRoute(route, { success: false, message: 'Forced duplicate scan failure' }, 500)
    }),
  ])
}

test('@smoke-settings settings page renders and allows settings/prompt tab navigation', async ({ page }) => {
  await mockAuthStatus(page, false, false)
  await mockSettingsSuccess(page)
  await mockPromptEndpoints(page)
  const browserErrors = collectBrowserErrors(page)

  await page.goto(settingsUrl())

  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()

  const topTabs = [
    'General Settings',
    'Folder Management',
    'AutoTags Settings',
    'Prompt Management',
    'Rating Score Settings',
    'Image Similarity Search',
    'Account',
    'Civitai',
  ]

  for (const tab of topTabs) {
    await expect(page.getByRole('tab', { name: tab, exact: true })).toBeVisible()
  }

  await page.getByRole('tab', { name: 'Prompt Management', exact: true }).click()
  const promptTabList = page.getByRole('tablist').nth(1)
  await expect(promptTabList.getByRole('tab', { name: 'Positive', exact: true })).toBeVisible()
  await expect(promptTabList.getByRole('tab', { name: 'Negative', exact: true })).toBeVisible()
  await expect(promptTabList.getByRole('tab', { name: 'Auto', exact: true })).toBeVisible()

  await promptTabList.getByRole('tab', { name: 'Negative', exact: true }).click()
  await expect(promptTabList.getByRole('tab', { name: 'Negative', exact: true })).toHaveAttribute('aria-selected', 'true')

  await promptTabList.getByRole('tab', { name: 'Auto', exact: true }).click()
  await expect(promptTabList.getByRole('tab', { name: 'Auto', exact: true })).toHaveAttribute('aria-selected', 'true')
  expect(browserErrors).toHaveLength(0)
})

test('@smoke-settings RED parity contract enforces functional settings surfaces across active tabs', async ({ page }) => {
  await mockAuthStatus(page, false, false)
  await mockSettingsSuccess(page)
  await mockPromptEndpoints(page)

  await page.goto(settingsUrl())

  await page.getByRole('tab', { name: 'Folder Management', exact: true }).click()
  await expect.soft(page.getByRole('tab', { name: 'Folder Management', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect.soft(page.getByRole('tabpanel').locator('button, input, [role="switch"]').first()).toBeVisible()

  await page.getByRole('tab', { name: 'Prompt Management', exact: true }).click()
  const promptTabList = page.getByRole('tablist').nth(1)
  await expect.soft(page.getByRole('textbox', { name: 'Search prompts', exact: true })).toBeVisible()
  await promptTabList.getByRole('tab', { name: 'Negative', exact: true }).click()
  await expect.soft(promptTabList.getByRole('tab', { name: 'Negative', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect.soft(page.getByRole('textbox', { name: 'Search prompts', exact: true })).toBeVisible()
  await promptTabList.getByRole('tab', { name: 'Auto', exact: true }).click()
  await expect.soft(promptTabList.getByRole('tab', { name: 'Auto', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect.soft(page.getByRole('textbox', { name: 'Search prompts', exact: true })).toBeVisible()

  await page.getByRole('tab', { name: 'Rating Score Settings', exact: true }).click()
  await expect.soft(page.getByRole('tab', { name: 'Rating Score Settings', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect.soft(page.getByRole('tabpanel').locator('button, input, [role="switch"]').first()).toBeVisible()

  await page.getByRole('tab', { name: 'Image Similarity Search', exact: true }).click()
  await expect.soft(page.getByRole('tab', { name: 'Image Similarity Search', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect.soft(page.getByRole('tabpanel').locator('button, input, [role="switch"]').first()).toBeVisible()

  await page.getByRole('tab', { name: 'Account', exact: true }).click()
  await expect.soft(page.getByRole('tab', { name: 'Account', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect.soft(page.getByRole('tabpanel').locator('button, input, [role="switch"]').first()).toBeVisible()

  await page.getByRole('tab', { name: 'Civitai', exact: true }).click()
  await expect.soft(page.getByRole('tab', { name: 'Civitai', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect.soft(page.getByRole('tabpanel').locator('button, input, [role="switch"]').first()).toBeVisible()
})

test('@smoke-similarity settings similarity happy flow handles refresh search duplicate scan and captures evidence', async ({ page }) => {
  await mockAuthStatus(page, false, false)
  await mockSettingsSuccess(page)
  await mockPromptEndpoints(page)
  await mockSimilarityHappyPathEndpoints(page)
  const browserErrors = collectBrowserErrors(page)

  await page.goto(settingsUrl())

  const similarityTab = page.getByRole('tab', { name: /similarity/i })
  await expect(similarityTab).toBeVisible()
  await similarityTab.click()
  await expect(similarityTab).toHaveAttribute('aria-selected', 'true')
  const similarityPanel = page.getByRole('tabpanel', { name: /similarity/i })
  await expect(similarityPanel).toBeVisible()
  await expect(similarityPanel.getByRole('heading', { name: /similarity search settings/i })).toBeVisible()

  const refreshButton = similarityPanel.getByRole('button', { name: /refresh/i })
  await expect(refreshButton).toBeVisible()
  await expect(refreshButton).toBeEnabled()
  await refreshButton.click()
  await expect(page.getByText(/total images:\s*12/i)).toBeVisible()

  await similarityPanel.getByPlaceholder(/abc123def456/i).fill(SIMILARITY_TEST_HASH)
  await similarityPanel.getByRole('button', { name: /run search/i }).click()
  await expect(page.getByText(/search results:\s*1/i)).toBeVisible()
  await expect(page.getByText(/result-image\.png/i)).toBeVisible()

  await similarityPanel.getByRole('button', { name: /run full scan/i }).click()
  await expect(page.getByText(/found duplicate groups:\s*1/i)).toBeVisible()
  await expect(similarityPanel.getByRole('button', { name: 'Select All', exact: true })).toBeVisible()

  expect(browserErrors).toHaveLength(0)

  await page.screenshot({
    path: 'D:/Share/0_DEV/Management/Deploy/Comfyui_Image_Manager/.sisyphus/evidence/task-8-similarity-smoke.png',
    fullPage: true,
  })
})

test('@smoke-similarity settings similarity duplicate scan failure shows graceful error state with evidence', async ({ page }) => {
  await mockAuthStatus(page, false, false)
  await mockSettingsSuccess(page)
  await mockPromptEndpoints(page)
  await mockSimilarityDuplicateScanFailure(page)

  await page.goto(settingsUrl())

  await page.getByRole('tab', { name: /similarity/i }).click()
  await expect(page.getByRole('heading', { name: /similarity search settings/i })).toBeVisible()

  await page.getByRole('button', { name: /run full scan/i }).click()
  await expect(page.getByRole('alert')).toContainText(/failed to scan duplicate groups/i)
  await expect(page.getByText(/found duplicate groups:\s*0/i)).toBeVisible()

  await page.screenshot({
    path: 'D:/Share/0_DEV/Management/Deploy/Comfyui_Image_Manager/.sisyphus/evidence/task-8-similarity-smoke-error.png',
    fullPage: true,
  })
})

test('@smoke-settings settings route redirects credentialed unauthenticated users to login', async ({ page }) => {
  await mockAuthStatus(page, true, false)
  await mockAuthDatabaseInfo(page)

  await page.goto(settingsUrl())

  await expect(page).toHaveURL(/#\/login$/)
  await expect(page.getByText('ComfyUI Image Manager')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible()
})

test('@smoke-settings settings page shows load failure state when settings API errors', async ({ page }) => {
  await mockAuthStatus(page, false, false)
  await mockSettingsFailure(page)

  await page.goto(settingsUrl())

  await expect(page.getByText('Failed to load settings')).toBeVisible()
})
