import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, Pencil, Sparkles, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import {
  AUDIO_QUERY_KEY,
  audioDeletionPlan,
  createAudioComment,
  createAudioGroup,
  createAudioOrder,
  createAudioProject,
  deleteAudioComment,
  deleteAudioGroup,
  deleteAudioGroupCandidates,
  deleteAudioProject,
  listAudioComments,
  listAudioWorkflows,
  setAudioCommentStatus,
  updateAudioComment,
  updateAudioGroup,
  updateAudioProject,
  type AudioComment,
  type AudioCommentStatus,
  type AudioGroup,
  type AudioOrder,
  type AudioProject,
} from '@/lib/api-audio'
import { getGenerationComfyUIServers } from '@/lib/api-image-generation-workflows'
import { getErrorMessage } from '@/lib/error-message'
import { createRandomUuid } from '@/lib/random-uuid'
import { cn } from '@/lib/utils'

/* ------------------------------------------------------------------------------------------------ project */

export function AudioProjectDialog({ open, project, onClose, onSaved, onDeleted }: {
  open: boolean
  project: AudioProject | null
  onClose: () => void
  onSaved: (project: AudioProject) => void
  onDeleted: () => void
}) {
  const { t } = useI18n()
  const confirm = useConfirm()
  const { showSnackbar } = useSnackbar()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!open) return
    setName(project?.name ?? '')
    setDescription(project?.description ?? '')
  }, [open, project])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    try {
      onSaved(project ? await updateAudioProject(project.id, { name, description }) : await createAudioProject({ name, description }))
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t({ ko: '실패했어.', en: 'Failed.' })), tone: 'error' })
    } finally {
      setBusy(false)
    }
  }
  const remove = async () => {
    if (!project) return
    const ok = await confirm({
      title: t({ ko: '프로젝트 삭제', en: 'Delete project' }),
      description: t({ ko: '"{name}"의 그룹과 후보 {count}개가 모두 휴지통으로 가.', en: 'All groups and {count} takes of "{name}" go to the RecycleBin.' }, { name: project.name, count: project.candidate_count }),
      confirmLabel: t({ ko: '삭제', en: 'Delete' }),
      tone: 'destructive',
    })
    if (!ok) return
    setBusy(true)
    try {
      await deleteAudioProject(project.id)
      onDeleted()
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t({ ko: '실패했어.', en: 'Failed.' })), tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} title={project ? t({ ko: '프로젝트 수정', en: 'Edit project' }) : t({ ko: '새 프로젝트', en: 'New project' })} onClose={() => { if (!busy) onClose() }} widthClassName="max-w-md">
      <form onSubmit={(event) => void submit(event)}>
        <ModalBody className="space-y-4">
          <Field label={t({ ko: '이름', en: 'Name' })}><Input autoFocus value={name} maxLength={120} onChange={(event) => setName(event.target.value)} /></Field>
          <Field label={t({ ko: '설명', en: 'Description' })}><Textarea rows={2} value={description} onChange={(event) => setDescription(event.target.value)} /></Field>
        </ModalBody>
        <ModalFooter>
          {project ? <IconButton variant="ghost" label={t({ ko: '프로젝트 삭제', en: 'Delete project' })} disabled={busy} onClick={() => void remove()}><Trash2 /></IconButton> : null}
          <span className="flex-1" />
          <Button type="submit" disabled={busy || !name.trim()}>{t({ ko: '저장', en: 'Save' })}</Button>
        </ModalFooter>
      </form>
    </Modal>
  )
}

/* ------------------------------------------------------------------------------------------------ group */

export function AudioGroupDialog({ open, projectId, group, onClose, onSaved, onDeleted }: {
  open: boolean
  projectId: string
  group: AudioGroup | null
  onClose: () => void
  onSaved: (group: AudioGroup) => void
  onDeleted: () => void
}) {
  const { t } = useI18n()
  const confirm = useConfirm()
  const { showSnackbar } = useSnackbar()
  const [name, setName] = useState('')
  const [label, setLabel] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!open) return
    setName(group?.name ?? '')
    setLabel(group?.label ?? '')
    setDescription(group?.description ?? '')
  }, [open, group])
  const inbox = group?.is_inbox === true

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    try {
      const input = inbox ? { name, description } : { name, label, description }
      onSaved(group ? await updateAudioGroup(group.id, input) : await createAudioGroup(projectId, { name, label, description }))
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t({ ko: '실패했어.', en: 'Failed.' })), tone: 'error' })
    } finally {
      setBusy(false)
    }
  }
  const remove = async () => {
    if (!group) return
    const ok = await confirm({
      title: t({ ko: '그룹 삭제', en: 'Delete group' }),
      description: t({ ko: '"{name}"의 후보 {count}개가 휴지통으로 가.', en: '{count} takes of "{name}" go to the RecycleBin.' }, { name: group.name, count: group.candidate_count }),
      confirmLabel: t({ ko: '삭제', en: 'Delete' }),
      tone: 'destructive',
    })
    if (!ok) return
    setBusy(true)
    try {
      await deleteAudioGroup(group.id)
      onDeleted()
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t({ ko: '실패했어.', en: 'Failed.' })), tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} title={group ? t({ ko: '그룹 수정', en: 'Edit group' }) : t({ ko: '새 그룹', en: 'New group' })} onClose={() => { if (!busy) onClose() }} widthClassName="max-w-md">
      <form onSubmit={(event) => void submit(event)}>
        <ModalBody className="space-y-4">
          <Field label={t({ ko: '이름', en: 'Name' })}><Input autoFocus value={name} maxLength={120} onChange={(event) => setName(event.target.value)} /></Field>
          {!inbox ? (
            <Field label={t({ ko: '파일명 규칙', en: 'File name rule' })} info={t({ ko: '채택본을 내보낼 때의 파일 이름. [00]은 번호 자리야. 예: footstep_snow_[00]', en: 'File name of exported takes. [00] is the number slot, e.g. footstep_snow_[00]' })}>
              <Input className="font-mono" value={label} maxLength={120} onChange={(event) => setLabel(event.target.value)} />
            </Field>
          ) : null}
          <Field label={t({ ko: '설명 (생성 프롬프트 기본값)', en: 'Description (default prompt)' })}><Textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} /></Field>
        </ModalBody>
        <ModalFooter>
          {group && !inbox ? <IconButton variant="ghost" label={t({ ko: '그룹 삭제', en: 'Delete group' })} disabled={busy} onClick={() => void remove()}><Trash2 /></IconButton> : null}
          <span className="flex-1" />
          <Button type="submit" disabled={busy || !name.trim() || (!inbox && !label.trim())}>{t({ ko: '저장', en: 'Save' })}</Button>
        </ModalFooter>
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
  const tabs: Array<[AudioCommentStatus | 'all', string]> = [['pending', t({ ko: '대기', en: 'Pending' })], ['completed', t({ ko: '완료', en: 'Completed' })], ['all', t({ ko: '전체', en: 'All' })]]

  return (
    <Modal open={open} title={t({ ko: '{name} 코멘트', en: '{name} comments' }, { name: group.name })} onClose={onClose} widthClassName="max-w-lg">
      <ModalBody className="space-y-3">
        <TextTabs value={status} items={tabs} onChange={setStatus} />
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

/** Underlined text tabs (the app's in-place tab style). */
export function TextTabs<T extends string>({ value, items, onChange, className }: { value: T; items: Array<[T, string, number?]>; onChange: (value: T) => void; className?: string }) {
  return (
    <div role="tablist" className={cn('flex gap-5 overflow-x-auto border-b border-line', className)}>
      {items.map(([id, label, count]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={value === id}
          onClick={() => onChange(id)}
          className={cn(
            'relative shrink-0 cursor-pointer pb-2 text-sm font-semibold whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground',
            'after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-primary after:opacity-0',
            value === id && 'text-foreground after:opacity-100',
          )}
        >
          {label}
          {count !== undefined ? <span className="ml-1 font-mono text-2xs font-normal text-muted-foreground">{count}</span> : null}
        </button>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------------------------------------ cleanup */

export function AudioCleanupDialog({ open, group, onClose, onDone }: { open: boolean; group: AudioGroup; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const [scope, setScope] = useState<'unselected' | 'all'>('unselected')
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (open) setScope('unselected') }, [open])
  // The plan is the frozen list the confirmation shows; the delete uses exactly these ids.
  const plan = useQuery({
    queryKey: [AUDIO_QUERY_KEY, 'deletion-plan', group.id, scope],
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
    <Modal open={open} title={t({ ko: '후보 정리', en: 'Clean up takes' })} onClose={() => { if (!busy) onClose() }} widthClassName="max-w-md">
      <ModalBody className="space-y-4">
        <TextTabs value={scope} items={[['unselected', t({ ko: '미채택만', en: 'Unselected only' })], ['all', t({ ko: '전체', en: 'Everything' })]]} onChange={setScope} />
        <p className="text-sm">
          {plan.data
            ? t({ ko: '후보 {count}개가 휴지통으로 가.', en: '{count} takes go to the RecycleBin.' }, { count: plan.data.count })
            : '…'}
          {plan.data && plan.data.selected_count > 0 ? <span className="text-destructive"> {t({ ko: '채택본 {count}개 포함', en: 'Includes {count} selected takes' }, { count: plan.data.selected_count })}</span> : null}
        </p>
      </ModalBody>
      <ModalFooter>
        <span className="flex-1" />
        <Button variant="destructive" disabled={busy || !plan.data || plan.data.count === 0} onClick={() => void run()}><Trash2 />{t({ ko: '정리', en: 'Clean up' })}</Button>
      </ModalFooter>
    </Modal>
  )
}

/* ------------------------------------------------------------------------------------------------ order */

export function AudioOrderDialog({ open, group, onClose, onOrdered }: { open: boolean; group: AudioGroup; onClose: () => void; onOrdered: (order: AudioOrder) => void }) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const workflows = useQuery({ queryKey: [AUDIO_QUERY_KEY, 'workflows'], queryFn: listAudioWorkflows, enabled: open })
  const servers = useQuery({ queryKey: [AUDIO_QUERY_KEY, 'servers'], queryFn: () => getGenerationComfyUIServers(true), enabled: open, retry: false })
  const bound = useMemo(() => (workflows.data ?? []).filter((workflow) => workflow.binding && workflow.is_active), [workflows.data])
  const [workflowId, setWorkflowId] = useState<number | null>(null)
  const [text, setText] = useState('')
  const [seconds, setSeconds] = useState('3')
  const [count, setCount] = useState('4')
  const [seed, setSeed] = useState('')
  const [route, setRoute] = useState('')
  const [requestKey, setRequestKey] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setText(group.description)
    setRequestKey(createRandomUuid())
  }, [open, group.id, group.description])
  useEffect(() => {
    if (!open || bound.length === 0) return
    setWorkflowId((current) => (current !== null && bound.some((workflow) => workflow.id === current) ? current : (bound.find((workflow) => workflow.binding?.is_default) ?? bound[0]).id))
  }, [open, bound])

  const workflow = bound.find((entry) => entry.id === workflowId) ?? null
  const secondsMax = workflow?.binding?.compat?.seconds_max ?? null
  const tags = [...new Set((servers.data ?? []).flatMap((server) => server.routing_tags ?? []))]
  const countValue = Number(count)
  const valid = Boolean(workflow) && text.trim().length > 0 && Number(seconds) > 0 && (secondsMax === null || Number(seconds) <= secondsMax)
    && Number.isInteger(countValue) && countValue >= 1 && countValue <= 50 && (seed.trim() === '' || /^\d+$/.test(seed.trim()))

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!valid || !workflow) return
    setBusy(true)
    try {
      const order = await createAudioOrder({
        group_id: group.id,
        workflow_id: workflow.id,
        text: text.trim(),
        seconds: Number(seconds),
        count: countValue,
        seed: seed.trim() === '' ? null : Number(seed.trim()),
        request_key: requestKey,
        server_id: route.startsWith('server:') ? Number(route.slice(7)) : null,
        server_tag: route.startsWith('tag:') ? route.slice(4) : null,
      })
      onOrdered(order)
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t({ ko: '실패했어.', en: 'Failed.' })), tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} title={t({ ko: '생성 주문 · {name}', en: 'Order · {name}' }, { name: group.name })} onClose={() => { if (!busy) onClose() }} widthClassName="max-w-md">
      <form onSubmit={(event) => void submit(event)}>
        <ModalBody className="space-y-4">
          <Field label={t({ ko: '워크플로', en: 'Workflow' })}>
            <Select value={workflowId ?? ''} onChange={(event) => setWorkflowId(Number(event.target.value))} disabled={bound.length === 0}>
              {bound.length === 0 ? <option value="">{t({ ko: '연결된 음향 워크플로 없음', en: 'No linked audio workflow' })}</option> : null}
              {bound.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
            </Select>
          </Field>
          {workflows.isSuccess && bound.length === 0 ? <p className="text-xs text-destructive">{t({ ko: '음향 설정 › 워크플로에서 먼저 연결해줘.', en: 'Link one under Audio settings › Workflows first.' })}</p> : null}
          <Field label={t({ ko: '프롬프트', en: 'Prompt' })}><Textarea rows={3} value={text} maxLength={8000} onChange={(event) => setText(event.target.value)} /></Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label={t({ ko: '길이(초)', en: 'Seconds' })}><Input className="font-mono" type="number" step="0.1" min={0.1} max={secondsMax ?? undefined} value={seconds} onChange={(event) => setSeconds(event.target.value)} aria-invalid={secondsMax !== null && Number(seconds) > secondsMax} /></Field>
            <Field label={t({ ko: '개수', en: 'Count' })}><Input className="font-mono" type="number" step="1" min={1} max={50} value={count} onChange={(event) => setCount(event.target.value)} /></Field>
            <Field label="seed"><Input className="font-mono" inputMode="numeric" placeholder={t({ ko: '랜덤', en: 'Random' })} value={seed} onChange={(event) => setSeed(event.target.value)} /></Field>
          </div>
          {secondsMax !== null && Number(seconds) > secondsMax ? <p className="text-xs text-destructive">{t({ ko: '이 워크플로는 {max}초까지야.', en: 'This workflow allows up to {max} s.' }, { max: secondsMax })}</p> : null}
          <Field label={t({ ko: '서버', en: 'Server' })}>
            <Select value={route} onChange={(event) => setRoute(event.target.value)}>
              <option value="">{t({ ko: '자동', en: 'Auto' })}</option>
              {tags.map((tag) => <option key={`tag:${tag}`} value={`tag:${tag}`}>{t({ ko: '자동 · {tag}', en: 'Auto · {tag}' }, { tag })}</option>)}
              {(servers.data ?? []).filter((server) => server.backend_type !== 'modal').map((server) => <option key={server.id} value={`server:${server.id}`}>{server.name}</option>)}
            </Select>
          </Field>
        </ModalBody>
        <ModalFooter>
          <span className="flex-1" />
          <Button variant="ghost" onClick={onClose} disabled={busy}>{t({ ko: '취소', en: 'Cancel' })}</Button>
          <Button type="submit" disabled={busy || !valid}><Sparkles />{t({ ko: '{count}개 생성', en: 'Generate {count}' }, { count: Number.isInteger(countValue) ? countValue : 0 })}</Button>
        </ModalFooter>
      </form>
    </Modal>
  )
}

export type { AudioComment }
