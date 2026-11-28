import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Image as ImageIcon, LayoutGrid } from 'lucide-react'
import { SegmentedControl } from '@/components/common/segmented-control'
import { CountBadge } from '@/components/ui/count-badge'
import { IconButton } from '@/components/ui/icon-button'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { ImagePermissionNotice } from '@/features/images/components/image-permission-notice'
import { useImageFeedSafety } from '@/features/images/components/image-list/use-image-feed-safety'
import { useI18n } from '@/i18n'
import type { GenerationServiceType } from '@/lib/api-image-generation-types'
import { getRuntimeGenerationHistorySettings } from '@/lib/api-settings'
import { cn } from '@/lib/utils'
import { mapHistoryRecordToImageRecord } from './generation-history-panel-helpers'
import { GenerationHistoryPanelView } from './generation-history-panel'
import { GenerationLogPanel, getGenerationLogStatus, type GenerationLogStatus } from './generation-log-panel'
import { GenerationResultStage } from './generation-result-stage'
import type { GenerationHistoryFeed } from './use-generation-history-feed'
import { useGenerationStageQueue } from './use-generation-stage-queue'

type ResultTab = 'viewer' | 'log'
type ViewerMode = 'stage' | 'grid'

const RESULT_TAB_STORAGE_KEY = 'conai:image-generation:result-tab:v1'
const VIEWER_MODE_STORAGE_KEY = 'conai:image-generation:viewer-mode:v1'
const SEEN_FAILURE_STORAGE_PREFIX = 'conai:image-generation:log-seen-failure:v1:'

function readStored(key: string) {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStored(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Storage blocked: the choice still holds for this visit.
  }
}

/** A choice that survives reloads and leaving the page. */
function useStoredChoice<T extends string>(key: string, values: readonly T[]) {
  const [value, setValue] = useState<T>(() => {
    const stored = readStored(key)
    return values.find((candidate) => candidate === stored) ?? values[0]
  })
  const change = useCallback((next: T) => {
    setValue(next)
    writeStored(key, next)
  }, [key])
  return [value, change] as const
}

const RESULT_TABS = ['viewer', 'log'] as const
const VIEWER_MODES = ['stage', 'grid'] as const

type GenerationResultAreaProps = {
  feed: GenerationHistoryFeed
  serviceType: GenerationServiceType
  workflowId?: number | null
  /** Public workflow page: history actions use the public routes. */
  publicWorkflowSlug?: string | null
  splitPaneScroll?: boolean
  /** Narrow layout: shorter stage. */
  compact?: boolean
  onBack?: () => void
  /** Recent-results filmstrip placement from the layout preset. */
  recentStrip?: 'top' | 'bottom' | 'hidden'
}

/**
 * Result column of the generation page over one shared feed: the viewer (large result or image grid) and the log.
 * A new failure of mine raises a snackbar and a dot on the log tab until the log is opened.
 */
export function GenerationResultArea({
  feed,
  serviceType,
  workflowId,
  publicWorkflowSlug,
  splitPaneScroll = false,
  compact = false,
  onBack,
  recentStrip = 'bottom',
}: GenerationResultAreaProps) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const { canViewResults } = feed
  const [tab, setTab] = useStoredChoice<ResultTab>(RESULT_TAB_STORAGE_KEY, RESULT_TABS)
  const [mode, setMode] = useStoredChoice<ViewerMode>(VIEWER_MODE_STORAGE_KEY, VIEWER_MODES)
  const { activeJob, activeJobCount } = useGenerationStageQueue({ serviceType, workflowId })
  const historySafetySettingsQuery = useQuery({
    queryKey: ['runtime-generation-history-settings'],
    queryFn: getRuntimeGenerationHistorySettings,
    enabled: canViewResults && !feed.authStatusQuery.isPending,
    staleTime: 60_000,
  })
  const applyRatingSafety = historySafetySettingsQuery.data?.applyRatingSafetyToGenerationHistory === true
  const resultImages = useMemo(
    () => feed.historyRecords.map(mapHistoryRecordToImageRecord).filter((image) => Boolean(image.thumbnail_url || image.audio?.length)),
    [feed.historyRecords],
  )
  const { visibleItems, shouldBlurItemPreview } = useImageFeedSafety({
    items: resultImages,
    enabled: applyRatingSafety && resultImages.length > 0,
    isLoading: feed.isHistoryLoading,
    isError: feed.historyQuery.isError,
    visibilityMode: applyRatingSafety ? 'feed' : 'badge-only',
  })

  // 직접 고른 결과는 생성 요청이나 완료로 바뀌지 않는다.
  const [pick, setPick] = useState<string | null>(null)
  const pickedItem = pick !== null
    ? visibleItems.find((item) => String(item.id) === pick) ?? null
    : null
  const selected = pickedItem ?? visibleItems[0] ?? null

  // Failures of my own runs: an admin feed also carries other accounts' rows.
  const accountId = feed.authStatusQuery.data?.accountId ?? null
  const myRuns = useMemo(
    () => feed.historyRecords.filter((record) => !feed.isAdmin || record.requested_by_account_id === accountId),
    [accountId, feed.historyRecords, feed.isAdmin],
  )
  const latestFailedId = useMemo(
    () => myRuns.reduce((latest, record) => (getGenerationLogStatus(record) === 'failed' ? Math.max(latest, record.id) : latest), 0),
    [myRuns],
  )
  const scopeKey = feed.historyQueryKey.join(':')
  const seenKey = `${SEEN_FAILURE_STORAGE_PREFIX}${scopeKey}`
  const [seenFailedId, setSeenFailedId] = useState<number | null>(null)
  useEffect(() => {
    const stored = Number(readStored(seenKey))
    setSeenFailedId(readStored(seenKey) !== null && Number.isFinite(stored) ? stored : null)
  }, [seenKey])
  const isFeedReady = feed.historyQuery.isSuccess
  useEffect(() => {
    if (!isFeedReady) return
    // First visit of a scope starts with nothing unseen; opening the log marks every failure seen.
    if ((seenFailedId === null || tab === 'log') && latestFailedId !== seenFailedId) {
      writeStored(seenKey, String(latestFailedId))
      setSeenFailedId(latestFailedId)
    }
  }, [isFeedReady, latestFailedId, seenFailedId, seenKey, tab])
  const hasUnseenFailure = tab !== 'log' && seenFailedId !== null && latestFailedId > seenFailedId

  // Snackbar only for runs seen turning failed (or arriving failed) while this page is open, never for old rows.
  const previousRunsRef = useRef<{ scopeKey: string; statuses: Map<number, GenerationLogStatus>; maxId: number } | null>(null)
  useEffect(() => {
    if (!isFeedReady) return
    const statuses = new Map(myRuns.map((record) => [record.id, getGenerationLogStatus(record)]))
    const previous = previousRunsRef.current
    previousRunsRef.current = { scopeKey, statuses, maxId: myRuns.reduce((max, record) => Math.max(max, record.id), 0) }
    if (!previous || previous.scopeKey !== scopeKey || tab === 'log') return

    const fresh = myRuns.filter((record) => {
      if (statuses.get(record.id) !== 'failed') return false
      const before = previous.statuses.get(record.id)
      return before === undefined ? record.id > previous.maxId : before !== 'failed'
    })
    if (fresh.length === 0) return

    const firstLine = fresh[0].error_message?.trim().split('\n')[0]?.slice(0, 160)
    showSnackbar({
      key: 'generation-run-failed',
      tone: 'error',
      message: fresh.length > 1
        ? t({ ko: '생성 {count}개가 실패했어', en: '{count} runs failed' }, { count: fresh.length })
        : firstLine
          ? t({ ko: '생성 실패: {error}', en: 'Run failed: {error}' }, { error: firstLine })
          : t({ ko: '생성이 실패했어', en: 'The run failed' }),
      action: { label: t({ ko: '로그 보기', en: 'Open log' }), onClick: () => setTab('log') },
    })
  }, [isFeedReady, myRuns, scopeKey, setTab, showSnackbar, t, tab])

  const tabs = (
    <SegmentedControl
      value={tab}
      items={[
        { value: 'viewer', label: t({ ko: '뷰어', en: 'Viewer' }) },
        {
          value: 'log',
          label: (
            <span className="relative">
              {t({ ko: '로그', en: 'Log' })}
              {hasUnseenFailure ? <CountBadge corner="top-right" className="-top-1 -right-2" label={t({ ko: '확인하지 않은 실패', en: 'Unseen failure' })} /> : null}
            </span>
          ),
        },
      ]}
      onChange={(next) => setTab(next === 'log' ? 'log' : 'viewer')}
      size="xs"
      semantics="tabs"
      ariaLabel={t({ ko: '결과 보기', en: 'Result view' })}
    />
  )
  const modeToggle = tab === 'viewer' ? (
    <span className="flex items-center gap-0.5">
      <IconButton size="icon-sm" variant="ghost" active={mode === 'stage'} onClick={() => setMode('stage')} label={t({ ko: '큰 결과', en: 'Large result' })}>
        <ImageIcon />
      </IconButton>
      <IconButton size="icon-sm" variant="ghost" active={mode === 'grid'} onClick={() => setMode('grid')} label={t({ ko: '이미지 목록', en: 'Image grid' })}>
        <LayoutGrid />
      </IconButton>
    </span>
  ) : null
  const toolbar = <>{tabs}{modeToggle}</>
  const backButton = onBack ? (
    <IconButton size="icon-sm" variant="ghost" onClick={onBack} label={t('image-generation.components.generation.history.panel.back.to.workflow.list')}>
      <ArrowLeft />
    </IconButton>
  ) : null

  if (tab === 'log') {
    return (
      <GenerationLogPanel
        feed={feed}
        serviceType={serviceType}
        workflowId={workflowId}
        publicWorkflowSlug={publicWorkflowSlug}
        splitPaneScroll={splitPaneScroll}
        onBack={onBack}
        headerLeading={toolbar}
        shouldBlur={shouldBlurItemPreview}
      />
    )
  }

  if (mode === 'grid') {
    return (
      <GenerationHistoryPanelView
        feed={feed}
        serviceType={serviceType}
        workflowId={workflowId}
        publicWorkflowSlug={publicWorkflowSlug}
        splitPaneScroll={splitPaneScroll}
        onBack={onBack}
        headerLeading={toolbar}
        resultsOnly
      />
    )
  }

  return (
    <section className={cn(splitPaneScroll ? 'flex min-h-0 flex-1 flex-col gap-3 ring-room-clip' : 'space-y-3')}>
      {!canViewResults ? (
        <>
          <div className="flex shrink-0 items-center gap-2">
            {backButton}
            {toolbar}
          </div>
          <ImagePermissionNotice />
        </>
      ) : (
        <GenerationResultStage
          toolbarStart={<>{backButton}{toolbar}</>}
          items={visibleItems}
          selected={selected}
          onSelect={setPick}
          isLoading={feed.isHistoryLoading}
          activeJob={activeJob}
          activeJobCount={activeJobCount}
          compact={compact}
          shouldBlur={shouldBlurItemPreview}
          onDeleted={() => void feed.refreshHistory()}
          onShowHistory={compact ? undefined : () => setMode('grid')}
          stripPlacement={recentStrip}
        />
      )}
    </section>
  )
}
