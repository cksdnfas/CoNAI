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
import { useI18n } from '@/i18n'
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

function parseWildcardJsonItem(value: unknown, label: string): WildcardJsonItem {
  if (typeof value === 'string') {
    const content = value.trim()
    if (!content) {
      throw new Error(`${label} 항목 내용이 비어 있어.`)
    }

    return { content, weight: 1 }
  }

  if (!isRecord(value) || typeof value.content !== 'string') {
    throw new Error(`${label} 항목은 문자열이거나 { content, weight } 형태여야 해.`)
  }

  const content = value.content.trim()
  if (!content) {
    throw new Error(`${label} 항목 내용이 비어 있어.`)
  }

  const weight = Number(value.weight ?? 1)
  return {
    content,
    weight: Number.isFinite(weight) && weight > 0 ? weight : 1,
  }
}

function parseWildcardJsonItems(value: unknown, label: string) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} 항목 목록은 배열이어야 해.`)
  }

  return value.map((item, index) => parseWildcardJsonItem(item, `${label} ${index + 1}번`))
}

function parseWildcardJsonPayload(value: unknown, activeTool: WildcardTool): Record<WildcardTool, WildcardJsonItem[]> {
  const nextItems: Record<WildcardTool, WildcardJsonItem[]> = {
    general: [],
    nai: [],
    comfyui: [],
  }

  if (Array.isArray(value)) {
    nextItems[activeTool] = parseWildcardJsonItems(value, wildcardToolLabels[activeTool])
    return nextItems
  }

  const source = isRecord(value) && isRecord(value.items) ? value.items : value
  if (!isRecord(source)) {
    throw new Error('JSON은 배열이거나 { general, nai, comfyui } 객체여야 해.')
  }

  let hasSupportedTool = false
  for (const tool of wildcardTools) {
    if (source[tool] === undefined) {
      continue
    }
    hasSupportedTool = true
    nextItems[tool] = parseWildcardJsonItems(source[tool], wildcardToolLabels[tool])
  }

  if (!hasSupportedTool) {
    throw new Error('general, nai, comfyui 중 하나 이상의 항목 배열이 필요해.')
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

function summarizeWildcardItemCounts(items: Record<WildcardTool, WildcardJsonItem[]>, formatNumber: (value: number) => string) {
  return wildcardTools
    .map((tool) => ({ label: wildcardToolLabels[tool], count: items[tool].length }))
    .filter((item) => item.count > 0)
    .map((item) => `${item.label} ${formatNumber(item.count)}개`)
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

function buildWildcardTemplatePayload(format: WildcardJsonFormat, activeTool: WildcardTool) {
  if (format === 'simple') {
    return ['first item', { content: 'weighted item', weight: 1.2 }]
  }

  return {
    general: [{ content: 'general item', weight: 1 }],
    nai: [{ content: 'nai item', weight: 1 }],
    comfyui: [{ content: 'comfyui item', weight: 1 }],
    note: `간편 배열 양식은 현재 선택한 ${wildcardToolLabels[activeTool]} 탭으로 가져와져.`,
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
      headers={['번호', '내용', '가중치', '삭제']}
      actions={
        <div className="flex items-center gap-1.5">
          <input ref={fileInputRef} type="file" accept=".json,application/json" className="hidden" onChange={handleFileChange} />
          <Button type="button" size="icon-sm" variant="outline" onClick={() => fileInputRef.current?.click()} aria-label="JSON 파일 가져오기" title="JSON 파일 가져오기">
            <FileUp className="h-4 w-4" />
          </Button>

          <span ref={templateMenuAnchorRef} className="relative inline-flex">
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              onClick={() => setTemplateMenuOpen((current) => !current)}
              aria-label="JSON 양식 다운로드"
              title="JSON 양식 다운로드"
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
              aria-label="JSON 내보내기"
              title="JSON 내보내기"
            >
              <FileDown className="h-4 w-4" />
            </Button>
          </span>

          <Button type="button" size="icon-sm" variant="outline" onClick={handleAddDraft} aria-label={`${activeToolLabel} 항목 추가`} title="항목 추가">
            <Plus className="h-4 w-4" />
          </Button>

          <AnchoredPopup open={templateMenuOpen} anchorRef={templateMenuAnchorRef} onClose={() => setTemplateMenuOpen(false)} align="end" side="bottom" className="z-[7000]" closeOnBack>
            <WildcardJsonFormatMenu simpleLabel="간편 양식" fullLabel="일반 양식" onSelect={handleDownloadTemplate} />
          </AnchoredPopup>

          <AnchoredPopup open={exportMenuOpen} anchorRef={exportMenuAnchorRef} onClose={() => setExportMenuOpen(false)} align="end" side="bottom" className="z-[7000]" closeOnBack>
            <WildcardJsonFormatMenu simpleLabel={`${activeToolLabel} 내보내기`} fullLabel="전체 내보내기" onSelect={handleExportJson} />
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
            placeholder="항목 내용"
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
            aria-label={`${activeToolLabel} 항목 ${index + 1} 가중치`}
          />
          <div className="flex justify-center">
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              onClick={() => handleRemoveDraft(draft.id)}
              aria-label={`${activeToolLabel} 항목 ${index + 1} 삭제`}
              title="삭제"
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
  const { formatNumber } = useI18n()
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

    downloadJsonFile(filename, buildWildcardTemplatePayload(format, activeItemTool))
    setFormError(null)
    setFormNotice(format === 'simple' ? `${wildcardToolLabels[activeItemTool]} 간편 양식을 내려받았어.` : '일반 양식을 내려받았어.')
  }

  const handleExportJson = (format: WildcardJsonFormat) => {
    if (!hasExportableItems) {
      setFormNotice(null)
      setFormError('내보낼 항목이 없어.')
      return
    }

    const filenameBase = createSafeFilenamePart(name || wildcard?.name || 'wildcard-items', 'wildcard-items')
    if (format === 'simple') {
      const simpleItems = createSimpleJsonItems(exportItems[activeItemTool])
      if (simpleItems.length === 0) {
        setFormNotice(null)
        setFormError(`${wildcardToolLabels[activeItemTool]} 탭에 내보낼 항목이 없어.`)
        return
      }

      downloadJsonFile(`${filenameBase}-${activeItemTool}.json`, simpleItems)
      setFormError(null)
      setFormNotice(`${wildcardToolLabels[activeItemTool]} 항목을 내보냈어.`)
      return
    }

    downloadJsonFile(`${filenameBase}-full.json`, exportItems)
    setFormError(null)
    setFormNotice('전체 도구 항목을 내보냈어.')
  }

  const handleImportJsonFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.json') && file.type !== 'application/json') {
      setFormNotice(null)
      setFormError('JSON 파일만 가져올 수 있어.')
      return
    }

    try {
      const importedItems = parseWildcardJsonPayload(JSON.parse(await file.text()) as unknown, activeItemTool)
      const importedCountSummary = summarizeWildcardItemCounts(importedItems, formatNumber)
      if (!importedCountSummary) {
        setFormNotice(null)
        setFormError('가져올 수 있는 항목이 없어.')
        return
      }

      setItemDrafts((current) => appendImportedWildcardDrafts(current, importedItems))
      const firstImportedTool = wildcardTools.find((tool) => importedItems[tool].length > 0)
      if (firstImportedTool) {
        setActiveItemTool(firstImportedTool)
      }
      setFormError(null)
      setFormNotice(`${importedCountSummary}를 가져왔어. 저장을 눌러야 반영돼.`)
    } catch (error) {
      setFormNotice(null)
      setFormError(error instanceof Error ? error.message : 'JSON 파일을 읽지 못했어.')
    }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const trimmedName = name.trim()
    if (!trimmedName) {
      setFormError('이름은 꼭 필요해.')
      return
    }

    const generalItems = normalizeWildcardItemDrafts(itemDrafts.general)
    const naiItems = normalizeWildcardItemDrafts(itemDrafts.nai)
    const comfyuiItems = normalizeWildcardItemDrafts(itemDrafts.comfyui)
    if (generalItems.length === 0 && naiItems.length === 0 && comfyuiItems.length === 0) {
      setFormError('General, NAI, ComfyUI 항목 중 하나는 있어야 해.')
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
      title={mode === 'create' ? `${tabLabel} 항목 만들기` : `${tabLabel} 항목 편집`}
      widthClassName="max-w-4xl"
    >
      <form onSubmit={(event) => void handleSubmit(event)}>
        {formError ? (
          <Alert variant="destructive">
            <AlertTitle>입력 확인이 필요해</AlertTitle>
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : formNotice ? (
          <Alert>
            <AlertTitle>처리 완료</AlertTitle>
            <AlertDescription>{formNotice}</AlertDescription>
          </Alert>
        ) : null}

        <SettingsModalBody className="space-y-5">
          <div className={isChainTab ? 'grid gap-4 md:grid-cols-2' : 'space-y-2'}>
            <SettingsField label="이름">
              <Input variant="settings" value={name} onChange={(event) => setName(event.target.value)} placeholder="예: character_pose" />
            </SettingsField>

            {isChainTab ? (
              <SettingsField label="chain 동작">
                <Select variant="settings" value={chainOption} onChange={(event) => setChainOption(event.target.value as 'replace' | 'append')}>
                  <option value="replace">replace</option>
                  <option value="append">append</option>
                </Select>
              </SettingsField>
            ) : null}
          </div>

          <SettingsField label="설명">
            <Textarea variant="settings" value={description} onChange={(event) => setDescription(event.target.value)} rows={3} placeholder="선택 사항" />
          </SettingsField>

          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">부모 항목</p>
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
              rootLabel="루트"
            />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <SettingsToggleRow className="justify-between">
              <span className="font-medium text-foreground">하위 자동 포함</span>
              <input type="checkbox" checked={includeChildren} onChange={(event) => setIncludeChildren(event.target.checked)} />
            </SettingsToggleRow>
            <SettingsToggleRow className="justify-between">
              <span className="font-medium text-foreground">자식만 사용</span>
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
              취소
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? '저장 중…' : mode === 'create' ? '항목 만들기' : '변경 저장'}
            </Button>
          </SettingsModalFooter>
        </SettingsModalBody>
      </form>
    </SettingsModal>
  )
}
