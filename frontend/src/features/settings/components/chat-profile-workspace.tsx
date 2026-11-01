import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FolderKanban } from 'lucide-react'
import { MAX_WORKSPACE_LINKS } from '@conai/shared'
import { Button } from '@/components/ui/button'
import { Chip, ChipAction } from '@/components/ui/chip'
import { EditorGroup } from '@/components/ui/editor-group'
import { WorkspaceProjectPicker } from '@/features/files/workspace-projects'
import { useI18n } from '@/i18n'
import { getWorkspace } from '@/lib/api-workspaces'
import { cn } from '@/lib/utils'

type ProfileWorkspaceLink = { id: string; write: boolean }

function ProjectChip({ link, onChange, onRemove }: { link: ProfileWorkspaceLink; onChange: (link: ProfileWorkspaceLink) => void; onRemove: () => void }) {
  const { t } = useI18n()
  const project = useQuery({ queryKey: ['workspaces', 'project', link.id], queryFn: () => getWorkspace(link.id), retry: false })
  const missing = project.isError
  return (
    <Chip tone={missing ? 'muted' : 'default'} removeLabel={t({ ko: '연결 해제', en: 'Unlink' })} onRemove={onRemove}>
      <FolderKanban className={cn('size-3.5', link.write ? 'text-primary' : 'text-muted-foreground')} aria-hidden />
      <span className={cn('max-w-48 truncate', missing && 'line-through')}>{project.data?.name ?? (missing ? t({ ko: '없는 작업 공간', en: 'Missing workspace' }) : '…')}</span>
      <ChipAction
        onClick={() => onChange({ ...link, write: !link.write })}
        aria-label={link.write ? t({ ko: '읽기 전용으로', en: 'Make read-only' }) : t({ ko: '쓰기 허용', en: 'Allow writing' })}
        aria-pressed={link.write}
      >
        {link.write ? t({ ko: '쓰기', en: 'Write' }) : t({ ko: '읽기', en: 'Read' })}
      </ChipAction>
    </Chip>
  )
}

/**
 * A profile's project workspaces: where it may read, and write where allowed, text files, in 1:1 and group chats and
 * board calls. A 1:1 or group chat can add more or turn one off for itself (chat context › 작업 공간); these are what
 * the profile starts from.
 */
export function ChatProfileWorkspace({ value, onChange }: { value: ProfileWorkspaceLink[]; onChange: (workspaces: ProfileWorkspaceLink[]) => void }) {
  const { t } = useI18n()
  const [picking, setPicking] = useState(false)
  const linked = new Set(value.map((link) => link.id))

  return (
    <EditorGroup
      label={t({ ko: '작업 공간', en: 'Workspaces' })}
      info={t({ ko: '캐릭터가 일할 폴더(프로젝트). 1:1·그룹 채팅과 게시판 호출에서 열려. 채팅에서는 더 추가하거나 끌 수 있어.', en: 'The project folders the character works in, in 1:1 and group chats and board calls. A chat can add more or turn one off.' })}
      actions={<Button variant="subtle" size="compact" disabled={value.length >= MAX_WORKSPACE_LINKS} onClick={() => setPicking(true)}><FolderKanban />{t({ ko: '작업 공간 연결', en: 'Connect a workspace' })}</Button>}
    >
      {value.length ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {value.map((link) => (
            <ProjectChip key={link.id} link={link} onChange={(next) => onChange(value.map((item) => item.id === link.id ? next : item))} onRemove={() => onChange(value.filter((item) => item.id !== link.id))} />
          ))}
        </div>
      ) : null}
      <WorkspaceProjectPicker
        open={picking}
        onClose={() => setPicking(false)}
        title={t({ ko: '작업 공간 연결', en: 'Connect a workspace' })}
        projectId={null}
        write={false}
        writeLabel={t({ ko: '쓰기 허용', en: 'Allow writing' })}
        noneLabel={null}
        exclude={linked}
        onConnect={(projectId, write) => { if (projectId) onChange([...value, { id: projectId, write }]); setPicking(false) }}
      />
    </EditorGroup>
  )
}
