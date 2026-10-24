import { useEffect, useRef, useState } from 'react'
import { bothSidesSpeak, splitExampleDialogue } from '@conai/shared'
import { ArrowDown, ArrowUp, Eye, EyeOff, ImageDown, Plus, Trash2 } from 'lucide-react'
import { SegmentedControl } from '@/components/common/segmented-control'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { AvatarButton } from '@/components/ui/avatar-button'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Text } from '@/components/ui/text'
import { Tip } from '@/components/ui/tooltip'
import { ChatProfileAvatar } from '@/features/codex-chat/chat-profile-avatar'
import { useI18n } from '@/i18n'
import type { ChatOpeningMessage, ChatProfile, ChatPromptSection } from '@/lib/api-codex-chat'
import { type Draft, type PatchDraft } from './chat-profile-editor-fields'
import { EditorGroup } from '@/components/ui/editor-group'
import { draftProfileAssetUrl } from './chat-profile-images'
import { ChatProfileMediaRow, useChatMediaLocalize, useLastTextarea } from './chat-profile-media'
import { ChatProfilePresetMenu } from './chat-profile-preset-menu'
import { newPromptSectionId, PromptAdder, PromptCard, PromptDivider } from './chat-profile-sections'
import { GreetingBadge, PromptBubble, PromptBubbleEditor } from './chat-profile-dialogue'
import { useProfileAssist } from './use-profile-editor-chat-page'

/** Server caps (chatProfiles.ts): opening messages per profile and the author's note length. */
const OPENING_HISTORY_MAX = 100
const AUTHOR_NOTE_MAX = 4000

/** What a card is: a prompt section's kind, or the author's note (one per profile, untitled). */
type CardKind = ChatPromptSection['kind'] | 'note'
/** The one item edited in place: a section by id, an opening message by index, or a single field. */
type OpenItem = 'system' | 'note' | 'greeting' | `section:${string}` | `turn:${number}`
/** A new chat's opening as shown: the history with the greeting at its position. */
type OpeningItem = { kind: 'turn'; index: number } | { kind: 'greeting' }

/** The greetings as the draft keeps them: the first, then the alternates. */
const greetingFields = (list: string[]): Pick<Draft, 'greeting' | 'alternateGreetings'> => ({ greeting: list[0] ?? '', alternateGreetings: list.slice(1) })

/** The history without message `index`; the greeting keeps its place among the rest. */
function withoutTurn(base: Pick<Draft, 'openingHistory' | 'greetingPosition'>, index: number): Pick<Draft, 'openingHistory' | 'greetingPosition'> {
  const position = Math.min(base.greetingPosition, base.openingHistory.length)
  return { openingHistory: base.openingHistory.filter((_, i) => i !== index), greetingPosition: index < position ? position - 1 : position }
}

/** `base` without item `key` when it was left empty, as saving would drop it. */
function dropEmpty(base: Draft, key: OpenItem): Partial<Draft> {
  if (key === 'greeting') {
    const list = [base.greeting, ...base.alternateGreetings]
    const kept = list.filter((text) => text.trim())
    return kept.length < list.length ? greetingFields(kept) : {}
  }
  if (key.startsWith('turn:')) {
    const index = Number(key.slice('turn:'.length))
    return base.openingHistory[index]?.content.trim() === '' ? withoutTurn(base, index) : {}
  }
  if (key.startsWith('section:')) {
    const section = base.promptSections.find((entry) => `section:${entry.id}` === key)
    return section && !section.title.trim() && !section.content.trim() ? { promptSections: base.promptSections.filter((entry) => entry !== section) } : {}
  }
  return {}
}

/** Delete, just before Done in an editor's footer. */
function RemoveButton({ label, onClick }: { label?: string; onClick: () => void }) {
  const { t } = useI18n()
  return <IconButton size="icon-sm" variant="destructive-ghost" onClick={onClick} label={label ?? t({ ko: '삭제', en: 'Delete' })}><Trash2 /></IconButton>
}

/** Off/on and order within its zone, in a section card's editor. */
function SectionTools({ enabled, first, last, onToggle, onMove }: {
  enabled: boolean
  first: boolean
  last: boolean
  onToggle: () => void
  onMove: (step: -1 | 1) => void
}) {
  const { t } = useI18n()
  return (
    <>
      <IconButton size="icon-sm" variant="ghost" onClick={onToggle} label={enabled ? t({ ko: '끄기', en: 'Turn off' }) : t({ ko: '켜기', en: 'Turn on' })}>{enabled ? <EyeOff /> : <Eye />}</IconButton>
      <IconButton size="icon-sm" variant="ghost" disabled={first} onClick={() => onMove(-1)} label={t({ ko: '위로', en: 'Move up' })}><ArrowUp /></IconButton>
      <IconButton size="icon-sm" variant="ghost" disabled={last} onClick={() => onMove(1)} label={t({ ko: '아래로', en: 'Move down' })}><ArrowDown /></IconButton>
    </>
  )
}

/**
 * Who the profile is: name and tagline (the avatar is changed under Appearance), then the prompt in the order the model
 * reads it: instruction cards (system prompt, sections, author's note, post-conversation instructions), example cards
 * kept as written, and as bubbles the conversation a new chat starts with (opening history around the greeting). Each
 * zone adds through its own +; one item is edited in place at a time.
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
  const [greetingCursor, setGreetingCursor] = useState(0)
  const [editing, setEditing] = useState<OpenItem | null>(null)
  /** A card just moved or added from a preset: scrolled into view and outlined for a moment; `n` repeats it for the same key. */
  const [flash, setFlash] = useState<{ key: string; n: number } | null>(null)
  const chatRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!flash) return
    chatRef.current?.querySelector(`[data-prompt-item="${CSS.escape(flash.key)}"]`)?.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    const timer = setTimeout(() => setFlash(null), 1600)
    return () => clearTimeout(timer)
  }, [flash])

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

  // The server reads speaker labels against the saved (trimmed) name.
  const name = draft.name.trim()
  const shownName = name || t({ ko: '캐릭터', en: 'Character' })
  const llm = draft.engine === 'llm'
  const sections = draft.promptSections
  const setSections = (promptSections: Draft['promptSections']) => patch({ promptSections })
  const updateSection = (id: string, change: Partial<ChatPromptSection>) => setSections(sections.map((section) => (section.id === id ? { ...section, ...change } : section)))
  /** Swaps a section with its neighbour in the same zone. */
  const moveSection = (zone: ChatPromptSection[], index: number, step: -1 | 1) => {
    const next = [...sections]
    const from = sections.indexOf(zone[index])
    const to = sections.indexOf(zone[index + step])
    ;[next[from], next[to]] = [next[to], next[from]]
    setSections(next)
  }
  const textSections = sections.filter((section) => section.kind === 'text')
  const postSections = sections.filter((section) => section.kind === 'post')
  const exampleSections = sections.filter((section) => section.kind === 'dialogue')
  // API LLMs get an example where both sides speak as messages, introduced by a notice.
  const examplesAsMessages = llm && exampleSections.some((section) => section.enabled && bothSidesSpeak(splitExampleDialogue(section.content, name).turns))
  const noteTaken = draft.authorNote.trim() !== ''
  const history = draft.openingHistory
  const greetings = [draft.greeting, ...draft.alternateGreetings]
  const hasGreeting = greetings.some((text) => text.trim())
  const greetingIndex = Math.min(greetingCursor, greetings.length - 1)
  const position = Math.min(draft.greetingPosition, history.length)
  const items = history.map((_, index): OpeningItem => ({ kind: 'turn', index }))
  if (hasGreeting || editing === 'greeting') items.splice(position, 0, { kind: 'greeting' })
  const greetingShown = items.length > history.length
  const reveal = (key: string) => setFlash((current) => ({ key, n: (current?.n ?? 0) + 1 }))
  const avatar = <ChatProfileAvatar name={draft.name || '?'} avatar={draft.avatar} imageUrl={draftProfileAssetUrl(draft, profile, 'avatar')} avatarCrop={draft.avatarHash ? draft.avatarCrop : null} engine={draft.engine} size="sm" />
  const emptyText = t({ ko: '비어 있어 · 눌러서 쓰기', en: 'Empty · click to write' })

  const meta: Record<ChatPromptSection['kind'], string | undefined> = {
    text: undefined,
    post: t({ ko: '매번 마지막 메시지 뒤에 붙어', en: 'Added after the last message every time' }),
    dialogue: llm ? t({ ko: '말투 참고용 · 실제 대화로는 안 들어가', en: 'For tone only · not part of the conversation' }) : t({ ko: '지시문 뒤에 글로 들어가', en: 'Sent as text after the instructions' }),
  }

  /**
   * Closes the item being edited (dropped when left empty) and opens `build(base).open`, or nothing. `base` is the draft
   * without the dropped item, so a change built on it (the item added to open) goes out in the same patch.
   */
  const edit = (build: (base: Draft) => { open: OpenItem | null; change?: Partial<Draft> }) => {
    const tidy = editing ? dropEmpty(draft, editing) : {}
    const next = build({ ...draft, ...tidy })
    const change = { ...tidy, ...next.change }
    if (Object.keys(change).length) patch(change)
    setEditing(next.open)
  }
  /** Opens `key`; a message after an emptied one that is dropped on closing moves up a place with it. */
  const openItem = (key: OpenItem | null) => edit((base) => {
    if (!key?.startsWith('turn:') || !editing?.startsWith('turn:') || base.openingHistory.length === history.length) return { open: key }
    const index = Number(key.slice('turn:'.length))
    return { open: index > Number(editing.slice('turn:'.length)) ? `turn:${index - 1}` : key }
  })
  const addSection = (kind: ChatPromptSection['kind']) => edit((base) => {
    const section: ChatPromptSection = { id: newPromptSectionId(), title: '', content: '', kind, enabled: true }
    return { open: `section:${section.id}`, change: { promptSections: [...base.promptSections, section] } }
  })
  const addTurn = (role: ChatOpeningMessage['role']) => edit((base) => ({ open: `turn:${base.openingHistory.length}`, change: { openingHistory: [...base.openingHistory, { role, content: '' }] } }))
  /** Another version of the greeting, or the first greeting, placed at the end of the opening. */
  const addGreeting = () => edit((base) => {
    const list = [base.greeting, ...base.alternateGreetings]
    const exists = list.some((text) => text.trim())
    setGreetingCursor(exists ? list.length : 0)
    return { open: 'greeting', change: exists ? greetingFields([...list, '']) : { ...greetingFields(['']), greetingPosition: base.openingHistory.length } }
  })

  /** A section changed to another kind goes to the end of that kind's zone, still open; the author's note takes its text. */
  const changeKind = (section: ChatPromptSection, kind: CardKind) => {
    const rest = sections.filter((entry) => entry !== section)
    if (kind === 'note') {
      patch({ authorNote: section.content, promptSections: rest })
      setEditing('note')
      reveal('author-note')
      return
    }
    setSections([...rest, { ...section, kind }])
    reveal(`section:${section.id}`)
  }
  const noteToSection = (kind: ChatPromptSection['kind']) => {
    const section: ChatPromptSection = { id: newPromptSectionId(), title: '', content: draft.authorNote, kind, enabled: true }
    patch({ authorNote: '', promptSections: [...sections, section] })
    setEditing(`section:${section.id}`)
    reveal(`section:${section.id}`)
  }
  /** The kind switch of a card; the author's note is offered while there is none and the text fits it. */
  const kindSwitch = (kind: CardKind, text: string, onChange: (kind: CardKind) => void) => (
    <SegmentedControl
      size="sm"
      value={kind}
      ariaLabel={t({ ko: '종류', en: 'Kind' })}
      onChange={(value) => { if (value !== kind) onChange(value as CardKind) }}
      items={[
        { value: 'text', label: t({ ko: '지시문', en: 'Instruction' }) },
        ...(kind === 'note' || !noteTaken ? [{ value: 'note', label: t({ ko: '작가 노트', en: "Author's note" }), disabled: kind !== 'note' && text.length > AUTHOR_NOTE_MAX }] : []),
        { value: 'post', label: t({ ko: '대화 뒤 지시', en: 'After the conversation' }) },
        { value: 'dialogue', label: t({ ko: '예시', en: 'Example' }) },
      ]}
    />
  )

  /** Moves message `index` one place; beside the greeting, the greeting moves past it instead. */
  const moveTurn = (index: number, step: -1 | 1) => {
    if (greetingShown && index === (step < 0 ? position : position - 1)) {
      patch({ greetingPosition: position - step })
      return
    }
    const next = [...history]
    ;[next[index], next[index + step]] = [next[index + step], next[index]]
    patch({ openingHistory: next })
    setEditing(`turn:${index + step}`)
  }
  const setTurn = (index: number, change: Partial<ChatOpeningMessage>) => patch({ openingHistory: history.map((entry, i) => (i === index ? { ...entry, ...change } : entry)) })
  /** Deletes the greeting shown; the next one moves up, and the greeting goes with the last. */
  const deleteGreeting = () => {
    const rest = greetings.filter((_, i) => i !== greetingIndex)
    patch(greetingFields(rest))
    setGreetingCursor(Math.max(0, greetingIndex - 1))
    if (!rest.some((text) => text.trim())) setEditing(null)
  }

  const sectionCard = (section: ChatPromptSection, index: number, zone: ChatPromptSection[]) => {
    const key: OpenItem = `section:${section.id}`
    const example = section.kind === 'dialogue'
    // How an API LLM reads an example: as messages only when both sides speak, without the text before the first speaker.
    const reading = example && llm && section.content.trim() ? splitExampleDialogue(section.content, name) : null
    return (
      <PromptCard
        key={section.id}
        itemKey={key}
        tone={example ? 'example' : 'instruction'}
        title={section.title || (example ? t({ ko: '대화 예시', en: 'Example dialogue' }) : section.kind === 'post' ? t({ ko: '대화 뒤 지시', en: 'After the conversation' }) : t({ ko: '제목 없음', en: 'Untitled' }))}
        meta={meta[section.kind]}
        text={section.content}
        placeholder={emptyText}
        editPlaceholder={example ? '{{user}}: …\n{{char}}: …' : undefined}
        titleField={{ value: section.title, onChange: (title) => updateSection(section.id, { title }) }}
        enabled={section.enabled}
        flash={flash?.key === key}
        editing={editing === key}
        onEditingChange={(next) => openItem(next ? key : null)}
        onTextChange={(content) => updateSection(section.id, { content })}
        note={reading && !bothSidesSpeak(reading.turns)
          ? <Text variant="caption" tone="warning">{t({ ko: '양쪽 말이 다 있어야 대화로 보내져. 지금은 지시문 뒤에 글로 붙어.', en: 'Both sides must speak to send this as dialogue. For now it goes as text after the instructions.' })}</Text>
          : reading?.leading ? <Text variant="caption">{t({ ko: '첫 화자 표시 앞의 글은 대화로 보낼 때 빠져.', en: 'Text before the first speaker is left out when sent as dialogue.' })}</Text> : undefined}
        kind={kindSwitch(section.kind, section.content, (kind) => changeKind(section, kind))}
        tools={(
          <SectionTools
            enabled={section.enabled}
            first={index === 0}
            last={index === zone.length - 1}
            onToggle={() => updateSection(section.id, { enabled: !section.enabled })}
            onMove={(step) => moveSection(zone, index, step)}
          />
        )}
        remove={<RemoveButton onClick={() => { setSections(sections.filter((entry) => entry !== section)); setEditing(null) }} />}
      />
    )
  }

  const turnItem = (index: number, first: boolean, last: boolean) => {
    const turn = history[index]
    const key: OpenItem = `turn:${index}`
    if (editing !== key) {
      return <PromptBubble key={key} itemKey={key} role={turn.role} avatar={avatar} name={shownName} onClick={() => openItem(key)}>{turn.content.trim() ? turn.content : emptyText}</PromptBubble>
    }
    return (
      <PromptBubbleEditor
        key={key}
        itemKey={key}
        role={turn.role}
        avatar={avatar}
        name={shownName}
        text={turn.content}
        label={t({ ko: '대화 내용', en: 'Message' })}
        placeholder={turn.role === 'user' ? t({ ko: '사용자가 할 말', en: 'What the user says' }) : t({ ko: '캐릭터가 할 말', en: 'What the character says' })}
        assisted={filled('openingHistory')}
        onTextChange={(content) => setTurn(index, { content })}
        onClose={() => openItem(null)}
        lead={(
          <SegmentedControl size="sm" value={turn.role} ariaLabel={t({ ko: '말한 사람', en: 'Speaker' })} onChange={(role) => setTurn(index, { role: role === 'user' ? 'user' : 'assistant' })} items={[
            { value: 'user', label: t({ ko: '사용자', en: 'User' }) },
            { value: 'assistant', label: t({ ko: '캐릭터', en: 'Character' }) },
          ]} />
        )}
        tools={(
          <>
            <IconButton size="icon-sm" variant="ghost" disabled={first} onClick={() => moveTurn(index, -1)} label={t({ ko: '위로', en: 'Move up' })}><ArrowUp /></IconButton>
            <IconButton size="icon-sm" variant="ghost" disabled={last} onClick={() => moveTurn(index, 1)} label={t({ ko: '아래로', en: 'Move down' })}><ArrowDown /></IconButton>
          </>
        )}
        remove={<RemoveButton onClick={() => { patch(withoutTurn(draft, index)); setEditing(null) }} />}
      />
    )
  }

  const greetingItem = (first: boolean, last: boolean) => {
    const text = greetings[greetingIndex] ?? ''
    const badge = <GreetingBadge index={greetingIndex} count={greetings.length} onIndexChange={setGreetingCursor} />
    if (editing !== 'greeting') {
      return <PromptBubble key="greeting" itemKey="greeting" role="assistant" avatar={avatar} name={shownName} badge={badge} onClick={() => openItem('greeting')}>{text.trim() ? text : emptyText}</PromptBubble>
    }
    return (
      <PromptBubbleEditor
        key="greeting"
        itemKey="greeting"
        role="assistant"
        avatar={avatar}
        name={shownName}
        badge={badge}
        text={text}
        label={t({ ko: '인사말', en: 'Greeting' })}
        placeholder={t({ ko: '새 채팅에서 캐릭터가 할 첫 말', en: 'The character’s first words in a new chat' })}
        assisted={filled('greeting') || filled('alternateGreetings')}
        onTextChange={(next) => patch(greetingFields(greetings.map((entry, i) => (i === greetingIndex ? next : entry))))}
        onClose={() => openItem(null)}
        lead={<Button variant="secondary" size="sm" disabled={!text.trim()} onClick={addGreeting}><Plus />{t({ ko: '다른 인사말', en: 'Another greeting' })}</Button>}
        tools={(
          <>
            <IconButton size="icon-sm" variant="ghost" disabled={first} onClick={() => patch({ greetingPosition: position - 1 })} label={t({ ko: '위로', en: 'Move up' })}><ArrowUp /></IconButton>
            <IconButton size="icon-sm" variant="ghost" disabled={last} onClick={() => patch({ greetingPosition: position + 1 })} label={t({ ko: '아래로', en: 'Move down' })}><ArrowDown /></IconButton>
          </>
        )}
        remove={<RemoveButton label={t({ ko: '이 인사말 삭제', en: 'Delete this greeting' })} onClick={deleteGreeting} />}
      />
    )
  }

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
              onSection={(preset) => {
                const id = newPromptSectionId()
                setSections([...sections, { id, title: preset.name, content: preset.content, kind: 'text', enabled: true }])
                reveal(`section:${id}`)
              }}
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
        <div ref={chatRef} className="flex flex-col gap-2.5">
          <PromptDivider label={t({ ko: '지시문', en: 'Instructions' })} />
          <PromptCard itemKey="system-prompt" title={t({ ko: '시스템 프롬프트', en: 'System prompt' })} text={draft.systemPrompt} placeholder={emptyText} assisted={filled('systemPrompt')} editing={editing === 'system'} onEditingChange={(next) => openItem(next ? 'system' : null)} onTextChange={(systemPrompt) => patch({ systemPrompt })} />
          {textSections.map((section, index) => sectionCard(section, index, textSections))}
          {noteTaken || editing === 'note' ? (
            <PromptCard
              itemKey="author-note"
              title={t({ ko: '작가 노트', en: "Author's note" })}
              meta={llm
                ? t({ ko: '끝에서 {depth}턴 앞에 끼워 넣어', en: 'Inserted {depth} turns before the end' }, { depth: draft.loreDepth ?? 4 })
                : t({ ko: '매 메시지와 함께 참고 설정으로 들어가', en: 'Sent as reference settings with every message' })}
              text={draft.authorNote}
              placeholder={emptyText}
              assisted={filled('authorNote')}
              flash={flash?.key === 'author-note'}
              editing={editing === 'note'}
              onEditingChange={(next) => openItem(next ? 'note' : null)}
              onTextChange={(authorNote) => patch({ authorNote })}
              note={editing === 'note' ? <Text variant="caption">{t({ ko: '모든 채팅에 매 요청 들어가는 장면 지시야. 채팅마다 헤더의 컨텍스트에서 따로 쓰면 그쪽이 우선이야.', en: 'A scene instruction added to every request in every chat. A note written per chat under Context in the chat header takes precedence.' })}</Text> : undefined}
              kind={kindSwitch('note', draft.authorNote, (kind) => { if (kind !== 'note') noteToSection(kind) })}
              remove={<RemoveButton onClick={() => { patch({ authorNote: '' }); setEditing(null) }} />}
            />
          ) : null}
          {postSections.map((section, index) => sectionCard(section, index, postSections))}
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span>{t({ ko: '자동 포함', en: 'Added automatically' })}</span>
            <Chip size="sm" tone="muted">{t({ ko: '답변 형식', en: 'Reply format' })}</Chip>
            {draft.mcpScopes.length > 0 || draft.generationPresetIds.length > 0 ? <Chip size="sm" tone="muted">{t({ ko: '도구 사용', en: 'Tool use' })}</Chip> : null}
            {draft.lorebookIds.length > 0 ? <Chip size="sm" tone="muted">{t({ ko: '로어북 목록', en: 'Lorebook list' })}</Chip> : null}
            {draft.summaryEnabled && llm ? <Chip size="sm" tone="muted">{t({ ko: '대화 요약', en: 'Conversation summary' })}</Chip> : null}
            {examplesAsMessages ? <Chip size="sm" tone="muted">{t({ ko: '예시 안내문', en: 'Example notice' })}</Chip> : null}
          </div>
          <PromptAdder
            label={t({ ko: '지시 추가', en: 'Add instruction' })}
            choices={[
              { value: 'text', label: t({ ko: '지시문', en: 'Instruction' }) },
              ...(noteTaken ? [] : [{ value: 'note', label: t({ ko: '작가 노트', en: "Author's note" }) }]),
              { value: 'post', label: t({ ko: '대화 뒤 지시', en: 'After the conversation' }) },
            ]}
            onAdd={(value) => (value === 'note' ? openItem('note') : addSection(value === 'post' ? 'post' : 'text'))}
          />

          <PromptDivider label={t({ ko: '예시', en: 'Examples' })} />
          {exampleSections.map((section, index) => sectionCard(section, index, exampleSections))}
          <PromptAdder label={t({ ko: '예시 추가', en: 'Add example' })} onAdd={() => addSection('dialogue')} />

          <PromptDivider strong label={t({ ko: '실제 대화 · 새 채팅이 이렇게 시작해', en: 'Conversation · how a new chat starts' })} />
          {items.map((item, index) => (item.kind === 'greeting'
            ? greetingItem(index === 0, index === items.length - 1)
            : turnItem(item.index, index === 0, index === items.length - 1)))}
          <PromptAdder
            label={t({ ko: '대화 추가', en: 'Add message' })}
            choices={[
              ...(history.length < OPENING_HISTORY_MAX ? [{ value: 'user', label: t({ ko: '사용자', en: 'User' }) }, { value: 'assistant', label: t({ ko: '캐릭터', en: 'Character' }) }] : []),
              { value: 'greeting', label: hasGreeting ? t({ ko: '다른 인사말', en: 'Another greeting' }) : t({ ko: '인사말', en: 'Greeting' }) },
            ]}
            onAdd={(value) => (value === 'greeting' ? addGreeting() : addTurn(value === 'user' ? 'user' : 'assistant'))}
          />
        </div>
        <ChatProfileMediaRow draft={draft} patch={patch} localize={localize} lastTextarea={lastTextarea.ref} open={mediaOpen} onOpenChange={setMediaOpen} />
      </EditorGroup>

    </div>
  )
}
