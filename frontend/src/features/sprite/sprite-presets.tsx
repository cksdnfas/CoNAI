import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bookmark, Check, ChevronDown, FileInput, RefreshCw, Save, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useFeaturePermissions } from '@/features/auth/use-feature-permissions'
import { ChatMediaPicker } from '@/features/codex-chat/chat-media-picker'
import { useI18n } from '@/i18n'
import { createSpritePreset, deleteSpritePreset, getSpriteSheetSettings, listSpritePresets, updateSpritePreset, type SpriteExtractOptions, type SpritePreset } from '@/lib/api-sprite'
import { getErrorMessage } from '@/lib/error-message'
import type { SaveForm } from './sprite-options'

const PRESETS_QUERY_KEY = ['sprite-presets']

/** Shared presets (one list for everyone) and "settings from a saved sheet", next to the page tabs. */
export function SpritePresetMenu({ activeId, current, onApply, onActiveChange }: {
  activeId: string | null
  /** The settings a save would store right now. */
  current: () => { options: Partial<SpriteExtractOptions>; save: SaveForm }
  onApply: (options: Partial<SpriteExtractOptions>, save: SaveForm | null) => void
  onActiveChange: (id: string | null) => void
}) {
  const { t } = useI18n()
  const { has } = useFeaturePermissions()
  const { showSnackbar } = useSnackbar()
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const canEdit = has('images.edit')
  const presets = useQuery({ queryKey: PRESETS_QUERY_KEY, queryFn: listSpritePresets, staleTime: 30_000 })
  const active = presets.data?.find((preset) => preset.id === activeId) ?? null
  const [naming, setNaming] = useState(false)
  const [picking, setPicking] = useState(false)
  const fail = (error: unknown) => showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '프리셋을 저장하지 못했어.', en: 'Could not save the preset.' })) })
  const refresh = () => queryClient.invalidateQueries({ queryKey: PRESETS_QUERY_KEY })

  const overwrite = useMutation({
    mutationFn: (preset: SpritePreset) => { const settings = current(); return updateSpritePreset(preset.id, { options: settings.options, output: settings.save }) },
    onSuccess: (preset) => { void refresh(); showSnackbar({ message: t({ ko: '"{name}"에 덮어썼어.', en: 'Saved over "{name}".' }, { name: preset.name }) }) },
    onError: fail,
  })
  const remove = useMutation({
    mutationFn: (preset: SpritePreset) => deleteSpritePreset(preset.id),
    onSuccess: () => { void refresh(); onActiveChange(null) },
    onError: fail,
  })

  const choose = (preset: SpritePreset) => {
    onApply(preset.options, preset.output)
    onActiveChange(preset.id)
  }

  const importSheet = async (hash: string) => {
    try {
      const settings = await getSpriteSheetSettings(hash)
      if (!settings?.options) {
        showSnackbar({ tone: 'error', message: t({ ko: '이 이미지엔 스프라이트 설정이 없어.', en: 'This image carries no sprite settings.' }) })
        return
      }
      const render = settings.render ?? {}
      onApply({ ...settings.options, columns: render.columns ?? settings.options.columns, spacing: render.spacing ?? settings.options.spacing, outputFormat: render.format ?? settings.options.outputFormat, outputQuality: render.quality ?? settings.options.outputQuality }, null)
      onActiveChange(null)
      showSnackbar({ message: t({ ko: '시트의 설정을 불러왔어.', en: 'Loaded the sheet settings.' }) })
    } catch (error) {
      showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '설정을 읽지 못했어.', en: 'Could not read the settings.' })) })
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="secondary" className="max-w-64">
            <Bookmark />
            <span className="truncate">{active?.name ?? t({ ko: '프리셋', en: 'Preset' })}</span>
            <ChevronDown className="text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-80">
          {(presets.data ?? []).map((preset) => (
            <DropdownMenuItem key={preset.id} onSelect={() => choose(preset)}>
              {preset.id === activeId ? <Check className="text-primary" /> : <span className="size-4 shrink-0" />}
              <span className="min-w-0 flex-1 truncate">{preset.name}</span>
              <span className="shrink-0 font-mono text-2xs text-muted-foreground">{presetSummary(preset.options, t)}</span>
            </DropdownMenuItem>
          ))}
          {presets.data?.length ? <DropdownMenuSeparator /> : null}
          {canEdit ? <DropdownMenuItem onSelect={() => setNaming(true)}><Save />{t({ ko: '지금 설정을 새 프리셋으로', en: 'Save as a new preset' })}</DropdownMenuItem> : null}
          {canEdit && active ? <DropdownMenuItem onSelect={() => overwrite.mutate(active)}><RefreshCw />{t({ ko: '"{name}" 덮어쓰기', en: 'Save over "{name}"' }, { name: active.name })}</DropdownMenuItem> : null}
          <DropdownMenuItem onSelect={() => setPicking(true)}><FileInput />{t({ ko: '라이브러리 시트에서 가져오기', en: 'Load from a library sheet' })}</DropdownMenuItem>
          {canEdit && active ? (
            <DropdownMenuItem variant="destructive" onSelect={() => void (async () => {
              if (await confirm({ title: t({ ko: '프리셋 지우기', en: 'Delete preset' }), description: t({ ko: '"{name}"을(를) 모두의 목록에서 지울까?', en: 'Delete "{name}" for everyone?' }, { name: active.name }), confirmLabel: t({ ko: '지우기', en: 'Delete' }) })) remove.mutate(active)
            })()}><Trash2 />{t({ ko: '이 프리셋 지우기', en: 'Delete this preset' })}</DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {naming ? (
        <PresetNameDialog
          onClose={() => setNaming(false)}
          onSave={async (name) => {
            try {
              const settings = current()
              const preset = await createSpritePreset({ name, options: settings.options, output: settings.save })
              await refresh()
              onActiveChange(preset.id)
              setNaming(false)
            } catch (error) {
              fail(error)
            }
          }}
        />
      ) : null}
      {picking ? (
        <ChatMediaPicker
          initial={[]}
          maxCount={1}
          imagesOnly
          initialGroupPath="스프라이트"
          title={t({ ko: '설정을 가져올 시트', en: 'Sheet to load settings from' })}
          applyLabel={t({ ko: '가져오기', en: 'Load' })}
          note={null}
          onClose={() => setPicking(false)}
          onPick={(items) => { setPicking(false); if (items[0]) void importSheet(items[0].compositeHash) }}
        />
      ) : null}
    </>
  )
}

function presetSummary(options: SpriteExtractOptions, t: ReturnType<typeof useI18n>['t']) {
  const frames = options.sampleCount > 0 ? t({ ko: '{count}컷', en: '{count} frames' }, { count: options.sampleCount }) : `${options.intervalSeconds}s`
  const columns = options.columns > 0 ? t({ ko: '{count}열', en: '{count} cols' }, { count: options.columns }) : t({ ko: '자동', en: 'auto' })
  return `${frames} · ${columns}`
}

function PresetNameDialog({ onClose, onSave }: { onClose: () => void; onSave: (name: string) => Promise<void> }) {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    try { await onSave(name.trim()) } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title={t({ ko: '새 프리셋', en: 'New preset' })} widthClassName="max-w-md">
      <form onSubmit={(event) => void submit(event)}>
        <ModalBody className="space-y-4">
          <Input autoFocus value={name} maxLength={80} onChange={(event) => setName(event.target.value)} placeholder={t({ ko: '예: 게임A · 걷기', en: 'e.g. Game A · walk' })} aria-label={t({ ko: '프리셋 이름', en: 'Preset name' })} />
          <ModalFooter>
            <Button type="button" variant="secondary" onClick={onClose}>{t({ ko: '취소', en: 'Cancel' })}</Button>
            <Button type="submit" disabled={busy || !name.trim()}>{t({ ko: '저장', en: 'Save' })}</Button>
          </ModalFooter>
        </ModalBody>
      </form>
    </Modal>
  )
}
