import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { CalendarClock, MessagesSquare, Workflow } from 'lucide-react'
import { SegmentedControl } from '@/components/common/segmented-control'
import { SidebarToggle } from '@/components/common/page-toolbar'
import { ProviderIcon } from '@/components/common/provider-icons'
import { usePageSidebar } from '@/components/ui/sidebar'
import { useI18n } from '@/i18n'
import { useDesktopPageLayout } from '@/lib/use-desktop-page-layout'
import { cn } from '@/lib/utils'
import { getGenerationWorkflow } from '@/lib/api-image-generation-workflows'
import { getCodexChatStatus } from '@/lib/api-codex-chat'
import { formatCountDisplay, countStateFromQuery } from '@/lib/count-display'
import type { GenerationResultView } from './components/generation-result-area'
import { GENERATION_TOOLBAR_STATUS_SLOT_ID } from './components/generation-toolbar-status'
import { useGenerationHistoryFeed } from './components/use-generation-history-feed'
import { usePendingHistorySettingsLoad } from './history-settings-load-store'
import {
  IMAGE_GENERATION_WORKFLOW_PARAM,
  getImageGenerationTabLabel,
  parseImageGenerationTab,
  parseImageGenerationWorkflowId,
  type ImageGenerationTab,
} from './image-generation-tabs'

const NaiGenerationPanelLazy = lazy(async () => {
  const module = await import('./components/nai-generation-panel')
  return { default: module.NaiGenerationPanel }
})

const ComfyGenerationPanelLazy = lazy(async () => {
  const module = await import('./components/comfy-generation-panel')
  return { default: module.ComfyGenerationPanel }
})

const CodexGenerationPanelLazy = lazy(async () => {
  const module = await import('./components/codex-generation-panel')
  return { default: module.CodexGenerationPanel }
})

const GenerationResultAreaLazy = lazy(async () => {
  const module = await import('./components/generation-result-area')
  return { default: module.GenerationResultArea }
})

const WorkflowArtifactExplorerPanelLazy = lazy(async () => {
  const module = await import('./components/workflow-artifact-explorer-panel')
  return { default: module.WorkflowArtifactExplorerPanel }
})

const ModuleWorkflowWorkspaceLazy = lazy(async () => {
  const module = await import('@/features/module-graph/module-graph-page')
  return { default: module.ModuleWorkflowWorkspace }
})

const CodexChatPanelLazy = lazy(async () => {
  const module = await import('./components/codex-chat-panel')
  return { default: module.CodexChatPanel }
})

const WorkflowReservationsPanelLazy = lazy(async () => {
  const module = await import('./components/workflow-reservations-panel')
  return { default: module.WorkflowReservationsPanel }
})

const PROVIDER_TABS: ImageGenerationTab[] = ['nai', 'codex', 'comfyui']
/** Fixed bottom slot the provider panels portal their sticky Generate bar into on narrow screens. */
const STICKY_ACTION_BAR_SLOT_ID = 'generation-sticky-action-bar'

type NarrowView = 'edit' | 'result'

/** Sidebar toggle for the toolbar when it is hosted by the workflow workspace (PageWithSidebar): shown while the
 * explorer is hidden (collapsed on desktop, always on narrow screens), like PageToolbar does. */
function WorkspaceSidebarToggle() {
  const sidebar = usePageSidebar()
  if (!sidebar || (sidebar.isDesktop && !sidebar.collapsed)) {
    return null
  }

  return <SidebarToggle className="-ml-1.5 shrink-0" />
}

function PanelFallback() {
  return <div className="min-h-[16rem] animate-pulse rounded-sm bg-fill" />
}

export function ImageGenerationPage() {
  const { t, formatNumber } = useI18n()
  const [searchParams, setSearchParams] = useSearchParams()
  const [historyRefreshNonce, setHistoryRefreshNonce] = useState(0)
  const [resultView, setResultView] = useState<GenerationResultView>('stage')
  const [narrowView, setNarrowView] = useState<NarrowView>('edit')
  const isWideLayout = useDesktopPageLayout()
  const rawTab = searchParams.get('tab')
  // Codex 채팅 탭은 설정에서 켜고 관리자일 때만 보인다. 상태를 모르는 동안은 탭을 그대로 두고, 쓸 수 없으면 기본 탭으로 돌린다.
  const codexChatStatusQuery = useQuery({ queryKey: ['codex-chat-status'], queryFn: getCodexChatStatus, staleTime: 60_000, retry: false })
  const canUseCodexChat = codexChatStatusQuery.data?.canUse === true
  const parsedTab = parseImageGenerationTab(rawTab)
  const activeTab: ImageGenerationTab = parsedTab === 'chat' && !codexChatStatusQuery.isPending && !canUseCodexChat ? 'nai' : parsedTab
  const isProviderTab = PROVIDER_TABS.includes(activeTab)
  // 선택한 ComfyUI 워크플로우는 URL 에 둔다. 새로고침/뒤로가기에도 같은 워크플로우로 돌아온다.
  const requestedComfyWorkflowId = parseImageGenerationWorkflowId(searchParams.get(IMAGE_GENERATION_WORKFLOW_PARAM))
  const selectedComfyWorkflowId = activeTab === 'comfyui' ? requestedComfyWorkflowId : null
  const setSelectedComfyWorkflowId = useCallback((workflowId: number | null, options?: { replace?: boolean }) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      if (workflowId === null) {
        next.delete(IMAGE_GENERATION_WORKFLOW_PARAM)
      } else {
        next.set(IMAGE_GENERATION_WORKFLOW_PARAM, String(workflowId))
      }
      return next
    }, { replace: options?.replace })
  }, [setSearchParams])
  const selectedComfyWorkflowQuery = useQuery({
    queryKey: ['image-generation-selected-comfy-workflow', selectedComfyWorkflowId],
    queryFn: () => getGenerationWorkflow(selectedComfyWorkflowId as number),
    enabled: selectedComfyWorkflowId !== null,
  })
  const selectedComfyWorkflowResultMode = activeTab === 'comfyui'
    ? selectedComfyWorkflowQuery.data?.result_view_mode ?? 'history'
    : 'history'
  const shouldShowArtifactExplorer = activeTab === 'comfyui' && selectedComfyWorkflowId !== null && selectedComfyWorkflowResultMode === 'artifact_explorer'
  const shouldShowHistory = activeTab === 'nai' || activeTab === 'codex' || (activeTab === 'comfyui' && selectedComfyWorkflowId !== null && !shouldShowArtifactExplorer)
  const shouldShowResultPanel = shouldShowHistory || shouldShowArtifactExplorer
  const historyServiceType = activeTab === 'nai'
    ? 'novelai'
    : activeTab === 'codex'
      ? 'codex'
      : 'comfyui'
  const historyWorkflowId = activeTab === 'comfyui' ? selectedComfyWorkflowId : null
  const useWideSplitPaneScroll = isWideLayout && shouldShowResultPanel
  // 좁은 화면은 편집 먼저: 편집 | 결과 전환, 생성 바는 화면 아래에 고정.
  const useNarrowTabs = !isWideLayout && shouldShowResultPanel
  const historyFeed = useGenerationHistoryFeed({
    refreshNonce: historyRefreshNonce,
    serviceType: historyServiceType,
    workflowId: historyWorkflowId,
    enabled: shouldShowHistory,
  })

  // "이 설정 불러오기": 기록의 제공자 탭/워크플로우로 옮기고, 좁은 화면에서는 편집 보기로 돌린다.
  // 실제 폼 적용과 덮어쓰기 확인은 해당 제공자 패널이 맡는다.
  const pendingHistorySettingsLoad = usePendingHistorySettingsLoad()
  const handledHistorySettingsLoadNonceRef = useRef(0)
  useEffect(() => {
    if (!pendingHistorySettingsLoad || handledHistorySettingsLoadNonceRef.current === pendingHistorySettingsLoad.nonce) {
      return
    }

    handledHistorySettingsLoadNonceRef.current = pendingHistorySettingsLoad.nonce
    const targetTab: ImageGenerationTab = pendingHistorySettingsLoad.serviceType === 'novelai'
      ? 'nai'
      : pendingHistorySettingsLoad.serviceType === 'codex'
        ? 'codex'
        : 'comfyui'
    const targetWorkflowId = targetTab === 'comfyui' ? pendingHistorySettingsLoad.workflowId : null
    if (activeTab !== targetTab || selectedComfyWorkflowId !== targetWorkflowId) {
      setSearchParams((current) => {
        const next = new URLSearchParams(current)
        next.set('tab', targetTab)
        if (targetWorkflowId !== null) {
          next.set(IMAGE_GENERATION_WORKFLOW_PARAM, String(targetWorkflowId))
        } else {
          next.delete(IMAGE_GENERATION_WORKFLOW_PARAM)
        }
        return next
      })
    }
    setNarrowView('edit')
  }, [activeTab, pendingHistorySettingsLoad, selectedComfyWorkflowId, setSearchParams])

  // 생성 요청이 큐에 들어가면 좁은 화면은 결과 보기로 넘겨 진행 상황을 바로 보여 준다.
  const handleHistoryRefresh = () => {
    setHistoryRefreshNonce((current) => current + 1)
    setResultView('stage')
    if (!isWideLayout) {
      setNarrowView('result')
    }
  }

  const handleChangeTab = (nextTab: ImageGenerationTab) => {
    const nextSearchParams = new URLSearchParams(searchParams)
    nextSearchParams.set('tab', nextTab)
    if (nextTab !== 'comfyui') {
      nextSearchParams.delete(IMAGE_GENERATION_WORKFLOW_PARAM)
    }
    setNarrowView('edit')
    setResultView('stage')
    setSearchParams(nextSearchParams)
  }

  useEffect(() => {
    if (activeTab !== 'comfyui' && requestedComfyWorkflowId !== null) {
      setSelectedComfyWorkflowId(null, { replace: true })
    }
  }, [activeTab, requestedComfyWorkflowId, setSelectedComfyWorkflowId])

  // 알 수 없는 tab 값은 기본 제공자로 바로잡는다(`workflow` 같은 별칭은 그대로 둔다).
  useEffect(() => {
    if (rawTab === null || rawTab === 'workflow' || rawTab === activeTab) {
      return
    }

    const nextSearchParams = new URLSearchParams(searchParams)
    nextSearchParams.set('tab', activeTab)
    setSearchParams(nextSearchParams, { replace: true })
  }, [activeTab, rawTab, searchParams, setSearchParams])

  const stickyActionBarTargetId = useNarrowTabs ? STICKY_ACTION_BAR_SLOT_ID : undefined

  const controllerPanel = activeTab === 'nai'
    ? (
      <NaiGenerationPanelLazy
        onHistoryRefresh={handleHistoryRefresh}
        splitPaneScroll={useWideSplitPaneScroll}
        compactActionBar={useWideSplitPaneScroll || useNarrowTabs}
        compactActionBarContentTargetId={stickyActionBarTargetId}
        statusPortalTargetId={GENERATION_TOOLBAR_STATUS_SLOT_ID}
      />
    )
    : activeTab === 'codex'
      ? (
        <CodexGenerationPanelLazy
          onHistoryRefresh={handleHistoryRefresh}
          splitPaneScroll={useWideSplitPaneScroll}
          compactActionBarContentTargetId={stickyActionBarTargetId}
          statusPortalTargetId={GENERATION_TOOLBAR_STATUS_SLOT_ID}
        />
      )
      : activeTab === 'comfyui'
        ? (
          <ComfyGenerationPanelLazy
            onHistoryRefresh={handleHistoryRefresh}
            selectedWorkflowId={selectedComfyWorkflowId}
            onSelectedWorkflowChange={setSelectedComfyWorkflowId}
            splitPaneScroll={useWideSplitPaneScroll}
            compactActionBarContentTargetId={stickyActionBarTargetId}
            statusPortalTargetId={GENERATION_TOOLBAR_STATUS_SLOT_ID}
          />
        )
        : null

  const resultPanel = shouldShowArtifactExplorer && selectedComfyWorkflowId !== null ? (
    <WorkflowArtifactExplorerPanelLazy
      refreshNonce={historyRefreshNonce}
      workflowId={selectedComfyWorkflowId}
      splitPaneScroll={useWideSplitPaneScroll}
    />
  ) : shouldShowHistory ? (
    <GenerationResultAreaLazy
      key={`${historyServiceType}:${historyWorkflowId ?? ''}`}
      feed={historyFeed}
      serviceType={historyServiceType}
      workflowId={historyWorkflowId}
      splitPaneScroll={useWideSplitPaneScroll}
      compact={!isWideLayout}
      view={resultView}
      onViewChange={setResultView}
    />
  ) : null

  // 제공자 3개와 워크플로우·예약작업을 한 줄의 탭으로 나란히 둔다.
  const tabItems = [
    ...PROVIDER_TABS.map((value) => ({
      value,
      label: <ProviderIcon provider={value} className="size-4" />,
      ariaLabel: getImageGenerationTabLabel(value, t),
    })),
    { value: 'workflows', label: <Workflow className="size-4" />, ariaLabel: getImageGenerationTabLabel('workflows', t) },
    { value: 'reservations', label: <CalendarClock className="size-4" />, ariaLabel: getImageGenerationTabLabel('reservations', t) },
    ...(canUseCodexChat || activeTab === 'chat'
      ? [{ value: 'chat', label: <MessagesSquare className="size-4" />, ariaLabel: getImageGenerationTabLabel('chat', t) }]
      : []),
  ]
  const historyTotal = historyFeed.historyQuery.data?.pages[0]?.total
  const resultCountLabel = shouldShowHistory && historyTotal !== undefined
    ? formatCountDisplay(countStateFromQuery({ total: historyTotal, isError: historyFeed.historyQuery.isError }), { t, formatNumber }).text
    : null

  const toolbar = (
    <div data-slot="page-toolbar" className="flex min-h-14 shrink-0 items-center gap-2 py-2 max-sm:flex-wrap sm:gap-3">
      <WorkspaceSidebarToggle />
      <SegmentedControl
        value={activeTab}
        items={tabItems}
        onChange={(next) => handleChangeTab(next as ImageGenerationTab)}
        size={isWideLayout ? 'sm' : 'xs'}
        semantics="tabs"
        ariaLabel={t({ ko: '생성 메뉴', en: 'Generation sections' })}
        className="shrink-0"
      />
      {/* 폰 폭에서는 연결 상태를 탭 아랫줄로 내린다. 비어 있으면(워크플로우·예약작업) 줄을 차지하지 않는다. */}
      <div
        id={GENERATION_TOOLBAR_STATUS_SLOT_ID}
        className={cn('flex min-w-0 flex-1 items-center overflow-hidden max-sm:basis-full max-sm:empty:hidden', !isProviderTab && activeTab !== 'chat' && 'invisible')}
      />
    </div>
  )

  // The workflow workspace is its own page root (explorer sidebar + content); it hosts this toolbar in its content column.
  if (activeTab === 'workflows') {
    return (
      <Suspense fallback={<PanelFallback />}>
        <ModuleWorkflowWorkspaceLazy toolbar={toolbar} />
      </Suspense>
    )
  }

  // 채팅은 입력창을 화면 아래에 두려고 분할 화면과 같은 고정 높이 레이아웃을 쓴다.
  const useFixedHeightLayout = useWideSplitPaneScroll || activeTab === 'chat'

  return (
    <div
      className={cn(
        'space-y-4',
        useNarrowTabs && narrowView === 'edit' ? 'pb-28' : isWideLayout || activeTab === 'chat' ? 'pb-0' : 'pb-6',
        useFixedHeightLayout && 'flex h-[calc(100vh-var(--theme-shell-header-height)-1.5rem-var(--theme-shell-main-padding-bottom))] min-h-0 flex-col space-y-0 overflow-hidden',
      )}
    >
      <div className={cn(useFixedHeightLayout && 'shrink-0 pb-2')}>
        {toolbar}
      </div>

      {activeTab === 'chat' && canUseCodexChat ? (
        <Suspense fallback={<PanelFallback />}>
          <CodexChatPanelLazy statusPortalTargetId={GENERATION_TOOLBAR_STATUS_SLOT_ID} isWideLayout={isWideLayout} />
        </Suspense>
      ) : null}

      {activeTab === 'reservations' ? (
        <Suspense fallback={<PanelFallback />}>
          <WorkflowReservationsPanelLazy />
        </Suspense>
      ) : null}

      {isProviderTab && controllerPanel ? (
        isWideLayout ? (
          <div
            className={cn(
              'grid items-start gap-8',
              shouldShowResultPanel ? 'grid-cols-[minmax(360px,4fr)_minmax(0,6fr)]' : 'grid-cols-1',
              useWideSplitPaneScroll && 'min-h-0 flex-1 items-stretch',
            )}
          >
            <div className={cn('min-w-0', useWideSplitPaneScroll && 'flex min-h-0 flex-col overflow-hidden')}>
              <Suspense fallback={<PanelFallback />}>
                {controllerPanel}
              </Suspense>
            </div>
            {shouldShowResultPanel ? (
              <div className={cn('min-w-0', useWideSplitPaneScroll && 'flex min-h-0 flex-col overflow-hidden')}>
                <Suspense fallback={<PanelFallback />}>
                  {resultPanel}
                </Suspense>
              </div>
            ) : null}
          </div>
        ) : useNarrowTabs ? (
          <div className="space-y-4">
            <SegmentedControl
              value={narrowView}
              items={[
                { value: 'edit', label: t({ ko: '편집', en: 'Edit' }) },
                { value: 'result', label: resultCountLabel ? `${t({ ko: '결과', en: 'Result' })} (${resultCountLabel})` : t({ ko: '결과', en: 'Result' }) },
              ]}
              onChange={(next) => setNarrowView(next as NarrowView)}
              size="sm"
              semantics="tabs"
              fullWidth
              ariaLabel={t({ ko: '편집 또는 결과', en: 'Edit or result' })}
            />

            {/* 결과를 보는 동안에도 컨트롤러는 마운트해 둬서 입력 중인 폼 상태가 사라지지 않게 한다. */}
            <div className={cn('min-w-0', narrowView !== 'edit' && 'hidden')}>
              <Suspense fallback={<PanelFallback />}>
                {controllerPanel}
              </Suspense>
            </div>
            {narrowView === 'result' ? (
              <Suspense fallback={<PanelFallback />}>
                {resultPanel}
              </Suspense>
            ) : null}

            <div
              className={cn(
                'pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] z-[86] flex justify-end px-3',
                narrowView !== 'edit' && 'hidden',
              )}
            >
              <div id={STICKY_ACTION_BAR_SLOT_ID} className="pointer-events-auto flex max-w-full justify-end" />
            </div>
          </div>
        ) : (
          <div className="min-w-0">
            <Suspense fallback={<PanelFallback />}>
              {controllerPanel}
            </Suspense>
          </div>
        )
      ) : null}
    </div>
  )
}
