import { useState } from 'react'
import { bothSidesSpeak, splitExampleDialogue } from '@conai/shared'
import { Eye, ImageDown, Plus, Trash2 } from 'lucide-react'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { Field } from '@/components/ui/field'
import { AvatarButton } from '@/components/ui/avatar-button'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { Heading } from '@/components/ui/heading'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Text } from '@/components/ui/text'
import { Textarea } from '@/components/ui/textarea'
import { Tip } from '@/components/ui/tooltip'
import { ChatProfileAvatar } from '@/features/codex-chat/chat-profile-avatar'
import { useI18n } from '@/i18n'
import type { ChatProfile } from '@/lib/api-codex-chat'
import { type Draft, type PatchDraft } from './chat-profile-editor-fields'
import { EditorGroup } from '@/components/ui/editor-group'
import { draftProfileAssetUrl } from './chat-profile-images'
import { ChatProfileMediaRow, useChatMediaLocalize, useLastTextarea } from './chat-profile-media'
import { ChatProfilePresetMenu } from './chat-profile-preset-menu'
import { ChatPromptSectionsEditor, newPromptSectionId, RealConversationDivider } from './chat-profile-sections'
import { PromptCharacterBubble } from './chat-profile-dialogue'
import { CollapsibleRow } from '@/components/ui/collapsible-row'
import { useProfileAssist } from './use-profile-editor-chat-page'

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
  const [greetingOpen, setGreetingOpen] = useState(false)

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
  const updateAlternate = (index: number, text: string) => patch({ alternateGreetings: alternates.map((entry, i) => (i === index ? text : entry)) })
  const hasAlternates = alternates.some((text) => text.trim())
  // The server reads labels against the saved (trimmed) name.
  const name = draft.name.trim()
  const dialogue = draft.promptSections.filter((section) => section.kind === 'dialogue').map((section) => {
    const { turns } = splitExampleDialogue(section.content, name)
    const asTurns = draft.engine === 'llm' && bothSidesSpeak(turns)
    return { section, asTurns, history: draft.engine === 'llm' && section.asHistory === true && (!section.content.trim() || asTurns) }
  })
  const historyIds = new Set(dialogue.filter((entry) => entry.history).map((entry) => entry.section.id))
  const allHistory = dialogue.length > 0 && historyIds.size === dialogue.length
  const textExamples = dialogue.filter((entry) => entry.section.enabled && entry.section.content.trim() && !entry.asTurns)
  const avatar = <ChatProfileAvatar name={draft.name || '?'} avatar={draft.avatar} imageUrl={draftProfileAssetUrl(draft, profile, 'avatar')} avatarCrop={draft.avatarHash ? draft.avatarCrop : null} engine={draft.engine} size="sm" />
  const sectionsProps = { sections: draft.promptSections, onChange: (promptSections: Draft['promptSections']) => patch({ promptSections }), name, avatar, engine: draft.engine }

  return (
    <div className="space-y-4" onFocusCapture={lastTextarea.onFocusCapture}>
      <EditorGroup>
        <div className="flex items-center gap-4">
          <Tip content={t({ ko: '외형에서 바꾸기', en: 'Change under Appearance' })}>
            <AvatarButton onClick={onOpenAppearance} aria-label={t({ ko: '외형에서 바꾸기', en: 'Change under Appearance' })}>
              <ChatProfileAvatar name={draft.name || '?'} avatar={draft.avatar} imageUrl={draftProfileAssetUrl(draft, profile, 'avatar')} avatarCrop={draft.avatarHash ? draft.avatarCrop : null} engine={draft.engine} size="xl" />
            </AvatarButton>
          </Tip>
          <div className="min-w-0 flex-1 space-y-2">
            <Input variant="settings" assisted={filled('name')} value={draft.name} maxLength={60} placeholder={t({ ko: '이름', en: 'Name' })} aria-label={t({ ko: '이름', en: 'Name' })} onChange={(event) => patch({ name: event.target.value })} />
            <Input variant="settings" assisted={filled('tagline')} value={draft.tagline} maxLength={200} placeholder={t({ ko: '짧은 소개', en: 'Tagline' })} aria-label={t({ ko: '짧은 소개', en: 'Tagline' })} onChange={(event) => patch({ tagline: event.target.value })} />
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
              onSection={(preset) => patch({ promptSections: [...draft.promptSections, { id: newPromptSectionId(), title: preset.name, content: preset.content, kind: 'text', enabled: true }] })}
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
        <div className="space-y-3">
          <PromptZoneHeading number={1} title={t({ ko: '지시문', en: 'Instructions' })} caption={t({ ko: '시스템 메시지 하나로 합쳐서 맨 앞에 들어가', en: 'Combined into one system message at the very beginning' })} />
          <Field label={t({ ko: '시스템 프롬프트', en: 'System prompt' })}>
          <Textarea variant="settings" autoGrow assisted={filled('systemPrompt')} rows={5} value={draft.systemPrompt} onChange={(event) => patch({ systemPrompt: event.target.value })} />
          </Field>
          <ChatPromptSectionsEditor {...sectionsProps} kind="text">
            {textExamples.length > 0 ? <Text variant="caption">{t({ ko: '아래 대화 예시는 지시문 섹션들 바로 뒤에 글로 붙어: {titles}', en: 'These dialogue sections go as text right after the instruction sections: {titles}' }, { titles: textExamples.map((entry) => entry.section.title || t({ ko: '제목 없음', en: 'Untitled' })).join(', ') })}</Text> : null}
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <span>{t({ ko: '자동으로 같이 들어가는 안내:', en: 'Automatically included guidance:' })}</span>
              <Chip size="sm" tone="muted">{t({ ko: '답변 형식', en: 'Reply format' })}</Chip>
              {draft.mcpScopes.length > 0 || draft.generationPresetIds.length > 0 ? <Chip size="sm" tone="muted">{t({ ko: '도구 사용', en: 'Tool use' })}</Chip> : null}
              {draft.lorebookIds.length > 0 ? <Chip size="sm" tone="muted">{t({ ko: '로어북 목록', en: 'Lorebook list' })}</Chip> : null}
              {draft.summaryEnabled && draft.engine === 'llm' ? <Chip size="sm" tone="muted">{t({ ko: '대화 요약', en: 'Conversation summary' })}</Chip> : null}
              {dialogue.some((entry) => entry.section.enabled && entry.asTurns && !entry.history) ? <Chip size="sm" tone="muted">{t({ ko: '예시 안내문', en: 'Example notice' })}</Chip> : null}
            </div>
          </ChatPromptSectionsEditor>
        </div>

        {allHistory ? <RealConversationDivider /> : null}
        <div className="space-y-3 border-t border-line pt-4">
          <PromptZoneHeading number={2} title={t({ ko: '대화 예시', en: 'Example dialogue' })} caption={draft.engine !== 'llm'
            ? t({ ko: '이 엔진에서는 지시문 섹션들 바로 뒤에 글로 들어가', en: 'This engine sends examples as text right after the instruction sections' })
            : allHistory ? t({ ko: '미리 나눈 대화로 들어가', en: 'Sent as a conversation already held' })
              : t({ ko: '지시문 바로 뒤에 user/assistant 메시지로 들어가', en: 'Sent as user/assistant messages right after the instructions' })} />
          <ChatPromptSectionsEditor {...sectionsProps} kind="dialogue" historyIds={historyIds} />
        </div>
        {historyIds.size === 0 ? <RealConversationDivider /> : null}

        <div className="space-y-3 border-t border-line pt-4">
          <PromptZoneHeading number={3} title={t({ ko: '실제 대화', en: 'Actual conversation' })} caption={t({ ko: '채팅하면서 쌓이는 부분 · 여기서는 인사말과 작가 노트만 고쳐', en: 'Built up while chatting · edit the greeting and author’s note here' })} />
          {draft.greeting.trim() ? (
            <PromptCharacterBubble avatar={avatar} name={name} badge={<Badge variant="secondary" size="xs">{t({ ko: '첫 인사말', en: 'Greeting' })}</Badge>} onClick={() => setGreetingOpen(!greetingOpen)}>{draft.greeting}</PromptCharacterBubble>
          ) : <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span>{hasAlternates
            ? t({ ko: '첫 인사말은 비어 있어. 추가 인사말 중 하나가 첫 메시지가 돼.', en: 'The first greeting is empty; one of the alternates becomes the first message.' })
            : t({ ko: '첫 인사말이 아직 없어.', en: 'No first greeting yet.' })}</span><Button size="compact" variant="ghost" onClick={() => setGreetingOpen(true)}>{hasAlternates ? null : <Plus />}{hasAlternates ? t({ ko: '인사말 수정', en: 'Edit greetings' }) : t({ ko: '인사말 추가', en: 'Add greeting' })}</Button></div>}
          <p className="text-xs text-muted-foreground">{t({ ko: '새 채팅의 첫 메시지로 저장돼 · 추가 인사말 {count}개 · 눌러서 수정', en: 'Saved as the first message in a new chat · {count} alternates · click to edit' }, { count: alternates.length })}</p>
          {greetingOpen ? <div className="space-y-3">
            <Textarea variant="settings" autoGrow assisted={filled('greeting')} rows={3} value={draft.greeting} onChange={(event) => patch({ greeting: event.target.value })} aria-label={t({ ko: '첫 인사말', en: 'Greeting' })} />
            {alternates.map((text, index) => (
              <div key={index} className="flex items-start gap-1">
                <Textarea
                  variant="settings"
                  rows={3}
                  autoGrow
                  className="min-w-0 flex-1"
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
            <Button size="compact" variant="ghost" onClick={() => setGreetingOpen(false)}>{t({ ko: '완료', en: 'Done' })}</Button>
          </div> : null}
          <div className="rounded-sm border border-dashed border-line px-3 py-2 text-center text-xs text-muted-foreground">{t({ ko: '⋯ 채팅에서 주고받은 최근 대화', en: '⋯ Recent messages exchanged in chat' })}</div>
          <CollapsibleRow
            title={<span className="inline-flex flex-wrap items-center gap-2">{t({ ko: '작가 노트', en: "Author's note" })}<span className="text-xs font-normal text-muted-foreground">{draft.engine === 'llm'
              ? t({ ko: '대화 끝에서 {depth}턴 앞의 사용자 메시지에 붙어', en: 'Added to the user message {depth} turns before the end' }, { depth: draft.loreDepth ?? 4 })
              : t({ ko: '매 메시지와 함께 참고 설정으로 들어가', en: 'Included as reference settings with every message' })}</span></span>}
            info={t({ ko: '모든 채팅에 매 요청 들어가는 장면 지시. 대화 끝쪽에 들어가. 채팅마다 헤더의 컨텍스트에서 따로 쓰면 그쪽이 우선이야.', en: "A scene instruction added to every request in every chat, near the end of the conversation. A note written per chat under Context in the chat header takes precedence." })}
            meta={draft.authorNote.trim() ? null : t({ ko: '없음', en: 'none' })}
          >
            <Textarea variant="settings" autoGrow assisted={filled('authorNote')} rows={3} value={draft.authorNote} aria-label={t({ ko: '작가 노트', en: "Author's note" })} onChange={(event) => patch({ authorNote: event.target.value })} />
          </CollapsibleRow>
          <div className="flex justify-end"><span className="rounded-lg border border-dashed border-line px-3 py-2 text-xs text-muted-foreground">{t({ ko: '마지막 사용자 메시지', en: 'Last user message' })}</span></div>
        </div>
        <div className="space-y-3 border-t border-line pt-4">
          <PromptZoneHeading number={4} title={t({ ko: '대화 뒤 지시', en: 'Post-conversation instructions' })} caption={t({ ko: '마지막 사용자 메시지 끝에 붙어서 매번 가장 최근 지시로 읽혀', en: 'Appended to the last user message, read as the latest instructions each time' })} />
          <ChatPromptSectionsEditor {...sectionsProps} kind="post" />
        </div>
        <ChatProfileMediaRow draft={draft} patch={patch} localize={localize} lastTextarea={lastTextarea.ref} open={mediaOpen} onOpenChange={setMediaOpen} />
      </EditorGroup>

    </div>
  )
}

function PromptZoneHeading({ number, title, caption }: { number: number; title: string; caption: string }) {
  return <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1"><Badge size="xs" variant="outline">{number}</Badge><Heading level={3} as="h4">{title}</Heading><Text variant="caption">{caption}</Text></div>
}
