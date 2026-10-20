import { useSyncExternalStore } from 'react'
import { audioCandidateFileUrl } from '@/lib/api-audio'

/**
 * One audio element for the whole app (오디오 page, chat cards): starting a take stops whatever played before, like the
 * original SFX manager. Components read the state through `useAudioPlayer`.
 */
export interface AudioPlayerState {
  /** Candidate id, or a preview key such as `preview:<id>`. */
  key: string | null
  playing: boolean
  currentTime: number
  duration: number
}

let element: HTMLAudioElement | null = null
const idleState: AudioPlayerState = { key: null, playing: false, currentTime: 0, duration: 0 }
let state = idleState
const listeners = new Set<() => void>()
/** Stop position for region playback (seconds), or null to play to the end. */
let stopAt: number | null = null
let onEnded: (() => void) | null = null
let playAttempt = 0

function emit(next: Partial<AudioPlayerState>) {
  if ((Object.keys(next) as Array<keyof AudioPlayerState>).every((key) => state[key] === next[key])) return
  state = { ...state, ...next }
  listeners.forEach((listener) => listener())
}

function audio(): HTMLAudioElement {
  if (element) return element
  element = new Audio()
  element.preload = 'auto'
  // Events from the previous source may already be queued; read the element's current state.
  const syncPlaying = () => emit({ playing: state.key !== null && !element!.paused })
  element.addEventListener('play', syncPlaying)
  element.addEventListener('pause', syncPlaying)
  element.addEventListener('loadedmetadata', () => {
    if (state.key !== null) emit({ duration: Number.isFinite(element!.duration) ? element!.duration : 0 })
  })
  element.addEventListener('timeupdate', () => {
    if (state.key === null) return
    if (stopAt !== null && element!.currentTime >= stopAt) {
      element!.pause()
      element!.currentTime = stopAt
      stopAt = null
    }
    emit({ currentTime: element!.currentTime })
  })
  element.addEventListener('ended', () => {
    if (state.key === null || !element!.ended) return
    emit({ playing: false })
    const callback = onEnded
    onEnded = null
    callback?.()
  })
  element.addEventListener('error', () => {
    if (state.key === null || !element!.error) return
    playAttempt++
    stopAt = null
    onEnded = null
    emit({ playing: false })
  })
  return element
}

function startPlayback(player: HTMLAudioElement) {
  const attempt = ++playAttempt
  void player.play().catch(() => {
    if (attempt === playAttempt) emit({ playing: false })
  })
}

export interface PlayOptions {
  /** Source URL; defaults to the candidate's file. */
  src?: string
  start?: number
  end?: number
  /** Playback rate with the pitch kept, for the editor's region preview. */
  rate?: number
  onEnded?: () => void
}

export const audioPlayer = {
  play(key: string, options: PlayOptions = {}) {
    const player = audio()
    const src = options.src ?? audioCandidateFileUrl(key)
    if (state.key !== key || player.src !== new URL(src, window.location.href).href) {
      player.src = src
      emit({ key, playing: false, currentTime: 0, duration: 0 })
    }
    player.playbackRate = options.rate ?? 1
    player.preservesPitch = true
    stopAt = options.end ?? null
    onEnded = options.onEnded ?? null
    if (options.start !== undefined) player.currentTime = options.start
    else if (player.ended) player.currentTime = 0
    emit({ currentTime: player.currentTime })
    startPlayback(player)
  },
  toggle(key: string, options: PlayOptions = {}) {
    if (state.key === key && state.playing) audioPlayer.pause()
    else audioPlayer.play(key, options)
  },
  pause() {
    playAttempt++
    element?.pause()
    emit({ playing: false })
  },
  resume() {
    if (element && state.key) startPlayback(element)
  },
  stop() {
    playAttempt++
    if (!element) return
    element.pause()
    element.removeAttribute('src')
    element.load()
    stopAt = null
    onEnded = null
    emit({ key: null, playing: false, currentTime: 0, duration: 0 })
  },
  seek(seconds: number) {
    if (!element || !Number.isFinite(seconds)) return
    const duration = Number.isFinite(element.duration) ? element.duration : Infinity
    element.currentTime = Math.max(0, Math.min(seconds, stopAt ?? duration, duration))
    emit({ currentTime: element.currentTime })
  },
  get state() {
    return state
  },
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useAudioPlayer(): AudioPlayerState {
  return useSyncExternalStore(subscribe, () => state, () => state)
}

/** Inactive rows share one snapshot, so another track's time updates do not re-render them. */
export function useAudioPlayerFor(key: string): AudioPlayerState {
  const getSnapshot = () => state.key === key ? state : idleState
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
