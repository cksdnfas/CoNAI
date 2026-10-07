import type { Dispatch, SetStateAction } from 'react'
import { type ChatPageField } from '@conai/shared'
import { useI18n } from '@/i18n'
import { useChatPageRegistration } from '@/features/codex-chat/chat-page-context'
import { NAI_MODEL_OPTIONS, NAI_SAMPLER_OPTIONS, NAI_SCHEDULER_OPTIONS, supportsNaiTransparentBackground, type NAIFormDraft } from '../image-generation-shared'
import { applyNaiFormPatch } from './use-nai-form-controller'
import { useChatPageMedia } from '@/features/codex-chat/use-chat-page-media'
import { useChatDraftTransaction } from '@/features/codex-chat/use-chat-draft-transaction'
import { pageAction, pageArray, pageChoice, pageObject, pageText } from '@/features/codex-chat/page-action-helpers'
import { useChatPresetInsertion } from './use-chat-preset-insertion'
import { EMPTY_NAI_CHARACTER_REFERENCE, EMPTY_NAI_VIBE, supportsNaiCharacterPrompts, supportsNaiCharacterReferences } from '../image-generation-shared'

export function useNaiChatPage(form: NAIFormDraft, setForm: Dispatch<SetStateAction<NAIFormDraft>>) {
  const { t } = useI18n()
  const media = useChatPageMedia(['sourceImage', 'maskImage', 'vibe:new', ...form.vibes.map((_, i) => `vibe:${i}`), ...(supportsNaiCharacterReferences(form.model) ? ['characterReference:new', ...form.characterReferences.map((_, i) => `characterReference:${i}`)] : [])])
  const presets = useChatPresetInsertion(['prompt', 'negativePrompt'])
  const commit = useChatDraftTransaction(form, setForm)
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
    { id: 'action', label: t({ ko: '생성 방식', en: 'Generation mode' }), type: 'select', value: form.action, options: ['generate', 'img2img', 'infill'] },
    { id: 'strength', label: t({ ko: '이미지 변형 강도', en: 'Image strength' }), type: 'number', value: form.strength, min: 0, max: 1 },
    { id: 'noise', label: t({ ko: '노이즈', en: 'Noise' }), type: 'number', value: form.noise, min: 0, max: 1 },
    { id: 'samples', label: t({ ko: '생성 개수', en: 'Sample count' }), type: 'number', value: form.samples, min: 1, max: 4, integer: true },
    { id: 'varietyPlus', label: 'Variety+', type: 'boolean', value: form.varietyPlus },
    { id: 'addOriginalImage', label: t({ ko: '원본 이미지 추가', en: 'Add original image' }), type: 'boolean', value: form.addOriginalImage },
    { id: 'characterPositionAiChoice', label: t({ ko: '캐릭터 위치 자동', en: 'Automatic character positions' }), type: 'boolean', value: form.characterPositionAiChoice },
  ]
  if (supportsNaiTransparentBackground(form.model)) fields.push({ id: 'transparentBackground', label: t({ ko: '투명 배경', en: 'Transparent background' }), type: 'boolean', value: form.transparentBackground })
  useChatPageRegistration({
    kind: 'nai', title: t({ ko: 'NovelAI 생성', en: 'NovelAI generation' }), resourceId: 'novelai', fields, localRevision: JSON.stringify(form),
    data: { media: media.candidates, presets: presets.candidates, characters: form.characters.map((item) => ({ ...item })), selected: { sourceImage: form.sourceImage?.fileName ?? '', maskImage: form.maskImage?.fileName ?? '', vibes: form.vibes.map((item) => ({ image: item.image?.fileName ?? '', strength: item.strength, informationExtracted: item.informationExtracted })), characterReferences: form.characterReferences.map((item) => ({ image: item.image?.fileName ?? '', type: item.type, strength: item.strength, fidelity: item.fidelity })) } },
    actions: [...media.actions, ...presets.actions, ...(supportsNaiCharacterPrompts(form.model) ? [pageAction('nai.characters', t({ ko: '캐릭터 프롬프트 편집', en: 'Edit character prompts' }), t({ ko: '캐릭터별 프롬프트·부정 프롬프트·위치의 전체 목록을 입력해.', en: 'Set the complete list of character prompts, negative prompts and positions.' }), pageObject({ characters: pageArray(pageObject({ prompt: pageText(), uc: pageText(), centerX: pageChoice(['0.1', '0.3', '0.5', '0.7', '0.9']), centerY: pageChoice(['0.1', '0.3', '0.5', '0.7', '0.9']) }, ['prompt', 'uc', 'centerX', 'centerY']), 6) }, ['characters']))] : [])],
    apply: (values) => {
      const patch = values as Partial<NAIFormDraft>
      if (patch.transparentBackground === true && !supportsNaiTransparentBackground(patch.model ?? form.model)) throw new Error(t({ ko: '선택한 모델은 투명 배경을 지원하지 않아.', en: 'The selected model does not support transparent backgrounds.' }))
      setForm((current) => applyNaiFormPatch(current, patch))
    },
    applyAction: async (id, args, assertCurrent) => {
      const next = { ...form, vibes: [...form.vibes], characterReferences: [...form.characterReferences] }
      if (id === 'preset.insert') next[String(args.fieldId) as 'prompt' | 'negativePrompt'] = presets.value(args, form[String(args.fieldId) as 'prompt' | 'negativePrompt'])
      else if (id === 'nai.characters') next.characters = args.characters as unknown as NAIFormDraft['characters']
      else if (id === 'media.attach' || id === 'media.clear') {
        const image = id === 'media.attach' ? await (await media.load(args)).toImage() : undefined
        assertCurrent()
        const target = String(args.fieldId)
        if (target === 'sourceImage' || target === 'maskImage') next[target] = image
        else {
          const [kind, index] = target.split(':')
          if (kind === 'vibe') { if (index === 'new') { if (!image) throw new Error('추가할 이미지가 필요해.'); next.vibes.push({ ...EMPTY_NAI_VIBE, image }) } else next.vibes[Number(index)] = { ...next.vibes[Number(index)], image, encoded: '' } }
          else if (kind === 'characterReference') { if (index === 'new') { if (!image) throw new Error('추가할 이미지가 필요해.'); next.characterReferences.push({ ...EMPTY_NAI_CHARACTER_REFERENCE, image }) } else next.characterReferences[Number(index)] = { ...next.characterReferences[Number(index)], image } }
        }
      } else throw new Error('등록되지 않은 NovelAI 작업이야.')
      assertCurrent()
      return commit(next)
    },
  })
}

export { useComfyChatPage } from './use-comfy-chat-page'
