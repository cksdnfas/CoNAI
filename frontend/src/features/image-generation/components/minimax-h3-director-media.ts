import type { MiniMaxH3DirectorTimelineItem, MiniMaxH3DirectorVideoMode } from './minimax-h3-director-dasiwa-utils'

export type MiniMaxDirectorMediaLane = 'image' | 'video' | 'audio'
export const MINIMAX_DIRECTOR_MEDIA_LIMITS = { image: 9, video: 3, audio: 3, total: 12 } as const

/** Resolve the primary lane without losing audio-only video sources. */
export function getMiniMaxDirectorMediaLane(item: Pick<MiniMaxH3DirectorTimelineItem, 'type' | 'media_mode'>): MiniMaxDirectorMediaLane {
  return item.type === 'video' && item.media_mode === 'audio' ? 'audio' : item.type
}

/** Count each stream consumed by the native reference node. */
export function hasMiniMaxDirectorAudio(item: MiniMaxH3DirectorTimelineItem) {
  return item.type === 'audio' || (item.type === 'video' && (item.media_mode === 'audio' || item.media_mode === 'video_audio' || item.audio != null))
}

/** Match native reference ordering rather than upload order. */
export function sortMiniMaxDirectorMedia(items: MiniMaxH3DirectorTimelineItem[]) {
  const order = { image: 0, video: 1, audio: 2 }
  return [...items].sort((a, b) => order[a.type] - order[b.type] || a.slot - b.slot || a.order - b.order)
}

/** Reserve the linked audio stream as well as a video's primary slot. */
export function getMiniMaxDirectorFreeSlot(items: MiniMaxH3DirectorTimelineItem[], lane: MiniMaxDirectorMediaLane) {
  const occupied = new Set<number>()
  for (const item of items.filter((candidate) => candidate.enabled !== false)) {
    if (getMiniMaxDirectorMediaLane(item) === lane) occupied.add(item.slot)
    else if (lane === 'audio' && hasMiniMaxDirectorAudio(item)) {
      occupied.add(typeof item.audioSlot === 'number' ? item.audioSlot : item.slot)
    }
  }
  return Array.from({ length: MINIMAX_DIRECTOR_MEDIA_LIMITS[lane] }, (_, index) => index).find((slot) => !occupied.has(slot)) ?? null
}

/** Check stream capacity before uploads, pack imports, and video-mode changes. */
export function fitsMiniMaxDirectorMedia(items: MiniMaxH3DirectorTimelineItem[]) {
  const active = items.filter((item) => item.enabled !== false)
  const image = active.filter((item) => item.type === 'image').length
  const video = active.filter((item) => item.type === 'video' && item.media_mode !== 'audio').length
  const audio = active.filter(hasMiniMaxDirectorAudio).length
  return image <= 9 && video <= 3 && audio <= 3 && image + video + audio <= 12
}

/** Move video streams atomically; never silently drop a requested audio stream. */
export function retargetMiniMaxDirectorVideo(items: MiniMaxH3DirectorTimelineItem[], target: MiniMaxH3DirectorTimelineItem, mode: MiniMaxH3DirectorVideoMode) {
  const next = { ...target, media_mode: mode }
  const others = items.filter((item) => item.id !== target.id)
  const oldLane = getMiniMaxDirectorMediaLane(target)
  const nextLane = getMiniMaxDirectorMediaLane(next)
  if (oldLane !== nextLane) {
    const slot = nextLane === 'audio' && typeof target.audioSlot === 'number'
      ? target.audioSlot : getMiniMaxDirectorFreeSlot(others, nextLane)
    if (slot === null) return null
    next.slot = slot
    next.start = slot
  }
  delete next.audioSlot
  if (mode === 'video_audio' || (mode === 'video' && target.audio != null)) {
    const audioSlot = oldLane === 'audio' ? target.slot
      : hasMiniMaxDirectorAudio(target) && typeof target.audioSlot === 'number' ? target.audioSlot : getMiniMaxDirectorFreeSlot(others, 'audio')
    if (audioSlot === null) return null
    next.audioSlot = audioSlot
  }
  return fitsMiniMaxDirectorMedia([...others, next]) ? next : null
}
