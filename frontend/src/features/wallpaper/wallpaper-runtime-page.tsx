import { useEffect, useMemo, useState } from 'react'
import { focusManager, useQuery } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ImagePermissionsContext, resolveImagePermissions } from '@/features/auth/use-image-permissions'
import { useI18n } from '@/i18n'
import { exchangeWallpaperRuntimeKey, getWallpaperRuntimeSettingsRecord } from '@/lib/api-wallpaper-runtime'
import { buildWallpaperStarterLayout, findWallpaperPresetByQuery, loadWallpaperLayoutDraft, toWallpaperLayoutPresetViewModels } from './wallpaper-layout-utils'
import { useWallpaperLiveEvents } from './use-wallpaper-live-events'
import { WallpaperStage } from './wallpaper-stage'
import { useWallpaperTheme } from './use-wallpaper-theme'
import { WallpaperDataEnvironmentContext } from './wallpaper-widget-data'
import { useWallpaperHostState } from './wallpaper-host-bridge'
import { applyWallpaperHostOverrides, resolveWallpaperHostOverrides, WALLPAPER_HOST_PRESETS_PARAM } from './wallpaper-host-package'
import { useWallpaperPlayback } from './wallpaper-playback'
import { resolveScheduledWallpaperPresetId } from '@conai/shared'
import { useWallpaperMinuteClock } from './wallpaper-schedule-utils'

/** The server checks every read; the page itself may try to show library images. */
const RUNTIME_IMAGE_PERMISSIONS = resolveImagePermissions(['images.view'], true)

type KeyState = 'none' | 'pending' | 'ok' | 'invalid'

/** A wallpaper fills the screen: no page scroll, no reserved scrollbar gutter. Returns the undo. */
function lockDocumentScroll() {
  const { style } = document.documentElement
  const previous = { overflow: style.overflow, gutter: style.scrollbarGutter }
  style.overflow = 'hidden'
  style.scrollbarGutter = 'auto'
  return () => {
    style.overflow = previous.overflow
    style.scrollbarGutter = previous.gutter
  }
}

function useLocalDraft(enabled: boolean) {
  const [draft, setDraft] = useState(() => (enabled ? loadWallpaperLayoutDraft() : null))
  useEffect(() => {
    if (!enabled) return undefined
    // The editor saves its draft on every change; follow it from the other tab.
    const onStorage = (event: StorageEvent) => {
      if (event.key?.startsWith('conai.wallpaper.layoutDraft')) setDraft(loadWallpaperLayoutDraft())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [enabled])
  return draft
}

/**
 * The live wallpaper (Lively, kiosk browsers). Outside the app shell: a `k` runtime key opens it without a login,
 * and every widget reads through `/api/wallpaper-runtime/*`.
 */
export function WallpaperRuntimePage() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const presetQuery = searchParams.get('preset')
  const isDraftPreview = searchParams.get('draft') === '1'
  const runtimeKey = searchParams.get('k')
  const [keyState, setKeyState] = useState<KeyState>(runtimeKey ? 'pending' : 'none')
  const [keyPresetId, setKeyPresetId] = useState<string | null>(null)
  const draft = useLocalDraft(isDraftPreview)
  const hostState = useWallpaperHostState()
  const hostPresetIds = useMemo(() => (searchParams.get(WALLPAPER_HOST_PRESETS_PARAM) ?? '').split(',').filter(Boolean), [searchParams])
  const hostOverrides = useMemo(() => resolveWallpaperHostOverrides(hostState.properties, hostPresetIds), [hostPresetIds, hostState.properties])
  const { hostPaused } = useWallpaperPlayback()

  // A host pausing the wallpaper (fullscreen app) leaves the page "visible"; stop polling as if it were hidden.
  useEffect(() => {
    focusManager.setFocused(hostPaused ? false : undefined)
    return () => focusManager.setFocused(undefined)
  }, [hostPaused])

  useEffect(() => {
    if (!runtimeKey) return
    let cancelled = false
    exchangeWallpaperRuntimeKey(runtimeKey)
      .then((result) => {
        if (cancelled) return
        setKeyPresetId(result.presetId)
        setKeyState('ok')
        // The session now carries the key; keep it out of the address bar and history.
        const next = new URLSearchParams(searchParams)
        next.delete('k')
        navigate({ search: next.toString() ? `?${next.toString()}` : '' }, { replace: true })
      })
      .catch(() => { if (!cancelled) setKeyState('invalid') })
    return () => { cancelled = true }
    // Only a new key is exchanged.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtimeKey])

  const settingsQuery = useQuery({
    queryKey: ['wallpaper-runtime-settings-record'],
    queryFn: getWallpaperRuntimeSettingsRecord,
    enabled: !isDraftPreview && keyState !== 'pending',
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    retry: 1,
  })

  const scheduleEnabled = settingsQuery.data?.wallpaperSchedule?.enabled === true
  const minuteClock = useWallpaperMinuteClock(scheduleEnabled && !isDraftPreview)

  // Which wallpaper: the host's pick (Lively / Wallpaper Engine property), then a ?preset link, the key's binding,
  // the schedule, the active one. The host pick goes first because package URLs carry ?preset as their default.
  const baseLayout = useMemo(() => {
    if (isDraftPreview) {
      return draft ?? buildWallpaperStarterLayout('landscape-1080p')
    }
    const settings = settingsQuery.data
    if (!settings) return null
    const presets = toWallpaperLayoutPresetViewModels(settings.wallpaperLayoutPresets)
    const byId = (id: string | null | undefined) => (id ? presets.find((preset) => preset.id === id) ?? null : null)
    const hostPick = byId(hostOverrides.presetId)
    if (hostPick) return hostPick
    if (presetQuery) return findWallpaperPresetByQuery(presets, presetQuery)
    return byId(keyPresetId ?? settings.tokenPresetId)
      ?? byId(resolveScheduledWallpaperPresetId(settings.wallpaperSchedule, minuteClock))
      ?? byId(settings.wallpaperActivePresetId)
      ?? presets[0]
      ?? null
  }, [draft, hostOverrides.presetId, isDraftPreview, keyPresetId, minuteClock, presetQuery, settingsQuery.data])
  const layout = useMemo(() => (baseLayout ? applyWallpaperHostOverrides(baseLayout, hostOverrides) : null), [baseLayout, hostOverrides])

  useEffect(() => lockDocumentScroll(), [])

  const live = useWallpaperLiveEvents(layout !== null)
  const theme = useWallpaperTheme(layout?.themeMode)

  useEffect(() => {
    if (layout?.name) document.title = layout.name
  }, [layout?.name])

  if (!layout) {
    const message = keyState === 'invalid'
      ? t({ ko: '이 키는 폐기됐거나 잘못됐어.', en: 'This key is revoked or invalid.' })
      : settingsQuery.isError
        ? t({ ko: '이 월페이퍼를 보려면 로그인하거나 키가 든 URL이 필요해.', en: 'Sign in or use a URL with a key to see this wallpaper.' })
        : settingsQuery.isLoading || keyState === 'pending'
          ? ''
          : t({ ko: '월페이퍼를 찾을 수 없어.', en: 'Wallpaper not found.' })
    return <div className="flex h-dvh w-full items-center justify-center bg-black px-6 text-center text-sm text-white/60">{message}</div>
  }

  return (
    <ImagePermissionsContext.Provider value={RUNTIME_IMAGE_PERMISSIONS}>
      <WallpaperDataEnvironmentContext.Provider value={{ mode: 'runtime', live, presetId: isDraftPreview ? null : layout.id }}>
        <div className="h-dvh w-full overflow-hidden bg-black">
          <WallpaperStage layout={layout} mode="runtime" themeClassName={theme.className} themeStyle={theme.style} />
        </div>
      </WallpaperDataEnvironmentContext.Provider>
    </ImagePermissionsContext.Provider>
  )
}
