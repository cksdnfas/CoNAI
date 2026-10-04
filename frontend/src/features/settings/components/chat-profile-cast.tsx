import { useRef, type ChangeEvent } from 'react'
import { Plus, RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Tip } from '@/components/ui/tooltip'
import { ChatProfileAvatar } from '@/features/codex-chat/chat-profile-avatar'
import { useI18n } from '@/i18n'
import type { ChatCastMember } from '@/lib/api-codex-chat'
import { readAvatarFile } from './chat-profile-images'

const MAX_CAST = 8

function CastRow({ member, onChange, onDelete }: { member: ChatCastMember; onChange: (patch: Partial<ChatCastMember>) => void; onDelete: () => void }) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      onChange({ avatar: await readAvatarFile(file) })
    } catch {
      showSnackbar({ message: t({ ko: '이미지를 읽지 못했어.', en: 'Could not read the image.' }), tone: 'error' })
    }
  }

  return (
    <div className="flex min-h-12 items-center gap-2 border-t border-line py-1.5 first:border-t-0">
      <Tip content={t({ ko: '아바타 바꾸기', en: 'Change avatar' })}>
        {/* eslint-disable-next-line no-restricted-syntax -- the avatar itself is the control; Button padding would crop it */}
        <button type="button" className="shrink-0 cursor-pointer rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40" onClick={() => fileInputRef.current?.click()} aria-label={t({ ko: '아바타 바꾸기', en: 'Change avatar' })}>
          <ChatProfileAvatar name={member.name || '?'} avatar={member.avatar} engine="llm" size="md" />
        </button>
      </Tip>
      <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(event) => void handleFile(event)} />
      <Input
        variant="settings"
        className="min-w-0 flex-1"
        value={member.name}
        maxLength={40}
        placeholder={t({ ko: '이름', en: 'Name' })}
        aria-label={t({ ko: '이름', en: 'Name' })}
        onChange={(event) => onChange({ name: event.target.value.replace(/[[\]]/g, '') })}
      />
      <input
        type="color"
        aria-label={t({ ko: '이름 색', en: 'Name colour' })}
        value={member.color || '#ffffff'}
        onChange={(event) => onChange({ color: event.target.value })}
        className="h-9 w-12 shrink-0 cursor-pointer rounded-sm border border-line bg-transparent p-1"
      />
      {member.color ? (
        <IconButton size="icon-xs" variant="ghost" onClick={() => onChange({ color: '' })} label={t({ ko: '기본 색으로', en: 'Default colour' })}>
          <RotateCcw />
        </IconButton>
      ) : null}
      <IconButton size="icon-sm" variant="ghost" onClick={onDelete} label={t({ ko: '등장인물 삭제', en: 'Remove character' })}>
        <Trash2 />
      </IconButton>
    </div>
  )
}

/** Characters besides the profile itself; the model switches speaker with a `[Name]` line. */
export function ChatCastEditor({ cast, onChange }: { cast: ChatCastMember[]; onChange: (cast: ChatCastMember[]) => void }) {
  const { t } = useI18n()
  const update = (id: string, patch: Partial<ChatCastMember>) => onChange(cast.map((member) => (member.id === id ? { ...member, ...patch } : member)))

  return (
    <div className="space-y-2">
      {cast.length > 0 ? (
        <div>
          {cast.map((member) => (
            <CastRow key={member.id} member={member} onChange={(patch) => update(member.id, patch)} onDelete={() => onChange(cast.filter((entry) => entry.id !== member.id))} />
          ))}
        </div>
      ) : null}
      <Button
        variant="secondary"
        size="sm"
        disabled={cast.length >= MAX_CAST}
        onClick={() => onChange([...cast, { id: `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: '', avatar: null, color: '' }])}
      >
        <Plus />
        {t({ ko: '등장인물 추가', en: 'Add character' })}
      </Button>
    </div>
  )
}
