import type { Dispatch, SetStateAction } from 'react'
import { useChatPageRegistration } from '@/features/codex-chat/chat-page-context'
import { useChatPageMedia } from '@/features/codex-chat/use-chat-page-media'
import { useChatDraftTransaction } from '@/features/codex-chat/use-chat-draft-transaction'
import { useChatPresetInsertion } from './use-chat-preset-insertion'
import { useChatCharacterSettingInsertion } from './use-chat-character-setting-insertion'
import { pageChoice } from '@/features/codex-chat/page-action-helpers'
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
  const characterSettings = useChatCharacterSettingInsertion()
  // In edit mode the image slot is the source to edit, so a setting's reference goes in only as a reference.
  const characterReference = characterSettings.canReference && form.imageMode === 'reference'
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
      { id: 'strictPreservation', label: t({ ko: '엄격 마스크 보존 (원본과 마스크 필요)', en: 'Strict masked preservation (source and mask required)' }), type: 'boolean', value: form.strictPreservation, ...(!canEnableCodexStrict(form) && !form.strictPreservation ? { editable: false as const } : {}) },
      { id: 'referenceCount', label: t({ ko: '참조 칸 수 (빈 칸은 다시 첨부)', en: 'Reference slots (reattach empty slots)' }), type: 'number', value: form.references.length, min: 0, max: capacity, integer: true },
      ...form.references.flatMap((reference, index): ChatPageField[] => [
        { id: `reference${index}Role`, label: t({ ko: '참조 {index} 역할', en: 'Reference {index} role' }, { index: index + 1 }), type: 'select', value: reference.role, options: [...CODEX_REFERENCE_ROLES] },
        { id: `reference${index}Label`, label: t({ ko: '참조 {index} 설명 (최대 128자)', en: 'Reference {index} label (max 128)' }, { index: index + 1 }), type: 'text', value: reference.label },
        { id: `reference${index}Order`, label: t({ ko: '참조 {index} 순서', en: 'Reference {index} position' }, { index: index + 1 }), type: 'number', value: index + 1, min: 1, max: form.references.length, integer: true },
      ]),
    ],
    actions: [...media.actions, ...presets.actions, ...characterSettings.actions({
      target: pageChoice(['prompt']),
      ...(characterReference ? { includeReference: { type: 'boolean' as const } } : {}),
    }, ['target'], 'target prompt = the positive prompt. includeReference (default: when the setting has one) sets its reference image as referenceImage (reference image mode only).')], data: { media: media.candidates, presets: presets.candidates, limits: '5 attachments including source/mask; 10 MiB each, 32 MiB total, 4096px per side. Size is requested, not guaranteed.', selected: { referenceImage: form.referenceImage?.fileName ?? '', maskImage: form.maskImage?.fileName ?? '', references: form.references.map((reference) => ({ role: reference.role, label: reference.label, fileName: reference.image?.fileName ?? '' })) } },
    apply: (patch) => { const next = applyCodexDraftPatch(form, patch, t); setForm(next) },
    applyAction: async (id, args, assertCurrent) => {
      const next = { ...form, references: form.references.map((reference) => ({ ...reference })) }
      const target = String(args.fieldId)
      if (id === 'preset.insert') next[target as 'prompt' | 'negativePrompt'] = presets.value(args, form[target as 'prompt' | 'negativePrompt'])
      else if (id === 'character_setting.insert') {
        const loaded = await characterSettings.load(args, characterSettings.referenceMode(args.includeReference, characterReference))
        assertCurrent()
        next.prompt = characterSettings.text(args, form.prompt, loaded.appearance)
        if (loaded.reference) { next.referenceImage = loaded.reference; next.maskImage = undefined }
      }
      else if (id === 'media.clear' || id === 'media.attach') {
        const image = id === 'media.attach' ? await (await media.load(args)).toImage() : undefined
        assertCurrent()
        if (target === 'referenceImage') { next.referenceImage = image; next.maskImage = undefined }
        else if (target === 'maskImage') {
          if (image && (!next.referenceImage || next.imageMode !== 'edit')) throw new Error(t({ ko: '마스크를 쓰려면 편집 원본이 필요해.', en: 'A mask requires an edit source' }))
          next.maskImage = image
        } else if (target === 'reference:new') {
          if (!image || next.references.length >= codexReferenceCapacity(next)) throw new Error(t({ ko: '참조를 추가할 수 없어. 이미지와 첨부 개수 제한을 확인해줘.', en: 'Cannot add reference: check the image and attachment limit' }))
          next.references.push({ role: 'reference', label: '', image })
        } else {
          const index = Number(target.split(':')[1])
          if (!next.references[index]) throw new Error(t({ ko: '참조 칸을 찾지 못했어.', en: 'Reference slot not found' }))
          next.references[index].image = image
        }
      }
      else throw new Error(t({ ko: '등록되지 않은 Codex 입력 작업이야.', en: 'This Codex input action is not registered.' }))
      if (next.references.length > codexReferenceCapacity(next)) throw new Error(t({ ko: '원본이나 마스크를 추가하기 전에 참조를 하나 지워줘.', en: 'Remove a reference before adding another source or mask' }))
      assertCurrent()
      return commit(next)
    },
  })
}
