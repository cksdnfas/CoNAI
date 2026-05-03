import { Suspense, lazy, useState } from 'react'
import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { PageHeader } from '@/components/common/page-header'
import { SegmentedTabBar } from '@/components/common/segmented-tab-bar'
import { BottomDrawerSheet } from '@/components/ui/bottom-drawer-sheet'
import { useI18n } from '@/i18n'
import { useDesktopPageLayout } from '@/lib/use-desktop-page-layout'
import { cn } from '@/lib/utils'
import { getGenerationWorkflow } from '@/lib/api'
import { CompactGenerationControllerActionBar } from './components/shared-generation-controller'
import { loadPersistedSelectedComfyWorkflowId, persistSelectedComfyWorkflowId } from './image-generation-shared'

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

const GenerationHistoryPanelLazy = lazy(async () => {
  const module = await import('./components/generation-history-panel')
  return { default: module.GenerationHistoryPanel }
})

const WorkflowArtifactExplorerPanelLazy = lazy(async () => {
  const module = await import('./components/workflow-artifact-explorer-panel')
  return { default: module.WorkflowArtifactExplorerPanel }
})

const ModuleWorkflowWorkspaceLazy = lazy(async () => {
  const module = await import('@/features/module-graph/module-graph-page')
  return { default: module.ModuleWorkflowWorkspace }
})

const WorkflowReservationsPanelLazy = lazy(async () => {
  const module = await import('./components/workflow-reservations-panel')
  return { default: module.WorkflowReservationsPanel }
})

type ImageGenerationTab = 'nai' | 'codex' | 'comfyui' | 'workflows' | 'reservations'

function PanelFallback() {
  return <div className="min-h-[16rem] rounded-sm border border-border bg-surface-low animate-pulse" />
}

function getImageGenerationTabs(t: (dictionary: { ko: string; en: string }) => string): Array<{ value: ImageGenerationTab; label: string }> {
  return [
    { value: 'nai', label: 'NAI' },
    { value: 'codex', label: 'Codex' },
    { value: 'comfyui', label: 'ComfyUI' },
    { value: 'workflows', label: t({ ko: '워크플로우', en: 'Workflow' }) },
    { value: 'reservations', label: t({ ko: '예약 작업', en: 'Reservations' }) },
  ]
}

function parseImageGenerationTab(value?: string | null): ImageGenerationTab {
  if (value === 'nai' || value === 'codex' || value === 'comfyui' || value === 'workflows' || value === 'workflow' || value === 'reservations') {
    return value === 'workflow' ? 'workflows' : value
  }

  return 'nai'
}

export function ImageGenerationPage() {
  const { t } = useI18n()
  const [searchParams, setSearchParams] = useSearchParams()
  const [historyRefreshNonce, setHistoryRefreshNonce] = useState(0)
  const [selectedComfyWorkflowId, setSelectedComfyWorkflowId] = useState<number | null>(() => loadPersistedSelectedComfyWorkflowId())
  const [isControllerOpen, setIsControllerOpen] = useState(false)
  const isWideLayout = useDesktopPageLayout()
  const selectedComfyWorkflowQuery = useQuery({
    queryKey: ['image-generation-selected-comfy-workflow', selectedComfyWorkflowId, historyRefreshNonce],
    queryFn: () => getGenerationWorkflow(selectedComfyWorkflowId as number),
    enabled: selectedComfyWorkflowId !== null,
  })
  const imageGenerationTabs = getImageGenerationTabs(t)
  const visibleTabs = imageGenerationTabs
  const activeTab = visibleTabs.some((tab) => tab.value === parseImageGenerationTab(searchParams.get('tab')))
    ? parseImageGenerationTab(searchParams.get('tab'))
    : (visibleTabs[0]?.value ?? 'nai')
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
  const useWideSplitPaneScroll = isWideLayout && shouldShowResultPanel

  const handleHistoryRefresh = () => {
    setHistoryRefreshNonce((current) => current + 1)
  }

  const handleChangeTab = (nextTab: ImageGenerationTab) => {
    const nextSearchParams = new URLSearchParams(searchParams)
    nextSearchParams.set('tab', nextTab)
    setIsControllerOpen(false)
    setSearchParams(nextSearchParams)
  }

  useEffect(() => {
    persistSelectedComfyWorkflowId(selectedComfyWorkflowId)
  }, [selectedComfyWorkflowId])

  useEffect(() => {
    const requestedTab = parseImageGenerationTab(searchParams.get('tab'))
    if (visibleTabs.some((tab) => tab.value === requestedTab)) {
      return
    }

    if (visibleTabs[0]) {
      const nextSearchParams = new URLSearchParams(searchParams)
      nextSearchParams.set('tab', visibleTabs[0].value)
      setSearchParams(nextSearchParams, { replace: true })
    }
  }, [searchParams, setSearchParams, visibleTabs])

  const controllerLabel = activeTab === 'nai'
    ? 'NAI'
    : activeTab === 'codex'
      ? 'Codex'
      : activeTab === 'workflows'
        ? t({ ko: '워크플로우', en: 'Workflow' })
        : activeTab === 'reservations'
          ? t({ ko: '예약 작업', en: 'Reservations' })
          : 'ComfyUI'
  const shouldUseControllerDrawer = !isWideLayout && (activeTab === 'nai' || activeTab === 'codex' || (activeTab === 'comfyui' && selectedComfyWorkflowId !== null))
  const useCompactNaiActionBar = activeTab === 'nai' && (useWideSplitPaneScroll || shouldUseControllerDrawer)
  const naiDrawerHeaderContentId = activeTab === 'nai' && shouldUseControllerDrawer ? 'nai-controller-drawer-header-content' : undefined
  const codexDrawerHeaderContentId = activeTab === 'codex' && shouldUseControllerDrawer ? 'codex-controller-drawer-header-content' : undefined
  const comfyDrawerHeaderContentId = activeTab === 'comfyui' && shouldUseControllerDrawer && selectedComfyWorkflowId !== null
    ? 'comfy-controller-drawer-header-content'
    : undefined
  const drawerHeaderContentId = naiDrawerHeaderContentId ?? codexDrawerHeaderContentId ?? comfyDrawerHeaderContentId
  const compactActionBarContentId = shouldUseControllerDrawer
    ? activeTab === 'nai'
      ? 'nai-controller-compact-action-bar-content'
      : activeTab === 'codex'
        ? 'codex-controller-compact-action-bar-content'
        : activeTab === 'comfyui' && selectedComfyWorkflowId !== null
          ? 'comfy-controller-compact-action-bar-content'
          : undefined
    : undefined
  const useCompactControllerDrawer = Boolean(drawerHeaderContentId)

  const controllerPanel = activeTab === 'nai'
    ? (
      <NaiGenerationPanelLazy
        refreshNonce={0}
        onHistoryRefresh={handleHistoryRefresh}
        splitPaneScroll={useWideSplitPaneScroll}
        compactActionBar={useCompactNaiActionBar}
        headerPortalTargetId={naiDrawerHeaderContentId}
        compactActionBarContentTargetId={activeTab === 'nai' ? compactActionBarContentId : undefined}
      />
    )
    : activeTab === 'codex'
      ? (
        <CodexGenerationPanelLazy
          refreshNonce={0}
          onHistoryRefresh={handleHistoryRefresh}
          splitPaneScroll={useWideSplitPaneScroll}
          headerPortalTargetId={codexDrawerHeaderContentId}
          compactActionBarContentTargetId={activeTab === 'codex' ? compactActionBarContentId : undefined}
        />
      )
      : activeTab === 'comfyui'
        ? (
          <ComfyGenerationPanelLazy
            refreshNonce={0}
            onHistoryRefresh={handleHistoryRefresh}
            selectedWorkflowId={selectedComfyWorkflowId}
            onSelectedWorkflowChange={setSelectedComfyWorkflowId}
            splitPaneScroll={useWideSplitPaneScroll}
            headerPortalTargetId={comfyDrawerHeaderContentId}
            compactActionBarContentTargetId={activeTab === 'comfyui' ? compactActionBarContentId : undefined}
          />
        )
        : null

  const isDrawerOpen = shouldUseControllerDrawer && isControllerOpen

  return (
    <div
      className={cn(
        'space-y-6',
        isWideLayout ? 'pb-0' : 'pb-24',
        useWideSplitPaneScroll && 'flex h-[calc(100vh-var(--theme-shell-header-height)-1.5rem-var(--theme-shell-main-padding-bottom))] min-h-0 flex-col space-y-0 overflow-hidden',
      )}
    >
      <div className={cn('space-y-6', useWideSplitPaneScroll && 'shrink-0 pb-6')}>
        <PageHeader
          eyebrow={t({ ko: '생성', en: 'Create' })}
          title={t({ ko: '이미지 생성', en: 'Image Generation' })}
        />

        <SegmentedTabBar
          value={activeTab}
          items={visibleTabs}
          onChange={(nextTab) => handleChangeTab(nextTab as ImageGenerationTab)}
        />
      </div>

      {activeTab === 'workflows' ? (
        <Suspense fallback={<PanelFallback />}>
          <ModuleWorkflowWorkspaceLazy embedded />
        </Suspense>
      ) : null}

      {activeTab === 'reservations' ? (
        <Suspense fallback={<PanelFallback />}>
          <WorkflowReservationsPanelLazy />
        </Suspense>
      ) : null}

      {activeTab !== 'workflows' && activeTab !== 'reservations' && controllerPanel ? (
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
              <div className={cn('min-w-0', useWideSplitPaneScroll && 'min-h-0 flex flex-col overflow-hidden')}>
                <Suspense fallback={<PanelFallback />}>
                  {shouldShowArtifactExplorer && selectedComfyWorkflowId !== null ? (
                    <WorkflowArtifactExplorerPanelLazy
                      refreshNonce={historyRefreshNonce}
                      workflowId={selectedComfyWorkflowId}
                      splitPaneScroll={useWideSplitPaneScroll}
                    />
                  ) : (
                    <GenerationHistoryPanelLazy
                      refreshNonce={historyRefreshNonce}
                      serviceType={historyServiceType}
                      workflowId={activeTab === 'comfyui' ? selectedComfyWorkflowId : null}
                      splitPaneScroll={useWideSplitPaneScroll}
                    />
                  )}
                </Suspense>
              </div>
            ) : null}
          </div>
        ) : shouldUseControllerDrawer && shouldShowResultPanel ? (
          <>
            <div className="space-y-6">
              <Suspense fallback={<PanelFallback />}>
                {shouldShowArtifactExplorer && selectedComfyWorkflowId !== null ? (
                  <WorkflowArtifactExplorerPanelLazy
                    refreshNonce={historyRefreshNonce}
                    workflowId={selectedComfyWorkflowId}
                    onBack={() => setSelectedComfyWorkflowId(null)}
                  />
                ) : (
                  <GenerationHistoryPanelLazy
                    refreshNonce={historyRefreshNonce}
                    serviceType={historyServiceType}
                    workflowId={activeTab === 'comfyui' ? selectedComfyWorkflowId : null}
                    onBack={activeTab === 'comfyui' ? () => setSelectedComfyWorkflowId(null) : undefined}
                  />
                )}
              </Suspense>
            </div>

            <CompactGenerationControllerActionBar
              isExpanded={isDrawerOpen}
              onToggle={() => setIsControllerOpen((current) => !current)}
              expandedLabel={t({ ko: `${controllerLabel} 컨트롤 접기`, en: `Collapse ${controllerLabel} controls` })}
              collapsedLabel={t({ ko: `${controllerLabel} 컨트롤 열기`, en: `Open ${controllerLabel} controls` })}
              expandedContent={compactActionBarContentId ? <div id={compactActionBarContentId} className="flex items-center justify-end" /> : null}
            />

            <BottomDrawerSheet
              open={isDrawerOpen}
              title={useCompactControllerDrawer ? null : controllerLabel}
              ariaLabel={t({ ko: `${controllerLabel} 컨트롤 패널`, en: `${controllerLabel} control panel` })}
              onClose={() => setIsControllerOpen(false)}
              headerContentId={drawerHeaderContentId}
              surfaceVariant={useCompactControllerDrawer ? 'controller' : 'default'}
              bodyClassName={useCompactControllerDrawer ? 'p-0 pb-24' : undefined}
              headerPortalClassName={useCompactControllerDrawer ? 'mt-0 border-t-0 pt-0' : undefined}
              footer={useCompactControllerDrawer ? null : undefined}
              hideHandle={useCompactControllerDrawer}
            >
              <Suspense fallback={<PanelFallback />}>
                {controllerPanel}
              </Suspense>
            </BottomDrawerSheet>
          </>
        ) : activeTab === 'comfyui' ? (
          <div className="space-y-6">
            <div className="min-w-0">
              <Suspense fallback={<PanelFallback />}>
                {controllerPanel}
              </Suspense>
            </div>
            {shouldShowResultPanel ? (
              <Suspense fallback={<PanelFallback />}>
                {shouldShowArtifactExplorer && selectedComfyWorkflowId !== null ? (
                  <WorkflowArtifactExplorerPanelLazy
                    refreshNonce={historyRefreshNonce}
                    workflowId={selectedComfyWorkflowId}
                  />
                ) : (
                  <GenerationHistoryPanelLazy
                    refreshNonce={historyRefreshNonce}
                    serviceType="comfyui"
                    workflowId={selectedComfyWorkflowId}
                  />
                )}
              </Suspense>
            ) : null}
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
