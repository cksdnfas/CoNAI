import type { TranslationInput, TranslationParams } from '@/i18n'

export type ImageGenerationTab = 'nai' | 'codex' | 'comfyui' | 'workflows' | 'reservations' | 'chat'

type Translate = (input: TranslationInput, params?: TranslationParams) => string

/** Query param that keeps the selected ComfyUI workflow across reloads and back navigation. */
export const IMAGE_GENERATION_WORKFLOW_PARAM = 'workflow'

export const IMAGE_GENERATION_TAB_ORDER: ImageGenerationTab[] = ['nai', 'codex', 'comfyui', 'workflows', 'reservations', 'chat']

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
  if (tab === 'chat') {
    return t({ ko: 'Codex 채팅', en: 'Codex chat' })
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

/** Parse the selected ComfyUI workflow id from the URL, ignoring anything that is not a positive integer. */
export function parseImageGenerationWorkflowId(value?: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) {
    return null
  }

  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}
