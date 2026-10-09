import { Download, FileDown, FileJson, FileUp, Folder, FolderOpen, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { HierarchyPicker } from '@/components/common/hierarchy-picker'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { AnchoredPopup } from '@/components/ui/anchored-popup'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/ui/field'
import { EditorFooter } from '@/components/ui/editor-footer'
import { EditorGroup } from '@/components/ui/editor-group'
import { Modal, ModalBody } from '@/components/ui/modal'
import { SettingsSwitchRow } from '@/components/ui/settings-switch-row'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { SettingsSegmentedTable } from '@/features/settings/components/settings-resource-shared'
import { useI18n, type TranslationParams } from '@/i18n'
import type { WildcardRecord, WildcardTool } from '@/lib/api-wildcards'
import { useChatPageRegistration } from '@/features/codex-chat/chat-page-context'
import { useDirtyBaseline } from '@/features/codex-chat/use-dirty-baseline'
import { useChatDraftTransaction } from '@/features/codex-chat/use-chat-draft-transaction'
import { pageAction } from '@/features/codex-chat/page-action-helpers'
import { wildcardChatInput, wildcardChatSchema } from './use-wildcard-chat-page'

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
          <IconButton
            size="icon-sm"
            variant="ghost"
            onClick={() => fileInputRef.current?.click()}
            label={t(wildcardEditorKey('import.json.file'))}
          >
            <FileUp className="h-4 w-4" />
          </IconButton>

          <span ref={templateMenuAnchorRef} className="relative inline-flex">
            <IconButton
              size="icon-sm"
              variant="ghost"
              onClick={() => setTemplateMenuOpen((current) => !current)}
              label={t(wildcardEditorKey('download.json.template'))}
            >
              <Download className="h-4 w-4" />
            </IconButton>
          </span>

          <span ref={exportMenuAnchorRef} className="relative inline-flex">
            <IconButton
              size="icon-sm"
              variant="ghost"
              onClick={() => setExportMenuOpen((current) => !current)}
              disabled={exportDisabled}
              label={t(wildcardEditorKey('export.json'))}
            >
              <FileDown className="h-4 w-4" />
            </IconButton>
          </span>

          <IconButton
            size="icon-sm"
            variant="ghost"
            onClick={handleAddDraft}
            label={t(wildcardEditorKey('add.tool.item'), { tool: activeToolLabel })}
          >
            <Plus className="h-4 w-4" />
          </IconButton>

          <AnchoredPopup open={templateMenuOpen} anchorRef={templateMenuAnchorRef} onClose={() => setTemplateMenuOpen(false)} align="end" side="bottom" className="z-floating" closeOnBack>
            <WildcardJsonFormatMenu simpleLabel={t(wildcardEditorKey('simple.format'))} fullLabel={t(wildcardEditorKey('full.format'))} onSelect={handleDownloadTemplate} />
          </AnchoredPopup>

          <AnchoredPopup open={exportMenuOpen} anchorRef={exportMenuAnchorRef} onClose={() => setExportMenuOpen(false)} align="end" side="bottom" className="z-floating" closeOnBack>
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
          <NumberStepperInput
            variant="settings"
            min={0.1}
            step={0.1}

            className="h-10 px-3 text-center"
            value={draft.weight}
            onValueCommit={(value) => handleChangeDraft(draft.id, 'weight', value)}
            placeholder="1"
            inputMode="decimal"
            aria-label={t(wildcardEditorKey('tool.item.weight'), { tool: activeToolLabel, index: formatNumber(index + 1) })}
          />
          <div className="flex justify-center">
            <IconButton
              size="icon-sm"
              variant="ghost"
              onClick={() => handleRemoveDraft(draft.id)}
              label={t(wildcardEditorKey('delete.tool.item'), { tool: activeToolLabel, index: formatNumber(index + 1) })}
            >
              <Trash2 className="h-4 w-4" />
            </IconButton>
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
  const { showSnackbar } = useSnackbar()
  const notify = (message: string) => showSnackbar({ message, tone: 'info' })
  const formRef = useRef<HTMLFormElement | null>(null)

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
  const chatDraft = { name, description, parent_id: parentValue === 'root' ? null : Number(parentValue), include_children: Number(includeChildren), only_children: Number(onlyChildren), type: isChainTab ? 'chain' as const : 'wildcard' as const, chain_option: chainOption, items: exportItems }
  const applyChatDraft = useChatDraftTransaction(chatDraft, (next) => {
    setName(next.name); setDescription(next.description); setParentValue(String(next.parent_id ?? 'root')); setIncludeChildren(!!next.include_children); setOnlyChildren(!!next.only_children); setChainOption(next.chain_option)
    setItemDrafts(Object.fromEntries(wildcardTools.map((tool) => [tool, next.items[tool].map((item) => createWildcardItemDraft(item.content, item.weight))])) as Record<WildcardTool, WildcardItemDraft[]>)
  })
  const chatDirty = useDirtyBaseline(`${open}:${wildcard?.id ?? 'new'}`, chatDraft)
  useChatPageRegistration(open && !isSubmitting ? {
    kind: 'wildcards', title: t({ ko: '와일드카드 편집', en: 'Wildcard editor' }), priority: 100, resourceId: String(wildcard?.id ?? 'new-wildcard'), dirty: chatDirty, fields: [
      { id: 'name', label: t({ ko: '이름', en: 'Name' }), type: 'text', value: name }, { id: 'description', label: t({ ko: '설명', en: 'Description' }), type: 'text', value: description },
      { id: 'includeChildren', label: t({ ko: '하위 항목 포함', en: 'Include children' }), type: 'boolean', value: includeChildren }, { id: 'onlyChildren', label: t({ ko: '하위 항목만', en: 'Only children' }), type: 'boolean', value: onlyChildren },
      { id: 'chainOption', label: t({ ko: '체인 동작', en: 'Chain behavior' }), type: 'select', value: chainOption, options: ['replace', 'append'] },
    ],
    data: { selected: { ...chatDraft, parent_id: chatDraft.parent_id ?? 0, include_children: !!includeChildren, only_children: !!onlyChildren } },
    actions: [pageAction('wildcard.draft', t({ ko: '와일드카드 항목 입력', en: 'Fill wildcard items' }), t({ ko: '편집 초안의 전체 항목과 가중치를 입력해. 저장 버튼으로 저장할 수 있어.', en: 'Fill the complete draft item list and weights; use Save to persist it.' }), wildcardChatSchema(parentCandidates.map((item) => item.id)))],
    apply: (patch) => { if (patch.name !== undefined) setName(String(patch.name)); if (patch.description !== undefined) setDescription(String(patch.description)); if (patch.includeChildren !== undefined) setIncludeChildren(Boolean(patch.includeChildren)); if (patch.onlyChildren !== undefined) setOnlyChildren(Boolean(patch.onlyChildren)); if (patch.chainOption !== undefined) setChainOption(patch.chainOption as 'replace' | 'append') },
    applyAction: (_id, args, assertCurrent) => { assertCurrent(); const next = wildcardChatInput({ ...args, type: args.type ?? chatDraft.type }, wildcard); if (next.type !== chatDraft.type) throw new Error('다른 종류의 항목은 해당 탭에서 만들어줘.'); return applyChatDraft({ ...chatDraft, ...next, description: next.description ?? '', parent_id: next.parent_id ?? null, include_children: next.include_children ?? 0, only_children: next.only_children ?? 0, chain_option: next.chain_option ?? 'replace', type: chatDraft.type }) },
  } : null)

  const handleDownloadTemplate = (format: WildcardJsonFormat) => {
    const filename = format === 'simple'
      ? `wildcard-template-${activeItemTool}-simple.json`
      : 'wildcard-template-full.json'

    downloadJsonFile(filename, buildWildcardTemplatePayload(format, activeItemTool, t))
    setFormError(null)
    notify(
      format === 'simple'
        ? t(wildcardEditorKey('tool.simple.template.downloaded'), { tool: wildcardToolLabels[activeItemTool] })
        : t(wildcardEditorKey('full.template.downloaded')),
    )
  }

  const handleExportJson = (format: WildcardJsonFormat) => {
    if (!hasExportableItems) {
      setFormError(t(wildcardEditorKey('no.items.to.export')))
      return
    }

    const filenameBase = createSafeFilenamePart(name || wildcard?.name || 'wildcard-items', 'wildcard-items')
    if (format === 'simple') {
      const simpleItems = createSimpleJsonItems(exportItems[activeItemTool])
      if (simpleItems.length === 0) {
        setFormError(t(wildcardEditorKey('no.items.to.export.for.tool'), { tool: wildcardToolLabels[activeItemTool] }))
        return
      }

      downloadJsonFile(`${filenameBase}-${activeItemTool}.json`, simpleItems)
      setFormError(null)
      notify(t(wildcardEditorKey('tool.items.exported'), { tool: wildcardToolLabels[activeItemTool] }))
      return
    }

    downloadJsonFile(`${filenameBase}-full.json`, exportItems)
    setFormError(null)
    notify(t(wildcardEditorKey('all.tool.items.exported')))
  }

  const handleImportJsonFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.json') && file.type !== 'application/json') {
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
        setFormError(t(wildcardEditorKey('no.importable.items.found')))
        return
      }

      setItemDrafts((current) => appendImportedWildcardDrafts(current, importedItems))
      const firstImportedTool = wildcardTools.find((tool) => importedItems[tool].length > 0)
      if (firstImportedTool) {
        setActiveItemTool(firstImportedTool)
      }
      setFormError(null)
      notify(t(wildcardEditorKey('imported.items.save.to.apply'), { summary: importedCountSummary }))
    } catch (error) {
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

  const canSave = !isSubmitting && (mode === 'create' || chatDirty)

  return (
    <Modal
      sidePanelInset="var(--chat-dock-width, 0px)"
      open={open}
      onClose={onClose}
      title={mode === 'create'
        ? t(wildcardEditorKey('create.tab.item'), { tab: tabLabel })
        : t(wildcardEditorKey('edit.tab.item'), { tab: tabLabel })}
      size="wide"
      height="tall"
      dirty={chatDirty}
      onSave={canSave ? () => formRef.current?.requestSubmit() : undefined}
    >
      <form ref={formRef} onSubmit={(event) => void handleSubmit(event)}>
        {formError ? (
          <Alert variant="destructive">
            <AlertTitle>{t(wildcardEditorKey('input.review.needed'))}</AlertTitle>
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}

        <ModalBody className="space-y-5">
          <div className={isChainTab ? 'grid gap-4 md:grid-cols-2' : undefined}>
            <Field label={t(wildcardEditorKey('name'))}>
              <Input variant="settings" value={name} onChange={(event) => setName(event.target.value)} placeholder={t(wildcardEditorKey('e.g.character.pose'))} />
            </Field>

            {isChainTab ? (
              <Field label={t(wildcardEditorKey('chain.behavior'))}>
                <Select variant="settings" value={chainOption} onChange={(event) => setChainOption(event.target.value as 'replace' | 'append')}>
                  <option value="replace">{t({ ko: '대체', en: 'Replace' })}</option>
                  <option value="append">{t({ ko: '뒤에 추가', en: 'Append' })}</option>
                </Select>
              </Field>
            ) : null}
          </div>

          <Field label={t(wildcardEditorKey('description'))}>
            <Textarea variant="settings" value={description} onChange={(event) => setDescription(event.target.value)} rows={3} placeholder={t(wildcardEditorKey('optional'))} />
          </Field>

          <EditorGroup label={t(wildcardEditorKey('parent.item'))}>
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
            <div className="border-t border-line">
              <SettingsSwitchRow label={t(wildcardEditorKey('auto.include.children'))} checked={includeChildren} onCheckedChange={setIncludeChildren} />
              <SettingsSwitchRow label={t(wildcardEditorKey('children.only'))} checked={onlyChildren} onCheckedChange={setOnlyChildren} />
            </div>
          </EditorGroup>

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
        </ModalBody>

        <EditorFooter
          saveSubmit
          canSave={canSave}
          saving={isSubmitting}
          saveLabel={mode === 'create' ? t(wildcardEditorKey('create.item')) : t(wildcardEditorKey('save.changes'))}
        />
      </form>
    </Modal>
  )
}
