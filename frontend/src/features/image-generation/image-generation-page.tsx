import { Suspense, lazy, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageHeader } from '@/components/common/page-header'
import { SegmentedTabBar } from '@/components/common/segmented-tab-bar'
import { hasAuthPermission } from '@/features/auth/auth-permissions'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { Button } from '@/components/ui/button'
import { BottomDrawerSheet } from '@/components/ui/bottom-drawer-sheet'
import { useDesktopPageLayout } from '@/lib/use-desktop-page-layout'
import { cn } from '@/lib/utils'
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

const WildcardGenerationPanelLazy = lazy(async () => {
  const module = await import('./components/wildcard-generation-panel')
  return { default: module.WildcardGenerationPanel }
})

const GenerationHistoryPanelLazy = lazy(async () => {
  const module = await import('./components/generation-history-panel')
  return { default: module.GenerationHistoryPanel }
})

const ModuleWorkflowWorkspaceLazy = lazy(async () => {
  const module = await import('@/features/module-graph/module-graph-page')
  return { default: module.ModuleWorkflowWorkspace }
})

type ImageGenerationTab = 'nai' | 'comfyui' | 'wildcards' | 'workflows'

function PanelFallback() {
  return <div className="min-h-[16rem] rounded-sm border border-border bg-surface-low animate-pulse" />
}

const IMAGE_GENERATION_TABS: Array<{ value: ImageGenerationTab; label: string }> = [
  { value: 'nai', label: 'NAI' },
  { value: 'comfyui', label: 'ComfyUI' },
  { value: 'wildcards', label: 'Wildcard' },
  { value: 'workflows', label: 'Workflow' },
]

function parseImageGenerationTab(value?: string | null): ImageGenerationTab {
  if (value === 'nai' || value === 'comfyui' || value === 'wildcards' || value === 'workflows' || value === 'workflow') {
    return value === 'workflow' ? 'workflows' : value
  }

  return 'nai'
}

export function ImageGenerationPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [globalRefreshNonce, setGlobalRefreshNonce] = useState(0)
  const [historyRefreshNonce, setHistoryRefreshNonce] = useState(0)
  const [selectedComfyWorkflowId, setSelectedComfyWorkflowId] = useState<number | null>(() => loadPersistedSelectedComfyWorkflowId())
  const [isControllerOpen, setIsControllerOpen] = useState(false)
  const authStatusQuery = useAuthStatusQuery()
  const isWideLayout = useDesktopPageLayout()
  const permissionKeys = authStatusQuery.data?.permissionKeys ?? []
  const visibleTabs = IMAGE_GENERATION_TABS.filter((tab) => tab.value !== 'wildcards' || hasAuthPermission(permissionKeys, 'page.wildcards.view'))
  const activeTab = visibleTabs.some((tab) => tab.value === parseImageGenerationTab(searchParams.get('tab')))
    ? parseImageGenerationTab(searchParams.get('tab'))
    : (visibleTabs[0]?.value ?? 'nai')
  const shouldShowHistory = activeTab === 'nai' || (activeTab === 'comfyui' && selectedComfyWorkflowId !== null)
  const useWideNaiSplitPaneScroll = isWideLayout && activeTab === 'nai' && shouldShowHistory
  const useWideSplitPaneScroll = isWideLayout && shouldShowHistory

  const handleGlobalRefresh = () => {
    setGlobalRefreshNonce((current) => current + 1)
    setHistoryRefreshNonce((current) => current + 1)
  }

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

  const controllerLabel = activeTab === 'nai' ? 'NAI' : activeTab === 'wildcards' ? 'Wildcard' : 'ComfyUI'
  const shouldUseControllerDrawer = !isWideLayout && (activeTab === 'nai' || (activeTab === 'comfyui' && selectedComfyWorkflowId !== null))
  const useCompactNaiActionBar = activeTab === 'nai' && (useWideNaiSplitPaneScroll || shouldUseControllerDrawer)
  const naiDrawerHeaderContentId = activeTab === 'nai' && shouldUseControllerDrawer ? 'nai-controller-drawer-header-content' : undefined
  const comfyDrawerHeaderContentId = activeTab === 'comfyui' && shouldUseControllerDrawer && selectedComfyWorkflowId !== null
    ? 'comfy-controller-drawer-header-content'
    : undefined
  const drawerHeaderContentId = naiDrawerHeaderContentId ?? comfyDrawerHeaderContentId
  const compactActionBarContentId = shouldUseControllerDrawer
    ? activeTab === 'nai'
      ? 'nai-controller-compact-action-bar-content'
      : activeTab === 'comfyui' && selectedComfyWorkflowId !== null
        ? 'comfy-controller-compact-action-bar-content'
        : undefined
    : undefined
  const useCompactControllerDrawer = Boolean(drawerHeaderContentId)

  const controllerPanel = activeTab === 'nai'
    ? (
      <NaiGenerationPanelLazy
        refreshNonce={globalRefreshNonce}
        onHistoryRefresh={handleHistoryRefresh}
        splitPaneScroll={useWideNaiSplitPaneScroll}
        compactActionBar={useCompactNaiActionBar}
        headerPortalTargetId={naiDrawerHeaderContentId}
        compactActionBarContentTargetId={activeTab === 'nai' ? compactActionBarContentId : undefined}
      />
    )
    : activeTab === 'comfyui'
      ? (
        <ComfyGenerationPanelLazy
          refreshNonce={globalRefreshNonce}
          onHistoryRefresh={handleHistoryRefresh}
          selectedWorkflowId={selectedComfyWorkflowId}
          onSelectedWorkflowChange={setSelectedComfyWorkflowId}
          splitPaneScroll={useWideSplitPaneScroll}
          headerPortalTargetId={comfyDrawerHeaderContentId}
          compactActionBarContentTargetId={activeTab === 'comfyui' ? compactActionBarContentId : undefined}
        />
      )
      : activeTab === 'wildcards'
        ? <WildcardGenerationPanelLazy refreshNonce={globalRefreshNonce} />
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
          eyebrow="Create"
          title="Image Generation"
          actions={
            activeTab !== 'workflows' ? (
              <Button type="button" size="icon-sm" variant="outline" onClick={handleGlobalRefresh} aria-label="새로고침" title="새로고침">
                <RefreshCw className="h-4 w-4" />
              </Button>
            ) : undefined
          }
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

      {activeTab !== 'workflows' && controllerPanel ? (
        isWideLayout ? (
          <div
            className={cn(
              'grid items-start gap-8',
              shouldShowHistory ? 'grid-cols-[minmax(360px,4fr)_minmax(0,6fr)]' : 'grid-cols-1',
              useWideSplitPaneScroll && 'min-h-0 flex-1 items-stretch',
            )}
          >
            <div className={cn('min-w-0', useWideSplitPaneScroll && 'flex min-h-0 flex-col overflow-hidden')}>
              <Suspense fallback={<PanelFallback />}>
                {controllerPanel}
              </Suspense>
            </div>
            {shouldShowHistory ? (
              <div className={cn('min-w-0', useWideSplitPaneScroll && 'min-h-0 flex flex-col overflow-hidden')}>
                <Suspense fallback={<PanelFallback />}>
                  <GenerationHistoryPanelLazy
                    refreshNonce={historyRefreshNonce}
                    serviceType={activeTab === 'nai' ? 'novelai' : 'comfyui'}
                    workflowId={activeTab === 'comfyui' ? selectedComfyWorkflowId : null}
                    splitPaneScroll={useWideSplitPaneScroll}
                  />
                </Suspense>
              </div>
            ) : null}
          </div>
        ) : shouldUseControllerDrawer && shouldShowHistory ? (
          <>
            <div className="space-y-6">
              <Suspense fallback={<PanelFallback />}>
                <GenerationHistoryPanelLazy
                  refreshNonce={historyRefreshNonce}
                  serviceType={activeTab === 'nai' ? 'novelai' : 'comfyui'}
                  workflowId={activeTab === 'comfyui' ? selectedComfyWorkflowId : null}
                  onBack={activeTab === 'comfyui' ? () => setSelectedComfyWorkflowId(null) : undefined}
                />
              </Suspense>
            </div>

            <CompactGenerationControllerActionBar
              isExpanded={isDrawerOpen}
              onToggle={() => setIsControllerOpen((current) => !current)}
              expandedLabel={`${controllerLabel} 컨트롤 접기`}
              collapsedLabel={`${controllerLabel} 컨트롤 열기`}
              expandedContent={compactActionBarContentId ? <div id={compactActionBarContentId} className="flex items-center justify-end" /> : null}
            />

            <BottomDrawerSheet
              open={isDrawerOpen}
              title={useCompactControllerDrawer ? null : controllerLabel}
              ariaLabel={`${controllerLabel} 컨트롤 패널`}
              onClose={() => setIsControllerOpen(false)}
              headerContentId={drawerHeaderContentId}
              className={useCompactControllerDrawer ? 'border-x-0 border-b-0 bg-transparent shadow-none backdrop-blur-0' : undefined}
              bodyClassName={useCompactControllerDrawer ? 'p-0 pb-24' : undefined}
              headerClassName={useCompactControllerDrawer ? 'border-b-0 bg-transparent px-4 py-3' : undefined}
              headerPortalClassName={useCompactControllerDrawer ? 'mt-0 border-t-0 pt-0' : undefined}
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
            {shouldShowHistory ? (
              <Suspense fallback={<PanelFallback />}>
                <GenerationHistoryPanelLazy
                  refreshNonce={historyRefreshNonce}
                  serviceType="comfyui"
                  workflowId={selectedComfyWorkflowId}
                />
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
