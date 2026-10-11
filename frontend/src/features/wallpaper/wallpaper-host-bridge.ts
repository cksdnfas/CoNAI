import { useSyncExternalStore } from 'react'
import { setWallpaperFpsLimit, setWallpaperHostPaused } from './wallpaper-playback'

/**
 * Bridge to the desktop wallpaper hosts. Lively and Wallpaper Engine call global functions on the page they show
 * (user properties, system audio, now playing, hardware, pause). The CoNAI package for each host redirects to the
 * live wallpaper URL, so these globals are installed on that page before it loads (see main.tsx).
 */

export type WallpaperHostKind = 'lively' | 'wallpaper-engine'

export interface WallpaperHostTrack {
  title: string
  artist: string
  album: string
  /** data: URL or null */
  thumbnail: string | null
}

export interface WallpaperHostSystemInfo {
  cpuName: string
  gpuName: string
  /** 0-100 */
  cpu: number
  gpu: number
  /** MB */
  ramTotal: number
  ramAvailable: number
  /** bytes/s */
  netDown: number
  netUp: number
}

interface WallpaperHostState {
  host: WallpaperHostKind | null
  /** Property name → latest value, already decoded (numbers, booleans, strings, #rrggbb colors). */
  properties: Record<string, unknown>
  track: WallpaperHostTrack | null
  system: WallpaperHostSystemInfo | null
  /** True once any audio frame arrived. */
  hasAudio: boolean
}

/** Spectrum bins every visualizer reads (mono, low → high). */
export const WALLPAPER_AUDIO_BINS = 64

const listeners = new Set<() => void>()
let state: WallpaperHostState = { host: null, properties: {}, track: null, system: null, hasAudio: false }
const audioLevels = new Float32Array(WALLPAPER_AUDIO_BINS)
let audioUpdatedAt = 0
let installed = false

function emit(patch: Partial<WallpaperHostState>) {
  state = { ...state, ...patch }
  listeners.forEach((listener) => listener())
}

function markHost(host: WallpaperHostKind) {
  if (state.host !== host) emit({ host })
}

function parseJson(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object') return value as Record<string, unknown>
  if (typeof value !== 'string' || value === 'null') return null
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

function text(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function number(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/** Wallpaper Engine colors arrive as "r g b" floats 0-1. */
function weColorToHex(value: string) {
  const parts = value.trim().split(/\s+/).map(Number)
  if (parts.length < 3 || parts.some((part) => !Number.isFinite(part))) return null
  return `#${parts.slice(0, 3).map((part) => Math.round(Math.min(1, Math.max(0, part)) * 255).toString(16).padStart(2, '0')).join('')}`
}

function setProperties(next: Record<string, unknown>) {
  emit({ properties: { ...state.properties, ...next } })
}

/** Fold a host spectrum (any length; Wallpaper Engine sends left then right halves) into the shared bins. */
function writeAudio(raw: ArrayLike<number>, stereoHalves: boolean) {
  const length = raw.length
  if (!length) return
  const half = stereoHalves ? Math.floor(length / 2) : length
  for (let bin = 0; bin < WALLPAPER_AUDIO_BINS; bin += 1) {
    const from = Math.floor((bin / WALLPAPER_AUDIO_BINS) * half)
    const to = Math.max(from + 1, Math.floor(((bin + 1) / WALLPAPER_AUDIO_BINS) * half))
    let sum = 0
    for (let index = from; index < to; index += 1) {
      sum += stereoHalves ? (number(raw[index]) + number(raw[index + half])) / 2 : number(raw[index])
    }
    audioLevels[bin] = Math.min(1.5, Math.max(0, sum / (to - from)))
  }
  audioUpdatedAt = performance.now()
  if (!state.hasAudio) emit({ hasAudio: true })
}

type HostWindow = Window & Record<string, unknown>

/** Install the host globals once; safe to call on any page. */
export function installWallpaperHostBridge() {
  if (installed || typeof window === 'undefined') return
  installed = true
  const host = window as unknown as HostWindow

  // Lively (https://github.com/rocksdanister/lively/wiki/Web-Guide-IV-:-Interaction).
  host.livelyPropertyListener = (name: unknown, value: unknown) => {
    markHost('lively')
    if (typeof name === 'string') setProperties({ [name]: value })
  }
  host.livelyAudioListener = (audioArray: unknown) => {
    markHost('lively')
    if (Array.isArray(audioArray)) writeAudio(audioArray as number[], false)
  }
  host.livelyCurrentTrack = (data: unknown) => {
    markHost('lively')
    const track = parseJson(data)
    emit({
      track: track && (track.Title || track.Artist)
        ? {
            title: text(track.Title),
            artist: text(track.Artist) || text(track.AlbumArtist),
            album: text(track.AlbumTitle),
            thumbnail: typeof track.Thumbnail === 'string' && track.Thumbnail ? `data:image/png;base64,${track.Thumbnail}` : null,
          }
        : null,
    })
  }
  host.livelySystemInformation = (data: unknown) => {
    markHost('lively')
    const info = parseJson(data)
    if (!info) return
    emit({
      system: {
        cpuName: text(info.NameCpu),
        gpuName: text(info.NameGpu),
        cpu: number(info.CurrentCpu),
        gpu: number(info.CurrentGpu3D),
        ramTotal: number(info.TotalRam),
        ramAvailable: number(info.CurrentRamAvail),
        netDown: number(info.CurrentNetDown),
        netUp: number(info.CurrentNetUp),
      },
    })
  }
  host.livelyWallpaperPlaybackChanged = (data: unknown) => {
    markHost('lively')
    setWallpaperHostPaused(parseJson(data)?.IsPaused === true)
  }

  // Wallpaper Engine (https://docs.wallpaperengine.io/en/web/api/propertylistener.html).
  host.wallpaperPropertyListener = {
    applyUserProperties(properties: Record<string, { value?: unknown; type?: string }>) {
      markHost('wallpaper-engine')
      const next: Record<string, unknown> = {}
      for (const [key, property] of Object.entries(properties ?? {})) {
        if (!property || !('value' in property)) continue
        const value = property.value
        next[key] = typeof value === 'string' && property.type === 'color' ? weColorToHex(value) : value
      }
      setProperties(next)
    },
    applyGeneralProperties(properties: { fps?: number }) {
      markHost('wallpaper-engine')
      if (typeof properties?.fps === 'number') setWallpaperFpsLimit('host', properties.fps)
    },
    setPaused(paused: boolean) {
      markHost('wallpaper-engine')
      setWallpaperHostPaused(paused === true)
    },
  }
  // Wallpaper Engine defines its register functions on the page; if they are not there yet, try once more on load.
  const register = (name: string, callback: (event: never) => void) => {
    const attempt = () => {
      const fn = host[name]
      if (typeof fn !== 'function') return false
      ;(fn as (callback: (event: never) => void) => void)(callback)
      return true
    }
    if (!attempt()) window.addEventListener('load', attempt, { once: true })
  }
  register('wallpaperRegisterAudioListener', (audioArray: ArrayLike<number>) => {
    markHost('wallpaper-engine')
    writeAudio(audioArray, true)
  })
  let weTrack: WallpaperHostTrack | null = null
  register('wallpaperRegisterMediaPropertiesListener', (event: { title?: string; artist?: string; albumTitle?: string }) => {
    markHost('wallpaper-engine')
    weTrack = event?.title || event?.artist
      ? { title: text(event.title), artist: text(event.artist), album: text(event.albumTitle), thumbnail: weTrack?.thumbnail ?? null }
      : null
    emit({ track: weTrack })
  })
  register('wallpaperRegisterMediaThumbnailListener', (event: { thumbnail?: string }) => {
    if (!weTrack) return
    weTrack = { ...weTrack, thumbnail: typeof event?.thumbnail === 'string' ? event.thumbnail : null }
    emit({ track: weTrack })
  })
  register('wallpaperRegisterMediaPlaybackListener', (event: { state?: number }) => {
    // 0 = stopped; the track card clears instead of showing a stale song.
    if (event?.state === 0) {
      weTrack = null
      emit({ track: null })
    }
  })
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getState() {
  return state
}

export function useWallpaperHostState() {
  return useSyncExternalStore(subscribe, getState, getState)
}

/** Live spectrum (shared buffer, do not keep) and whether it is fresh; read it inside a frame loop. */
export function readWallpaperHostAudio() {
  return { levels: audioLevels, fresh: performance.now() - audioUpdatedAt < 1000 }
}
