import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, ChevronDown, Play, RotateCcw, Save, Settings2 } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { ScrubbableNumberInput } from '@/components/ui/scrubbable-number-input'
import type { ComfyUIServer, WorkflowMarkedField } from '@/lib/api'
import { cn } from '@/lib/utils'
import { type ComfyUIServerTestState, type SelectedImageDraft, type WorkflowFieldDraftValue } from '../image-generation-shared'
import { CompactGenerationActionSurface, GenerationControllerFieldStack } from './shared-generation-controller'
import { WorkflowFieldDisclosureCard } from './workflow-field-disclosure-card'

type WorkflowTargetOption = {
  value: string
  label: string
  description?: string
}

/** Render one styled workflow-target selector with a portal menu so it is not clipped by controller chrome. */
function WorkflowTargetSelect({
  value,
  options,
  disabled = false,
  buttonClassName,
  menuMinWidth = 220,
  onChange,
}: {
  value: string
  options: WorkflowTargetOption[]
  disabled?: boolean
  buttonClassName?: string
  menuMinWidth?: number
  onChange: (value: string) => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [menuRect, setMenuRect] = useState<{ left: number; top: number; width: number } | null>(null)
  const triggerRef = useRef<HTMLDivElement | null>(null)
  const selectedOption = options.find((option) => option.value === value) ?? options[0] ?? null

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const updateMenuRect = () => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (!rect) {
        return
      }

      setMenuRect({
        left: rect.left,
        top: rect.bottom + 6,
        width: rect.width,
      })
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (triggerRef.current?.contains(target)) {
        return
      }

      const menuElement = document.getElementById('comfy-workflow-target-select-menu')
      if (menuElement?.contains(target)) {
        return
      }

      setIsOpen(false)
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    updateMenuRect()
    window.addEventListener('resize', updateMenuRect)
    window.addEventListener('scroll', updateMenuRect, true)
    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleEscape)

    return () => {
      window.removeEventListener('resize', updateMenuRect)
      window.removeEventListener('scroll', updateMenuRect, true)
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen])

  return (
    <>
      <div ref={triggerRef} className="min-w-0">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || options.length === 0}
          onClick={() => setIsOpen((current) => !current)}
          className={cn('w-full justify-between rounded-none border-0 bg-transparent px-2 text-xs text-foreground shadow-none', buttonClassName)}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          title={selectedOption?.description ? `${selectedOption.label} · ${selectedOption.description}` : selectedOption?.label}
        >
          <span className="min-w-0 truncate">{selectedOption?.label ?? '선택'}</span>
          <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-180')} />
        </Button>
      </div>

      {isOpen && menuRect && typeof document !== 'undefined'
        ? createPortal(
            <div
              id="comfy-workflow-target-select-menu"
              className="fixed z-[120] overflow-hidden rounded-sm border border-border/80 bg-background/95 p-1 shadow-[0_18px_48px_rgba(0,0,0,0.35)] backdrop-blur-md"
              style={{
                left: menuRect.left,
                top: menuRect.top,
                width: Math.max(menuRect.width, menuMinWidth),
              }}
              role="listbox"
              aria-label="생성 타겟 선택"
            >
              {options.map((option) => {
                const isSelected = option.value === value
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={cn(
                      'flex w-full items-center justify-between gap-3 rounded-sm px-3 py-2 text-left text-sm transition-colors',
                      isSelected ? 'bg-surface-high text-foreground' : 'text-muted-foreground hover:bg-surface-high/70 hover:text-foreground',
                    )}
                    onClick={() => {
                      onChange(option.value)
                      setIsOpen(false)
                    }}
                  >
                    <span className="min-w-0 truncate">{option.label}</span>
                    {option.description ? <span className="shrink-0 text-[11px] text-muted-foreground">{option.description}</span> : null}
                  </button>
                )
              })}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}

type ComfyWorkflowControllerPanelProps = {
  workflowName: string
  workflowDescription?: string
  workflowFields: WorkflowMarkedField[]
  servers: ComfyUIServer[]
  serverTests: Record<number, ComfyUIServerTestState>
  selectedTarget: string
  workflowDraft: Record<string, WorkflowFieldDraftValue>
  queueRegistrationCount: string
  isGenerating: boolean
  splitPaneScroll?: boolean
  headerPortalTargetId?: string
  compactActionBarContentTargetId?: string
  onBack: () => void
  onSelectTarget: (target: string) => void
  onQueueRegistrationCountChange: (value: string) => void
  onFieldChange: (fieldId: string, value: WorkflowFieldDraftValue) => void
  onImageChange: (fieldId: string, image?: SelectedImageDraft) => Promise<void> | void
  onOpenModuleSave: () => void
  onOpenSaveOptions: () => void
  onResetDraft: () => void
  onGenerateSelected: () => void
}

/** Render the ComfyUI workflow form with compact top actions and simplified server targeting. */
export function ComfyWorkflowControllerPanel({
  workflowName,
  workflowDescription,
  workflowFields,
  servers,
  serverTests,
  selectedTarget,
  workflowDraft,
  queueRegistrationCount,
  isGenerating,
  splitPaneScroll = false,
  headerPortalTargetId,
  compactActionBarContentTargetId,
  onBack,
  onSelectTarget,
  onQueueRegistrationCountChange,
  onFieldChange,
  onImageChange,
  onOpenModuleSave,
  onOpenSaveOptions,
  onResetDraft,
  onGenerateSelected,
}: ComfyWorkflowControllerPanelProps) {
  const connectedServers = servers.filter((server) => serverTests[server.id]?.status?.is_connected === true)
  const routingTags = Array.from(new Set(servers.flatMap((server) => server.routing_tags ?? []))).sort((left, right) => left.localeCompare(right))
  const selectedServer = selectedTarget.startsWith('server:')
    ? servers.find((server) => server.id === Number(selectedTarget.slice('server:'.length))) ?? null
    : null
  const [, setPortalRevision] = useState(0)
  const useDrawerCompactChrome = Boolean(headerPortalTargetId)

  useEffect(() => {
    if ((!headerPortalTargetId && !compactActionBarContentTargetId) || typeof document === 'undefined') {
      return
    }

    const frame = window.requestAnimationFrame(() => {
      setPortalRevision((current) => current + 1)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [compactActionBarContentTargetId, headerPortalTargetId])

  const headerPortalTarget = headerPortalTargetId && typeof document !== 'undefined'
    ? document.getElementById(headerPortalTargetId)
    : null
  const compactActionBarPortalTarget = compactActionBarContentTargetId && typeof document !== 'undefined'
    ? document.getElementById(compactActionBarContentTargetId)
    : null

  const selectedTag = selectedTarget.startsWith('tag:') ? selectedTarget.slice('tag:'.length) : null
  const selectedTagConnectedServers = selectedTag
    ? connectedServers.filter((server) => (server.routing_tags ?? []).includes(selectedTag))
    : []
  const canGenerateSelected = selectedTarget === 'auto'
    ? connectedServers.length > 0
    : selectedTag !== null
      ? selectedTagConnectedServers.length > 0
      : selectedServer
        ? serverTests[selectedServer.id]?.status?.is_connected === true
        : false
  const targetOptions = useMemo<WorkflowTargetOption[]>(() => {
    if (servers.length === 0) {
      return [{ value: 'auto', label: '서버 없음' }]
    }

    return [
      {
        value: 'auto',
        label: '자동 분산',
        description: connectedServers.length > 0 ? `연결 ${connectedServers.length}` : '연결 없음',
      },
      ...routingTags.map((tag) => {
        const connectedCount = connectedServers.filter((server) => (server.routing_tags ?? []).includes(tag)).length
        return {
          value: `tag:${tag}`,
          label: `#${tag}`,
          description: connectedCount > 0 ? `연결 ${connectedCount}` : '연결 없음',
        }
      }),
      ...servers.map((server) => {
        const connectionStatus = serverTests[server.id]?.status
        const statusLabel = connectionStatus?.is_connected === true
          ? connectionStatus.is_idle
            ? 'idle'
            : `실행 ${connectionStatus.running_count ?? 0} · 대기 ${connectionStatus.pending_count ?? 0}`
          : connectionStatus
            ? '실패'
            : '미확인'

        return {
          value: `server:${server.id}`,
          label: server.name,
          description: statusLabel,
        }
      }),
    ]
  }, [connectedServers, routingTags, serverTests, servers])

  const desktopActionButtons = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Button
        type="button"
        size="icon-sm"
        variant="outline"
        onClick={onOpenModuleSave}
        disabled={isGenerating}
        aria-label="모듈 저장"
        title="모듈 저장"
      >
        <Save className="h-4 w-4" />
      </Button>

      <CompactGenerationActionSurface className="max-w-full">
        <div className="w-[168px] shrink-0 border-r border-border/70 px-1 sm:w-[220px]">
          <WorkflowTargetSelect
            value={selectedTarget}
            options={targetOptions}
            disabled={servers.length === 0 || isGenerating}
            buttonClassName="h-10 w-full min-w-0"
            onChange={onSelectTarget}
          />
        </div>

        <ScrubbableNumberInput
          min={1}
          max={32}
          step={1}
          scrubRatio={1}
          variant="detail"
          className="h-9 w-[72px] shrink-0 !rounded-none !border-0 !bg-transparent px-2 text-center text-xs"
          value={queueRegistrationCount}
          onChange={onQueueRegistrationCountChange}
          disabled={isGenerating || workflowFields.length === 0}
          aria-label="큐 등록 개수"
          inputMode="numeric"
        />

        <Button
          type="button"
          size="icon-sm"
          onClick={onGenerateSelected}
          disabled={isGenerating || workflowFields.length === 0 || !canGenerateSelected}
          aria-label={isGenerating ? '큐 등록 중' : `큐 등록 ${queueRegistrationCount}회`}
          title={isGenerating ? '큐 등록 중' : `큐 등록 ${queueRegistrationCount}회`}
          className="rounded-none border-l border-border/70 shadow-none"
        >
          <Play className="h-4 w-4 fill-current" />
        </Button>

        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          onClick={onOpenSaveOptions}
          disabled={isGenerating || workflowFields.length === 0}
          aria-label="생성 결과 저장 옵션"
          title="생성 결과 저장 옵션"
          className="rounded-none border-l border-border/70 shadow-none"
        >
          <Settings2 className="h-4 w-4" />
        </Button>
      </CompactGenerationActionSurface>
    </div>
  )

  const desktopHeaderContent = (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onBack}
          aria-label="워크플로우 목록으로 돌아가기"
          title="처음으로"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>

        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="text-base font-semibold text-foreground">{workflowName}</div>
          {workflowDescription ? <div className="text-sm text-muted-foreground">{workflowDescription}</div> : null}
        </div>

        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          onClick={onResetDraft}
          disabled={isGenerating || workflowFields.length === 0}
          aria-label="워크플로우 설정 초기화"
          title="워크플로우 설정 초기화"
        >
          <RotateCcw className="h-4 w-4" />
        </Button>
      </div>

      {desktopActionButtons}
    </div>
  )

  const drawerHeaderContent = (
    <div className="flex items-center gap-3">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={onBack}
        aria-label="워크플로우 목록으로 돌아가기"
        title="처음으로"
      >
        <ArrowLeft className="h-4 w-4" />
      </Button>
      <div className="min-w-0 flex-1 truncate text-base font-semibold text-foreground">{workflowName}</div>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        onClick={onResetDraft}
        disabled={isGenerating || workflowFields.length === 0}
        aria-label="워크플로우 설정 초기화"
        title="워크플로우 설정 초기화"
      >
        <RotateCcw className="h-4 w-4" />
      </Button>
    </div>
  )

  const compactActionBarContent = (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        size="icon-sm"
        variant="outline"
        onClick={onOpenModuleSave}
        disabled={isGenerating}
        aria-label="모듈 저장"
        title="모듈 저장"
      >
        <Save className="h-4 w-4" />
      </Button>

      <CompactGenerationActionSurface className="max-w-full">
        {servers.length > 0 ? (
          <div className="w-[144px] shrink-0 border-r border-border/70 px-1">
            <WorkflowTargetSelect
              value={selectedTarget}
              options={targetOptions}
              disabled={isGenerating}
              buttonClassName="h-8 w-full min-w-0"
              menuMinWidth={180}
              onChange={onSelectTarget}
            />
          </div>
        ) : null}

        <ScrubbableNumberInput
          min={1}
          max={32}
          step={1}
          scrubRatio={1}
          variant="detail"
          className="h-8 w-[54px] shrink-0 !rounded-none !border-0 !bg-transparent px-0 text-center text-xs"
          value={queueRegistrationCount}
          onChange={onQueueRegistrationCountChange}
          disabled={isGenerating || workflowFields.length === 0}
          aria-label="큐 등록 개수"
          inputMode="numeric"
        />

        <Button
          type="button"
          size="icon-sm"
          onClick={onGenerateSelected}
          disabled={isGenerating || workflowFields.length === 0 || !canGenerateSelected}
          aria-label={isGenerating ? '큐 등록 중' : `큐 등록 ${queueRegistrationCount}회`}
          title={isGenerating ? '큐 등록 중' : `큐 등록 ${queueRegistrationCount}회`}
          className="rounded-none border-l border-border/70 shadow-none"
        >
          <Play className="h-4 w-4 fill-current" />
        </Button>

        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          onClick={onOpenSaveOptions}
          disabled={isGenerating || workflowFields.length === 0}
          aria-label="생성 결과 저장 옵션"
          title="생성 결과 저장 옵션"
          className="rounded-none border-l border-border/70 shadow-none"
        >
          <Settings2 className="h-4 w-4" />
        </Button>
      </CompactGenerationActionSurface>
    </div>
  )

  return (
    <section className={cn(splitPaneScroll ? 'flex min-h-0 flex-1 flex-col gap-6' : 'space-y-6')}>
      {useDrawerCompactChrome
        ? (headerPortalTarget ? createPortal(drawerHeaderContent, headerPortalTarget) : null)
        : (
          <div className="space-y-3 border-b border-border/70 pb-4">
            {desktopHeaderContent}
          </div>
        )}

      <div className={cn(
        'space-y-6',
        splitPaneScroll && 'min-h-0 flex-1 overflow-y-auto pr-2 pb-1',
        useDrawerCompactChrome ? 'px-0 pt-0 pb-5' : undefined,
      )}>
        {servers.length === 0 ? (
          <Alert>
            <AlertTitle>서버 필요</AlertTitle>
            <AlertDescription>서버를 먼저 등록해줘.</AlertDescription>
          </Alert>
        ) : null}

        <section className="space-y-3 px-4">
          {workflowFields.length > 0 ? (
            <GenerationControllerFieldStack>
              {workflowFields.map((field) => (
                <WorkflowFieldDisclosureCard
                  key={field.id}
                  field={field}
                  value={workflowDraft[field.id] ?? ''}
                  onChange={(value) => onFieldChange(field.id, value)}
                  onImageChange={(image) => onImageChange(field.id, image)}
                />
              ))}
            </GenerationControllerFieldStack>
          ) : (
            <Alert>
              <AlertTitle>입력 필드 없음</AlertTitle>
              <AlertDescription>노출된 필드가 없어.</AlertDescription>
            </Alert>
          )}
        </section>

        {useDrawerCompactChrome && compactActionBarPortalTarget ? createPortal(compactActionBarContent, compactActionBarPortalTarget) : null}
      </div>
    </section>
  )
}
