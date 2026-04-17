import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { Copy, FolderOpen, ListTree, Pencil, Plus, Save, Server, Trash2, Upload } from 'lucide-react'
import { SegmentedTabBar } from '@/components/common/segmented-tab-bar'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import { SettingsField, SettingsInsetBlock, SettingsModalBody, SettingsModalFooter, SettingsSection } from '@/features/settings/components/settings-primitives'
import type { ComfyUIModelFolderScanInput, ComfyUIServer, CustomDropdownList, GenerationWorkflow } from '@/lib/api'
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
  return (
    <SettingsSection
      heading={(
        <span className="flex items-center gap-2">
          <ListTree className="h-4 w-4 text-primary" />
          워크플로우
        </span>
      )}
      actions={(
        <>
          <Badge variant="outline">{workflows.length}</Badge>
          <Button type="button" size="sm" variant="outline" onClick={onCreateWorkflow}>
            <Plus className="h-4 w-4" />
            등록
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
                      {isSelected ? <Badge variant="secondary">선택됨</Badge> : null}
                    </div>
                    {workflow.description ? <div className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{workflow.description}</div> : null}
                  </button>

                  <div className="flex shrink-0 items-start gap-2">
                    <Badge variant="outline">필드 {(workflow.marked_fields ?? []).length}</Badge>
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
                        aria-label={`${workflow.name} 모듈 저장`}
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
                        aria-label={`${workflow.name} 수정`}
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
                        aria-label={`${workflow.name} 복사`}
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
                        aria-label={`${workflow.name} 삭제`}
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
        <div className="text-sm text-muted-foreground">등록된 워크플로우가 없어.</div>
      )}
    </SettingsSection>
  )
}

type ServerListSectionProps = {
  servers: ComfyUIServer[]
  serverTests: Record<number, ComfyUIServerTestState>
  onOpenCreateServer: () => void
  onEditServer: (serverId: number) => void
  onDeleteServer: (serverId: number) => void
  onTestServer: (serverId: number) => void
}

export function ComfyServerListSection({ servers, serverTests, onOpenCreateServer, onEditServer, onDeleteServer, onTestServer }: ServerListSectionProps) {
  return (
    <SettingsSection
      heading={(
        <span className="flex items-center gap-2">
          <Server className="h-4 w-4 text-primary" />
          서버
        </span>
      )}
      actions={(
        <>
          <Badge variant="outline">{servers.length}</Badge>
          <Button type="button" size="sm" variant="outline" onClick={onOpenCreateServer}>
            <Plus className="h-4 w-4" />
            서버 등록
          </Button>
        </>
      )}
    >
      {servers.length > 0 ? (
        <div className="space-y-2">
          {servers.map((server) => {
            const testState = serverTests[server.id]
            const connectionStatus = testState?.status

            return (
              <div key={server.id} className="rounded-sm border border-border bg-surface-low px-3 py-3 text-sm text-muted-foreground">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium text-foreground">{server.name}</span>
                      {connectionStatus ? (
                        <Badge variant={connectionStatus.is_connected ? 'secondary' : 'outline'}>
                          {connectionStatus.is_connected ? '연결됨' : '실패'}
                        </Badge>
                      ) : null}
                      {connectionStatus?.is_connected ? (
                        <Badge variant={connectionStatus.is_idle ? 'outline' : 'secondary'}>
                          {connectionStatus.is_idle ? 'idle' : 'busy'}
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
                    {connectionStatus?.is_connected ? (
                      <div className="mt-1 text-[11px]">
                        running {connectionStatus.running_count ?? 0} · pending {connectionStatus.pending_count ?? 0}
                      </div>
                    ) : null}
                    {connectionStatus?.error_message ? <div className="mt-1 text-[11px] text-[#ffb4ab]">{connectionStatus.error_message}</div> : null}
                    {testState?.error ? <div className="mt-1 text-[11px] text-[#ffb4ab]">{testState.error}</div> : null}
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => onTestServer(server.id)} disabled={testState?.isLoading === true}>
                      {testState?.isLoading ? '확인 중…' : '테스트'}
                    </Button>
                    <div className="flex gap-1">
                      <Button type="button" size="icon-xs" variant="ghost" onClick={() => onEditServer(server.id)} aria-label={`${server.name} 수정`}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button type="button" size="icon-xs" variant="ghost" onClick={() => onDeleteServer(server.id)} aria-label={`${server.name} 삭제`}>
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
        <div className="text-sm text-muted-foreground">연결된 서버가 없어.</div>
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
  onScanAutoLists: (input: {
    modelFolders: ComfyUIModelFolderScanInput[]
    sourcePath?: string
    mergeSubfolders?: boolean
    createBoth?: boolean
  }) => Promise<void> | void
}

type DropdownTab = 'custom' | 'auto'
type RelativeFile = File & { webkitRelativePath?: string }

const KNOWN_MODEL_ROOTS = new Set([
  'checkpoints',
  'clip',
  'clip_vision',
  'controlnet',
  'diffusion_models',
  'embeddings',
  'gligen',
  'hypernetworks',
  'ipadapter',
  'loras',
  'photomaker',
  'style_models',
  'text_encoders',
  'unet',
  'upscale_models',
  'vae',
  'vae_approx',
  'vae_approximation',
])
const MODEL_FILE_EXTENSIONS = ['.safetensors', '.ckpt', '.pt', '.pth', '.bin', '.gguf', '.onnx']

function splitDropdownItems(rawValue: string) {
  return rawValue
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean)
}

/** Keep known model file extensions so auto-collected dropdowns match ComfyUI object-info values exactly. */
function getKnownModelFileName(fileName: string) {
  const lowerName = fileName.toLowerCase()
  const matchedExtension = MODEL_FILE_EXTENSIONS.find((extension) => lowerName.endsWith(extension))
  if (!matchedExtension) {
    return null
  }

  return fileName
}

function collectModelFoldersFromSelection(files: RelativeFile[]) {
  const folderMap = new Map<string, ComfyUIModelFolderScanInput>()
  const firstRelativePath = files[0]?.webkitRelativePath ?? files[0]?.name ?? ''
  const selectedRootName = firstRelativePath.split('/')[0] || 'selected-folder'

  for (const file of files) {
    const relativePath = file.webkitRelativePath ?? file.name
    const parts = relativePath.split('/').filter(Boolean)
    if (parts.length < 2) {
      continue
    }

    const modelFileName = getKnownModelFileName(parts[parts.length - 1])
    if (!modelFileName) {
      continue
    }

    let folderParts = parts.slice(0, -1)
    if (parts.length >= 3 && KNOWN_MODEL_ROOTS.has(parts[1].toLowerCase())) {
      folderParts = parts.slice(1, -1)
    }

    const rootFolder = folderParts[0] ?? selectedRootName
    const displayName = folderParts.join('/') || rootFolder
    const bucket = folderMap.get(displayName) ?? {
      folderName: rootFolder,
      displayName,
      files: [],
    }

    if (!bucket.files.includes(modelFileName)) {
      bucket.files.push(modelFileName)
    }
    folderMap.set(displayName, bucket)
  }

  return {
    sourcePath: selectedRootName,
    modelFolders: [...folderMap.values()]
      .map((folder) => ({
        ...folder,
        files: [...folder.files].sort((left, right) => left.localeCompare(right, 'ko')),
      }))
      .sort((left, right) => left.displayName.localeCompare(right.displayName, 'ko')),
  }
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
    <SettingsModal open={open} onClose={onClose} title={readOnly ? '드롭다운 목록 상세' : initialList ? '커스텀 드롭다운 수정' : '커스텀 드롭다운 목록'} widthClassName="max-w-2xl">
      <SettingsModalBody className="space-y-5">
        <SettingsField label="목록 이름">
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="목록 이름" readOnly={readOnly} />
        </SettingsField>

        <SettingsField label="설명">
          <Textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="설명 (선택)" readOnly={readOnly} />
        </SettingsField>

        <SettingsField label="항목">
          <Textarea rows={10} value={itemsText} onChange={(event) => setItemsText(event.target.value)} placeholder="항목을 줄바꿈 또는 쉼표로 입력" readOnly={readOnly} />
        </SettingsField>

        <SettingsModalFooter className="justify-between">
          <div className="text-xs text-muted-foreground">{items.length}개 항목</div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>{readOnly ? '닫기' : '취소'}</Button>
            {!readOnly ? (
              <Button type="button" onClick={() => void handleSubmit()} disabled={isSubmitting || !name.trim() || items.length === 0}>
                <Save className="h-4 w-4" />
                저장
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
  onSubmit: (input: {
    modelFolders: ComfyUIModelFolderScanInput[]
    sourcePath?: string
    mergeSubfolders?: boolean
    createBoth?: boolean
  }) => Promise<void> | void
}

function ComfyDropdownAutoCollectModal({ open, isSubmitting = false, onClose, onSubmit }: ComfyDropdownAutoCollectModalProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [selectedSourceFiles, setSelectedSourceFiles] = useState<RelativeFile[]>([])
  const [selectedSourceLabel, setSelectedSourceLabel] = useState('')
  const [mergeSubfolders, setMergeSubfolders] = useState(true)
  const [createBoth, setCreateBoth] = useState(false)

  useEffect(() => {
    if (!open) {
      return
    }

    setSelectedSourceFiles([])
    setSelectedSourceLabel('')
    setMergeSubfolders(true)
    setCreateBoth(false)
  }, [open])

  useEffect(() => {
    if (!inputRef.current) {
      return
    }

    inputRef.current.setAttribute('webkitdirectory', '')
    inputRef.current.setAttribute('directory', '')
  }, [open])

  const autoScanPreview = useMemo(() => (selectedSourceFiles.length > 0 ? collectModelFoldersFromSelection(selectedSourceFiles) : null), [selectedSourceFiles])

  const handlePickFolder = () => {
    inputRef.current?.click()
  }

  const handleFolderChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []) as RelativeFile[]
    if (files.length === 0) {
      return
    }

    const sourceLabel = files[0]?.webkitRelativePath?.split('/')[0] ?? files[0]?.name ?? 'selected-folder'
    setSelectedSourceFiles(files)
    setSelectedSourceLabel(sourceLabel)
    event.target.value = ''
  }

  const handleSubmit = async () => {
    if (!autoScanPreview || autoScanPreview.modelFolders.length === 0) {
      return
    }

    await onSubmit({
      modelFolders: autoScanPreview.modelFolders,
      sourcePath: autoScanPreview.sourcePath,
      mergeSubfolders,
      createBoth,
    })
  }

  return (
    <SettingsModal open={open} onClose={onClose} title="ComfyUI 자동수집" widthClassName="max-w-3xl">
      <SettingsModalBody className="space-y-5">
        <input ref={inputRef} type="file" className="hidden" multiple onChange={(event) => handleFolderChange(event)} />

        <SettingsInsetBlock className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" onClick={handlePickFolder} disabled={isSubmitting}>
              <FolderOpen className="h-4 w-4" />
              {selectedSourceLabel ? selectedSourceLabel : '폴더 선택'}
            </Button>
          </div>

          <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={mergeSubfolders} onChange={(event) => setMergeSubfolders(event.target.checked)} />
              하위 폴더 통합
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={createBoth} onChange={(event) => setCreateBoth(event.target.checked)} disabled={!mergeSubfolders} />
              통합 + 개별 생성
            </label>
          </div>

          {autoScanPreview ? (
            <Alert>
              <AlertTitle>수집 미리보기</AlertTitle>
              <AlertDescription>
                폴더 {autoScanPreview.modelFolders.length}개, 항목 {autoScanPreview.modelFolders.reduce((sum, folder) => sum + folder.files.length, 0)}개
              </AlertDescription>
            </Alert>
          ) : null}
        </SettingsInsetBlock>

        <SettingsModalFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>취소</Button>
          <Button type="button" onClick={() => void handleSubmit()} disabled={isSubmitting || !autoScanPreview || autoScanPreview.modelFolders.length === 0}>
            <Upload className="h-4 w-4" />
            자동수집 실행
          </Button>
        </SettingsModalFooter>
      </SettingsModalBody>
    </SettingsModal>
  )
}

export function ComfyDropdownListsSection({ dropdownLists, isSubmitting = false, onCreateManualList, onUpdateList, onDeleteList, onScanAutoLists }: DropdownListsSectionProps) {
  const [activeTab, setActiveTab] = useState<DropdownTab>('custom')
  const [isCustomModalOpen, setIsCustomModalOpen] = useState(false)
  const [isAutoModalOpen, setIsAutoModalOpen] = useState(false)
  const [editingCustomList, setEditingCustomList] = useState<CustomDropdownList | null>(null)
  const [viewingAutoList, setViewingAutoList] = useState<CustomDropdownList | null>(null)

  const customLists = useMemo(() => dropdownLists.filter((list) => !list.is_auto_collected), [dropdownLists])
  const autoLists = useMemo(() => dropdownLists.filter((list) => list.is_auto_collected), [dropdownLists])
  const visibleLists = activeTab === 'custom' ? customLists : autoLists

  return (
    <section className="space-y-3">
      <SettingsSection heading="드롭다운 목록" actions={<Badge variant="outline">{dropdownLists.length}</Badge>}>
        <SegmentedTabBar
          value={activeTab}
          onChange={(value) => setActiveTab(value as DropdownTab)}
          items={[
            { value: 'custom', label: '커스텀' },
            { value: 'auto', label: '자동수집' },
          ]}
        />

        <div className="flex items-center justify-between gap-3">
          <div className="text-sm text-muted-foreground">{activeTab === 'custom' ? `${customLists.length}개 목록` : `${autoLists.length}개 목록`}</div>
          {activeTab === 'custom' ? (
            <Button type="button" size="sm" variant="outline" onClick={() => setIsCustomModalOpen(true)}>
              <Plus className="h-4 w-4" />
              목록 추가
            </Button>
          ) : (
            <Button type="button" size="sm" variant="outline" onClick={() => setIsAutoModalOpen(true)}>
              <FolderOpen className="h-4 w-4" />
              자동수집
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
                      <Badge variant="outline">items {list.items.length}</Badge>
                    </div>
                    {list.description ? <div className="mt-1 line-clamp-2 text-[11px]">{list.description}</div> : null}
                    {list.source_path ? <div className="mt-1 line-clamp-1 text-[11px]">source {list.source_path}</div> : null}
                    {list.items.length > 0 ? <div className="mt-1 line-clamp-1 text-[11px]">{list.items.slice(0, 6).join(', ')}</div> : null}
                  </button>
                  {!list.is_auto_collected ? (
                    <div className="flex shrink-0 gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => setEditingCustomList(list)} disabled={isSubmitting}>
                        <Pencil className="h-4 w-4" />
                        수정
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => void onDeleteList(list.id)} disabled={isSubmitting}>
                        <Trash2 className="h-4 w-4" />
                        삭제
                      </Button>
                    </div>
                  ) : (
                    <Button type="button" size="sm" variant="outline" onClick={() => setViewingAutoList(list)}>
                      보기
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">{activeTab === 'custom' ? '등록된 커스텀 목록이 없어.' : '자동수집된 목록이 없어.'}</div>
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
