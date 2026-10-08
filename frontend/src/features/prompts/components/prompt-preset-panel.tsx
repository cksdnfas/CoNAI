import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { usePresetChatPage, presetChatInput, presetChatSchema } from '../use-preset-chat-page'
import { useChatPageRegistration } from '@/features/codex-chat/chat-page-context'
import { pageAction } from '@/features/codex-chat/page-action-helpers'
import { useChatDraftTransaction } from '@/features/codex-chat/use-chat-draft-transaction'
import { CodexChatHeaderButton } from '@/features/codex-chat/codex-chat-shell'
import { Copy, Pencil, Plus, Trash2 } from 'lucide-react'
import { HierarchyPicker } from '@/components/common/hierarchy-picker'
import { PageWithSidebar } from '@/components/common/page-with-sidebar'
import { EmptyState } from '@/components/ui/empty-state'
import { ListRow } from '@/components/ui/list-row'
import { RowGroup } from '@/components/ui/row-group'
import { SidebarGroupLabel, SidebarNav } from '@/components/ui/sidebar'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { hasAuthPermission } from '@/features/auth/auth-permissions'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { Field } from '@/components/ui/field'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { useI18n } from '@/i18n'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { buildPromptPresetInsertionText, createPromptPreset, deletePromptPreset, getPromptPresets, updatePromptPreset, type PromptPresetMutationInput, type PromptPresetRecord } from '@/lib/api-prompt-presets'
import { copyTextToClipboard } from '@/lib/clipboard'
import { SettingsSegmentedTable } from '@/features/settings/components/settings-resource-shared'
import { getErrorMessage } from '@/features/image-generation/image-generation-shared'
import { PromptPageToolbar, type PromptPageToolbarBaseProps } from './prompt-page-toolbar'
import { SidebarTree } from './sidebar-tree'

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
  const { t } = useI18n()
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

  const chatDraft = { name, description, parent_id: parentId, items: drafts.map((item) => ({ description: item.description, value: item.value })) }
  const applyChatDraft = useChatDraftTransaction(chatDraft, (next) => { setName(next.name); setDescription(next.description); setParentId(next.parent_id); setDrafts(next.items.map((item) => createPromptPresetItemDraft(item.description, item.value))) })
  useChatPageRegistration(open && !isSubmitting ? {
    kind: 'presets', title: t({ ko: '프리셋 편집', en: 'Preset editor' }), priority: 100, resourceId: String(preset?.id ?? 'new-preset'), fields: [
      { id: 'name', label: t({ ko: '이름', en: 'Name' }), type: 'text', value: name },
      { id: 'description', label: t({ ko: '설명', en: 'Description' }), type: 'text', value: description },
    ],
    data: { selected: { ...chatDraft, parent_id: parentId ?? 0 } },
    actions: [pageAction('preset.draft', t({ ko: '프리셋 항목 입력', en: 'Fill preset items' }), t({ ko: '프리셋 이름·설명·상위 항목·프롬프트 목록을 편집 초안에 입력해.', en: 'Fill the preset name, description, parent and prompt items in the draft.' }), presetChatSchema(selectableParents.map((item) => item.id)))],
    apply: (patch) => { if (patch.name !== undefined) setName(String(patch.name)); if (patch.description !== undefined) setDescription(String(patch.description)) },
    applyAction: (_id, args, assertCurrent) => { assertCurrent(); const next = presetChatInput(args); return applyChatDraft({ name: next.name, description: next.description ?? '', parent_id: next.parent_id ?? null, items: next.items }) },
  } : null)

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
    <Modal open={open} sidePanelInset="var(--chat-dock-width, 0px)" headerContent={<CodexChatHeaderButton />} title={mode === 'create' ? t('prompts.components.prompt.preset.panel.add.preset') : t('prompts.components.prompt.preset.panel.edit.preset')} widthClassName="max-w-5xl" onClose={onClose}>
      <form onSubmit={(event) => void handleSubmit(event)}>
        <ModalBody className="space-y-5">
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="space-y-4">
              <Field label={t('prompts.components.prompt.preset.panel.name')}>
                <Input value={name} onChange={(event) => setName(event.target.value)} placeholder={t('prompts.components.prompt.preset.panel.preset.name')} required />
              </Field>
              <Field label={t('prompts.components.prompt.preset.panel.description')}>
                <Textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} placeholder={t('prompts.components.prompt.preset.panel.optional')} />
              </Field>
            </div>

            <Field label={t('prompts.components.prompt.preset.panel.parent.preset')}>
              <HierarchyPicker
                items={selectableParents}
                selectedId={parentId}
                onSelectRoot={() => setParentId(null)}
                onSelect={(item) => setParentId(item.id)}
                getId={(item) => item.id}
                getParentId={(item) => item.parent_id}
                getLabel={(item) => <span className="truncate">{item.name}</span>}
                sortItems={(left, right) => left.name.localeCompare(right.name)}
                rootLabel={t('prompts.components.prompt.preset.panel.root')}
              />
            </Field>
          </div>

          <SettingsSegmentedTable
            value="items"
            items={[{ value: 'items', label: t('prompts.components.prompt.preset.panel.description.value') }]}
            onChange={() => undefined}
            gridClassName="grid-cols-[3rem_minmax(9rem,0.55fr)_minmax(12rem,1fr)_3rem] gap-x-3"
            headers={[
              t('prompts.components.prompt.preset.panel.number'),
              t('prompts.components.prompt.preset.panel.description'),
              t('prompts.components.prompt.preset.panel.value'),
              t('prompts.components.prompt.preset.panel.delete'),
            ]}
            actions={(
              <IconButton size="icon-sm" variant="secondary" onClick={handleAddDraft} label={t('prompts.components.prompt.preset.panel.add.preset.value')}>
                <Plus className="h-4 w-4" />
              </IconButton>
            )}
            minWidthClassName="min-w-[720px]"
          >
            {drafts.map((draft, index) => (
              <div key={draft.id} className="grid grid-cols-[3rem_minmax(9rem,0.55fr)_minmax(12rem,1fr)_3rem] items-start gap-x-3 px-4 py-3 transition-colors hover:bg-surface-high/60">
                <div className="pt-2.5 text-center text-sm font-medium tabular-nums text-muted-foreground">{index + 1}</div>
                <Input variant="settings" className="self-start" value={draft.description} onChange={(event) => handleChangeDraft(draft.id, 'description', event.target.value)} placeholder={t('prompts.components.prompt.preset.panel.hair.style')} />
                <Textarea className="self-start" value={draft.value} onChange={(event) => handleChangeDraft(draft.id, 'value', event.target.value)} rows={2} placeholder={t('prompts.components.prompt.preset.panel.hair.token.example')} />
                <div className="flex justify-center pt-0.5">
                  <IconButton size="icon-sm" variant="ghost" onClick={() => handleRemoveDraft(draft.id)} label={t('prompts.components.prompt.preset.panel.delete.preset.value.index', { index: index + 1 })}>
                    <Trash2 className="h-4 w-4" />
                  </IconButton>
                </div>
              </div>
            ))}
          </SettingsSegmentedTable>
        </ModalBody>

        <ModalFooter>
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>{t('prompts.components.prompt.preset.panel.cancel')}</Button>
          <Button type="submit" disabled={isSubmitting}>{isSubmitting ? t('prompts.components.prompt.preset.panel.saving') : t('prompts.components.prompt.preset.panel.save')}</Button>
        </ModalFooter>
      </form>
    </Modal>
  )
}

/** Render the prompt preset management workspace under Prompts > Presets. */
export function PromptPresetPanel({ toolbarProps }: { toolbarProps: PromptPageToolbarBaseProps }) {
  const queryClient = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const { t } = useI18n()
  const confirm = useConfirm()
  const authStatusQuery = useAuthStatusQuery()
  const permissionKeys = authStatusQuery.data?.permissionKeys ?? []
  const canCreatePresets = hasAuthPermission(permissionKeys, 'prompts.edit')
  const canUpdatePresets = hasAuthPermission(permissionKeys, 'prompts.edit')
  const canDeletePresets = hasAuthPermission(permissionKeys, 'prompts.edit')
  const [selectedPresetId, setSelectedPresetId] = useState<number | null>(null)
  const [editorState, setEditorState] = useState<PromptPresetEditorState>(null)

  const presetsQuery = useQuery({
    queryKey: ['prompt-presets', 'hierarchical'],
    queryFn: () => getPromptPresets({ hierarchical: true, withItems: true }),
  })

  const entries = useMemo(() => flattenPromptPresetTree(presetsQuery.data ?? []), [presetsQuery.data])
  const selectedPreset = entries.find((entry) => entry.preset.id === selectedPresetId)?.preset ?? null
  usePresetChatPage(entries.map((entry) => entry.preset), selectedPreset, setSelectedPresetId, editorState === null)
  const insertionPreview = selectedPreset ? buildPromptPresetInsertionText(selectedPreset) : ''

  const createMutation = useMutation({
    mutationFn: createPromptPreset,
    onSuccess: async (result) => {
      setEditorState(null)
      setSelectedPresetId(result.id)
      showSnackbar({ message: t('prompts.components.prompt.preset.panel.created.preset'), tone: 'info' })
      await queryClient.invalidateQueries({ queryKey: ['prompt-presets'] })
    },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t('prompts.components.prompt.preset.panel.failed.to.create.preset')), tone: 'error' }),
  })

  const updateMutation = useMutation({
    mutationFn: ({ presetId, input }: { presetId: number; input: PromptPresetMutationInput }) => updatePromptPreset(presetId, input),
    onSuccess: async (result) => {
      setEditorState(null)
      setSelectedPresetId(result.id)
      showSnackbar({ message: t('prompts.components.prompt.preset.panel.saved.preset'), tone: 'info' })
      await queryClient.invalidateQueries({ queryKey: ['prompt-presets'] })
    },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t('prompts.components.prompt.preset.panel.failed.to.save.preset')), tone: 'error' }),
  })

  const deleteMutation = useMutation({
    mutationFn: ({ presetId, cascade }: { presetId: number; cascade: boolean }) => deletePromptPreset(presetId, { cascade }),
    onSuccess: async () => {
      setSelectedPresetId(null)
      showSnackbar({ message: t('prompts.components.prompt.preset.panel.deleted.preset'), tone: 'info' })
      await queryClient.invalidateQueries({ queryKey: ['prompt-presets'] })
    },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t('prompts.components.prompt.preset.panel.failed.to.delete.preset')), tone: 'error' }),
  })

  const handleCopyInsertion = async () => {
    if (!insertionPreview) {
      return
    }

    try {
      await copyTextToClipboard(insertionPreview)
      showSnackbar({ message: t('prompts.components.prompt.preset.panel.copied.preset.insertion.text'), tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t('prompts.components.prompt.preset.panel.copy.failed')), tone: 'error' })
    }
  }

  const handleDeleteSelected = async () => {
    if (!selectedPreset) {
      return
    }

    const hasChildren = entries.some((entry) => entry.preset.parent_id === selectedPreset.id)
    const confirmed = await confirm({
      title: t({ ko: '프리셋 삭제', en: 'Delete preset' }),
      description: hasChildren
        ? t('prompts.components.prompt.preset.panel.confirm.delete.with.children', { name: selectedPreset.name })
        : t('prompts.components.prompt.preset.panel.confirm.delete', { name: selectedPreset.name }),
      confirmLabel: t({ ko: '삭제', en: 'Delete' }),
      tone: 'destructive',
    })
    if (!confirmed) {
      return
    }

    await deleteMutation.mutateAsync({ presetId: selectedPreset.id, cascade: hasChildren })
  }

  const sidebar = (
    <SidebarNav>
      <SidebarGroupLabel
        actions={canCreatePresets ? (
          <IconButton size="icon-xs" variant="ghost" onClick={() => setEditorState({ mode: 'create', defaultParentId: selectedPresetId })} label={t('prompts.components.prompt.preset.panel.add.preset')}>
            <Plus />
          </IconButton>
        ) : undefined}
      >
        {t('prompts.components.prompt.preset.panel.presets')}
      </SidebarGroupLabel>
      {presetsQuery.isLoading ? Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="my-0.5 h-8 w-full rounded-sm" />) : null}
      {!presetsQuery.isLoading && entries.length > 0 ? (
        <SidebarTree
          items={entries.map((entry) => entry.preset)}
          selectedId={selectedPresetId}
          onSelect={(preset) => setSelectedPresetId(preset.id)}
          getId={(preset) => preset.id}
          getParentId={(preset) => preset.parent_id}
          getLabel={(preset) => preset.name}
          sortItems={(left, right) => left.name.localeCompare(right.name)}
        />
      ) : null}
      {!presetsQuery.isLoading && entries.length === 0 ? (
        <p className="px-2.5 py-2 text-sm text-muted-foreground">{t('prompts.components.prompt.preset.panel.no.presets.yet')}</p>
      ) : null}
    </SidebarNav>
  )

  return (
    <>
      <PageWithSidebar
        storageKey="prompts"
        sidebarLabel={t('prompts.components.prompt.preset.panel.presets')}
        sidebar={sidebar}
        toolbar={<PromptPageToolbar {...toolbarProps} />}
      >
        {selectedPreset ? (
          <div className="max-w-5xl space-y-8 pt-2">
            <RowGroup
              headingAs="h2"
              heading={selectedPreset.name}
              actions={(
                <>
                  {canUpdatePresets ? (
                    <IconButton size="icon-sm" variant="ghost" onClick={() => setEditorState({ mode: 'edit', preset: selectedPreset })} label={t('prompts.components.prompt.preset.panel.edit.preset')}>
                      <Pencil />
                    </IconButton>
                  ) : null}
                  {canDeletePresets ? (
                    <IconButton size="icon-sm" variant="ghost" onClick={() => void handleDeleteSelected()} label={t('prompts.components.prompt.preset.panel.delete.preset')}>
                      <Trash2 />
                    </IconButton>
                  ) : null}
                </>
              )}
            >
              {selectedPreset.description ? <p className="pb-2 text-sm text-muted-foreground">{selectedPreset.description}</p> : null}
              <ListRow size="sm" className="text-xs text-muted-foreground/75" leading={<span className="w-8 text-center">{t('prompts.components.prompt.preset.panel.number')}</span>}>
                <span className="w-2/5 min-w-0 shrink-0">{t('prompts.components.prompt.preset.panel.description')}</span>
                <span className="min-w-0 flex-1">{t('prompts.components.prompt.preset.panel.value')}</span>
              </ListRow>
              {(selectedPreset.items ?? []).map((item, index) => (
                <ListRow key={item.id} className="items-start py-2.5" leading={<span className="w-8 text-center text-xs tabular-nums text-muted-foreground">{index + 1}</span>}>
                  <span className="w-2/5 min-w-0 shrink-0 break-words">{item.description}</span>
                  <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-foreground/90">{item.value}</span>
                </ListRow>
              ))}
            </RowGroup>

            <RowGroup
              heading={t('prompts.components.prompt.preset.panel.insertion.preview')}
              actions={(
                <IconButton size="icon-sm" variant="ghost" onClick={() => void handleCopyInsertion()} disabled={!insertionPreview} label={t('prompts.components.prompt.preset.panel.copy')}>
                  <Copy />
                </IconButton>
              )}
            >
              <pre className="max-h-64 overflow-auto rounded-sm bg-fill px-3 py-3 text-xs leading-5 whitespace-pre-wrap text-foreground/90">{insertionPreview || t('prompts.components.prompt.preset.panel.no.value.to.insert')}</pre>
            </RowGroup>
          </div>
        ) : (
          <EmptyState size="compact" title={t('prompts.components.prompt.preset.panel.select.preset')} />
        )}
      </PageWithSidebar>

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
            showSnackbar({ message: t('prompts.components.prompt.preset.panel.enter.preset.name'), tone: 'error' })
            return
          }
          if (input.items.length === 0) {
            showSnackbar({ message: t('prompts.components.prompt.preset.panel.enter.at.least.one.description.value.set'), tone: 'error' })
            return
          }

          if (editorState?.mode === 'edit') {
            await updateMutation.mutateAsync({ presetId: editorState.preset.id, input })
            return
          }

          await createMutation.mutateAsync(input)
        }}
      />
    </>
  )
}
