import { normalizeAppearanceSettings } from '@/lib/appearance'
import type { AppearanceSettings, AppearanceThemeSettings } from '@/types/settings'
import type { AppearanceFontUploadResult } from '@/lib/api-settings'

export interface AppearancePackageFontAsset {
  target: 'sans' | 'mono'
  sourceUrl: string
  originalFileName: string
  mimeType: string
  base64Data: string
}

export interface AppearancePackageDocument {
  format: 'conai-appearance-package'
  version: 1
  exportedAt: string
  appearance: AppearanceSettings
  assets: {
    fonts: AppearancePackageFontAsset[]
  }
}

function buildFontAssetKey(target: 'sans' | 'mono', url: string) {
  return `${target}::${url}`
}

/** Read a Blob into a plain base64 string for portable JSON packaging. */
function blobToBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      const [, base64Data = ''] = result.split(',', 2)
      resolve(base64Data)
    }
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob as base64'))
    reader.readAsDataURL(blob)
  })
}

/** Convert a packaged base64 font payload back into a File for upload. */
function createFileFromBase64(base64Data: string, fileName: string, mimeType: string) {
  const binaryString = atob(base64Data)
  const bytes = Uint8Array.from(binaryString, (char) => char.charCodeAt(0))
  return new File([bytes], fileName, { type: mimeType })
}

/** Visit the live appearance and all preset-slot appearances in one pass. */
function visitAppearanceThemes(settings: AppearanceSettings, visitor: (theme: AppearanceThemeSettings) => void) {
  visitor(settings)
  for (const slot of settings.presetSlots) {
    if (slot.appearance) {
      visitor(slot.appearance)
    }
  }
}

/** Fetch and package all uploaded appearance font files referenced by the current appearance config. */
export async function buildAppearancePackage(settings: AppearanceSettings): Promise<AppearancePackageDocument> {
  const fontAssets = new Map<string, AppearancePackageFontAsset>()

  const queueAsset = (target: 'sans' | 'mono', sourceUrl: string, originalFileName: string) => {
    const trimmedUrl = sourceUrl.trim()
    if (!trimmedUrl) {
      return
    }

    const key = buildFontAssetKey(target, trimmedUrl)
    if (fontAssets.has(key)) {
      return
    }

    fontAssets.set(key, {
      target,
      sourceUrl: trimmedUrl,
      originalFileName: originalFileName.trim(),
      mimeType: '',
      base64Data: '',
    })
  }

  visitAppearanceThemes(settings, (theme) => {
    queueAsset('sans', theme.customFontUrl, theme.customFontFileName)
    queueAsset('mono', theme.customMonoFontUrl, theme.customMonoFontFileName)
  })

  const hydratedAssets = await Promise.all(Array.from(fontAssets.values()).map(async (asset) => {
    const response = await fetch(asset.sourceUrl)
    if (!response.ok) {
      throw new Error(`폰트 자산을 읽지 못했어: ${asset.originalFileName || asset.sourceUrl}`)
    }

    const blob = await response.blob()
    return {
      ...asset,
      mimeType: blob.type || 'application/octet-stream',
      base64Data: await blobToBase64(blob),
    }
  }))

  return {
    format: 'conai-appearance-package',
    version: 1,
    exportedAt: new Date().toISOString(),
    appearance: settings,
    assets: {
      fonts: hydratedAssets,
    },
  }
}

/** Detect whether imported JSON is a packaged appearance bundle with embedded font assets. */
export function isAppearancePackageDocument(value: unknown): value is AppearancePackageDocument {
  if (!value || typeof value !== 'object') {
    return false
  }

  const record = value as Record<string, unknown>
  return record.format === 'conai-appearance-package' && typeof record.appearance === 'object'
}

/** Upload embedded package fonts and rewrite appearance URLs to the new local asset URLs. */
export async function restoreAppearancePackage(
  raw: unknown,
  fallback: AppearanceSettings,
  uploadFont: (file: File, target: 'sans' | 'mono') => Promise<AppearanceFontUploadResult>,
): Promise<AppearanceSettings | null> {
  const normalized = normalizeAppearanceSettings(
    isAppearancePackageDocument(raw) ? raw.appearance : raw,
    fallback,
  )

  if (!normalized) {
    return null
  }

  if (!isAppearancePackageDocument(raw)) {
    return normalized
  }

  const uploadedFonts = new Map<string, AppearanceFontUploadResult>()
  for (const asset of raw.assets.fonts ?? []) {
    const file = createFileFromBase64(asset.base64Data, asset.originalFileName || `${asset.target}-font`, asset.mimeType || 'application/octet-stream')
    const uploaded = await uploadFont(file, asset.target)
    uploadedFonts.set(buildFontAssetKey(asset.target, asset.sourceUrl), uploaded)
  }

  const rewriteTheme = (theme: AppearanceThemeSettings) => {
    const sansUpload = uploadedFonts.get(buildFontAssetKey('sans', theme.customFontUrl))
    if (sansUpload) {
      theme.customFontUrl = sansUpload.url
      theme.customFontFileName = sansUpload.originalName
    }

    const monoUpload = uploadedFonts.get(buildFontAssetKey('mono', theme.customMonoFontUrl))
    if (monoUpload) {
      theme.customMonoFontUrl = monoUpload.url
      theme.customMonoFontFileName = monoUpload.originalName
    }
  }

  rewriteTheme(normalized)
  for (const slot of normalized.presetSlots) {
    if (slot.appearance) {
      rewriteTheme(slot.appearance)
    }
  }

  return normalized
}
