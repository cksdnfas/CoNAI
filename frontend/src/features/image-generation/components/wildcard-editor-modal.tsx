import { Folder, FolderOpen, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { HierarchyPicker } from '@/components/common/hierarchy-picker'
import { SegmentedTabBar } from '@/components/common/segmented-tab-bar'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrubbableNumberInput } from '@/components/ui/scrubbable-number-input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import { SettingsField, SettingsModalBody, SettingsModalFooter, SettingsToggleRow } from '@/features/settings/components/settings-primitives'
import type { WildcardRecord, WildcardTool } from '@/lib/api'

export interface WildcardEditorModalInput {
  name: string
  description?: string
  parent_id?: number | null
  include_children: number
  only_children: number
  chain_option: 'replace' | 'append'
  items: {
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

/** Render one compact row-based item editor like a simple spreadsheet. */
function WildcardItemDraftEditor({
  activeTool,
  drafts,
  onChangeDrafts,
  onChangeTool,
}: {
  activeTool: WildcardTool
  drafts: Record<WildcardTool, WildcardItemDraft[]>
  onChangeDrafts: (tool: WildcardTool, nextDrafts: WildcardItemDraft[]) => void
  onChangeTool: (tool: WildcardTool) => void
}) {
  const activeDrafts = drafts[activeTool]
  const activeToolLabel = activeTool === 'nai' ? 'NAI' : 'ComfyUI'

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

  return (
    <div className="space-y-3">
      <SegmentedTabBar
        value={activeTool}
        items={[
          { value: 'nai', label: 'NAI 항목' },
          { value: 'comfyui', label: 'ComfyUI 항목' },
        ]}
        onChange={(value) => onChangeTool(value as WildcardTool)}
        size="sm"
        actions={(
          <Button type="button" size="icon-sm" variant="outline" onClick={handleAddDraft} aria-label={`${activeToolLabel} 항목 추가`} title="항목 추가">
            <Plus className="h-4 w-4" />
          </Button>
        )}
      />

      <div className="overflow-hidden rounded-sm border border-border/70 bg-surface-low">
        <div className="grid grid-cols-[3rem_minmax(0,1fr)_5rem_3rem] gap-3 border-b border-border/70 bg-surface-lowest px-3 py-2 text-xs font-medium text-muted-foreground">
          <div className="text-center">번호</div>
          <div className="text-center">내용</div>
          <div className="text-center">가중치</div>
          <div className="text-center">삭제</div>
        </div>

        <div className="divide-y divide-border/70">
          {activeDrafts.map((draft, index) => (
            <div key={draft.id} className="grid grid-cols-[3rem_minmax(0,1fr)_5rem_3rem] items-center gap-3 px-3 py-2.5">
              <div className="text-center text-sm font-medium tabular-nums text-muted-foreground">{index + 1}</div>
              <Input
                value={draft.content}
                onChange={(event) => handleChangeDraft(draft.id, 'content', event.target.value)}
                placeholder="항목 내용"
              />
              <ScrubbableNumberInput
                min={0.1}
                step={0.1}
                scrubRatio={0.6}
                variant="detail"
                className="h-9 px-2 text-center"
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
        </div>
      </div>
    </div>
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
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [parentValue, setParentValue] = useState('root')
  const [includeChildren, setIncludeChildren] = useState(false)
  const [onlyChildren, setOnlyChildren] = useState(false)
  const [chainOption, setChainOption] = useState<'replace' | 'append'>('replace')
  const [activeItemTool, setActiveItemTool] = useState<WildcardTool>('nai')
  const [itemDrafts, setItemDrafts] = useState<Record<WildcardTool, WildcardItemDraft[]>>({
    nai: [createWildcardItemDraft()],
    comfyui: [createWildcardItemDraft()],
  })
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      return
    }

    const nextNaiDrafts = buildWildcardItemDrafts(wildcard, 'nai')
    const nextComfyuiDrafts = buildWildcardItemDrafts(wildcard, 'comfyui')

    setName(wildcard?.name ?? '')
    setDescription(wildcard?.description ?? '')
    setParentValue(String(wildcard?.parent_id ?? defaultParentId ?? 'root'))
    setIncludeChildren(wildcard?.include_children === 1)
    setOnlyChildren(wildcard?.only_children === 1)
    setChainOption(wildcard?.chain_option ?? 'replace')
    setItemDrafts({
      nai: nextNaiDrafts,
      comfyui: nextComfyuiDrafts,
    })
    setActiveItemTool(nextNaiDrafts.some((draft) => draft.content.trim().length > 0) ? 'nai' : 'comfyui')
    setFormError(null)
  }, [defaultParentId, open, wildcard])

  const parentCandidates = useMemo(
    () => wildcards.filter((item) => item.id !== wildcard?.id),
    [wildcard?.id, wildcards],
  )

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const trimmedName = name.trim()
    if (!trimmedName) {
      setFormError('이름은 꼭 필요해.')
      return
    }

    const naiItems = normalizeWildcardItemDrafts(itemDrafts.nai)
    const comfyuiItems = normalizeWildcardItemDrafts(itemDrafts.comfyui)
    if (naiItems.length === 0 && comfyuiItems.length === 0) {
      setFormError('NAI나 ComfyUI 항목 중 하나는 있어야 해.')
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
        ) : null}

        <SettingsModalBody className="space-y-5">
          <div className={isChainTab ? 'grid gap-4 md:grid-cols-2' : 'space-y-2'}>
            <SettingsField label="이름">
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="예: character_pose" />
            </SettingsField>

            {isChainTab ? (
              <SettingsField label="chain 동작">
                <Select value={chainOption} onChange={(event) => setChainOption(event.target.value as 'replace' | 'append')}>
                  <option value="replace">replace</option>
                  <option value="append">append</option>
                </Select>
              </SettingsField>
            ) : null}
          </div>

          <SettingsField label="설명">
            <Textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} placeholder="선택 사항" />
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
            onChangeTool={setActiveItemTool}
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
