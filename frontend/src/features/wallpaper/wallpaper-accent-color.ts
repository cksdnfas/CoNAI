import { useEffect, useState } from 'react'

const accentCache = new Map<string, string | null>()

function toHex(r: number, g: number, b: number) {
  return `#${[r, g, b].map((value) => Math.round(Math.min(255, Math.max(0, value))).toString(16).padStart(2, '0')).join('')}`
}

function rgbToHsl(r: number, g: number, b: number) {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === rn ? (gn - bn) / d + (gn < bn ? 6 : 0) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4
  return { h: h / 6, s, l }
}

function hslToHex(h: number, s: number, l: number) {
  const hue = (p: number, q: number, t: number) => {
    const tt = t < 0 ? t + 1 : t > 1 ? t - 1 : t
    if (tt < 1 / 6) return p + (q - p) * 6 * tt
    if (tt < 1 / 2) return q
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
    return p
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return toHex(hue(p, q, h + 1 / 3) * 255, hue(p, q, h) * 255, hue(p, q, h - 1 / 3) * 255)
}

/**
 * The most vivid hue of an image as a readable accent: pixels are binned by hue, weighted by saturation and
 * mid lightness, and the winning bin's average is lifted to a lightness that reads on dark and light themes.
 */
async function extractAccentColor(url: string): Promise<string | null> {
  const image = new Image()
  image.decoding = 'async'
  image.src = url
  await image.decode()
  const size = 48
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null
  context.drawImage(image, 0, 0, size, size)
  const { data } = context.getImageData(0, 0, size, size)
  const bins = Array.from({ length: 18 }, () => ({ weight: 0, r: 0, g: 0, b: 0 }))
  for (let index = 0; index < data.length; index += 4) {
    const r = data[index]
    const g = data[index + 1]
    const b = data[index + 2]
    const { h, s, l } = rgbToHsl(r, g, b)
    if (s < 0.18 || l < 0.12 || l > 0.92) continue
    const weight = s * s * (1 - Math.abs(l - 0.5) * 1.6)
    if (weight <= 0) continue
    const bin = bins[Math.min(bins.length - 1, Math.floor(h * bins.length))]
    bin.weight += weight
    bin.r += r * weight
    bin.g += g * weight
    bin.b += b * weight
  }
  const best = bins.reduce((winner, bin) => (bin.weight > winner.weight ? bin : winner), bins[0])
  if (best.weight <= 0.5) return null
  const { h, s } = rgbToHsl(best.r / best.weight, best.g / best.weight, best.b / best.weight)
  return hslToHex(h, Math.min(0.85, Math.max(0.45, s)), 0.62)
}

/** Accent color drawn from one image URL (cached per URL); null while loading, disabled or colorless. */
export function useImageAccentColor(url: string | null, enabled: boolean) {
  const [accent, setAccent] = useState<{ url: string; color: string | null } | null>(null)
  useEffect(() => {
    if (!enabled || !url) return undefined
    if (accentCache.has(url)) {
      setAccent({ url, color: accentCache.get(url) ?? null })
      return undefined
    }
    let cancelled = false
    extractAccentColor(url)
      .catch(() => null)
      .then((color) => {
        accentCache.set(url, color)
        if (!cancelled) setAccent({ url, color })
      })
    return () => { cancelled = true }
  }, [enabled, url])
  return enabled && url && accent?.url === url ? accent.color : null
}
