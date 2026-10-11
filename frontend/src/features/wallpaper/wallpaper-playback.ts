import { useSyncExternalStore } from 'react'

/**
 * Whether wallpaper motion may run. A wallpaper stays open all day, so motion stops while the page is hidden or a
 * host (Lively, Wallpaper Engine) pauses it, follows the system reduced-motion setting and honors an FPS cap.
 */
export interface WallpaperPlaybackState {
  hidden: boolean
  hostPaused: boolean
  reducedMotion: boolean
  /** Frames per second for script-driven animation; 0 = display rate. */
  fpsLimit: number
}

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'
const listeners = new Set<() => void>()
let state: WallpaperPlaybackState = {
  hidden: typeof document !== 'undefined' ? document.hidden : false,
  hostPaused: false,
  reducedMotion: typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(REDUCED_MOTION_QUERY).matches : false,
  fpsLimit: 0,
}
let detachEnvironment: (() => void) | null = null

function setState(patch: Partial<WallpaperPlaybackState>) {
  const next = { ...state, ...patch }
  if ((Object.keys(patch) as Array<keyof WallpaperPlaybackState>).every((key) => next[key] === state[key])) return
  state = next
  listeners.forEach((listener) => listener())
}

function attachEnvironment() {
  const onVisibility = () => setState({ hidden: document.hidden })
  const media = typeof window.matchMedia === 'function' ? window.matchMedia(REDUCED_MOTION_QUERY) : null
  const onMotion = () => setState({ reducedMotion: Boolean(media?.matches) })
  document.addEventListener('visibilitychange', onVisibility)
  media?.addEventListener('change', onMotion)
  onVisibility()
  onMotion()
  return () => {
    document.removeEventListener('visibilitychange', onVisibility)
    media?.removeEventListener('change', onMotion)
  }
}

export function subscribeWallpaperPlayback(listener: () => void) {
  listeners.add(listener)
  if (!detachEnvironment && typeof document !== 'undefined') detachEnvironment = attachEnvironment()
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && detachEnvironment) {
      detachEnvironment()
      detachEnvironment = null
    }
  }
}

export function getWallpaperPlaybackState() {
  return state
}

export function isWallpaperPlaybackRunning(current = state) {
  return !current.hidden && !current.hostPaused
}

export function setWallpaperHostPaused(paused: boolean) {
  setState({ hostPaused: paused })
}

const fpsLimits = { preset: 0, host: 0 }

/** Cap scripted animation; the preset and the host (Wallpaper Engine's FPS setting) each set one, the lower wins. */
export function setWallpaperFpsLimit(source: keyof typeof fpsLimits, fps: number) {
  fpsLimits[source] = Number.isFinite(fps) && fps > 0 ? Math.min(240, Math.round(fps)) : 0
  const limits = Object.values(fpsLimits).filter((value) => value > 0)
  setState({ fpsLimit: limits.length > 0 ? Math.min(...limits) : 0 })
}

export function useWallpaperPlayback() {
  return useSyncExternalStore(subscribeWallpaperPlayback, getWallpaperPlaybackState, getWallpaperPlaybackState)
}

/**
 * Run `step(now, deltaMs)` once per frame while playback runs, at most `fpsLimit` times a second. The loop sleeps
 * while paused or hidden and resumes without a jump (delta is capped). Returns the stop function.
 */
export function runWallpaperFrameLoop(step: (now: number, deltaMs: number) => void, maxDeltaMs = 48) {
  let frameId: number | null = null
  let lastFrameTime: number | null = null
  let stopped = false

  const schedule = () => {
    if (stopped || frameId !== null || !isWallpaperPlaybackRunning()) return
    frameId = window.requestAnimationFrame(tick)
  }

  const tick = (now: number) => {
    frameId = null
    if (stopped) return
    const minFrameMs = state.fpsLimit > 0 ? 1000 / state.fpsLimit : 0
    if (lastFrameTime !== null && now - lastFrameTime < minFrameMs - 1) {
      schedule()
      return
    }
    const deltaMs = lastFrameTime === null ? 16 : Math.min(maxDeltaMs, now - lastFrameTime)
    lastFrameTime = now
    step(now, deltaMs)
    schedule()
  }

  const unsubscribe = subscribeWallpaperPlayback(() => {
    if (isWallpaperPlaybackRunning()) {
      lastFrameTime = null
      schedule()
    } else if (frameId !== null) {
      window.cancelAnimationFrame(frameId)
      frameId = null
    }
  })
  schedule()

  return () => {
    stopped = true
    unsubscribe()
    if (frameId !== null) window.cancelAnimationFrame(frameId)
  }
}
