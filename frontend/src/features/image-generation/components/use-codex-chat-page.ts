import type { Dispatch, SetStateAction } from 'react'
import { useChatPageRegistration } from '@/features/codex-chat/chat-page-context'
import { useChatPageMedia } from '@/features/codex-chat/use-chat-page-media'
import { useChatDraftTransaction } from '@/features/codex-chat/use-chat-draft-transaction'
import { useChatPresetInsertion } from './use-chat-preset-insertion'
import { useI18n } from '@/i18n'
import type { CodexFormDraft } from './codex-generation-panel'

export function useCodexChatPage(form: CodexFormDraft, setForm: Dispatch<SetStateAction<CodexFormDraft>>, models: Array<{ id: string }>) {
  const { t } = useI18n()
  const media = useChatPageMedia(['referenceImage', 'maskImage'])
  const presets = useChatPresetInsertion(['prompt', 'negativePrompt'])
  const commit = useChatDraftTransaction(form, setForm)
  useChatPageRegistration({
    kind: 'codex', title: t({ ko: 'Codex 이미지 생성', en: 'Codex image generation' }), resourceId: 'codex', localRevision: JSON.stringify(form),
    fields: [
      { id: 'prompt', label: t({ ko: '프롬프트', en: 'Prompt' }), type: 'text', value: form.prompt },
      { id: 'negativePrompt', label: t({ ko: '부정 프롬프트', en: 'Negative prompt' }), type: 'text', value: form.negativePrompt },
      { id: 'model', label: t({ ko: '모델 (빈 값은 기본 모델)', en: 'Model (empty means default)' }), type: 'select', value: form.model, options: [...new Set(['', form.model, ...models.map((item) => item.id)])].slice(0, 100) },
      { id: 'count', label: t({ ko: '생성 개수', en: 'Image count' }), type: 'number', value: form.count, min: 1, max: 4, integer: true },
      { id: 'aspectRatio', label: t({ ko: '화면 비율', en: 'Aspect ratio' }), type: 'select', value: form.aspectRatio, options: ['random', '1:1', '4:3', '3:4', '16:9', '9:16'] },
      { id: 'resolution', label: t({ ko: '해상도', en: 'Resolution' }), type: 'select', value: form.resolution, options: ['1024', '1536', '2048'] },
      { id: 'imageMode', label: t({ ko: '이미지 모드', en: 'Image mode' }), type: 'select', value: form.imageMode, options: ['reference', 'edit'] },
    ],
    actions: [...media.actions, ...presets.actions], data: { media: media.candidates, presets: presets.candidates, selected: { referenceImage: form.referenceImage?.fileName ?? '', maskImage: form.maskImage?.fileName ?? '' } },
    apply: (patch) => setForm((current) => ({ ...current, ...patch } as CodexFormDraft)),
    applyAction: async (id, args, assertCurrent) => {
      const next = { ...form }
      const target = String(args.fieldId)
      if (id === 'preset.insert') next[target as 'prompt' | 'negativePrompt'] = presets.value(args, form[target as 'prompt' | 'negativePrompt'])
      else if (id === 'media.clear') next[target as 'referenceImage' | 'maskImage'] = undefined
      else if (id === 'media.attach') { const loaded = await media.load(args); const image = await loaded.toImage(); assertCurrent(); next[target as 'referenceImage' | 'maskImage'] = image }
      else throw new Error('등록되지 않은 Codex 입력 작업이야.')
      assertCurrent()
      return commit(next)
    },
  })
}
