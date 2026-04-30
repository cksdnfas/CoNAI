import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { ArrowLeft, Play, RotateCcw } from 'lucide-react'
import { BottomDrawerNotice, BottomDrawerSheet } from '@/components/ui/bottom-drawer-sheet'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrubbableNumberInput } from '@/components/ui/scrubbable-number-input'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { useI18n } from '@/i18n'
import { getAppSettings, getPublicGenerationWorkflow, queuePublicGenerationWorkflowJob, type WorkflowMarkedField } from '@/lib/api'
import { DEFAULT_IMAGE_SAVE_SETTINGS } from '@/lib/image-save-output'
import { useDesktopPageLayout } from '@/lib/use-desktop-page-layout'
import { cn } from '@/lib/utils'
import { refreshGenerationQueueViews } from './components/generation-queue-actions'
import { GenerationHistoryPanel } from './components/generation-history-panel'
import { CompactGenerationActionSurface, CompactGenerationControllerActionBar, GenerationControllerFieldStack } from './components/shared-generation-controller'
import { WorkflowArtifactExplorerPanel } from './components/workflow-artifact-explorer-panel'
import { WorkflowFieldDisclosureCard } from './components/workflow-field-disclosure-card'
import {
  buildWorkflowDraft,
  buildWorkflowPromptData,
  clearPersistedComfyWorkflowDraft,
  getErrorMessage,
  hasWorkflowFieldValue,
  loadPersistedComfyWorkflowDraft,
  parseNumberInput,
  persistComfyWorkflowDraft,
  type SelectedImageDraft,
  type WorkflowFieldDraftValue,
} from './image-generation-shared'

const PUBLIC_QUEUE_REGISTRATION_MIN = 1
const PUBLIC_QUEUE_REGISTRATION_MAX_FALLBACK = 32

function resolvePublicQueueMaxCount(value?: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return PUBLIC_QUEUE_REGISTRATION_MAX_FALLBACK
  }

  return Math.min(PUBLIC_QUEUE_REGISTRATION_MAX_FALLBACK, Math.max(PUBLIC_QUEUE_REGISTRATION_MIN, Math.trunc(value)))
}

function clampQueueRegistrationCount(value: string, maxCount: number) {
  const parsed = Math.trunc(parseNumberInput(value, PUBLIC_QUEUE_REGISTRATION_MIN))
  return Math.min(maxCount, Math.max(PUBLIC_QUEUE_REGISTRATION_MIN, parsed))
}

export function PublicComfyWorkflowPage() {
  const { slug = '' } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const isWideLayout = useDesktopPageLayout()
  const queryClient = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const { t } = useI18n()
  const authStatusQuery = useAuthStatusQuery()
  const [historyRefreshNonce, setHistoryRefreshNonce] = useState(0)
  const [queueRegistrationCount, setQueueRegistrationCount] = useState('1')
  const [workflowDraft, setWorkflowDraft] = useState<Record<string, WorkflowFieldDraftValue>>({})
  const [isQueueSubmitting, setIsQueueSubmitting] = useState(false)
  const [isControllerOpen, setIsControllerOpen] = useState(false)
  const [drawerHeaderPortalRevision, setDrawerHeaderPortalRevision] = useState(0)

  const workflowQuery = useQuery({
    queryKey: ['public-generation-workflow', slug],
    queryFn: () => getPublicGenerationWorkflow(slug),
    enabled: slug.trim().length > 0 && authStatusQuery.data?.hasCredentials === true && authStatusQuery.data?.authenticated === true,
  })

  const appSettingsQuery = useQuery({
    queryKey: ['app-settings'],
    queryFn: getAppSettings,
    enabled: authStatusQuery.data?.hasCredentials === true && authStatusQuery.data?.authenticated === true,
  })

  const workflow = workflowQuery.data ?? null
  const workflowFields = useMemo(() => workflow?.marked_fields ?? [], [workflow?.marked_fields])
  const shouldShowArtifactExplorer = workflow?.result_view_mode === 'artifact_explorer'
  const publicQueueMaxCount = resolvePublicQueueMaxCount(workflow?.public_queue_max_count)
  const generationSaveOptions = appSettingsQuery.data?.imageSave ?? DEFAULT_IMAGE_SAVE_SETTINGS
  const useWideSplitPaneScroll = isWideLayout && workflow !== null

  useEffect(() => {
    if (!workflow) {
      return
    }

    const baseDraft = buildWorkflowDraft(workflowFields)
    const persistedDraft = loadPersistedComfyWorkflowDraft(workflow.id, workflowFields)
    setWorkflowDraft({ ...baseDraft, ...persistedDraft })
  }, [workflow, workflowFields])

  useEffect(() => {
    if (!workflow) {
      return
    }

    persistComfyWorkflowDraft(workflow.id, workflowDraft)
  }, [workflow, workflowDraft])

  useEffect(() => {
    setQueueRegistrationCount((current) => String(clampQueueRegistrationCount(current, publicQueueMaxCount)))
  }, [publicQueueMaxCount])

  const missingRequiredField = useMemo(
    () => workflowFields.find((field) => field.required && !hasWorkflowFieldValue(workflowDraft[field.id])),
    [workflowDraft, workflowFields],
  )

  const handleFieldChange = (fieldId: string, value: WorkflowFieldDraftValue) => {
    setWorkflowDraft((current) => ({
      ...current,
      [fieldId]: value,
    }))
  }

  const handleImageChange = (fieldId: string, image?: SelectedImageDraft) => {
    setWorkflowDraft((current) => ({
      ...current,
      [fieldId]: image ?? '',
    }))
  }

  const handleResetDraft = () => {
    if (!workflow) {
      return
    }

    clearPersistedComfyWorkflowDraft(workflow.id)
    setWorkflowDraft(buildWorkflowDraft(workflowFields))
  }

  const handleQueueSubmit = async () => {
    if (!workflow || isQueueSubmitting) {
      return
    }

    if (missingRequiredField) {
      showSnackbar({ message: `필수 필드가 비어 있어: ${missingRequiredField.label}`, tone: 'error' })
      return
    }

    const promptData = buildWorkflowPromptData(workflowFields as WorkflowMarkedField[], workflowDraft)
    const registrationCount = clampQueueRegistrationCount(queueRegistrationCount, publicQueueMaxCount)

    try {
      setIsQueueSubmitting(true)
      const result = await queuePublicGenerationWorkflowJob(slug, {
        enqueue_count: registrationCount,
        request_summary: `${workflow.name} public queue job`,
        request_payload: {
          prompt_data: promptData,
          imageSaveOptions: {
            format: generationSaveOptions.defaultFormat,
            quality: generationSaveOptions.quality,
            resizeEnabled: generationSaveOptions.resizeEnabled,
            maxWidth: generationSaveOptions.maxWidth,
            maxHeight: generationSaveOptions.maxHeight,
          },
        },
      })

      const successCount = result.enqueued_count ?? result.records?.filter(Boolean).length ?? (result.record ? 1 : 0)

      void refreshGenerationQueueViews(queryClient, () => setHistoryRefreshNonce((current) => current + 1))
      showSnackbar({ message: t({ ko: '{name} 큐에 {count}건 등록했어.', en: 'Queued {count} job(s) for {name}.' }, { name: workflow.name, count: successCount }), tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t({ ko: '공용 워크플로우 큐 등록에 실패했어.', en: 'Failed to enqueue the public workflow.' })), tone: 'error' })
    } finally {
      setIsQueueSubmitting(false)
    }
  }

  useEffect(() => {
    if (isWideLayout || !isControllerOpen || typeof document === 'undefined') {
      return
    }

    const frame = window.requestAnimationFrame(() => {
      setDrawerHeaderPortalRevision((current) => current + 1)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [isControllerOpen, isWideLayout])

  if (authStatusQuery.isLoading) {
    return <div className="min-h-[40vh] rounded-sm bg-surface-low animate-pulse" />
  }

  if (authStatusQuery.data?.hasCredentials === false) {
    return (
      <Alert variant="destructive">
        <AlertTitle>{t({ ko: '게스트 로그인 전용 페이지야', en: 'This page is for guest login only' })}</AlertTitle>
        <AlertDescription>{t({ ko: '이 공용 워크플로우 페이지는 로컬 인증과 게스트 계정 구성이 먼저 필요해.', en: 'This public workflow page requires local authentication and guest account setup first.' })}</AlertDescription>
      </Alert>
    )
  }

  if (authStatusQuery.data?.hasCredentials && authStatusQuery.data.authenticated !== true) {
    const nextPath = `${location.pathname}${location.search}` || '/'
    return <Navigate to={`/login?next=${encodeURIComponent(nextPath)}`} replace />
  }

  const drawerHeaderContentId = 'public-comfy-workflow-drawer-header'
  const drawerHeaderPortalTarget = !isWideLayout && typeof document !== 'undefined'
    ? document.getElementById(drawerHeaderContentId)
    : null
  void drawerHeaderPortalRevision

  const desktopControllerActions = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={handleResetDraft}
        disabled={isQueueSubmitting}
        aria-label={t({ ko: '초기화', en: 'Reset' })}
        title={t({ ko: '초기화', en: 'Reset' })}
      >
        <RotateCcw className="h-4 w-4" />
      </Button>
      <ScrubbableNumberInput
        min={1}
        max={publicQueueMaxCount}
        step={1}
        scrubRatio={1}
        variant="detail"
        className="h-9 w-[72px] shrink-0 px-2 text-center text-xs"
        value={queueRegistrationCount}
        onChange={setQueueRegistrationCount}
        disabled={isQueueSubmitting}
        aria-label={t({ ko: '큐 등록 개수', en: 'Queue registration count' })}
        inputMode="numeric"
      />
      <Button
        type="button"
        size="icon-sm"
        onClick={() => void handleQueueSubmit()}
        disabled={isQueueSubmitting || workflowFields.length === 0}
        aria-label={isQueueSubmitting ? t({ ko: '큐 등록 중', en: 'Submitting to queue' }) : t({ ko: '큐 등록 {count}회', en: 'Queue {count} time(s)' }, { count: queueRegistrationCount })}
        title={isQueueSubmitting ? t({ ko: '큐 등록 중', en: 'Submitting to queue' }) : t({ ko: '큐 등록 {count}회', en: 'Queue {count} time(s)' }, { count: queueRegistrationCount })}
        className="shadow-[0_0_20px_color-mix(in_srgb,var(--primary)_18%,transparent)]"
      >
        <Play className="h-4 w-4 fill-current" />
      </Button>
    </div>
  )

  const desktopControllerHeaderContent = workflow ? (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-3">
          <Button asChild type="button" variant="ghost" size="sm" className="w-fit">
            <Link to="/access">
              <ArrowLeft className="h-4 w-4" />
              {t({ ko: '뒤로가기', en: 'Back' })}
            </Link>
          </Button>

          <div>
            <div className="text-base font-semibold text-foreground">{workflow.name}</div>
            {workflow.description ? <div className="mt-1 text-sm text-muted-foreground">{workflow.description}</div> : null}
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline">{t({ ko: '필드 {count}', en: 'Fields {count}' }, { count: workflowFields.length })}</Badge>
        </div>
      </div>

      {desktopControllerActions}
    </div>
  ) : null

  const drawerControllerHeaderContent = workflow ? (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1 truncate text-base font-semibold text-foreground">{workflow.name}</div>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={handleResetDraft}
        disabled={isQueueSubmitting}
        aria-label={t({ ko: '초기화', en: 'Reset' })}
        title={t({ ko: '초기화', en: 'Reset' })}
      >
        <RotateCcw className="h-4 w-4" />
      </Button>
    </div>
  ) : null

  const controllerBodyContent = (
    <>
      {missingRequiredField ? (
        <Alert>
          <AlertTitle>{t({ ko: '입력이 더 필요해', en: 'More input is required' })}</AlertTitle>
          <AlertDescription>{t({ ko: '{label} 필드는 꼭 채워야 해.', en: 'The {label} field is required.' }, { label: missingRequiredField.label })}</AlertDescription>
        </Alert>
      ) : null}

      {workflowFields.length === 0 ? (
        <BottomDrawerNotice>{t({ ko: '노출된 입력 필드가 아직 없어.', en: 'There are no exposed input fields yet.' })}</BottomDrawerNotice>
      ) : (
        <GenerationControllerFieldStack>
          {workflowFields.map((field) => (
            <WorkflowFieldDisclosureCard
              key={field.id}
              field={field}
              value={workflowDraft[field.id] ?? ''}
              onChange={(value) => handleFieldChange(field.id, value)}
              onImageChange={(image) => handleImageChange(field.id, image)}
            />
          ))}
        </GenerationControllerFieldStack>
      )}
    </>
  )

  const controllerPanel = workflow ? (
    isWideLayout ? (
      <section className={cn(useWideSplitPaneScroll ? 'flex min-h-0 flex-1 flex-col gap-3 overflow-hidden' : 'space-y-3')}>
        <div className="border-b border-border/70 pb-4">{desktopControllerHeaderContent}</div>
        <div className={cn(useWideSplitPaneScroll ? 'min-h-0 flex-1 overflow-y-auto pr-2' : 'space-y-5')}>
          <div className="space-y-5">{controllerBodyContent}</div>
        </div>
      </section>
    ) : (
      <div className="space-y-4 px-5 pb-5">{controllerBodyContent}</div>
    )
  ) : null

  const shouldUseControllerDrawer = !isWideLayout && workflow !== null
  const isDrawerOpen = shouldUseControllerDrawer && isControllerOpen
  const compactControllerActionBar = workflow && !isWideLayout ? (
    <CompactGenerationControllerActionBar
      isExpanded={isDrawerOpen}
      onToggle={() => setIsControllerOpen((current) => !current)}
      expandedContent={(
        <CompactGenerationActionSurface>
          <ScrubbableNumberInput
            min={1}
            max={publicQueueMaxCount}
            step={1}
            scrubRatio={1}
            variant="detail"
            className="h-8 w-[54px] shrink-0 !rounded-none !border-0 !bg-transparent px-0 text-center text-xs"
            value={queueRegistrationCount}
            onChange={setQueueRegistrationCount}
            disabled={isQueueSubmitting}
            aria-label={t({ ko: '큐 등록 개수', en: 'Queue registration count' })}
            inputMode="numeric"
          />
          <Button
            type="button"
            size="icon-sm"
            className="rounded-none border-l border-border/70 shadow-none"
            onClick={() => void handleQueueSubmit()}
            disabled={isQueueSubmitting || workflowFields.length === 0}
            aria-label={isQueueSubmitting ? t({ ko: '큐 등록 중', en: 'Submitting to queue' }) : t({ ko: '큐 등록 {count}회', en: 'Queue {count} time(s)' }, { count: queueRegistrationCount })}
            title={isQueueSubmitting ? t({ ko: '큐 등록 중', en: 'Submitting to queue' }) : t({ ko: '큐 등록 {count}회', en: 'Queue {count} time(s)' }, { count: queueRegistrationCount })}
          >
            <Play className="h-4 w-4 fill-current" />
          </Button>
        </CompactGenerationActionSurface>
      )}
    />
  ) : null

  return (
    <div
      className={cn(
        isWideLayout ? 'space-y-6' : 'space-y-6 pb-24',
        useWideSplitPaneScroll && 'flex h-[calc(100vh-var(--theme-shell-header-height)-1.5rem-var(--theme-shell-main-padding-bottom))] min-h-0 flex-col space-y-0 overflow-hidden',
      )}
    >
      {workflowQuery.isError ? (
        <Alert variant="destructive">
          <AlertTitle>{t({ ko: '공용 워크플로우를 불러오지 못했어', en: 'Failed to load the public workflow' })}</AlertTitle>
          <AlertDescription>{getErrorMessage(workflowQuery.error, t({ ko: '공용 워크플로우 조회 실패', en: 'Failed to load the public workflow' }))}</AlertDescription>
        </Alert>
      ) : null}

      {workflowQuery.isLoading ? <div className="text-sm text-muted-foreground">{t({ ko: '공용 워크플로우 불러오는 중…', en: 'Loading public workflow…' })}</div> : null}

      {workflow ? (
        isWideLayout ? (
          <div
            className={cn(
              'grid items-start gap-8 grid-cols-[minmax(360px,4fr)_minmax(0,6fr)]',
              useWideSplitPaneScroll && 'min-h-0 flex-1 items-stretch',
            )}
          >
            <div className={cn(useWideSplitPaneScroll && 'min-h-0 flex flex-col overflow-hidden')}>
              {controllerPanel}
            </div>
            <div className={cn(useWideSplitPaneScroll && 'min-h-0 flex flex-col overflow-hidden')}>
              {shouldShowArtifactExplorer ? (
                <WorkflowArtifactExplorerPanel
                  workflowId={workflow.id}
                  publicWorkflowSlug={slug}
                  refreshNonce={historyRefreshNonce}
                  splitPaneScroll={useWideSplitPaneScroll}
                />
              ) : (
                <GenerationHistoryPanel
                  refreshNonce={historyRefreshNonce}
                  serviceType="comfyui"
                  workflowId={workflow.id}
                  publicWorkflowSlug={slug}
                  splitPaneScroll={useWideSplitPaneScroll}
                />
              )}
            </div>
          </div>
        ) : (
          <>
            {shouldShowArtifactExplorer ? (
              <WorkflowArtifactExplorerPanel
                workflowId={workflow.id}
                publicWorkflowSlug={slug}
                refreshNonce={historyRefreshNonce}
                onBack={() => navigate('/access')}
              />
            ) : (
              <GenerationHistoryPanel
                refreshNonce={historyRefreshNonce}
                serviceType="comfyui"
                workflowId={workflow.id}
                publicWorkflowSlug={slug}
                onBack={() => navigate('/access')}
              />
            )}

            {compactControllerActionBar}

            <BottomDrawerSheet
              open={isDrawerOpen}
              title={null}
              headerContentId={drawerHeaderContentId}
              ariaLabel={`${workflow.name} 컨트롤 패널`}
              onClose={() => setIsControllerOpen(false)}
              surfaceVariant="controller"
              bodyClassName="p-0 pb-24"
              headerPortalClassName="mt-0 border-t-0 pt-0"
              footer={null}
              hideHandle
            >
              {drawerHeaderPortalTarget && drawerControllerHeaderContent ? createPortal(drawerControllerHeaderContent, drawerHeaderPortalTarget) : null}
              {controllerPanel}
            </BottomDrawerSheet>
          </>
        )
      ) : null}
    </div>
  )
}
