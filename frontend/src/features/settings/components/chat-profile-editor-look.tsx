import { useI18n } from '@/i18n'
import type { ChatStyle } from '@/lib/api-codex-chat'
import { ChatDisplayBlocksEditor } from './chat-profile-blocks'
import { ChatCastEditor } from './chat-profile-cast'
import { EditorGroup, type Draft, type PatchDraft } from './chat-profile-editor-fields'
import { ChatEmoticonGroupPicker } from './chat-profile-emoticons'
import { ChatProfileLook } from './chat-profile-look'
import { CollapsibleRow } from './chat-profile-sections'

/**
 * How the profile's chats look: typeface, background and roleplay colours, then the folded extras (emoticon groups,
 * cast, display blocks). A fold starts open when it has content, so nothing set is hidden behind a click.
 */
export function ChatProfileLookPanel({ draft, patch, defaults, backgroundUrl }: {
  draft: Draft
  patch: PatchDraft
  defaults: ChatStyle | undefined
  backgroundUrl: string | null
}) {
  const { t } = useI18n()
  const { style } = draft
  const patchStyle = (next: Partial<ChatStyle>) => patch({ style: { ...style, ...next } })
  const count = (value: number, ko: string, en: string) => (value > 0 ? t({ ko, en }, { count: value }) : null)

  return (
    <div className="space-y-4">
      <EditorGroup>
        <ChatProfileLook
          style={style}
          defaults={defaults}
          backgroundUrl={backgroundUrl}
          onStyleChange={(next) => patch({ style: next })}
          onBackgroundChange={(background) => patch({ background })}
        />
      </EditorGroup>
      <div className="border-t border-line">
        <CollapsibleRow title={t({ ko: '이모티콘 그룹', en: 'Emoticon groups' })} meta={count(style.emoticonGroupIds.length, '{count}개', '{count}')} defaultOpen={style.emoticonGroupIds.length > 0}>
          <ChatEmoticonGroupPicker selected={style.emoticonGroupIds} onChange={(emoticonGroupIds) => patchStyle({ emoticonGroupIds })} />
        </CollapsibleRow>
        <CollapsibleRow title={t({ ko: '등장인물', en: 'Characters' })} meta={count(style.cast.length, '{count}명', '{count}')} defaultOpen={style.cast.length > 0}>
          <ChatCastEditor cast={style.cast} onChange={(cast) => patchStyle({ cast })} />
        </CollapsibleRow>
        <CollapsibleRow title={t({ ko: '표시 블록', en: 'Display blocks' })} meta={count(style.blocks.length, '{count}개', '{count}')} defaultOpen={style.blocks.length > 0}>
          <ChatDisplayBlocksEditor blocks={style.blocks} characterName={draft.name} onChange={(blocks) => patchStyle({ blocks })} />
        </CollapsibleRow>
      </div>
    </div>
  )
}
