import { REFMOD_ENTRY_LIMITS } from '@conai/shared'
import { useQuery } from '@tanstack/react-query'
import { CopyPlus, Download, Hammer, Star, Trash2 } from 'lucide-react'
import { addTerm, ChipListInput } from '@/components/common/chip-list-input'
import { EditorTitleInput } from '@/components/common/editor-page'
import { LibraryItemDialog } from '@/components/common/library-item-dialog'
import { SaveConflictAlert, SaveConflictOverwriteButton } from '@/components/common/save-conflict-alert'
import { ActionMenuButton } from '@/components/ui/action-menu'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/ui/error-state'
import { Field, FieldGroup } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { ListRow } from '@/components/ui/list-row'
import { LoadingState } from '@/components/ui/loading-state'
import { ModalBody } from '@/components/ui/modal'
import { RowGroup } from '@/components/ui/row-group'
import { Select } from '@/components/ui/select'
import { Text } from '@/components/ui/text'
import { Tip } from '@/components/ui/tooltip'
import { useFeaturePermissions } from '@/features/auth/use-feature-permissions'
import { findAutoCollectedPowerLoraOptions } from '@/features/image-generation/components/power-lora-loader-utils'
import { WorkflowFieldGroupList } from '@/features/image-generation/components/workflow-field-group-list'
import { useI18n } from '@/i18n'
import { getGenerationCustomDropdownLists } from '@/lib/api-image-generation-workflows'
import type { RefModEntryRun } from '@/lib/api-refmod-entries'
import { refModBuildBlockReason, refModIssueReason, refModServerStatus } from '../refmod-shared'
import type { RefModLibrary } from '../use-refmod-library'

const RUN_STATUS_BADGE = { pending: 'info', saved: 'success', failed: 'destructive' } as const

/**
 * One RefMod entry over the list (`entry=<id>`): the name edited in the header (it is the workflow's name field when the
 * workflow has one), the server status, favorite, the build key and ⋯; stepping through the listed entries and saving
 * with Ctrl+S. The body is the linked creation workflow's real form (the same field cards and Director editor as the
 * ComfyUI tab), its workflow Select, the search keywords and the latest runs. Without characters.edit it only shows.
 */
export function RefModEntryDialog({ library }: { library: RefModLibrary }) {
  const { t } = useI18n()
  const { editor, canEdit, canBuild, visibleEntries, total, loadMore, openEntry, closeEntry, toggleFavorite, duplicate, exportEntries, build, presence } = library
  const { latest, busy } = editor
  const pending = latest ? library.isPending(latest) : false
  const status = latest ? refModServerStatus(t, pending, presence.data, presence.isError, library.isOnServer(latest.name)) : null
  const blockReason = latest ? refModBuildBlockReason(t, { ...latest, name: editor.nameValue.trim() || latest.name, pending }, presence.data, editor.dirty) : null
  return (
    <LibraryItemDialog
      title={editor.ready
        ? <EditorTitleInput as="span" value={editor.nameValue} label={t({ ko: 'RefMod 이름', en: 'RefMod name' })} placeholder={t({ ko: '파일 이름', en: 'File name' })} maxLength={REFMOD_ENTRY_LIMITS.name} readOnly={!canEdit} invalid={Boolean(editor.nameError) || !editor.nameValue.trim()} onChange={editor.setName} />
        : 'RefMod'}
      description={editor.nameError ? <span role="alert" className="text-destructive">{editor.nameError}</span> : undefined}
      status={status ? <Tip content={status.title}><Badge variant={status.tone} size="sm">{status.label}</Badge></Tip> : undefined}
      actions={editor.ready && latest ? <>
        {canEdit ? <IconButton variant="ghost" size="icon-sm" active={latest.favorite} disabled={busy || library.bulkPending} label={latest.favorite ? t({ ko: '즐겨찾기 해제', en: 'Unfavorite' }) : t({ ko: '즐겨찾기', en: 'Favorite' })} onClick={() => toggleFavorite(latest)}><Star className={latest.favorite ? 'fill-current' : undefined} /></IconButton> : null}
        {canBuild ? (
          <IconButton variant="ghost" size="icon-sm" aria-busy={pending} disabled={Boolean(blockReason) || busy || !editor.canSave && editor.dirty} label={blockReason ?? (editor.dirty ? t({ ko: '저장하고 만들기', en: 'Save and build' }) : t({ ko: '만들기', en: 'Build' }))} onClick={() => void build(latest)}>
            <Hammer />
          </IconButton>
        ) : null}
        <ActionMenuButton label={t({ ko: 'RefMod 작업', en: 'RefMod actions' })} entries={[
          canEdit ? { key: 'duplicate', label: t({ ko: '복제', en: 'Duplicate' }), icon: CopyPlus, disabled: busy, onSelect: () => void duplicate(latest) } : null,
          { key: 'export', label: t({ ko: '내보내기', en: 'Export' }), icon: Download, onSelect: () => void exportEntries({ ids: [latest.id] }, latest.name) },
          canEdit ? '-' : null,
          // Failures are reported by the editor.
          canEdit ? { key: 'delete', label: t({ ko: '삭제', en: 'Delete' }), icon: Trash2, destructive: true, disabled: busy || editor.deleting || pending, onSelect: () => void editor.remove(true).catch(() => undefined) } : null,
        ]} />
      </> : undefined}
      ready={editor.ready}
      canEdit={canEdit}
      dirty={editor.dirty}
      canSave={editor.canSave}
      saving={editor.saving}
      busy={busy}
      isBusy={editor.isBusy}
      isCurrent={editor.isCurrent}
      session={editor.session}
      onSave={() => void editor.save().catch(() => undefined)}
      onRevert={editor.revert}
      items={visibleEntries ?? []}
      total={total ?? visibleEntries?.length ?? 0}
      openId={editor.entryId}
      onLoadMore={loadMore}
      onOpen={openEntry}
      onClose={closeEntry}
      previousLabel={t({ ko: '이전 RefMod', en: 'Previous RefMod' })}
      nextLabel={t({ ko: '다음 RefMod', en: 'Next RefMod' })}
      loadMoreError={t({ ko: '다음 RefMod를 불러오지 못했어.', en: 'Could not load more RefMods.' })}
    >
      {/* Per entry: the form and chip fields start fresh while the dialog and its footer stay. */}
      <RefModEntryBody key={editor.session} library={library} />
    </LibraryItemDialog>
  )
}

function RefModEntryBody({ library }: { library: RefModLibrary }) {
  const { t } = useI18n()
  const permissions = useFeaturePermissions()
  const { editor, canEdit } = library
  const { base, latest, draft, busy } = editor
  // The same cache entry the ComfyUI tab reads: Power LoRA fields offer the auto-collected LoRA list.
  const dropdownLists = useQuery({ queryKey: ['image-generation-custom-dropdown-lists'], queryFn: () => getGenerationCustomDropdownLists(), enabled: editor.ready && permissions.canViewWorkflows, staleTime: 60_000 })
  const loraOptions = findAutoCollectedPowerLoraOptions(dropdownLists.data ?? [])

  if (editor.loading) return <ModalBody><LoadingState variant="inline" /></ModalBody>
  if (editor.error) return <ModalBody><ErrorState title={t({ ko: 'RefMod를 불러오지 못했어', en: 'Could not load the RefMod' })} error={editor.error} onRetry={editor.retry} /></ModalBody>
  if (!editor.ready || !base || !latest) return <ModalBody />
  const editable = canEdit && !editor.saving && !editor.deleting
  const form = base.form
  const candidates = library.workflows.data ?? []
  const blocking = latest.issues.filter((issue) => issue.severity === 'blocking')
  const linked = base.workflowId !== null && candidates.some((candidate) => candidate.id === base.workflowId)
  return (
    <ModalBody>
      {editor.conflict ? (
        <SaveConflictAlert message={t({ ko: '다른 곳에서 이 RefMod가 바뀌었어. 고친 내용은 그대로 있어.', en: 'This RefMod changed elsewhere. Your edits are kept.' })}>
          <Button size="sm" variant="secondary" disabled={editor.saving} onClick={editor.reload}>{t({ ko: '다시 불러오기', en: 'Reload' })}</Button>
          {editor.conflict.workflowId === base.workflowId ? <SaveConflictOverwriteButton disabled={editor.saving} onClick={() => { editor.keepMine(); void editor.save().catch(() => undefined) }} /> : null}
        </SaveConflictAlert>
      ) : null}
      {/* Two columns from lg; the foldable's inner screen and phones stack them (the form first). */}
      <div className="grid min-w-0 gap-x-8 gap-y-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,4fr)]">
        <div className="min-w-0 space-y-4">
          <Field label={t({ ko: '생성 워크플로', en: 'Creation workflow' })}>
            <Select
              variant="settings"
              value={base.workflowId === null ? '' : String(base.workflowId)}
              disabled={!editable || busy}
              onChange={(event) => void editor.changeWorkflow(event.target.value ? Number(event.target.value) : null).catch(() => undefined)}
            >
              {base.workflowId === null ? <option value="">{t({ ko: '워크플로 골라줘', en: 'Choose a workflow' })}</option> : null}
              {base.workflowId !== null && !linked ? <option value={String(base.workflowId)}>{base.workflowName ?? `#${base.workflowId}`}</option> : null}
              {candidates.map((candidate) => (
                <option key={candidate.id} value={String(candidate.id)} disabled={candidate.issues.some((issue) => issue.code === 'multiple-export-nodes' || issue.code === 'no-export-node')}>
                  {candidate.buildable ? candidate.name : `${candidate.name} · ${t({ ko: '만들 수 없음', en: 'cannot build' })}`}
                </option>
              ))}
            </Select>
          </Field>
          {blocking.length ? (
            <Alert variant="warning">
              <AlertTitle>{t({ ko: '아직 만들 수 없어', en: 'Cannot be built yet' })}</AlertTitle>
              <AlertDescription>{blocking.map((issue) => refModIssueReason(t, issue)).join(' · ')}</AlertDescription>
            </Alert>
          ) : null}
          {editor.draftError ? <Alert variant="destructive"><AlertDescription>{editor.draftError}</AlertDescription></Alert> : null}
          {form ? (
            // A read-only window keeps the real form but locks every control in it.
            <fieldset disabled={!editable} className="min-w-0 space-y-3">
              <WorkflowFieldGroupList
                fields={editor.fields}
                values={draft.values}
                loraOptions={loraOptions}
                comfyServerId={library.defaultServerId}
                refModExportOnly
                onChange={editor.setValue}
                onImageChange={(fieldId, image) => editor.setValue(fieldId, image ?? '')}
              />
            </fieldset>
          ) : null}
        </div>
        <div className="min-w-0 space-y-6">
          <FieldGroup label={t({ ko: '검색어 {count}/{max}', en: 'Keywords {count}/{max}' }, { count: draft.keywords.length, max: REFMOD_ENTRY_LIMITS.keywords })}>
            <ChipListInput items={draft.keywords} editable={editable} disabled={busy}
              onAdd={(text) => editor.setKeywords(addTerm(editor.draftRef.current.keywords, text, REFMOD_ENTRY_LIMITS.keywords))}
              onRemove={(index) => editor.setKeywords(editor.draftRef.current.keywords.filter((_, at) => at !== index))}
              addLabel={t({ ko: '검색어 추가', en: 'Add keyword' })} placeholder={t({ ko: '+ 검색어', en: '+ keyword' })}
              maxLength={REFMOD_ENTRY_LIMITS.keyword} full={draft.keywords.length >= REFMOD_ENTRY_LIMITS.keywords} />
          </FieldGroup>
          <RunList runs={latest.records} library={library} />
        </div>
      </div>
    </ModalBody>
  )
}

function RunList({ runs, library }: { runs: RefModEntryRun[]; library: RefModLibrary }) {
  const { t, formatDateTime } = useI18n()
  const serverName = (serverId: number) => library.presenceOk?.serverId === serverId ? library.presenceOk.serverName : t({ ko: '서버 #{id}', en: 'Server #{id}' }, { id: serverId })
  const statusLabel = { pending: t({ ko: '만드는 중', en: 'Building' }), saved: t({ ko: '저장됨', en: 'Saved' }), failed: t({ ko: '실패', en: 'Failed' }) }
  return (
    <RowGroup heading={t({ ko: '기록', en: 'Runs' })} count={runs.length}>
      {runs.length ? runs.map((run) => (
        <ListRow key={run.id} size="sm" trailing={<Text as="span" variant="caption" className="tabular-nums">{formatDateTime(run.createdAt)}</Text>}>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <Badge variant={RUN_STATUS_BADGE[run.status]} size="sm">{statusLabel[run.status]}</Badge>
              <Text as="span" variant="caption" className="truncate">{serverName(run.serverId)}</Text>
            </div>
            {run.error ? <Text variant="caption" tone="destructive" className="line-clamp-3">{run.error}</Text> : null}
          </div>
        </ListRow>
      )) : <Text variant="caption">{t({ ko: '아직 만든 적 없어.', en: 'Not built yet.' })}</Text>}
    </RowGroup>
  )
}
