import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Folder, FolderOpen, Pencil, Plus, Trash2 } from 'lucide-react'
import { HierarchyNav } from '@/components/common/hierarchy-nav'
import { HierarchyPicker } from '@/components/common/hierarchy-picker'
import { SectionHeading } from '@/components/common/section-heading'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { hasAuthPermission } from '@/features/auth/auth-permissions'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { SettingsField, SettingsModalBody, SettingsModalFooter } from '@/features/settings/components/settings-primitives'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import { SettingsSegmentedTable } from '@/features/settings/components/settings-resource-shared'
import { buildPromptPresetInsertionText, createPromptPreset, deletePromptPreset, getPromptPresets, updatePromptPreset, type PromptPresetMutationInput, type PromptPresetRecord } from '@/lib/api'
import { copyTextToClipboard } from '@/lib/clipboard'
import { useDesktopPageLayout } from '@/lib/use-desktop-page-layout'
import { cn } from '@/lib/utils'
import { getErrorMessage } from '@/features/image-generation/image-generation-shared'

type PromptPresetEditorState =
  | { mode: 'create'; defaultParentId: number | null }
  | { mode: 'edit'; preset: PromptPresetRecord }
  | null

type PromptPresetItemDraft = {
  id: string
  description: string
  value: string
}

type PromptPresetTreeEntry = {
  preset: PromptPresetRecord
  depth: number
  path: string[]
}

let promptPresetDraftSequence = 0

function createPromptPresetItemDraft(description = '', value = ''): PromptPresetItemDraft {
  promptPresetDraftSequence += 1
  return {
    id: `prompt-preset-item-${promptPresetDraftSequence}`,
    description,
    value,
  }
}

function flattenPromptPresetTree(records: PromptPresetRecord[], depth = 0, parentPath: string[] = []): PromptPresetTreeEntry[] {
  return records.flatMap((preset) => {
    const path = [...parentPath, preset.name]
    return [
      { preset, depth, path },
      ...flattenPromptPresetTree(preset.children ?? [], depth + 1, path),
    ]
  })
}

function normalizePromptPresetInput(name: string, description: string, parentId: number | null, drafts: PromptPresetItemDraft[]): PromptPresetMutationInput {
  return {
    name: name.trim(),
    description: description.trim(),
    parent_id: parentId,
    items: drafts
      .map((draft) => ({
        description: draft.description.trim(),
        value: draft.value.trim(),
      }))
      .filter((draft) => draft.description.length > 0 && draft.value.length > 0),
  }
}

function PromptPresetEditorModal({
  open,
  mode,
  presets,
  preset,
  defaultParentId,
  isSubmitting,
  onClose,
  onSubmit,
}: {
  open: boolean
  mode: 'create' | 'edit'
  presets: PromptPresetRecord[]
  preset?: PromptPresetRecord | null
  defaultParentId?: number | null
  isSubmitting?: boolean
  onClose: () => void
  onSubmit: (input: PromptPresetMutationInput) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [parentId, setParentId] = useState<number | null>(null)
  const [drafts, setDrafts] = useState<PromptPresetItemDraft[]>(() => [createPromptPresetItemDraft()])

  useEffect(() => {
    if (!open) {
      return
    }

    setName(preset?.name ?? '')
    setDescription(preset?.description ?? '')
    setParentId(preset?.parent_id ?? defaultParentId ?? null)
    const nextDrafts = (preset?.items ?? []).map((item) => createPromptPresetItemDraft(item.description, item.value))
    setDrafts(nextDrafts.length > 0 ? nextDrafts : [createPromptPresetItemDraft()])
  }, [defaultParentId, open, preset])

  const selectableParents = useMemo(
    () => flattenPromptPresetTree(presets)
      .map((entry) => entry.preset)
      .filter((entry) => entry.id !== preset?.id),
    [preset?.id, presets],
  )

  const handleAddDraft = () => {
    setDrafts((current) => [...current, createPromptPresetItemDraft()])
  }

  const handleChangeDraft = (draftId: string, field: 'description' | 'value', value: string) => {
    setDrafts((current) => current.map((draft) => (draft.id === draftId ? { ...draft, [field]: value } : draft)))
  }

  const handleRemoveDraft = (draftId: string) => {
    setDrafts((current) => {
      const nextDrafts = current.filter((draft) => draft.id !== draftId)
      return nextDrafts.length > 0 ? nextDrafts : [createPromptPresetItemDraft()]
    })
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    await onSubmit(normalizePromptPresetInput(name, description, parentId, drafts))
  }

  return (
    <SettingsModal open={open} title={mode === 'create' ? '프리셋 추가' : '프리셋 편집'} widthClassName="max-w-5xl" onClose={onClose}>
      <form onSubmit={(event) => void handleSubmit(event)}>
        <SettingsModalBody className="space-y-5">
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="space-y-4">
              <SettingsField label="이름">
                <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="프리셋 이름" required />
              </SettingsField>
              <SettingsField label="설명">
                <Textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} placeholder="선택 사항" />
              </SettingsField>
            </div>

            <SettingsField label="상위 프리셋">
              <HierarchyPicker
                items={selectableParents}
                selectedId={parentId}
                onSelectRoot={() => setParentId(null)}
                onSelect={(item) => setParentId(item.id)}
                getId={(item) => item.id}
                getParentId={(item) => item.parent_id}
                getLabel={(item) => <span className="truncate">{item.name}</span>}
                sortItems={(left, right) => left.name.localeCompare(right.name)}
                rootLabel="루트"
              />
            </SettingsField>
          </div>

          <SettingsSegmentedTable
            value="items"
            items={[{ value: 'items', label: '설명 / 값' }]}
            onChange={() => undefined}
            gridClassName="grid-cols-[3rem_minmax(9rem,0.55fr)_minmax(12rem,1fr)_3rem] gap-x-3"
            headers={['번호', '설명', '값', '삭제']}
            actions={(
              <Button type="button" size="icon-sm" variant="outline" onClick={handleAddDraft} aria-label="프리셋 값 추가" title="값 추가">
                <Plus className="h-4 w-4" />
              </Button>
            )}
            minWidthClassName="min-w-[720px]"
          >
            {drafts.map((draft, index) => (
              <div key={draft.id} className="grid grid-cols-[3rem_minmax(9rem,0.55fr)_minmax(12rem,1fr)_3rem] items-start gap-x-3 px-4 py-3 transition-colors hover:bg-surface-high/60">
                <div className="pt-2.5 text-center text-sm font-medium tabular-nums text-muted-foreground">{index + 1}</div>
                <Input variant="settings" className="self-start" value={draft.description} onChange={(event) => handleChangeDraft(draft.id, 'description', event.target.value)} placeholder="헤어스타일" />
                <Textarea className="self-start" value={draft.value} onChange={(event) => handleChangeDraft(draft.id, 'value', event.target.value)} rows={2} placeholder="++헤어++" />
                <div className="flex justify-center pt-0.5">
                  <Button type="button" size="icon-sm" variant="ghost" onClick={() => handleRemoveDraft(draft.id)} aria-label={`프리셋 값 ${index + 1} 삭제`} title="삭제">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </SettingsSegmentedTable>
        </SettingsModalBody>

        <SettingsModalFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>취소</Button>
          <Button type="submit" disabled={isSubmitting}>{isSubmitting ? '저장 중…' : '저장'}</Button>
        </SettingsModalFooter>
      </form>
    </SettingsModal>
  )
}

/** Render the prompt preset management workspace under Prompts > 프리셋. */
export function PromptPresetPanel() {
  const queryClient = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const authStatusQuery = useAuthStatusQuery()
  const isWideLayout = useDesktopPageLayout()
  const permissionKeys = authStatusQuery.data?.permissionKeys ?? []
  const canCreatePresets = hasAuthPermission(permissionKeys, 'prompts.create')
  const canUpdatePresets = hasAuthPermission(permissionKeys, 'prompts.update')
  const canDeletePresets = hasAuthPermission(permissionKeys, 'prompts.delete')
  const [selectedPresetId, setSelectedPresetId] = useState<number | null>(null)
  const [editorState, setEditorState] = useState<PromptPresetEditorState>(null)

  const presetsQuery = useQuery({
    queryKey: ['prompt-presets', 'hierarchical'],
    queryFn: () => getPromptPresets({ hierarchical: true, withItems: true }),
  })

  const entries = useMemo(() => flattenPromptPresetTree(presetsQuery.data ?? []), [presetsQuery.data])
  const selectedEntry = entries.find((entry) => entry.preset.id === selectedPresetId) ?? null
  const selectedPreset = selectedEntry?.preset ?? null
  const insertionPreview = selectedPreset ? buildPromptPresetInsertionText(selectedPreset) : ''

  const createMutation = useMutation({
    mutationFn: createPromptPreset,
    onSuccess: async (result) => {
      setEditorState(null)
      setSelectedPresetId(result.id)
      showSnackbar({ message: '프리셋을 만들었어.', tone: 'info' })
      await queryClient.invalidateQueries({ queryKey: ['prompt-presets'] })
    },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, '프리셋 생성에 실패했어.'), tone: 'error' }),
  })

  const updateMutation = useMutation({
    mutationFn: ({ presetId, input }: { presetId: number; input: PromptPresetMutationInput }) => updatePromptPreset(presetId, input),
    onSuccess: async (result) => {
      setEditorState(null)
      setSelectedPresetId(result.id)
      showSnackbar({ message: '프리셋을 저장했어.', tone: 'info' })
      await queryClient.invalidateQueries({ queryKey: ['prompt-presets'] })
    },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, '프리셋 저장에 실패했어.'), tone: 'error' }),
  })

  const deleteMutation = useMutation({
    mutationFn: ({ presetId, cascade }: { presetId: number; cascade: boolean }) => deletePromptPreset(presetId, { cascade }),
    onSuccess: async () => {
      setSelectedPresetId(null)
      showSnackbar({ message: '프리셋을 삭제했어.', tone: 'info' })
      await queryClient.invalidateQueries({ queryKey: ['prompt-presets'] })
    },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, '프리셋 삭제에 실패했어.'), tone: 'error' }),
  })

  const handleCopyInsertion = async () => {
    if (!insertionPreview) {
      return
    }

    try {
      await copyTextToClipboard(insertionPreview)
      showSnackbar({ message: '프리셋 삽입 텍스트를 복사했어.', tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, '복사에 실패했어.'), tone: 'error' })
    }
  }

  const handleDeleteSelected = async () => {
    if (!selectedPreset) {
      return
    }

    const hasChildren = entries.some((entry) => entry.preset.parent_id === selectedPreset.id)
    const confirmed = window.confirm(hasChildren
      ? `${selectedPreset.name} 프리셋과 하위 프리셋까지 삭제할까?`
      : `${selectedPreset.name} 프리셋을 삭제할까?`)
    if (!confirmed) {
      return
    }

    await deleteMutation.mutateAsync({ presetId: selectedPreset.id, cascade: hasChildren })
  }

  return (
    <div className={cn('grid gap-6', isWideLayout ? 'grid-cols-[280px_minmax(0,1fr)]' : 'grid-cols-1')}>
      <aside className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-foreground">프리셋</div>
          {canCreatePresets ? (
            <Button type="button" size="icon-sm" variant="outline" onClick={() => setEditorState({ mode: 'create', defaultParentId: selectedPresetId })} aria-label="프리셋 추가" title="프리셋 추가">
              <Plus className="h-4 w-4" />
            </Button>
          ) : null}
        </div>

        <div className="rounded-sm border border-border/80 bg-surface-lowest p-2">
          {presetsQuery.isLoading ? (
            <div className="px-3 py-4 text-sm text-muted-foreground">프리셋 불러오는 중…</div>
          ) : entries.length > 0 ? (
            <HierarchyNav
              items={entries.map((entry) => entry.preset)}
              expandable
              selectedId={selectedPresetId}
              onSelect={(preset) => setSelectedPresetId(preset.id)}
              getId={(preset) => preset.id}
              getParentId={(preset) => preset.parent_id}
              getLabel={(preset) => <span className="truncate">{preset.name}</span>}
              sortItems={(left, right) => left.name.localeCompare(right.name)}
              renderIcon={(_, state) => (state.hasChildren || state.isSelected ? <FolderOpen className="h-4 w-4 shrink-0" /> : <Folder className="h-4 w-4 shrink-0" />)}
            />
          ) : (
            <div className="px-3 py-4 text-sm text-muted-foreground">아직 프리셋이 없어.</div>
          )}
        </div>
      </aside>

      <section className="space-y-4 rounded-sm border border-border/80 bg-surface-lowest p-4">
        <SectionHeading
          variant="inside"
          className="border-b border-border/70 pb-4"
          heading={selectedPreset ? selectedPreset.name : '프리셋 선택'}
          actions={selectedPreset ? (
            <div className="flex items-center gap-2">
              {canUpdatePresets ? (
                <Button type="button" size="icon-sm" variant="outline" onClick={() => setEditorState({ mode: 'edit', preset: selectedPreset })} aria-label="프리셋 편집" title="편집">
                  <Pencil className="h-4 w-4" />
                </Button>
              ) : null}
              {canDeletePresets ? (
                <Button type="button" size="icon-sm" variant="outline" onClick={() => void handleDeleteSelected()} aria-label="프리셋 삭제" title="삭제">
                  <Trash2 className="h-4 w-4" />
                </Button>
              ) : null}
            </div>
          ) : undefined}
        />

        {selectedPreset ? (
          <div className="space-y-4">
            <div className="space-y-2 text-sm text-muted-foreground">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">값 {selectedPreset.items?.length ?? 0}개</Badge>
                <Badge variant="outline">{selectedEntry?.path.join(' / ') ?? selectedPreset.name}</Badge>
              </div>
              {selectedPreset.description ? <div>{selectedPreset.description}</div> : null}
            </div>

            <SettingsSegmentedTable
              value="items"
              items={[{ value: 'items', label: '설명 / 값' }]}
              onChange={() => undefined}
              gridClassName="grid-cols-[3rem_minmax(9rem,0.45fr)_minmax(12rem,1fr)] gap-x-3"
              headers={['번호', '설명', '값']}
              count={<Badge variant="outline">{selectedPreset.items?.length ?? 0}</Badge>}
              minWidthClassName="min-w-[620px]"
            >
              {(selectedPreset.items ?? []).map((item, index) => (
                <div key={item.id} className="grid grid-cols-[3rem_minmax(9rem,0.45fr)_minmax(12rem,1fr)] items-start gap-x-3 px-4 py-3 text-sm transition-colors hover:bg-surface-high/60">
                  <div className="text-center font-medium tabular-nums text-muted-foreground">{index + 1}</div>
                  <div className="break-words text-foreground">{item.description}</div>
                  <div className="whitespace-pre-wrap break-words text-foreground/92">{item.value}</div>
                </div>
              ))}
            </SettingsSegmentedTable>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium text-foreground">삽입 미리보기</div>
                <Button type="button" size="sm" variant="outline" onClick={() => void handleCopyInsertion()} disabled={!insertionPreview}>복사</Button>
              </div>
              <pre className="max-h-64 overflow-auto rounded-sm border border-border bg-surface-container px-3 py-3 text-xs leading-5 text-foreground/90 whitespace-pre-wrap">{insertionPreview || '삽입할 값이 없어.'}</pre>
            </div>
          </div>
        ) : (
          <div className="rounded-sm border border-dashed border-border bg-surface-container px-4 py-6 text-sm text-muted-foreground">프리셋을 선택하면 세부 정보를 보여줄게.</div>
        )}
      </section>

      <PromptPresetEditorModal
        open={editorState !== null}
        mode={editorState?.mode ?? 'create'}
        presets={presetsQuery.data ?? []}
        preset={editorState?.mode === 'edit' ? editorState.preset : null}
        defaultParentId={editorState?.mode === 'create' ? editorState.defaultParentId : null}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
        onClose={() => setEditorState(null)}
        onSubmit={async (input) => {
          if (!input.name) {
            showSnackbar({ message: '프리셋 이름을 넣어줘.', tone: 'error' })
            return
          }
          if (input.items.length === 0) {
            showSnackbar({ message: '설명/값 세트를 하나 이상 넣어줘.', tone: 'error' })
            return
          }

          if (editorState?.mode === 'edit') {
            await updateMutation.mutateAsync({ presetId: editorState.preset.id, input })
            return
          }

          await createMutation.mutateAsync(input)
        }}
      />
    </div>
  )
}
