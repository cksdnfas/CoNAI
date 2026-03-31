import { Folder, FolderOpen } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { HierarchyPicker } from '@/components/common/hierarchy-picker'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import type { WildcardRecord } from '@/lib/api'

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

/** Convert textarea lines into weighted wildcard items. */
function parseWildcardItemLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((content) => ({ content, weight: 1 }))
}

/** Join wildcard items back into the textarea editing format. */
function stringifyWildcardItems(items: Array<{ content: string }>) {
  return items.map((item) => item.content).join('\n')
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
  const [chainOption, setChainOption] = useState<'replace' | 'append'>(isChainTab ? 'replace' : 'replace')
  const [naiItemsText, setNaiItemsText] = useState('')
  const [comfyItemsText, setComfyItemsText] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      return
    }

    setName(wildcard?.name ?? '')
    setDescription(wildcard?.description ?? '')
    setParentValue(String(wildcard?.parent_id ?? defaultParentId ?? 'root'))
    setIncludeChildren(wildcard?.include_children === 1)
    setOnlyChildren(wildcard?.only_children === 1)
    setChainOption(wildcard?.chain_option ?? 'replace')
    setNaiItemsText(stringifyWildcardItems((wildcard?.items ?? []).filter((item) => item.tool === 'nai')))
    setComfyItemsText(stringifyWildcardItems((wildcard?.items ?? []).filter((item) => item.tool === 'comfyui')))
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

    const naiItems = parseWildcardItemLines(naiItemsText)
    const comfyuiItems = parseWildcardItemLines(comfyItemsText)
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
      <form className="space-y-5" onSubmit={(event) => void handleSubmit(event)}>
        {formError ? (
          <Alert variant="destructive">
            <AlertTitle>입력 확인이 필요해</AlertTitle>
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">이름</p>
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="예: character_pose" />
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">chain 동작</p>
            <Select value={chainOption} onChange={(event) => setChainOption(event.target.value as 'replace' | 'append')} disabled={!isChainTab}>
              <option value="replace">replace</option>
              <option value="append">append</option>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">설명</p>
          <Textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} placeholder="선택 사항" />
        </div>

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
          <label className="flex items-center justify-between rounded-sm border border-border/70 bg-surface-low/50 px-3 py-3 text-sm">
            <span className="font-medium text-foreground">하위 자동 포함</span>
            <input type="checkbox" checked={includeChildren} onChange={(event) => setIncludeChildren(event.target.checked)} />
          </label>
          <label className="flex items-center justify-between rounded-sm border border-border/70 bg-surface-low/50 px-3 py-3 text-sm">
            <span className="font-medium text-foreground">자식만 사용</span>
            <input type="checkbox" checked={onlyChildren} onChange={(event) => setOnlyChildren(event.target.checked)} />
          </label>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">NAI 항목</p>
            <Textarea
              value={naiItemsText}
              onChange={(event) => setNaiItemsText(event.target.value)}
              rows={10}
              placeholder="한 줄에 하나씩 입력"
            />
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">ComfyUI 항목</p>
            <Textarea
              value={comfyItemsText}
              onChange={(event) => setComfyItemsText(event.target.value)}
              rows={10}
              placeholder="한 줄에 하나씩 입력"
            />
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-border/70 pt-4">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
            취소
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? '저장 중…' : mode === 'create' ? '항목 만들기' : '변경 저장'}
          </Button>
        </div>
      </form>
    </SettingsModal>
  )
}
