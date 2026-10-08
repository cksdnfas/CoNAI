import { ToggleChip } from '@/components/ui/chip'
import { useI18n } from '@/i18n'
import type { ChatProfile, ChatSharedBlock, ChatStyle } from '@/lib/api-codex-chat'
import { ChatCastEditor } from './chat-profile-cast'
import { EditorGroup, type Draft, type PatchDraft } from './chat-profile-editor-fields'
import { ChatEmoticonGroupPicker } from './chat-profile-emoticons'
import { ChatProfileLook } from './chat-profile-look'
import { CollapsibleRow } from './chat-profile-sections'

/**
 * How the profile's chats look: typeface, background and roleplay colours, then the folded extras (emoticon groups,
 * cast, display blocks). A fold starts open when it has content, so nothing set is hidden behind a click.
 */
export function ChatProfileLookPanel({ draft, patch, defaults, backgroundUrl, blocks, onBusyChange, busy, profile }: {
  draft: Draft
  patch: PatchDraft
  defaults: ChatStyle | undefined
  backgroundUrl: string | null
  /** The shared display blocks (settings › chat); undefined until they load. */
  blocks: ChatSharedBlock[] | undefined
  onBusyChange: (busy: boolean) => void
  busy: boolean
  profile: ChatProfile | null
}) {
  const { t } = useI18n()
  const { style } = draft
  const patchStyle = (next: Partial<ChatStyle>) => patch({ style: { ...style, ...next } })
  const count = (value: number, ko: string, en: string) => (value > 0 ? t({ ko, en }, { count: value }) : null)
  const linkedKeys = new Set((blocks ?? []).filter((shared) => draft.blockIds.includes(shared.id)).map((shared) => shared.block.key))

  return (
    <div className="space-y-4">
      <EditorGroup>
        <ChatProfileLook
          style={style}
          defaults={defaults}
          backgroundUrl={backgroundUrl}
          onStyleChange={(next) => patch({ style: next })}
          characterName={draft.name}
          hasBackground={Boolean(draft.backgroundHash || backgroundUrl)}
          onBackgroundHashChange={(backgroundHash) => patch({ backgroundHash, background: backgroundHash === (profile?.backgroundHash ?? draft.backgroundHash) ? undefined : null })}
          onBusyChange={onBusyChange}
          busy={busy}
          onBackgroundChange={(background) => patch({ background, backgroundHash: null })}
        />
      </EditorGroup>
      <div className="border-t border-line">
        <CollapsibleRow title={t({ ko: '이모티콘 그룹', en: 'Emoticon groups' })} meta={count(style.emoticonGroupIds.length, '{count}개', '{count}')} defaultOpen={style.emoticonGroupIds.length > 0}>
          <ChatEmoticonGroupPicker selected={style.emoticonGroupIds} onChange={(emoticonGroupIds) => patchStyle({ emoticonGroupIds })} />
        </CollapsibleRow>
        <CollapsibleRow title={t({ ko: '등장인물', en: 'Characters' })} meta={count(style.cast.length, '{count}명', '{count}')} defaultOpen={style.cast.length > 0}>
          <ChatCastEditor cast={style.cast} onChange={(cast) => patchStyle({ cast })} />
        </CollapsibleRow>
        {/* Shared blocks are made and edited in settings › chat; here the profile only links them, like lorebooks. */}
        <CollapsibleRow title={t({ ko: '표시 블록', en: 'Display blocks' })} meta={count(draft.blockIds.length, '{count}개', '{count}')} defaultOpen={draft.blockIds.length > 0}>
          <div className="flex flex-wrap gap-1.5">
            {(blocks ?? []).map((shared) => {
              const linked = draft.blockIds.includes(shared.id)
              // Two blocks with the same fence name cannot both show; the second stays unlinkable until the first is unlinked.
              const clash = !linked && linkedKeys.has(shared.block.key)
              return (
                <ToggleChip
                  key={shared.id}
                  pressed={linked}
                  disabled={clash}
                  title={clash ? t({ ko: '같은 이름({key})의 블록이 이미 연결돼 있어.', en: 'A block named {key} is already linked.' }, { key: shared.block.key }) : undefined}
                  onClick={() => patch({ blockIds: linked ? draft.blockIds.filter((id) => id !== shared.id) : [...draft.blockIds, shared.id] })}
                >
                  {shared.name}
                  <span className="font-mono opacity-60">{shared.block.key}</span>
                </ToggleChip>
              )
            })}
            {blocks && blocks.length === 0 ? <span className="text-sm text-muted-foreground">{t({ ko: '아직 없어.', en: 'None yet.' })}</span> : null}
          </div>
        </CollapsibleRow>
      </div>
    </div>
  )
}
