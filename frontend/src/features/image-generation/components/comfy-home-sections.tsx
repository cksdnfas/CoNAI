import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { Copy, FolderOpen, ListTree, Pencil, Plus, Save, Server, Trash2, Upload } from 'lucide-react'
import { SegmentedControl } from '@/components/common/segmented-control'
import { SectionHeading } from '@/components/common/section-heading'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
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
    <section className="space-y-3">
      <Card>
        <CardContent className="space-y-4">
          <SectionHeading
            variant="inside"
            className="border-b border-border/70 pb-4"
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
          />

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
        </CardContent>
      </Card>
    </section>
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
    <section className="space-y-3">
      <Card>
        <CardContent className="space-y-4">
          <SectionHeading
            variant="inside"
            className="border-b border-border/70 pb-4"
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
          />

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
                        </div>
                        <div className="mt-1 break-all text-[11px]">{server.endpoint}</div>
                        {server.description ? <div className="mt-1 text-[11px]">{server.description}</div> : null}
                        {connectionStatus?.response_time !== undefined ? <div className="mt-1 text-[11px]">{connectionStatus.response_time}ms</div> : null}
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
        </CardContent>
      </Card>
    </section>
  )
}

type DropdownListsSectionProps = {
  dropdownLists: CustomDropdownList[]
  isSubmitting?: boolean
  onCreateManualList: (input: { name: string; description?: string; items: string[] }) => Promise<void> | void
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

function stripKnownModelExtension(fileName: string) {
  const lowerName = fileName.toLowerCase()
  const matchedExtension = MODEL_FILE_EXTENSIONS.find((extension) => lowerName.endsWith(extension))
  if (!matchedExtension) {
    return null
  }

  return fileName.slice(0, -matchedExtension.length)
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

    const strippedFileName = stripKnownModelExtension(parts[parts.length - 1])
    if (!strippedFileName) {
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

    if (!bucket.files.includes(strippedFileName)) {
      bucket.files.push(strippedFileName)
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

export function ComfyDropdownListsSection({ dropdownLists, isSubmitting = false, onCreateManualList, onDeleteList, onScanAutoLists }: DropdownListsSectionProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [activeTab, setActiveTab] = useState<DropdownTab>('custom')
  const [customName, setCustomName] = useState('')
  const [customDescription, setCustomDescription] = useState('')
  const [customItemsText, setCustomItemsText] = useState('')
  const [selectedSourceFiles, setSelectedSourceFiles] = useState<RelativeFile[]>([])
  const [selectedSourceLabel, setSelectedSourceLabel] = useState('')
  const [mergeSubfolders, setMergeSubfolders] = useState(true)
  const [createBoth, setCreateBoth] = useState(false)

  useEffect(() => {
    if (!inputRef.current) {
      return
    }

    inputRef.current.setAttribute('webkitdirectory', '')
    inputRef.current.setAttribute('directory', '')
  }, [])

  const customLists = useMemo(() => dropdownLists.filter((list) => !list.is_auto_collected), [dropdownLists])
  const autoLists = useMemo(() => dropdownLists.filter((list) => list.is_auto_collected), [dropdownLists])
  const visibleLists = activeTab === 'custom' ? customLists : autoLists
  const customItems = useMemo(() => splitDropdownItems(customItemsText), [customItemsText])
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

  const handleCreateManual = async () => {
    const name = customName.trim()
    if (!name || customItems.length === 0) {
      return
    }

    await onCreateManualList({
      name,
      description: customDescription.trim() || undefined,
      items: customItems,
    })

    setCustomName('')
    setCustomDescription('')
    setCustomItemsText('')
  }

  const handleScanAuto = async () => {
    if (!autoScanPreview || autoScanPreview.modelFolders.length === 0) {
      return
    }

    await onScanAutoLists({
      modelFolders: autoScanPreview.modelFolders,
      sourcePath: autoScanPreview.sourcePath,
      mergeSubfolders,
      createBoth,
    })
  }

  return (
    <section className="space-y-3">
      <Card>
        <CardContent className="space-y-4">
          <SectionHeading
            variant="inside"
            className="border-b border-border/70 pb-4"
            heading="드롭다운 목록"
            actions={<Badge variant="outline">{dropdownLists.length}</Badge>}
          />

          <SegmentedControl
            value={activeTab}
            onChange={(value) => setActiveTab(value as DropdownTab)}
            size="sm"
            fullWidth
            items={[
              { value: 'custom', label: <span className="flex items-center justify-center gap-2">커스텀 <span className="text-xs text-muted-foreground">{customLists.length}</span></span> },
              { value: 'auto', label: <span className="flex items-center justify-center gap-2">자동수집 <span className="text-xs text-muted-foreground">{autoLists.length}</span></span> },
            ]}
          />

          {activeTab === 'custom' ? (
            <div className="space-y-4">
              <div className="space-y-3 rounded-sm border border-border bg-surface-low p-4">
                <div className="text-sm font-medium text-foreground">새 커스텀 목록</div>
                <Input value={customName} onChange={(event) => setCustomName(event.target.value)} placeholder="목록 이름" />
                <Textarea rows={3} value={customDescription} onChange={(event) => setCustomDescription(event.target.value)} placeholder="설명 (선택)" />
                <Textarea rows={6} value={customItemsText} onChange={(event) => setCustomItemsText(event.target.value)} placeholder="항목을 줄바꿈 또는 쉼표로 입력" />
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs text-muted-foreground">{customItems.length}개 항목</div>
                  <Button type="button" onClick={() => void handleCreateManual()} disabled={isSubmitting || !customName.trim() || customItems.length === 0}>
                    <Plus className="h-4 w-4" />
                    목록 추가
                  </Button>
                </div>
              </div>

              {visibleLists.length > 0 ? (
                <div className="space-y-2">
                  {visibleLists.map((list) => (
                    <div key={list.id} className="rounded-sm border border-border bg-surface-low px-3 py-3 text-sm text-muted-foreground">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-medium text-foreground">{list.name}</span>
                            <Badge variant="outline">items {list.items.length}</Badge>
                          </div>
                          {list.description ? <div className="mt-1 line-clamp-2 text-[11px]">{list.description}</div> : null}
                          {list.items.length > 0 ? <div className="mt-1 line-clamp-1 text-[11px]">{list.items.slice(0, 6).join(', ')}</div> : null}
                        </div>
                        <Button type="button" size="sm" variant="outline" onClick={() => void onDeleteList(list.id)} disabled={isSubmitting}>
                          <Trash2 className="h-4 w-4" />
                          삭제
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">등록된 커스텀 목록이 없어.</div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <input ref={inputRef} type="file" className="hidden" multiple onChange={(event) => handleFolderChange(event)} />

              <div className="space-y-3 rounded-sm border border-border bg-surface-low p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-foreground">ComfyUI 폴더 자동수집</div>
                    {selectedSourceLabel ? <div className="text-xs text-muted-foreground">{selectedSourceLabel}</div> : null}
                  </div>
                  <Button type="button" variant="outline" onClick={handlePickFolder} disabled={isSubmitting}>
                    <FolderOpen className="h-4 w-4" />
                    폴더 선택
                  </Button>
                </div>

                <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={mergeSubfolders} onChange={(event) => setMergeSubfolders(event.target.checked)} />
                    하위 폴더 통합
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={createBoth} onChange={(event) => setCreateBoth(event.target.checked)} disabled={!mergeSubfolders} />
                    통합 + 개별 둘 다 생성
                  </label>
                </div>

                {autoScanPreview ? (
                  <Alert>
                    <AlertTitle>수집 미리보기</AlertTitle>
                    <AlertDescription>
                      폴더 {autoScanPreview.modelFolders.length}개, 항목 {autoScanPreview.modelFolders.reduce((sum, folder) => sum + folder.files.length, 0)}개를 감지했어.
                    </AlertDescription>
                  </Alert>
                ) : null}

                <div className="flex justify-end">
                  <Button type="button" onClick={() => void handleScanAuto()} disabled={isSubmitting || !autoScanPreview || autoScanPreview.modelFolders.length === 0}>
                    <Upload className="h-4 w-4" />
                    자동수집 실행
                  </Button>
                </div>
              </div>

              {visibleLists.length > 0 ? (
                <div className="space-y-2">
                  {visibleLists.map((list) => (
                    <div key={list.id} className="rounded-sm border border-border bg-surface-low px-3 py-3 text-sm text-muted-foreground">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium text-foreground">{list.name}</span>
                        <Badge variant="secondary">auto</Badge>
                        <Badge variant="outline">items {list.items.length}</Badge>
                      </div>
                      {list.description ? <div className="mt-1 line-clamp-2 text-[11px]">{list.description}</div> : null}
                      {list.source_path ? <div className="mt-1 line-clamp-1 text-[11px]">source {list.source_path}</div> : null}
                      {list.items.length > 0 ? <div className="mt-1 line-clamp-1 text-[11px]">{list.items.slice(0, 6).join(', ')}</div> : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">자동수집된 목록이 없어.</div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
