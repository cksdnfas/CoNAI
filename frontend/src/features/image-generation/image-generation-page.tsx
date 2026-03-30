import { useEffect, useState } from 'react'
import { RefreshCw, SlidersHorizontal } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { PageHeader } from '@/components/common/page-header'
import { Button } from '@/components/ui/button'
import { BottomDrawerSheet } from '@/components/ui/bottom-drawer-sheet'
import { FloatingBottomAction } from '@/components/ui/floating-bottom-action'
import { ModuleWorkflowWorkspace } from '@/features/module-graph/module-graph-page'
import { useDesktopPageLayout } from '@/lib/use-desktop-page-layout'
import { cn } from '@/lib/utils'
import { ComfyGenerationPanel } from './components/comfy-generation-panel'
import { GenerationHistoryPanel } from './components/generation-history-panel'
import { NaiGenerationPanel } from './components/nai-generation-panel'

type ImageGenerationTab = 'nai' | 'comfyui' | 'workflows'

const IMAGE_GENERATION_TABS: Array<{ value: ImageGenerationTab; label: string }> = [
  { value: 'nai', label: 'NAI' },
  { value: 'comfyui', label: 'ComfyUI' },
  { value: 'workflows', label: 'Workflow' },
]

function parseImageGenerationTab(value?: string | null): ImageGenerationTab {
  if (value === 'nai' || value === 'comfyui' || value === 'workflows' || value === 'workflow') {
    return value === 'workflow' ? 'workflows' : value
  }

  return 'nai'
}

export function ImageGenerationPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [globalRefreshNonce, setGlobalRefreshNonce] = useState(0)
  const [historyRefreshNonce, setHistoryRefreshNonce] = useState(0)
  const [selectedComfyWorkflowId, setSelectedComfyWorkflowId] = useState<number | null>(null)
  const [isControllerOpen, setIsControllerOpen] = useState(false)
  const isWideLayout = useDesktopPageLayout()
  const activeTab = parseImageGenerationTab(searchParams.get('tab'))

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
    setSearchParams(nextSearchParams)
  }

  const controllerPanel = activeTab === 'nai'
    ? <NaiGenerationPanel refreshNonce={globalRefreshNonce} onHistoryRefresh={handleHistoryRefresh} />
    : activeTab === 'comfyui'
      ? <ComfyGenerationPanel refreshNonce={globalRefreshNonce} onHistoryRefresh={handleHistoryRefresh} onSelectedWorkflowChange={setSelectedComfyWorkflowId} />
      : null

  const controllerLabel = activeTab === 'nai' ? 'NAI' : 'ComfyUI'
  const shouldShowHistory = activeTab === 'nai' || (activeTab === 'comfyui' && selectedComfyWorkflowId !== null)
  const shouldUseControllerDrawer = !isWideLayout && (activeTab === 'nai' || (activeTab === 'comfyui' && selectedComfyWorkflowId !== null))

  useEffect(() => {
    setIsControllerOpen(false)
  }, [activeTab])

  useEffect(() => {
    if (!shouldUseControllerDrawer) {
      setIsControllerOpen(false)
    }
  }, [shouldUseControllerDrawer])

  return (
    <div className={cn('space-y-6', isWideLayout ? 'pb-0' : 'pb-24')}>
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

      <div className="border-b border-border/70 pb-2">
        <div className="flex flex-wrap gap-2">
          {IMAGE_GENERATION_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => handleChangeTab(tab.value)}
              className={cn(
                'rounded-sm px-4 py-2 text-sm font-semibold transition-colors',
                activeTab === tab.value
                  ? 'bg-surface-container text-primary'
                  : 'text-muted-foreground hover:bg-surface-low hover:text-foreground',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'workflows' ? <ModuleWorkflowWorkspace embedded /> : null}

      {activeTab !== 'workflows' && controllerPanel ? (
        isWideLayout ? (
          <div className={cn('grid items-start gap-8', shouldShowHistory ? 'grid-cols-[minmax(360px,4fr)_minmax(0,6fr)]' : 'grid-cols-1')}>
            <div className="min-w-0">{controllerPanel}</div>
            {shouldShowHistory ? (
              <div className="min-w-0">
                <GenerationHistoryPanel
                  refreshNonce={historyRefreshNonce}
                  serviceType={activeTab === 'nai' ? 'novelai' : 'comfyui'}
                  workflowId={activeTab === 'comfyui' ? selectedComfyWorkflowId : null}
                />
              </div>
            ) : null}
          </div>
        ) : shouldUseControllerDrawer && shouldShowHistory ? (
          <>
            <GenerationHistoryPanel
              refreshNonce={historyRefreshNonce}
              serviceType={activeTab === 'nai' ? 'novelai' : 'comfyui'}
              workflowId={activeTab === 'comfyui' ? selectedComfyWorkflowId : null}
            />

            <FloatingBottomAction type="button" onClick={() => setIsControllerOpen(true)}>
              <SlidersHorizontal className="h-4 w-4" />
              {controllerLabel}
            </FloatingBottomAction>

            <BottomDrawerSheet
              open={isControllerOpen}
              title={controllerLabel}
              ariaLabel={`${controllerLabel} 컨트롤 패널`}
              onClose={() => setIsControllerOpen(false)}
            >
              {controllerPanel}
            </BottomDrawerSheet>
          </>
        ) : activeTab === 'comfyui' ? (
          <div className="space-y-6">
            <div className="min-w-0">{controllerPanel}</div>
            {shouldShowHistory ? (
              <GenerationHistoryPanel
                refreshNonce={historyRefreshNonce}
                serviceType="comfyui"
                workflowId={selectedComfyWorkflowId}
              />
            ) : null}
          </div>
        ) : (
          <div className="min-w-0">{controllerPanel}</div>
        )
      ) : null}
    </div>
  )
}
