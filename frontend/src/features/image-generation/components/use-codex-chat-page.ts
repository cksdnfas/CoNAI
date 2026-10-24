import type { Dispatch, SetStateAction } from 'react'
import { useChatPageRegistration } from '@/features/codex-chat/chat-page-context'
import { useChatPageMedia } from '@/features/codex-chat/use-chat-page-media'
import { useChatDraftTransaction } from '@/features/codex-chat/use-chat-draft-transaction'
import { useChatPresetInsertion } from './use-chat-preset-insertion'
import { useI18n } from '@/i18n'
import type { CodexFormDraft } from './codex-generation-panel'
import { getImageDraftRevision } from '../image-generation-shared'
import { CODEX_REFERENCE_ROLES, applyCodexDraftPatch, canEnableCodexStrict, codexReferenceCapacity } from '../codex-reference-draft'
import type { ChatPageField } from '@conai/shared'

export function useCodexChatPage(form: CodexFormDraft, setForm: Dispatch<SetStateAction<CodexFormDraft>>, models: Array<{ id: string }>) {
  const { t } = useI18n()
  const capacity = codexReferenceCapacity(form)
  const media = useChatPageMedia(['referenceImage', 'maskImage', ...(form.references.length < capacity ? ['reference:new'] : []), ...form.references.map((_, index) => `reference:${index}`)])
  const presets = useChatPresetInsertion(['prompt', 'negativePrompt'])
  const commit = useChatDraftTransaction(form, setForm)
  useChatPageRegistration({
    kind: 'codex', title: t({ ko: 'Codex 이미지 생성', en: 'Codex image generation' }), resourceId: 'codex', localRevision: getImageDraftRevision(form),
    fields: [
      { id: 'prompt', label: t({ ko: '포지티브 프롬프트', en: 'Positive prompt' }), type: 'text', value: form.prompt },
      { id: 'negativePrompt', label: t({ ko: '네거티브 프롬프트', en: 'Negative prompt' }), type: 'text', value: form.negativePrompt },
      { id: 'model', label: t({ ko: '모델 (빈 값은 기본 모델)', en: 'Model (empty means default)' }), type: 'select', value: form.model, options: [...new Set(['', form.model, ...models.map((item) => item.id)])].slice(0, 100) },
      { id: 'count', label: t({ ko: '생성 개수', en: 'Image count' }), type: 'number', value: form.count, min: 1, max: 4, integer: true },
      { id: 'aspectRatio', label: t({ ko: '화면 비율', en: 'Aspect ratio' }), type: 'select', value: form.aspectRatio, options: ['random', '1:1', '4:3', '3:4', '16:9', '9:16'], ...(form.strictPreservation ? { editable: false as const } : {}) },
      { id: 'resolution', label: t({ ko: '해상도', en: 'Resolution' }), type: 'select', value: form.resolution, options: ['1024', '1536', '2048'], ...(form.strictPreservation ? { editable: false as const } : {}) },
      { id: 'imageMode', label: t({ ko: '이미지 모드', en: 'Image mode' }), type: 'select', value: form.imageMode, options: ['reference', 'edit'] },
      { id: 'strictPreservation', label: 'Strict masked preservation (source and mask required)', type: 'boolean', value: form.strictPreservation, ...(!canEnableCodexStrict(form) && !form.strictPreservation ? { editable: false as const } : {}) },
      { id: 'referenceCount', label: 'Reference slots (reattach empty slots)', type: 'number', value: form.references.length, min: 0, max: capacity, integer: true },
      ...form.references.flatMap((reference, index): ChatPageField[] => [
        { id: `reference${index}Role`, label: `Reference ${index + 1} role`, type: 'select', value: reference.role, options: [...CODEX_REFERENCE_ROLES] },
        { id: `reference${index}Label`, label: `Reference ${index + 1} label (max 128)`, type: 'text', value: reference.label },
        { id: `reference${index}Order`, label: `Reference ${index + 1} position`, type: 'number', value: index + 1, min: 1, max: form.references.length, integer: true },
      ]),
    ],
    actions: [...media.actions, ...presets.actions], data: { media: media.candidates, presets: presets.candidates, limits: '5 attachments including source/mask; 10 MiB each, 32 MiB total, 4096px per side. Size is requested, not guaranteed.', selected: { referenceImage: form.referenceImage?.fileName ?? '', maskImage: form.maskImage?.fileName ?? '', references: form.references.map((reference) => ({ role: reference.role, label: reference.label, fileName: reference.image?.fileName ?? '' })) } },
    apply: (patch) => { const next = applyCodexDraftPatch(form, patch); setForm(next) },
    applyAction: async (id, args, assertCurrent) => {
      const next = { ...form, references: form.references.map((reference) => ({ ...reference })) }
      const target = String(args.fieldId)
      if (id === 'preset.insert') next[target as 'prompt' | 'negativePrompt'] = presets.value(args, form[target as 'prompt' | 'negativePrompt'])
      else if (id === 'media.clear' || id === 'media.attach') {
        const image = id === 'media.attach' ? await (await media.load(args)).toImage() : undefined
        assertCurrent()
        if (target === 'referenceImage') { next.referenceImage = image; next.maskImage = undefined }
        else if (target === 'maskImage') {
          if (image && (!next.referenceImage || next.imageMode !== 'edit')) throw new Error('A mask requires an edit source')
          next.maskImage = image
        } else if (target === 'reference:new') {
          if (!image || next.references.length >= codexReferenceCapacity(next)) throw new Error('Cannot add reference: attachment limit')
          next.references.push({ role: 'reference', label: '', image })
        } else {
          const index = Number(target.split(':')[1])
          if (!next.references[index]) throw new Error('Reference slot not found')
          next.references[index].image = image
        }
      }
      else throw new Error('등록되지 않은 Codex 입력 작업이야.')
      if (next.references.length > codexReferenceCapacity(next)) throw new Error('Remove a reference before adding another source or mask')
      assertCurrent()
      return commit(next)
    },
  })
}
