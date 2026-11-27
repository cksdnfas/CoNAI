import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, BookmarkPlus, Server } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Heading } from '@/components/ui/heading'
import { resolveFloatingLayer, type FloatingLayer } from '@/components/ui/floating-surface'
import { IconButton } from '@/components/ui/icon-button'
import { useOverlayBackClose } from '@/components/ui/use-overlay-back-close'
import { useI18n } from '@/i18n'
import type { ComfyUIServer, WorkflowMarkedField } from '@/lib/api-image-generation-types'
import { cn } from '@/lib/utils'
import { collectWorkflowNodeDraftIssues, hasWorkflowFieldValue } from '../image-generation-drafts'
import type { ComfyUIServerTestState, SelectedImageDraft, WorkflowFieldDraftValue } from '../image-generation-shared'
import { GenerationControllerFieldStack } from './shared-generation-controller'
import { GenerateActionBar, GenerateActionBarIconButton, GenerateActionDock } from './generate-action-bar'
import { usePortalTargetById } from './generation-toolbar-status'
import { IMAGE_GENERATION_TARGET_GROUP_KEY } from '@/features/groups/generation-target-group-store'
import { WorkflowFieldGroupList } from './workflow-field-group-list'
import { CharacterSettingLoadButton } from './character-setting-load-button'
import { ArtStyleLoadButton } from './art-style-load-button'
import { appendPromptText } from './prompt-text-segment-helpers'
import { formatWorkflowFieldLabel } from './workflow-field-disclosure-card'
import { floatingDropdownMenuClassName, getFloatingDropdownStyle, resolveFloatingDropdownRect, type FloatingDropdownRect } from './floating-dropdown-utils'
import {
  buildComfyWorkflowServerRoutingSummary,
  isComfyWorkflowModalServer,
  isComfyWorkflowServerRoutable,
} from './comfy-workflow-routing'
import { GenerationBlockLayout, StackedPluginBlocks } from '../layout/generation-block-layout'
import { useGenerationLayoutSurface } from '../layout/generation-layout-context'
import { stackedLayoutBlocks } from '../layout/generation-layout-ops'

type WorkflowTargetOption = {
  value: string
  label: string
  description?: string
}

/** Icon-only generation-target picker for the action bar; the portal menu is not clipped by controller chrome. */
function WorkflowTargetSelect({
  value,
  options,
  ready,
  disabled = false,
  menuMinWidth = 220,
  onChange,
}: {
  value: string
  options: WorkflowTargetOption[]
  /** Whether the selected target can take a job right now (status dot on the icon). */
  ready: boolean
  disabled?: boolean
  menuMinWidth?: number
  onChange: (value: string) => void
}) {
  const { t } = useI18n()
  const [isOpen, setIsOpen] = useState(false)
  const [menuRect, setMenuRect] = useState<FloatingDropdownRect | null>(null)
  const [menuLayer, setMenuLayer] = useState<FloatingLayer>('popover')
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
      setMenuLayer(resolveFloatingLayer(triggerElement))
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
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault()
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

  const selectedText = selectedOption
    ? (selectedOption.description ? `${selectedOption.label} · ${selectedOption.description}` : selectedOption.label)
    : t({ ko: '선택 안 됨', en: 'None' })
  const triggerLabel = t({ ko: '생성 서버: {target}', en: 'Generation server: {target}' }, { target: selectedText })

  return (
    <>
      <div ref={triggerRef} className="inline-flex shrink-0">
        <GenerateActionBarIconButton
          label={triggerLabel}
          disabled={disabled || options.length === 0}
          onClick={() => setIsOpen((current) => !current)}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          className="relative"
        >
          <Server />
          <span
            aria-hidden="true"
            className={cn('absolute top-1.5 right-1.5 size-1.5 rounded-full', ready ? 'bg-success' : 'bg-destructive')}
          />
        </GenerateActionBarIconButton>
      </div>

      {isOpen && menuRect && typeof document !== 'undefined'
        ? createPortal(
            <div
              id="comfy-workflow-target-select-menu"
              data-surface="high"
              className={cn(floatingDropdownMenuClassName(menuLayer), 'overflow-auto p-1')}
              style={getFloatingDropdownStyle(menuRect)}
              role="listbox"
              aria-label={t({ ko: '생성 타겟 선택', en: 'Select generation target' })}
            >
              {options.map((option) => {
                const isSelected = option.value === value
                return (
                  <Button
                    key={option.value}
                    type="button"
                    variant="nav"
                    size="sm"
                    role="option"
                    aria-selected={isSelected}
                    data-active={isSelected || undefined}
                    className="justify-between"
                    onClick={() => {
                      onChange(option.value)
                      setIsOpen(false)
                    }}
                  >
                    <span className="min-w-0 truncate">{option.label}</span>
                    {option.description ? <span className="shrink-0 text-2xs text-muted-foreground">{option.description}</span> : null}
                  </Button>
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
  loraOptions?: string[]
  isRefreshingDropdownLists?: boolean
  /** Per-field messages from the last failed generate validation. */
  fieldIssues?: Record<string, string>
  /** The workflow only saves a RefMod (DaSiWa export node): the Director runs without a model connection. */
  refModExportOnly?: boolean
  /** Whether the workflow only saves a RefMod is still loading; the model-connection issue waits for it. */
  refModExportPending?: boolean
  /** Loading the workflow detail that decides `refModExportOnly` failed. */
  refModExportError?: string | null
  splitPaneScroll?: boolean
  compactActionBarContentTargetId?: string
  /** Wide page: render the form and `result` as the shared block layout instead of a single scroll column. */
  blockLayout?: { result: ReactNode }
  /** The `filename` layout block (the stored name of results); omitted on public pages, whose visitors never name server files. */
  fileNameField?: ReactNode
  onBack: () => void
  onSelectTarget: (target: string) => void
  onQueueRegistrationCountChange: (value: string) => void
  onFieldChange: (fieldId: string, value: WorkflowFieldDraftValue) => void
  onImageChange: (fieldId: string, image?: SelectedImageDraft) => Promise<void> | void
  onRefreshDropdownLists?: () => Promise<void> | void
  /** Omitted where the viewer cannot author modules (public pages): no save-as-module action. */
  onOpenModuleSave?: () => void
  onOpenCreateServer?: () => void
  /**
   * False when the server picks the ComfyUI target itself (public pages): no target picker and no server readiness checks.
   * The page still sends the job; the server answers if nothing can run it.
   */
  serverRouting?: boolean
  /** Upper bound of the repeat counter (public pages can lower it). */
  queueMaxCount?: number
  /** Extra message above the fields, e.g. the viewer's queue limit on a public page. */
  notice?: ReactNode
  onResetDraft: () => void
  onGenerateSelected: () => void
  /** Mark and focus the fields behind the readiness issues without submitting. */
  onRevealFieldIssues?: () => void
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
  loraOptions,
  isRefreshingDropdownLists = false,
  fieldIssues,
  refModExportOnly = false,
  refModExportPending = false,
  refModExportError = null,
  splitPaneScroll = false,
  compactActionBarContentTargetId,
  blockLayout,
  fileNameField,
  onBack,
  onSelectTarget,
  onQueueRegistrationCountChange,
  onFieldChange,
  onImageChange,
  onRefreshDropdownLists,
  onOpenModuleSave,
  onOpenCreateServer,
  serverRouting = true,
  queueMaxCount = 32,
  notice,
  onResetDraft,
  onGenerateSelected,
  onRevealFieldIssues,
}: ComfyWorkflowControllerPanelProps) {
  const { t } = useI18n()
  const routingSummary = useMemo(
    () => buildComfyWorkflowServerRoutingSummary(servers, serverTests),
    [serverTests, servers],
  )
  const selectedServer = selectedTarget.startsWith('server:')
    ? routingSummary.serverById.get(Number(selectedTarget.slice('server:'.length))) ?? null
    : null
  const useStickyActionBar = Boolean(compactActionBarContentTargetId) && !splitPaneScroll
  const compactActionBarPortalTarget = usePortalTargetById(compactActionBarContentTargetId)

  const selectedTag = selectedTarget.startsWith('tag:') ? selectedTarget.slice('tag:'.length) : null
  const selectedTagRoutableCount = selectedTag
    ? routingSummary.tagRoutableCounts.get(selectedTag) ?? 0
    : 0
  const routingCanGenerate = !serverRouting ? true : selectedTarget === 'auto'
    ? routingSummary.autoRoutableCount > 0
    : selectedTag !== null
      ? selectedTagRoutableCount > 0
      : selectedServer
        ? isComfyWorkflowServerRoutable(selectedServer, serverTests[selectedServer.id])
        : false
  // "캐릭터 불러오기": tags go into a marked text field, the reference optionally into a marked image field.
  const characterTextTargets = workflowFields.filter((field) => field.type === 'text' || field.type === 'textarea').map((field) => ({ id: field.id, label: formatWorkflowFieldLabel(field) }))
  const characterImageTargets = workflowFields.filter((field) => field.type === 'image').map((field) => ({ id: field.id, label: formatWorkflowFieldLabel(field) }))
  // "스타일 불러오기" uses the same fields; a field named like a negative prompt starts as the negative target and last as a positive one.
  const negativeLike = (target: { id: string; label: string }) => /negative|부정|네거티브/i.test(`${target.id} ${target.label}`)
  const stylePositiveTargets = [...characterTextTargets.filter((target) => !negativeLike(target)), ...characterTextTargets.filter(negativeLike)]
  const styleNegativeTargetId = characterTextTargets.find(negativeLike)?.id ?? null
  const missingRequiredFields = useMemo(
    () => workflowFields.filter((field) => field.required && !hasWorkflowFieldValue(workflowDraft[field.id])),
    [workflowDraft, workflowFields],
  )
  const workflowNodeIssues = useMemo(
    () => collectWorkflowNodeDraftIssues(workflowFields, workflowDraft, { refModExportOnly: refModExportOnly || refModExportPending }),
    [refModExportOnly, refModExportPending, workflowDraft, workflowFields],
  )
  const queueRegistrationNumber = Number(queueRegistrationCount)
  const queueRegistrationCountValid = Number.isInteger(queueRegistrationNumber) && queueRegistrationNumber >= 1 && queueRegistrationNumber <= queueMaxCount
  const readinessIssues = useMemo(() => {
    const issues: string[] = []

    if (workflowFields.length === 0) {
      issues.push(t({ ko: '노출된 입력 필드가 없어.', en: 'This workflow has no exposed input fields.' }))
    }

    if (missingRequiredFields.length > 0) {
      const labels = missingRequiredFields.slice(0, 3).map(formatWorkflowFieldLabel).join(', ')
      const suffix = missingRequiredFields.length > 3
        ? t({ ko: ' 외 {count}개', en: ' and {count} more' }, { count: missingRequiredFields.length - 3 })
        : ''
      issues.push(t({ ko: '필수 입력 누락: {labels}{suffix}', en: 'Missing required inputs: {labels}{suffix}' }, { labels, suffix }))
    }

    if (!serverRouting) {
      // The server routes the job; nothing to check here.
    } else if (servers.length === 0) {
      issues.push(t({ ko: '활성 ComfyUI 서버가 없어.', en: 'No active ComfyUI servers.' }))
    } else if (!routingCanGenerate) {
      if (selectedTarget === 'auto') {
        issues.push(t({ ko: '자동 분산 가능한 ComfyUI 서버가 없어. 연결 테스트나 서버 선택을 확인해.', en: 'No connected ComfyUI server for auto routing. Test or select a server.' }))
      } else if (selectedTag) {
        issues.push(t({ ko: '#{tag} 태그에 사용 가능한 서버가 없어.', en: 'No available server for #{tag}.' }, { tag: selectedTag }))
      } else {
        issues.push(t({ ko: '선택한 서버를 사용할 수 없어. 연결 상태를 확인해.', en: 'The selected server is not ready. Check its connection.' }))
      }
    }

    if (!queueRegistrationCountValid) {
      issues.push(t({ ko: '큐 등록 개수는 1~{max} 정수여야 해.', en: 'Queue count must be an integer from 1 to {max}.' }, { max: queueMaxCount }))
    }

    if (refModExportError !== null) {
      issues.push(t(
        { ko: '워크플로 정보 확인 실패: {message}', en: 'Could not check workflow details: {message}' },
        { message: refModExportError },
      ))
    }

    if (workflowNodeIssues.length > 0) {
      // A one-line summary: the Director lists all of its problems in its own panel.
      const firstIssue = workflowNodeIssues[0]
      issues.push(t(
        { ko: '{label}: {message}', en: '{label}: {message}' },
        { label: formatWorkflowFieldLabel(firstIssue.field), message: t({ ko: firstIssue.issue.ko, en: firstIssue.issue.en }) },
      ))
    }

    return issues
  }, [missingRequiredFields, queueMaxCount, queueRegistrationCountValid, refModExportError, routingCanGenerate, selectedTag, selectedTarget, serverRouting, servers.length, t, workflowFields.length, workflowNodeIssues])
  const canGenerateSelected = routingCanGenerate && missingRequiredFields.length === 0 && workflowNodeIssues.length === 0 && queueRegistrationCountValid && !refModExportPending
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

  const generateLabel = t({ ko: '생성', en: 'Generate' })
  const generatingLabel = t({ ko: '큐 등록 중…', en: 'Queueing…' })
  const generateDisabled = workflowFields.length === 0 || !canGenerateSelected
  const queueRepeat = {
    value: queueRegistrationCount,
    min: 1,
    max: queueMaxCount,
    onChange: onQueueRegistrationCountChange,
    disabled: workflowFields.length === 0,
  }
  const saveModuleLabel = t({ ko: '모듈로 저장', en: 'Save as module' })
  const saveModuleAction = onOpenModuleSave ? (
    <GenerateActionBarIconButton type="button" label={saveModuleLabel} onClick={onOpenModuleSave} disabled={isGenerating}>
      <BookmarkPlus />
    </GenerateActionBarIconButton>
  ) : null
  const resetLabel = t({ ko: '워크플로우 설정 초기화', en: 'Reset workflow settings' })

  const inlineActionBar = (
    <GenerateActionBar
      variant="inline"
      generateLabel={generateLabel}
      generatingLabel={generatingLabel}
      onGenerate={onGenerateSelected}
      generateDisabled={generateDisabled}
      isGenerating={isGenerating}
      repeat={queueRepeat}
      secondaryActions={saveModuleAction}
      onReset={workflowFields.length > 0 ? onResetDraft : undefined}
      resetLabel={resetLabel}
      leading={serverRouting && servers.length > 0 ? (
        <WorkflowTargetSelect
          value={selectedTarget}
          options={targetOptions}
          ready={routingCanGenerate}
          disabled={isGenerating}
          onChange={onSelectTarget}
        />
      ) : null}
      targetGroupStorageKey={IMAGE_GENERATION_TARGET_GROUP_KEY}
    />
  )

  const desktopHeaderContent = (
    <div>
      <div className="flex items-center gap-3">
        <IconButton
          variant="ghost"
          size="icon-sm"
          onClick={onBack}
          label={t({ ko: '워크플로우 목록으로 돌아가기', en: 'Back to workflow list' })}
        >
          <ArrowLeft />
        </IconButton>

        <div className="min-w-0 flex-1">
          <Heading level={3} as="div" className="truncate" title={workflowDescription || undefined}>{workflowName}</Heading>
        </div>
      </div>
    </div>
  )

  const compactActionBarContent = (
    <GenerateActionBar
      variant="sticky"
      generateLabel={generateLabel}
      generatingLabel={generatingLabel}
      onGenerate={onGenerateSelected}
      generateDisabled={generateDisabled}
      isGenerating={isGenerating}
      repeat={queueRepeat}
      secondaryActions={saveModuleAction}
      onReset={workflowFields.length === 0 ? undefined : onResetDraft}
      resetLabel={resetLabel}
      leading={serverRouting && servers.length > 0 ? (
        <WorkflowTargetSelect
          value={selectedTarget}
          options={targetOptions}
          ready={routingCanGenerate}
          disabled={isGenerating}
          menuMinWidth={180}
          onChange={onSelectTarget}
        />
      ) : null}
      targetGroupStorageKey={IMAGE_GENERATION_TARGET_GROUP_KEY}
    />
  )

  const fieldsContent = (
    <div className="space-y-6">
      {notice}
      {serverRouting && servers.length === 0 ? (
        <EmptyState
          size="compact"
          title={t({ ko: '활성 ComfyUI 서버가 없어', en: 'No active ComfyUI servers' })}
          action={onOpenCreateServer ? <Button size="sm" onClick={onOpenCreateServer}>{t({ ko: '서버 등록', en: 'Register server' })}</Button> : undefined}
        />
      ) : null}

      {readinessIssues.length > 0 ? (
        // From md up it pins to the top of whichever container scrolls so the reason Generate is blocked stays in view; on phones it stays in the flow so it never covers the form.
        <div className={cn('md:sticky md:z-sticky', splitPaneScroll || blockLayout ? 'md:top-0' : 'md:top-[calc(var(--theme-shell-header-height)+0.5rem)]')}>
          <Alert variant="destructive">
            <AlertTitle>{t({ ko: '실행 준비 필요', en: 'Run readiness needs attention' })}</AlertTitle>
            <AlertDescription>
              <ul className="list-disc space-y-1 pl-4">
                {readinessIssues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
              {onRevealFieldIssues && (missingRequiredFields.length > 0 || workflowNodeIssues.length > 0) ? (
                <Button type="button" size="sm" variant="secondary" className="mt-2" onClick={onRevealFieldIssues}>
                  {t({ ko: '문제 필드로 이동', en: 'Go to invalid field' })}
                </Button>
              ) : null}
            </AlertDescription>
          </Alert>
        </div>
      ) : null}

      <section className="space-y-3">
        {characterTextTargets.length > 0 ? (
          <div className="flex justify-end gap-1">
            <CharacterSettingLoadButton
              label={t({ ko: '캐릭터 불러오기', en: 'Load character' })}
              textTargets={characterTextTargets}
              referenceTargets={characterImageTargets}
              onLoad={({ appearance, textTargetId, references: [reference], referenceTarget }) => {
                if (appearance && textTargetId) {
                  const current = workflowDraft[textTargetId]
                  onFieldChange(textTargetId, appendPromptText(typeof current === 'string' || Array.isArray(current) ? current : '', appearance))
                }
                if (reference && referenceTarget) void onImageChange(referenceTarget.id, reference)
              }}
            />
            <ArtStyleLoadButton
              positiveTargets={stylePositiveTargets}
              negativeTargets={characterTextTargets}
              defaultNegativeTargetId={styleNegativeTargetId}
              referenceTargets={characterImageTargets}
              onLoad={({ positive, negative, positiveTargetId, negativeTargetId, references: [reference], referenceTarget }) => {
                // Both prompts may go into the same field: append to what the first one wrote.
                const written: Record<string, WorkflowFieldDraftValue> = {}
                for (const [fieldId, text] of [[positiveTargetId, positive], [negativeTargetId, negative]] as const) {
                  if (!fieldId || !text) continue
                  const current = written[fieldId] ?? workflowDraft[fieldId]
                  written[fieldId] = appendPromptText(typeof current === 'string' || Array.isArray(current) ? current : '', text)
                }
                for (const [fieldId, value] of Object.entries(written)) onFieldChange(fieldId, value)
                if (reference && referenceTarget) void onImageChange(referenceTarget.id, reference)
              }}
            />
          </div>
        ) : null}
        {workflowFields.length > 0 ? (
          <GenerationControllerFieldStack>
            <WorkflowFieldGroupList
              fields={workflowFields}
              values={workflowDraft}
              loraOptions={loraOptions}
              isRefreshingOptions={isRefreshingDropdownLists}
              onRefreshOptions={onRefreshDropdownLists}
              fieldIssues={fieldIssues}
              comfyServerId={selectedServer?.id}
              refModExportOnly={refModExportOnly}
              onChange={onFieldChange}
              onImageChange={onImageChange}
            />
          </GenerationControllerFieldStack>
        ) : (
          <EmptyState size="compact" title={t({ ko: '노출된 입력 필드 없음', en: 'No exposed input fields' })} />
        )}
      </section>
    </div>
  )

  // Narrow screens follow the preset's order of the name row and the fields; the generate bar keeps its own slot.
  const { preset: layoutPreset } = useGenerationLayoutSurface('comfy')
  const stackedBlocks = stackedLayoutBlocks(layoutPreset)
  const workflowAfterFields = stackedBlocks.indexOf('workflow') > stackedBlocks.indexOf('fields')
  // The name row follows the preset too: above the workflow header when it comes first, else on top of the fields.
  const fileNameAt = !fileNameField || !stackedBlocks.includes('filename') ? null
    : !workflowAfterFields && stackedBlocks.indexOf('filename') < stackedBlocks.indexOf('workflow') ? 'header' : 'fields'

  if (blockLayout) {
    return (
      <GenerationBlockLayout surface="comfy" blocks={{ filename: fileNameField, workflow: desktopHeaderContent, fields: fieldsContent, action: inlineActionBar, result: blockLayout.result }} />
    )
  }

  return (
    <section className={cn(splitPaneScroll ? 'flex min-h-0 flex-1 flex-col gap-6' : 'space-y-6')}>
      {workflowAfterFields ? null : (
          <div className="shrink-0 space-y-3">
            {fileNameAt === 'header' ? fileNameField : null}
            {desktopHeaderContent}
          </div>
        )}

      <div className={cn(
        'space-y-6',
        splitPaneScroll && 'min-h-0 flex-1 overflow-y-auto pr-2 pb-1',
      )}>
        {fileNameAt === 'fields' ? fileNameField : null}
        {fieldsContent}
        {workflowAfterFields ? desktopHeaderContent : null}
        <StackedPluginBlocks surface="comfy" />

        {useStickyActionBar && compactActionBarPortalTarget ? createPortal(compactActionBarContent, compactActionBarPortalTarget) : null}
      </div>

      {/* 생성 버튼·서버·결과 그룹은 필드 아래에 고정해 스크롤 위치와 상관없이 바로 누를 수 있게 한다. */}
      {useStickyActionBar ? null : <GenerateActionDock>{inlineActionBar}</GenerateActionDock>}
    </section>
  )
}
