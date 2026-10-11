import type { TranslationInput, TranslationParams } from '@/i18n'
import { buildStoredZip } from '@/lib/zip-store'
import { resolveWallpaperPresetOptions } from './wallpaper-layout-utils'
import type { WallpaperLayoutPreset, WallpaperParticleKind, WallpaperPresetOptions, WallpaperThemeMode } from './wallpaper-types'

/**
 * Lively and Wallpaper Engine packages for a CoNAI live wallpaper. Each package is a tiny local web wallpaper that
 * redirects to the live URL; the host then calls its globals on our page (see wallpaper-host-bridge), so the
 * wallpaper is still the server's page and the URL flow stays as it is. The packages declare user properties the
 * host shows in its sidebar.
 */

type Translate = (input: TranslationInput, params?: TranslationParams) => string

const PARTICLES: WallpaperParticleKind[] = ['none', 'snow', 'sakura', 'rain', 'dust', 'fireflies']
const THEMES: Array<WallpaperThemeMode | null> = [null, 'dark', 'light', 'auto']
/** Query parameter listing the preset ids behind the host's wallpaper dropdown (item 1…n). */
export const WALLPAPER_HOST_PRESETS_PARAM = 'hp'

interface HostPropertyLabels {
  wallpaper: string
  defaultWallpaper: string
  theme: string
  themes: string[]
  customize: string
  accentColor: string
  dim: string
  particles: string
  particleKinds: string[]
  particleAmount: string
  parallax: string
  revealOnPointer: string
}

function labels(t: Translate): HostPropertyLabels {
  return {
    wallpaper: t({ ko: '월페이퍼', en: 'Wallpaper' }),
    defaultWallpaper: t({ ko: '기본 (키·스케줄·활성)', en: 'Default (key, schedule, active)' }),
    theme: t({ ko: '색 테마', en: 'Theme' }),
    themes: [t({ ko: '프리셋 그대로', en: 'As saved' }), t({ ko: '다크', en: 'Dark' }), t({ ko: '라이트', en: 'Light' }), t({ ko: '시간대', en: 'By time' })],
    customize: t({ ko: '아래 설정으로 덮어쓰기', en: 'Override with the settings below' }),
    accentColor: t({ ko: '강조색', en: 'Accent' }),
    dim: t({ ko: '배경 어둡게', en: 'Dim background' }),
    particles: t({ ko: '파티클', en: 'Particles' }),
    particleKinds: [t({ ko: '없음', en: 'None' }), t({ ko: '눈', en: 'Snow' }), t({ ko: '벚꽃', en: 'Sakura' }), t({ ko: '비', en: 'Rain' }), t({ ko: '먼지', en: 'Dust' }), t({ ko: '반딧불', en: 'Fireflies' })],
    particleAmount: t({ ko: '파티클 양', en: 'Particle amount' }),
    parallax: t({ ko: '패럴랙스', en: 'Parallax' }),
    revealOnPointer: t({ ko: '위젯은 마우스 가까이에서만', en: 'Show widgets near the pointer only' }),
  }
}

/** Host property values → what the live page changes. Overrides apply only while `customize` is on. */
export interface WallpaperHostOverrides {
  presetId: string | null
  themeMode: WallpaperThemeMode | null
  options: Partial<WallpaperPresetOptions> | null
  dim: number | null
}

function toIndex(value: unknown) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0
}

function toNumber(value: unknown, min: number, max: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : null
}

export function resolveWallpaperHostOverrides(properties: Record<string, unknown>, hostPresetIds: string[]): WallpaperHostOverrides {
  const presetIndex = toIndex(properties.wallpaper)
  const customize = properties.customize === true
  const options: Partial<WallpaperPresetOptions> = {}
  if (customize) {
    if (typeof properties.accentColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(properties.accentColor)) options.accentColor = properties.accentColor
    if (properties.particles !== undefined) options.particles = PARTICLES[toIndex(properties.particles)] ?? 'none'
    const amount = toNumber(properties.particleAmount, 0, 100)
    if (amount !== null) options.particleAmount = amount
    const parallax = toNumber(properties.parallax, 0, 100)
    if (parallax !== null) options.parallax = parallax
    if (typeof properties.revealOnPointer === 'boolean') options.widgetReveal = properties.revealOnPointer ? 'pointer' : 'always'
  }
  return {
    presetId: presetIndex > 0 ? hostPresetIds[presetIndex - 1] ?? null : null,
    themeMode: THEMES[toIndex(properties.theme)] ?? null,
    options: customize ? options : null,
    dim: customize ? toNumber(properties.dim, 0, 80) : null,
  }
}

/** The layout the live page shows after host overrides. */
export function applyWallpaperHostOverrides(layout: WallpaperLayoutPreset, overrides: WallpaperHostOverrides): WallpaperLayoutPreset {
  if (!overrides.themeMode && !overrides.options && overrides.dim === null) return layout
  return {
    ...layout,
    ...(overrides.themeMode ? { themeMode: overrides.themeMode } : null),
    ...(overrides.options ? { options: { ...resolveWallpaperPresetOptions(layout.options), ...overrides.options } } : null),
    ...(overrides.dim !== null ? { background: { ...layout.background, dim: overrides.dim } } : null),
  }
}

function redirectPage(title: string, url: string, connecting: string, failed: string) {
  const json = (value: string) => JSON.stringify(value).replace(/</g, '\\u003c')
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title.replace(/[<&]/g, '')}</title>
<style>html,body{margin:0;height:100%;background:#0b0b0d;color:#8a8a92;font:14px system-ui,sans-serif}body{display:grid;place-items:center}</style>
</head>
<body>
<p id="status">${connecting.replace(/[<&]/g, '')}</p>
<script>
var target = ${json(url)};
window.location.replace(target);
setTimeout(function () { document.getElementById('status').textContent = ${json(failed)} + ' ' + target; }, 15000);
</script>
</body>
</html>
`
}

function packageFileName(name: string, host: string) {
  const slug = name.trim().replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '') || 'wallpaper'
  return `${slug}.${host}.zip`
}

interface WallpaperHostPackageInput {
  /** Device / key name; becomes the wallpaper title. */
  name: string
  /** Absolute live URL with the runtime key. */
  url: string
  presets: WallpaperLayoutPreset[]
  /** Preset whose look seeds the property defaults. */
  basePreset: WallpaperLayoutPreset | null
  t: Translate
}

function withHostPresets(url: string, presets: WallpaperLayoutPreset[]) {
  // The SPA routes in the hash, so the list rides the hash query next to the key.
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}${WALLPAPER_HOST_PRESETS_PARAM}=${encodeURIComponent(presets.map((preset) => preset.id).join(','))}`
}

function defaults(basePreset: WallpaperLayoutPreset | null) {
  const options = resolveWallpaperPresetOptions(basePreset?.options)
  return {
    accent: options.accentColor ?? '#7c5cff',
    dim: Math.round(basePreset?.background.dim ?? 0),
    particles: Math.max(0, PARTICLES.indexOf(options.particles)),
    particleAmount: Math.round(options.particleAmount),
    parallax: Math.round(options.parallax),
    reveal: options.widgetReveal === 'pointer',
  }
}

/** Lively web wallpaper (Type 2 = webaudio) with now playing, hardware and pause events. */
export function buildLivelyWallpaperPackage({ name, url, presets, basePreset, t }: WallpaperHostPackageInput) {
  const label = labels(t)
  const seed = defaults(basePreset)
  const info = {
    AppVersion: '2.0.0.0',
    Title: name,
    Desc: t({ ko: 'CoNAI 라이브 월페이퍼', en: 'CoNAI live wallpaper' }),
    Author: 'CoNAI',
    License: '',
    Contact: '',
    Type: 2,
    FileName: 'index.html',
    Arguments: '--system-nowplaying true --system-information true --pause-event true',
    IsAbsolutePath: false,
  }
  const properties = {
    wallpaper: { type: 'dropdown', text: label.wallpaper, value: 0, items: [label.defaultWallpaper, ...presets.map((preset) => preset.name)] },
    theme: { type: 'dropdown', text: label.theme, value: 0, items: label.themes },
    customize: { type: 'checkbox', text: label.customize, value: false },
    accentColor: { type: 'color', text: label.accentColor, value: seed.accent },
    dim: { type: 'slider', text: label.dim, value: seed.dim, min: 0, max: 80, step: 1 },
    particles: { type: 'dropdown', text: label.particles, value: seed.particles, items: label.particleKinds },
    particleAmount: { type: 'slider', text: label.particleAmount, value: seed.particleAmount, min: 0, max: 100, step: 1 },
    parallax: { type: 'slider', text: label.parallax, value: seed.parallax, min: 0, max: 100, step: 1 },
    revealOnPointer: { type: 'checkbox', text: label.revealOnPointer, value: seed.reveal },
  }
  const blob = buildStoredZip([
    { name: 'LivelyInfo.json', data: JSON.stringify(info, null, 2) },
    { name: 'LivelyProperties.json', data: JSON.stringify(properties, null, 2) },
    {
      name: 'index.html',
      data: redirectPage(name, withHostPresets(url, presets), t({ ko: 'CoNAI 월페이퍼에 연결하는 중…', en: 'Connecting to the CoNAI wallpaper…' }), t({ ko: '연결하지 못했어:', en: 'Could not connect:' })),
    },
  ])
  return { fileName: packageFileName(name, 'lively'), blob }
}

function weColor(hex: string) {
  const channel = (offset: number) => (parseInt(hex.slice(offset, offset + 2), 16) / 255).toFixed(3)
  return `${channel(1)} ${channel(3)} ${channel(5)}`
}

/** Wallpaper Engine web project (open it in the editor or drop the folder into myprojects). */
export function buildWallpaperEnginePackage({ name, url, presets, basePreset, t }: WallpaperHostPackageInput) {
  const label = labels(t)
  const seed = defaults(basePreset)
  const combo = (items: string[]) => items.map((itemLabel, index) => ({ label: itemLabel, value: String(index) }))
  const project = {
    title: name,
    description: t({ ko: 'CoNAI 라이브 월페이퍼', en: 'CoNAI live wallpaper' }),
    file: 'index.html',
    type: 'web',
    general: {
      supportsaudioprocessing: true,
      properties: {
        wallpaper: { order: 0, text: label.wallpaper, type: 'combo', value: '0', options: combo([label.defaultWallpaper, ...presets.map((preset) => preset.name)]) },
        theme: { order: 1, text: label.theme, type: 'combo', value: '0', options: combo(label.themes) },
        customize: { order: 2, text: label.customize, type: 'bool', value: false },
        accentColor: { order: 3, text: label.accentColor, type: 'color', value: weColor(seed.accent) },
        dim: { order: 4, text: label.dim, type: 'slider', value: seed.dim, min: 0, max: 80 },
        particles: { order: 5, text: label.particles, type: 'combo', value: String(seed.particles), options: combo(label.particleKinds) },
        particleAmount: { order: 6, text: label.particleAmount, type: 'slider', value: seed.particleAmount, min: 0, max: 100 },
        parallax: { order: 7, text: label.parallax, type: 'slider', value: seed.parallax, min: 0, max: 100 },
        revealOnPointer: { order: 8, text: label.revealOnPointer, type: 'bool', value: seed.reveal },
      },
    },
  }
  const folder = packageFileName(name, 'wallpaper-engine').replace(/\.zip$/, '')
  const blob = buildStoredZip([
    { name: `${folder}/project.json`, data: JSON.stringify(project, null, 2) },
    {
      name: `${folder}/index.html`,
      data: redirectPage(name, withHostPresets(url, presets), t({ ko: 'CoNAI 월페이퍼에 연결하는 중…', en: 'Connecting to the CoNAI wallpaper…' }), t({ ko: '연결하지 못했어:', en: 'Could not connect:' })),
    },
  ])
  return { fileName: packageFileName(name, 'wallpaper-engine'), blob }
}
