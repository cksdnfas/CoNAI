import type { Dispatch, SetStateAction } from 'react'
import { getNaiFixedModelSettings, getNaiQualityTags, getNaiUcPresetIds, getNaiUcPresetText, NAI_ENHANCE_AMOUNTS, type ChatPageField } from '@conai/shared'
import { useI18n } from '@/i18n'
import { useChatPageRegistration } from '@/features/codex-chat/chat-page-context'
import {
  clampNaiQueueCount,
  clampNaiSampleCount,
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
import { appendNaiCharacterPrompt, applyNaiFormPatch, placeNaiCharacterReference, updateNaiVibeField } from './use-nai-form-controller'
import { buildNaiFormFromHistoryPayload } from '../history-settings-mapping'
import { useChatCharacterSettingInsertion } from './use-chat-character-setting-insertion'
import { useChatPageMedia } from '@/features/codex-chat/use-chat-page-media'
import { useChatDraftTransaction } from '@/features/codex-chat/use-chat-draft-transaction'
import { pageAction, pageArray, pageChoice, pageFreeText, pageNumber, pageObject, pageText } from '@/features/codex-chat/page-action-helpers'
import { useChatPresetInsertion } from './use-chat-preset-insertion'
import { useGenerationChatRuns, type GenerationSubmitResult } from './use-generation-chat-runs'
import { IMAGE_GENERATION_TARGET_GROUP_KEY, useGenerationTargetGroupPath } from '@/features/groups/generation-target-group-store'
import type { GenerationHistoryRecord } from '@/lib/api-image-generation-types'
import { EMPTY_NAI_CHARACTER_REFERENCE, EMPTY_NAI_VIBE, supportsNaiCharacterPrompts, supportsNaiCharacterReferences } from '../image-generation-shared'

/** Inputs a model with fixed settings (V5 Full Medium) decides itself; the page assistant may read but not change them. */
const NAI_FIXED_MODEL_FIELDS = ['steps', 'sampler', 'negativePrompt', 'ucPreset'] as const

export function useNaiChatPage(form: NAIFormDraft, setForm: Dispatch<SetStateAction<NAIFormDraft>>, sourceImageSize: NaiImageSize | null, records: GenerationHistoryRecord[], generate: () => Promise<GenerationSubmitResult>, cost: { estimate: number | null; free: boolean | null; extraUpscale: boolean; width: number; height: number }) {
  const { t } = useI18n()
  const runs = useGenerationChatRuns('nai.generate', 'novelai', records, generate)
  const { requestPath: targetGroup } = useGenerationTargetGroupPath(IMAGE_GENERATION_TARGET_GROUP_KEY)
  const media = useChatPageMedia(['sourceImage', 'maskImage', ...(supportsNaiVibes(form.model) ? ['vibe:new', ...form.vibes.map((_, i) => `vibe:${i}`)] : []), ...(supportsNaiCharacterReferences(form.model) ? ['characterReference:new', ...form.characterReferences.map((_, i) => `characterReference:${i}`)] : [])])
  // Fields show what the request uses: a model with fixed settings overrides steps, sampler and the negatives.
  const fixedSettings = getNaiFixedModelSettings(form.model)
  const fixedField = fixedSettings ? { editable: false as const, hint: NAI_FIXED_MODEL_FIELD_HINT } : {}
  const presets = useChatPresetInsertion(fixedSettings ? ['prompt'] : ['prompt', 'negativePrompt'])
  const characterSettings = useChatCharacterSettingInsertion()
  const characterPrompts = supportsNaiCharacterPrompts(form.model)
  const characterReferences = characterSettings.canReference && supportsNaiCharacterReferences(form.model)
  const characterSettingActions = characterSettings.actions({
    target: pageChoice(['prompt', ...(characterPrompts ? [...(form.characters.length ? ['character'] : []), 'newCharacter'] : [])]),
    ...(characterPrompts && form.characters.length ? { characterIndex: pageNumber(0, form.characters.length - 1, true) } : {}),
    ...(characterReferences ? {
      includeReference: { type: 'boolean' as const },
      ...(form.characterReferences.length ? { referenceIndex: pageNumber(0, form.characterReferences.length - 1, true) } : {}),
    } : {}),
  }, ['target'], 'target prompt = main prompt; character = data.characters[characterIndex] (0-based); newCharacter = add a character with the tags. includeReference (default: when the setting has one) also sets its reference image as a character reference: omit referenceIndex to add a new reference row, or give referenceIndex (0-based) to replace that row\'s image (then the setting must have a reference). NAI does not tie references to characters (several character references blend), so the row never follows characterIndex.')
  const commit = useChatDraftTransaction(form, setForm)
  const promptPresets = resolveNaiPromptPresets(form)
  const sampling = resolveNaiSamplingSettings(form)
  const needsEncoding = form.vibes.map((vibe) => Boolean(vibe.image && !vibe.encoded.trim()))
  const chargeVibes = form.model.includes('nai-diffusion-4')
  const vibeCount = form.vibes.filter((vibe) => vibe.image || vibe.encoded.trim()).length
  const encodingAnlas = chargeVibes ? needsEncoding.filter(Boolean).length * 2 : 0
  const extraVibeAnlas = chargeVibes ? Math.max(0, vibeCount - 4) * 2 * clampNaiQueueCount(form.queueCount) : 0
  const referenceAnlas = supportsNaiCharacterReferences(form.model) ? form.characterReferences.filter((reference) => reference.image).length * 5 * clampNaiSampleCount(form.samples) * clampNaiQueueCount(form.queueCount) : 0
  const extraAnlas = encodingAnlas + extraVibeAnlas + referenceAnlas
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
    { id: 'steps', label: t({ ko: '스텝', en: 'Steps' }), type: 'number', value: sampling.steps, min: 1, max: 100, integer: true, ...fixedField },
    { id: 'scale', label: 'CFG Scale', type: 'number', value: form.scale, min: 1, max: 20 },
    { id: 'seed', label: t({ ko: '시드', en: 'Seed' }), type: 'number', value: form.seed, min: 0, max: 4294967288, integer: true, allowEmpty: true },
    { id: 'action', label: t({ ko: '생성 방식', en: 'Generation mode' }), type: 'select', value: form.action, options: ['generate', 'img2img', 'infill'] },
    { id: 'strength', label: t({ ko: '이미지 변형 강도', en: 'Image strength' }), type: 'number', value: form.strength, min: 0, max: 1 },
    { id: 'noise', label: t({ ko: '노이즈', en: 'Noise' }), type: 'number', value: form.noise, min: 0, max: 1 },
    { id: 'samples', label: t({ ko: '요청당 이미지', en: 'Images per request' }), type: 'number', value: form.samples, min: 1, max: 4, integer: true },
    { id: 'varietyPlus', label: 'Variety+', type: 'boolean', value: form.varietyPlus },
    { id: 'addOriginalImage', label: t({ ko: '원본 이미지 추가', en: 'Add original image' }), type: 'boolean', value: form.addOriginalImage },
    { id: 'characterPositionAiChoice', label: t({ ko: '캐릭터 위치 자동', en: 'Automatic character positions' }), type: 'boolean', value: form.characterPositionAiChoice },
  ]
  if (supportsNaiTransparentBackground(form.model)) fields.push({ id: 'transparentBackground', label: t({ ko: '투명 배경', en: 'Transparent background' }), type: 'boolean', value: form.transparentBackground })
  useChatPageRegistration({
    kind: 'nai', title: t({ ko: 'NovelAI 생성', en: 'NovelAI generation' }), resourceId: 'novelai', fields, localRevision: getImageDraftRevision(form),
    data: { recentRuns: runs.recentRuns, generating: runs.generating, media: media.candidates, presets: presets.candidates, characters: form.characters.map((item) => ({ ...item })), enhance: { sourceSize: sourceImageSize ? `${sourceImageSize.width}x${sourceImageSize.height}` : '', amounts: Object.fromEntries(NAI_ENHANCE_AMOUNTS.map((amount) => [amount, planNaiFormEnhance(form, sourceImageSize, amount).issue ?? 'available'])) }, selected: { targetGroup: targetGroup ?? '', prompt: pageFreeText(form.prompt.slice(0, 240)), model: form.model, size: `${cost.width}x${cost.height}`, samples: clampNaiSampleCount(form.samples), queueCount: clampNaiQueueCount(form.queueCount), anlasEstimate: cost.estimate === null ? null : cost.estimate + extraAnlas, free: extraAnlas > 0 ? false : cost.free, vibeEncodingAnlas: encodingAnlas, extraVibeAnlas, referenceAnlas, extraUpscaleCost: cost.extraUpscale, sourceImage: form.sourceImage?.fileName ?? '', maskImage: form.maskImage?.fileName ?? '', vibes: form.vibes.map((item, index) => ({ image: item.image?.fileName ?? '', strength: item.strength, informationExtracted: item.informationExtracted, needsEncoding: needsEncoding[index] })), characterReferences: form.characterReferences.map((item) => ({ image: item.image?.fileName ?? '', type: item.type, strength: item.strength, fidelity: item.fidelity })) } },
    actions: [...runs.actions, ...media.actions, ...presets.actions, ...characterSettingActions, ...(form.vibes.length || form.characterReferences.length ? [pageAction('nai.references', t({ ko: '참조 설정 변경', en: 'Edit reference settings' }), t({ ko: '바이브 또는 캐릭터 참조의 0부터 시작하는 index와 변경할 설정을 지정해.', en: 'Set a vibe or character reference by its zero-based index.' }), pageObject({ kind: pageChoice(['vibe', 'characterReference']), index: pageNumber(0, Math.max(form.vibes.length, form.characterReferences.length) - 1, true), strength: pageNumber(0, 1), informationExtracted: pageNumber(0.01, 1), fidelity: pageNumber(0, 1), type: pageChoice(['character', 'style', 'character&style']) }, ['kind', 'index']))] : []), ...(supportsNaiCharacterPrompts(form.model) ? [pageAction('nai.characters', t({ ko: '캐릭터 프롬프트 편집', en: 'Edit character prompts' }), t({ ko: '캐릭터별 프롬프트·네거티브 프롬프트·위치의 전체 목록을 입력해.', en: 'Set the complete list of character prompts, negative prompts and positions.' }), pageObject({ characters: pageArray(pageObject({ prompt: pageText(), uc: pageText(), centerX: pageChoice(['0.1', '0.3', '0.5', '0.7', '0.9']), centerY: pageChoice(['0.1', '0.3', '0.5', '0.7', '0.9']) }, ['prompt', 'uc', 'centerX', 'centerY']), 6) }, ['characters']))] : [])],
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
      if (id === 'generation.history_load') {
        const payload = await runs.loadHistory(args, assertCurrent)
        return commit(buildNaiFormFromHistoryPayload(payload, form).form)
      }
      if (await runs.apply(id, args, assertCurrent)) return
      const next = { ...form, vibes: [...form.vibes], characterReferences: [...form.characterReferences] }
      if (id === 'preset.insert') next[String(args.fieldId) as 'prompt' | 'negativePrompt'] = presets.value(args, form[String(args.fieldId) as 'prompt' | 'negativePrompt'])
      else if (id === 'nai.references') {
        const index = Number(args.index)
        if (args.kind === 'vibe') {
          const vibe = next.vibes[index]
          if (!vibe || args.type !== undefined || args.fidelity !== undefined || (args.strength !== undefined && Number(args.strength) < 0.01)) throw new Error('바이브 참조 설정을 확인해줘.')
          let updated = vibe
          if (args.strength !== undefined) updated = updateNaiVibeField(updated, 'strength', String(args.strength))
          if (args.informationExtracted !== undefined) updated = updateNaiVibeField(updated, 'informationExtracted', String(args.informationExtracted))
          next.vibes[index] = updated
        } else {
          const reference = next.characterReferences[index]
          if (!reference || args.informationExtracted !== undefined) throw new Error('캐릭터 참조 설정을 확인해줘.')
          next.characterReferences[index] = { ...reference, strength: args.strength === undefined ? reference.strength : String(args.strength), fidelity: args.fidelity === undefined ? reference.fidelity : String(args.fidelity), type: args.type === undefined ? reference.type : args.type as typeof reference.type }
        }
      }
      else if (id === 'character_setting.insert') {
        const target = String(args.target)
        const characterIndex = target === 'character' ? Number(args.characterIndex) : null
        if (target !== 'prompt' && !characterPrompts) throw new Error(t({ ko: '선택한 모델은 캐릭터 프롬프트를 지원하지 않아.', en: 'The selected model does not support character prompts.' }))
        if (target === 'character' && (args.characterIndex === undefined || !form.characters[characterIndex ?? -1])) throw new Error(t({ ko: '캐릭터 번호(characterIndex)를 확인해줘.', en: 'Check characterIndex.' }))
        const referenceIndex = args.referenceIndex === undefined ? null : Number(args.referenceIndex)
        if (referenceIndex !== null && (args.includeReference === false || !form.characterReferences[referenceIndex])) throw new Error(t({ ko: '참조 번호(referenceIndex)를 확인해줘.', en: 'Check referenceIndex.' }))
        const loaded = await characterSettings.load(args, characterSettings.referenceMode(referenceIndex !== null ? true : args.includeReference, characterReferences))
        assertCurrent()
        if (target === 'prompt') next.prompt = characterSettings.text(args, form.prompt, loaded.appearance)
        else if (target === 'newCharacter') next.characters = appendNaiCharacterPrompt(form.characters, characterSettings.text(args, '', loaded.appearance))
        else next.characters = form.characters.map((character, index) => (index === characterIndex ? { ...character, prompt: characterSettings.text(args, character.prompt, loaded.appearance) } : character))
        if (loaded.reference) next.characterReferences = placeNaiCharacterReference(next.characterReferences, referenceIndex, loaded.reference)
      }
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
