import type { Dispatch, SetStateAction } from 'react'
import type { ChatPageField, ChatPageValue } from '@conai/shared'
import { useChatPageRegistration } from '@/features/codex-chat/chat-page-context'
import { useI18n } from '@/i18n'
import type { SpriteExtractResult, SpriteVideoInfo } from '@/lib/api-sprite'
import { MAX_SPRITE_FRAMES, normalizeHex, toExtractOptions, withDespill, type ExtractForm, type OutputForm } from './sprite-options'

/**
 * The sprite tab shares its video, the extraction form and the last build with a connected chat. The bot can propose
 * form changes, and — because the page adds the sprite tools — run the extraction itself with these values.
 */
export function useSpriteChatPage({ videoHash, info, form, setForm, output, build }: {
  videoHash: string | null
  info: SpriteVideoInfo | null
  form: ExtractForm
  setForm: Dispatch<SetStateAction<ExtractForm>>
  output: OutputForm
  build: SpriteExtractResult | null
}) {
  const { t } = useI18n()
  const fields: ChatPageField[] = [
    { id: 'startTime', label: t({ ko: '시작 (초)', en: 'Start (s)' }), type: 'number', value: form.startTime, min: 0 },
    { id: 'endTime', label: t({ ko: '끝 (초, 비우면 끝까지)', en: 'End (s, empty = to the end)' }), type: 'number', value: form.endTime ?? '', min: 0, allowEmpty: true },
    { id: 'samplingMode', label: t({ ko: '추출 방식', en: 'Sampling' }), type: 'select', value: form.samplingMode, options: ['interval', 'count'] },
    { id: 'intervalValue', label: t({ ko: '간격', en: 'Interval' }), type: 'number', value: form.intervalValue, min: 0.001 },
    { id: 'intervalUnit', label: t({ ko: '간격 단위', en: 'Interval unit' }), type: 'select', value: form.intervalUnit, options: ['seconds', 'frames'] },
    { id: 'sampleCount', label: t({ ko: '개수', en: 'Count' }), type: 'number', value: form.sampleCount, min: 2, max: MAX_SPRITE_FRAMES, integer: true },
    { id: 'removeDuplicateFrames', label: t({ ko: '연속 중복 프레임 빼기', en: 'Drop repeated frames' }), type: 'boolean', value: form.removeDuplicateFrames },
    { id: 'similarityPercent', label: t({ ko: '중복 유사도 %', en: 'Duplicate similarity %' }), type: 'number', value: form.similarityPercent, min: 1, max: 100 },
    { id: 'keyColors', label: t({ ko: '배경 지정색 (#RRGGBB, 쉼표로 여러 개)', en: 'Key colours (#RRGGBB, comma separated)' }), type: 'text', value: form.keyColors.join(', ') },
    { id: 'tolerancePercent', label: t({ ko: '허용치 %', en: 'Tolerance %' }), type: 'number', value: form.tolerancePercent, min: 1, max: 100 },
    { id: 'softnessPercent', label: t({ ko: '부드러움 %', en: 'Softness %' }), type: 'number', value: form.softnessPercent, min: 0, max: 100 },
    { id: 'despill', label: t({ ko: '디스필', en: 'Despill' }), type: 'boolean', value: form.despill },
    { id: 'edgeCleanup', label: t({ ko: '가장자리 정리', en: 'Edge clean-up' }), type: 'boolean', value: form.edgeCleanup },
    { id: 'autoCrop', label: t({ ko: '자동 크롭', en: 'Auto crop' }), type: 'boolean', value: form.autoCrop },
    { id: 'alphaThreshold', label: t({ ko: '알파 임계값', en: 'Alpha threshold' }), type: 'number', value: form.alphaThreshold, min: 1, max: 255, integer: true },
    { id: 'resizeMode', label: t({ ko: '크기 조정', en: 'Resize' }), type: 'select', value: form.resizeMode, options: ['none', 'contain', 'cover', 'stretch'] },
    { id: 'outputWidth', label: t({ ko: '가로', en: 'Width' }), type: 'number', value: form.outputWidth, min: 1, max: 16384, integer: true },
    { id: 'outputHeight', label: t({ ko: '세로', en: 'Height' }), type: 'number', value: form.outputHeight, min: 1, max: 16384, integer: true },
  ]

  useChatPageRegistration({
    kind: 'sprite',
    title: t({ ko: '스프라이트', en: 'Sprites' }),
    resourceId: videoHash,
    fields,
    data: {
      videoHash: videoHash ?? '',
      video: info ? { name: info.name, width: info.width, height: info.height, fps: info.fps, frameCount: info.frameCount, duration: info.duration } : null,
      extractOptions: JSON.parse(JSON.stringify(toExtractOptions(form, info, output))),
      lastBuild: build ? { buildId: build.buildId, frameCount: build.frameCount, frameWidth: build.frameWidth, frameHeight: build.frameHeight, saved: build.saved?.compositeHash ?? '' } : null,
    },
    apply: (patch: Record<string, ChatPageValue>) => setForm((current) => applySpritePatch(current, patch)),
  })
}

function applySpritePatch(current: ExtractForm, patch: Record<string, ChatPageValue>): ExtractForm {
  let next = { ...current }
  if ('despill' in patch && Boolean(patch.despill) !== next.despill) next = withDespill(next, Boolean(patch.despill))
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'despill') continue
    if (key === 'keyColors') {
      const colors = String(value).split(',').map((color) => normalizeHex(color)).filter((color): color is string => Boolean(color))
      if (colors.length) next.keyColors = next.despill ? colors.slice(0, 1) : colors.slice(0, 8)
    } else if (key === 'endTime') {
      next.endTime = value === '' ? null : Number(value)
    } else if (key === 'samplingMode' || key === 'intervalUnit' || key === 'resizeMode') {
      next = { ...next, [key]: String(value) } as ExtractForm
    } else if (typeof value === 'boolean') {
      next = { ...next, [key]: value }
    } else if (key in next) {
      next = { ...next, [key]: Number(value) }
    }
  }
  return next
}
