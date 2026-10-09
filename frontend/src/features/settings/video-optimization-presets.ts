import type { TranslationDictionary } from '@/i18n'
import type { VideoOptimizationSettings } from '@conai/shared'

/** Each preset also sets CRF and audio bitrate; a draft whose two values match none reads as custom. */
export const VIDEO_OPTIMIZATION_PRESETS: Array<{ value: VideoOptimizationSettings['preset']; label: TranslationDictionary; crf: number; audioBitrateKbps: number }> = [
  { value: 'high-quality', label: { ko: '고화질', en: 'High quality' }, crf: 22, audioBitrateKbps: 192 },
  { value: 'balanced', label: { ko: '균형', en: 'Balanced' }, crf: 26, audioBitrateKbps: 128 },
  { value: 'economy', label: { ko: '절약', en: 'Economy' }, crf: 30, audioBitrateKbps: 96 },
]
