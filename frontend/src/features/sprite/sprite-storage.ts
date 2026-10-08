import { DEFAULT_OUTPUT, DEFAULT_SAVE, defaultExtractForm, type ExtractForm, type OutputForm, type SaveForm } from './sprite-options'

/**
 * The extract tab's last settings, per browser: a reload keeps working in the same style. Shared, named settings are
 * the server presets; this is only the convenience of picking up where you left off.
 */
const STORAGE_KEY = 'conai.sprite.extract.v1'

export interface StoredSpriteSettings {
  form: ExtractForm
  output: OutputForm
  save: SaveForm
  presetId: string | null
}

export function readStoredSpriteSettings(): StoredSpriteSettings {
  const fallback: StoredSpriteSettings = { form: defaultExtractForm(null), output: DEFAULT_OUTPUT, save: DEFAULT_SAVE, presetId: null }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<StoredSpriteSettings>
    return {
      // Older or partial records keep the defaults for whatever they lack.
      form: { ...fallback.form, ...(parsed.form ?? {}) },
      output: { ...fallback.output, ...(parsed.output ?? {}) },
      save: { ...fallback.save, ...(parsed.save ?? {}) },
      presetId: typeof parsed.presetId === 'string' ? parsed.presetId : null,
    }
  } catch {
    return fallback
  }
}

export function writeStoredSpriteSettings(settings: StoredSpriteSettings) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Private windows and blocked storage simply start from the defaults next time.
  }
}
