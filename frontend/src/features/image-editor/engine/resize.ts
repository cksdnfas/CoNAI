/** MDN's documented iOS canvas ceiling; shared by resize UI, assistant and engine. */
export const RESIZE_LIMITS = { dimension: 4096, pixels: 4096 * 4096 } as const

export function clampDocumentSize(width: number, height: number) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) return null
  const dimensionScale = Math.min(1, RESIZE_LIMITS.dimension / width, RESIZE_LIMITS.dimension / height)
  width = Math.max(1, Math.floor(width * dimensionScale))
  height = Math.max(1, Math.floor(height * dimensionScale))
  const areaScale = Math.min(1, Math.sqrt(RESIZE_LIMITS.pixels / (width * height)))
  return { width: Math.max(1, Math.floor(width * areaScale)), height: Math.max(1, Math.floor(height * areaScale)) }
}
