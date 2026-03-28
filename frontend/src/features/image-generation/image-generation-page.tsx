import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, RefreshCw, SlidersHorizontal } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { PageHeader } from '@/components/common/page-header'
import { Button } from '@/components/ui/button'
import { ModuleWorkflowWorkspace } from '@/features/module-graph/module-graph-page'
import { useMinWidth } from '@/lib/use-min-width'
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

function GenerationControllerSheet({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!open) {
      return
    }

    const previousOverflow = document.body.style.overflow
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, onClose])

  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <>
      <div
        className={open ? 'fixed inset-0 z-[84] bg-black/50 transition-opacity' : 'pointer-events-none fixed inset-0 z-[84] bg-black/0 transition-opacity'}
        onClick={onClose}
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`${title} 컨트롤 패널`}
        className={open
          ? 'theme-floating-panel theme-bottom-drawer fixed inset-x-0 bottom-0 z-[85] flex h-[min(82vh,calc(100vh-1rem))] flex-col transition-transform duration-300'
          : 'theme-floating-panel theme-bottom-drawer pointer-events-none fixed inset-x-0 bottom-0 z-[85] flex h-[min(82vh,calc(100vh-1rem))] translate-y-full flex-col transition-transform duration-300'}
      >
        <div className="flex justify-center px-4 pt-3">
          <div className="h-1.5 w-14 rounded-full bg-white/15" />
        </div>

        <div className="theme-drawer-header border-b border-white/5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-lg font-semibold tracking-tight text-foreground">{title}</div>
            </div>
          </div>
        </div>

        <div className="theme-drawer-body min-h-0 flex-1 overflow-y-auto pb-20">
          {children}
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-4">
          <Button type="button" size="sm" className="pointer-events-auto w-[30vw] min-w-[112px] max-w-[180px]" onClick={onClose}>
            <ChevronDown className="h-4 w-4" />
            접기
          </Button>
        </div>
      </aside>
    </>,
    document.body,
  )
}

export function ImageGenerationPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [globalRefreshNonce, setGlobalRefreshNonce] = useState(0)
  const [historyRefreshNonce, setHistoryRefreshNonce] = useState(0)
  const [selectedComfyWorkflowId, setSelectedComfyWorkflowId] = useState<number | null>(null)
  const [isControllerOpen, setIsControllerOpen] = useState(false)
  const isWideLayout = useMinWidth(1200)
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

  useEffect(() => {
    setIsControllerOpen(false)
  }, [activeTab])

  const controllerPanel = activeTab === 'nai'
    ? <NaiGenerationPanel refreshNonce={globalRefreshNonce} onHistoryRefresh={handleHistoryRefresh} />
    : activeTab === 'comfyui'
      ? <ComfyGenerationPanel refreshNonce={globalRefreshNonce} onHistoryRefresh={handleHistoryRefresh} onSelectedWorkflowChange={setSelectedComfyWorkflowId} />
      : null

  const controllerLabel = activeTab === 'nai' ? 'NAI' : 'ComfyUI'
  const shouldShowHistory = activeTab === 'nai' || (activeTab === 'comfyui' && selectedComfyWorkflowId !== null)

  return (
    <div className="space-y-6 pb-24 xl:pb-0">
      <PageHeader
        eyebrow="Create"
        title="Image Generation"
        actions={
          activeTab !== 'workflows' ? (
            <Button type="button" variant="outline" onClick={handleGlobalRefresh}>
              <RefreshCw className="h-4 w-4" />
              새로고침
            </Button>
          ) : undefined
        }
      />

      <div className="rounded-sm bg-surface-lowest p-2">
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
          <div className={cn('grid gap-6', shouldShowHistory ? 'xl:grid-cols-[minmax(360px,4fr)_minmax(0,6fr)]' : 'grid-cols-1')}>
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
        ) : shouldShowHistory ? (
          <>
            <GenerationHistoryPanel
              refreshNonce={historyRefreshNonce}
              serviceType="novelai"
              workflowId={null}
            />

            <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
              <Button
                type="button"
                size="sm"
                className="theme-floating-panel pointer-events-auto w-[30vw] min-w-[112px] max-w-[180px] shadow-[0_18px_48px_rgba(0,0,0,0.35)]"
                onClick={() => setIsControllerOpen(true)}
              >
                <SlidersHorizontal className="h-4 w-4" />
                {controllerLabel}
              </Button>
            </div>

            <GenerationControllerSheet open={isControllerOpen} title={controllerLabel} onClose={() => setIsControllerOpen(false)}>
              {controllerPanel}
            </GenerationControllerSheet>
          </>
        ) : (
          <div className="min-w-0">{controllerPanel}</div>
        )
      ) : null}
    </div>
  )
}
