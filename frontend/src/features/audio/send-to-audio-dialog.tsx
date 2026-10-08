import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AudioLines } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { hasAuthPermission } from '@/features/auth/auth-permissions'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { useI18n } from '@/i18n'
import { AUDIO_QUERY_KEY, importAudioFromFileStore, listAudioGroups, listAudioProjects } from '@/lib/api-audio'
import { getErrorMessage } from '@/lib/error-message'

/** Copying from the file store into the audio workspace needs audio.edit; the server re-checks. */
export function useCanSendToAudio() {
  const auth = useAuthStatusQuery().data
  return !!auth?.authenticated && (auth.hasCredentials === false || hasAuthPermission(auth.permissionKeys, 'audio.edit'))
}

/** "오디오로 보내기": copy audio files from your file store into a project's 받은 파일 or a group. */
export function SendToAudioDialog({ files, onClose }: { files: Array<{ id: string; name: string }> | null; onClose: () => void }) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const open = files !== null && files.length > 0
  const projects = useQuery({ queryKey: [AUDIO_QUERY_KEY, 'projects'], queryFn: listAudioProjects, enabled: open })
  const [projectId, setProjectId] = useState('')
  const [groupId, setGroupId] = useState('')
  const [busy, setBusy] = useState(false)
  const groups = useQuery({ queryKey: [AUDIO_QUERY_KEY, 'groups', projectId, '', null], queryFn: () => listAudioGroups(projectId), enabled: open && Boolean(projectId) })

  useEffect(() => {
    if (!open || !projects.data?.length) return
    setProjectId((current) => (projects.data.some((project) => project.id === current) ? current : projects.data[0].id))
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
    <Modal open={open} title={t({ ko: '오디오로 보내기', en: 'Send to Audio' })} onClose={() => { if (!busy) onClose() }} widthClassName="max-w-md">
      <ModalBody className="space-y-4">
        <Field label={t({ ko: '프로젝트', en: 'Project' })}>
          <Select value={projectId} disabled={!projects.data?.length} onChange={(event) => setProjectId(event.target.value)}>
            {!projects.data?.length ? <option value="">—</option> : null}
            {(projects.data ?? []).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </Select>
        </Field>
        <Field label={t({ ko: '효과음', en: 'Effect' })}>
          <Select value={groupId} disabled={!projectId} onChange={(event) => setGroupId(event.target.value)}>
            <option value="">{t({ ko: '받은 파일', en: 'Inbox' })}</option>
            {(groups.data ?? []).filter((group) => !group.is_inbox).map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
          </Select>
        </Field>
        {projects.isSuccess && projects.data.length === 0 ? <p className="text-xs text-destructive">{t({ ko: '오디오 탭에서 프로젝트를 먼저 만들어줘.', en: 'Create a project in the Audio tab first.' })}</p> : null}
      </ModalBody>
      <ModalFooter>
        <span className="flex-1" />
        <Button disabled={busy || !projectId} onClick={() => void send()}><AudioLines />{t({ ko: '{count}개 보내기', en: 'Send {count}' }, { count: files?.length ?? 0 })}</Button>
      </ModalFooter>
    </Modal>
  )
}
