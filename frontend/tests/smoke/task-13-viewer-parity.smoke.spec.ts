import { expect, test, type Page, type Route } from '@playwright/test'

const APP_URL = process.env.E2E_APP_URL ?? 'http://127.0.0.1:5666'

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

function makeImage(id: number, hash: string, filePath: string) {
  return {
    id,
    file_id: id,
    composite_hash: hash,
    first_seen_date: '2026-01-01T00:00:00.000Z',
    original_file_path: filePath,
    file_size: 1024,
    mime_type: 'image/png',
    width: 512,
    height: 512,
    file_type: 'image',
    ai_tool: 'comfyui',
    model_name: 'smoke-model',
    prompt: 'smoke prompt',
    negative_prompt: 'none',
  }
}

async function mockAuth(page: Page): Promise<void> {
  await page.route('**/api/auth/status**', async (route) => {
    await jsonRoute(route, {
      hasCredentials: false,
      authenticated: false,
      username: null,
    })
  })
}

async function mockViewerSettings(page: Page): Promise<void> {
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
        kaloscope: { enabled: false, autoTagOnUpload: false, device: 'auto', topK: 5 },
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
}

async function assertViewerCoreParity(page: Page): Promise<void> {
  const dialog = page.getByTestId('image-viewer-dialog')
  await expect(dialog).toBeVisible()

  await expect(page.getByTestId('viewer-title')).toHaveText('Image 1 of 2')
  await expect(page.getByRole('button', { name: 'Prev', exact: true })).toBeDisabled()

  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.getByTestId('viewer-title')).toHaveText('Image 2 of 2')

  await page.getByRole('button', { name: 'Prev', exact: true }).click()
  await expect(page.getByTestId('viewer-title')).toHaveText('Image 1 of 2')

  const fileInfoTrigger = page.getByTestId('viewer-file-info-trigger')
  await expect(fileInfoTrigger).toBeVisible()
  await fileInfoTrigger.click()
  await expect(fileInfoTrigger).toBeVisible()

  await page.getByRole('button', { name: 'Close' }).first().click()
  await expect(dialog).toBeHidden()
}

async function clickGroupImageViewEntry(page: Page): Promise<void> {
  const localizedViewImages = page.getByRole('button', {
    name: /view images|이미지 보기|画像|查看图片|閲覧/i,
  }).first()
  await expect(localizedViewImages).toBeVisible()
  await localizedViewImages.click()
}

test('@smoke-viewer-parity home entrypoint keeps viewer parity controls', async ({ page }) => {
  await mockAuth(page)
  await mockViewerSettings(page)

  await page.route('**/api/images**', async (route) => {
    await jsonRoute(route, {
      success: true,
      data: {
        page: 1,
        totalPages: 1,
        total: 2,
        images: [
          makeImage(1, 'home-hash-1', '/images/home-one.png'),
          makeImage(2, 'home-hash-2', '/images/home-two.png'),
        ],
      },
    })
  })

  await page.goto(hashUrl('#/'))
  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible()

  await page.locator('[data-testid="image-list-item"]').first().click()
  await assertViewerCoreParity(page)
})

test('@smoke-viewer-parity group modal entrypoint keeps viewer parity controls', async ({ page }) => {
  await mockAuth(page)
  await mockViewerSettings(page)

  await page.route('**/api/groups/hierarchy/roots', async (route) => {
    await jsonRoute(route, {
      success: true,
      data: [
        {
          id: 41,
          name: 'Viewer Group',
          color: '#22c55e',
          image_count: 2,
          child_count: 0,
          parent_id: null,
          auto_collect_enabled: false,
        },
      ],
    })
  })

  await page.route('**/api/groups/41/children', async (route) => {
    await jsonRoute(route, {
      success: true,
      data: [],
    })
  })

  await page.route('**/api/groups/41/breadcrumb', async (route) => {
    await jsonRoute(route, {
      success: true,
      data: [
        {
          id: 41,
          name: 'Viewer Group',
        },
      ],
    })
  })

  await page.route('**/api/groups/41/file-counts', async (route) => {
    await jsonRoute(route, {
      success: true,
      data: {
        thumbnail: 2,
        original: 2,
        video: 0,
      },
    })
  })

  await page.route('**/api/groups/41/preview-images**', async (route) => {
    await jsonRoute(route, {
      success: true,
      data: [makeImage(1, 'group-hash-1', '/images/group-one.png')],
    })
  })

  await page.route('**/api/groups/41/images**', async (route) => {
    await jsonRoute(route, {
      success: true,
      data: {
        images: [
          makeImage(1, 'group-hash-1', '/images/group-one.png'),
          makeImage(2, 'group-hash-2', '/images/group-two.png'),
        ],
        pagination: {
          page: 1,
          totalPages: 1,
          total: 2,
        },
      },
    })
  })

  await page.route('**/api/groups/41', async (route) => {
    await jsonRoute(route, {
      success: true,
      data: {
        id: 41,
        name: 'Viewer Group',
        color: '#22c55e',
        image_count: 2,
        child_count: 0,
        parent_id: null,
        auto_collect_enabled: false,
      },
    })
  })

  await page.goto(hashUrl('#/image-groups'))
  await expect(page.getByRole('heading', { name: /image groups|media groups/i })).toBeVisible()

  await page.getByRole('button', { name: 'Viewer Group', exact: true }).click()
  await clickGroupImageViewEntry(page)

  await expect(page.getByTestId('image-list-root')).toBeVisible()
  await page.locator('[data-testid="image-list-item"]').first().click()
  await assertViewerCoreParity(page)
})

test('@smoke-viewer-parity history entrypoint keeps viewer parity controls', async ({ page }) => {
  await mockAuth(page)
  await mockViewerSettings(page)

  await page.route('**/api/workflows/1', async (route) => {
    await jsonRoute(route, {
      data: {
        id: 1,
        name: 'Smoke Workflow',
        description: 'Viewer parity workflow fixture',
        workflow_json: '{}',
        marked_fields: [],
        api_endpoint: '/prompt',
        is_active: true,
        color: '#22c55e',
        created_date: '2026-01-01T00:00:00.000Z',
        updated_date: '2026-01-01T00:00:00.000Z',
      },
    })
  })

  await page.route('**/api/comfyui-servers?active=true', async (route) => {
    await jsonRoute(route, {
      data: [
        {
          id: 101,
          name: 'Smoke Server',
          endpoint: 'http://127.0.0.1:8188',
          is_active: true,
          created_date: '2026-01-01T00:00:00.000Z',
          updated_date: '2026-01-01T00:00:00.000Z',
        },
      ],
    })
  })

  await page.route('**/api/comfyui-servers/101/test-connection', async (route) => {
    await jsonRoute(route, {
      data: {
        isConnected: true,
      },
    })
  })

  await page.route('**/api/generation-history/workflow/1**', async (route) => {
    await jsonRoute(route, {
      success: true,
      records: [
        {
          id: 601,
          workflow_id: 1,
          service_type: 'comfyui',
          generation_status: 'completed',
          created_at: '2026-01-01T00:00:00.000Z',
          original_path: '/images/history-one.png',
          width: 512,
          height: 512,
          file_size: 1024,
          actual_composite_hash: 'history-hash-1',
          positive_prompt: 'history prompt one',
          negative_prompt: 'none',
        },
        {
          id: 602,
          workflow_id: 1,
          service_type: 'comfyui',
          generation_status: 'completed',
          created_at: '2026-01-01T00:00:00.000Z',
          original_path: '/images/history-two.png',
          width: 512,
          height: 512,
          file_size: 1024,
          actual_composite_hash: 'history-hash-2',
          positive_prompt: 'history prompt two',
          negative_prompt: 'none',
        },
      ],
    })
  })

  await page.goto(hashUrl('#/image-generation/1/generate'))
  await expect(page.getByText('Smoke Workflow', { exact: true })).toBeVisible()

  await page.locator('[data-testid="image-list-item"]').first().click()
  await assertViewerCoreParity(page)
})
