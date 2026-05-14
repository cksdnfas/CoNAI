import type { TranslationInput, TranslationParams } from '@/i18n'

export type ImageGenerationTab = 'nai' | 'codex' | 'comfyui' | 'workflows' | 'reservations'

type Translate = (input: TranslationInput, params?: TranslationParams) => string

export const IMAGE_GENERATION_TAB_ORDER: ImageGenerationTab[] = ['nai', 'codex', 'comfyui', 'workflows', 'reservations']

export function getImageGenerationTabs(t: Translate): Array<{ value: ImageGenerationTab; label: string }> {
  return [
    { value: 'nai', label: 'NAI' },
    { value: 'codex', label: 'Codex' },
    { value: 'comfyui', label: 'ComfyUI' },
    { value: 'workflows', label: t({ ko: '워크플로우', en: 'Workflow' }) },
    { value: 'reservations', label: t({ ko: '예약 작업', en: 'Reservations' }) },
  ]
}

export function parseImageGenerationTab(value?: string | null): ImageGenerationTab {
  if (value === 'workflow') {
    return 'workflows'
  }

  if (IMAGE_GENERATION_TAB_ORDER.includes(value as ImageGenerationTab)) {
    return value as ImageGenerationTab
  }

  return 'nai'
}
