import { useEffect, useState } from 'react'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { AudioLines } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Tip } from '@/components/ui/tooltip'
import { hasAuthPermission } from '@/features/auth/auth-permissions'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { useI18n } from '@/i18n'
import { AUDIO_QUERY_KEY, importAudioFromFileStore, listAudioGroupsPage, listAudioProjectsPage } from '@/lib/api-audio'
import { getErrorMessage } from '@/lib/error-message'

/** Copying from the file store into the audio workspace needs audio.edit; the server re-checks. */
export function useCanSendToAudio() {
  const auth = useAuthStatusQuery().data
  return !!auth?.authenticated && (auth.hasCredentials === false || hasAuthPermission(auth.permissionKeys, 'audio.edit'))
}

/** "오디오로 보내기": copy shared audio files into a project's 받은 파일 or a group. */
export function SendToAudioDialog({ files, onClose }: { files: Array<{ id: string; name: string }> | null; onClose: () => void }) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const open = files !== null && files.length > 0
  const projects = useInfiniteQuery({
    queryKey: [AUDIO_QUERY_KEY, 'projects'],
    queryFn: ({ pageParam, signal }) => listAudioProjectsPage({ cursor: pageParam }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: open,
  })
  const projectItems = projects.data?.pages.flatMap((page) => page.items) ?? []
  const [projectId, setProjectId] = useState('')
  const [groupId, setGroupId] = useState('')
  const [busy, setBusy] = useState(false)
  const groups = useInfiniteQuery({
    queryKey: [AUDIO_QUERY_KEY, 'groups', projectId, '', null],
    queryFn: ({ pageParam, signal }) => listAudioGroupsPage(projectId, { cursor: pageParam }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: open && Boolean(projectId),
  })
  const groupItems = groups.data?.pages.flatMap((page) => page.items) ?? []

  useEffect(() => {
    const items = projects.data?.pages.flatMap((page) => page.items) ?? []
    if (!open || !items.length) return
    setProjectId((current) => (items.some((project) => project.id === current) ? current : items[0].id))
  }, [open, projects.data])
  useEffect(() => { setGroupId('') }, [projectId])

  const send = async () => {
    if (!files || !projectId) return
    setBusy(true)
    let done = 0
    try {
      for (const file of files) {
        await importAudioFromFileStore(file.id, groupId ? { groupId } : { projectId })
        done += 1
      }
      showSnackbar({ message: t({ ko: '오디오로 {count}개 보냈어.', en: 'Sent {count} to Audio.' }, { count: done }) })
      void queryClient.invalidateQueries({ queryKey: [AUDIO_QUERY_KEY] })
      onClose()
    } catch (error) {
      showSnackbar({ message: `${done > 0 ? `${done}/${files.length} · ` : ''}${getErrorMessage(error, t({ ko: '보내지 못했어.', en: 'Could not send.' }))}`, tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} title={t({ ko: '오디오로 보내기', en: 'Send to Audio' })} onClose={() => { if (!busy) onClose() }} size="md">
      <ModalBody>
        <Field label={t({ ko: '프로젝트', en: 'Project' })}>
          <Select variant="settings" value={projectId} disabled={!projectItems.length} onChange={(event) => setProjectId(event.target.value)}>
            {!projectItems.length ? <option value="">—</option> : null}
            {projectItems.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </Select>
          {projects.hasNextPage ? <Button variant="ghost" size="sm" disabled={projects.isFetching} onClick={() => void projects.fetchNextPage()}>{t({ ko: '프로젝트 더 불러오기', en: 'Load more projects' })}</Button> : null}
        </Field>
        <Field label={t({ ko: '효과음', en: 'Effect' })}>
          <Select variant="settings" value={groupId} disabled={!projectId} onChange={(event) => setGroupId(event.target.value)}>
            <option value="">{t({ ko: '받은 파일', en: 'Inbox' })}</option>
            {groupItems.filter((group) => !group.is_inbox).map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
          </Select>
          {groups.hasNextPage ? <Button variant="ghost" size="sm" disabled={groups.isFetching} onClick={() => void groups.fetchNextPage()}>{t({ ko: '효과음 더 불러오기', en: 'Load more effects' })}</Button> : null}
        </Field>
      </ModalBody>
      <ModalFooter separated className="mt-4">
        <Tip content={projects.isSuccess && projectItems.length === 0 ? t({ ko: '오디오 탭에서 프로젝트를 먼저 만들어줘.', en: 'Create a project in the Audio tab first.' }) : null}>
          <span className="inline-flex" tabIndex={projects.isSuccess && projectItems.length === 0 ? 0 : undefined}>
            <Button disabled={busy || !projectId} onClick={() => void send()}><AudioLines />{t({ ko: '{count}개 보내기', en: 'Send {count}' }, { count: files?.length ?? 0 })}</Button>
          </span>
        </Tip>
      </ModalFooter>
    </Modal>
  )
}
