import { createApiFallbackError } from '@/i18n/api-error-fallbacks'
import { fetchJson } from '@/lib/api-client'
import { requestApiData } from '@/lib/api-request'
import type { GraphWorkflowBrowseContentRecord } from '@/lib/api-module-graph'
import type { ImageRecord } from '@/types/image'
import type { ApiResponse } from '@/types/image'
import type { AppearanceSettings } from '@conai/shared'

async function requestWallpaperRuntimeData<T>(path: string, fallbackKey: Parameters<typeof createApiFallbackError>[1]) {
  const response = await fetchJson<ApiResponse<T>>(path)
  if (!response.success) {
    throw createApiFallbackError(response.error, fallbackKey)
  }
  return response.data
}

const BASE = '/api/wallpaper-runtime'

/** Load the read-only workflow browse snapshot used by wallpaper live widgets. */
export async function getWallpaperRuntimeBrowseContent(folderId?: number | null) {
  const searchParams = new URLSearchParams()
  if (typeof folderId === 'number') {
    searchParams.set('folder_id', String(folderId))
  }

  return requestWallpaperRuntimeData<GraphWorkflowBrowseContentRecord>(`${BASE}/browse-content${searchParams.size > 0 ? `?${searchParams.toString()}` : ''}`, 'wallpaperRuntime.browseContent.load')
}

/** Load one read-only group preview image list for wallpaper live widgets. */
export async function getWallpaperRuntimeGroupPreviewImages(groupId: number, params?: { includeChildren?: boolean; count?: number }) {
  const searchParams = new URLSearchParams()
  searchParams.set('count', String(params?.count ?? 1))
  searchParams.set('includeChildren', String(params?.includeChildren ?? true))

  return requestWallpaperRuntimeData<ImageRecord[]>(`${BASE}/groups/${groupId}/preview-images?${searchParams.toString()}`, 'wallpaperRuntime.groupPreview.load')
}

export interface WallpaperRuntimeSettingsRecord {
  wallpaperLayoutPresets: AppearanceSettings['wallpaperLayoutPresets']
  wallpaperActivePresetId: string | null
  /** Set when this browser reads through a runtime key bound to one wallpaper. */
  tokenPresetId?: string | null
}

export function getWallpaperRuntimeSettingsRecord() {
  return requestApiData<WallpaperRuntimeSettingsRecord>(`${BASE}/settings`)
}

/** Trade a runtime key for this browser's session; returns the wallpaper the key is bound to. */
export function exchangeWallpaperRuntimeKey(token: string) {
  return requestApiData<{ presetId: string | null }>(`${BASE}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  })
}

export interface WallpaperRuntimeTokenRecord {
  id: number
  name: string
  prefix: string
  presetId: string | null
  createdAt: string
  lastUsedAt: string | null
}

export function listWallpaperRuntimeTokens() {
  return requestApiData<WallpaperRuntimeTokenRecord[]>(`${BASE}/tokens`)
}

export function createWallpaperRuntimeToken(input: { name: string; presetId: string | null }) {
  return requestApiData<WallpaperRuntimeTokenRecord & { token: string }>(`${BASE}/tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export function revokeWallpaperRuntimeToken(id: number) {
  return requestApiData<{ revoked: boolean }>(`${BASE}/tokens/${id}`, { method: 'DELETE' })
}

export type WallpaperServiceType = 'novelai' | 'comfyui' | 'codex'

export interface WallpaperQueueProgress {
  phase: string
  node_label: string | null
  value: number | null
  max: number | null
  percent: number | null
}

export interface WallpaperQueueSnapshot {
  counts: Record<string, number>
  active: Array<{
    id: number
    serviceType: WallpaperServiceType
    status: 'queued' | 'dispatching' | 'running'
    workflowName: string | null
    queuedAt: string
    startedAt: string | null
    progress: WallpaperQueueProgress | null
  }>
}

function serviceQuery(service: string | undefined) {
  return service && service !== 'all' ? `service=${encodeURIComponent(service)}` : ''
}

function withQuery(path: string, ...parts: string[]) {
  const query = parts.filter(Boolean).join('&')
  return query ? `${path}?${query}` : path
}

export function getWallpaperQueueSnapshot(service?: string) {
  return requestApiData<WallpaperQueueSnapshot>(withQuery(`${BASE}/generation/queue`, serviceQuery(service)))
}

export interface WallpaperHistoryItem {
  id: number
  serviceType: WallpaperServiceType
  workflowName: string | null
  createdAt: string | null
  completedAt: string | null
  compositeHash: string
  width: number | null
  height: number | null
  mimeType: string | null
  thumbnailUrl: string
  imageUrl: string
}

export function getWallpaperGenerationHistory(limit: number, service?: string) {
  return requestApiData<WallpaperHistoryItem[]>(withQuery(`${BASE}/generation/history`, `limit=${limit}`, serviceQuery(service)))
}

function localOffsetQuery() {
  return `offset=${-new Date().getTimezoneOffset()}`
}

export interface WallpaperGenerationStats {
  days: number
  daily: Array<{ date: string; total: number; completed: number; failed: number; byService: Record<WallpaperServiceType, number> }>
  totals: { total: number; completed: number; failed: number; byService: Record<WallpaperServiceType, number> }
}

export function getWallpaperGenerationStats(days: number) {
  return requestApiData<WallpaperGenerationStats>(withQuery(`${BASE}/generation/stats`, `days=${days}`, localOffsetQuery()))
}

interface LlmTotals {
  requests: number
  failed: number
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  estimatedRequests: number
  averageLatencyMs: number | null
}

export interface WallpaperLlmUsage {
  days: number
  totals: LlmTotals
  daily: Array<{ date: string; requests: number; failed: number; inputTokens: number; outputTokens: number; averageLatencyMs: number | null }>
  byPurpose: Array<{ date: string; purpose: string; requests: number; tokens: number }>
  byModel: Array<{ date: string; providerName: string; model: string; requests: number; tokens: number }>
  models: Array<LlmTotals & { providerName: string; model: string; engine: string }>
}

export function getWallpaperLlmUsage(days: number) {
  return requestApiData<WallpaperLlmUsage>(withQuery(`${BASE}/llm-usage`, `days=${days}`, localOffsetQuery()))
}

export interface WallpaperLibraryStats {
  total: number
  taggedImages: number
  untaggedImages: number
  characterCount: number
  ratingDistribution: Record<string, number>
  topTags: Array<{ tag: string; count: number }>
}

export function getWallpaperLibraryStats() {
  return requestApiData<WallpaperLibraryStats>(`${BASE}/library/stats`)
}

export interface WallpaperChatProfile {
  id: number
  name: string
  tagline: string | null
  avatarThumbnailUrl: string | null
  backgroundUrl: string | null
}

export function getWallpaperChatProfiles() {
  return requestApiData<WallpaperChatProfile[]>(`${BASE}/chat/profiles`)
}

export interface WallpaperChatThread {
  id: number
  title: string
  kind: string
  profileId: number | null
  updatedAt: string
  preview: string | null
  unreadCount: number
  running: boolean
}

export function getWallpaperChatThreads(profileId: number | null, limit = 10) {
  return requestApiData<WallpaperChatThread[]>(withQuery(`${BASE}/chat/threads`, profileId !== null ? `profileId=${profileId}` : '', `limit=${limit}`))
}

export interface WallpaperChatMessages {
  running: boolean
  messages: Array<{ id: number; role: 'user' | 'assistant'; text: string; speakerProfileId: number | null; createdAt: string }>
}

export function getWallpaperChatMessages(threadId: number, limit: number) {
  return requestApiData<WallpaperChatMessages>(`${BASE}/chat/threads/${threadId}/messages?limit=${limit}`)
}

export interface WallpaperAudioCandidate {
  id: string
  name: string
  duration: number | null
  fileUrl: string
}

export function getWallpaperAudioCandidates(groupId: string) {
  return requestApiData<WallpaperAudioCandidate[]>(`${BASE}/audio/groups/${encodeURIComponent(groupId)}/candidates`)
}

export interface WallpaperPost {
  id: number
  title: string
  excerpt: string | null
  authorName: string
  authorAvatarUrl: string | null
  commentCount: number
  coverUrl: string | null
  publishedAt: string
}

export function getWallpaperRecentPosts(limit: number) {
  return requestApiData<WallpaperPost[]>(`${BASE}/posts/recent?limit=${limit}`)
}

export function rollWallpaperPrompt(text: string) {
  return requestApiData<{ text: string }>(`${BASE}/prompt-roll?text=${encodeURIComponent(text)}`)
}
