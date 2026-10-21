import type { Dispatch, SetStateAction } from 'react'
import { getNaiFixedModelSettings, getNaiQualityTags, getNaiUcPresetIds, getNaiUcPresetText, NAI_ENHANCE_AMOUNTS, type ChatPageField } from '@conai/shared'
import { useI18n } from '@/i18n'
import { useChatPageRegistration } from '@/features/codex-chat/chat-page-context'
import {
  getImageDraftRevision,
  getNaiEnhanceIssueLabel,
  getNaiFixedFieldsError,
  NAI_ENHANCE_SETTINGS,
  NAI_FIXED_MODEL_FIELD_HINT,
  NAI_MODEL_OPTIONS,
  NAI_QUEUE_COUNT_MAX,
  NAI_QUEUE_COUNT_MIN,
  NAI_SAMPLER_OPTIONS,
  NAI_SCHEDULER_OPTIONS,
  planNaiFormEnhance,
  resolveNaiPromptPresets,
  resolveNaiSamplingSettings,
  supportsNaiTransparentBackground,
  supportsNaiVibes,
  type NAIFormDraft,
  type NaiImageSize,
} from '../image-generation-shared'
import { applyNaiFormPatch } from './use-nai-form-controller'
import { useChatPageMedia } from '@/features/codex-chat/use-chat-page-media'
import { useChatDraftTransaction } from '@/features/codex-chat/use-chat-draft-transaction'
import { pageAction, pageArray, pageChoice, pageObject, pageText } from '@/features/codex-chat/page-action-helpers'
import { useChatPresetInsertion } from './use-chat-preset-insertion'
import { EMPTY_NAI_CHARACTER_REFERENCE, EMPTY_NAI_VIBE, supportsNaiCharacterPrompts, supportsNaiCharacterReferences } from '../image-generation-shared'

/** Inputs a model with fixed settings (V5 Full Medium) decides itself; the page assistant may read but not change them. */
const NAI_FIXED_MODEL_FIELDS = ['steps', 'sampler', 'negativePrompt', 'ucPreset'] as const

export function useNaiChatPage(form: NAIFormDraft, setForm: Dispatch<SetStateAction<NAIFormDraft>>, sourceImageSize: NaiImageSize | null) {
  const { t } = useI18n()
  const media = useChatPageMedia(['sourceImage', 'maskImage', ...(supportsNaiVibes(form.model) ? ['vibe:new', ...form.vibes.map((_, i) => `vibe:${i}`)] : []), ...(supportsNaiCharacterReferences(form.model) ? ['characterReference:new', ...form.characterReferences.map((_, i) => `characterReference:${i}`)] : [])])
  // Fields show what the request uses: a model with fixed settings overrides steps, sampler and the negatives.
  const fixedSettings = getNaiFixedModelSettings(form.model)
  const fixedField = fixedSettings ? { editable: false as const, hint: NAI_FIXED_MODEL_FIELD_HINT } : {}
  const presets = useChatPresetInsertion(fixedSettings ? ['prompt'] : ['prompt', 'negativePrompt'])
  const commit = useChatDraftTransaction(form, setForm)
  const promptPresets = resolveNaiPromptPresets(form)
  const sampling = resolveNaiSamplingSettings(form)
  const fields: ChatPageField[] = [
    { id: 'prompt', label: t({ ko: '포지티브 프롬프트', en: 'Positive prompt' }), type: 'text', value: form.prompt },
    { id: 'negativePrompt', label: t({ ko: '네거티브 프롬프트', en: 'Negative prompt' }), type: 'text', value: fixedSettings ? getNaiUcPresetText(form.model, fixedSettings.ucPreset) ?? '' : form.negativePrompt, ...fixedField },
    { id: 'qualityToggle', label: t({ ko: '품질 태그', en: 'Quality tags' }), type: 'boolean', value: promptPresets.qualityToggle, hint: 'Appends the model quality tags to the prompt on the server. Not available for models without presets (NAI Diffusion 3).' },
    { id: 'ucPreset', label: t({ ko: 'UC 프리셋', en: 'UC preset' }), type: 'select', value: promptPresets.ucPreset, options: getNaiUcPresetIds(form.model), hint: 'Undesired Content preset placed before the negative prompt on the server; options depend on the model.', ...fixedField },
    { id: 'queueCount', label: t({ ko: '반복', en: 'Repeat' }), type: 'number', value: form.queueCount, min: NAI_QUEUE_COUNT_MIN, max: NAI_QUEUE_COUNT_MAX, integer: true, hint: 'Queue jobs per Generate click. Above 1 needs a random seed or random prompt syntax.' },
    { id: 'enhance', label: t({ ko: '인핸스', en: 'Enhance' }), type: 'select', value: form.enhance, options: [...NAI_ENHANCE_SETTINGS], hint: 'img2img with a source image only; size follows the source. See data.enhance for the amounts available now. Turning it on resets strength/noise to 0.5/0.' },
    { id: 'model', label: t({ ko: '모델', en: 'Model' }), type: 'select', value: form.model, options: NAI_MODEL_OPTIONS.map((item) => item.value) },
    { id: 'sampler', label: t({ ko: '샘플러', en: 'Sampler' }), type: 'select', value: sampling.sampler, options: NAI_SAMPLER_OPTIONS.map((item) => item.value), ...fixedField },
    { id: 'scheduler', label: t({ ko: '스케줄러', en: 'Scheduler' }), type: 'select', value: form.scheduler, options: NAI_SCHEDULER_OPTIONS.map((item) => item.value) },
    { id: 'width', label: t({ ko: '너비', en: 'Width' }), type: 'number', value: form.width, min: 64, integer: true, multipleOf: 64 },
    { id: 'height', label: t({ ko: '높이', en: 'Height' }), type: 'number', value: form.height, min: 64, integer: true, multipleOf: 64 },
    { id: 'steps', label: 'Steps', type: 'number', value: sampling.steps, min: 1, max: 100, integer: true, ...fixedField },
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
    kind: 'nai', title: t({ ko: 'NovelAI 생성', en: 'NovelAI generation' }), resourceId: 'novelai', fields, localRevision: getImageDraftRevision(form),
    data: { media: media.candidates, presets: presets.candidates, characters: form.characters.map((item) => ({ ...item })), enhance: { sourceSize: sourceImageSize ? `${sourceImageSize.width}x${sourceImageSize.height}` : '', amounts: Object.fromEntries(NAI_ENHANCE_AMOUNTS.map((amount) => [amount, planNaiFormEnhance(form, sourceImageSize, amount).issue ?? 'available'])) }, selected: { sourceImage: form.sourceImage?.fileName ?? '', maskImage: form.maskImage?.fileName ?? '', vibes: form.vibes.map((item) => ({ image: item.image?.fileName ?? '', strength: item.strength, informationExtracted: item.informationExtracted })), characterReferences: form.characterReferences.map((item) => ({ image: item.image?.fileName ?? '', type: item.type, strength: item.strength, fidelity: item.fidelity })) } },
    actions: [...media.actions, ...presets.actions, ...(supportsNaiCharacterPrompts(form.model) ? [pageAction('nai.characters', t({ ko: '캐릭터 프롬프트 편집', en: 'Edit character prompts' }), t({ ko: '캐릭터별 프롬프트·네거티브 프롬프트·위치의 전체 목록을 입력해.', en: 'Set the complete list of character prompts, negative prompts and positions.' }), pageObject({ characters: pageArray(pageObject({ prompt: pageText(), uc: pageText(), centerX: pageChoice(['0.1', '0.3', '0.5', '0.7', '0.9']), centerY: pageChoice(['0.1', '0.3', '0.5', '0.7', '0.9']) }, ['prompt', 'uc', 'centerX', 'centerY']), 6) }, ['characters']))] : [])],
    apply: (values) => {
      const patch = values as Partial<NAIFormDraft>
      const model = patch.model ?? form.model
      if (patch.transparentBackground === true && !supportsNaiTransparentBackground(model)) throw new Error(t({ ko: '선택한 모델은 투명 배경을 지원하지 않아.', en: 'The selected model does not support transparent backgrounds.' }))
      if (patch.qualityToggle === true && getNaiQualityTags(model) === null) throw new Error(t({ ko: '선택한 모델은 품질 태그가 없어.', en: 'The selected model has no quality tags.' }))
      const targetFixedSettings = getNaiFixedModelSettings(model)
      const lockedFields = targetFixedSettings ? NAI_FIXED_MODEL_FIELDS.filter((key) => patch[key] !== undefined) : []
      if (targetFixedSettings && lockedFields.length > 0) throw new Error(getNaiFixedFieldsError(t, lockedFields, targetFixedSettings))
      if (patch.ucPreset !== undefined && !getNaiUcPresetIds(model).includes(patch.ucPreset)) throw new Error(t({ ko: '선택한 모델에 없는 UC 프리셋이야.', en: 'The selected model does not offer that UC preset.' }))
      if (patch.enhance !== undefined && patch.enhance !== 'off') {
        const { issue } = planNaiFormEnhance({ ...form, ...patch }, sourceImageSize, patch.enhance)
        if (issue) throw new Error(t({ ko: 'Enhance를 쓸 수 없어: {reason}', en: 'Enhance is unavailable: {reason}' }, { reason: getNaiEnhanceIssueLabel(t, issue) }))
      }
      setForm((current) => applyNaiFormPatch(current, patch))
    },
    applyAction: async (id, args, assertCurrent) => {
      const next = { ...form, vibes: [...form.vibes], characterReferences: [...form.characterReferences] }
      if (id === 'preset.insert') next[String(args.fieldId) as 'prompt' | 'negativePrompt'] = presets.value(args, form[String(args.fieldId) as 'prompt' | 'negativePrompt'])
      else if (id === 'nai.characters') {
        const characters = args.characters as unknown as NAIFormDraft['characters']
        // The model drops character negatives; a stored value sent back unchanged (also after reordering) is kept for switching models back.
        const storedUcs = new Set(form.characters.map((character) => character.uc))
        if (fixedSettings && characters.some((character) => character.uc.trim() && !storedUcs.has(character.uc))) {
          throw new Error(t({
            ko: '선택한 모델은 캐릭터 네거티브 프롬프트(uc)를 쓰지 않고 버려. uc는 비우거나 지금 값 그대로 보내고, 빼고 싶은 요소는 프롬프트에 -2::hat:: 처럼 음수 가중치로 넣어줘.',
            en: 'The selected model drops character negative prompts (uc). Send uc empty or unchanged, and put unwanted elements in the prompt as negative weights like -2::hat::.',
          }))
        }
        next.characters = characters
      }
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
