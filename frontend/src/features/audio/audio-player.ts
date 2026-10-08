import { useSyncExternalStore } from 'react'
import { audioCandidateFileUrl } from '@/lib/api-audio'

/**
 * One audio element for the whole app (음향 page, chat cards): starting a take stops whatever played before, like the
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
let state: AudioPlayerState = { key: null, playing: false, currentTime: 0, duration: 0 }
const listeners = new Set<() => void>()
/** Stop position for region playback (seconds), or null to play to the end. */
let stopAt: number | null = null
let onEnded: (() => void) | null = null

function emit(next: Partial<AudioPlayerState>) {
  state = { ...state, ...next }
  listeners.forEach((listener) => listener())
}

function audio(): HTMLAudioElement {
  if (element) return element
  element = new Audio()
  element.preload = 'auto'
  element.addEventListener('play', () => emit({ playing: true }))
  element.addEventListener('pause', () => emit({ playing: false }))
  element.addEventListener('loadedmetadata', () => emit({ duration: Number.isFinite(element!.duration) ? element!.duration : 0 }))
  element.addEventListener('timeupdate', () => {
    if (stopAt !== null && element!.currentTime >= stopAt) {
      element!.pause()
      stopAt = null
    }
    emit({ currentTime: element!.currentTime })
  })
  element.addEventListener('ended', () => {
    emit({ playing: false })
    const callback = onEnded
    onEnded = null
    callback?.()
  })
  return element
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
      emit({ key, currentTime: 0, duration: 0 })
    }
    player.playbackRate = options.rate ?? 1
    player.preservesPitch = true
    stopAt = options.end ?? null
    onEnded = options.onEnded ?? null
    if (options.start !== undefined) player.currentTime = options.start
    else if (player.ended) player.currentTime = 0
    void player.play().catch(() => emit({ playing: false }))
  },
  toggle(key: string, options: PlayOptions = {}) {
    if (state.key === key && state.playing) audioPlayer.pause()
    else audioPlayer.play(key, options)
  },
  pause() {
    element?.pause()
  },
  stop() {
    if (!element) return
    element.pause()
    element.removeAttribute('src')
    element.load()
    stopAt = null
    onEnded = null
    emit({ key: null, playing: false, currentTime: 0, duration: 0 })
  },
  seek(seconds: number) {
    if (element) element.currentTime = seconds
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
