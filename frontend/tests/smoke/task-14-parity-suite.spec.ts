import { expect, test, type Route } from '@playwright/test'

const APP_URL = process.env.E2E_APP_URL ?? 'http://127.0.0.1:5666'
const SIMILARITY_HASH = '0123456789abcdef0123456789abcdef0123456789abcdef'

function hashUrl(hashPath: string): string {
  const base = APP_URL.replace(/\/$/, '')
  return `${base}/${hashPath.startsWith('#') ? hashPath : `#${hashPath}`}`
}

async function jsonRoute(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

function mockAuth(page: { route: (url: string, handler: (route: Route) => Promise<void>) => Promise<void> }, hasCredentials = false, authenticated = false) {
  return page.route('**/api/auth/status', async (route) => {
    await jsonRoute(route, {
      hasCredentials,
      authenticated,
      username: authenticated ? 'tester' : null,
    })
  })
}

test('@smoke-task14 parity home list keeps infinite load + keyboard focus escape flow', async ({ page }) => {
  await mockAuth(page, false, false)

  await page.route('**/api/settings**', async (route) => {
    await jsonRoute(route, {
      success: true,
      data: {
        tagger: { enabled: false },
      },
    })
  })

  let imageRequestCount = 0
  await page.route('**/api/images**', async (route) => {
    imageRequestCount += 1
    const pageNumber = imageRequestCount === 1 ? 1 : 2
    const imageId = imageRequestCount === 1 ? 1 : 2
    await jsonRoute(route, {
      success: true,
      data: {
        page: pageNumber,
        totalPages: 2,
        total: 2,
        images: [
          {
            id: imageId,
            composite_hash: `hash-${imageId}`,
            first_seen_date: '2026-01-01T00:00:00.000Z',
            original_file_path: `/images/${imageId}.png`,
            file_size: 1024,
            mime_type: 'image/png',
            width: 512,
            height: 512,
            ai_tool: 'comfyui',
            model_name: 'model-a',
          },
        ],
      },
    })
  })

  await page.goto(hashUrl('#/'))

  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Load more' })).toBeVisible()

  await page.getByRole('button', { name: 'Load more' }).click()
  await expect.poll(() => imageRequestCount).toBeGreaterThan(1)

  const layoutFab = page.getByTestId('home-layout-options-fab')
  await layoutFab.click()
  await expect(page.getByTestId('home-layout-options-panel')).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(page.getByTestId('home-layout-options-panel')).toBeHidden()
  await expect(layoutFab).toBeFocused()
})

test('@smoke-task14 parity similarity cards keep query/result contracts', async ({ page }) => {
  await mockAuth(page, false, false)

  await page.route('**/api/settings**', async (route) => {
    await jsonRoute(route, {
      success: true,
      data: {
        general: {
          language: 'en',
          deleteProtection: { enabled: true, recycleBinPath: 'RecycleBin' },
          enableGallery: true,
          autoCleanupCanvasOnShutdown: false,
          showRatingBadges: true,
        },
        tagger: { enabled: false, autoTagOnUpload: false },
        kaloscope: { enabled: false, autoTagOnUpload: false },
        similarity: { autoGenerateHashOnUpload: false },
        metadataExtraction: {
          enableSecondaryExtraction: false,
          stealthScanMode: 'fast',
          stealthMaxFileSizeMB: 30,
          stealthMaxResolutionMP: 8,
          skipStealthForComfyUI: true,
          skipStealthForWebUI: false,
        },
        thumbnail: { size: '1080', quality: 90 },
      },
    })
  })

  await page.route('**/api/images/similarity/stats', async (route) => {
    await jsonRoute(route, {
      success: true,
      data: {
        totalImages: 10,
        imagesWithHash: 7,
        imagesWithoutHash: 3,
        completionPercentage: 70,
      },
    })
  })

  await page.route(`**/api/images/${SIMILARITY_HASH}`, async (route) => {
    await jsonRoute(route, {
      success: true,
      data: {
        composite_hash: SIMILARITY_HASH,
        original_file_path: 'query-image.png',
        width: 512,
        height: 512,
        thumbnail_url: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
      },
    })
  })

  await page.route(`**/api/images/${SIMILARITY_HASH}/similar**`, async (route) => {
    await jsonRoute(route, {
      success: true,
      data: {
        similar: [
          {
            image: {
              file_id: 42,
              composite_hash: 'feedfacefeedfacefeedfacefeedfacefeedfacefeedface',
              original_file_path: 'result-image.png',
              width: 512,
              height: 512,
              thumbnail_url: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
            },
            similarity: 97.5,
            colorSimilarity: 95.1,
            matchType: 'near-duplicate',
          },
        ],
      },
    })
  })

  await page.goto(hashUrl('#/settings'))

  await page.getByRole('tab', { name: 'Image Similarity Search', exact: true }).click()
  await page.getByPlaceholder('e.g., abc123def456...').fill(SIMILARITY_HASH)
  await page.getByRole('button', { name: 'Run Search' }).click()

  await expect(page.getByText('Query Image')).toBeVisible()
  await expect(page.getByText('Search Results: 1')).toBeVisible()
  await expect(page.getByText('Mode: Similar')).toBeVisible()
  await expect(page.getByText('Match: Near Duplicate')).toBeVisible()
})
