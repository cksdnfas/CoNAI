import { useState } from 'react'
import { Eye, ImageDown, Plus, Trash2 } from 'lucide-react'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { Field } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Tip } from '@/components/ui/tooltip'
import { ChatProfileAvatar } from '@/features/codex-chat/chat-profile-avatar'
import { useI18n } from '@/i18n'
import type { ChatProfile } from '@/lib/api-codex-chat'
import { cn } from '@/lib/utils'
import { GROW_TEXTAREA, type Draft, type PatchDraft } from './chat-profile-editor-fields'
import { EditorGroup } from '@/components/ui/editor-group'
import { draftProfileAssetUrl } from './chat-profile-images'
import { ChatProfileMediaRow, useChatMediaLocalize, useLastTextarea } from './chat-profile-media'
import { ChatProfilePresetMenu } from './chat-profile-preset-menu'
import { ChatPromptSectionsEditor } from './chat-profile-sections'
import { CollapsibleRow } from '@/components/ui/collapsible-row'
import { ASSIST_FILLED_CLASS, useProfileAssist } from './use-profile-editor-chat-page'

/**
 * Who the profile is: name and tagline (the avatar is changed under Appearance), then the prompt: system prompt,
 * sections, greetings, the author's note and the images they show.
 */
export function ChatProfileCharacterPanel({ open, draft, patch, onPreview, profile, onOpenAppearance }: {
  open: boolean
  draft: Draft
  patch: PatchDraft
  onPreview: () => void
  profile: ChatProfile | null
  onOpenAppearance: () => void
}) {
  const { t } = useI18n()
  const { filled } = useProfileAssist()
  const confirm = useConfirm()
  const localize = useChatMediaLocalize(draft, patch)
  const lastTextarea = useLastTextarea()
  const [mediaOpen, setMediaOpen] = useState(false)

  const applySystemPromptPreset = async (content: string) => {
    if (draft.systemPrompt.trim() && draft.systemPrompt.trim() !== content.trim()) {
      const confirmed = await confirm({
        title: t({ ko: '시스템 프롬프트 바꾸기', en: 'Replace system prompt' }),
        description: t({ ko: '지금 시스템 프롬프트를 프리셋 내용으로 바꿀까?', en: 'Replace the current system prompt with the preset?' }),
        confirmLabel: t({ ko: '바꾸기', en: 'Replace' }),
      })
      if (!confirmed) return
    }
    patch({ systemPrompt: content })
  }

  const alternates = draft.alternateGreetings
  const greetingMeta = alternates.length > 0
    ? t({ ko: '추가 인사말 {count}개', en: '{count} alternates' }, { count: alternates.length })
    : draft.greeting.trim() ? null : t({ ko: '없음', en: 'none' })
  const updateAlternate = (index: number, text: string) => patch({ alternateGreetings: alternates.map((entry, i) => (i === index ? text : entry)) })

  return (
    <div className="space-y-4" onFocusCapture={lastTextarea.onFocusCapture}>
      <EditorGroup>
        <div className="flex items-center gap-4">
          <Tip content={t({ ko: '외형에서 바꾸기', en: 'Change under Appearance' })}>
            {/* eslint-disable-next-line no-restricted-syntax -- the avatar itself is the control; Button padding would crop it */}
            <button type="button" className="shrink-0 cursor-pointer rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40" onClick={onOpenAppearance} aria-label={t({ ko: '외형에서 바꾸기', en: 'Change under Appearance' })}>
              <ChatProfileAvatar name={draft.name || '?'} avatar={draft.avatar} imageUrl={draftProfileAssetUrl(draft, profile, 'avatar')} avatarCrop={draft.avatarHash ? draft.avatarCrop : null} engine={draft.engine} size="xl" />
            </button>
          </Tip>
          <div className="min-w-0 flex-1 space-y-2">
            <Input variant="settings" className={cn(filled('name') && ASSIST_FILLED_CLASS)} value={draft.name} maxLength={60} placeholder={t({ ko: '이름', en: 'Name' })} aria-label={t({ ko: '이름', en: 'Name' })} onChange={(event) => patch({ name: event.target.value })} />
            <Input variant="settings" className={cn(filled('tagline') && ASSIST_FILLED_CLASS)} value={draft.tagline} maxLength={200} placeholder={t({ ko: '짧은 소개', en: 'Tagline' })} aria-label={t({ ko: '짧은 소개', en: 'Tagline' })} onChange={(event) => patch({ tagline: event.target.value })} />
          </div>
        </div>
      </EditorGroup>

      <EditorGroup
        label={t({ ko: '프롬프트', en: 'Prompt' })}
        actions={(
          <div className="flex items-center gap-0.5">
            <ChatProfilePresetMenu
              open={open}
              onSystemPrompt={(preset) => void applySystemPromptPreset(preset.content)}
              onSection={(preset) => patch({ promptSections: [...draft.promptSections, { id: `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, title: preset.name, content: preset.content, kind: 'text', enabled: true }] })}
            />
            <IconButton size="icon-sm" variant="ghost" onClick={onPreview} label={t({ ko: '프롬프트 미리보기', en: 'Prompt preview' })}>
              <Eye />
            </IconButton>
            <IconButton size="icon-sm" variant="ghost" onClick={() => { localize.run(); setMediaOpen(true) }} disabled={localize.pending} label={t({ ko: '외부 이미지 저장', en: 'Save web images' })}>
              <ImageDown />
            </IconButton>
          </div>
        )}
      >
        <Field label={t({ ko: '시스템 프롬프트', en: 'System prompt' })}>
          <Textarea variant="settings" rows={5} className={cn(GROW_TEXTAREA, filled('systemPrompt') && ASSIST_FILLED_CLASS)} value={draft.systemPrompt} onChange={(event) => patch({ systemPrompt: event.target.value })} />
        </Field>
        <ChatPromptSectionsEditor sections={draft.promptSections} onChange={(promptSections) => patch({ promptSections })} />
        <div className="border-t border-line">
          <CollapsibleRow title={t({ ko: '첫 인사말', en: 'Greeting' })} meta={greetingMeta}>
            <Textarea variant="settings" rows={3} className={cn(GROW_TEXTAREA, filled('greeting') && ASSIST_FILLED_CLASS)} value={draft.greeting} onChange={(event) => patch({ greeting: event.target.value })} aria-label={t({ ko: '첫 인사말', en: 'Greeting' })} />
            {alternates.map((text, index) => (
              <div key={index} className="flex items-start gap-1">
                <Textarea
                  variant="settings"
                  rows={3}
                  className={cn('min-w-0 flex-1', GROW_TEXTAREA)}
                  value={text}
                  aria-label={t({ ko: '추가 인사말 {n}', en: 'Alternate greeting {n}' }, { n: index + 1 })}
                  onChange={(event) => updateAlternate(index, event.target.value)}
                />
                <IconButton size="icon-sm" variant="ghost" onClick={() => patch({ alternateGreetings: alternates.filter((_, i) => i !== index) })} label={t({ ko: '추가 인사말 삭제', en: 'Delete alternate greeting' })}>
                  <Trash2 />
                </IconButton>
              </div>
            ))}
            <IconButton variant="secondary" size="icon-sm" onClick={() => patch({ alternateGreetings: [...alternates, ''] })} label={t({ ko: '추가 인사말 넣기', en: 'Add an alternate greeting' })}>
              <Plus />
            </IconButton>
          </CollapsibleRow>
          <CollapsibleRow
            title={t({ ko: '작가 노트', en: "Author's note" })}
            info={t({ ko: '모든 채팅에 매 요청 들어가는 장면 지시. 대화 끝쪽에 들어가. 채팅마다 ⋯ → 컨텍스트에서 따로 쓰면 그쪽이 우선이야.', en: "A scene instruction added to every request in every chat, near the end of the conversation. A note written per chat under ⋯ → Context takes precedence." })}
            meta={draft.authorNote.trim() ? null : t({ ko: '없음', en: 'none' })}
          >
            <Textarea variant="settings" rows={3} className={cn(GROW_TEXTAREA, filled('authorNote') && ASSIST_FILLED_CLASS)} value={draft.authorNote} aria-label={t({ ko: '작가 노트', en: "Author's note" })} onChange={(event) => patch({ authorNote: event.target.value })} />
          </CollapsibleRow>
          <ChatProfileMediaRow draft={draft} patch={patch} localize={localize} lastTextarea={lastTextarea.ref} open={mediaOpen} onOpenChange={setMediaOpen} />
        </div>
      </EditorGroup>

    </div>
  )
}
