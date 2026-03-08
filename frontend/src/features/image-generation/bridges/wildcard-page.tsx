import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Play, RefreshCw, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useWildcardTree } from '@/hooks/use-wildcard-tree'
import {
  wildcardApi,
  type LoraFileData,
  type WildcardChainOption,
  type WildcardCreateInput,
  type WildcardTool,
  type WildcardToolItemInput,
  type WildcardWithHierarchy,
  type WildcardWithItems,
} from '@/services/wildcard-api'
import { WildcardDeleteConfirmDialog } from '@/features/image-generation/wildcards/components/wildcard-delete-confirm-dialog'
import { WildcardDetailPanel } from '@/features/image-generation/wildcards/components/wildcard-detail-panel'
import { WildcardTreePanel } from '@/features/image-generation/wildcards/components/wildcard-tree-panel'

export type WildcardMode = 'manual' | 'chain' | 'auto'

interface WildcardPageProps {
  mode: WildcardMode
}

interface FormItem {
  key: string
  content: string
  weight: number
}

interface EditorForm {
  name: string
  description: string
  parentId: string
  includeChildren: boolean
  onlyChildren: boolean
  chainOption: WildcardChainOption
  comfyuiItems: FormItem[]
  naiItems: FormItem[]
}

const directoryPickerProps: Record<string, string> = {
  webkitdirectory: '',
  directory: '',
}

let formItemId = 0

function makeFormItem(content = '', weight = 1): FormItem {
  formItemId += 1
  return { key: `form-item-${formItemId}`, content, weight }
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message
  }

  if (typeof error === 'object' && error !== null) {
    const response = (error as { response?: { data?: { error?: string; message?: string } } }).response
    if (response?.data?.error) {
      return response.data.error
    }
    if (response?.data?.message) {
      return response.data.message
    }
  }

  return fallback
}

function filterByMode(nodes: WildcardWithHierarchy[], mode: WildcardMode): WildcardWithHierarchy[] {
  const keepNode = (node: WildcardWithHierarchy): boolean => {
    if (mode === 'manual') {
      return node.is_auto_collected !== 1 && node.type !== 'chain'
    }
    if (mode === 'chain') {
      return node.type === 'chain'
    }
    return node.is_auto_collected === 1
  }

  return nodes
    .filter(keepNode)
    .map((node) => ({
      ...node,
      children: Array.isArray(node.children) ? filterByMode(node.children, mode) : [],
    }))
}

function flatten(nodes: WildcardWithHierarchy[]): WildcardWithHierarchy[] {
  const result: WildcardWithHierarchy[] = []
  const walk = (items: WildcardWithHierarchy[]) => {
    for (const node of items) {
      result.push(node)
      if (Array.isArray(node.children) && node.children.length > 0) {
        walk(node.children)
      }
    }
  }
  walk(nodes)
  return result
}

function collectDescendantIds(node: WildcardWithHierarchy): Set<number> {
  const result = new Set<number>()
  const walk = (items: WildcardWithHierarchy[] | undefined) => {
    if (!Array.isArray(items)) {
      return
    }
    for (const child of items) {
      result.add(child.id)
      walk(child.children)
    }
  }
  walk(node.children)
  return result
}

function mapNodeItems(node: WildcardWithItems, tool: WildcardTool): FormItem[] {
  const mapped = node.items
    .filter((item) => item.tool === tool)
    .map((item) => makeFormItem(item.content, item.weight ?? 1))

  return mapped.length > 0 ? mapped : [makeFormItem()]
}

async function copyToClipboard(value: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(value)
      return true
    } catch {
      // fall through to legacy fallback
    }
  }

  if (typeof document === 'undefined') {
    return false
  }

  const textArea = document.createElement('textarea')
  textArea.value = value
  textArea.style.position = 'fixed'
  textArea.style.left = '-9999px'
  textArea.style.top = '-9999px'
  document.body.appendChild(textArea)
  textArea.focus()
  textArea.select()

  let copied = false
  try {
    copied = document.execCommand('copy')
  } catch {
    copied = false
  }

  document.body.removeChild(textArea)
  return copied
}

const defaultForm: EditorForm = {
  name: '',
  description: '',
  parentId: '__none__',
  includeChildren: true,
  onlyChildren: false,
  chainOption: 'replace',
  comfyuiItems: [makeFormItem()],
  naiItems: [makeFormItem()],
}

export default function WildcardPage({ mode }: WildcardPageProps) {
  const { t } = useTranslation(['wildcards', 'common'])

  const [nodes, setNodes] = useState<WildcardWithHierarchy[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const {
    selectedNode,
    expandedIds,
    handleSelect,
    handleToggle,
    handleExpandAll,
    handleCollapseAll,
    sortNodesByHierarchy,
    setSelectedNode,
  } = useWildcardTree<WildcardWithHierarchy>(nodes)

  const [copyNotice, setCopyNotice] = useState<string | null>(null)

  const [editorOpen, setEditorOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editorError, setEditorError] = useState<string | null>(null)
  const [editingNode, setEditingNode] = useState<WildcardWithItems | null>(null)
  const [form, setForm] = useState<EditorForm>(defaultForm)
  const [editorToolTab, setEditorToolTab] = useState<WildcardTool>('comfyui')

  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewTool, setPreviewTool] = useState<WildcardTool>('comfyui')
  const [previewText, setPreviewText] = useState('')
  const [previewResults, setPreviewResults] = useState<string[]>([])
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)

  const [deleteOpen, setDeleteOpen] = useState(false)

  const [selectedFiles, setSelectedFiles] = useState<LoraFileData[]>([])
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [loraWeight, setLoraWeight] = useState(1)
  const [duplicateHandling, setDuplicateHandling] = useState<'number' | 'parent'>('number')
  const [matchingMode, setMatchingMode] = useState<'filename' | 'common'>('filename')
  const [commonTextFilename, setCommonTextFilename] = useState('add.txt')
  const [matchingPriority, setMatchingPriority] = useState<'filename' | 'common'>('filename')

  const [logDialogOpen, setLogDialogOpen] = useState(false)
  const [lastScanLog, setLastScanLog] = useState<Awaited<ReturnType<typeof wildcardApi.getLastScanLog>>['data']>(null)

  const flatNodes = useMemo(() => flatten(nodes), [nodes])

  const availableParents = useMemo(() => {
    if (!editingNode) {
      return flatNodes
    }

    const descendants = collectDescendantIds(editingNode)
    return flatNodes.filter((node) => node.id !== editingNode.id && !descendants.has(node.id))
  }, [flatNodes, editingNode])

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await wildcardApi.getWildcardsHierarchical()
      const next = filterByMode(response.data ?? [], mode)
      setNodes(next)

      setSelectedNode((previous) => {
        if (!previous) {
          if (mode === 'auto' && next.length > 0) {
            return next[0]
          }
          return null
        }

        return flatten(next).find((node) => node.id === previous.id) ?? null
      })
    } catch (loadError) {
      setError(toErrorMessage(loadError, 'Failed to load wildcard data.'))
      setNodes([])
      setSelectedNode(null)
    } finally {
      setLoading(false)
    }
  }, [mode, setSelectedNode])

  const loadLastScanLog = useCallback(async () => {
    try {
      const response = await wildcardApi.getLastScanLog()
      setLastScanLog(response.data)
    } catch (loadError) {
      setError(toErrorMessage(loadError, 'Failed to load scan log.'))
    }
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  useEffect(() => {
    if (mode === 'auto') {
      void loadLastScanLog()
    }
  }, [mode, loadLastScanLog])

  const onCopy = async (value: string) => {
    const copied = await copyToClipboard(value)
    if (copied) {
      setCopyNotice(t('wildcards:actions.copiedToClipboard', { defaultValue: 'Copied to clipboard' }))
    } else {
      setCopyNotice(t('wildcards:actions.copyFailed', { defaultValue: 'Failed to copy' }))
    }
    window.setTimeout(() => setCopyNotice(null), 2000)
  }

  const openCreate = () => {
    setEditingNode(null)
    setEditorError(null)
    setForm({
      ...defaultForm,
      includeChildren: mode !== 'chain',
      onlyChildren: false,
      chainOption: 'replace',
      parentId: selectedNode ? String(selectedNode.id) : '__none__',
      comfyuiItems: [makeFormItem()],
      naiItems: [makeFormItem()],
    })
    setEditorOpen(true)
  }

  const openEdit = () => {
    if (!selectedNode) {
      return
    }

    setEditingNode(selectedNode)
    setEditorError(null)
    setForm({
      name: selectedNode.name,
      description: selectedNode.description ?? '',
      parentId: selectedNode.parent_id === null ? '__none__' : String(selectedNode.parent_id),
      includeChildren: selectedNode.include_children === 1,
      onlyChildren: selectedNode.only_children === 1,
      chainOption: selectedNode.chain_option,
      comfyuiItems: mapNodeItems(selectedNode, 'comfyui'),
      naiItems: mapNodeItems(selectedNode, 'nai'),
    })
    setEditorOpen(true)
  }

  const patchItems = (tool: WildcardTool, updater: (items: FormItem[]) => FormItem[]) => {
    if (tool === 'comfyui') {
      setForm((prev) => ({ ...prev, comfyuiItems: updater(prev.comfyuiItems) }))
      return
    }
    setForm((prev) => ({ ...prev, naiItems: updater(prev.naiItems) }))
  }

  const toItemInputs = (items: FormItem[]): WildcardToolItemInput[] => {
    return items
      .map((item) => ({ content: item.content.trim(), weight: Number.isFinite(item.weight) ? item.weight : 1 }))
      .filter((item) => item.content.length > 0)
  }

  const save = async () => {
    const comfyui = toItemInputs(form.comfyuiItems)
    const nai = toItemInputs(form.naiItems)

    if (!form.name.trim()) {
      setEditorError(t('wildcards:errors.nameRequired'))
      return
    }

    if (!(mode === 'manual' && form.onlyChildren) && comfyui.length === 0 && nai.length === 0) {
      setEditorError(t('wildcards:errors.itemsRequired'))
      return
    }

    const payload: WildcardCreateInput = {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      parent_id: form.parentId === '__none__' ? null : Number(form.parentId),
      include_children: form.includeChildren ? 1 : 0,
      only_children: form.onlyChildren ? 1 : 0,
      type: mode === 'chain' ? 'chain' : undefined,
      chain_option: mode === 'chain' ? form.chainOption : undefined,
      items: {
        comfyui,
        nai,
      },
    }

    try {
      setSaving(true)
      setEditorError(null)

      if (editingNode) {
        await wildcardApi.updateWildcard(editingNode.id, payload)
      } else {
        await wildcardApi.createWildcard(payload)
      }

      setEditorOpen(false)
      setEditingNode(null)
      await loadData()
    } catch (saveError) {
      setEditorError(toErrorMessage(saveError, 'Failed to save wildcard.'))
    } finally {
      setSaving(false)
    }
  }

  const runPreview = async () => {
    if (!previewText.trim()) {
      setPreviewError(t('wildcards:errors.previewTextRequired'))
      return
    }

    try {
      setPreviewLoading(true)
      setPreviewError(null)
      const response = await wildcardApi.parseWildcards({ text: previewText, tool: previewTool, count: 5 })
      setPreviewResults(response.data.results)
    } catch (previewLoadError) {
      setPreviewError(toErrorMessage(previewLoadError, 'Failed to preview wildcards.'))
      setPreviewResults([])
    } finally {
      setPreviewLoading(false)
    }
  }

  const deleteSelected = async (cascade: boolean) => {
    if (!selectedNode) {
      return
    }
    try {
      await wildcardApi.deleteWildcard(selectedNode.id, cascade)
      setDeleteOpen(false)
      setSelectedNode(null)
      await loadData()
    } catch (deleteError) {
      setError(toErrorMessage(deleteError, t('wildcards:messages.deleteFailed')))
    }
  }

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (!files || files.length === 0) {
      return
    }

    const allFiles = Array.from(files) as Array<File & { webkitRelativePath?: string }>
    const textFiles = new Map<string, string[]>()

    for (const file of allFiles) {
      const relativePath = file.webkitRelativePath ?? file.name
      if (!relativePath.toLowerCase().endsWith('.txt')) {
        continue
      }

      const content = await file.text()
      textFiles.set(
        relativePath,
        content
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
      )
    }

    const parsed: LoraFileData[] = []

    for (const file of allFiles) {
      const relativePath = file.webkitRelativePath ?? file.name
      if (!relativePath.toLowerCase().endsWith('.safetensors')) {
        continue
      }

      const loraName = file.name.replace(/\.safetensors$/i, '')
      const pathParts = relativePath.split('/')
      const folderPath = pathParts.slice(0, -1).join('/')
      const folderName = pathParts.slice(1, -1).join('/') || pathParts[0] || ''

      const byFileName = textFiles.get(relativePath.replace(/\.safetensors$/i, '.txt')) ?? []
      const byCommon = textFiles.get(`${folderPath}/${commonTextFilename}`) ?? []

      let promptLines: string[]
      if (matchingMode === 'filename') {
        promptLines = byFileName
      } else if (matchingPriority === 'common') {
        promptLines = byCommon.length > 0 ? byCommon : byFileName
      } else {
        promptLines = byFileName.length > 0 ? byFileName : byCommon
      }

      parsed.push({ folderName, loraName, promptLines })
    }

    setSelectedFiles(parsed)
    setScanError(null)
  }

  const scan = async () => {
    if (selectedFiles.length === 0) {
      setScanError(t('wildcards:autoCollect.errors.folderPathRequired'))
      return
    }

    if (loraWeight < 0.1 || loraWeight > 2.0) {
      setScanError(t('wildcards:autoCollect.errors.invalidWeight'))
      return
    }

    try {
      setScanning(true)
      setScanError(null)
      await wildcardApi.scanLoraFolder({
        loraFiles: selectedFiles,
        loraWeight,
        duplicateHandling,
        matchingMode,
        commonTextFilename,
        matchingPriority,
      })

      await Promise.all([loadData(), loadLastScanLog()])
    } catch (scanLoadError) {
      setScanError(
        t('wildcards:autoCollect.errors.scanFailed', {
          error: toErrorMessage(scanLoadError, 'unknown'),
        })
      )
    } finally {
      setScanning(false)
    }
  }

  const title =
    mode === 'manual'
      ? t('wildcards:tabs.manual')
      : mode === 'chain'
        ? t('wildcards:tabs.chain')
        : t('wildcards:tabs.autoCollected')

  const emptyMessage =
    mode === 'manual'
      ? t('wildcards:page.noWildcards')
      : mode === 'chain'
        ? t('wildcards:page.noChains')
        : t('wildcards:autoCollect.noAutoWildcards')

  return (
    <section className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void loadData()}>
            <RefreshCw className="h-3.5 w-3.5" />
            {t('common:refresh')}
          </Button>

          {mode !== 'auto' ? (
            <>
              <Button type="button" size="sm" onClick={openCreate}>
                <Plus className="h-3.5 w-3.5" />
                {t('wildcards:actions.add')}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setPreviewOpen(true)}>
                <Play className="h-3.5 w-3.5" />
                {t('wildcards:actions.preview')}
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {copyNotice ? (
        <Alert>
          <AlertDescription>{copyNotice}</AlertDescription>
        </Alert>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{t('common:messages.error')}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {mode === 'auto' ? (
        <section className="space-y-3 rounded-md border p-3">
          <p className="text-muted-foreground text-sm">{t('wildcards:autoCollect.description')}</p>

          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="auto-wildcard-folder-picker">
              <Button asChild type="button" variant="outline" size="sm">
                <span>{t('wildcards:autoCollect.folderPath')}</span>
              </Button>
            </label>
            <input
              id="auto-wildcard-folder-picker"
              type="file"
              className="hidden"
              multiple
              onChange={handleFileSelect}
              {...directoryPickerProps}
            />
            <span className="text-sm">{t('wildcards:autoCollect.filesSelected', { count: selectedFiles.length })}</span>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="lora-weight-input">
                {t('wildcards:autoCollect.loraWeight')}
              </label>
              <Input
                id="lora-weight-input"
                type="number"
                min={0.1}
                max={2}
                step={0.1}
                value={String(loraWeight)}
                onChange={(event) => setLoraWeight(Number(event.target.value))}
              />
            </div>

            <div className="space-y-1">
              <p className="text-sm font-medium">{t('wildcards:autoCollect.duplicateHandling')}</p>
              <Select value={duplicateHandling} onValueChange={(value) => setDuplicateHandling(value as 'number' | 'parent')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="number">{t('wildcards:autoCollect.duplicateNumber')}</SelectItem>
                  <SelectItem value="parent">{t('wildcards:autoCollect.duplicateParent')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <p className="text-sm font-medium">{t('wildcards:autoCollect.matchingMode')}</p>
              <Select value={matchingMode} onValueChange={(value) => setMatchingMode(value as 'filename' | 'common')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="filename">{t('wildcards:autoCollect.matchingModeFilename')}</SelectItem>
                  <SelectItem value="common">{t('wildcards:autoCollect.matchingModeCommon')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {matchingMode === 'common' ? (
              <>
                <div className="space-y-1">
                  <label className="text-sm font-medium" htmlFor="common-filename-input">
                    {t('wildcards:autoCollect.commonTextFilename')}
                  </label>
                  <Input
                    id="common-filename-input"
                    value={commonTextFilename}
                    onChange={(event) => setCommonTextFilename(event.target.value)}
                  />
                </div>

                <div className="space-y-1">
                  <p className="text-sm font-medium">{t('wildcards:autoCollect.matchingPriority')}</p>
                  <Select value={matchingPriority} onValueChange={(value) => setMatchingPriority(value as 'filename' | 'common')}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="filename">{t('wildcards:autoCollect.priorityFilename')}</SelectItem>
                      <SelectItem value="common">{t('wildcards:autoCollect.priorityCommon')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => void scan()} disabled={scanning || selectedFiles.length === 0}>
              {scanning ? t('wildcards:autoCollect.scanning') : t('wildcards:autoCollect.scanButton')}
            </Button>
            <Button type="button" variant="outline" onClick={() => setLogDialogOpen(true)}>
              {t('wildcards:buttons.openLogDialog')}
            </Button>
          </div>

          {scanError ? (
            <Alert variant="destructive">
              <AlertDescription>{scanError}</AlertDescription>
            </Alert>
          ) : null}
        </section>
      ) : null}

      {loading ? (
        <div className="text-muted-foreground rounded-md border p-4 text-sm">{t('common:messages.loading')}</div>
      ) : (
        <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[340px_1fr]">
          <WildcardTreePanel
            data={nodes}
            selectedId={selectedNode?.id ?? null}
            expandedIds={expandedIds}
            onSelect={handleSelect}
            onToggle={handleToggle}
            onExpandAll={handleExpandAll}
            onCollapseAll={handleCollapseAll}
            sortChildren={sortNodesByHierarchy}
            emptyMessage={emptyMessage}
          />

          <WildcardDetailPanel
            selectedNode={selectedNode}
            onCopy={(text) => {
              void onCopy(text)
            }}
            onChildClick={handleSelect}
            sortChildren={sortNodesByHierarchy}
            emptyMessage={t('wildcards:detail.selectItem')}
            actionButtons={
              mode !== 'auto' && selectedNode ? (
                <>
                  <Button type="button" variant="ghost" size="sm" onClick={openEdit}>
                    {t('wildcards:actions.edit')}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setDeleteOpen(true)}>
                    {t('wildcards:actions.delete')}
                  </Button>
                </>
              ) : undefined
            }
          />
        </div>
      )}

      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {editingNode
                ? mode === 'chain'
                  ? t('wildcards:dialog.editChainTitle')
                  : t('wildcards:dialog.editTitle')
                : mode === 'chain'
                  ? t('wildcards:dialog.createChainTitle')
                  : t('wildcards:dialog.createTitle')}
            </DialogTitle>
            <DialogDescription>{t('wildcards:form.itemsHelper')}</DialogDescription>
          </DialogHeader>

          <div className="max-h-[70vh] space-y-5 overflow-y-auto pr-2 px-1">
            {/* 기본 정보 */}
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="wildcard-name-input">
                  {t('wildcards:form.name')}
                </label>
                <Input
                  id="wildcard-name-input"
                  value={form.name}
                  onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder={t('wildcards:form.nameHelper')}
                />
              </div>

              <div className="space-y-1.5">
                <p className="text-sm font-medium">{t('wildcards:form.parent')}</p>
                <Select value={form.parentId} onValueChange={(value) => setForm((prev) => ({ ...prev, parentId: value }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">{t('wildcards:form.noParent')}</SelectItem>
                    {availableParents.map((node) => (
                      <SelectItem key={node.id} value={String(node.id)}>
                        {node.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="wildcard-description-input">
                  {t('wildcards:form.description')}
                </label>
                <Textarea
                  id="wildcard-description-input"
                  rows={2}
                  value={form.description}
                  onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
                />
              </div>
            </div>

            {/* 옵션 */}
            <div className="flex flex-wrap gap-x-6 gap-y-2 py-1">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.includeChildren}
                  onChange={(event) => setForm((prev) => ({ ...prev, includeChildren: event.target.checked }))}
                />
                {t('wildcards:form.includeChildren')}
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.onlyChildren}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      onlyChildren: event.target.checked,
                      includeChildren: event.target.checked ? true : prev.includeChildren,
                    }))
                  }
                />
                {t('wildcards:form.onlyChildren')}
              </label>
            </div>

            {mode === 'chain' ? (
              <div className="space-y-2">
                <p className="text-sm font-medium">{t('wildcards:form.chainOption')}</p>
                <Tabs
                  value={form.chainOption}
                  onValueChange={(value) => setForm((prev) => ({ ...prev, chainOption: value as WildcardChainOption }))}
                >
                  <TabsList>
                    <TabsTrigger value="replace">{t('wildcards:form.chainOptionReplace')}</TabsTrigger>
                    <TabsTrigger value="append">{t('wildcards:form.chainOptionAppend')}</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
            ) : null}

            <Separator />

            {/* 아이템 목록 (탭 방식) */}
            <div className="space-y-4">
              <Tabs value={editorToolTab} onValueChange={(v) => setEditorToolTab(v as WildcardTool)}>
                <div className="flex items-center justify-between mb-4">
                  <TabsList>
                    <TabsTrigger value="comfyui">ComfyUI</TabsTrigger>
                    <TabsTrigger value="nai">NovelAI</TabsTrigger>
                  </TabsList>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => patchItems(editorToolTab, (items) => [...items, makeFormItem()])}
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    {t('wildcards:actions.addItem')}
                  </Button>
                </div>

                <Alert className="mb-4 bg-muted/50 py-2">
                  <AlertDescription className="text-xs">{t('wildcards:form.itemsHelper')}</AlertDescription>
                </Alert>

                <TabsContent value="comfyui" className="space-y-3 mt-0">
                  {form.comfyuiItems.map((item, index) => (
                    <div key={item.key} className="flex gap-2 items-center">
                      <span className="text-xs text-muted-foreground min-w-[1.5rem]">{index + 1}.</span>
                      <Input
                        value={item.content}
                        onChange={(event) =>
                          patchItems('comfyui', (items) =>
                            items.map((entry, entryIndex) =>
                              entryIndex === index ? { ...entry, content: event.target.value } : entry
                            )
                          )
                        }
                        placeholder={t('wildcards:form.itemPlaceholder')}
                        className="flex-1"
                      />
                      <Input
                        type="number"
                        value={String(item.weight)}
                        onChange={(event) =>
                          patchItems('comfyui', (items) =>
                            items.map((entry, entryIndex) =>
                              entryIndex === index ? { ...entry, weight: Number(event.target.value) } : entry
                            )
                          )
                        }
                        className="w-20"
                        step={0.1}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => patchItems('comfyui', (items) => items.filter((entry) => entry.key !== item.key))}
                        disabled={form.comfyuiItems.length === 1}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </TabsContent>

                <TabsContent value="nai" className="space-y-3 mt-0">
                  {form.naiItems.map((item, index) => (
                    <div key={item.key} className="flex gap-2 items-center">
                      <span className="text-xs text-muted-foreground min-w-[1.5rem]">{index + 1}.</span>
                      <Input
                        value={item.content}
                        onChange={(event) =>
                          patchItems('nai', (items) =>
                            items.map((entry, entryIndex) =>
                              entryIndex === index ? { ...entry, content: event.target.value } : entry
                            )
                          )
                        }
                        placeholder={t('wildcards:form.itemPlaceholder')}
                        className="flex-1"
                      />
                      <Input
                        type="number"
                        value={String(item.weight)}
                        onChange={(event) =>
                          patchItems('nai', (items) =>
                            items.map((entry, entryIndex) =>
                              entryIndex === index ? { ...entry, weight: Number(event.target.value) } : entry
                            )
                          )
                        }
                        className="w-20"
                        step={0.1}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => patchItems('nai', (items) => items.filter((entry) => entry.key !== item.key))}
                        disabled={form.naiItems.length === 1}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </TabsContent>
              </Tabs>
            </div>

            {editorError ? (
              <Alert variant="destructive">
                <AlertDescription>{editorError}</AlertDescription>
              </Alert>
            ) : null}
          </div>


          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditorOpen(false)}>
              {t('common:cancel')}
            </Button>
            <Button type="button" onClick={() => void save()} disabled={saving}>
              {editingNode ? t('common:save') : t('common:create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('wildcards:preview.title')}</DialogTitle>
            <DialogDescription>{t('wildcards:preview.inputLabel')}</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <Tabs value={previewTool} onValueChange={(value) => setPreviewTool(value as WildcardTool)}>
              <TabsList>
                <TabsTrigger value="comfyui">ComfyUI</TabsTrigger>
                <TabsTrigger value="nai">NovelAI</TabsTrigger>
              </TabsList>
            </Tabs>

            <Textarea
              rows={3}
              value={previewText}
              onChange={(event) => setPreviewText(event.target.value)}
              placeholder={t('wildcards:preview.inputPlaceholder')}
            />

            <Button type="button" onClick={() => void runPreview()} disabled={previewLoading}>
              {previewLoading ? t('common:messages.processing') : t('wildcards:preview.generate')}
            </Button>

            {previewError ? (
              <Alert variant="destructive">
                <AlertDescription>{previewError}</AlertDescription>
              </Alert>
            ) : null}

            {previewResults.length > 0 ? (
              <div className="space-y-2 rounded-md border p-3">
                <p className="text-sm font-medium">{t('wildcards:preview.results')}</p>
                {previewResults.map((result, index) => (
                  <div key={`${result}-${index + 1}`} className="rounded border p-2 text-sm">
                    <p className="text-muted-foreground text-xs">{t('wildcards:preview.result', { number: index + 1 })}</p>
                    <p>{result}</p>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPreviewOpen(false)}>
              {t('common:close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={logDialogOpen} onOpenChange={setLogDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('wildcards:logDialog.title')}</DialogTitle>
          </DialogHeader>

          {lastScanLog ? (
            <div className="space-y-3 text-sm">
              <p>
                {t('wildcards:autoCollect.scanLog.timestamp')}: {new Date(lastScanLog.timestamp).toLocaleString()}
              </p>
              <p>
                {t('wildcards:autoCollect.scanLog.totalWildcards')}: {lastScanLog.totalWildcards}
              </p>
              <p>
                {t('wildcards:autoCollect.scanLog.totalItems')}: {lastScanLog.totalItems}
              </p>
              <ul className="list-inside list-disc">
                {lastScanLog.wildcards.map((item) => (
                  <li key={item.id}>
                    ++{item.name}++ ({item.folderName}) - {item.itemCount}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">{t('wildcards:autoCollect.noScanYet')}</p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setLogDialogOpen(false)}>
              {t('common:close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <WildcardDeleteConfirmDialog
        open={deleteOpen}
        wildcard={selectedNode}
        childCount={selectedNode?.children?.length ?? 0}
        onClose={() => setDeleteOpen(false)}
        onConfirm={(cascade) => {
          void deleteSelected(cascade)
        }}
      />
    </section>
  )
}
