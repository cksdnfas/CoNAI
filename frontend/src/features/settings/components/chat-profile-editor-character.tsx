import { useRef, type ChangeEvent } from 'react'
import { Eye, ImageDown, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ToggleChip } from '@/components/ui/chip'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { Field } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Tip } from '@/components/ui/tooltip'
import { ChatProfileAvatar } from '@/features/codex-chat/chat-profile-avatar'
import { useI18n } from '@/i18n'
import type { ChatLorebook } from '@/lib/api-codex-chat'
import { EditorGroup, type Draft, type PatchDraft } from './chat-profile-editor-fields'
import { readAvatarFile } from './chat-profile-images'
import { ChatProfilePresetMenu } from './chat-profile-preset-menu'
import { ChatPromptSectionsEditor, CollapsibleRow } from './chat-profile-sections'

/** Who the profile is: avatar, name, the prompt (system prompt, sections, greetings) and the lorebooks it reads. */
export function ChatProfileCharacterPanel({ open, draft, patch, lorebooks, localizing, onLocalizeImages, onPreview }: {
  open: boolean
  draft: Draft
  patch: PatchDraft
  /** The shared lorebooks; undefined until they load. */
  lorebooks: ChatLorebook[] | undefined
  localizing: boolean
  onLocalizeImages: () => void
  onPreview: () => void
}) {
  const { t } = useI18n()
  const confirm = useConfirm()
  const { showSnackbar } = useSnackbar()
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const handleAvatarFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      patch({ avatar: await readAvatarFile(file) })
    } catch {
      showSnackbar({ message: t({ ko: '이미지를 읽지 못했어.', en: 'Could not read the image.' }), tone: 'error' })
    }
  }

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
    <div className="space-y-4">
      <EditorGroup>
        <div className="flex items-center gap-4">
          <Tip content={t({ ko: '아바타 바꾸기', en: 'Change avatar' })}>
            {/* eslint-disable-next-line no-restricted-syntax -- the avatar itself is the control; Button padding would crop it */}
            <button type="button" className="shrink-0 cursor-pointer rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40" onClick={() => fileInputRef.current?.click()} aria-label={t({ ko: '아바타 바꾸기', en: 'Change avatar' })}>
              <ChatProfileAvatar name={draft.name || '?'} avatar={draft.avatar} engine={draft.engine} size="xl" />
            </button>
          </Tip>
          <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(event) => void handleAvatarFile(event)} />
          <Field label={t({ ko: '이름', en: 'Name' })} className="min-w-0 flex-1">
            <Input variant="settings" value={draft.name} maxLength={60} onChange={(event) => patch({ name: event.target.value })} />
          </Field>
          <div className="flex h-10 items-center self-end">
            <Switch checked={draft.isEnabled} onCheckedChange={(isEnabled) => patch({ isEnabled })} aria-label={t({ ko: '사용', en: 'On' })} />
          </div>
        </div>
        {draft.avatar ? (
          <Button variant="link" size="xs" className="px-0 text-muted-foreground" onClick={() => patch({ avatar: null })}>{t({ ko: '아바타 지우기', en: 'Remove avatar' })}</Button>
        ) : null}
        <Field label={t({ ko: '짧은 소개', en: 'Tagline' })}>
          <Input variant="settings" value={draft.tagline} maxLength={200} onChange={(event) => patch({ tagline: event.target.value })} />
        </Field>
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
            <IconButton size="icon-sm" variant="ghost" onClick={onLocalizeImages} disabled={localizing} label={t({ ko: '외부 이미지 저장', en: 'Save web images' })}>
              <ImageDown />
            </IconButton>
          </div>
        )}
      >
        <Field label={t({ ko: '시스템 프롬프트', en: 'System prompt' })}>
          <Textarea variant="settings" rows={5} value={draft.systemPrompt} onChange={(event) => patch({ systemPrompt: event.target.value })} />
        </Field>
        <ChatPromptSectionsEditor sections={draft.promptSections} onChange={(promptSections) => patch({ promptSections })} />
        <div className="border-t border-line">
          <CollapsibleRow title={t({ ko: '첫 인사말', en: 'Greeting' })} meta={greetingMeta}>
            <Textarea variant="settings" rows={3} value={draft.greeting} onChange={(event) => patch({ greeting: event.target.value })} aria-label={t({ ko: '첫 인사말', en: 'Greeting' })} />
            {alternates.map((text, index) => (
              <div key={index} className="flex items-start gap-1">
                <Textarea
                  variant="settings"
                  rows={3}
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
            <Button variant="secondary" size="sm" onClick={() => patch({ alternateGreetings: [...alternates, ''] })}>
              <Plus />
              {t({ ko: '추가 인사말', en: 'Alternate greeting' })}
            </Button>
          </CollapsibleRow>
        </div>
      </EditorGroup>

      <EditorGroup label={t({ ko: '로어북', en: 'Lorebooks' })}>
        <div className="flex flex-wrap gap-1.5">
          {(lorebooks ?? []).map((lorebook) => {
            const linked = draft.lorebookIds.includes(lorebook.id)
            return (
              <ToggleChip key={lorebook.id} pressed={linked} onClick={() => patch({ lorebookIds: linked ? draft.lorebookIds.filter((id) => id !== lorebook.id) : [...draft.lorebookIds, lorebook.id] })}>
                {lorebook.name}
                <span className="opacity-60">{lorebook.entries.length}</span>
              </ToggleChip>
            )
          })}
          {lorebooks && lorebooks.length === 0 ? <span className="text-sm text-muted-foreground">{t({ ko: '가져온 로어북이 없어.', en: 'No lorebooks yet.' })}</span> : null}
        </div>
      </EditorGroup>
    </div>
  )
}
