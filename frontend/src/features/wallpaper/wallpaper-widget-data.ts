import { createContext, useContext, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getWallpaperAudioCandidates,
  getWallpaperChatMessages,
  getWallpaperChatProfiles,
  getWallpaperChatThreads,
  getWallpaperComfyStats,
  getWallpaperGenerationHistory,
  getWallpaperGenerationStats,
  getWallpaperLibraryStats,
  getWallpaperLlmUsage,
  getWallpaperQueueSnapshot,
  getWallpaperRecentPosts,
  getWallpaperRuntimeGroupPreviewImages,
  getWallpaperWorkflowActivity,
  rollWallpaperPrompt,
} from '@/lib/api-wallpaper-runtime'
import type { ImageRecord } from '@/types/image'

/** Where widgets render and whether a live event stream refreshes their data. */
export interface WallpaperDataEnvironment {
  mode: 'editor' | 'runtime'
  /** True while the wallpaper event stream is connected; polling then slows to a safety net. */
  live: boolean
  /** Saved preset shown on the live page (actions such as quick run name it). */
  presetId?: string | null
}

export const WallpaperDataEnvironmentContext = createContext<WallpaperDataEnvironment>({ mode: 'editor', live: false })

export function useWallpaperDataEnvironment() {
  return useContext(WallpaperDataEnvironmentContext)
}

export const WALLPAPER_QUERY_ROOT = 'wallpaper-runtime-data'

/** Poll at `pollMs` without a live stream; with one, only a slow safety refresh. */
function useRefetchInterval(pollMs: number, liveSafetyMs = 120_000) {
  const { live } = useWallpaperDataEnvironment()
  return live ? Math.max(pollMs, liveSafetyMs) : pollMs
}

function getWallpaperPreviewImageKey(image: ImageRecord) {
  return String(
    image.composite_hash
      ?? image.id
      ?? image.original_file_path
      ?? image.image_url
      ?? image.thumbnail_url
      ?? '',
  )
}

function dedupeWallpaperPreviewImages(images: ImageRecord[]) {
  const seenKeys = new Set<string>()
  return images.filter((image) => {
    const key = getWallpaperPreviewImageKey(image)
    if (!key || seenKeys.has(key)) {
      return false
    }

    seenKeys.add(key)
    return true
  })
}

const WALLPAPER_WORKFLOW_ACTIVITY_QUERY_KEY = [WALLPAPER_QUERY_ROOT, 'workflow-activity'] as const
const workflowActivityRefreshIntervals = new Map<string, number>()
let workflowActivityRefreshTimer: ReturnType<typeof setInterval> | null = null

function syncWorkflowActivityRefreshTimer(refetch: () => void) {
  if (workflowActivityRefreshTimer) {
    clearInterval(workflowActivityRefreshTimer)
    workflowActivityRefreshTimer = null
  }

  const activeIntervals = Array.from(workflowActivityRefreshIntervals.values())
  if (activeIntervals.length === 0) {
    return
  }

  workflowActivityRefreshTimer = setInterval(refetch, Math.min(...activeIntervals))
}

/**
 * Workflow run counts shared by the queue-status and activity-pulse widgets, polled once at the shortest active
 * widget cadence. With the live stream connected, execution events refresh it and polling drops to a safety net.
 */
export function useWallpaperWorkflowActivityQuery(scope: string, refreshIntervalMs: number) {
  const queryClient = useQueryClient()
  // The execution topic needs workflows.view, so a live stream may not carry these events; keep the net fairly tight.
  const effectiveIntervalMs = useRefetchInterval(refreshIntervalMs, 30_000)

  useEffect(() => {
    workflowActivityRefreshIntervals.set(scope, effectiveIntervalMs)
    const refetch = () => {
      void queryClient.refetchQueries({ queryKey: WALLPAPER_WORKFLOW_ACTIVITY_QUERY_KEY, type: 'active' })
    }
    syncWorkflowActivityRefreshTimer(refetch)

    return () => {
      workflowActivityRefreshIntervals.delete(scope)
      syncWorkflowActivityRefreshTimer(refetch)
    }
  }, [queryClient, effectiveIntervalMs, scope])

  return useQuery({
    queryKey: WALLPAPER_WORKFLOW_ACTIVITY_QUERY_KEY,
    queryFn: getWallpaperWorkflowActivity,
    staleTime: 1_000,
    refetchInterval: false,
    placeholderData: (previous) => previous,
    retry: false,
  })
}

/**
 * A random draw from one group. With `poolRefreshMinutes` the draw is replaced on that cadence so long-running
 * wallpapers do not loop the same handful of images forever.
 */
export function useWallpaperGroupPreviewImagesQuery(scope: string, groupId: number | null, includeChildren: boolean, count: number, poolRefreshMinutes = 0) {
  const refreshMs = poolRefreshMinutes > 0 ? Math.max(1, poolRefreshMinutes) * 60_000 : false
  return useQuery({
    queryKey: [WALLPAPER_QUERY_ROOT, 'group-pool', scope, groupId, includeChildren, count],
    queryFn: async () => {
      const images = await getWallpaperRuntimeGroupPreviewImages(groupId as number, { includeChildren, count })
      return dedupeWallpaperPreviewImages(images)
    },
    enabled: groupId !== null,
    staleTime: 5 * 60_000,
    refetchInterval: refreshMs,
    refetchOnWindowFocus: false,
    placeholderData: (previous) => previous,
  })
}

export function useWallpaperQueueSnapshot(service: string) {
  const refetchInterval = useRefetchInterval(4_000, 60_000)
  return useQuery({
    queryKey: [WALLPAPER_QUERY_ROOT, 'queue', service],
    queryFn: () => getWallpaperQueueSnapshot(service),
    refetchInterval,
    placeholderData: (previous) => previous,
  })
}

export function useWallpaperGenerationHistory(limit: number, service: string, pollSeconds: number) {
  const refetchInterval = useRefetchInterval(Math.max(5, pollSeconds) * 1000)
  return useQuery({
    queryKey: [WALLPAPER_QUERY_ROOT, 'history', limit, service],
    queryFn: () => getWallpaperGenerationHistory(limit, service),
    refetchInterval,
    placeholderData: (previous) => previous,
  })
}

export function useWallpaperGenerationStats(days: number) {
  return useQuery({
    queryKey: [WALLPAPER_QUERY_ROOT, 'stats', days],
    queryFn: () => getWallpaperGenerationStats(days),
    refetchInterval: useRefetchInterval(5 * 60_000, 10 * 60_000),
    placeholderData: (previous) => previous,
  })
}

export function useWallpaperComfyStats(enabled: boolean) {
  return useQuery({
    queryKey: [WALLPAPER_QUERY_ROOT, 'comfyui-stats'],
    queryFn: getWallpaperComfyStats,
    enabled,
    refetchInterval: 4_000,
    placeholderData: (previous) => previous,
    retry: false,
  })
}

export function useWallpaperLlmUsage(days: number) {
  return useQuery({
    queryKey: [WALLPAPER_QUERY_ROOT, 'llm-usage', days],
    queryFn: () => getWallpaperLlmUsage(days),
    refetchInterval: 5 * 60_000,
    placeholderData: (previous) => previous,
    retry: false,
  })
}

export function useWallpaperLibraryStats() {
  return useQuery({
    queryKey: [WALLPAPER_QUERY_ROOT, 'library-stats'],
    queryFn: getWallpaperLibraryStats,
    refetchInterval: 10 * 60_000,
    placeholderData: (previous) => previous,
  })
}

export function useWallpaperChatProfiles() {
  return useQuery({
    queryKey: [WALLPAPER_QUERY_ROOT, 'chat-profiles'],
    queryFn: getWallpaperChatProfiles,
    staleTime: 5 * 60_000,
    refetchInterval: 15 * 60_000,
    retry: false,
  })
}

export function useWallpaperChatThreads(profileId: number | null, limit = 5) {
  return useQuery({
    queryKey: [WALLPAPER_QUERY_ROOT, 'chat-threads', profileId, limit],
    queryFn: () => getWallpaperChatThreads(profileId, limit),
    refetchInterval: 15_000,
    placeholderData: (previous) => previous,
    retry: false,
  })
}

export function useWallpaperChatMessages(threadId: number | null, limit: number, running: boolean) {
  return useQuery({
    queryKey: [WALLPAPER_QUERY_ROOT, 'chat-messages', threadId, limit],
    queryFn: () => getWallpaperChatMessages(threadId as number, limit),
    enabled: threadId !== null,
    refetchInterval: running ? 4_000 : 20_000,
    placeholderData: (previous) => previous,
    retry: false,
  })
}

export function useWallpaperAudioCandidates(groupId: string | null) {
  return useQuery({
    queryKey: [WALLPAPER_QUERY_ROOT, 'audio', groupId],
    queryFn: () => getWallpaperAudioCandidates(groupId as string),
    enabled: Boolean(groupId),
    staleTime: 10 * 60_000,
    refetchInterval: 30 * 60_000,
    retry: false,
  })
}

export function useWallpaperRecentPosts(limit: number) {
  return useQuery({
    queryKey: [WALLPAPER_QUERY_ROOT, 'posts', limit],
    queryFn: () => getWallpaperRecentPosts(limit),
    refetchInterval: useRefetchInterval(5 * 60_000, 15 * 60_000),
    placeholderData: (previous) => previous,
    retry: false,
  })
}

export function useWallpaperPromptRoll(template: string, rerollMinutes: number) {
  return useQuery({
    queryKey: [WALLPAPER_QUERY_ROOT, 'prompt-roll', template],
    queryFn: () => rollWallpaperPrompt(template),
    enabled: template.trim().length > 0,
    staleTime: Infinity,
    refetchInterval: rerollMinutes > 0 ? rerollMinutes * 60_000 : false,
    refetchOnWindowFocus: false,
    placeholderData: (previous) => previous,
    retry: false,
  })
}
