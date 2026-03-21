import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FolderPlus, LoaderCircle, RefreshCcw, ScanSearch, Sparkles, WandSparkles } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/common/page-header'
import {
  addWatchedFolder,
  checkTaggerDependencies,
  deleteWatchedFolder,
  getAppSettings,
  getKaloscopeStatus,
  getRecentFolderScanLogs,
  getTaggerModels,
  getTaggerStatus,
  getWatchedFolders,
  getWatchersHealth,
  restartFolderWatcher,
  scanAllWatchedFolders,
  scanWatchedFolder,
  startFolderWatcher,
  stopFolderWatcher,
  updateKaloscopeSettings,
  updateMetadataSettings,
  updateTaggerSettings,
  updateWatchedFolder,
  validateWatchedFolderPath,
} from '@/lib/api'
import { cn } from '@/lib/utils'
import type { WatchedFolder, WatchedFolderUpdateInput } from '@/types/folder'
import type {
  KaloscopeSettings,
  MetadataExtractionSettings,
  TaggerDependencyCheckResult,
  TaggerSettings,
} from '@/types/settings'

type SettingsTab = 'folders' | 'metadata'

function parseJsonArray(raw: string | null) {
  if (!raw) return [] as string[]

  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : []
  } catch {
    return []
  }
}

function toCommaSeparatedInput(values: string[]) {
  return values.join(', ')
}

function parseCommaSeparatedInput(raw: string) {
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
}

function formatDateTime(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('ko-KR')
}

interface WatchedFolderCardProps {
  folder: WatchedFolder
  watcherState?: string
  onSave: (folderId: number, input: WatchedFolderUpdateInput) => Promise<void>
  onScan: (folderId: number, full?: boolean) => Promise<void>
  onStartWatcher: (folderId: number) => Promise<void>
  onStopWatcher: (folderId: number) => Promise<void>
  onRestartWatcher: (folderId: number) => Promise<void>
  onDelete: (folderId: number) => Promise<void>
}

function WatchedFolderCard({
  folder,
  watcherState,
  onSave,
  onScan,
  onStartWatcher,
  onStopWatcher,
  onRestartWatcher,
  onDelete,
}: WatchedFolderCardProps) {
  const [draft, setDraft] = useState({
    folder_name: folder.folder_name || '',
    auto_scan: folder.auto_scan === 1,
    scan_interval: folder.scan_interval,
    recursive: folder.recursive === 1,
    watcher_enabled: folder.watcher_enabled === 1,
    watcher_polling_interval: folder.watcher_polling_interval ?? 2000,
    is_active: folder.is_active === 1,
    exclude_extensions: toCommaSeparatedInput(parseJsonArray(folder.exclude_extensions)),
    exclude_patterns: toCommaSeparatedInput(parseJsonArray(folder.exclude_patterns)),
  })
  const [isBusy, setIsBusy] = useState(false)

  useEffect(() => {
    setDraft({
      folder_name: folder.folder_name || '',
      auto_scan: folder.auto_scan === 1,
      scan_interval: folder.scan_interval,
      recursive: folder.recursive === 1,
      watcher_enabled: folder.watcher_enabled === 1,
      watcher_polling_interval: folder.watcher_polling_interval ?? 2000,
      is_active: folder.is_active === 1,
      exclude_extensions: toCommaSeparatedInput(parseJsonArray(folder.exclude_extensions)),
      exclude_patterns: toCommaSeparatedInput(parseJsonArray(folder.exclude_patterns)),
    })
  }, [folder])

  const handleAction = async (action: () => Promise<void>) => {
    try {
      setIsBusy(true)
      await action()
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <Card className="bg-surface-container">
      <CardHeader>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>{folder.folder_name || '이름 없는 폴더'}</CardTitle>
              {folder.is_default === 1 ? <Badge variant="secondary">default</Badge> : null}
              <Badge variant={draft.is_active ? 'outline' : 'secondary'}>{draft.is_active ? 'active' : 'inactive'}</Badge>
              <Badge variant="outline">watcher {watcherState || 'stopped'}</Badge>
            </div>
            <CardDescription className="break-all font-mono text-xs text-muted-foreground">
              {folder.folder_path}
            </CardDescription>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={isBusy} onClick={() => handleAction(() => onScan(folder.id))}>
              스캔
            </Button>
            <Button size="sm" variant="outline" disabled={isBusy} onClick={() => handleAction(() => onStartWatcher(folder.id))}>
              watcher 시작
            </Button>
            <Button size="sm" variant="outline" disabled={isBusy} onClick={() => handleAction(() => onStopWatcher(folder.id))}>
              watcher 중지
            </Button>
            <Button size="sm" variant="outline" disabled={isBusy} onClick={() => handleAction(() => onRestartWatcher(folder.id))}>
              watcher 재시작
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="grid gap-4 lg:grid-cols-2">
          <label className="space-y-2 text-sm">
            <span className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">표시 이름</span>
            <input
              value={draft.folder_name}
              onChange={(event) => setDraft((current) => ({ ...current, folder_name: event.target.value }))}
              className="h-10 w-full rounded-sm bg-surface-lowest px-3 text-foreground outline-none focus:ring-1 focus:ring-primary"
            />
          </label>

          <label className="space-y-2 text-sm">
            <span className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">스캔 주기(분)</span>
            <input
              type="number"
              min={1}
              value={draft.scan_interval}
              onChange={(event) => setDraft((current) => ({ ...current, scan_interval: Number(event.target.value) || 1 }))}
              className="h-10 w-full rounded-sm bg-surface-lowest px-3 text-foreground outline-none focus:ring-1 focus:ring-primary"
            />
          </label>

          <label className="space-y-2 text-sm">
            <span className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">제외 확장자</span>
            <input
              value={draft.exclude_extensions}
              onChange={(event) => setDraft((current) => ({ ...current, exclude_extensions: event.target.value }))}
              placeholder="tmp, db, txt"
              className="h-10 w-full rounded-sm bg-surface-lowest px-3 text-foreground outline-none focus:ring-1 focus:ring-primary"
            />
          </label>

          <label className="space-y-2 text-sm">
            <span className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">제외 패턴</span>
            <input
              value={draft.exclude_patterns}
              onChange={(event) => setDraft((current) => ({ ...current, exclude_patterns: event.target.value }))}
              placeholder="@eaDir, thumbs, cache"
              className="h-10 w-full rounded-sm bg-surface-lowest px-3 text-foreground outline-none focus:ring-1 focus:ring-primary"
            />
          </label>

          <label className="flex items-center gap-3 rounded-sm bg-surface-low px-4 py-3 text-sm text-foreground">
            <input
              type="checkbox"
              checked={draft.auto_scan}
              onChange={(event) => setDraft((current) => ({ ...current, auto_scan: event.target.checked }))}
            />
            자동 스캔
          </label>

          <label className="flex items-center gap-3 rounded-sm bg-surface-low px-4 py-3 text-sm text-foreground">
            <input
              type="checkbox"
              checked={draft.recursive}
              onChange={(event) => setDraft((current) => ({ ...current, recursive: event.target.checked }))}
            />
            하위 폴더 포함
          </label>

          <label className="flex items-center gap-3 rounded-sm bg-surface-low px-4 py-3 text-sm text-foreground">
            <input
              type="checkbox"
              checked={draft.watcher_enabled}
              onChange={(event) => setDraft((current) => ({ ...current, watcher_enabled: event.target.checked }))}
            />
            watcher 사용
          </label>

          <label className="flex items-center gap-3 rounded-sm bg-surface-low px-4 py-3 text-sm text-foreground">
            <input
              type="checkbox"
              checked={draft.is_active}
              onChange={(event) => setDraft((current) => ({ ...current, is_active: event.target.checked }))}
            />
            폴더 활성화
          </label>
        </div>

        <div className="flex flex-col gap-2 text-xs text-muted-foreground">
          <span>최근 스캔: {formatDateTime(folder.last_scan_date)}</span>
          <span>최근 상태: {folder.last_scan_status || '—'}</span>
          <span>최근 신규 이미지: {folder.last_scan_found.toLocaleString('ko-KR')}</span>
        </div>

        <div className="flex flex-wrap justify-between gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={isBusy || folder.is_default === 1}
            onClick={() => {
              if (!window.confirm(`정말 ${folder.folder_name || folder.folder_path} 폴더를 삭제할까?`)) {
                return
              }
              void handleAction(() => onDelete(folder.id))
            }}
          >
            폴더 제거
          </Button>

          <Button
            size="sm"
            disabled={isBusy}
            onClick={() =>
              void handleAction(() =>
                onSave(folder.id, {
                  folder_name: draft.folder_name,
                  auto_scan: draft.auto_scan,
                  scan_interval: draft.scan_interval,
                  recursive: draft.recursive,
                  watcher_enabled: draft.watcher_enabled,
                  watcher_polling_interval: draft.watcher_enabled ? draft.watcher_polling_interval : null,
                  exclude_extensions: parseCommaSeparatedInput(draft.exclude_extensions),
                  exclude_patterns: parseCommaSeparatedInput(draft.exclude_patterns),
                  is_active: draft.is_active,
                }),
              )
            }
          >
            {isBusy ? '처리 중…' : '폴더 설정 저장'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export function SettingsPage() {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<SettingsTab>('folders')
  const [notice, setNotice] = useState<string | null>(null)
  const [noticeTone, setNoticeTone] = useState<'info' | 'error'>('info')
  const [newFolder, setNewFolder] = useState({
    folder_path: '',
    folder_name: '',
    auto_scan: true,
    scan_interval: 5,
    recursive: true,
    watcher_enabled: true,
    watcher_polling_interval: 2000,
    exclude_extensions: '',
    exclude_patterns: '',
  })
  const [pathValidationMessage, setPathValidationMessage] = useState<string | null>(null)
  const [metadataDraft, setMetadataDraft] = useState<MetadataExtractionSettings | null>(null)
  const [taggerDraft, setTaggerDraft] = useState<TaggerSettings | null>(null)
  const [kaloscopeDraft, setKaloscopeDraft] = useState<KaloscopeSettings | null>(null)
  const [taggerDependencyResult, setTaggerDependencyResult] = useState<TaggerDependencyCheckResult | null>(null)

  const settingsQuery = useQuery({
    queryKey: ['app-settings'],
    queryFn: getAppSettings,
  })
  const foldersQuery = useQuery({
    queryKey: ['watched-folders'],
    queryFn: () => getWatchedFolders(false),
  })
  const scanLogsQuery = useQuery({
    queryKey: ['folder-scan-logs'],
    queryFn: () => getRecentFolderScanLogs(20),
  })
  const watchersHealthQuery = useQuery({
    queryKey: ['watchers-health'],
    queryFn: getWatchersHealth,
  })
  const taggerModelsQuery = useQuery({
    queryKey: ['tagger-models'],
    queryFn: getTaggerModels,
  })
  const taggerStatusQuery = useQuery({
    queryKey: ['tagger-status'],
    queryFn: getTaggerStatus,
  })
  const kaloscopeStatusQuery = useQuery({
    queryKey: ['kaloscope-status'],
    queryFn: getKaloscopeStatus,
  })

  const effectiveMetadataDraft = metadataDraft ?? settingsQuery.data?.metadataExtraction ?? null
  const effectiveTaggerDraft = taggerDraft ?? settingsQuery.data?.tagger ?? null
  const effectiveKaloscopeDraft = kaloscopeDraft ?? settingsQuery.data?.kaloscope ?? null

  const updateMetadataDraftField = <K extends keyof MetadataExtractionSettings>(
    key: K,
    value: MetadataExtractionSettings[K],
  ) => {
    setMetadataDraft({ ...(effectiveMetadataDraft as MetadataExtractionSettings), [key]: value })
  }

  const updateTaggerDraftField = <K extends keyof TaggerSettings>(key: K, value: TaggerSettings[K]) => {
    setTaggerDraft({ ...(effectiveTaggerDraft as TaggerSettings), [key]: value })
  }

  const updateKaloscopeDraftField = <K extends keyof KaloscopeSettings>(
    key: K,
    value: KaloscopeSettings[K],
  ) => {
    setKaloscopeDraft({ ...(effectiveKaloscopeDraft as KaloscopeSettings), [key]: value })
  }

  const folderWatcherMap = useMemo(() => {
    const map = new Map<number, string>()
    for (const watcher of watchersHealthQuery.data?.watchers ?? []) {
      map.set(watcher.folderId, watcher.state)
    }
    return map
  }, [watchersHealthQuery.data?.watchers])

  const syncSettingsCache = (nextSettings: Awaited<ReturnType<typeof getAppSettings>>) => {
    queryClient.setQueryData(['app-settings'], nextSettings)
  }

  const refreshFolderQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['watched-folders'] }),
      queryClient.invalidateQueries({ queryKey: ['folder-scan-logs'] }),
      queryClient.invalidateQueries({ queryKey: ['watchers-health'] }),
    ])
  }

  const addFolderMutation = useMutation({
    mutationFn: addWatchedFolder,
    onSuccess: async () => {
      setNoticeTone('info')
      setNotice('감시 폴더를 추가했어.')
      setNewFolder({
        folder_path: '',
        folder_name: '',
        auto_scan: true,
        scan_interval: 5,
        recursive: true,
        watcher_enabled: true,
        watcher_polling_interval: 2000,
        exclude_extensions: '',
        exclude_patterns: '',
      })
      setPathValidationMessage(null)
      await refreshFolderQueries()
    },
    onError: (error) => {
      setNoticeTone('error')
      setNotice(error instanceof Error ? error.message : '감시 폴더 추가에 실패했어.')
    },
  })

  const validatePathMutation = useMutation({
    mutationFn: validateWatchedFolderPath,
    onSuccess: (data) => {
      setPathValidationMessage(data.message)
      setNoticeTone('info')
      setNotice('폴더 경로가 유효해.')
    },
    onError: (error) => {
      setPathValidationMessage(null)
      setNoticeTone('error')
      setNotice(error instanceof Error ? error.message : '폴더 경로 검증에 실패했어.')
    },
  })

  const metadataMutation = useMutation({
    mutationFn: updateMetadataSettings,
    onSuccess: (settings) => {
      syncSettingsCache(settings)
      setNoticeTone('info')
      setNotice('메타데이터 추출 설정을 저장했어.')
    },
    onError: (error) => {
      setNoticeTone('error')
      setNotice(error instanceof Error ? error.message : '메타데이터 설정 저장에 실패했어.')
    },
  })

  const taggerMutation = useMutation({
    mutationFn: updateTaggerSettings,
    onSuccess: async (settings) => {
      syncSettingsCache(settings)
      await queryClient.invalidateQueries({ queryKey: ['tagger-status'] })
      setNoticeTone('info')
      setNotice('프롬프트 추출 태거 설정을 저장했어.')
    },
    onError: (error) => {
      setNoticeTone('error')
      setNotice(error instanceof Error ? error.message : '태거 설정 저장에 실패했어.')
    },
  })

  const kaloscopeMutation = useMutation({
    mutationFn: updateKaloscopeSettings,
    onSuccess: async (settings) => {
      syncSettingsCache(settings)
      await queryClient.invalidateQueries({ queryKey: ['kaloscope-status'] })
      setNoticeTone('info')
      setNotice('자동 프롬프트 추출 설정을 저장했어.')
    },
    onError: (error) => {
      setNoticeTone('error')
      setNotice(error instanceof Error ? error.message : 'Kaloscope 설정 저장에 실패했어.')
    },
  })

  const taggerDependencyMutation = useMutation({
    mutationFn: checkTaggerDependencies,
    onSuccess: (result) => {
      setTaggerDependencyResult(result)
      setNoticeTone(result.available ? 'info' : 'error')
      setNotice(result.message)
    },
    onError: (error) => {
      setNoticeTone('error')
      setNotice(error instanceof Error ? error.message : '태거 의존성 확인에 실패했어.')
    },
  })

  const handleFolderSave = async (folderId: number, input: WatchedFolderUpdateInput) => {
    await updateWatchedFolder(folderId, input)
    setNoticeTone('info')
    setNotice('감시 폴더 설정을 저장했어.')
    await refreshFolderQueries()
  }

  const handleFolderDelete = async (folderId: number) => {
    await deleteWatchedFolder(folderId)
    setNoticeTone('info')
    setNotice('감시 폴더를 제거했어.')
    await refreshFolderQueries()
  }

  const handleFolderScan = async (folderId: number, full = false) => {
    await scanWatchedFolder(folderId, full)
    setNoticeTone('info')
    setNotice(full ? '전체 재스캔을 시작했어.' : '폴더 스캔을 시작했어.')
    await refreshFolderQueries()
  }

  const handleScanAllFolders = async () => {
    try {
      const summary = await scanAllWatchedFolders()
      setNoticeTone('info')
      setNotice(
        `전체 스캔 완료: 폴더 ${summary.totalFolders}개, 신규 ${summary.totalNew}개, 기존 ${summary.totalExisting}개`,
      )
      await refreshFolderQueries()
    } catch (error) {
      setNoticeTone('error')
      setNotice(error instanceof Error ? error.message : '전체 스캔에 실패했어.')
    }
  }

  const handleWatcherAction = async (folderId: number, action: 'start' | 'stop' | 'restart') => {
    try {
      if (action === 'start') {
        await startFolderWatcher(folderId)
      } else if (action === 'stop') {
        await stopFolderWatcher(folderId)
      } else {
        await restartFolderWatcher(folderId)
      }
      setNoticeTone('info')
      setNotice(`watcher를 ${action === 'start' ? '시작' : action === 'stop' ? '중지' : '재시작'}했어.`)
      await refreshFolderQueries()
    } catch (error) {
      setNoticeTone('error')
      setNotice(error instanceof Error ? error.message : 'watcher 제어에 실패했어.')
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Settings"
        title="운영 설정"
        description="감시 폴더를 중심으로 실제 운영 로직을 우선 복구하고, 그다음 프롬프트 추출/자동 추출 설정을 안정적으로 관리한다."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant={activeTab === 'folders' ? 'default' : 'outline'} onClick={() => setActiveTab('folders')}>
              Watch Folders
            </Button>
            <Button size="sm" variant={activeTab === 'metadata' ? 'default' : 'outline'} onClick={() => setActiveTab('metadata')}>
              Prompt & Metadata
            </Button>
          </div>
        }
      />

      {notice ? (
        <Alert variant={noticeTone === 'error' ? 'destructive' : 'default'}>
          <AlertTitle>{noticeTone === 'error' ? '문제가 생겼어' : '상태 업데이트'}</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      {activeTab === 'folders' ? (
        <div className="space-y-8">
          <Card className="bg-surface-container">
            <CardHeader>
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <CardTitle>감시 폴더 운영</CardTitle>
                  <CardDescription>
                    이미지 추가·제거·갱신의 시작점이 되는 폴더 감시 로직을 여기서 바로 관리한다.
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => void refreshFolderQueries()}>
                    <RefreshCcw className="h-4 w-4" />
                    새로고침
                  </Button>
                  <Button size="sm" onClick={() => void handleScanAllFolders()}>
                    <ScanSearch className="h-4 w-4" />
                    전체 스캔
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-5 text-sm">
              <div className="rounded-sm bg-surface-low px-4 py-3">
                <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">folders</div>
                <div className="mt-2 text-xl font-semibold text-foreground">{foldersQuery.data?.length ?? 0}</div>
              </div>
              <div className="rounded-sm bg-surface-low px-4 py-3">
                <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">watching</div>
                <div className="mt-2 text-xl font-semibold text-foreground">{watchersHealthQuery.data?.watching ?? 0}</div>
              </div>
              <div className="rounded-sm bg-surface-low px-4 py-3">
                <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">errors</div>
                <div className="mt-2 text-xl font-semibold text-foreground">{watchersHealthQuery.data?.error ?? 0}</div>
              </div>
              <div className="rounded-sm bg-surface-low px-4 py-3">
                <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">events 24h</div>
                <div className="mt-2 text-xl font-semibold text-foreground">{watchersHealthQuery.data?.totalEvents24h ?? 0}</div>
              </div>
              <div className="rounded-sm bg-surface-low px-4 py-3">
                <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">latest scan log</div>
                <div className="mt-2 text-sm font-semibold text-foreground">{scanLogsQuery.data?.[0]?.folder_name ?? '—'}</div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-surface-container">
            <CardHeader>
              <CardTitle>새 감시 폴더 추가</CardTitle>
              <CardDescription>경로 검증 후 바로 watcher/자동 스캔까지 같이 세팅할 수 있게 만든다.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-4 lg:grid-cols-2">
                <label className="space-y-2 text-sm">
                  <span className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">폴더 경로</span>
                  <input
                    value={newFolder.folder_path}
                    onChange={(event) => setNewFolder((current) => ({ ...current, folder_path: event.target.value }))}
                    placeholder="D:\\Images\\Incoming"
                    className="h-10 w-full rounded-sm bg-surface-lowest px-3 text-foreground outline-none focus:ring-1 focus:ring-primary"
                  />
                </label>

                <label className="space-y-2 text-sm">
                  <span className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">표시 이름</span>
                  <input
                    value={newFolder.folder_name}
                    onChange={(event) => setNewFolder((current) => ({ ...current, folder_name: event.target.value }))}
                    placeholder="Incoming"
                    className="h-10 w-full rounded-sm bg-surface-lowest px-3 text-foreground outline-none focus:ring-1 focus:ring-primary"
                  />
                </label>

                <label className="space-y-2 text-sm">
                  <span className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">스캔 주기(분)</span>
                  <input
                    type="number"
                    min={1}
                    value={newFolder.scan_interval}
                    onChange={(event) =>
                      setNewFolder((current) => ({ ...current, scan_interval: Number(event.target.value) || 1 }))
                    }
                    className="h-10 w-full rounded-sm bg-surface-lowest px-3 text-foreground outline-none focus:ring-1 focus:ring-primary"
                  />
                </label>

                <label className="space-y-2 text-sm">
                  <span className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">watcher polling(ms)</span>
                  <input
                    type="number"
                    min={100}
                    value={newFolder.watcher_polling_interval}
                    onChange={(event) =>
                      setNewFolder((current) => ({
                        ...current,
                        watcher_polling_interval: Number(event.target.value) || 100,
                      }))
                    }
                    className="h-10 w-full rounded-sm bg-surface-lowest px-3 text-foreground outline-none focus:ring-1 focus:ring-primary"
                  />
                </label>

                <label className="space-y-2 text-sm">
                  <span className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">제외 확장자</span>
                  <input
                    value={newFolder.exclude_extensions}
                    onChange={(event) =>
                      setNewFolder((current) => ({ ...current, exclude_extensions: event.target.value }))
                    }
                    placeholder="tmp, db"
                    className="h-10 w-full rounded-sm bg-surface-lowest px-3 text-foreground outline-none focus:ring-1 focus:ring-primary"
                  />
                </label>

                <label className="space-y-2 text-sm">
                  <span className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">제외 패턴</span>
                  <input
                    value={newFolder.exclude_patterns}
                    onChange={(event) =>
                      setNewFolder((current) => ({ ...current, exclude_patterns: event.target.value }))
                    }
                    placeholder="@eaDir, cache"
                    className="h-10 w-full rounded-sm bg-surface-lowest px-3 text-foreground outline-none focus:ring-1 focus:ring-primary"
                  />
                </label>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <label className="flex items-center gap-3 rounded-sm bg-surface-low px-4 py-3 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={newFolder.auto_scan}
                    onChange={(event) => setNewFolder((current) => ({ ...current, auto_scan: event.target.checked }))}
                  />
                  자동 스캔
                </label>
                <label className="flex items-center gap-3 rounded-sm bg-surface-low px-4 py-3 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={newFolder.recursive}
                    onChange={(event) => setNewFolder((current) => ({ ...current, recursive: event.target.checked }))}
                  />
                  하위 폴더 포함
                </label>
                <label className="flex items-center gap-3 rounded-sm bg-surface-low px-4 py-3 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={newFolder.watcher_enabled}
                    onChange={(event) => setNewFolder((current) => ({ ...current, watcher_enabled: event.target.checked }))}
                  />
                  watcher 시작
                </label>
              </div>

              {pathValidationMessage ? <p className="text-sm text-primary">{pathValidationMessage}</p> : null}

              <div className="flex flex-wrap justify-between gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={validatePathMutation.isPending || !newFolder.folder_path.trim()}
                  onClick={() => void validatePathMutation.mutateAsync(newFolder.folder_path)}
                >
                  {validatePathMutation.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
                  경로 검증
                </Button>

                <Button
                  size="sm"
                  disabled={addFolderMutation.isPending || !newFolder.folder_path.trim()}
                  onClick={() =>
                    void addFolderMutation.mutateAsync({
                      folder_path: newFolder.folder_path,
                      folder_name: newFolder.folder_name || undefined,
                      auto_scan: newFolder.auto_scan,
                      scan_interval: newFolder.scan_interval,
                      recursive: newFolder.recursive,
                      watcher_enabled: newFolder.watcher_enabled,
                      watcher_polling_interval: newFolder.watcher_polling_interval,
                      exclude_extensions: parseCommaSeparatedInput(newFolder.exclude_extensions),
                      exclude_patterns: parseCommaSeparatedInput(newFolder.exclude_patterns),
                    })
                  }
                >
                  <FolderPlus className="h-4 w-4" />
                  감시 폴더 추가
                </Button>
              </div>
            </CardContent>
          </Card>

          <section className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xl font-semibold tracking-tight text-foreground">등록된 감시 폴더</h2>
              <Badge variant="outline">{foldersQuery.data?.length ?? 0}</Badge>
            </div>

            {foldersQuery.isLoading ? (
              <div className="space-y-4">
                {Array.from({ length: 3 }).map((_, index) => (
                  <Skeleton key={index} className="h-48 w-full rounded-sm" />
                ))}
              </div>
            ) : null}

            {foldersQuery.isError ? (
              <Alert variant="destructive">
                <AlertTitle>감시 폴더를 불러오지 못했어</AlertTitle>
                <AlertDescription>
                  {foldersQuery.error instanceof Error ? foldersQuery.error.message : '알 수 없는 오류가 발생했어.'}
                </AlertDescription>
              </Alert>
            ) : null}

            {!foldersQuery.isLoading && !foldersQuery.isError
              ? (foldersQuery.data ?? []).map((folder) => (
                  <WatchedFolderCard
                    key={folder.id}
                    folder={folder}
                    watcherState={folderWatcherMap.get(folder.id)}
                    onSave={handleFolderSave}
                    onScan={handleFolderScan}
                    onStartWatcher={(folderId) => handleWatcherAction(folderId, 'start')}
                    onStopWatcher={(folderId) => handleWatcherAction(folderId, 'stop')}
                    onRestartWatcher={(folderId) => handleWatcherAction(folderId, 'restart')}
                    onDelete={handleFolderDelete}
                  />
                ))
              : null}
          </section>

          <Card className="bg-surface-container">
            <CardHeader>
              <CardTitle>최근 스캔 로그</CardTitle>
              <CardDescription>감시 폴더 전체 기준의 최근 작업 흐름이야.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {scanLogsQuery.isLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 5 }).map((_, index) => (
                    <Skeleton key={index} className="h-14 w-full rounded-sm" />
                  ))}
                </div>
              ) : null}

              {!scanLogsQuery.isLoading && (scanLogsQuery.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">아직 최근 스캔 로그가 없어.</p>
              ) : null}

              {(scanLogsQuery.data ?? []).map((log) => (
                <div key={log.id} className="rounded-sm bg-surface-low px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-medium text-foreground">{log.folder_name || `Folder #${log.folder_id}`}</div>
                    <div className="text-xs text-muted-foreground">{formatDateTime(log.scan_date)}</div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>status {log.status}</span>
                    <span>scanned {log.total_scanned}</span>
                    <span>new {log.new_images}</span>
                    <span>existing {log.existing_images}</span>
                    <span>errors {log.error_count}</span>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {activeTab === 'metadata' ? (
        <div className="space-y-8">
          <Card className="bg-surface-container">
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle>메타데이터 / 프롬프트 추출</CardTitle>
                  <CardDescription>프롬프트 추출과 자동 태깅 흐름에 직접 영향을 주는 설정만 먼저 정리한다.</CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">models {taggerModelsQuery.data?.length ?? 0}</Badge>
                  <Badge variant="outline">daemon {taggerStatusQuery.data?.isRunning ? 'running' : 'idle'}</Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-3">
              <div className="rounded-sm bg-surface-low px-4 py-3">
                <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">loaded model</div>
                <div className="mt-2 text-sm font-semibold text-foreground">{taggerStatusQuery.data?.currentModel ?? '—'}</div>
              </div>
              <div className="rounded-sm bg-surface-low px-4 py-3">
                <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">current device</div>
                <div className="mt-2 text-sm font-semibold text-foreground">{taggerStatusQuery.data?.currentDevice ?? '—'}</div>
              </div>
              <div className="rounded-sm bg-surface-low px-4 py-3">
                <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">kaloscope</div>
                <div className="mt-2 text-sm font-semibold text-foreground">{kaloscopeStatusQuery.data?.statusMessage ?? '—'}</div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-surface-container">
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle>Secondary / Stealth Extraction</CardTitle>
                  <CardDescription>이미지 메타데이터와 숨겨진 프롬프트 추출 강도를 조절한다.</CardDescription>
                </div>
                <Button
                  size="sm"
                  onClick={() => metadataDraft && void metadataMutation.mutateAsync(metadataDraft)}
                  disabled={!metadataDraft || metadataMutation.isPending}
                >
                  <Sparkles className="h-4 w-4" />
                  저장
                </Button>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              {metadataDraft ? (
                <>
                  <label className="flex items-center gap-3 rounded-sm bg-surface-low px-4 py-3 text-sm text-foreground md:col-span-2">
                    <input
                      type="checkbox"
                      checked={metadataDraft.enableSecondaryExtraction}
                      onChange={(event) =>
                        setMetadataDraft((current) =>
                          current ? { ...current, enableSecondaryExtraction: event.target.checked } : current,
                        )
                      }
                    />
                    Secondary extraction 활성화
                  </label>

                  <label className="space-y-2 text-sm">
                    <span className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">Stealth scan mode</span>
                    <select
                      value={metadataDraft.stealthScanMode}
                      onChange={(event) =>
                        setMetadataDraft((current) =>
                          current ? { ...current, stealthScanMode: event.target.value as MetadataExtractionSettings['stealthScanMode'] } : current,
                        )
                      }
                      className="h-10 w-full rounded-sm bg-surface-lowest px-3 text-foreground outline-none focus:ring-1 focus:ring-primary"
                    >
                      <option value="fast">fast</option>
                      <option value="full">full</option>
                      <option value="skip">skip</option>
                    </select>
                  </label>

                  <label className="space-y-2 text-sm">
                    <span className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">최대 파일 크기(MB)</span>
                    <input
                      type="number"
                      min={1}
                      value={metadataDraft.stealthMaxFileSizeMB}
                      onChange={(event) =>
                        setMetadataDraft((current) =>
                          current ? { ...current, stealthMaxFileSizeMB: Number(event.target.value) || 1 } : current,
                        )
                      }
                      className="h-10 w-full rounded-sm bg-surface-lowest px-3 text-foreground outline-none focus:ring-1 focus:ring-primary"
                    />
                  </label>

                  <label className="space-y-2 text-sm">
                    <span className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">최대 해상도(MP)</span>
                    <input
                      type="number"
                      min={1}
                      value={metadataDraft.stealthMaxResolutionMP}
                      onChange={(event) =>
                        setMetadataDraft((current) =>
                          current ? { ...current, stealthMaxResolutionMP: Number(event.target.value) || 1 } : current,
                        )
                      }
                      className="h-10 w-full rounded-sm bg-surface-lowest px-3 text-foreground outline-none focus:ring-1 focus:ring-primary"
                    />
                  </label>

                  <label className="flex items-center gap-3 rounded-sm bg-surface-low px-4 py-3 text-sm text-foreground">
                    <input
                      type="checkbox"
                      checked={metadataDraft.skipStealthForComfyUI}
                      onChange={(event) =>
                        setMetadataDraft((current) =>
                          current ? { ...current, skipStealthForComfyUI: event.target.checked } : current,
                        )
                      }
                    />
                    ComfyUI 스킵
                  </label>

                  <label className="flex items-center gap-3 rounded-sm bg-surface-low px-4 py-3 text-sm text-foreground">
                    <input
                      type="checkbox"
                      checked={effectiveMetadataDraft!.skipStealthForWebUI}
                      onChange={(event) => updateMetadataDraftField('skipStealthForWebUI', event.target.checked)}
                    />
                    WebUI 스킵
                  </label>
                </>
              ) : (
                <Skeleton className="h-48 w-full rounded-sm md:col-span-2" />
              )}
            </CardContent>
          </Card>

          <Card className="bg-surface-container">
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle>Prompt Extraction (WD Tagger)</CardTitle>
                  <CardDescription>자동 프롬프트/태그 추출의 핵심 모델과 임계값을 조정한다.</CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => void taggerDependencyMutation.mutateAsync()}>
                    의존성 확인
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => taggerDraft && void taggerMutation.mutateAsync(taggerDraft)}
                    disabled={!taggerDraft || taggerMutation.isPending}
                  >
                    저장
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              {taggerDraft ? (
                <>
                  <label className="flex items-center gap-3 rounded-sm bg-surface-low px-4 py-3 text-sm text-foreground md:col-span-2">
                    <input
                      type="checkbox"
                      checked={taggerDraft.enabled}
                      onChange={(event) =>
                        setTaggerDraft((current) => (current ? { ...current, enabled: event.target.checked } : current))
                      }
                    />
                    WD Tagger 활성화
                  </label>

                  <label className="flex items-center gap-3 rounded-sm bg-surface-low px-4 py-3 text-sm text-foreground md:col-span-2">
                    <input
                      type="checkbox"
                      checked={taggerDraft.autoTagOnUpload}
                      onChange={(event) =>
                        setTaggerDraft((current) =>
                          current ? { ...current, autoTagOnUpload: event.target.checked } : current,
                        )
                      }
                    />
                    업로드 시 자동 태깅
                  </label>

                  <label className="space-y-2 text-sm">
                    <span className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">모델</span>
                    <select
                      value={taggerDraft.model}
                      onChange={(event) =>
                        setTaggerDraft((current) =>
                          current ? { ...current, model: event.target.value as TaggerSettings['model'] } : current,
                        )
                      }
                      className="h-10 w-full rounded-sm bg-surface-lowest px-3 text-foreground outline-none focus:ring-1 focus:ring-primary"
                    >
                      {(taggerModelsQuery.data ?? []).map((model) => (
                        <option key={model.name} value={model.name}>
                          {model.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="space-y-2 text-sm">
                    <span className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">디바이스</span>
                    <select
                      value={taggerDraft.device}
                      onChange={(event) =>
                        setTaggerDraft((current) =>
                          current ? { ...current, device: event.target.value as TaggerSettings['device'] } : current,
                        )
                      }
                      className="h-10 w-full rounded-sm bg-surface-lowest px-3 text-foreground outline-none focus:ring-1 focus:ring-primary"
                    >
                      <option value="auto">auto</option>
                      <option value="cpu">cpu</option>
                      <option value="cuda">cuda</option>
                    </select>
                  </label>

                  <label className="space-y-2 text-sm">
                    <span className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">General threshold</span>
                    <input
                      type="number"
                      min={0}
                      max={1}
                      step={0.01}
                      value={taggerDraft.generalThreshold}
                      onChange={(event) =>
                        setTaggerDraft((current) =>
                          current ? { ...current, generalThreshold: Number(event.target.value) || 0 } : current,
                        )
                      }
                      className="h-10 w-full rounded-sm bg-surface-lowest px-3 text-foreground outline-none focus:ring-1 focus:ring-primary"
                    />
                  </label>

                  <label className="space-y-2 text-sm">
                    <span className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">Character threshold</span>
                    <input
                      type="number"
                      min={0}
                      max={1}
                      step={0.01}
                      value={taggerDraft.characterThreshold}
                      onChange={(event) =>
                        setTaggerDraft((current) =>
                          current ? { ...current, characterThreshold: Number(event.target.value) || 0 } : current,
                        )
                      }
                      className="h-10 w-full rounded-sm bg-surface-lowest px-3 text-foreground outline-none focus:ring-1 focus:ring-primary"
                    />
                  </label>

                  <label className="space-y-2 text-sm md:col-span-2">
                    <span className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">Python path</span>
                    <input
                      value={taggerDraft.pythonPath}
                      onChange={(event) =>
                        setTaggerDraft((current) =>
                          current ? { ...current, pythonPath: event.target.value } : current,
                        )
                      }
                      className="h-10 w-full rounded-sm bg-surface-lowest px-3 text-foreground outline-none focus:ring-1 focus:ring-primary"
                    />
                  </label>

                  <label className="flex items-center gap-3 rounded-sm bg-surface-low px-4 py-3 text-sm text-foreground">
                    <input
                      type="checkbox"
                      checked={taggerDraft.keepModelLoaded}
                      onChange={(event) =>
                        setTaggerDraft((current) =>
                          current ? { ...current, keepModelLoaded: event.target.checked } : current,
                        )
                      }
                    />
                    모델 메모리 유지
                  </label>

                  <label className="space-y-2 text-sm">
                    <span className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">자동 언로드(분)</span>
                    <input
                      type="number"
                      min={1}
                      value={effectiveTaggerDraft!.autoUnloadMinutes}
                      onChange={(event) => updateTaggerDraftField('autoUnloadMinutes', Number(event.target.value) || 1)}
                      className="h-10 w-full rounded-sm bg-surface-lowest px-3 text-foreground outline-none focus:ring-1 focus:ring-primary"
                    />
                  </label>
                </>
              ) : (
                <Skeleton className="h-48 w-full rounded-sm md:col-span-2" />
              )}

              {taggerDependencyResult ? (
                <div className={cn('rounded-sm px-4 py-3 text-sm md:col-span-2', taggerDependencyResult.available ? 'bg-surface-low text-foreground' : 'bg-destructive/12 text-destructive')}>
                  {taggerDependencyResult.message}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card className="bg-surface-container">
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle>Auto Prompt Extraction (Kaloscope)</CardTitle>
                  <CardDescription>아티스트/스타일 성격의 자동 추출을 별도로 조정한다.</CardDescription>
                </div>
                <Button
                  size="sm"
                  onClick={() => kaloscopeDraft && void kaloscopeMutation.mutateAsync(kaloscopeDraft)}
                  disabled={!kaloscopeDraft || kaloscopeMutation.isPending}
                >
                  <WandSparkles className="h-4 w-4" />
                  저장
                </Button>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              {kaloscopeDraft ? (
                <>
                  <label className="flex items-center gap-3 rounded-sm bg-surface-low px-4 py-3 text-sm text-foreground md:col-span-2">
                    <input
                      type="checkbox"
                      checked={kaloscopeDraft.enabled}
                      onChange={(event) =>
                        setKaloscopeDraft((current) =>
                          current ? { ...current, enabled: event.target.checked } : current,
                        )
                      }
                    />
                    Kaloscope 활성화
                  </label>

                  <label className="flex items-center gap-3 rounded-sm bg-surface-low px-4 py-3 text-sm text-foreground md:col-span-2">
                    <input
                      type="checkbox"
                      checked={kaloscopeDraft.autoTagOnUpload}
                      onChange={(event) =>
                        setKaloscopeDraft((current) =>
                          current ? { ...current, autoTagOnUpload: event.target.checked } : current,
                        )
                      }
                    />
                    업로드/스케줄러 자동 처리
                  </label>

                  <label className="space-y-2 text-sm">
                    <span className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">디바이스</span>
                    <select
                      value={kaloscopeDraft.device}
                      onChange={(event) =>
                        setKaloscopeDraft((current) =>
                          current ? { ...current, device: event.target.value as KaloscopeSettings['device'] } : current,
                        )
                      }
                      className="h-10 w-full rounded-sm bg-surface-lowest px-3 text-foreground outline-none focus:ring-1 focus:ring-primary"
                    >
                      <option value="auto">auto</option>
                      <option value="cpu">cpu</option>
                      <option value="cuda">cuda</option>
                    </select>
                  </label>

                  <label className="space-y-2 text-sm">
                    <span className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">Top K</span>
                    <input
                      type="number"
                      min={1}
                      max={200}
                      value={effectiveKaloscopeDraft!.topK}
                      onChange={(event) => updateKaloscopeDraftField('topK', Number(event.target.value) || 1)}
                      className="h-10 w-full rounded-sm bg-surface-lowest px-3 text-foreground outline-none focus:ring-1 focus:ring-primary"
                    />
                  </label>
                </>
              ) : (
                <Skeleton className="h-40 w-full rounded-sm md:col-span-2" />
              )}

              {kaloscopeStatusQuery.data ? (
                <div className="rounded-sm bg-surface-low px-4 py-3 text-sm text-muted-foreground md:col-span-2">
                  <div className="font-medium text-foreground">{kaloscopeStatusQuery.data.statusMessage}</div>
                  <div className="mt-2 flex flex-wrap gap-3 text-xs">
                    <span>cached {String(kaloscopeStatusQuery.data.modelCached)}</span>
                    <span>deps {String(kaloscopeStatusQuery.data.dependenciesAvailable)}</span>
                    <span>device {kaloscopeStatusQuery.data.currentDevice}</span>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  )
}
