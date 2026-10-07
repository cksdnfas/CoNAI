import { useState } from 'react'
import { Crop, X } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { Textarea } from '@/components/ui/textarea'
import { ChatProfileAvatar } from '@/features/codex-chat/chat-profile-avatar'
import { ChatProfileImage } from '@/features/codex-chat/chat-profile-image'
import { useI18n } from '@/i18n'
import type { ChatProfile } from '@/lib/api-codex-chat'
import { ChatProfileAssetInput } from './chat-profile-asset-input'
import { ChatProfileAvatarCrop } from './chat-profile-avatar-crop'
import { EditorGroup, type Draft, type PatchDraft } from './chat-profile-editor-fields'
import { draftProfileAssetUrl } from './chat-profile-images'

/** Reference, avatar and appearance share the profile editor's unsaved draft. */
export function ChatProfileAppearancePanel({ draft, patch, profile, onBusyChange, busy }: {
  draft: Draft
  patch: PatchDraft
  profile: ChatProfile | null
  onBusyChange: (busy: boolean) => void
  busy: boolean
}) {
  const { t } = useI18n()
  const [cropOpen, setCropOpen] = useState(false)
  const referenceUrl = draftProfileAssetUrl(draft, profile, 'reference')
  const avatarUrl = draftProfileAssetUrl(draft, profile, 'avatar')
  return <div className="grid gap-6 sm:grid-cols-[220px_1fr]">
    <EditorGroup label={t({ ko: '기준 이미지', en: 'Reference image' })}>
      <div className="relative h-[300px] w-[220px] max-w-full overflow-hidden rounded-lg border border-dashed border-line">
        <ChatProfileImage src={referenceUrl} />
        {draft.referenceHash ? <IconButton size="icon-xs" variant="secondary" disabled={busy} className="absolute right-1.5 top-1.5" label={t({ ko: '기준 이미지 지우기', en: 'Remove reference image' })} onClick={() => patch({ referenceHash: null })}><X /></IconButton> : null}
      </div>
      <ChatProfileAssetInput characterName={draft.name} onChange={(referenceHash) => patch({ referenceHash })} onBusyChange={onBusyChange} busy={busy} />
    </EditorGroup>
    <div className="space-y-6">
      <EditorGroup label={t({ ko: '아바타', en: 'Avatar' })}>
        <div className="relative w-fit">
          <ChatProfileAvatar name={draft.name || '?'} avatar={draft.avatar} imageUrl={avatarUrl} avatarCrop={draft.avatarHash ? draft.avatarCrop : null} engine={draft.engine} className="size-[88px]" size="xl" />
          {draft.avatarHash || draft.avatar ? <IconButton size="icon-xs" variant="secondary" disabled={busy} className="absolute -right-1 top-0" label={t({ ko: '아바타 지우기', en: 'Remove avatar' })} onClick={() => patch({ avatar: null, avatarHash: null, avatarCrop: null })}><X /></IconButton> : null}
        </div>
        <div className="flex items-center gap-1">
          <IconButton size="icon-sm" variant="secondary" disabled={busy || !referenceUrl || !draft.referenceHash} label={t({ ko: '기준 이미지에서 자르기', en: 'Crop reference image' })} onClick={() => setCropOpen(true)}><Crop /></IconButton>
          <ChatProfileAssetInput characterName={draft.name} extraInputs={false} onChange={(avatarHash) => patch({ avatarHash, avatarCrop: null, avatar: avatarHash === (profile?.avatarHash ?? draft.avatarHash) ? profile?.avatar ?? draft.avatar : null })} onBusyChange={onBusyChange} busy={busy} />
        </div>
      </EditorGroup>
      <EditorGroup label={t({ ko: '외형 설명', en: 'Appearance' })}>
        <Textarea variant="settings" className="min-h-[120px]" rows={5} value={draft.appearance ?? ''} maxLength={20000} aria-label={t({ ko: '외형 설명', en: 'Appearance' })} onChange={(event) => patch({ appearance: event.target.value })} />
      </EditorGroup>
    </div>
    {cropOpen && referenceUrl ? <ChatProfileAvatarCrop src={referenceUrl} initial={draft.avatarHash === draft.referenceHash ? draft.avatarCrop : null} onClose={() => setCropOpen(false)} onApply={(avatarCrop) => { patch({ avatarHash: draft.referenceHash, avatarCrop, avatar: draft.referenceHash === (profile?.avatarHash ?? draft.avatarHash) ? profile?.avatar ?? draft.avatar : null }); setCropOpen(false) }} /> : null}
  </div>
}
