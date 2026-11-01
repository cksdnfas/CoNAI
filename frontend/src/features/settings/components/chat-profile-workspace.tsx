import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FolderKanban } from 'lucide-react'
import { Chip, ChipAction } from '@/components/ui/chip'
import { IconButton } from '@/components/ui/icon-button'
import { WorkspaceProjectPicker } from '@/features/files/workspace-projects'
import { useI18n } from '@/i18n'
import { getWorkspace } from '@/lib/api-workspaces'
import { cn } from '@/lib/utils'

/**
 * A profile's default project workspace: where it may read, and write where allowed, text files, in 1:1 and group
 * chats and board calls. A 1:1 or group chat can pick another project for itself (chat context › 작업 공간); this is
 * what the profile starts from.
 */
export function ChatProfileWorkspace({ value, onChange }: { value: { id: string; write: boolean } | null; onChange: (workspace: { id: string; write: boolean } | null) => void }) {
  const { t } = useI18n()
  const [picking, setPicking] = useState(false)
  const project = useQuery({ queryKey: ['workspaces', 'project', value?.id], queryFn: () => getWorkspace(value!.id), enabled: value !== null, retry: false })
  const missing = value !== null && project.isError

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value ? (
        <Chip tone={missing ? 'muted' : 'default'} removeLabel={t({ ko: '연결 해제', en: 'Unlink' })} onRemove={() => onChange(null)}>
          <FolderKanban className={cn('size-3.5', value.write ? 'text-primary' : 'text-muted-foreground')} aria-hidden />
          <span className={cn('max-w-48 truncate', missing && 'line-through')}>{project.data?.name ?? (missing ? t({ ko: '없는 작업 공간', en: 'Missing workspace' }) : '…')}</span>
          <ChipAction
            onClick={() => onChange({ ...value, write: !value.write })}
            aria-label={value.write ? t({ ko: '읽기 전용으로', en: 'Make read-only' }) : t({ ko: '쓰기 허용', en: 'Allow writing' })}
            aria-pressed={value.write}
          >
            {value.write ? t({ ko: '쓰기', en: 'Write' }) : t({ ko: '읽기', en: 'Read' })}
          </ChipAction>
        </Chip>
      ) : <span className="text-sm text-muted-foreground">{t({ ko: '연결 안 함', en: 'Not connected' })}</span>}
      <IconButton variant="ghost" size="icon-sm" onClick={() => setPicking(true)} label={t({ ko: '작업 공간 고르기', en: 'Choose a workspace' })}><FolderKanban /></IconButton>
      <WorkspaceProjectPicker
        open={picking}
        onClose={() => setPicking(false)}
        title={t({ ko: '기본 작업 공간', en: 'Default workspace' })}
        projectId={value?.id ?? null}
        write={value?.write ?? false}
        writeLabel={t({ ko: '쓰기 허용', en: 'Allow writing' })}
        onConnect={(projectId, write) => { onChange(projectId ? { id: projectId, write } : null); setPicking(false) }}
      />
    </div>
  )
}
