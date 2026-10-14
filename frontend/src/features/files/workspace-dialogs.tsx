import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { History, TriangleAlert } from 'lucide-react'
import type { WorkspaceBatchResult, WorkspaceProject } from '@conai/shared'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { ListRow } from '@/components/ui/list-row'
import { LoadingState } from '@/components/ui/loading-state'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { ResourceRowStatus } from '@/components/ui/resource-row'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import { createWorkspace, updateWorkspace, workspaceChanges } from '@/lib/api-workspaces'
import { ApiRequestError } from '@/lib/api-request'
import { getErrorMessage } from '@/lib/error-message'
import { parseServerDate } from '@/lib/server-time'

/**
 * A new project (`project` null) or an existing one's name and guidelines. The guidelines are what every connected
 * chat and plugin reads first; saving them is logged like any document change.
 */
export function WorkspaceProjectDialog({ open, project, canEdit, onClose, onSaved }: {
  open: boolean
  project: WorkspaceProject | null
  canEdit: boolean
  onClose: () => void
  onSaved: (project: WorkspaceProject) => void
}) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [guidelines, setGuidelines] = useState('')
  // The draft starts from the project once per opening. A refetch while it is open (another tab or a chat saved the
  // guidelines) must not replace what the person is typing; `base` is the version their draft started from.
  const [base, setBase] = useState<WorkspaceProject | null>(null)
  const [opened, setOpened] = useState(false)
  const [conflict, setConflict] = useState(false)
  if (open !== opened) {
    setOpened(open)
    if (open) {
      setName(project?.name ?? '')
      setGuidelines(project?.guidelines ?? '')
      setBase(project)
      setConflict(false)
    }
  }
  const dirty = base ? name !== base.name || guidelines !== base.guidelines : name.trim() !== '' || guidelines !== ''
  const save = useMutation({
    mutationFn: (revision?: number) => base
      ? updateWorkspace(base.id, { ...(name.trim() !== base.name ? { name: name.trim() } : {}), ...(guidelines !== base.guidelines ? { guidelines } : {}), revision: revision ?? base.revision })
      : createWorkspace(name.trim(), guidelines),
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: ['workspaces'] })
      onSaved(saved)
    },
    onError: (error) => {
      if (base && error instanceof ApiRequestError && error.status === 409) { setConflict(true); void queryClient.invalidateQueries({ queryKey: ['workspaces', base.id, 'info'] }); return }
      showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '프로젝트를 저장하지 못했어.', en: 'Could not save the project.' })) })
    },
  })
  /** The newer version replaces the draft. */
  const loadLatest = () => {
    if (!project) return
    setName(project.name)
    setGuidelines(project.guidelines)
    setBase(project)
    setConflict(false)
  }
  const canSave = canEdit && !save.isPending && name.trim() !== '' && (base === null || dirty)
  return (
    <Modal
      open={open}
      title={base ? base.name : t({ ko: '새 프로젝트', en: 'New project' })}
      onClose={() => { if (!save.isPending) onClose() }}
      widthClassName="max-w-2xl"
      dirty={canEdit && dirty}
      onSave={canSave ? () => save.mutate(undefined) : undefined}
    >
      <ModalBody className="space-y-4">
        {conflict ? (
          <Alert variant="warning">
            <TriangleAlert />
            <AlertDescription className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1">{t({ ko: '다른 곳에서 지침이 바뀌었어.', en: 'The guidelines were changed elsewhere.' })}</span>
              <Button size="sm" variant="secondary" disabled={!project || project.revision === base?.revision} onClick={loadLatest}>{t({ ko: '최신 지침 불러오기', en: 'Load latest' })}</Button>
              <Button size="sm" variant="secondary" disabled={!project || project.revision === base?.revision || save.isPending} onClick={() => save.mutate(project?.revision)}>{t({ ko: '내 내용으로 덮어쓰기', en: 'Overwrite with mine' })}</Button>
            </AlertDescription>
          </Alert>
        ) : null}
        <Field label={t({ ko: '이름', en: 'Name' })}>
          <Input variant="settings" autoFocus={base === null} readOnly={!canEdit} maxLength={100} value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label={t({ ko: '지침', en: 'Guidelines' })}>
          <Textarea variant="settings" rows={14} readOnly={!canEdit} maxLength={64000} value={guidelines} onChange={(event) => setGuidelines(event.target.value)} />
        </Field>
      </ModalBody>
      {canEdit ? (
        <ModalFooter>
          <span className="flex-1" />
          <Button disabled={!canSave} onClick={() => save.mutate(undefined)}>{base ? t({ ko: '저장', en: 'Save' }) : t({ ko: '만들기', en: 'Create' })}</Button>
        </ModalFooter>
      ) : null}
    </Modal>
  )
}

/** SQLite keeps UTC as "YYYY-MM-DD HH:MM:SS". */
/** The project's recent change batches (screen, chats and plugins alike): when, how many, which files, why one stopped. */
export function WorkspaceChangesDialog({ open, projectId, onClose }: { open: boolean; projectId: string; onClose: () => void }) {
  const { t, formatDateTime } = useI18n()
  const changes = useQuery({ queryKey: ['workspaces', projectId, 'changes'], queryFn: () => workspaceChanges(projectId), enabled: open })
  let body
  if (changes.isPending) body = <LoadingState />
  else if (changes.isError) body = <ErrorState error={changes.error} onRetry={() => void changes.refetch()} />
  else if (changes.data.length === 0) body = <EmptyState icon={History} title={t({ ko: '아직 변경 내역이 없어', en: 'No changes yet' })} />
  else body = (
    <div>
      {changes.data.map((change) => {
        const result = JSON.parse(change.result) as WorkspaceBatchResult
        const stopped = change.status !== 'completed' && change.status !== 'running'
        const targets = result.results.map((item) => (item.deleted ? t({ ko: '{name} 삭제', en: 'deleted {name}' }, { name: item.target }) : item.target))
        return (
          <ListRow key={change.requestId} size="lg" className="items-start">
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex flex-wrap items-center gap-2 text-sm font-semibold tabular-nums">
                {formatDateTime(parseServerDate(change.createdAt), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                <span className="font-normal text-muted-foreground">{t({ ko: '{count}개 반영', en: '{count} applied' }, { count: change.completed })}</span>
                {change.status === 'running' ? <ResourceRowStatus>{t({ ko: '진행 중', en: 'Running' })}</ResourceRowStatus> : null}
                {stopped ? <ResourceRowStatus tone="destructive">{change.status === 'interrupted' ? t({ ko: '중단', en: 'Interrupted' }) : t({ ko: '실패', en: 'Failed' })}</ResourceRowStatus> : null}
              </span>
              {targets.length ? <span className="truncate text-xs text-muted-foreground">{targets.join(', ')}{change.completed > targets.length ? ' …' : ''}</span> : null}
              {result.error ? <span className="text-xs text-destructive">{result.error}</span> : null}
            </span>
          </ListRow>
        )
      })}
    </div>
  )
  return (
    <Modal open={open} title={t({ ko: '변경 내역', en: 'Change history' })} onClose={onClose} widthClassName="max-w-xl">
      <ModalBody>{body}</ModalBody>
    </Modal>
  )
}
