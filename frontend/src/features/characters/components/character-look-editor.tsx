import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CHARACTER_APPEARANCE_SECTION_KEYS, CHAT_PROFILE_TEXT_LIMITS, composeCharacterAppearance, joinPromptParts, tokenizePrompt } from '@conai/shared'
import { ArrowUpToLine, Copy, ExternalLink, ImageIcon, ListTree, Pencil, Plus, Sparkles, Trash2, UserSearch, Wand2 } from 'lucide-react'
import { NameDialog } from '@/components/common/entry-dialogs'
import { ActionMenuButton } from '@/components/ui/action-menu'
import { Button } from '@/components/ui/button'
import { Chip, ToggleChip } from '@/components/ui/chip'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { EditorGroup } from '@/components/ui/editor-group'
import { EmptyState } from '@/components/ui/empty-state'
import { FieldInfo } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/loading-state'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { useI18n } from '@/i18n'
import { draftCharacterAppearance, fillCharacterAppearance, type CharacterAppearanceFill, type CharacterAppearanceSections, type CharacterOutfit } from '@/lib/api-character-library'
import { copyTextToClipboard } from '@/lib/clipboard'
import { buildDanbooruTagUrl } from '@/lib/danbooru-tag-links'
import { getErrorMessage } from '@/lib/error-message'
import type { CharacterSettingEditorState } from '../use-character-setting-editor'
import { DanbooruCharacterPicker } from './danbooru-character-picker'
import { appendPromptPiece, movePromptPiece, promptPieceTexts, removePromptPiece } from '../character-prompt-pieces'

type SectionKey = (typeof CHARACTER_APPEARANCE_SECTION_KEYS)[number]

/** Section labels and hints, in editor order (the editor and the chat's proposal card). */
export function useSectionLabels() {
  const { t } = useI18n()
  const labels: Record<SectionKey, { label: string; hint?: string }> = {
    identity: { label: t({ ko: '정체성', en: 'Identity' }), hint: t({ ko: '캐릭터·작품 태그, 1girl 같은 인물 태그', en: 'Character and work tags, 1girl…' }) },
    hair: { label: t({ ko: '머리', en: 'Hair' }) },
    eyes: { label: t({ ko: '눈', en: 'Eyes' }) },
    face: { label: t({ ko: '얼굴·머리 장식 외', en: 'Face and head' }), hint: t({ ko: '얼굴 특징, 귀, 뿔', en: 'Facial features, ears, horns' }) },
    body: { label: t({ ko: '체형', en: 'Body' }) },
    skin: { label: t({ ko: '피부·표식', en: 'Skin and markings' }), hint: t({ ko: '피부색, 흉터, 문신', en: 'Skin colour, scars, tattoos' }) },
    traits: { label: t({ ko: '종족·특성', en: 'Species and traits' }), hint: t({ ko: '엘프, 수인, 로봇, 직업', en: 'Elf, kemonomimi, robot, role' }) },
    other: { label: t({ ko: '기타', en: 'Other' }), hint: t({ ko: '분류되지 않은 태그 (Danbooru 사전이 없으면 전부 여기)', en: 'Unsorted tags (all of them without the Danbooru dictionary)' }) },
  }
  return labels
}

const hasLook = (sections: CharacterAppearanceSections, outfits: CharacterOutfit[]) => CHARACTER_APPEARANCE_SECTION_KEYS.some((key) => sections[key].trim()) || outfits.some((outfit) => outfit.tags.trim())

/**
 * The look of a library setting in sections and outfits (first = default), with fills from a Danbooru character, the
 * reference image's auto tags, an AI draft (administrators) or a re-sort of the current tags, all unsaved. Copy takes
 * the composed text profiles and generation read.
 */
export function CharacterLookEditor({ editor, editable, generation, busy, onBusyChange, warning = null, note = null }: {
  editor: CharacterSettingEditorState
  editable: boolean
  generation: boolean
  busy: boolean
  onBusyChange: (busy: boolean) => void
  warning?: string | null
  note?: ReactNode
}) {
  const { t } = useI18n()
  const confirm = useConfirm()
  const { showSnackbar } = useSnackbar()
  const { canViewImages } = useImagePermissions()
  const labels = useSectionLabels()
  const { draft, base } = editor
  const [picking, setPicking] = useState(false)
  const [filling, setFilling] = useState(false)
  const [expanded, setExpanded] = useState<SectionKey[]>([])
  const dragged = useRef<{ key: SectionKey; index: number } | null>(null)
  const controller = useRef<AbortController | null>(null)
  const reportBusy = useRef(onBusyChange)
  reportBusy.current = onBusyChange
  useEffect(() => () => { if (controller.current) { controller.current.abort(); controller.current = null; reportBusy.current(false) } }, [])

  const setSection = (key: SectionKey, value: string) => editor.patch({ sections: { ...editor.draftRef.current.sections, [key]: value } })
  const setOutfits = (outfits: CharacterOutfit[]) => editor.patch({ outfits })
  const moveTag = (from: SectionKey, to: SectionKey, index: number) => {
    const current = editor.draftRef.current.sections
    const moved = movePromptPiece(current[from], current[to], index)
    editor.patch({ sections: { ...current, [from]: moved.source, [to]: moved.destination } })
  }

  /** Put a fill over the draft: sections replaced, outfit tags into the default outfit (made when there is none). */
  const applyFill = (fill: Omit<CharacterAppearanceFill, 'name'> & { name?: string | null }) => {
    const current = editor.draftRef.current
    const [first, ...rest] = current.outfits
    const outfits = !fill.outfitTags ? current.outfits : first ? [{ ...first, tags: fill.outfitTags }, ...rest] : [{ name: t({ ko: '기본', en: 'Default' }), tags: fill.outfitTags }]
    editor.patch({ sections: fill.sections, outfits, ...(fill.name && !current.name.trim() ? { name: fill.name } : {}) })
  }
  const run = async (fill: (signal: AbortSignal) => Promise<Omit<CharacterAppearanceFill, 'name'> & { name?: string | null }>, ask: boolean) => {
    if (ask && hasLook(editor.draftRef.current.sections, editor.draftRef.current.outfits) && !await confirm({
      title: t({ ko: '외형 태그 덮어쓰기', en: 'Replace appearance tags' }),
      description: t({ ko: '지금 항목별 태그를 새 결과로 바꾸고, 의상 태그는 기본 의상에 넣을까? 저장하기 전까지는 되돌릴 수 있어.', en: 'Replace the sections with the result and put outfit tags into the default outfit? Nothing is saved yet.' }),
      confirmLabel: t({ ko: '채우기', en: 'Fill' }),
    })) return
    controller.current = new AbortController()
    setFilling(true)
    reportBusy.current(true)
    try {
      applyFill(await fill(controller.current.signal))
    } catch (error) {
      if (!controller.current?.signal.aborted) showSnackbar({ message: getErrorMessage(error, t({ ko: '외형을 채우지 못했어.', en: 'Could not fill the appearance.' })), tone: 'error' })
    } finally {
      if (controller.current) { controller.current = null; reportBusy.current(false) }
      setFilling(false)
    }
  }
  // Re-sorting moves the sections' outfit tags into the default outfit, after what it already has.
  const resort = () => run(async (signal) => {
    const current = editor.draftRef.current
    const fill = await fillCharacterAppearance({ source: 'text', text: joinPromptParts(CHARACTER_APPEARANCE_SECTION_KEYS.map((key) => current.sections[key])) }, signal)
    return { ...fill, outfitTags: joinPromptParts([current.outfits[0]?.tags ?? '', fill.outfitTags]), name: null }
  }, false)

  const composed = composeCharacterAppearance(draft)
  // Profiles and workflows may wear any outfit, so the server checks every combination (the first too long, or -1).
  const tooLong = composed.length > CHAT_PROFILE_TEXT_LIMITS.text ? 0 : draft.outfits.findIndex((_, index) => index > 0 && composeCharacterAppearance(draft, index).length > CHAT_PROFILE_TEXT_LIMITS.text)
  const copy = async () => {
    try {
      await copyTextToClipboard(composed)
      showSnackbar({ message: t({ ko: '외형 태그를 복사했어.', en: 'Copied the appearance tags.' }), tone: 'info' })
    } catch (error) { showSnackbar({ message: getErrorMessage(error, t({ ko: '복사하지 못했어.', en: 'Could not copy.' })), tone: 'error' }) }
  }
  const firstIdentityTag = tokenizePrompt(draft.sections.identity).terms[0]?.value ?? ''
  const danbooruUrl = firstIdentityTag ? buildDanbooruTagUrl(firstIdentityTag) : null
  const nameBlocked = !draft.name.trim()

  return (
    <EditorGroup
      label={t({ ko: '합친 태그', en: 'Combined tags' })}
      info={t({ ko: '프로필과 이미지 생성이 읽는 값', en: 'What profiles and image generation read' })}
      actions={<>
        {filling ? <Spinner className="size-3.5" /> : null}
        {danbooruUrl ? <IconButton asChild variant="ghost" size="icon-sm" label={t({ ko: 'Danbooru에서 보기', en: 'Open on Danbooru' })}><a href={danbooruUrl} target="_blank" rel="noopener noreferrer"><ExternalLink /></a></IconButton> : null}
        <IconButton variant="ghost" size="icon-sm" label={t({ ko: '외형 태그 복사', en: 'Copy appearance tags' })} disabled={!composed} onClick={() => void copy()}><Copy /></IconButton>
        {editable ? (
          <ActionMenuButton
            icon={Wand2}
            label={t({ ko: '자동 채우기', en: 'Fill automatically' })}
            entries={[
              { key: 'danbooru', label: t({ ko: 'Danbooru 캐릭터에서', en: 'From a Danbooru character' }), icon: UserSearch, disabled: busy || filling, onSelect: () => setPicking(true) },
              { key: 'image', label: t({ ko: '기준 이미지 자동 태그에서', en: 'From the reference image tags' }), icon: ImageIcon, disabled: busy || filling || !canViewImages || !draft.referenceHash, onSelect: () => void run((signal) => fillCharacterAppearance({ source: 'image', imageHash: draft.referenceHash! }, signal), true) },
              generation ? { key: 'ai', label: nameBlocked ? t({ ko: 'AI 초안 (이름을 먼저 적어줘)', en: 'AI draft (enter a name first)' }) : t({ ko: 'AI 초안', en: 'AI draft' }), icon: Sparkles, disabled: busy || filling || nameBlocked, onSelect: () => void run((signal) => draftCharacterAppearance({ settingId: base?.id ?? null, name: draft.name.trim(), appearance: composed, referenceHash: draft.referenceHash }, signal), true) } : null,
              '-',
              { key: 'resort', label: t({ ko: '지금 태그 다시 분류', en: 'Re-sort the current tags' }), icon: ListTree, disabled: busy || filling || !composed, onSelect: () => void resort() },
            ]}
          />
        ) : null}
      </>}
    >
      <div className="rounded-md border border-line bg-background p-3 text-xs leading-relaxed break-words" aria-label={t({ ko: '합친 태그 미리보기', en: 'Combined tags preview' })}>
        {composed || t({ ko: '아래 항목에 태그를 넣어줘.', en: 'Add tags to the sections below.' })}
      </div>
      <div className="space-y-1">
        {CHARACTER_APPEARANCE_SECTION_KEYS.filter((key) => draft.sections[key].trim() || expanded.includes(key)).map((key) => (
          <div key={key} className="grid grid-cols-[5rem_minmax(0,1fr)] items-start gap-2 py-1"
            onDragOver={(event) => { if (editable && dragged.current) event.preventDefault() }}
            onDrop={(event) => {
              const source = dragged.current
              dragged.current = null
              if (!editable || filling || !source || source.key === key) return
              event.preventDefault()
              moveTag(source.key, key, source.index)
            }}>
            <span className="pt-1 text-xs text-muted-foreground">{labels[key].label}</span>
            <PromptChips value={draft.sections[key]} label={labels[key].label} editable={editable} disabled={filling}
              onChange={(value) => setSection(key, value)}
              moveTargets={CHARACTER_APPEARANCE_SECTION_KEYS.filter((target) => target !== key).map((target) => ({ key: target, label: labels[target].label }))}
              onMove={(index, target) => moveTag(key, target, index)}
              onDragStart={(index) => { dragged.current = { key, index } }}
              onDragEnd={() => { dragged.current = null }} />
          </div>
        ))}
        {CHARACTER_APPEARANCE_SECTION_KEYS.some((key) => !draft.sections[key].trim() && !expanded.includes(key)) ? (
          <div className="grid grid-cols-[5rem_minmax(0,1fr)] items-start gap-2 py-1">
            <span className="pt-1 text-xs text-muted-foreground">{t({ ko: '빈 항목', en: 'Empty sections' })}</span>
            <div className="flex flex-wrap gap-1">
              {CHARACTER_APPEARANCE_SECTION_KEYS.filter((key) => !draft.sections[key].trim() && !expanded.includes(key)).map((key) => (
                <Button key={key} size="compact" variant="ghost" disabled={!editable || filling}
                  onClick={() => setExpanded([...expanded, key])}
                  onDragOver={(event) => { if (editable && dragged.current) event.preventDefault() }}
                  onDrop={(event) => {
                    const source = dragged.current
                    dragged.current = null
                    if (!editable || filling || !source) return
                    event.preventDefault()
                    moveTag(source.key, key, source.index)
                  }}><Plus />{labels[key].label}</Button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <OutfitList outfits={draft.outfits} editable={editable} disabled={filling} onChange={setOutfits} />
      {tooLong >= 0 ? <p role="alert" className="text-xs text-destructive">{t({ ko: '항목과 \'{outfit}\' 의상을 합친 태그가 {limit}자를 넘어서 저장되지 않아.', en: 'Sections plus the “{outfit}” outfit exceed {limit} characters and cannot be saved.' }, { outfit: draft.outfits[tooLong]?.name ?? t({ ko: '기본', en: 'Default' }), limit: CHAT_PROFILE_TEXT_LIMITS.text })}</p> : null}
      {warning ? <p role="note" className="text-xs text-warning">{warning}</p> : null}
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
      {picking ? (
        <DanbooruCharacterPicker
          initialQuery={draft.name}
          onClose={() => setPicking(false)}
          onPick={(character) => { setPicking(false); void run((signal) => fillCharacterAppearance({ source: 'danbooru', character: character.name }, signal), true) }}
        />
      ) : null}
    </EditorGroup>
  )
}

function PromptChips({ value, label, editable, disabled, onChange, onDragStart, onDragEnd, moveTargets, onMove }: {
  value: string; label: string; editable: boolean; disabled: boolean; onChange: (value: string) => void
  onDragStart?: (index: number) => void; onDragEnd?: () => void
  moveTargets?: Array<{ key: SectionKey; label: string }>
  onMove?: (index: number, target: SectionKey) => void
}) {
  const { t } = useI18n()
  const [text, setText] = useState('')
  const tags = promptPieceTexts(value)
  const add = () => {
    if (!editable || disabled || !text.trim()) return
    onChange(appendPromptPiece(value, text))
    setText('')
  }
  return <div className="flex min-w-0 flex-wrap items-center gap-1.5">
    {tags.map((tag, index) => <Chip key={`${index}:${tag}`} draggable={editable && !disabled && Boolean(onDragStart)}
      onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', tag); onDragStart?.(index) }}
      onDragEnd={onDragEnd}
      onRemove={editable ? () => onChange(removePromptPiece(value, index)) : undefined}
      removeDisabled={disabled} removeLabel={t({ ko: '{tag} 빼기', en: 'Remove {tag}' }, { tag })}>
      <span className="truncate">{tag}</span>
      {editable && onMove ? <ActionMenuButton size="icon-xs" label={t({ ko: '{tag} 옮기기', en: 'Move {tag}' }, { tag })} entries={(moveTargets ?? []).map((target) => ({
        key: target.key, label: t({ ko: '{section}(으)로 옮기기', en: 'Move to {section}' }, { section: target.label }), disabled, onSelect: () => onMove(index, target.key),
      }))} /> : null}
    </Chip>)}
    {editable ? <Input variant="bare" controlSize="compact" className="w-28 min-w-20 flex-1" aria-label={t({ ko: '{section} 태그 추가', en: 'Add {section} tags' }, { section: label })}
      disabled={disabled} value={text} placeholder={t({ ko: '+ 태그', en: '+ tag' })} onChange={(event) => setText(event.target.value)}
      onBlur={add} onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); add() } }} /> : null}
  </div>
}

/** The look's outfits: name and tags each; the first is the default one profiles and generation use. */
function OutfitList({ outfits, editable, disabled, onChange }: { outfits: CharacterOutfit[]; editable: boolean; disabled: boolean; onChange: (outfits: CharacterOutfit[]) => void }) {
  const { t } = useI18n()
  const [selected, setSelected] = useState(0)
  const [renaming, setRenaming] = useState<string | null>(null)
  const index = Math.min(selected, Math.max(0, outfits.length - 1))
  const outfit = outfits[index]
  const update = (index: number, patch: Partial<CharacterOutfit>) => onChange(outfits.map((outfit, at) => (at === index ? { ...outfit, ...patch } : outfit)))
  return (
    <div className="space-y-3 border-t border-line pt-3">
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1 text-sm font-semibold">
          {t({ ko: '의상', en: 'Outfits' })}
          <FieldInfo>{t({ ko: '맨 위가 기본 의상이야. 옷·액세서리 태그는 의상에 두면 갈아입힐 수 있어.', en: 'The first one is the default. Keep clothing tags in outfits to switch them.' })}</FieldInfo>
        </span>
        {editable && outfit ? <ActionMenuButton className="ml-auto" label={t({ ko: '의상 작업', en: 'Outfit actions' })} entries={[
          { key: 'rename', label: t({ ko: '이름 바꾸기', en: 'Rename' }), icon: Pencil, disabled, onSelect: () => setRenaming(outfit.name) },
          { key: 'default', label: t({ ko: '기본 의상으로', en: 'Make default' }), icon: ArrowUpToLine, disabled: disabled || index === 0, onSelect: () => { onChange([outfit, ...outfits.filter((_, at) => at !== index)]); setSelected(0) } },
          { key: 'delete', label: t({ ko: '의상 지우기', en: 'Remove outfit' }), icon: Trash2, destructive: true, disabled, onSelect: () => { onChange(outfits.filter((_, at) => at !== index)); setSelected(Math.max(0, index - 1)) } },
        ]} /> : null}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {outfits.map((entry, at) => <ToggleChip key={at} pressed={at === index} onClick={() => setSelected(at)}>{entry.name}{at === 0 ? <span>{t({ ko: '기본', en: 'Default' })}</span> : null}</ToggleChip>)}
        {editable ? <IconButton size="icon-sm" variant="ghost" label={t({ ko: '의상 추가', en: 'Add outfit' })} disabled={disabled} onClick={() => { setSelected(outfits.length); onChange([...outfits, { name: t({ ko: '의상 {count}', en: 'Outfit {count}' }, { count: outfits.length + 1 }), tags: '' }]) }}><Plus /></IconButton> : null}
      </div>
      {outfit ? <PromptChips value={outfit.tags} label={outfit.name} editable={editable} disabled={disabled} onChange={(tags) => update(index, { tags })} /> : <EmptyState size="compact" title={t({ ko: '아직 의상이 없어', en: 'No outfits yet' })} />}
      {renaming !== null ? <NameDialog open title={t({ ko: '의상 이름 바꾸기', en: 'Rename outfit' })} value={renaming} onChange={setRenaming} onSubmit={() => { if (renaming.trim()) { update(index, { name: renaming.trim() }); setRenaming(null) } }} onClose={() => setRenaming(null)} /> : null}
    </div>
  )
}
