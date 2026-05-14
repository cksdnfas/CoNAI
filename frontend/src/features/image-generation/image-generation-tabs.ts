import type { TranslationInput, TranslationParams } from '@/i18n'

export type ImageGenerationTab = 'nai' | 'codex' | 'comfyui' | 'workflows' | 'reservations'

type Translate = (input: TranslationInput, params?: TranslationParams) => string

export const IMAGE_GENERATION_TAB_ORDER: ImageGenerationTab[] = ['nai', 'codex', 'comfyui', 'workflows', 'reservations']

export function getImageGenerationTabLabel(tab: ImageGenerationTab, t: Translate) {
  if (tab === 'nai') {
    return 'NAI'
  }
  if (tab === 'codex') {
    return 'Codex'
  }
  if (tab === 'comfyui') {
    return 'ComfyUI'
  }
  if (tab === 'workflows') {
    return t({ ko: '워크플로우', en: 'Workflow' })
  }

  return t({ ko: '예약작업', en: 'Reservations' })
}

export function getImageGenerationTabs(t: Translate): Array<{ value: ImageGenerationTab; label: string }> {
  return IMAGE_GENERATION_TAB_ORDER.map((value) => ({ value, label: getImageGenerationTabLabel(value, t) }))
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
