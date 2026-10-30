/** Timings and labels more than one part of the village uses. */

/** Expedition phases: the resident is in the dungeon (or waiting to revive) and out of the village. */
export const AWAY = new Set(['travel', 'explore', 'consider', 'combat', 'return', 'dead'])

export const BUBBLE_MS = 12_000
export const RETRY_MS = 5_000
export const HIGHLIGHT_MS = 2 * 60_000 // a moment older than this is no longer news
export const POSTS = { guild: '길드 접수원', merchant: '상인', oracle: '신관' }
export const ERRAND_TEXT = { depart: '던전 가는 길', bed: '여관으로 가는 중', oracle: '신전에서 신탁 받는 중', post: '출근하는 중', rough: '광장에서 잘 곳 찾는 중' }
