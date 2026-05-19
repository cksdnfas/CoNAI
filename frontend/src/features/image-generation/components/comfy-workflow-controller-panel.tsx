import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, ChevronDown, Play, RotateCcw, Save } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { ScrubbableNumberInput } from '@/components/ui/scrubbable-number-input'
import { useOverlayBackClose } from '@/components/ui/use-overlay-back-close'
import { useI18n } from '@/i18n'
import type { ComfyUIServer, WorkflowMarkedField } from '@/lib/api-image-generation-types'
import { cn } from '@/lib/utils'
import { type ComfyUIServerTestState, type SelectedImageDraft, type WorkflowFieldDraftValue } from '../image-generation-shared'
import { CompactGenerationActionSurface, GenerationControllerFieldStack } from './shared-generation-controller'
import { WorkflowFieldDisclosureCard } from './workflow-field-disclosure-card'
import { FLOATING_DROPDOWN_MENU_CLASS, getFloatingDropdownItemClassName, resolveFloatingDropdownRect, type FloatingDropdownRect } from './floating-dropdown-utils'
import {
  buildComfyWorkflowServerRoutingSummary,
  isComfyWorkflowModalServer,
  isComfyWorkflowServerRoutable,
} from './comfy-workflow-routing'

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
  const { t } = useI18n()
  const [isOpen, setIsOpen] = useState(false)
  const [menuRect, setMenuRect] = useState<FloatingDropdownRect | null>(null)
  const triggerRef = useRef<HTMLDivElement | null>(null)
  const selectedOption = options.find((option) => option.value === value) ?? options[0] ?? null

  useOverlayBackClose({ open: isOpen, onClose: () => setIsOpen(false) })

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const updateMenuRect = () => {
      const triggerElement = triggerRef.current
      if (!triggerElement) {
        return
      }

      setMenuRect(resolveFloatingDropdownRect(triggerElement, { minWidth: menuMinWidth }))
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
  }, [isOpen, menuMinWidth])

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
          <span className="min-w-0 truncate">{selectedOption?.label ?? t({ ko: '선택', en: 'Select' })}</span>
          <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-180')} />
        </Button>
      </div>

      {isOpen && menuRect && typeof document !== 'undefined'
        ? createPortal(
            <div
              id="comfy-workflow-target-select-menu"
              className={cn(FLOATING_DROPDOWN_MENU_CLASS, 'overflow-auto p-1')}
              style={{
                left: menuRect.left,
                top: menuRect.top,
                width: menuRect.width,
                maxHeight: menuRect.maxHeight,
              }}
              role="listbox"
              aria-label={t({ ko: '생성 타겟 선택', en: 'Select generation target' })}
            >
              {options.map((option) => {
                const isSelected = option.value === value
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={getFloatingDropdownItemClassName({ selected: isSelected })}
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
  onResetDraft,
  onGenerateSelected,
}: ComfyWorkflowControllerPanelProps) {
  const { t } = useI18n()
  const routingSummary = useMemo(
    () => buildComfyWorkflowServerRoutingSummary(servers, serverTests),
    [serverTests, servers],
  )
  const selectedServer = selectedTarget.startsWith('server:')
    ? routingSummary.serverById.get(Number(selectedTarget.slice('server:'.length))) ?? null
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
  const selectedTagRoutableCount = selectedTag
    ? routingSummary.tagRoutableCounts.get(selectedTag) ?? 0
    : 0
  const canGenerateSelected = selectedTarget === 'auto'
    ? routingSummary.autoRoutableCount > 0
    : selectedTag !== null
      ? selectedTagRoutableCount > 0
      : selectedServer
        ? isComfyWorkflowServerRoutable(selectedServer, serverTests[selectedServer.id])
        : false
  const targetOptions = useMemo<WorkflowTargetOption[]>(() => {
    if (servers.length === 0) {
      return [{ value: 'auto', label: t({ ko: '서버 없음', en: 'No servers' }) }]
    }

    return [
      {
        value: 'auto',
        label: t({ ko: '자동 분산', en: 'Auto routing' }),
        description: routingSummary.autoRoutableCount > 0 ? t({ ko: '연결 {count}', en: '{count} connected' }, { count: routingSummary.autoRoutableCount }) : t({ ko: '연결 없음', en: 'Not connected' }),
      },
      ...routingSummary.routingTags.map((tag) => {
        const routableCount = routingSummary.tagRoutableCounts.get(tag) ?? 0
        return {
          value: `tag:${tag}`,
          label: `#${tag}`,
          description: routableCount > 0 ? t({ ko: '사용 가능 {count}', en: '{count} available' }, { count: routableCount }) : t({ ko: '연결 없음', en: 'Not connected' }),
        }
      }),
      ...servers.map((server) => {
        const connectionStatus = serverTests[server.id]?.status
        const statusLabel = isComfyWorkflowModalServer(server, serverTests[server.id])
          ? t({ ko: 'Modal · 생성 시 호출', en: 'Modal · Called on generation' })
          : connectionStatus?.is_connected === true
            ? connectionStatus.is_idle
              ? 'idle'
              : t({ ko: '실행 {running} · 대기 {pending}', en: 'Running {running} · Pending {pending}' }, { running: connectionStatus.running_count ?? 0, pending: connectionStatus.pending_count ?? 0 })
            : connectionStatus
              ? t({ ko: '실패', en: 'Failed' })
              : t({ ko: '미확인', en: 'Unchecked' })

        return {
          value: `server:${server.id}`,
          label: server.name,
          description: statusLabel,
        }
      }),
    ]
  }, [routingSummary, serverTests, servers, t])

  const desktopActionButtons = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Button
        type="button"
        size="icon-sm"
        variant="outline"
        onClick={onOpenModuleSave}
        disabled={isGenerating}
        aria-label={t({ ko: '모듈 저장', en: 'Save module' })}
        title={t({ ko: '모듈 저장', en: 'Save module' })}
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
          aria-label={t({ ko: '큐 등록 개수', en: 'Queue count' })}
          inputMode="numeric"
        />

        <Button
          type="button"
          size="icon-sm"
          onClick={onGenerateSelected}
          disabled={isGenerating || workflowFields.length === 0 || !canGenerateSelected}
          aria-label={isGenerating ? t({ ko: '큐 등록 중', en: 'Queueing' }) : t({ ko: '큐 등록 {count}회', en: 'Queue {count} times' }, { count: queueRegistrationCount })}
          title={isGenerating ? t({ ko: '큐 등록 중', en: 'Queueing' }) : t({ ko: '큐 등록 {count}회', en: 'Queue {count} times' }, { count: queueRegistrationCount })}
          className="rounded-none border-l border-border/70 shadow-none"
        >
          <Play className="h-4 w-4 fill-current" />
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
          aria-label={t({ ko: '워크플로우 목록으로 돌아가기', en: 'Back to workflow list' })}
          title={t({ ko: '처음으로', en: 'Back' })}
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
          aria-label={t({ ko: '워크플로우 설정 초기화', en: 'Reset workflow settings' })}
          title={t({ ko: '워크플로우 설정 초기화', en: 'Reset workflow settings' })}
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
        aria-label={t({ ko: '워크플로우 목록으로 돌아가기', en: 'Back to workflow list' })}
        title={t({ ko: '처음으로', en: 'Back' })}
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
        aria-label={t({ ko: '워크플로우 설정 초기화', en: 'Reset workflow settings' })}
        title={t({ ko: '워크플로우 설정 초기화', en: 'Reset workflow settings' })}
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
        aria-label={t({ ko: '모듈 저장', en: 'Save module' })}
        title={t({ ko: '모듈 저장', en: 'Save module' })}
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
          aria-label={t({ ko: '큐 등록 개수', en: 'Queue count' })}
          inputMode="numeric"
        />

        <Button
          type="button"
          size="icon-sm"
          onClick={onGenerateSelected}
          disabled={isGenerating || workflowFields.length === 0 || !canGenerateSelected}
          aria-label={isGenerating ? t({ ko: '큐 등록 중', en: 'Queueing' }) : t({ ko: '큐 등록 {count}회', en: 'Queue {count} times' }, { count: queueRegistrationCount })}
          title={isGenerating ? t({ ko: '큐 등록 중', en: 'Queueing' }) : t({ ko: '큐 등록 {count}회', en: 'Queue {count} times' }, { count: queueRegistrationCount })}
          className="rounded-none border-l border-border/70 shadow-none"
        >
          <Play className="h-4 w-4 fill-current" />
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
            <AlertTitle>{t({ ko: '서버 필요', en: 'Server required' })}</AlertTitle>
            <AlertDescription>{t({ ko: '서버를 먼저 등록해줘.', en: 'Register a server first.' })}</AlertDescription>
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
              <AlertTitle>{t({ ko: '입력 필드 없음', en: 'No input fields' })}</AlertTitle>
              <AlertDescription>{t({ ko: '노출된 필드가 없어.', en: 'There are no exposed fields.' })}</AlertDescription>
            </Alert>
          )}
        </section>

        {useDrawerCompactChrome && compactActionBarPortalTarget ? createPortal(compactActionBarContent, compactActionBarPortalTarget) : null}
      </div>
    </section>
  )
}
