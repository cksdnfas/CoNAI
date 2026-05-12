import { Download, FileDown, FileJson, FileUp, Folder, FolderOpen, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { HierarchyPicker } from '@/components/common/hierarchy-picker'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { AnchoredPopup } from '@/components/ui/anchored-popup'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrubbableNumberInput } from '@/components/ui/scrubbable-number-input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import { SettingsField, SettingsModalBody, SettingsModalFooter, SettingsToggleRow } from '@/features/settings/components/settings-primitives'
import { SettingsSegmentedTable } from '@/features/settings/components/settings-resource-shared'
import { useI18n, type TranslationParams } from '@/i18n'
import type { WildcardRecord, WildcardTool } from '@/lib/api-wildcards'

export interface WildcardEditorModalInput {
  name: string
  description?: string
  parent_id?: number | null
  include_children: number
  only_children: number
  chain_option: 'replace' | 'append'
  items: {
    general: Array<{ content: string; weight: number }>
    comfyui: Array<{ content: string; weight: number }>
    nai: Array<{ content: string; weight: number }>
  }
}

interface WildcardEditorModalProps {
  open: boolean
  mode: 'create' | 'edit'
  tabLabel: string
  isChainTab: boolean
  wildcards: WildcardRecord[]
  wildcard?: WildcardRecord | null
  defaultParentId?: number | null
  isSubmitting?: boolean
  onClose: () => void
  onSubmit: (input: WildcardEditorModalInput) => Promise<void>
}

type WildcardItemDraft = {
  id: string
  content: string
  weight: string
}

type WildcardJsonFormat = 'simple' | 'full'
type WildcardJsonItem = { content: string; weight: number }

const wildcardTools: WildcardTool[] = ['general', 'nai', 'comfyui']

const wildcardToolLabels: Record<WildcardTool, string> = {
  general: 'General',
  nai: 'NAI',
  comfyui: 'ComfyUI',
}

const wildcardEditorI18nPrefix = 'image-generation.components.wildcard.editor.modal'

function wildcardEditorKey(suffix: string) {
  return `${wildcardEditorI18nPrefix}.${suffix}`
}

type Translate = (input: string, params?: TranslationParams) => string

type WildcardJsonParseMessages = {
  emptyItemContent: (label: string) => string
  invalidItem: (label: string) => string
  invalidItemList: (label: string) => string
  invalidRoot: string
  missingToolArray: string
  itemIndexLabel: (label: string, index: number) => string
}

let wildcardItemDraftSequence = 0

/** Create one editable wildcard item row. */
function createWildcardItemDraft(content = '', weight = 1): WildcardItemDraft {
  wildcardItemDraftSequence += 1

  return {
    id: `wildcard-item-draft-${wildcardItemDraftSequence}`,
    content,
    weight: String(weight),
  }
}

/** Build item rows from one persisted wildcard record. */
function buildWildcardItemDrafts(wildcard: WildcardRecord | null | undefined, tool: WildcardTool) {
  const drafts = (wildcard?.items ?? [])
    .filter((item) => item.tool === tool)
    .map((item) => createWildcardItemDraft(item.content, item.weight))

  return drafts.length > 0 ? drafts : [createWildcardItemDraft()]
}

/** Convert editable rows into the backend mutation payload shape. */
function normalizeWildcardItemDrafts(drafts: WildcardItemDraft[]) {
  return drafts
    .map((draft) => ({
      content: draft.content.trim(),
      weight: Number(draft.weight),
    }))
    .filter((draft) => draft.content.length > 0)
    .map((draft) => ({
      content: draft.content,
      weight: Number.isFinite(draft.weight) && draft.weight > 0 ? draft.weight : 1,
    }))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseWildcardJsonItem(value: unknown, label: string, messages: WildcardJsonParseMessages): WildcardJsonItem {
  if (typeof value === 'string') {
    const content = value.trim()
    if (!content) {
      throw new Error(messages.emptyItemContent(label))
    }

    return { content, weight: 1 }
  }

  if (!isRecord(value) || typeof value.content !== 'string') {
    throw new Error(messages.invalidItem(label))
  }

  const content = value.content.trim()
  if (!content) {
    throw new Error(messages.emptyItemContent(label))
  }

  const weight = Number(value.weight ?? 1)
  return {
    content,
    weight: Number.isFinite(weight) && weight > 0 ? weight : 1,
  }
}

function parseWildcardJsonItems(value: unknown, label: string, messages: WildcardJsonParseMessages) {
  if (!Array.isArray(value)) {
    throw new Error(messages.invalidItemList(label))
  }

  return value.map((item, index) => parseWildcardJsonItem(item, messages.itemIndexLabel(label, index + 1), messages))
}

function parseWildcardJsonPayload(value: unknown, activeTool: WildcardTool, messages: WildcardJsonParseMessages): Record<WildcardTool, WildcardJsonItem[]> {
  const nextItems: Record<WildcardTool, WildcardJsonItem[]> = {
    general: [],
    nai: [],
    comfyui: [],
  }

  if (Array.isArray(value)) {
    nextItems[activeTool] = parseWildcardJsonItems(value, wildcardToolLabels[activeTool], messages)
    return nextItems
  }

  const source = isRecord(value) && isRecord(value.items) ? value.items : value
  if (!isRecord(source)) {
    throw new Error(messages.invalidRoot)
  }

  let hasSupportedTool = false
  for (const tool of wildcardTools) {
    if (source[tool] === undefined) {
      continue
    }
    hasSupportedTool = true
    nextItems[tool] = parseWildcardJsonItems(source[tool], wildcardToolLabels[tool], messages)
  }

  if (!hasSupportedTool) {
    throw new Error(messages.missingToolArray)
  }

  return nextItems
}

function appendImportedWildcardDrafts(
  currentDrafts: Record<WildcardTool, WildcardItemDraft[]>,
  importedItems: Record<WildcardTool, WildcardJsonItem[]>,
) {
  const nextDrafts = { ...currentDrafts }

  for (const tool of wildcardTools) {
    const importedDrafts = importedItems[tool].map((item) => createWildcardItemDraft(item.content, item.weight))
    if (importedDrafts.length === 0) {
      continue
    }

    const currentToolDrafts = currentDrafts[tool]
    const hasExistingContent = currentToolDrafts.some((draft) => draft.content.trim().length > 0)
    nextDrafts[tool] = hasExistingContent ? [...currentToolDrafts, ...importedDrafts] : importedDrafts
  }

  return nextDrafts
}

function summarizeWildcardItemCounts(
  items: Record<WildcardTool, WildcardJsonItem[]>,
  formatNumber: (value: number) => string,
  formatToolCount: (toolLabel: string, count: string) => string,
) {
  return wildcardTools
    .map((tool) => ({ label: wildcardToolLabels[tool], count: items[tool].length }))
    .filter((item) => item.count > 0)
    .map((item) => formatToolCount(item.label, formatNumber(item.count)))
    .join(', ')
}

function createSimpleJsonItems(items: WildcardJsonItem[]) {
  return items.map((item) => (item.weight === 1 ? item.content : { content: item.content, weight: item.weight }))
}

function downloadJsonFile(filename: string, payload: unknown) {
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function createSafeFilenamePart(value: string, fallback: string) {
  const safe = value.trim().replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '')
  return safe || fallback
}

function buildWildcardTemplatePayload(format: WildcardJsonFormat, activeTool: WildcardTool, t: Translate) {
  if (format === 'simple') {
    return ['first item', { content: 'weighted item', weight: 1.2 }]
  }

  return {
    general: [{ content: 'general item', weight: 1 }],
    nai: [{ content: 'nai item', weight: 1 }],
    comfyui: [{ content: 'comfyui item', weight: 1 }],
    note: t(wildcardEditorKey('simple.array.format.imports.to.current.tool.tab'), { tool: wildcardToolLabels[activeTool] }),
  }
}

function WildcardJsonFormatMenu({
  simpleLabel,
  fullLabel,
  onSelect,
}: {
  simpleLabel: string
  fullLabel: string
  onSelect: (format: WildcardJsonFormat) => void
}) {
  return (
    <div className="min-w-[156px] p-1.5" data-no-select-drag="true">
      <Button type="button" variant="ghost" size="sm" className="w-full justify-start" onClick={() => onSelect('simple')} data-no-select-drag="true">
        <FileJson className="h-4 w-4" />
        {simpleLabel}
      </Button>
      <Button type="button" variant="ghost" size="sm" className="w-full justify-start" onClick={() => onSelect('full')} data-no-select-drag="true">
        <FileJson className="h-4 w-4" />
        {fullLabel}
      </Button>
    </div>
  )
}

/** Render one compact row-based item editor with the shared settings-style segmented table shell. */
function WildcardItemDraftEditor({
  activeTool,
  drafts,
  exportDisabled = false,
  onChangeDrafts,
  onChangeTool,
  onDownloadTemplate,
  onExportJson,
  onImportJsonFile,
}: {
  activeTool: WildcardTool
  drafts: Record<WildcardTool, WildcardItemDraft[]>
  exportDisabled?: boolean
  onChangeDrafts: (tool: WildcardTool, nextDrafts: WildcardItemDraft[]) => void
  onChangeTool: (tool: WildcardTool) => void
  onDownloadTemplate: (format: WildcardJsonFormat) => void
  onExportJson: (format: WildcardJsonFormat) => void
  onImportJsonFile: (file: File) => Promise<void>
}) {
  const { t, formatNumber } = useI18n()
  const activeDrafts = drafts[activeTool]
  const activeToolLabel = wildcardToolLabels[activeTool]
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const templateMenuAnchorRef = useRef<HTMLSpanElement | null>(null)
  const exportMenuAnchorRef = useRef<HTMLSpanElement | null>(null)
  const [templateMenuOpen, setTemplateMenuOpen] = useState(false)
  const [exportMenuOpen, setExportMenuOpen] = useState(false)

  const handleAddDraft = () => {
    onChangeDrafts(activeTool, [...activeDrafts, createWildcardItemDraft()])
  }

  const handleChangeDraft = (draftId: string, field: 'content' | 'weight', value: string) => {
    onChangeDrafts(
      activeTool,
      activeDrafts.map((draft) => (
        draft.id === draftId
          ? {
              ...draft,
              [field]: value,
            }
          : draft
      )),
    )
  }

  const handleRemoveDraft = (draftId: string) => {
    const nextDrafts = activeDrafts.filter((draft) => draft.id !== draftId)
    onChangeDrafts(activeTool, nextDrafts.length > 0 ? nextDrafts : [createWildcardItemDraft()])
  }

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) {
      return
    }

    void onImportJsonFile(file)
  }

  const handleDownloadTemplate = (format: WildcardJsonFormat) => {
    onDownloadTemplate(format)
    setTemplateMenuOpen(false)
  }

  const handleExportJson = (format: WildcardJsonFormat) => {
    onExportJson(format)
    setExportMenuOpen(false)
  }

  return (
    <SettingsSegmentedTable
      value={activeTool}
      items={[
        { value: 'general', label: 'General' },
        { value: 'nai', label: 'NAI' },
        { value: 'comfyui', label: 'ComfyUI' },
      ]}
      onChange={(value) => onChangeTool(value as WildcardTool)}
      gridClassName="grid-cols-[3rem_minmax(0,1fr)_5.5rem_3rem] gap-x-3"
      headers={[
        t(wildcardEditorKey('no')),
        t(wildcardEditorKey('content')),
        t(wildcardEditorKey('weight')),
        t(wildcardEditorKey('delete')),
      ]}
      actions={
        <div className="flex items-center gap-1.5">
          <input ref={fileInputRef} type="file" accept=".json,application/json" className="hidden" onChange={handleFileChange} />
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            aria-label={t(wildcardEditorKey('import.json.file'))}
            title={t(wildcardEditorKey('import.json.file'))}
          >
            <FileUp className="h-4 w-4" />
          </Button>

          <span ref={templateMenuAnchorRef} className="relative inline-flex">
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              onClick={() => setTemplateMenuOpen((current) => !current)}
              aria-label={t(wildcardEditorKey('download.json.template'))}
              title={t(wildcardEditorKey('download.json.template'))}
            >
              <Download className="h-4 w-4" />
            </Button>
          </span>

          <span ref={exportMenuAnchorRef} className="relative inline-flex">
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              onClick={() => setExportMenuOpen((current) => !current)}
              disabled={exportDisabled}
              aria-label={t(wildcardEditorKey('export.json'))}
              title={t(wildcardEditorKey('export.json'))}
            >
              <FileDown className="h-4 w-4" />
            </Button>
          </span>

          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            onClick={handleAddDraft}
            aria-label={t(wildcardEditorKey('add.tool.item'), { tool: activeToolLabel })}
            title={t(wildcardEditorKey('add.item'))}
          >
            <Plus className="h-4 w-4" />
          </Button>

          <AnchoredPopup open={templateMenuOpen} anchorRef={templateMenuAnchorRef} onClose={() => setTemplateMenuOpen(false)} align="end" side="bottom" className="z-[7000]" closeOnBack>
            <WildcardJsonFormatMenu simpleLabel={t(wildcardEditorKey('simple.format'))} fullLabel={t(wildcardEditorKey('full.format'))} onSelect={handleDownloadTemplate} />
          </AnchoredPopup>

          <AnchoredPopup open={exportMenuOpen} anchorRef={exportMenuAnchorRef} onClose={() => setExportMenuOpen(false)} align="end" side="bottom" className="z-[7000]" closeOnBack>
            <WildcardJsonFormatMenu
              simpleLabel={t(wildcardEditorKey('export.tool'), { tool: activeToolLabel })}
              fullLabel={t(wildcardEditorKey('export.all'))}
              onSelect={handleExportJson}
            />
          </AnchoredPopup>
        </div>
      }
      minWidthClassName="min-w-[640px]"
    >
      {activeDrafts.map((draft, index) => (
        <div key={draft.id} className="grid grid-cols-[3rem_minmax(0,1fr)_5.5rem_3rem] items-center gap-x-3 px-4 py-3 transition-colors hover:bg-surface-high/60">
          <div className="text-center text-sm font-medium tabular-nums text-muted-foreground">{index + 1}</div>
          <Input
            variant="settings"
            value={draft.content}
            onChange={(event) => handleChangeDraft(draft.id, 'content', event.target.value)}
            placeholder={t(wildcardEditorKey('item.content'))}
          />
          <ScrubbableNumberInput
            variant="settings"
            min={0.1}
            step={0.1}
            scrubRatio={0.6}
            className="h-10 px-3 text-center"
            value={draft.weight}
            onChange={(value) => handleChangeDraft(draft.id, 'weight', value)}
            placeholder="1"
            inputMode="decimal"
            aria-label={t(wildcardEditorKey('tool.item.weight'), { tool: activeToolLabel, index: formatNumber(index + 1) })}
          />
          <div className="flex justify-center">
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              onClick={() => handleRemoveDraft(draft.id)}
              aria-label={t(wildcardEditorKey('delete.tool.item'), { tool: activeToolLabel, index: formatNumber(index + 1) })}
              title={t(wildcardEditorKey('delete'))}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ))}
    </SettingsSegmentedTable>
  )
}

export function WildcardEditorModal({
  open,
  mode,
  tabLabel,
  isChainTab,
  wildcards,
  wildcard,
  defaultParentId = null,
  isSubmitting = false,
  onClose,
  onSubmit,
}: WildcardEditorModalProps) {
  const { t, formatNumber } = useI18n()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [parentValue, setParentValue] = useState('root')
  const [includeChildren, setIncludeChildren] = useState(false)
  const [onlyChildren, setOnlyChildren] = useState(false)
  const [chainOption, setChainOption] = useState<'replace' | 'append'>('replace')
  const [activeItemTool, setActiveItemTool] = useState<WildcardTool>('general')
  const [itemDrafts, setItemDrafts] = useState<Record<WildcardTool, WildcardItemDraft[]>>({
    general: [createWildcardItemDraft()],
    nai: [createWildcardItemDraft()],
    comfyui: [createWildcardItemDraft()],
  })
  const [formError, setFormError] = useState<string | null>(null)
  const [formNotice, setFormNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      return
    }

    const nextGeneralDrafts = buildWildcardItemDrafts(wildcard, 'general')
    const nextNaiDrafts = buildWildcardItemDrafts(wildcard, 'nai')
    const nextComfyuiDrafts = buildWildcardItemDrafts(wildcard, 'comfyui')

    setName(wildcard?.name ?? '')
    setDescription(wildcard?.description ?? '')
    setParentValue(String(wildcard?.parent_id ?? defaultParentId ?? 'root'))
    setIncludeChildren(wildcard?.include_children === 1)
    setOnlyChildren(wildcard?.only_children === 1)
    setChainOption(wildcard?.chain_option ?? 'replace')
    setItemDrafts({
      general: nextGeneralDrafts,
      nai: nextNaiDrafts,
      comfyui: nextComfyuiDrafts,
    })
    setActiveItemTool(
      nextGeneralDrafts.some((draft) => draft.content.trim().length > 0)
        ? 'general'
        : nextNaiDrafts.some((draft) => draft.content.trim().length > 0)
          ? 'nai'
          : 'comfyui',
    )
    setFormError(null)
    setFormNotice(null)
  }, [defaultParentId, open, wildcard])

  const parentCandidates = useMemo(
    () => wildcards.filter((item) => item.id !== wildcard?.id),
    [wildcard?.id, wildcards],
  )

  const exportItems = useMemo<Record<WildcardTool, WildcardJsonItem[]>>(() => ({
    general: normalizeWildcardItemDrafts(itemDrafts.general),
    nai: normalizeWildcardItemDrafts(itemDrafts.nai),
    comfyui: normalizeWildcardItemDrafts(itemDrafts.comfyui),
  }), [itemDrafts])

  const hasExportableItems = wildcardTools.some((tool) => exportItems[tool].length > 0)

  const handleDownloadTemplate = (format: WildcardJsonFormat) => {
    const filename = format === 'simple'
      ? `wildcard-template-${activeItemTool}-simple.json`
      : 'wildcard-template-full.json'

    downloadJsonFile(filename, buildWildcardTemplatePayload(format, activeItemTool, t))
    setFormError(null)
    setFormNotice(
      format === 'simple'
        ? t(wildcardEditorKey('tool.simple.template.downloaded'), { tool: wildcardToolLabels[activeItemTool] })
        : t(wildcardEditorKey('full.template.downloaded')),
    )
  }

  const handleExportJson = (format: WildcardJsonFormat) => {
    if (!hasExportableItems) {
      setFormNotice(null)
      setFormError(t(wildcardEditorKey('no.items.to.export')))
      return
    }

    const filenameBase = createSafeFilenamePart(name || wildcard?.name || 'wildcard-items', 'wildcard-items')
    if (format === 'simple') {
      const simpleItems = createSimpleJsonItems(exportItems[activeItemTool])
      if (simpleItems.length === 0) {
        setFormNotice(null)
        setFormError(t(wildcardEditorKey('no.items.to.export.for.tool'), { tool: wildcardToolLabels[activeItemTool] }))
        return
      }

      downloadJsonFile(`${filenameBase}-${activeItemTool}.json`, simpleItems)
      setFormError(null)
      setFormNotice(t(wildcardEditorKey('tool.items.exported'), { tool: wildcardToolLabels[activeItemTool] }))
      return
    }

    downloadJsonFile(`${filenameBase}-full.json`, exportItems)
    setFormError(null)
    setFormNotice(t(wildcardEditorKey('all.tool.items.exported')))
  }

  const handleImportJsonFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.json') && file.type !== 'application/json') {
      setFormNotice(null)
      setFormError(t(wildcardEditorKey('only.json.files.can.be.imported')))
      return
    }

    try {
      const parseMessages: WildcardJsonParseMessages = {
        emptyItemContent: (label) => t(wildcardEditorKey('item.content.is.empty'), { label }),
        invalidItem: (label) => t(wildcardEditorKey('item.must.be.a.string.or.content.weight.object'), { label }),
        invalidItemList: (label) => t(wildcardEditorKey('item.list.must.be.an.array'), { label }),
        invalidRoot: t(wildcardEditorKey('json.must.be.an.array.or.a')),
        missingToolArray: t(wildcardEditorKey('at.least.one.item.array.under.general')),
        itemIndexLabel: (label, index) => t(wildcardEditorKey('item.index.label'), { label, index: formatNumber(index) }),
      }
      const importedItems = parseWildcardJsonPayload(JSON.parse(await file.text()) as unknown, activeItemTool, parseMessages)
      const importedCountSummary = summarizeWildcardItemCounts(
        importedItems,
        formatNumber,
        (tool, count) => t(wildcardEditorKey('tool.count.items'), { tool, count }),
      )
      if (!importedCountSummary) {
        setFormNotice(null)
        setFormError(t(wildcardEditorKey('no.importable.items.found')))
        return
      }

      setItemDrafts((current) => appendImportedWildcardDrafts(current, importedItems))
      const firstImportedTool = wildcardTools.find((tool) => importedItems[tool].length > 0)
      if (firstImportedTool) {
        setActiveItemTool(firstImportedTool)
      }
      setFormError(null)
      setFormNotice(t(wildcardEditorKey('imported.items.save.to.apply'), { summary: importedCountSummary }))
    } catch (error) {
      setFormNotice(null)
      setFormError(error instanceof Error ? error.message : t(wildcardEditorKey('could.not.read.the.json.file')))
    }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const trimmedName = name.trim()
    if (!trimmedName) {
      setFormError(t(wildcardEditorKey('name.is.required')))
      return
    }

    const generalItems = normalizeWildcardItemDrafts(itemDrafts.general)
    const naiItems = normalizeWildcardItemDrafts(itemDrafts.nai)
    const comfyuiItems = normalizeWildcardItemDrafts(itemDrafts.comfyui)
    if (generalItems.length === 0 && naiItems.length === 0 && comfyuiItems.length === 0) {
      setFormError(t(wildcardEditorKey('at.least.one.general.nai.or.comfyui')))
      return
    }

    setFormError(null)
    await onSubmit({
      name: trimmedName,
      description: description.trim() || undefined,
      parent_id: parentValue === 'root' ? null : Number(parentValue),
      include_children: includeChildren ? 1 : 0,
      only_children: onlyChildren ? 1 : 0,
      chain_option: chainOption,
      items: {
        general: generalItems,
        comfyui: comfyuiItems,
        nai: naiItems,
      },
    })
  }

  return (
    <SettingsModal
      open={open}
      onClose={onClose}
      title={mode === 'create'
        ? t(wildcardEditorKey('create.tab.item'), { tab: tabLabel })
        : t(wildcardEditorKey('edit.tab.item'), { tab: tabLabel })}
      widthClassName="max-w-4xl"
    >
      <form onSubmit={(event) => void handleSubmit(event)}>
        {formError ? (
          <Alert variant="destructive">
            <AlertTitle>{t(wildcardEditorKey('input.review.needed'))}</AlertTitle>
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : formNotice ? (
          <Alert>
            <AlertTitle>{t(wildcardEditorKey('done'))}</AlertTitle>
            <AlertDescription>{formNotice}</AlertDescription>
          </Alert>
        ) : null}

        <SettingsModalBody className="space-y-5">
          <div className={isChainTab ? 'grid gap-4 md:grid-cols-2' : 'space-y-2'}>
            <SettingsField label={t(wildcardEditorKey('name'))}>
              <Input variant="settings" value={name} onChange={(event) => setName(event.target.value)} placeholder={t(wildcardEditorKey('e.g.character.pose'))} />
            </SettingsField>

            {isChainTab ? (
              <SettingsField label={t(wildcardEditorKey('chain.behavior'))}>
                <Select variant="settings" value={chainOption} onChange={(event) => setChainOption(event.target.value as 'replace' | 'append')}>
                  <option value="replace">replace</option>
                  <option value="append">append</option>
                </Select>
              </SettingsField>
            ) : null}
          </div>

          <SettingsField label={t(wildcardEditorKey('description'))}>
            <Textarea variant="settings" value={description} onChange={(event) => setDescription(event.target.value)} rows={3} placeholder={t(wildcardEditorKey('optional'))} />
          </SettingsField>

          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">{t(wildcardEditorKey('parent.item'))}</p>
            <HierarchyPicker
              items={parentCandidates}
              selectedId={parentValue === 'root' ? null : Number(parentValue)}
              onSelectRoot={() => setParentValue('root')}
              onSelect={(candidate) => setParentValue(String(candidate.id))}
              getId={(candidate) => candidate.id}
              getParentId={(candidate) => candidate.parent_id}
              getLabel={(candidate) => candidate.name}
              sortItems={(left, right) => left.name.localeCompare(right.name)}
              renderIcon={(_, state) => (state.hasChildren ? <FolderOpen className="h-4 w-4 shrink-0" /> : <Folder className="h-4 w-4 shrink-0" />)}
              rootLabel={t(wildcardEditorKey('root'))}
            />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <SettingsToggleRow className="justify-between">
              <span className="font-medium text-foreground">{t(wildcardEditorKey('auto.include.children'))}</span>
              <input type="checkbox" checked={includeChildren} onChange={(event) => setIncludeChildren(event.target.checked)} />
            </SettingsToggleRow>
            <SettingsToggleRow className="justify-between">
              <span className="font-medium text-foreground">{t(wildcardEditorKey('children.only'))}</span>
              <input type="checkbox" checked={onlyChildren} onChange={(event) => setOnlyChildren(event.target.checked)} />
            </SettingsToggleRow>
          </div>

          <WildcardItemDraftEditor
            activeTool={activeItemTool}
            drafts={itemDrafts}
            exportDisabled={!hasExportableItems}
            onChangeTool={setActiveItemTool}
            onDownloadTemplate={handleDownloadTemplate}
            onExportJson={handleExportJson}
            onImportJsonFile={handleImportJsonFile}
            onChangeDrafts={(tool, nextDrafts) => {
              setItemDrafts((current) => ({
                ...current,
                [tool]: nextDrafts,
              }))
            }}
          />

          <SettingsModalFooter>
            <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
              {t(wildcardEditorKey('cancel'))}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting
                ? t(wildcardEditorKey('saving'))
                : mode === 'create'
                  ? t(wildcardEditorKey('create.item'))
                  : t(wildcardEditorKey('save.changes'))}
            </Button>
          </SettingsModalFooter>
        </SettingsModalBody>
      </form>
    </SettingsModal>
  )
}
