import { useFeaturePermissions } from '@/features/auth/use-feature-permissions'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Copy, Ellipsis, Eye, ListFilter, ListTree, Pencil, Play, Plus, RefreshCw, RotateCcw, Save, Server, Star, Trash2, Upload } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/ui/field'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { IconButton } from '@/components/ui/icon-button'
import { RowGroup } from '@/components/ui/row-group'
import { Switch } from '@/components/ui/switch'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { DEFAULT_COMFY_MODEL_API_PATHS } from '@/lib/api-image-generation-workflows'
import type { ComfyUIServer, CustomDropdownList, GenerationWorkflow } from '@/lib/api-image-generation-types'
import { cn } from '@/lib/utils'
import type { ComfyUIServerTestState } from '../image-generation-shared'

/** Heading label of a home section: small icon + overline text (RowGroup styles the text). */
function SectionLabel({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return <span className="inline-flex items-center gap-1.5 [&_svg]:size-3.5">{icon}{children}</span>
}

function EmptyListRow() {
  const { t } = useI18n()
  return <p className="py-3 text-sm text-muted-foreground">{t({ ko: '없음', en: 'None' })}</p>
}

type WorkflowListSectionProps = {
  workflows: GenerationWorkflow[]
  selectedWorkflowId: string
  onSelectWorkflow: (workflowId: number) => void
  onCreateWorkflow: () => void
  onSaveModule: (workflowId: number) => void
  onEditWorkflow: (workflowId: number) => void
  onCopyWorkflow: (workflowId: number) => void
  onDeleteWorkflow: (workflowId: number) => void
}

export function ComfyWorkflowListSection({
  workflows,
  selectedWorkflowId,
  onSelectWorkflow,
  onCreateWorkflow,
  onSaveModule,
  onEditWorkflow,
  onCopyWorkflow,
  onDeleteWorkflow,
}: WorkflowListSectionProps) {
  const { canUpdateWorkflows } = useFeaturePermissions()
  const { t } = useI18n()

  return (
    <RowGroup
      heading={<SectionLabel icon={<ListTree />}>{t({ ko: '워크플로우', en: 'Workflows' })}</SectionLabel>}
      count={workflows.length}
      actions={(
        <IconButton size="icon-sm" variant="ghost" onClick={onCreateWorkflow} disabled={!canUpdateWorkflows} label={t({ ko: '워크플로우 등록', en: 'Add workflow' })}>
          <Plus />
        </IconButton>
      )}
    >
      {workflows.length > 0 ? workflows.map((workflow) => {
        const isSelected = String(workflow.id) === selectedWorkflowId
        return (
          <div
            key={workflow.id}
            data-selected={isSelected || undefined}
            className="relative -mx-2 flex min-h-11 items-center gap-1 rounded-sm px-2 before:pointer-events-none before:absolute before:inset-x-2 before:top-0 before:border-t before:border-line first:before:hidden data-[selected=true]:bg-primary/8"
            // The workflow's own colour marks the selected row as a left accent (tone, not an outline).
            style={isSelected ? { boxShadow: `inset 3px 0 0 ${workflow.color || 'var(--color-primary)'}` } : undefined}
          >
            <Button
              type="button"
              variant="nav"
              onClick={() => onSelectWorkflow(workflow.id)}
              aria-current={isSelected || undefined}
              className="-mx-2 h-auto min-w-0 flex-1 justify-start gap-2.5 px-2 py-2"
            >
              <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ backgroundColor: workflow.color || 'var(--color-primary)' }} />
              <Tip content={workflow.description || null} align="start">
                <span className="truncate text-sm font-medium text-foreground">{workflow.name}</span>
              </Tip>
              {workflow.kind === 'audio' ? <Badge variant="secondary">{t({ ko: '오디오', en: 'Audio' })}</Badge> : null}
            </Button>
            <IconButton size="icon-sm" variant="ghost" onClick={() => onEditWorkflow(workflow.id)} disabled={!canUpdateWorkflows} label={t({ ko: '{name} 수정', en: 'Edit {name}' }, { name: workflow.name })}>
              <Pencil />
            </IconButton>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton size="icon-sm" variant="ghost" label={t({ ko: '더 보기', en: 'More' })}><Ellipsis /></IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => onSaveModule(workflow.id)}><Save />{t({ ko: '모듈 저장', en: 'Save module' })}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onCopyWorkflow(workflow.id)}><Copy />{t({ ko: '복사', en: 'Copy' })}</DropdownMenuItem>
                <DropdownMenuItem variant="destructive" disabled={!canUpdateWorkflows} onSelect={() => onDeleteWorkflow(workflow.id)}><Trash2 />{t({ ko: '삭제', en: 'Delete' })}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )
      }) : <EmptyListRow />}
    </RowGroup>
  )
}

type ServerListSectionProps = {
  servers: ComfyUIServer[]
  serverTests: Record<number, ComfyUIServerTestState>
  onOpenCreateServer: () => void
  onEditServer: (serverId: number) => void
  onDeleteServer: (serverId: number) => void
  onTestServer: (serverId: number) => void
  onToggleServerActive: (serverId: number, isActive: boolean) => void
}

type ServerState = { tone: 'ok' | 'busy' | 'bad' | 'none'; label: string }

const SERVER_DOT_CLASS: Record<ServerState['tone'], string> = {
  ok: 'bg-success',
  busy: 'bg-warning',
  bad: 'bg-destructive',
  none: 'bg-muted-foreground/40',
}

export function ComfyServerListSection({ servers, serverTests, onOpenCreateServer, onEditServer, onDeleteServer, onTestServer, onToggleServerActive }: ServerListSectionProps) {
  const { isAdmin } = useFeaturePermissions()
  const { t, formatNumber } = useI18n()

  return (
    <RowGroup
      heading={<SectionLabel icon={<Server />}>{t({ ko: '서버', en: 'Servers' })}</SectionLabel>}
      count={servers.length}
      actions={(
        <IconButton size="icon-sm" variant="ghost" onClick={onOpenCreateServer} disabled={!isAdmin} label={t({ ko: '서버 등록', en: 'Add server' })}>
          <Plus />
        </IconButton>
      )}
    >
      {servers.length > 0 ? servers.map((server) => {
        const testState = serverTests[server.id]
        const connectionStatus = testState?.status
        const isModalServer = server.backend_type === 'modal' || connectionStatus?.backend_type === 'modal'
        const isActive = server.is_active !== false
        const running = connectionStatus?.running_count ?? 0
        const pending = connectionStatus?.pending_count ?? 0
        const state: ServerState = !isActive
          ? { tone: 'none', label: t({ ko: '비활성', en: 'Inactive' }) }
          : isModalServer
            ? { tone: 'none', label: t('image-generation.components.comfy.home.sections.modal.server.auto.check.skipped') }
            : testState?.isLoading
              ? { tone: 'none', label: t({ ko: '확인 중…', en: 'Checking…' }) }
              : connectionStatus
                ? connectionStatus.is_connected
                  ? connectionStatus.is_idle
                    ? { tone: 'ok', label: t({ ko: '연결됨', en: 'Connected' }) }
                    : { tone: 'busy', label: t({ ko: '사용 중', en: 'Busy' }) }
                  : { tone: 'bad', label: t({ ko: '실패', en: 'Failed' }) }
                : testState?.error
                  ? { tone: 'bad', label: t({ ko: '실패', en: 'Failed' }) }
                  : { tone: 'none', label: t({ ko: '확인 전', en: 'Not checked' }) }
        const errors = [!isModalServer ? connectionStatus?.error_message : undefined, testState?.error].filter(Boolean)
        const description = server.description?.trim() && server.description.trim() !== server.name ? server.description : null

        return (
          <div key={server.id} className="border-b border-line py-1 last:border-b-0">
            <div className="flex min-h-10 min-w-0 items-center gap-2.5">
              <Tip content={state.label}>
                <span role="img" aria-label={state.label} className={cn('size-2 shrink-0 rounded-full', SERVER_DOT_CLASS[state.tone])} />
              </Tip>
              <Tip content={description} align="start">
                <span className="max-w-[40%] shrink-0 truncate text-sm font-medium text-foreground">{server.name}</span>
              </Tip>
              {!isModalServer && server.is_default ? (
                <Tip content={t({ ko: '대표', en: 'Default' })}>
                  <Star role="img" aria-label={t({ ko: '대표', en: 'Default' })} className="size-3.5 shrink-0 fill-current text-warning" />
                </Tip>
              ) : null}
              {isModalServer ? <Chip size="sm" tone="muted">Modal</Chip> : null}
              {(server.routing_tags ?? []).map((tag) => <Chip key={`${server.id}:${tag}`} size="sm" tone="muted">#{tag}</Chip>)}
              <span className="min-w-0 flex-1 truncate font-mono text-2xs text-muted-foreground" title={server.endpoint}>{server.endpoint}</span>
              {connectionStatus?.response_time !== undefined ? <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">{connectionStatus.response_time}ms</span> : null}
              {connectionStatus?.is_connected && !isModalServer && (running > 0 || pending > 0) ? (
                <Chip size="sm" tone="warning" className="tabular-nums">
                  {t({ ko: '실행 {running} · 대기 {pending}', en: 'Running {running} · Pending {pending}' }, { running: formatNumber(running), pending: formatNumber(pending) })}
                </Chip>
              ) : null}
              <Switch
                size="sm"
                aria-label={t({ ko: '활성', en: 'Active' })}
                checked={isActive}
                disabled={!isAdmin}
                onCheckedChange={(checked) => onToggleServerActive(server.id, checked)}
              />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton size="icon-sm" variant="ghost" label={t({ ko: '더 보기', en: 'More' })}><Ellipsis /></IconButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    disabled={testState?.isLoading === true}
                    onSelect={() => onTestServer(server.id)}
                    title={isModalServer ? t({ ko: 'Modal 서버 테스트는 원격 endpoint를 호출해서 비용이 발생할 수 있어.', en: 'Testing a Modal server may call the remote endpoint and incur costs.' }) : undefined}
                  >
                    <Play />{t({ ko: '테스트', en: 'Test' })}
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={!isAdmin} onSelect={() => onEditServer(server.id)}><Pencil />{t({ ko: '수정', en: 'Edit' })}</DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" disabled={!isAdmin} onSelect={() => onDeleteServer(server.id)}><Trash2 />{t({ ko: '삭제', en: 'Delete' })}</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            {errors.length > 0 ? <div className="pb-1 pl-4.5 text-2xs break-all text-destructive">{errors.join(' / ')}</div> : null}
          </div>
        )
      }) : <EmptyListRow />}
    </RowGroup>
  )
}

type DropdownListsSectionProps = {
  dropdownLists: CustomDropdownList[]
  isSubmitting?: boolean
  onCreateManualList: (input: { name: string; description?: string; items: string[] }) => Promise<void> | void
  onUpdateList: (listId: number, input: { name?: string; description?: string; items?: string[] }) => Promise<void> | void
  onDeleteList: (listId: number) => Promise<void> | void
  onScanAutoLists: (input: { apiPaths: string[] }) => Promise<void> | void
}

type DropdownTab = 'custom' | 'auto'

function splitDropdownItems(rawValue: string) {
  return rawValue
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function splitComfyModelApiPaths(rawValue: string) {
  return Array.from(new Set(splitDropdownItems(rawValue)))
}

type CustomDropdownListEditorModalProps = {
  open: boolean
  isSubmitting?: boolean
  initialList?: CustomDropdownList | null
  readOnly?: boolean
  onClose: () => void
  onSubmit?: (input: { name: string; description?: string; items: string[] }) => Promise<void> | void
}

function CustomDropdownListEditorModal({ open, isSubmitting = false, initialList, readOnly = false, onClose, onSubmit }: CustomDropdownListEditorModalProps) {
  const { t, formatNumber } = useI18n()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [itemsText, setItemsText] = useState('')

  useEffect(() => {
    if (!open) {
      return
    }

    setName(initialList?.name ?? '')
    setDescription(initialList?.description ?? '')
    setItemsText((initialList?.items ?? []).join('\n'))
  }, [initialList, open])

  const items = useMemo(() => splitDropdownItems(itemsText), [itemsText])

  const handleSubmit = async () => {
    if (readOnly || !onSubmit) {
      return
    }

    const trimmedName = name.trim()
    if (!trimmedName || items.length === 0) {
      return
    }

    await onSubmit({
      name: trimmedName,
      description: description.trim() || undefined,
      items,
    })
  }

  return (
    <Modal open={open} onClose={onClose} title={readOnly ? t({ ko: '드롭다운 목록 상세', en: 'Dropdown list details' }) : initialList ? t({ ko: '커스텀 드롭다운 수정', en: 'Edit custom dropdown' }) : t({ ko: '커스텀 드롭다운 목록', en: 'Custom dropdown list' })} widthClassName="max-w-2xl">
      <ModalBody className="space-y-5">
        <Field label={t({ ko: '목록 이름', en: 'List name' })}>
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder={t({ ko: '목록 이름', en: 'List name' })} readOnly={readOnly} />
        </Field>

        <Field label={t({ ko: '설명', en: 'Description' })}>
          <Textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} placeholder={t({ ko: '설명 (선택)', en: 'Description (optional)' })} readOnly={readOnly} />
        </Field>

        <Field label={t({ ko: '항목', en: 'Items' })}>
          <Textarea rows={10} value={itemsText} onChange={(event) => setItemsText(event.target.value)} placeholder={t({ ko: '항목을 줄바꿈 또는 쉼표로 입력', en: 'Enter items separated by new lines or commas' })} readOnly={readOnly} />
        </Field>

        <ModalFooter className="justify-between">
          <div className="text-xs text-muted-foreground">{t({ ko: '{count}개 항목', en: '{count} items' }, { count: formatNumber(items.length) })}</div>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>{readOnly ? t({ ko: '닫기', en: 'Close' }) : t({ ko: '취소', en: 'Cancel' })}</Button>
            {!readOnly ? (
              <Button type="button" onClick={() => void handleSubmit()} disabled={isSubmitting || !name.trim() || items.length === 0}>
                <Save className="h-4 w-4" />
                {t({ ko: '저장', en: 'Save' })}
              </Button>
            ) : null}
          </div>
        </ModalFooter>
      </ModalBody>
    </Modal>
  )
}

type ComfyDropdownAutoCollectModalProps = {
  open: boolean
  isSubmitting?: boolean
  onClose: () => void
  onSubmit: (input: { apiPaths: string[] }) => Promise<void> | void
}

function ComfyDropdownAutoCollectModal({ open, isSubmitting = false, onClose, onSubmit }: ComfyDropdownAutoCollectModalProps) {
  const { t, formatNumber } = useI18n()
  const defaultPathText = DEFAULT_COMFY_MODEL_API_PATHS.join('\n')
  const [apiPathText, setApiPathText] = useState(defaultPathText)
  const apiPaths = useMemo(() => splitComfyModelApiPaths(apiPathText), [apiPathText])

  useEffect(() => {
    if (open) {
      setApiPathText(defaultPathText)
    }
  }, [defaultPathText, open])

  const handleSubmit = async () => {
    await onSubmit({ apiPaths })
  }

  return (
    <Modal open={open} onClose={onClose} title={t({ ko: 'ComfyUI 자동수집', en: 'ComfyUI auto collect' })} widthClassName="max-w-3xl">
      <ModalBody className="space-y-5">
        <Field label={t({ ko: 'API 목록', en: 'API paths' })} info={t({ ko: '대표 ComfyUI 서버에서 수집해. 통합·개별 목록과 하위 폴더 통합은 항상 적용돼.', en: 'Collected from the default ComfyUI server; merged and separate lists and subfolder merging always apply.' })}>
          <Textarea
            variant="settings"
            rows={8}
            value={apiPathText}
            onChange={(event) => setApiPathText(event.target.value)}
            placeholder={DEFAULT_COMFY_MODEL_API_PATHS.join('\n')}
          />
        </Field>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-muted-foreground">
            {t({ ko: '{count}개 경로', en: '{count} paths' }, { count: formatNumber(apiPaths.length) })}
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={() => setApiPathText(defaultPathText)} disabled={isSubmitting}>
            <RotateCcw className="h-4 w-4" />
            {t({ ko: '기본값 초기화', en: 'Reset defaults' })}
          </Button>
        </div>

        <ModalFooter>
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>{t({ ko: '취소', en: 'Cancel' })}</Button>
          <Button type="button" onClick={() => void handleSubmit()} disabled={isSubmitting}>
            <Upload className="h-4 w-4" />
            {t({ ko: '자동수집 실행', en: 'Run auto collect' })}
          </Button>
        </ModalFooter>
      </ModalBody>
    </Modal>
  )
}

export function ComfyDropdownListsSection({ dropdownLists, isSubmitting = false, onCreateManualList, onUpdateList, onDeleteList, onScanAutoLists }: DropdownListsSectionProps) {
  const { canUpdateWorkflows, isAdmin } = useFeaturePermissions()
  const { t, formatNumber } = useI18n()
  const [activeTab, setActiveTab] = useState<DropdownTab>('custom')
  const [isCustomModalOpen, setIsCustomModalOpen] = useState(false)
  const [isAutoModalOpen, setIsAutoModalOpen] = useState(false)
  const [editingCustomList, setEditingCustomList] = useState<CustomDropdownList | null>(null)
  const [viewingAutoList, setViewingAutoList] = useState<CustomDropdownList | null>(null)

  const customLists = useMemo(() => dropdownLists.filter((list) => !list.is_auto_collected), [dropdownLists])
  const autoLists = useMemo(() => dropdownLists.filter((list) => list.is_auto_collected), [dropdownLists])
  const visibleLists = activeTab === 'custom' ? customLists : autoLists
  const tabs: Array<{ value: DropdownTab; label: string; count: number }> = [
    { value: 'custom', label: t({ ko: '커스텀', en: 'Custom' }), count: customLists.length },
    { value: 'auto', label: t({ ko: '자동수집', en: 'Auto collect' }), count: autoLists.length },
  ]

  return (
    <section>
      {/* RowGroup's heading row, with text tabs beside the label. */}
      <div className="mb-1 flex min-h-8 items-center justify-between gap-3 border-b border-foreground/15">
        <div className="flex min-w-0 items-center gap-4">
          <h3 className="flex shrink-0 items-center text-2xs font-semibold uppercase tracking-overline text-muted-foreground">
            <SectionLabel icon={<ListFilter />}>{t({ ko: '드롭다운 목록', en: 'Dropdown lists' })}</SectionLabel>
          </h3>
          <div role="tablist" className="flex min-w-0 items-center gap-3">
            {tabs.map((tab) => (
              // eslint-disable-next-line no-restricted-syntax -- text tabs inside the heading row
              <button
                key={tab.value}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.value}
                onClick={() => setActiveTab(tab.value)}
                className={cn(
                  '-mb-px cursor-pointer border-b-2 py-1.5 text-xs font-medium whitespace-nowrap outline-none transition-colors focus-visible:text-foreground',
                  activeTab === tab.value ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {tab.label} <span className="tabular-nums text-muted-foreground/60">{formatNumber(tab.count)}</span>
              </button>
            ))}
          </div>
        </div>
        {activeTab === 'custom' ? (
          <IconButton size="icon-sm" variant="ghost" onClick={() => setIsCustomModalOpen(true)} disabled={!canUpdateWorkflows} label={t({ ko: '목록 추가', en: 'Add list' })}>
            <Plus />
          </IconButton>
        ) : (
          <IconButton size="icon-sm" variant="ghost" onClick={() => setIsAutoModalOpen(true)} disabled={!isAdmin} label={t({ ko: '자동수집', en: 'Auto collect' })}>
            <RefreshCw />
          </IconButton>
        )}
      </div>

      {visibleLists.length > 0 ? visibleLists.map((list) => {
        const details = [
          list.description,
          list.source_path ? t({ ko: '소스 {path}', en: 'Source {path}' }, { path: list.source_path }) : null,
          list.items.slice(0, 6).join(', ') || null,
        ].filter(Boolean)
        return (
          <div key={list.id} className="flex min-h-11 items-center gap-2 border-b border-line last:border-b-0">
            <Tip content={details.length > 0 ? <span className="whitespace-pre-line">{details.join('\n')}</span> : null} align="start">
              <span className="min-w-0 truncate text-sm font-medium text-foreground">{list.name}</span>
            </Tip>
            <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">{formatNumber(list.items.length)}</span>
            <span className="flex-1" />
            {list.is_auto_collected ? (
              <IconButton size="icon-sm" variant="ghost" onClick={() => setViewingAutoList(list)} label={t({ ko: '보기', en: 'View' })}><Eye /></IconButton>
            ) : (
              <>
                <IconButton size="icon-sm" variant="ghost" onClick={() => setEditingCustomList(list)} disabled={!canUpdateWorkflows || isSubmitting} label={t({ ko: '수정', en: 'Edit' })}><Pencil /></IconButton>
                <IconButton size="icon-sm" variant="ghost" onClick={() => void onDeleteList(list.id)} disabled={!canUpdateWorkflows || isSubmitting} label={t({ ko: '삭제', en: 'Delete' })}><Trash2 /></IconButton>
              </>
            )}
          </div>
        )
      }) : <EmptyListRow />}

      <CustomDropdownListEditorModal
        open={isCustomModalOpen}
        isSubmitting={isSubmitting}
        onClose={() => setIsCustomModalOpen(false)}
        onSubmit={async (input) => {
          await onCreateManualList(input)
          setIsCustomModalOpen(false)
        }}
      />

      <CustomDropdownListEditorModal
        open={editingCustomList !== null}
        initialList={editingCustomList}
        isSubmitting={isSubmitting}
        onClose={() => setEditingCustomList(null)}
        onSubmit={async (input) => {
          if (!editingCustomList) {
            return
          }
          await onUpdateList(editingCustomList.id, input)
          setEditingCustomList(null)
        }}
      />

      <CustomDropdownListEditorModal
        open={viewingAutoList !== null}
        initialList={viewingAutoList}
        readOnly
        onClose={() => setViewingAutoList(null)}
      />

      <ComfyDropdownAutoCollectModal
        open={isAutoModalOpen}
        isSubmitting={isSubmitting}
        onClose={() => setIsAutoModalOpen(false)}
        onSubmit={async (input) => {
          await onScanAutoLists(input)
          setIsAutoModalOpen(false)
        }}
      />
    </section>
  )
}
