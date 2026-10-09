import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { ArrowLeft, RotateCcw } from 'lucide-react'
import { BottomDrawerNotice, BottomDrawerSheet } from '@/components/ui/bottom-drawer-sheet'
import { Heading } from '@/components/ui/heading'
import { IconButton } from '@/components/ui/icon-button'
import { LoadingState } from '@/components/ui/loading-state'
import { Tip } from '@/components/ui/tooltip'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { resolveAccountDraftOwner } from '@/features/auth/auth-permissions'
import { useI18n } from '@/i18n'
import type { GenerationWorkflowDetail, WorkflowMarkedField } from '@/lib/api-image-generation-types'
import { DEFAULT_COMFY_MODEL_API_PATHS, getGenerationWorkflow, getGenerationCustomDropdownLists, scanGenerationComfyUIModelDropdownLists } from '@/lib/api-image-generation-workflows'
import { getPublicGenerationWorkflow, queuePublicGenerationWorkflowJob } from '@/lib/api-public-workflows'
import { getRuntimeImageSaveSettings } from '@/lib/api-settings'
import { DEFAULT_IMAGE_SAVE_SETTINGS } from '@/lib/image-save-output'
import { useDesktopPageLayout } from '@/lib/use-desktop-page-layout'
import { cn } from '@/lib/utils'
import { refreshGenerationQueueViews } from './components/generation-queue-actions'
import { GenerationHistoryPanel } from './components/generation-history-panel'
import { CompactGenerationControllerActionBar, GenerationControllerFieldStack } from './components/shared-generation-controller'
import { GenerateActionBar } from './components/generate-action-bar'
import { WorkflowArtifactExplorerPanel } from './components/workflow-artifact-explorer-panel'
import { WorkflowFieldGroupList } from './components/workflow-field-group-list'
import { useComfyChatPage } from './components/use-comfy-chat-page'
import { ComfyWorkflowAuthoringModal } from './components/comfy-workflow-authoring-modal'
import { findAutoCollectedPowerLoraOptions } from './components/power-lora-loader-utils'
import {
  buildWorkflowDraft,
  buildWorkflowPromptData,
  collectWorkflowNodeDraftIssues,
  clearPersistedComfyWorkflowDraft,
  deleteComfyWorkflowDraftInputAssets,
  findInvalidWorkflowNumberField,
  hasWorkflowFieldValue,
  loadPersistedComfyWorkflowDraft,
  persistComfyWorkflowDraft,
} from './image-generation-drafts'
import {
  getErrorMessage,
  parseNumberInput,
  type SelectedImageDraft,
  type WorkflowFieldDraftValue,
} from './image-generation-shared'
import { hasWorkflowDraftDifference } from './history-settings-mapping'

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
  const confirm = useConfirm()
  const authStatusQuery = useAuthStatusQuery()
  const draftStorageOwner = resolveAccountDraftOwner(authStatusQuery.data)
  const [historyRefreshNonce, setHistoryRefreshNonce] = useState(0)
  const [queueRegistrationCount, setQueueRegistrationCount] = useState('1')
  const [workflowDraft, setWorkflowDraft] = useState<Record<string, WorkflowFieldDraftValue>>({})
  const [workflowDraftOwnerId, setWorkflowDraftOwnerId] = useState<number | null>(null)
  const [authoringWorkflow, setAuthoringWorkflow] = useState<GenerationWorkflowDetail | null>(null)
  const [isAuthoringOpen, setIsAuthoringOpen] = useState(false)
  const authoringDropdowns = useQuery({ queryKey: ['image-generation-custom-dropdown-lists'], queryFn: getGenerationCustomDropdownLists, enabled: isAuthoringOpen || authStatusQuery.data?.permissionKeys.includes('workflows.view') === true })
  const [isQueueSubmitting, setIsQueueSubmitting] = useState(false)
  const [isRefreshingDropdownLists, setIsRefreshingDropdownLists] = useState(false)
  const [isControllerOpen, setIsControllerOpen] = useState(false)
  const [drawerHeaderPortalRevision, setDrawerHeaderPortalRevision] = useState(0)

  const workflowQuery = useQuery({
    queryKey: ['public-generation-workflow', slug],
    queryFn: () => getPublicGenerationWorkflow(slug),
    enabled: slug.trim().length > 0 && authStatusQuery.data?.hasCredentials === true && authStatusQuery.data?.authenticated === true,
  })

  const appSettingsQuery = useQuery({
    queryKey: ['runtime-image-save-settings'],
    queryFn: getRuntimeImageSaveSettings,
    enabled: authStatusQuery.data?.hasCredentials === true && authStatusQuery.data?.authenticated === true,
  })

  const workflow = workflowQuery.data ?? null
  const workflowFields = useMemo(() => workflow?.marked_fields ?? [], [workflow?.marked_fields])
  const shouldShowArtifactExplorer = workflow?.result_view_mode === 'artifact_explorer'
  const publicQueueMaxCount = resolvePublicQueueMaxCount(workflow?.public_queue_max_count)
  // 등급별 회원 1인당 동시 대기열 제한(조회 시점 스냅샷). 최종 판정은 서버가 한다.
  const viewerQueueRoleLimit = typeof workflow?.viewer_queue_role_limit === 'number' ? workflow.viewer_queue_role_limit : null
  const viewerQueueRoleActive = typeof workflow?.viewer_queue_role_active === 'number' ? workflow.viewer_queue_role_active : 0
  const viewerQueueRoleLabel = workflow?.viewer_queue_role_label ?? null
  const viewerQueueRoleLimitReached = viewerQueueRoleLimit !== null
    && (viewerQueueRoleLimit <= 0 || viewerQueueRoleActive >= viewerQueueRoleLimit)
  const generationSaveOptions = appSettingsQuery.data?.imageSave ?? DEFAULT_IMAGE_SAVE_SETTINGS
  const useWideSplitPaneScroll = isWideLayout && workflow !== null

  useEffect(() => {
    if (!workflow) {
      return
    }

    const baseDraft = buildWorkflowDraft(workflowFields)
    const persistedDraft = loadPersistedComfyWorkflowDraft(draftStorageOwner, workflow.id, workflowFields)
    setWorkflowDraft({ ...baseDraft, ...persistedDraft })
    setWorkflowDraftOwnerId(workflow.id)
  }, [draftStorageOwner, workflow, workflowFields])

  useEffect(() => {
    if (!workflow) {
      return
    }

    if (workflowDraftOwnerId !== workflow.id) return
    persistComfyWorkflowDraft(draftStorageOwner, workflow.id, workflowDraft)
  }, [draftStorageOwner, workflow, workflowDraft, workflowDraftOwnerId])

  useEffect(() => {
    setQueueRegistrationCount((current) => String(clampQueueRegistrationCount(current, publicQueueMaxCount)))
  }, [publicQueueMaxCount])

  const missingRequiredField = useMemo(
    () => workflowFields.find((field) => field.required && !hasWorkflowFieldValue(workflowDraft[field.id])),
    [workflowDraft, workflowFields],
  )
  const workflowNodeIssues = useMemo(
    () => collectWorkflowNodeDraftIssues(workflowFields as WorkflowMarkedField[], workflowDraft),
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

  useComfyChatPage(workflow, workflowFields, workflowDraft, workflowDraftOwnerId, handleFieldChange, {
    enabled: !!workflow && !isAuthoringOpen,
    loraOptions: findAutoCollectedPowerLoraOptions(authoringDropdowns.data ?? []),
    onRefresh: async () => { const result = await workflowQuery.refetch(); if (result.error) throw result.error },
    onOpenCreate: authStatusQuery.data?.permissionKeys.includes('workflows.edit') && authStatusQuery.data.permissionKeys.includes('workflows.view') ? () => { setAuthoringWorkflow(null); setIsAuthoringOpen(true) } : undefined,
    onOpenEdit: authStatusQuery.data?.permissionKeys.includes('workflows.edit') && authStatusQuery.data.permissionKeys.includes('workflows.view') ? async (id, assertCurrent) => { const detail = await getGenerationWorkflow(id); assertCurrent(); setAuthoringWorkflow(detail); setIsAuthoringOpen(true) } : undefined,
  })

  const handleResetDraft = async () => {
    if (!workflow) {
      return
    }

    const baseDraft = buildWorkflowDraft(workflowFields)
    if (hasWorkflowDraftDifference(workflowFields, workflowDraft, baseDraft)) {
      const confirmed = await confirm({
        title: t({ ko: '워크플로우 입력을 초기화할까?', en: 'Reset the workflow inputs?' }),
        description: t({
          ko: '{name}의 입력값이 기본값으로 돌아가고 저장된 초안도 지워져. 업로드한 입력 이미지는 서버에서도 삭제돼. 되돌릴 수 없어.',
          en: 'All inputs of {name} go back to their defaults and the saved draft is cleared. Uploaded input images are also deleted from the server. This cannot be undone.',
        }, { name: workflow.name }),
        confirmLabel: t({ ko: '초기화', en: 'Reset' }),
        tone: 'destructive',
      })
      if (!confirmed) {
        return
      }
    }

    void deleteComfyWorkflowDraftInputAssets(workflowDraft)
    clearPersistedComfyWorkflowDraft(draftStorageOwner, workflow.id)
    setWorkflowDraft(baseDraft)
  }

  const handleRefreshDropdownLists = async () => {
    if (isRefreshingDropdownLists) {
      return
    }

    try {
      setIsRefreshingDropdownLists(true)
      const response = await scanGenerationComfyUIModelDropdownLists({ apiPaths: DEFAULT_COMFY_MODEL_API_PATHS })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['image-generation-custom-dropdown-lists'] }),
        workflowQuery.refetch(),
      ])
      showSnackbar({ message: response.data.message || t({ ko: '자동수집 목록을 갱신했어.', en: 'Refreshed the auto-collect list.' }), tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t({ ko: '자동수집 목록 생성에 실패했어.', en: 'Failed to create the auto-collect list.' })), tone: 'error' })
    } finally {
      setIsRefreshingDropdownLists(false)
    }
  }

  const handleQueueSubmit = async () => {
    if (!workflow || isQueueSubmitting) {
      return
    }

    if (missingRequiredField) {
      showSnackbar({
        message: t(
          { ko: '필수 필드가 비어 있어: {label}', en: 'Required field is empty: {label}' },
          { label: missingRequiredField.label },
        ),
        tone: 'error',
      })
      return
    }

    const invalidNumberField = findInvalidWorkflowNumberField(workflowFields as WorkflowMarkedField[], workflowDraft)
    if (invalidNumberField) {
      showSnackbar({
        message: t(
          { ko: '숫자 필드 값이 올바르지 않아: {label}', en: 'Invalid numeric field value: {label}' },
          { label: invalidNumberField.label },
        ),
        tone: 'error',
      })
      return
    }

    const invalidNodeField = workflowNodeIssues[0]
    if (invalidNodeField) {
      showSnackbar({
        message: t(
          { ko: '{label}: {message}', en: '{label}: {message}' },
          { label: invalidNodeField.field.label, message: t({ ko: invalidNodeField.issue.ko, en: invalidNodeField.issue.en }) },
        ),
        tone: 'error',
      })
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
      if (viewerQueueRoleLimit !== null) {
        // 등급별 제한 배너의 진행 중 개수를 서버 기준으로 다시 맞춘다.
        void workflowQuery.refetch()
      }
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
    return <div className="ui-tone-plinth min-h-[40vh] animate-pulse rounded-sm" />
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

  const publicRepeat = {
    value: queueRegistrationCount,
    min: PUBLIC_QUEUE_REGISTRATION_MIN,
    max: publicQueueMaxCount,
    onChange: setQueueRegistrationCount,
  }
  const publicGenerateProps = {
    generateLabel: t({ ko: '생성', en: 'Generate' }),
    generatingLabel: t({ ko: '큐 등록 중…', en: 'Queueing…' }),
    onGenerate: () => void handleQueueSubmit(),
    generateDisabled: workflowFields.length === 0,
    isGenerating: isQueueSubmitting,
    repeat: publicRepeat,
  }

  const desktopControllerActions = (
    <GenerateActionBar
      variant="inline"
      {...publicGenerateProps}
      onReset={() => void handleResetDraft()}
    />
  )

  const desktopControllerHeaderContent = workflow ? (
    <div className="space-y-3">
      <div className="flex min-w-0 items-center gap-2">
        <IconButton asChild size="icon-sm" variant="ghost" label={t({ ko: '공개 워크플로 목록으로', en: 'Back to public workflows' })}>
          <Link to="/access">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </IconButton>
        <Tip content={workflow.description} className="whitespace-pre-line">
          <Heading level={3} as="div" className="min-w-0 truncate">{workflow.name}</Heading>
        </Tip>
      </div>

      {desktopControllerActions}
    </div>
  ) : null

  const drawerControllerHeaderContent = workflow ? (
    <div className="flex items-center gap-3">
      <Heading level={3} as="div" className="min-w-0 flex-1 truncate">{workflow.name}</Heading>
      <IconButton
        variant="ghost"
        size="icon-sm"
        onClick={() => void handleResetDraft()}
        disabled={isQueueSubmitting}
        label={t({ ko: '초기화', en: 'Reset' })}
      >
        <RotateCcw />
      </IconButton>
    </div>
  ) : null

  const viewerRoleName = viewerQueueRoleLabel ?? t({ ko: '현재', en: 'current' })
  const controllerBodyContent = (
    <>
      {viewerQueueRoleLimit !== null ? (
        <Alert variant={viewerQueueRoleLimitReached ? 'destructive' : undefined}>
          <AlertTitle>{t({ ko: '대기열 생성 제한', en: 'Queue creation limit' })}</AlertTitle>
          <AlertDescription>
            {viewerQueueRoleLimit <= 0
              ? t(
                { ko: '{role} 등급은 이 워크플로우에서 대기열을 만들 수 없어.', en: 'The {role} role cannot create queue jobs on this workflow.' },
                { role: viewerRoleName },
              )
              : viewerQueueRoleLimitReached
                ? t(
                  { ko: '{role} 등급은 이 워크플로우에서 동시에 {limit}개까지만 대기열을 만들 수 있어. 진행 중인 {active}개가 끝난 뒤에 다시 등록할 수 있어.', en: 'The {role} role can keep at most {limit} active queue job(s) on this workflow. You can enqueue again after your {active} active job(s) finish.' },
                  { role: viewerRoleName, limit: viewerQueueRoleLimit, active: viewerQueueRoleActive },
                )
                : t(
                  { ko: '{role} 등급은 이 워크플로우에서 동시에 {limit}개까지 대기열을 만들 수 있어. (현재 {active}개 진행 중)', en: 'The {role} role can keep up to {limit} active queue job(s) on this workflow. ({active} in progress now)' },
                  { role: viewerRoleName, limit: viewerQueueRoleLimit, active: viewerQueueRoleActive },
                )}
          </AlertDescription>
        </Alert>
      ) : null}

      {missingRequiredField ? (
        <Alert>
          <AlertTitle>{t({ ko: '입력이 더 필요해', en: 'More input is required' })}</AlertTitle>
          <AlertDescription>{t({ ko: '{label} 필드는 꼭 채워야 해.', en: 'The {label} field is required.' }, { label: missingRequiredField.label })}</AlertDescription>
        </Alert>
      ) : null}

      {workflowNodeIssues.length > 0 ? (
        <Alert variant="destructive">
          <AlertTitle>{t({ ko: '워크플로 입력 확인', en: 'Check workflow inputs' })}</AlertTitle>
          <AlertDescription>{t({ ko: workflowNodeIssues[0].issue.ko, en: workflowNodeIssues[0].issue.en })}</AlertDescription>
        </Alert>
      ) : null}

      {workflowFields.length === 0 ? (
        <BottomDrawerNotice>{t({ ko: '노출된 입력 필드가 아직 없어.', en: 'There are no exposed input fields yet.' })}</BottomDrawerNotice>
      ) : (
        <GenerationControllerFieldStack>
          <WorkflowFieldGroupList
            fields={workflowFields}
            values={workflowDraft}
            isRefreshingOptions={isRefreshingDropdownLists}
            onRefreshOptions={handleRefreshDropdownLists}
            onChange={handleFieldChange}
            onImageChange={handleImageChange}
          />
        </GenerationControllerFieldStack>
      )}
    </>
  )

  const controllerPanel = workflow ? (
    isWideLayout ? (
      <section className={cn(useWideSplitPaneScroll ? 'flex min-h-0 flex-1 flex-col gap-6 overflow-hidden' : 'space-y-6')}>
        <div className="shrink-0">{desktopControllerHeaderContent}</div>
        <div className={cn(useWideSplitPaneScroll ? 'min-h-0 flex-1 overflow-y-auto pr-2 pb-1' : undefined)}>
          <div className="space-y-6">{controllerBodyContent}</div>
        </div>
      </section>
    ) : (
      <div className="space-y-6 px-5 pb-5">{controllerBodyContent}</div>
    )
  ) : null

  const shouldUseControllerDrawer = !isWideLayout && workflow !== null
  const isDrawerOpen = shouldUseControllerDrawer && isControllerOpen
  const compactControllerActionBar = workflow && !isWideLayout ? (
    <CompactGenerationControllerActionBar
      isExpanded={isDrawerOpen}
      onToggle={() => setIsControllerOpen((current) => !current)}
      expandedContent={<GenerateActionBar variant="sticky" {...publicGenerateProps} />}
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

      {workflowQuery.isLoading ? <LoadingState variant="inline" label={t({ ko: '공용 워크플로우 불러오는 중…', en: 'Loading public workflow…' })} /> : null}

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
      <ComfyWorkflowAuthoringModal open={isAuthoringOpen} mode={authoringWorkflow ? 'edit' : 'create'} initialData={authoringWorkflow ? { workflow: authoringWorkflow } : null} dropdownLists={authoringDropdowns.data ?? []} onClose={() => { setIsAuthoringOpen(false); setAuthoringWorkflow(null) }} onSaved={() => { setIsAuthoringOpen(false); setAuthoringWorkflow(null); void workflowQuery.refetch() }} />
    </div>
  )
}
