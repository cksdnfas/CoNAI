import { expect, test, type Page, type Route } from '@playwright/test'

const APP_URL = process.env.E2E_APP_URL ?? 'http://127.0.0.1:5666'
const IMAGE_HASH = 'task6-prompt-stack-image'

function imageDetailUrl(): string {
  return `${APP_URL.replace(/\/$/, '')}/#/image/${IMAGE_HASH}`
}

async function jsonRoute(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

function mockAuthStatus(page: Page): Promise<void> {
  return page.route('**/api/auth/status', async (route) => {
    await jsonRoute(route, {
      hasCredentials: false,
      authenticated: false,
      username: null,
    })
  })
}

function mockSettings(page: Page): Promise<void> {
  return page.route('**/api/settings/', async (route) => {
    await jsonRoute(route, {
      success: true,
      data: {
        general: { language: 'en', deleteProtection: { enabled: false, recycleBinPath: '' } },
        tagger: {
          enabled: true,
          autoTagOnUpload: false,
          model: 'vit',
          device: 'auto',
          generalThreshold: 0.35,
          characterThreshold: 0.85,
          pythonPath: '',
          keepModelLoaded: false,
          autoUnloadMinutes: 10,
        },
        kaloscope: { enabled: false, autoTagOnUpload: false, device: 'auto', topK: 5 },
        similarity: { autoGenerateHashOnUpload: false },
        metadataExtraction: {
          enableSecondaryExtraction: true,
          stealthScanMode: 'fast',
          stealthMaxFileSizeMB: 16,
          stealthMaxResolutionMP: 24,
          skipStealthForComfyUI: true,
          skipStealthForWebUI: true,
        },
        thumbnail: { size: '1080', quality: 85 },
      },
    })
  })
}

function mockImage(page: Page): Promise<void> {
  return page.route(`**/api/images/${IMAGE_HASH}`, async (route) => {
    await jsonRoute(route, {
      success: true,
      data: {
        composite_hash: IMAGE_HASH,
        original_file_path: 'task6.png',
        mime_type: 'image/png',
        width: 1024,
        height: 1024,
        file_size: 204800,
        first_seen_date: '2026-03-01T00:00:00.000Z',
        groups: [],
        ai_metadata: {
          ai_tool: 'ComfyUI',
          model_name: 'test-model',
          lora_models: null,
          prompts: {
            prompt: 'masterpiece, 1girl, detailed background',
            negative_prompt: 'lowres, blurry',
          },
          generation_params: {
            steps: 20,
            cfg_scale: 7,
            sampler: 'euler',
            scheduler: 'normal',
            seed: 12345,
            denoise_strength: 0.6,
            batch_size: 1,
            batch_index: 0,
          },
          raw_nai_parameters: null,
        },
        auto_tags: {
          rating: { general: 0.9, sensitive: 0.1, questionable: 0, explicit: 0 },
          character: { 'test character': 0.88 },
          taglist: '1girl, solo, smile, detailed background',
          general: { smile: 0.81, solo: 0.77, outdoors: 0.63 },
          model: 'wd-vit',
          thresholds: { general: 0.35, character: 0.85 },
          tagged_at: '2026-03-01T00:00:00.000Z',
        },
      },
    })
  })
}

test('@smoke-generation prompt display copy/regenerate happy path and screenshot evidence', async ({ page }) => {
  await page.addInitScript(() => {
    const state = { text: '' }
    Object.defineProperty(window, '__task6ClipboardState', {
      value: state,
      writable: true,
      configurable: true,
    })

    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async (text: string) => {
          state.text = text
        },
      },
      configurable: true,
    })
  })

  await Promise.all([mockAuthStatus(page), mockSettings(page), mockImage(page)])

  let tagRequestCount = 0
  await page.route(`**/api/images/${IMAGE_HASH}/tag`, async (route) => {
    tagRequestCount += 1
    await jsonRoute(route, {
      success: true,
      data: { ok: true },
    })
  })

  await page.goto(imageDetailUrl())
  await expect(page.getByText('Auto Tags')).toBeVisible()

  const tagListHeader = page.getByText(/tag list/i).first()
  const copyButton = tagListHeader.locator('xpath=../button')
  await copyButton.click()
  await expect.poll(async () => page.evaluate(() => (window as { __task6ClipboardState?: { text?: string } }).__task6ClipboardState?.text ?? '')).toContain('1girl')
  await expect(copyButton).toHaveClass(/text-emerald-600/)

  const regenerateButton = page.getByRole('button', { name: /regenerate tags/i })
  await regenerateButton.click()
  await expect.poll(() => tagRequestCount).toBe(1)

  await page.screenshot({
    path: 'D:/Share/0_DEV/Management/Deploy/Comfyui_Image_Manager/.sisyphus/evidence/task-6-prompt-stack.png',
    fullPage: true,
  })
})

test('@smoke-generation prompt display regenerate failure shows graceful error and screenshot evidence', async ({ page }) => {
  await Promise.all([mockAuthStatus(page), mockSettings(page), mockImage(page)])

  await page.route(`**/api/images/${IMAGE_HASH}/tag`, async (route) => {
    await jsonRoute(route, {
      success: false,
      error: 'Forced tagger failure',
    }, 500)
  })

  await page.goto(imageDetailUrl())
  await expect(page.getByText('Auto Tags')).toBeVisible()

  const regenerateButton = page.getByRole('button', { name: /regenerate tags/i })
  await regenerateButton.click()

  await expect(page.getByRole('alert')).toContainText(/forced tagger failure|500/i)

  await page.screenshot({
    path: 'D:/Share/0_DEV/Management/Deploy/Comfyui_Image_Manager/.sisyphus/evidence/task-6-prompt-stack-error.png',
    fullPage: true,
  })
})
