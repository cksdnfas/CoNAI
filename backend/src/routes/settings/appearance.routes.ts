import fs from 'fs'
import path from 'path'
import multer from 'multer'
import { Router, Request, Response } from 'express'
import { asyncHandler } from '../../middleware/errorHandler'
import { runtimePaths, publicUrls } from '../../config/runtimePaths'
import { settingsService } from '../../services/settingsService'
import type { AppearancePresetSlot, AppearanceSettings, AppearanceThemeSettings } from '../../types/settings'

const router = Router()
const validAppearanceModes = ['system', 'dark', 'light']
const validAppearancePresets = ['conai', 'ocean', 'forest', 'custom']
const validSurfacePresets = ['studio', 'midnight', 'paper', 'custom']
const validRadiusPresets = ['sharp', 'balanced', 'soft']
const validGlassPresets = ['subtle', 'balanced', 'immersive']
const validShadowPresets = ['soft', 'balanced', 'dramatic']
const validDensityPresets = ['compact', 'comfortable', 'spacious']
const validFontPresets = ['manrope', 'system', 'custom']
const validBodyFontWeightPresets = ['regular', 'medium']
const validEmphasisFontWeightPresets = ['standard', 'bold']
const validGroupExplorerCardStyles = ['compact-row', 'media-tile']
const validAppearancePresetSlotIds = ['slot-1', 'slot-2', 'slot-3']
const appearanceFontDir = path.join(runtimePaths.uploadsDir, 'theme-fonts')
const allowedFontExtensions = new Set(['.ttf', '.otf', '.woff', '.woff2'])
const allowedFontMimeTypes = new Set([
  'font/ttf',
  'font/otf',
  'font/woff',
  'font/woff2',
  'application/font-sfnt',
  'application/font-woff',
  'application/x-font-ttf',
  'application/x-font-otf',
  'application/octet-stream',
])

function normalizeUploadedOriginalName(originalName: string) {
  const decodedName = Buffer.from(originalName, 'latin1').toString('utf8')
  const looksMojibake = /[À-ÿ]/.test(originalName) && !/[가-힣]/.test(originalName)
  const decodedHasReadableUnicode = /[가-힣ㄱ-ㅎㅏ-ㅣぁ-ゖァ-ヺ一-龯]/.test(decodedName)

  if (looksMojibake && decodedHasReadableUnicode) {
    return decodedName
  }

  return originalName
}

const appearanceFontUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      fs.mkdirSync(appearanceFontDir, { recursive: true })
      cb(null, appearanceFontDir)
    },
    filename: (req, file, cb) => {
      const target = req.body?.target === 'mono' ? 'mono' : 'sans'
      const timestamp = Date.now()
      const random = Math.random().toString(36).slice(2, 10)
      const ext = path.extname(file.originalname).toLowerCase()
      cb(null, `appearance-${target}-${timestamp}-${random}${ext}`)
    },
  }),
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase()
    if (!allowedFontExtensions.has(extension)) {
      cb(new Error(`Unsupported font extension: ${extension || '(none)'}`))
      return
    }

    if (file.mimetype && !allowedFontMimeTypes.has(file.mimetype)) {
      cb(new Error(`Unsupported font mime type: ${file.mimetype}`))
      return
    }

    cb(null, true)
  },
})

function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)
}

function validateAppearanceThemeSettings(appearanceSettings: Partial<AppearanceThemeSettings>): string | null {
  if (appearanceSettings.themeMode !== undefined && !validAppearanceModes.includes(appearanceSettings.themeMode)) {
    return `Invalid theme mode. Must be one of: ${validAppearanceModes.join(', ')}`
  }

  if (appearanceSettings.accentPreset !== undefined && !validAppearancePresets.includes(appearanceSettings.accentPreset)) {
    return `Invalid accent preset. Must be one of: ${validAppearancePresets.join(', ')}`
  }

  if (appearanceSettings.customPrimaryColor !== undefined && !isHexColor(appearanceSettings.customPrimaryColor)) {
    return 'customPrimaryColor must be a hex color like #f95e14'
  }

  if (appearanceSettings.customSecondaryColor !== undefined && !isHexColor(appearanceSettings.customSecondaryColor)) {
    return 'customSecondaryColor must be a hex color like #ffb59a'
  }

  if (appearanceSettings.surfacePreset !== undefined && !validSurfacePresets.includes(appearanceSettings.surfacePreset)) {
    return `Invalid surface preset. Must be one of: ${validSurfacePresets.join(', ')}`
  }

  if (appearanceSettings.radiusPreset !== undefined && !validRadiusPresets.includes(appearanceSettings.radiusPreset)) {
    return `Invalid radius preset. Must be one of: ${validRadiusPresets.join(', ')}`
  }

  if (appearanceSettings.glassPreset !== undefined && !validGlassPresets.includes(appearanceSettings.glassPreset)) {
    return `Invalid glass preset. Must be one of: ${validGlassPresets.join(', ')}`
  }

  if (appearanceSettings.shadowPreset !== undefined && !validShadowPresets.includes(appearanceSettings.shadowPreset)) {
    return `Invalid shadow preset. Must be one of: ${validShadowPresets.join(', ')}`
  }

  if (appearanceSettings.density !== undefined && !validDensityPresets.includes(appearanceSettings.density)) {
    return `Invalid density preset. Must be one of: ${validDensityPresets.join(', ')}`
  }

  if (appearanceSettings.fontPreset !== undefined && !validFontPresets.includes(appearanceSettings.fontPreset)) {
    return `Invalid font preset. Must be one of: ${validFontPresets.join(', ')}`
  }

  if (appearanceSettings.bodyFontWeightPreset !== undefined && !validBodyFontWeightPresets.includes(appearanceSettings.bodyFontWeightPreset)) {
    return `Invalid body font weight preset. Must be one of: ${validBodyFontWeightPresets.join(', ')}`
  }

  if (
    appearanceSettings.emphasisFontWeightPreset !== undefined &&
    !validEmphasisFontWeightPresets.includes(appearanceSettings.emphasisFontWeightPreset)
  ) {
    return `Invalid emphasis font weight preset. Must be one of: ${validEmphasisFontWeightPresets.join(', ')}`
  }

  if (
    appearanceSettings.detailRelatedImageAspectRatio !== undefined &&
    !['original', 'square', 'portrait', 'landscape'].includes(appearanceSettings.detailRelatedImageAspectRatio)
  ) {
    return 'detailRelatedImageAspectRatio must be one of: original, square, portrait, landscape'
  }

  if (
    appearanceSettings.groupExplorerCardStyle !== undefined &&
    !validGroupExplorerCardStyles.includes(appearanceSettings.groupExplorerCardStyle)
  ) {
    return `groupExplorerCardStyle must be one of: ${validGroupExplorerCardStyles.join(', ')}`
  }

  const hexColorFields: Array<keyof Pick<AppearanceThemeSettings,
    'customSurfaceBackgroundColor' |
    'customSurfaceLowestColor' |
    'customSurfaceLowColor' |
    'customSurfaceContainerColor' |
    'customSurfaceHighColor' |
    'positiveBadgeColor' |
    'negativeBadgeColor' |
    'autoBadgeColor' |
    'ratingBadgeColor'
  >> = [
    'customSurfaceBackgroundColor',
    'customSurfaceLowestColor',
    'customSurfaceLowColor',
    'customSurfaceContainerColor',
    'customSurfaceHighColor',
    'positiveBadgeColor',
    'negativeBadgeColor',
    'autoBadgeColor',
    'ratingBadgeColor',
  ]

  for (const field of hexColorFields) {
    const value = appearanceSettings[field]
    if (value !== undefined && !isHexColor(value)) {
      return `${field} must be a hex color like #f95e14`
    }
  }

  if (appearanceSettings.customFontFamily !== undefined && typeof appearanceSettings.customFontFamily !== 'string') {
    return 'customFontFamily must be a string'
  }

  if (appearanceSettings.customMonoFontFamily !== undefined && typeof appearanceSettings.customMonoFontFamily !== 'string') {
    return 'customMonoFontFamily must be a string'
  }

  if (appearanceSettings.customFontUrl !== undefined && typeof appearanceSettings.customFontUrl !== 'string') {
    return 'customFontUrl must be a string'
  }

  if (appearanceSettings.customMonoFontUrl !== undefined && typeof appearanceSettings.customMonoFontUrl !== 'string') {
    return 'customMonoFontUrl must be a string'
  }

  if (appearanceSettings.customFontFileName !== undefined && typeof appearanceSettings.customFontFileName !== 'string') {
    return 'customFontFileName must be a string'
  }

  if (appearanceSettings.customMonoFontFileName !== undefined && typeof appearanceSettings.customMonoFontFileName !== 'string') {
    return 'customMonoFontFileName must be a string'
  }

  const boundedIntegers: Array<{ key: keyof Pick<AppearanceThemeSettings,
    'fontScalePercent' |
    'textScalePercent' |
    'searchBoxWidth' |
    'searchDrawerWidth' |
    'desktopSearchMinWidth' |
    'desktopNavMinWidth' |
    'desktopPageColumnsMinWidth' |
    'detailRelatedImageMobileColumns' |
    'detailRelatedImageColumns' |
    'selectionOutlineWidth'
  >; min: number; max: number }> = [
    { key: 'fontScalePercent', min: 85, max: 200 },
    { key: 'textScalePercent', min: 85, max: 200 },
    { key: 'searchBoxWidth', min: 240, max: 640 },
    { key: 'searchDrawerWidth', min: 320, max: 720 },
    { key: 'desktopSearchMinWidth', min: 640, max: 1600 },
    { key: 'desktopNavMinWidth', min: 768, max: 1800 },
    { key: 'desktopPageColumnsMinWidth', min: 768, max: 1800 },
    { key: 'detailRelatedImageMobileColumns', min: 1, max: 6 },
    { key: 'detailRelatedImageColumns', min: 1, max: 6 },
    { key: 'selectionOutlineWidth', min: 1, max: 8 },
  ]

  for (const { key, min, max } of boundedIntegers) {
    const value = appearanceSettings[key]
    if (value !== undefined && (!Number.isInteger(value) || value < min || value > max)) {
      return `${key} must be an integer between ${min} and ${max}`
    }
  }

  return null
}

function validateAppearancePresetSlots(presetSlots: unknown): string | null {
  if (!Array.isArray(presetSlots) || presetSlots.length !== validAppearancePresetSlotIds.length) {
    return `presetSlots must be an array of ${validAppearancePresetSlotIds.length} items`
  }

  for (const [index, slot] of presetSlots.entries()) {
    if (!slot || typeof slot !== 'object') {
      return `presetSlots[${index}] must be an object`
    }

    const record = slot as Record<string, unknown>

    if (record.id !== validAppearancePresetSlotIds[index]) {
      return `presetSlots[${index}].id must be ${validAppearancePresetSlotIds[index]}`
    }

    if (typeof record.label !== 'string' || record.label.trim().length === 0 || record.label.trim().length > 32) {
      return `presetSlots[${index}].label must be a non-empty string up to 32 characters`
    }

    if (record.updatedAt !== null && typeof record.updatedAt !== 'string') {
      return `presetSlots[${index}].updatedAt must be a string or null`
    }

    if (record.appearance !== null && record.appearance !== undefined) {
      const validationError = validateAppearanceThemeSettings(record.appearance as Partial<AppearanceThemeSettings>)
      if (validationError) {
        return `presetSlots[${index}].appearance: ${validationError}`
      }

      const nextAppearance = record.appearance as AppearanceThemeSettings
      if (nextAppearance.accentPreset === 'custom') {
        if (!isHexColor(nextAppearance.customPrimaryColor) || !isHexColor(nextAppearance.customSecondaryColor)) {
          return `presetSlots[${index}].appearance requires valid custom colors`
        }
      }
    }
  }

  return null
}

router.post('/appearance/font-upload', (req: Request, res: Response, next) => {
  appearanceFontUpload.single('font')(req, res, (error) => {
    if (error) {
      res.status(400).json({
        success: false,
        error: error.message || '폰트 업로드에 실패했어.',
      })
      return
    }

    next()
  })
}, asyncHandler(async (req: Request, res: Response) => {
  const target = req.body?.target === 'mono' ? 'mono' : req.body?.target === 'sans' ? 'sans' : null
  const file = req.file

  if (!target) {
    res.status(400).json({
      success: false,
      error: 'target must be either sans or mono',
    })
    return
  }

  if (!file) {
    res.status(400).json({
      success: false,
      error: 'No font file uploaded',
    })
    return
  }

  const publicUrl = `${publicUrls.uploadsBaseUrl}/theme-fonts/${file.filename}`
  const originalName = normalizeUploadedOriginalName(file.originalname)

  res.status(201).json({
    success: true,
    data: {
      target,
      fileName: file.filename,
      originalName,
      url: publicUrl,
      mimeType: file.mimetype,
      size: file.size,
    },
  })
}))

router.put('/appearance', asyncHandler(async (req: Request, res: Response) => {
  const appearanceSettings: Partial<AppearanceSettings> = req.body
  const appearanceValidationError = validateAppearanceThemeSettings(appearanceSettings)
  if (appearanceValidationError) {
    res.status(400).json({
      success: false,
      error: appearanceValidationError,
    })
    return
  }

  if (appearanceSettings.presetSlots !== undefined) {
    const presetSlotsValidationError = validateAppearancePresetSlots(appearanceSettings.presetSlots)
    if (presetSlotsValidationError) {
      res.status(400).json({
        success: false,
        error: presetSlotsValidationError,
      })
      return
    }
  }

  const currentSettings = settingsService.loadSettings()
  const nextAppearance: AppearanceSettings = {
    ...currentSettings.appearance,
    ...appearanceSettings,
    presetSlots: appearanceSettings.presetSlots ?? currentSettings.appearance.presetSlots,
  }

  if (nextAppearance.accentPreset === 'custom') {
    if (!isHexColor(nextAppearance.customPrimaryColor) || !isHexColor(nextAppearance.customSecondaryColor)) {
      res.status(400).json({
        success: false,
        error: 'Custom preset requires valid customPrimaryColor and customSecondaryColor values',
      })
      return
    }
  }

  for (const slot of nextAppearance.presetSlots as AppearancePresetSlot[]) {
    if (slot.appearance?.accentPreset === 'custom') {
      if (!isHexColor(slot.appearance.customPrimaryColor) || !isHexColor(slot.appearance.customSecondaryColor)) {
        res.status(400).json({
          success: false,
          error: `${slot.id} requires valid custom colors when using the custom accent preset`,
        })
        return
      }
    }
  }

  const updatedSettings = settingsService.updateAppearanceSettings(appearanceSettings)

  res.json({
    success: true,
    data: updatedSettings,
    message: 'Appearance settings updated successfully',
  })
}))

export const appearanceSettingsRoutes = router
