import { useEffect, useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, Link2, Link2Off, Pencil, Trash2 } from 'lucide-react'
import { TextTabs as CommonTextTabs } from '@/components/common/text-tabs'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { EditorFooter } from '@/components/ui/editor-footer'
import { Field } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import {
  AUDIO_QUERY_KEY,
  audioDeletionPlan,
  createAudioComment,
  createAudioProject,
  deleteAudioComment,
  deleteAudioGroupCandidates,
  listAudioComments,
  setAudioCommentStatus,
  updateAudioComment,
  updateAudioGroup,
  updateAudioProject,
  type AudioComment,
  type AudioCommentStatus,
  type AudioFolder,
  type AudioGroup,
  type AudioProject,
} from '@/lib/api-audio'
import { getErrorMessage } from '@/lib/error-message'
import { cn } from '@/lib/utils'
import { autoAudioLabel, followsAudioName } from './audio-naming'

/* ------------------------------------------------------------------------------------------------ project */

export function AudioProjectDialog({ open, project, onClose, onSaved }: {
  open: boolean
  project: AudioProject | null
  onClose: () => void
  onSaved: (project: AudioProject) => void
}) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!open) return
    setName(project?.name ?? '')
    setDescription(project?.description ?? '')
  }, [open, project])

  const dirty = open && (name !== (project?.name ?? '') || description !== (project?.description ?? ''))
  const canSave = !busy && name.trim().length > 0 && (dirty || !project)

  const submit = async (event?: FormEvent) => {
    event?.preventDefault()
    if (!canSave) return
    setBusy(true)
    try {
      onSaved(project ? await updateAudioProject(project.id, { name, description }) : await createAudioProject({ name, description }))
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t({ ko: '실패했어.', en: 'Failed.' })), tone: 'error' })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open={open} title={project ? t({ ko: '프로젝트 수정', en: 'Edit project' }) : t({ ko: '새 프로젝트', en: 'New project' })} onClose={() => { if (!busy) onClose() }} size="narrow" dirty={dirty} onSave={canSave ? () => void submit() : undefined}>
      <form onSubmit={(event) => void submit(event)}>
        <ModalBody className="space-y-4">
          <Field label={t({ ko: '이름', en: 'Name' })}><Input variant="settings" autoFocus value={name} maxLength={120} onChange={(event) => setName(event.target.value)} /></Field>
          <Field label={t({ ko: '설명', en: 'Description' })}><Textarea variant="settings" rows={2} value={description} onChange={(event) => setDescription(event.target.value)} /></Field>
        </ModalBody>
        <EditorFooter saveSubmit canSave={canSave} saving={busy} />
      </form>
    </Modal>
  )
}

/* ------------------------------------------------------------------------------------------------ effect */

/**
 * Edit an effect (an audio group): name, folder (그룹), description, representative prompt and file name. The file
 * name follows the name (`이름_[00]`) until it is typed over; the link button ties it back. 받은 파일 only has a name.
 */
export function AudioGroupDialog({ open, group, folders, takenLabels, onClose, onSaved, onDelete }: {
  open: boolean
  group: AudioGroup | null
  /** Folders of the effect's project. */
  folders: AudioFolder[]
  /** File names of the other effects in the project, so a followed name stays unique. */
  takenLabels: Array<string | null>
  onClose: () => void
  onSaved: (group: AudioGroup) => void
  onDelete: () => void
}) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const [name, setName] = useState('')
  const [label, setLabel] = useState('')
  const [follows, setFollows] = useState(true)
  const [description, setDescription] = useState('')
  const [prompt, setPrompt] = useState('')
  const [folderId, setFolderId] = useState('')
  const [busy, setBusy] = useState(false)
  /** The fields as the dialog opened (null until the opened values have rendered), to tell unsaved edits. */
  const [openedSnapshot, setOpenedSnapshot] = useState<string | null>(null)
  useEffect(() => {
    if (!open || !group) return
    setName(group.name)
    setLabel(group.label ?? '')
    setFollows(group.label ? followsAudioName(group.label, group.name) : true)
    setDescription(group.description)
    setPrompt(group.prompt)
    setFolderId(group.folder_id ?? '')
    setOpenedSnapshot(null)
  }, [open, group])
  const inbox = group?.is_inbox === true
  const effectiveLabel = follows ? autoAudioLabel(name, takenLabels) : label
  const snapshot = JSON.stringify([name, effectiveLabel, description, prompt, folderId])
  useEffect(() => {
    if (open && group && openedSnapshot === null) setOpenedSnapshot(snapshot)
  }, [group, open, openedSnapshot, snapshot])
  const dirty = open && openedSnapshot !== null && snapshot !== openedSnapshot
  const canSave = !busy && name.trim().length > 0 && (inbox || effectiveLabel.trim().length > 0) && dirty

  const submit = async (event?: FormEvent) => {
    event?.preventDefault()
    if (!group || !canSave) return
    setBusy(true)
    try {
      onSaved(await updateAudioGroup(group.id, inbox ? { name } : { name, label: effectiveLabel, description, prompt, folder_id: folderId || null }))
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t({ ko: '실패했어.', en: 'Failed.' })), tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} title={inbox ? t({ ko: '받은 파일', en: 'Inbox' }) : t({ ko: '효과음 수정', en: 'Edit effect' })} onClose={() => { if (!busy) onClose() }} size="narrow" dirty={dirty} onSave={canSave ? () => void submit() : undefined}>
      <form onSubmit={(event) => void submit(event)}>
        <ModalBody className="space-y-4">
          <Field label={t({ ko: '이름', en: 'Name' })}><Input variant="settings" autoFocus value={name} maxLength={120} onChange={(event) => setName(event.target.value)} /></Field>
          {!inbox ? (
            <>
              <Field label={t({ ko: '그룹', en: 'Group' })}>
                <Select variant="settings" value={folderId} onChange={(event) => setFolderId(event.target.value)}>
                  <option value="">{t({ ko: '없음', en: 'None' })}</option>
                  {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
                </Select>
              </Field>
              <Field label={t({ ko: '설명', en: 'Description' })}><Textarea variant="settings" rows={2} value={description} maxLength={4000} onChange={(event) => setDescription(event.target.value)} /></Field>
              <Field label={t({ ko: '대표 프롬프트', en: 'Representative prompt' })}><Textarea variant="settings" rows={3} value={prompt} maxLength={8000} onChange={(event) => setPrompt(event.target.value)} /></Field>
              <Field label={t({ ko: '파일명', en: 'File name' })} info={t({ ko: '채택본을 내보낼 때의 파일 이름. [00]은 번호 자리야.', en: 'File name of exported takes. [00] is the number slot.' })}>
                <div className="flex items-center gap-1">
                  <Input
                    variant="settings"
                    className="font-mono"
                    value={effectiveLabel}
                    maxLength={120}
                    onChange={(event) => {
                      setFollows(false)
                      setLabel(event.target.value)
                    }}
                  />
                  <IconButton
                    variant="ghost"
                    size="icon-sm"
                    active={follows}
                    className={cn(follows && 'text-success')}
                    label={follows ? t({ ko: '이름을 따라가는 중', en: 'Following the name' }) : t({ ko: '이름 따라가기', en: 'Follow the name' })}
                    onClick={() => {
                      if (follows) setLabel(effectiveLabel)
                      setFollows(!follows)
                    }}
                  >
                    {follows ? <Link2 /> : <Link2Off />}
                  </IconButton>
                </div>
              </Field>
            </>
          ) : null}
        </ModalBody>
        <EditorFooter
          onDelete={group && !inbox ? onDelete : undefined}
          deleteLabel={t({ ko: '효과음 삭제', en: 'Delete effect' })}
          saveSubmit
          canSave={canSave}
          saving={busy}
        />
      </form>
    </Modal>
  )
}

/* ------------------------------------------------------------------------------------------------ comments */

const COMMENT_PAGE = 20

export function AudioCommentsDialog({ open, group, canEdit, onClose, onChanged }: {
  open: boolean
  group: AudioGroup
  canEdit: boolean
  onClose: () => void
  onChanged: () => void
}) {
  const { t, formatDateTime } = useI18n()
  const { showSnackbar } = useSnackbar()
  const [status, setStatus] = useState<AudioCommentStatus | 'all'>('pending')
  const [offset, setOffset] = useState(0)
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const query = useQuery({
    queryKey: [AUDIO_QUERY_KEY, 'comments', group.id, status, offset],
    queryFn: () => listAudioComments(group.id, status === 'all' ? null : status, offset, COMMENT_PAGE + 1),
    enabled: open,
  })
  const items = (query.data ?? []).slice(0, COMMENT_PAGE)
  const hasMore = (query.data?.length ?? 0) > COMMENT_PAGE
  useEffect(() => { setOffset(0) }, [status, group.id])

  const run = async (work: () => Promise<unknown>) => {
    try {
      await work()
      await query.refetch()
      onChanged()
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t({ ko: '실패했어.', en: 'Failed.' })), tone: 'error' })
      await query.refetch()
    }
  }
  const send = () => {
    const text = draft.trim()
    if (!text) return
    setDraft('')
    void run(() => createAudioComment(group.id, text))
  }
  const tabs: Array<{ value: AudioCommentStatus | 'all'; label: string }> = [{ value: 'pending', label: t({ ko: '대기', en: 'Pending' }) }, { value: 'completed', label: t({ ko: '완료', en: 'Completed' }) }, { value: 'all', label: t({ ko: '전체', en: 'All' }) }]

  return (
    <Modal open={open} title={t({ ko: '{name} 코멘트', en: '{name} comments' }, { name: group.name })} onClose={onClose} size="narrow" height="medium">
      <ModalBody className="space-y-3">
        <CommonTextTabs value={status} items={tabs} onChange={setStatus} />
        <ul className="divide-y divide-line">
          {items.map((comment) => (
            <li key={comment.id} className="flex items-start gap-3 py-3">
              <Checkbox
                aria-label={t({ ko: '완료', en: 'Done' })}
                className="mt-0.5"
                disabled={!canEdit}
                checked={comment.status === 'completed'}
                onCheckedChange={(checked) => void run(() => setAudioCommentStatus(group.id, comment, checked === true ? 'completed' : 'pending'))}
              />
              <div className="min-w-0 flex-1 space-y-1">
                {editing?.id === comment.id ? (
                  <Textarea
                    variant="settings"
                    autoFocus
                    rows={2}
                    value={editing.text}
                    onChange={(event) => setEditing({ id: comment.id, text: event.target.value })}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                        event.preventDefault()
                        const text = editing.text.trim()
                        setEditing(null)
                        if (text && text !== comment.text) void run(() => updateAudioComment(group.id, comment.id, text))
                      }
                      if (event.key === 'Escape') setEditing(null)
                    }}
                  />
                ) : (
                  <p className={cn('text-sm whitespace-pre-wrap break-words', comment.status === 'completed' && 'text-muted-foreground')}>{comment.text}</p>
                )}
                <p className="text-2xs text-muted-foreground">
                  {formatDateTime(comment.created_at)}
                  {comment.completion_note ? ` · ${comment.completion_note}` : ''}
                </p>
              </div>
              {canEdit ? (
                <div className="flex shrink-0 gap-0.5">
                  <IconButton variant="ghost" size="icon-xs" label={t({ ko: '수정', en: 'Edit' })} onClick={() => setEditing({ id: comment.id, text: comment.text })}><Pencil /></IconButton>
                  <IconButton variant="ghost" size="icon-xs" label={t({ ko: '삭제', en: 'Delete' })} onClick={() => void run(() => deleteAudioComment(group.id, comment.id))}><Trash2 /></IconButton>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
        {offset > 0 || hasMore ? (
          <div className="flex justify-end gap-1">
            <Button variant="ghost" size="xs" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - COMMENT_PAGE))}>{t({ ko: '이전', en: 'Previous' })}</Button>
            <Button variant="ghost" size="xs" disabled={!hasMore} onClick={() => setOffset(offset + COMMENT_PAGE)}>{t({ ko: '다음', en: 'Next' })}</Button>
          </div>
        ) : null}
      </ModalBody>
      {canEdit ? (
        <ModalFooter>
          <Textarea
            variant="settings"
            rows={2}
            className="flex-1"
            placeholder={t({ ko: '코멘트', en: 'Comment' })}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                send()
              }
            }}
          />
          <IconButton label={t({ ko: '남기기', en: 'Post' })} disabled={!draft.trim()} onClick={send}><Check /></IconButton>
        </ModalFooter>
      ) : null}
    </Modal>
  )
}

/** Underlined text tabs taking `[id, label, count]` tuples (the audio page's strip); dialogs use the common TextTabs. */
export function TextTabs<T extends string>({ value, items, onChange, className }: { value: T; items: Array<[T, string, number?]>; onChange: (value: T) => void; className?: string }) {
  return (
    <Tabs value={value} onValueChange={(next) => onChange(next as T)}>
      <TabsList className={cn(TEXT_TAB_LIST_CLASS, className)}>
        {items.map(([id, label, count]) => (
          <TabsTrigger key={id} value={id} className={cn(TEXT_TAB_TRIGGER_CLASS, 'shrink-0')}>
            {label}
            {count !== undefined ? <span className="ml-1 font-mono text-2xs font-normal text-muted-foreground">{count}</span> : null}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}

const TEXT_TAB_LIST_CLASS = 'flex w-full flex-nowrap gap-5 rounded-none border-b border-line bg-transparent p-0'
const TEXT_TAB_TRIGGER_CLASS = 'relative rounded-none px-0 pb-2 pt-0 text-sm font-semibold text-muted-foreground hover:bg-transparent data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-primary after:opacity-0 data-[state=active]:after:opacity-100'

/* ------------------------------------------------------------------------------------------------ cleanup */

export function AudioCleanupDialog({ open, group, onClose, onDone }: { open: boolean; group: AudioGroup; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const [scope, setScope] = useState<'unselected' | 'all'>('unselected')
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (open) setScope('unselected') }, [open])
  // The plan is the frozen list the confirmation shows; the delete uses exactly these ids.
  const plan = useQuery({
    // Outside the 'audio' prefix: queue events must not refresh a plan the user is confirming.
    queryKey: ['audio-deletion-plan', group.id, scope],
    queryFn: () => audioDeletionPlan(group.id, scope),
    enabled: open,
    staleTime: Infinity,
    gcTime: 0,
  })

  const run = async () => {
    if (!plan.data || plan.data.count === 0) return
    setBusy(true)
    try {
      const result = await deleteAudioGroupCandidates(group.id, plan.data.candidate_ids, scope === 'all')
      showSnackbar({ message: t({ ko: '후보 {count}개를 휴지통으로 보냈어.', en: 'Moved {count} takes to the RecycleBin.' }, { count: result.deleted }) })
      onDone()
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t({ ko: '실패했어.', en: 'Failed.' })), tone: 'error' })
      await plan.refetch()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} title={t({ ko: '후보 정리', en: 'Clean up takes' })} onClose={() => { if (!busy) onClose() }} size="narrow">
      <ModalBody className="space-y-4">
        <CommonTextTabs value={scope} items={[{ value: 'unselected', label: t({ ko: '미채택만', en: 'Unselected only' }) }, { value: 'all', label: t({ ko: '전체', en: 'Everything' }) }]} onChange={setScope} />
        <p className="text-sm">
          {plan.data
            ? t({ ko: '후보 {count}개가 휴지통으로 가.', en: '{count} takes go to the RecycleBin.' }, { count: plan.data.count })
            : '…'}
          {plan.data && plan.data.selected_count > 0 ? <span className="text-destructive"> {t({ ko: '채택본 {count}개 포함', en: 'Includes {count} selected takes' }, { count: plan.data.selected_count })}</span> : null}
        </p>
      </ModalBody>
      <ModalFooter className="mt-4 border-t border-line pt-3">
        <Button variant="destructive" disabled={busy || !plan.data || plan.data.count === 0} onClick={() => void run()}><Trash2 />{t({ ko: '정리', en: 'Clean up' })}</Button>
      </ModalFooter>
    </Modal>
  )
}

export type { AudioComment }
