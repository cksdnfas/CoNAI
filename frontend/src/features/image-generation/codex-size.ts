/** Codex output sizes: an aspect ratio scaled to a long edge, rounded to 64px (generation panel, chat generation presets). */
export const CODEX_ASPECT_RATIO_OPTIONS = [
  { value: 'random', label: 'Random' },
  { value: '1:1', label: '1:1', width: 1, height: 1 },
  { value: '4:3', label: '4:3', width: 4, height: 3 },
  { value: '3:4', label: '3:4', width: 3, height: 4 },
  { value: '16:9', label: '16:9', width: 16, height: 9 },
  { value: '9:16', label: '9:16', width: 9, height: 16 },
] as const

export const CODEX_RESOLUTION_OPTIONS = [
  { value: '1024', label: '1024px' },
  { value: '1536', label: '1536px' },
  { value: '2048', label: '2048px' },
] as const

export function roundCodexDimension(value: number) {
  return Math.max(64, Math.round(value / 64) * 64)
}

export function isSizedCodexAspectRatioOption(
  option: (typeof CODEX_ASPECT_RATIO_OPTIONS)[number],
): option is Extract<(typeof CODEX_ASPECT_RATIO_OPTIONS)[number], { width: number; height: number }> {
  return 'width' in option && 'height' in option
}

export function pickCodexAspectRatio(aspectRatio: string) {
  if (aspectRatio !== 'random') {
    return aspectRatio
  }

  const candidateOptions = CODEX_ASPECT_RATIO_OPTIONS.filter(isSizedCodexAspectRatioOption)
  if (candidateOptions.length === 0) {
    return '1:1'
  }

  const randomIndex = Math.floor(Math.random() * candidateOptions.length)
  return candidateOptions[randomIndex]?.value ?? '1:1'
}

export function resolveCodexSize(aspectRatio: string, resolution: string) {
  const aspect = CODEX_ASPECT_RATIO_OPTIONS
    .filter(isSizedCodexAspectRatioOption)
    .find((option) => option.value === aspectRatio)
  const longEdge = Number(resolution)
  if (!aspect || !Number.isFinite(longEdge) || longEdge <= 0) {
    return undefined
  }

  const scale = longEdge / Math.max(aspect.width, aspect.height)
  const width = roundCodexDimension(aspect.width * scale)
  const height = roundCodexDimension(aspect.height * scale)
  return `${width}x${height}`
}
