import type { Dispatch, SetStateAction } from 'react'
import { CHAT_PAGE_LIMITS, type ChatPageField } from '@conai/shared'
import { useI18n } from '@/i18n'
import { useChatPageRegistration } from '@/features/codex-chat/chat-page-context'
import type { WorkflowMarkedField } from '@/lib/api-image-generation-types'
import { NAI_MODEL_OPTIONS, NAI_SAMPLER_OPTIONS, NAI_SCHEDULER_OPTIONS, supportsNaiTransparentBackground, type NAIFormDraft, type WorkflowFieldDraftValue } from '../image-generation-shared'
import { applyNaiFormPatch } from './use-nai-form-controller'

export function useNaiChatPage(form: NAIFormDraft, setForm: Dispatch<SetStateAction<NAIFormDraft>>) {
  const { t } = useI18n()
  const fields: ChatPageField[] = [
    { id: 'prompt', label: t({ ko: '프롬프트', en: 'Prompt' }), type: 'text', value: form.prompt },
    { id: 'negativePrompt', label: t({ ko: '부정 프롬프트', en: 'Negative prompt' }), type: 'text', value: form.negativePrompt },
    { id: 'model', label: t({ ko: '모델', en: 'Model' }), type: 'select', value: form.model, options: NAI_MODEL_OPTIONS.map((item) => item.value) },
    { id: 'sampler', label: t({ ko: '샘플러', en: 'Sampler' }), type: 'select', value: form.sampler, options: NAI_SAMPLER_OPTIONS.map((item) => item.value) },
    { id: 'scheduler', label: t({ ko: '스케줄러', en: 'Scheduler' }), type: 'select', value: form.scheduler, options: NAI_SCHEDULER_OPTIONS.map((item) => item.value) },
    { id: 'width', label: t({ ko: '너비', en: 'Width' }), type: 'number', value: form.width, min: 64, integer: true, multipleOf: 64 },
    { id: 'height', label: t({ ko: '높이', en: 'Height' }), type: 'number', value: form.height, min: 64, integer: true, multipleOf: 64 },
    { id: 'steps', label: 'Steps', type: 'number', value: form.steps, min: 1, max: 100, integer: true },
    { id: 'scale', label: 'CFG Scale', type: 'number', value: form.scale, min: 1, max: 20 },
    { id: 'seed', label: t({ ko: '시드', en: 'Seed' }), type: 'number', value: form.seed, min: 0, max: 4294967288, integer: true, allowEmpty: true },
  ]
  if (supportsNaiTransparentBackground(form.model)) fields.push({ id: 'transparentBackground', label: t({ ko: '투명 배경', en: 'Transparent background' }), type: 'boolean', value: form.transparentBackground })
  useChatPageRegistration({
    kind: 'nai', title: t({ ko: 'NovelAI 생성', en: 'NovelAI generation' }), resourceId: 'novelai', fields,
    apply: (values) => {
      const patch = values as Partial<NAIFormDraft>
      if (patch.transparentBackground === true && !supportsNaiTransparentBackground(patch.model ?? form.model)) throw new Error(t({ ko: '선택한 모델은 투명 배경을 지원하지 않아.', en: 'The selected model does not support transparent backgrounds.' }))
      setForm((current) => applyNaiFormPatch(current, patch))
    },
  })
}

const PRIVATE_FIELD = /password|secret|credential|api[ _-]?key|token|bearer|비밀번호|암호|인증키|토큰/i

/** Use exactly the currently selected workflow's resolved fields and ordinary input handler. */
export function useComfyChatPage(workflow: { id: number; name: string } | null | undefined, marked: WorkflowMarkedField[], draft: Record<string, WorkflowFieldDraftValue>, ownerId: number | null, onChange: (id: string, value: WorkflowFieldDraftValue) => void) {
  const { t } = useI18n()
  const fields: ChatPageField[] = []
  if (workflow?.id === ownerId) {
    for (const field of marked) {
      if (fields.length >= CHAT_PAGE_LIMITS.fields) break
      if (field.type === 'image' || field.type === 'node' || PRIVATE_FIELD.test(`${field.id} ${field.label} ${field.jsonPath} ${field.description ?? ''}`)) continue
      const value = draft[field.id] ?? ''
      if (typeof value !== 'string' && !(Array.isArray(value) && value.every((part) => typeof part === 'string'))) continue
      if (field.type === 'select' && (!field.options?.length || field.options.length > CHAT_PAGE_LIMITS.options)) continue
      fields.push({ id: field.id, label: field.label, type: field.type === 'number' || field.type === 'select' ? field.type : 'text', value,
        ...(field.type === 'number' ? { min: field.min, max: field.max, integer: Number.isInteger(field.step) && (field.step ?? 0) >= 1, allowEmpty: !field.required } : {}),
        ...(field.type === 'select' ? { options: field.options } : {}),
      })
    }
  }
  useChatPageRegistration(workflow ? {
    kind: 'comfyui', title: t({ ko: 'ComfyUI · {name}', en: 'ComfyUI · {name}' }, { name: workflow.name }).slice(0, 160), resourceId: String(workflow.id), fields,
    apply: (patch) => { for (const [id, value] of Object.entries(patch)) onChange(id, value as WorkflowFieldDraftValue) },
  } : null)
}
