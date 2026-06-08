import { useEffect, useMemo, useState } from 'react'
import { Copy, ListTree, Pencil, Plus, RotateCcw, Save, Server, Trash2, Upload } from 'lucide-react'
import { SegmentedTabBar } from '@/components/common/segmented-tab-bar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import { SettingsField, SettingsModalBody, SettingsModalFooter, SettingsSection, SettingsToggleRow } from '@/features/settings/components/settings-primitives'
import { useI18n } from '@/i18n'
import { DEFAULT_COMFY_MODEL_API_PATHS } from '@/lib/api-image-generation-workflows'
import type { ComfyUIServer, CustomDropdownList, GenerationWorkflow } from '@/lib/api-image-generation-types'
import type { ComfyUIServerTestState } from '../image-generation-shared'

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
  const { t, formatNumber } = useI18n()

  return (
    <SettingsSection
      heading={(
        <span className="flex items-center gap-2">
          <ListTree className="h-4 w-4 text-primary" />
          {t({ ko: '워크플로우', en: 'Workflows' })}
        </span>
      )}
      actions={(
        <>
          <Badge variant="outline">{workflows.length}</Badge>
          <Button type="button" size="sm" variant="outline" onClick={onCreateWorkflow}>
            <Plus className="h-4 w-4" />
            {t({ ko: '등록', en: 'Add' })}
          </Button>
        </>
      )}
    >
      {workflows.length > 0 ? (
        <div className="space-y-2">
          {workflows.map((workflow) => {
            const isSelected = String(workflow.id) === selectedWorkflowId
            return (
              <div
                key={workflow.id}
                className="rounded-sm border border-border bg-surface-low px-3 py-3 transition-colors hover:border-primary/35"
                style={isSelected ? { borderColor: workflow.color || 'var(--color-primary)' } : undefined}
              >
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => onSelectWorkflow(workflow.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="truncate text-sm font-medium text-foreground">{workflow.name}</div>
                      {isSelected ? <Badge variant="secondary">{t({ ko: '선택됨', en: 'Selected' })}</Badge> : null}
                    </div>
                    {workflow.description ? <div className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{workflow.description}</div> : null}
                  </button>

                  <div className="flex shrink-0 items-start gap-2">
                    <Badge variant="outline">{t({ ko: '필드 {count}', en: '{count} fields' }, { count: formatNumber((workflow.marked_fields ?? []).length) })}</Badge>
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        onClick={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          onSaveModule(workflow.id)
                        }}
                        aria-label={t({ ko: '{name} 모듈 저장', en: 'Save module for {name}' }, { name: workflow.name })}
                      >
                        <Save className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        onClick={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          onEditWorkflow(workflow.id)
                        }}
                        aria-label={t({ ko: '{name} 수정', en: 'Edit {name}' }, { name: workflow.name })}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        onClick={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          onCopyWorkflow(workflow.id)
                        }}
                        aria-label={t({ ko: '{name} 복사', en: 'Copy {name}' }, { name: workflow.name })}
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        onClick={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          onDeleteWorkflow(workflow.id)
                        }}
                        aria-label={t({ ko: '{name} 삭제', en: 'Delete {name}' }, { name: workflow.name })}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="text-sm text-muted-foreground">{t({ ko: '등록된 워크플로우가 없어.', en: 'No workflows registered.' })}</div>
      )}
    </SettingsSection>
  )
}

type ServerListSectionProps = {
  servers: ComfyUIServer[]
  activeServerCount: number
  serverTests: Record<number, ComfyUIServerTestState>
  onOpenCreateServer: () => void
  onEditServer: (serverId: number) => void
  onDeleteServer: (serverId: number) => void
  onTestServer: (serverId: number) => void
  onToggleServerActive: (serverId: number, isActive: boolean) => void
}

export function ComfyServerListSection({ servers, activeServerCount, serverTests, onOpenCreateServer, onEditServer, onDeleteServer, onTestServer, onToggleServerActive }: ServerListSectionProps) {
  const { t, formatNumber } = useI18n()
  const inactiveServerCount = Math.max(0, servers.length - activeServerCount)

  return (
    <SettingsSection
      heading={(
        <span className="flex items-center gap-2">
          <Server className="h-4 w-4 text-primary" />
          {t({ ko: '서버', en: 'Servers' })}
        </span>
      )}
      actions={(
        <>
          <Badge variant="outline">{t({ ko: '전체 {count}', en: '{count} total' }, { count: formatNumber(servers.length) })}</Badge>
          <Badge variant="secondary">{t({ ko: '활성 {count}', en: '{count} active' }, { count: formatNumber(activeServerCount) })}</Badge>
          {inactiveServerCount > 0 ? <Badge variant="outline">{t({ ko: '비활성 {count}', en: '{count} inactive' }, { count: formatNumber(inactiveServerCount) })}</Badge> : null}
          <Button type="button" size="sm" variant="outline" onClick={onOpenCreateServer}>
            <Plus className="h-4 w-4" />
            {t({ ko: '서버 등록', en: 'Add server' })}
          </Button>
        </>
      )}
    >
      {servers.length > 0 ? (
        <div className="space-y-2">
          {servers.map((server) => {
            const testState = serverTests[server.id]
            const connectionStatus = testState?.status
            const isModalServer = server.backend_type === 'modal' || connectionStatus?.backend_type === 'modal'
            const isActive = server.is_active !== false

            return (
              <div key={server.id} className="rounded-sm border border-border bg-surface-low px-3 py-3 text-sm text-muted-foreground">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium text-foreground">{server.name}</span>
                      <Badge variant={isActive ? 'secondary' : 'outline'}>{isActive ? t({ ko: '활성', en: 'Active' }) : t({ ko: '비활성', en: 'Inactive' })}</Badge>
                      {!isModalServer && server.is_default ? <Badge variant="secondary">{t({ ko: '대표', en: 'Default' })}</Badge> : null}
                      {isModalServer ? <Badge variant="outline">Modal</Badge> : null}
                      {isModalServer ? (
                        <Badge variant="outline">{t('image-generation.components.comfy.home.sections.modal.server.auto.check.skipped')}</Badge>
                      ) : connectionStatus ? (
                        <Badge variant={connectionStatus.is_connected ? 'secondary' : 'outline'}>
                          {connectionStatus.is_connected ? t({ ko: '연결됨', en: 'Connected' }) : t({ ko: '실패', en: 'Failed' })}
                        </Badge>
                      ) : null}
                      {connectionStatus?.is_connected && !isModalServer ? (
                        <Badge variant={connectionStatus.is_idle ? 'outline' : 'secondary'}>
                          {connectionStatus.is_idle ? 'idle' : t({ ko: '사용 중', en: 'Busy' })}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="mt-1 break-all text-[11px]">{server.endpoint}</div>
                    {server.description ? <div className="mt-1 text-[11px]">{server.description}</div> : null}
                    {server.routing_tags && server.routing_tags.length > 0 ? (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {server.routing_tags.map((tag) => (
                          <Badge key={`${server.id}:${tag}`} variant="outline">#{tag}</Badge>
                        ))}
                      </div>
                    ) : null}
                    {connectionStatus?.response_time !== undefined ? <div className="mt-1 text-[11px]">{connectionStatus.response_time}ms</div> : null}
                    {connectionStatus?.is_connected && !isModalServer ? (
                      <div className="mt-1 text-[11px]">
                        {t({ ko: '실행 {running} · 대기 {pending}', en: 'Running {running} · Pending {pending}' }, { running: formatNumber(connectionStatus.running_count ?? 0), pending: formatNumber(connectionStatus.pending_count ?? 0) })}
                      </div>
                    ) : null}
                    {connectionStatus?.error_message && !isModalServer ? <div className="mt-1 text-[11px] text-[#ffb4ab]">{connectionStatus.error_message}</div> : null}
                    {testState?.error ? <div className="mt-1 text-[11px] text-[#ffb4ab]">{testState.error}</div> : null}
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <SettingsToggleRow className="min-w-[8rem] px-2 py-1 text-xs">
                      <input
                        type="checkbox"
                        checked={isActive}
                        onChange={(event) => onToggleServerActive(server.id, event.target.checked)}
                      />
                      <span className="flex-1">{t({ ko: '활성', en: 'Active' })}</span>
                    </SettingsToggleRow>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => onTestServer(server.id)}
                      disabled={testState?.isLoading === true}
                      title={isModalServer ? t({ ko: 'Modal 서버 테스트는 원격 endpoint를 호출해서 비용이 발생할 수 있어.', en: 'Testing a Modal server may call the remote endpoint and incur costs.' }) : undefined}
                    >
                      {testState?.isLoading ? t({ ko: '확인 중…', en: 'Checking…' }) : t({ ko: '테스트', en: 'Test' })}
                    </Button>
                    <div className="flex gap-1">
                      <Button type="button" size="icon-xs" variant="ghost" onClick={() => onEditServer(server.id)} aria-label={t({ ko: '{name} 수정', en: 'Edit {name}' }, { name: server.name })}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button type="button" size="icon-xs" variant="ghost" onClick={() => onDeleteServer(server.id)} aria-label={t({ ko: '{name} 삭제', en: 'Delete {name}' }, { name: server.name })}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="text-sm text-muted-foreground">{t({ ko: '연결된 서버가 없어.', en: 'No connected servers.' })}</div>
      )}
    </SettingsSection>
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
    <SettingsModal open={open} onClose={onClose} title={readOnly ? t({ ko: '드롭다운 목록 상세', en: 'Dropdown list details' }) : initialList ? t({ ko: '커스텀 드롭다운 수정', en: 'Edit custom dropdown' }) : t({ ko: '커스텀 드롭다운 목록', en: 'Custom dropdown list' })} widthClassName="max-w-2xl">
      <SettingsModalBody className="space-y-5">
        <SettingsField label={t({ ko: '목록 이름', en: 'List name' })}>
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder={t({ ko: '목록 이름', en: 'List name' })} readOnly={readOnly} />
        </SettingsField>

        <SettingsField label={t({ ko: '설명', en: 'Description' })}>
          <Textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} placeholder={t({ ko: '설명 (선택)', en: 'Description (optional)' })} readOnly={readOnly} />
        </SettingsField>

        <SettingsField label={t({ ko: '항목', en: 'Items' })}>
          <Textarea rows={10} value={itemsText} onChange={(event) => setItemsText(event.target.value)} placeholder={t({ ko: '항목을 줄바꿈 또는 쉼표로 입력', en: 'Enter items separated by new lines or commas' })} readOnly={readOnly} />
        </SettingsField>

        <SettingsModalFooter className="justify-between">
          <div className="text-xs text-muted-foreground">{t({ ko: '{count}개 항목', en: '{count} items' }, { count: formatNumber(items.length) })}</div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>{readOnly ? t({ ko: '닫기', en: 'Close' }) : t({ ko: '취소', en: 'Cancel' })}</Button>
            {!readOnly ? (
              <Button type="button" onClick={() => void handleSubmit()} disabled={isSubmitting || !name.trim() || items.length === 0}>
                <Save className="h-4 w-4" />
                {t({ ko: '저장', en: 'Save' })}
              </Button>
            ) : null}
          </div>
        </SettingsModalFooter>
      </SettingsModalBody>
    </SettingsModal>
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
    <SettingsModal open={open} onClose={onClose} title={t({ ko: 'ComfyUI 자동수집', en: 'ComfyUI auto collect' })} widthClassName="max-w-3xl">
      <SettingsModalBody className="space-y-5">
        <SettingsField label={t({ ko: 'API 목록', en: 'API paths' })}>
          <Textarea
            variant="settings"
            rows={8}
            value={apiPathText}
            onChange={(event) => setApiPathText(event.target.value)}
            placeholder={DEFAULT_COMFY_MODEL_API_PATHS.join('\n')}
          />
        </SettingsField>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-muted-foreground">
            {t({ ko: '{count}개 경로', en: '{count} paths' }, { count: formatNumber(apiPaths.length) })}
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => setApiPathText(defaultPathText)} disabled={isSubmitting}>
            <RotateCcw className="h-4 w-4" />
            {t({ ko: '기본값 초기화', en: 'Reset defaults' })}
          </Button>
        </div>

        <div className="space-y-1 text-sm">
          <div className="font-medium text-foreground">{t({ ko: '대표 서버 API 기준', en: 'Representative server API' })}</div>
          <p className="text-muted-foreground">{t({ ko: '자동수집은 대표 ComfyUI 서버에서 실행되며 통합 + 개별 생성, 하위 폴더 통합은 항상 적용됩니다.', en: 'Auto collect runs against the representative ComfyUI server; merged + separate lists and subfolder merging are always applied.' })}</p>
        </div>

        <SettingsModalFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>{t({ ko: '취소', en: 'Cancel' })}</Button>
          <Button type="button" onClick={() => void handleSubmit()} disabled={isSubmitting}>
            <Upload className="h-4 w-4" />
            {t({ ko: '자동수집 실행', en: 'Run auto collect' })}
          </Button>
        </SettingsModalFooter>
      </SettingsModalBody>
    </SettingsModal>
  )
}

export function ComfyDropdownListsSection({ dropdownLists, isSubmitting = false, onCreateManualList, onUpdateList, onDeleteList, onScanAutoLists }: DropdownListsSectionProps) {
  const { t, formatNumber } = useI18n()
  const [activeTab, setActiveTab] = useState<DropdownTab>('custom')
  const [isCustomModalOpen, setIsCustomModalOpen] = useState(false)
  const [isAutoModalOpen, setIsAutoModalOpen] = useState(false)
  const [editingCustomList, setEditingCustomList] = useState<CustomDropdownList | null>(null)
  const [viewingAutoList, setViewingAutoList] = useState<CustomDropdownList | null>(null)

  const customLists = useMemo(() => dropdownLists.filter((list) => !list.is_auto_collected), [dropdownLists])
  const autoLists = useMemo(() => dropdownLists.filter((list) => list.is_auto_collected), [dropdownLists])
  const visibleLists = activeTab === 'custom' ? customLists : autoLists
  const dropdownListPreviewTextById = useMemo(
    () => new Map(dropdownLists.map((list) => [list.id, list.items.slice(0, 6).join(', ')])),
    [dropdownLists],
  )

  return (
    <section className="space-y-3">
      <SettingsSection heading={t({ ko: '드롭다운 목록', en: 'Dropdown lists' })} actions={<Badge variant="outline">{dropdownLists.length}</Badge>}>
        <SegmentedTabBar
          value={activeTab}
          onChange={(value) => setActiveTab(value as DropdownTab)}
          items={[
            { value: 'custom', label: t({ ko: '커스텀', en: 'Custom' }) },
            { value: 'auto', label: t({ ko: '자동수집', en: 'Auto collect' }) },
          ]}
        />

        <div className="flex items-center justify-between gap-3">
          <div className="text-sm text-muted-foreground">{activeTab === 'custom' ? t({ ko: '{count}개 목록', en: '{count} lists' }, { count: formatNumber(customLists.length) }) : t({ ko: '{count}개 목록', en: '{count} lists' }, { count: formatNumber(autoLists.length) })}</div>
          {activeTab === 'custom' ? (
            <Button type="button" size="sm" variant="outline" onClick={() => setIsCustomModalOpen(true)}>
              <Plus className="h-4 w-4" />
              {t({ ko: '목록 추가', en: 'Add list' })}
            </Button>
          ) : (
            <Button type="button" size="sm" variant="outline" onClick={() => setIsAutoModalOpen(true)}>
              <Upload className="h-4 w-4" />
              {t({ ko: '자동수집', en: 'Auto collect' })}
            </Button>
          )}
        </div>

        {visibleLists.length > 0 ? (
          <div className="space-y-2">
            {visibleLists.map((list) => (
              <div key={list.id} className="rounded-sm border border-border bg-surface-low px-3 py-3 text-sm text-muted-foreground">
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => {
                      if (list.is_auto_collected) {
                        setViewingAutoList(list)
                      }
                    }}
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium text-foreground">{list.name}</span>
                      <Badge variant={list.is_auto_collected ? 'secondary' : 'outline'}>{list.is_auto_collected ? 'auto' : 'manual'}</Badge>
                      <Badge variant="outline">{t({ ko: '항목 {count}', en: '{count} items' }, { count: formatNumber(list.items.length) })}</Badge>
                    </div>
                    {list.description ? <div className="mt-1 line-clamp-2 text-[11px]">{list.description}</div> : null}
                    {list.source_path ? <div className="mt-1 line-clamp-1 text-[11px]">{t({ ko: '소스 {path}', en: 'Source {path}' }, { path: list.source_path })}</div> : null}
                    {list.items.length > 0 ? <div className="mt-1 line-clamp-1 text-[11px]">{dropdownListPreviewTextById.get(list.id)}</div> : null}
                  </button>
                  {!list.is_auto_collected ? (
                    <div className="flex shrink-0 gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => setEditingCustomList(list)} disabled={isSubmitting}>
                        <Pencil className="h-4 w-4" />
                        {t({ ko: '수정', en: 'Edit' })}
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => void onDeleteList(list.id)} disabled={isSubmitting}>
                        <Trash2 className="h-4 w-4" />
                        {t({ ko: '삭제', en: 'Delete' })}
                      </Button>
                    </div>
                  ) : (
                    <Button type="button" size="sm" variant="outline" onClick={() => setViewingAutoList(list)}>
                      {t({ ko: '보기', en: 'View' })}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">{activeTab === 'custom' ? t({ ko: '등록된 커스텀 목록이 없어.', en: 'No custom lists registered.' }) : t({ ko: '자동수집된 목록이 없어.', en: 'No auto-collected lists.' })}</div>
        )}
      </SettingsSection>

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
