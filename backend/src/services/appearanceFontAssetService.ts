import fs from 'fs'
import path from 'path'
import type { AppearanceSettings, AppearanceThemeSettings } from '../types/settings'
import { runtimePaths, publicUrls } from '../config/runtimePaths'

const appearanceFontDir = path.join(runtimePaths.uploadsDir, 'theme-fonts')
const appearanceFontUrlPrefix = `${publicUrls.uploadsBaseUrl}/theme-fonts/`

/** Extract a managed theme-font file name from the stored public URL. */
function extractAppearanceFontFileName(url: string): string | null {
  const trimmed = url.trim()
  if (!trimmed) {
    return null
  }

  if (trimmed.startsWith(appearanceFontUrlPrefix)) {
    return decodeURIComponent(trimmed.slice(appearanceFontUrlPrefix.length))
  }

  return null
}

/** Collect all appearance-managed uploaded font files referenced by one theme. */
function collectThemeFontFiles(theme: AppearanceThemeSettings | null | undefined): string[] {
  if (!theme) {
    return []
  }

  return [theme.customFontUrl, theme.customMonoFontUrl]
    .map(extractAppearanceFontFileName)
    .filter((value): value is string => Boolean(value))
}

/** Collect the full set of uploaded font file names referenced by appearance settings and slots. */
export function collectAppearanceFontFileNames(settings: AppearanceSettings): Set<string> {
  const referenced = new Set<string>()

  for (const fileName of collectThemeFontFiles(settings)) {
    referenced.add(fileName)
  }

  for (const slot of settings.presetSlots) {
    for (const fileName of collectThemeFontFiles(slot.appearance)) {
      referenced.add(fileName)
    }
  }

  return referenced
}

/** Remove theme-font uploads that are no longer referenced by saved appearance settings. */
export function cleanupUnusedAppearanceFontFiles(settings: AppearanceSettings) {
  if (!fs.existsSync(appearanceFontDir)) {
    return { removedFiles: [] as string[] }
  }

  const referenced = collectAppearanceFontFileNames(settings)
  const removedFiles: string[] = []

  for (const entry of fs.readdirSync(appearanceFontDir, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue
    }

    if (referenced.has(entry.name)) {
      continue
    }

    fs.unlinkSync(path.join(appearanceFontDir, entry.name))
    removedFiles.push(entry.name)
  }

  return { removedFiles }
}
