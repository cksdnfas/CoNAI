import { useEffect, useRef, useState } from 'react'
import { bothSidesSpeak, joinExampleDialogue, splitExampleDialogue } from '@conai/shared'
import { ArrowDown, ArrowUp, ChevronDown, Eye, EyeOff, ImageDown, Plus, Trash2 } from 'lucide-react'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { AvatarButton } from '@/components/ui/avatar-button'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Text } from '@/components/ui/text'
import { Tip } from '@/components/ui/tooltip'
import { ChatProfileAvatar } from '@/features/codex-chat/chat-profile-avatar'
import { useI18n } from '@/i18n'
import type { ChatProfile, ChatPromptSection } from '@/lib/api-codex-chat'
import { cn } from '@/lib/utils'
import { type Draft, type PatchDraft } from './chat-profile-editor-fields'
import { EditorGroup } from '@/components/ui/editor-group'
import { draftProfileAssetUrl } from './chat-profile-images'
import { ChatProfileMediaRow, useChatMediaLocalize, useLastTextarea } from './chat-profile-media'
import { ChatProfilePresetMenu } from './chat-profile-preset-menu'
import { newPromptSectionId, PromptCard, PromptDivider } from './chat-profile-sections'
import { PromptDialogueZone, PromptGreeting, type DialogueEntry } from './chat-profile-dialogue'
import { useProfileAssist } from './use-profile-editor-chat-page'

/** What the composer adds; the kind decides where it goes, in the order the model reads the prompt. */
type ComposeKind = 'text' | 'example-user' | 'example-assistant' | 'history-user' | 'history-assistant' | 'greeting' | 'note' | 'post'
type ItemTone = 'instruction' | 'example' | 'real'

const SWATCH: Record<ItemTone, string> = {
  instruction: 'bg-info-soft ring-1 ring-info/40',
  example: 'border border-dashed border-muted-foreground',
  real: 'bg-surface-highest',
}

/** The colour key of an item kind, as the prompt chat draws it. */
function Swatch({ tone }: { tone: ItemTone }) {
  return <span aria-hidden="true" className={cn('size-3 shrink-0 rounded-xs', SWATCH[tone])} />
}

/** Off/on, order within its zone, delete: floated over a section card on hover, in its footer while editing. */
function SectionTools({ enabled, first, last, onToggle, onMove, onRemove }: {
  enabled: boolean
  first: boolean
  last: boolean
  onToggle: () => void
  onMove: (step: -1 | 1) => void
  onRemove: () => void
}) {
  const { t } = useI18n()
  return (
    <>
      <IconButton size="icon-sm" variant="ghost" onClick={onToggle} label={enabled ? t({ ko: '끄기', en: 'Turn off' }) : t({ ko: '켜기', en: 'Turn on' })}>{enabled ? <EyeOff /> : <Eye />}</IconButton>
      <IconButton size="icon-sm" variant="ghost" disabled={first} onClick={() => onMove(-1)} label={t({ ko: '위로', en: 'Move up' })}><ArrowUp /></IconButton>
      <IconButton size="icon-sm" variant="ghost" disabled={last} onClick={() => onMove(1)} label={t({ ko: '아래로', en: 'Move down' })}><ArrowDown /></IconButton>
      <IconButton size="icon-sm" variant="destructive-ghost" onClick={onRemove} label={t({ ko: '삭제', en: 'Delete' })}><Trash2 /></IconButton>
    </>
  )
}

/**
 * Who the profile is: name and tagline (the avatar is changed under Appearance), then the prompt as one chat in the
 * order the model reads it: instructions, examples, the actual conversation (seeded history, greeting, author's note),
 * then the post-conversation instructions. The composer at the bottom adds an item of the chosen kind to its place.
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
  const [noteEditing, setNoteEditing] = useState(false)
  const [kind, setKind] = useState<ComposeKind>('example-assistant')
  const [composerText, setComposerText] = useState('')
  /** The item just added: scrolled into view and outlined for a moment; `n` repeats it for the same key. */
  const [flash, setFlash] = useState<{ key: string; n: number } | null>(null)
  const chatRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)

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

  const alternates = draft.alternateGreetings
  const greetings = [draft.greeting, ...alternates]
  const greetingIndex = Math.min(greetingCursor, greetings.length - 1)
  // The server reads labels against the saved (trimmed) name.
  const name = draft.name.trim()
  const shownName = name || t({ ko: '캐릭터', en: 'Character' })
  const llm = draft.engine === 'llm'
  const sections = draft.promptSections
  const setSections = (promptSections: Draft['promptSections']) => patch({ promptSections })
  const updateSection = (id: string, change: Partial<ChatPromptSection>) => setSections(sections.map((section) => (section.id === id ? { ...section, ...change } : section)))
  const removeSection = (id: string) => setSections(sections.filter((section) => section.id !== id))
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
  const dialogue: DialogueEntry[] = sections.filter((section) => section.kind === 'dialogue').map((section) => {
    const { turns, leading } = splitExampleDialogue(section.content, name)
    return { section, turns, leading, speaks: bothSidesSpeak(turns) }
  })
  // Seeded history exists only for API LLMs; other engines send every dialogue section as text after the instructions.
  const seeded = (entry: DialogueEntry) => llm && entry.section.asHistory === true
  const historyEntries = dialogue.filter(seeded)
  const exampleEntries = dialogue.filter((entry) => !seeded(entry))
  const noteExists = draft.authorNote.trim() !== ''
  const flashKey = flash?.key ?? null
  const reveal = (key: string) => setFlash((current) => ({ key, n: (current?.n ?? 0) + 1 }))
  const avatar = <ChatProfileAvatar name={draft.name || '?'} avatar={draft.avatar} imageUrl={draftProfileAssetUrl(draft, profile, 'avatar')} avatarCrop={draft.avatarHash ? draft.avatarCrop : null} engine={draft.engine} size="sm" />
  const zoneProps = { avatar, name: shownName, flashKey, onSectionChange: updateSection, onSectionRemove: removeSection }
  const emptyText = t({ ko: '비어 있어 · 눌러서 쓰기', en: 'Empty · click to write' })

  const sectionCard = (section: ChatPromptSection, index: number, zone: ChatPromptSection[]) => (
    <PromptCard
      key={section.id}
      itemKey={`section:${section.id}`}
      title={section.title || t({ ko: '제목 없음', en: 'Untitled' })}
      text={section.content}
      placeholder={emptyText}
      titleField={{ value: section.title, onChange: (title) => updateSection(section.id, { title }) }}
      enabled={section.enabled}
      flash={flashKey === `section:${section.id}`}
      onTextChange={(content) => updateSection(section.id, { content })}
      tools={<SectionTools enabled={section.enabled} first={index === 0} last={index === zone.length - 1} onToggle={() => updateSection(section.id, { enabled: !section.enabled })} onMove={(step) => moveSection(zone, index, step)} onRemove={() => removeSection(section.id)} />}
    />
  )

  /** A composer turn joins the last enabled group of its zone that already reads as dialogue, or starts a new one. */
  const appendTurn = (zone: DialogueEntry[], role: 'user' | 'assistant', text: string, asHistory: boolean) => {
    const target = zone.filter((entry) => entry.section.enabled && (entry.section.asHistory === true) === asHistory && (entry.turns.length > 0 || !entry.section.content.trim())).at(-1)
    if (target) {
      const content = joinExampleDialogue([...target.turns, { role, text }], target.leading)
      updateSection(target.section.id, { content })
      return `turn:${target.section.id}:${splitExampleDialogue(content, name).turns.length - 1}`
    }
    const section: ChatPromptSection = { id: newPromptSectionId(), title: '', content: joinExampleDialogue([{ role, text }]), kind: 'dialogue', enabled: true, ...(asHistory ? { asHistory: true } : {}) }
    setSections([...sections, section])
    return `turn:${section.id}:0`
  }

  const kinds: Record<ComposeKind, { label: string; where: string; tone: ItemTone }> = {
    text: { label: t({ ko: '지시문', en: 'Instruction' }), where: t({ ko: '맨 위 지시문 끝으로', en: 'To the end of the instructions at the top' }), tone: 'instruction' },
    'example-user': { label: t({ ko: '예시 · 사용자 말', en: 'Example · user' }), where: t({ ko: '예시 끝으로', en: 'To the end of the examples' }), tone: 'example' },
    'example-assistant': { label: t({ ko: '예시 · 캐릭터 말', en: 'Example · character' }), where: t({ ko: '예시 끝으로', en: 'To the end of the examples' }), tone: 'example' },
    'history-user': { label: t({ ko: '기록 · 사용자 말', en: 'History · user' }), where: t({ ko: '구분선 바로 아래 · 이미 나눈 대화로 보내', en: 'Right under the divider · sent as a conversation already held' }), tone: 'real' },
    'history-assistant': { label: t({ ko: '기록 · 캐릭터 말', en: 'History · character' }), where: t({ ko: '구분선 바로 아래 · 이미 나눈 대화로 보내', en: 'Right under the divider · sent as a conversation already held' }), tone: 'real' },
    greeting: { label: t({ ko: '인사말', en: 'Greeting' }), where: draft.greeting.trim() ? t({ ko: '첫 인사말 넘김(‹ ›)에 추가', en: 'Added to the greetings (‹ ›)' }) : t({ ko: '첫 인사말로', en: 'As the first greeting' }), tone: 'real' },
    note: { label: t({ ko: '작가 노트', en: "Author's note" }), where: noteExists ? t({ ko: '이미 있어 · 위에서 눌러 고쳐', en: 'Already there · click it above to edit' }) : t({ ko: '대화 끝쪽에 매번 들어가', en: 'Added near the end every time' }), tone: 'instruction' },
    post: { label: t({ ko: '대화 뒤 지시', en: 'Post-conversation instruction' }), where: t({ ko: '맨 아래로', en: 'To the very end' }), tone: 'instruction' },
  }
  const historyKind = kind === 'history-user' || kind === 'history-assistant'
  const blocked = (kind === 'note' && noteExists) || (historyKind && !llm)
  const placeholder = kind === 'note' && noteExists ? kinds.note.where
    : historyKind && !llm ? t({ ko: '이 엔진에서는 미리 넣은 기록을 쓸 수 없어', en: 'This engine has no seeded history' })
      : t({ ko: '{kind} 입력', en: 'Write: {kind}' }, { kind: kinds[kind].label })
  const kindItem = (value: ComposeKind) => (
    <DropdownMenuItem key={value} disabled={value === 'note' && noteExists} onSelect={() => setKind(value)}>
      <Swatch tone={kinds[value].tone} />
      <span className="flex min-w-0 flex-col">
        <span>{kinds[value].label}</span>
        <span className="text-xs text-muted-foreground">{kinds[value].where}</span>
      </span>
    </DropdownMenuItem>
  )

  const send = () => {
    const text = composerText.trim()
    if (!text || blocked) return
    let key: string
    if (kind === 'text' || kind === 'post') {
      const section: ChatPromptSection = { id: newPromptSectionId(), title: '', content: text, kind, enabled: true }
      setSections([...sections, section])
      key = `section:${section.id}`
    } else if (kind === 'example-user' || kind === 'example-assistant') {
      key = appendTurn(exampleEntries, kind === 'example-user' ? 'user' : 'assistant', text, false)
    } else if (historyKind) {
      key = appendTurn(historyEntries, kind === 'history-user' ? 'user' : 'assistant', text, true)
    } else if (kind === 'greeting') {
      if (draft.greeting.trim()) {
        patch({ alternateGreetings: [...alternates, text] })
        setGreetingCursor(alternates.length + 1)
      } else {
        patch({ greeting: text })
        setGreetingCursor(0)
      }
      key = 'greeting'
    } else {
      patch({ authorNote: text })
      key = 'author-note'
    }
    setComposerText('')
    reveal(key)
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
          <PromptCard itemKey="system-prompt" title={t({ ko: '시스템 프롬프트', en: 'System prompt' })} text={draft.systemPrompt} placeholder={emptyText} assisted={filled('systemPrompt')} onTextChange={(systemPrompt) => patch({ systemPrompt })} />
          {textSections.map((section, index) => sectionCard(section, index, textSections))}
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span>{t({ ko: '자동 포함', en: 'Added automatically' })}</span>
            <Chip size="sm" tone="muted">{t({ ko: '답변 형식', en: 'Reply format' })}</Chip>
            {draft.mcpScopes.length > 0 || draft.generationPresetIds.length > 0 ? <Chip size="sm" tone="muted">{t({ ko: '도구 사용', en: 'Tool use' })}</Chip> : null}
            {draft.lorebookIds.length > 0 ? <Chip size="sm" tone="muted">{t({ ko: '로어북 목록', en: 'Lorebook list' })}</Chip> : null}
            {draft.summaryEnabled && llm ? <Chip size="sm" tone="muted">{t({ ko: '대화 요약', en: 'Conversation summary' })}</Chip> : null}
            {llm && exampleEntries.some((entry) => entry.section.enabled && entry.speaks) ? <Chip size="sm" tone="muted">{t({ ko: '예시 안내문', en: 'Example notice' })}</Chip> : null}
          </div>

          {exampleEntries.length > 0 ? (
            <>
              <PromptDivider label={t({ ko: '예시', en: 'Examples' })} />
              {llm ? null : <Text variant="caption">{t({ ko: '이 엔진은 예시를 지시문 뒤에 글로 보내.', en: 'This engine sends the examples as text after the instructions.' })}</Text>}
              <PromptDialogueZone {...zoneProps} entries={exampleEntries} look="example" turnsAsMessages={llm} />
            </>
          ) : null}

          <PromptDivider strong label={t({ ko: '여기부터 실제 대화', en: 'Actual conversation starts here' })} />
          <PromptDialogueZone {...zoneProps} entries={historyEntries} look="real" turnsAsMessages badge={<Badge variant="secondary" size="xs">{t({ ko: '미리 넣은 기록', en: 'Seeded history' })}</Badge>} />
          <PromptGreeting
            greetings={greetings}
            index={greetingIndex}
            onIndexChange={setGreetingCursor}
            onTextChange={(index, text) => (index === 0 ? patch({ greeting: text }) : patch({ alternateGreetings: alternates.map((entry, i) => (i === index - 1 ? text : entry)) }))}
            onDelete={(index) => {
              if (index === 0) patch({ greeting: alternates[0] ?? '', alternateGreetings: alternates.slice(1) })
              else patch({ alternateGreetings: alternates.filter((_, i) => i !== index - 1) })
              setGreetingCursor(Math.max(0, index - 1))
            }}
            avatar={avatar}
            name={shownName}
            assisted={filled('greeting') || filled('alternateGreetings')}
            flash={flashKey === 'greeting'}
          />
          <div className="rounded-sm border border-dashed border-line px-3 py-2 text-center text-xs text-muted-foreground">{t({ ko: '⋯ 채팅하면서 쌓이는 대화', en: '⋯ Messages built up while chatting' })}</div>
          {noteExists || noteEditing ? (
            <PromptCard
              itemKey="author-note"
              title={t({ ko: '작가 노트', en: "Author's note" })}
              meta={llm
                ? t({ ko: '끝에서 {depth}턴 앞에 들어가', en: '{depth} turns before the end' }, { depth: draft.loreDepth ?? 4 })
                : t({ ko: '매 메시지와 함께 참고 설정으로 들어가', en: 'Sent as reference settings with every message' })}
              text={draft.authorNote}
              placeholder={emptyText}
              assisted={filled('authorNote')}
              flash={flashKey === 'author-note'}
              editing={noteEditing}
              onEditingChange={setNoteEditing}
              onTextChange={(authorNote) => patch({ authorNote })}
              note={noteEditing ? <Text variant="caption">{t({ ko: '모든 채팅에 매 요청 들어가는 장면 지시야. 채팅마다 헤더의 컨텍스트에서 따로 쓰면 그쪽이 우선이야.', en: 'A scene instruction added to every request in every chat. A note written per chat under Context in the chat header takes precedence.' })}</Text> : undefined}
              tools={<IconButton size="icon-sm" variant="destructive-ghost" onClick={() => { patch({ authorNote: '' }); setNoteEditing(false) }} label={t({ ko: '삭제', en: 'Delete' })}><Trash2 /></IconButton>}
            />
          ) : null}
          <div className="flex justify-end"><span className="rounded-lg border border-dashed border-line px-3 py-2 text-xs text-muted-foreground">{t({ ko: '마지막 사용자 메시지', en: 'Last user message' })}</span></div>

          {postSections.length > 0 ? (
            <>
              <PromptDivider label={t({ ko: '대화 뒤 지시', en: 'After the conversation' })} />
              {postSections.map((section, index) => sectionCard(section, index, postSections))}
            </>
          ) : null}
        </div>

        <div className="flex items-end gap-2 rounded-lg border border-line p-2 focus-within:border-primary/55">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="subtle" size="sm" aria-label={t({ ko: '넣을 종류: {kind}', en: 'Kind to add: {kind}' }, { kind: kinds[kind].label })}>
                <Plus />
                <Swatch tone={kinds[kind].tone} />
                <span className="max-sm:hidden">{kinds[kind].label}</span>
                <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top" className="w-72">
              <DropdownMenuLabel>{t({ ko: '지시', en: 'Instructions' })}</DropdownMenuLabel>
              {kindItem('text')}
              <DropdownMenuLabel>{t({ ko: '예시', en: 'Examples' })}</DropdownMenuLabel>
              {kindItem('example-user')}
              {kindItem('example-assistant')}
              <DropdownMenuLabel>{t({ ko: '실제 대화', en: 'Actual conversation' })}</DropdownMenuLabel>
              {llm ? kindItem('history-user') : null}
              {llm ? kindItem('history-assistant') : null}
              {kindItem('greeting')}
              {kindItem('note')}
              <DropdownMenuLabel>{t({ ko: '대화 뒤', en: 'After the conversation' })}</DropdownMenuLabel>
              {kindItem('post')}
            </DropdownMenuContent>
          </DropdownMenu>
          <textarea
            ref={composerRef}
            rows={1}
            value={composerText}
            placeholder={placeholder}
            aria-label={t({ ko: '넣을 내용', en: 'Content to add' })}
            onChange={(event) => setComposerText(event.target.value)}
            onKeyDown={(event) => {
              // Enter adds; Shift+Enter breaks the line. Ignore Enter that commits an IME (Korean) composition.
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                send()
              }
            }}
            className="block max-h-40 min-h-0 min-w-0 flex-1 resize-none bg-transparent py-1.5 text-sm text-foreground caret-foreground outline-none field-sizing-content placeholder:text-muted-foreground"
          />
          <IconButton variant="default" size="icon-sm" onClick={() => { send(); composerRef.current?.focus() }} disabled={!composerText.trim() || blocked} label={t({ ko: '넣기', en: 'Add' })}>
            <ArrowUp />
          </IconButton>
        </div>
        <ChatProfileMediaRow draft={draft} patch={patch} localize={localize} lastTextarea={lastTextarea.ref} open={mediaOpen} onOpenChange={setMediaOpen} />
      </EditorGroup>

    </div>
  )
}
