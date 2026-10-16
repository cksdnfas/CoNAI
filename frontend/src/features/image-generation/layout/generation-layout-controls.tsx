import { useState } from 'react'
import { ChevronDown, Columns3, EyeOff, LayoutDashboard, Plus, RotateCcw } from 'lucide-react'
import { GENERATION_LAYOUT_LIMITS, type GenerationLayoutPreset, type GenerationLayoutSurface } from '@conai/shared'
import { NameDialog } from '@/components/common/entry-dialogs'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { IconButton } from '@/components/ui/icon-button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useI18n } from '@/i18n'
import { useGenerationLayout } from './generation-layout-context'
import { GENERATION_LAYOUT_BLOCK_LABELS } from './generation-layout-labels'
import { addLayoutColumn, resetLayoutPreset, setLayoutBlockHidden } from './generation-layout-ops'

type NameDialogState = { mode: 'create' | 'rename'; value: string } | null

/** Arranged on wide screens only: narrow ones keep their own list/result switch (workflows tab) or fixed order. */
const WIDE_ONLY_SURFACES: readonly GenerationLayoutSurface[] = ['workflow-browse', 'workflow-run', 'image-detail']

/** Toolbar end of the generation page: the active surface's preset picker for everyone, plus the editor for admins. */
export function GenerationLayoutControls({ wide }: { wide: boolean }) {
  const layout = useGenerationLayout()
  const surface = layout.activeSurface
  return surface ? <SurfaceLayoutControls key={surface} surface={surface} wide={wide} /> : null
}

function SurfaceLayoutControls({ surface, wide }: { surface: GenerationLayoutSurface; wide: boolean }) {
  const { t } = useI18n()
  const confirm = useConfirm()
  const layout = useGenerationLayout()
  const presets = layout.presetsOf(surface)
  const preset = layout.presetOf(surface)
  const editing = layout.editing === surface
  const canEditHere = layout.canEdit && (wide || !WIDE_ONLY_SURFACES.includes(surface))
  const [nameDialog, setNameDialog] = useState<NameDialogState>(null)

  if (!editing && presets.length < 2 && !canEditHere) return null

  const submitName = () => {
    if (!nameDialog) return
    const name = nameDialog.value.trim().slice(0, GENERATION_LAYOUT_LIMITS.nameLength)
    if (nameDialog.mode === 'rename') {
      layout.updatePreset((current) => ({ ...current, name }))
    } else {
      const id = `p-${Date.now().toString(36)}`
      layout.updatePresets((current) => [...current, { ...preset, id, name }], id)
    }
    setNameDialog(null)
  }

  const deletePreset = async () => {
    const accepted = await confirm({
      title: t({ ko: '"{name}" 프리셋을 삭제할까?', en: 'Delete the "{name}" preset?' }, { name: preset.name }),
      confirmLabel: t({ ko: '삭제', en: 'Delete' }),
      tone: 'destructive',
    })
    if (accepted) layout.updatePresets((current) => current.filter((item) => item.id !== preset.id))
  }

  const presetMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="sm" aria-label={t({ ko: '레이아웃 프리셋: {name}', en: 'Layout preset: {name}' }, { name: preset.name })} className="max-w-48">
          <span className="truncate">{preset.name}</span>
          <ChevronDown className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuRadioGroup value={preset.id} onValueChange={(id) => layout.selectPreset(surface, id)}>
          {presets.map((item: GenerationLayoutPreset, index) => (
            <DropdownMenuRadioItem key={item.id} value={item.id}>
              <span className="min-w-0 flex-1 truncate">{item.name}</span>
              {index === 0 ? <span className="text-xs text-muted-foreground">{t({ ko: '기본', en: 'Default' })}</span> : null}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {editing ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={presets.length >= GENERATION_LAYOUT_LIMITS.presets} onSelect={() => setNameDialog({ mode: 'create', value: '' })}>
              {t({ ko: '새 프리셋', en: 'New preset' })}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setNameDialog({ mode: 'rename', value: preset.name })}>
              {t({ ko: '이름 바꾸기', en: 'Rename' })}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={presets[0]?.id === preset.id}
              onSelect={() => layout.updatePresets((current) => [preset, ...current.filter((item) => item.id !== preset.id)])}
            >
              {t({ ko: '기본 프리셋으로 지정', en: 'Make default' })}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" disabled={presets.length < 2} onSelect={() => void deletePreset()}>
              {t({ ko: '삭제', en: 'Delete' })}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  if (!editing) {
    return (
      <div className="flex shrink-0 items-center gap-1">
        {presets.length > 1 ? presetMenu : null}
        {canEditHere ? (
          <IconButton size="icon-sm" variant="ghost" label={t({ ko: '레이아웃 편집', en: 'Edit layout' })} onClick={() => layout.startEditing(surface)}>
            <LayoutDashboard />
          </IconButton>
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1">
      {presetMenu}
      <HiddenBlocksButton preset={preset} />
      {wide ? (
        <IconButton
          size="icon-sm"
          variant="ghost"
          label={t({ ko: '열 추가', en: 'Add column' })}
          disabled={preset.columns.length >= GENERATION_LAYOUT_LIMITS.columns}
          onClick={() => layout.updatePreset(addLayoutColumn)}
        >
          <Columns3 />
        </IconButton>
      ) : null}
      <IconButton size="icon-sm" variant="ghost" label={t({ ko: '기본 배치로 되돌리기', en: 'Reset to default arrangement' })} onClick={() => layout.updatePreset((current) => resetLayoutPreset(surface, current))}>
        <RotateCcw />
      </IconButton>
      <span className="mx-1 h-5 w-px bg-line" aria-hidden />
      <Button type="button" variant="ghost" size="sm" disabled={layout.saving} onClick={layout.cancelEditing}>
        {t({ ko: '취소', en: 'Cancel' })}
      </Button>
      <Button type="button" size="sm" disabled={layout.saving} onClick={layout.save}>
        {t({ ko: '저장', en: 'Save' })}
      </Button>

      <NameDialog
        open={nameDialog !== null}
        title={nameDialog?.mode === 'rename' ? t({ ko: '프리셋 이름 바꾸기', en: 'Rename preset' }) : t({ ko: '새 프리셋', en: 'New preset' })}
        value={nameDialog?.value ?? ''}
        onChange={(value) => setNameDialog((current) => current && { ...current, value })}
        onSubmit={submitName}
        onClose={() => setNameDialog(null)}
      />
    </div>
  )
}

/** "+" in the editor: blocks hidden in this preset, each one click from coming back. */
function HiddenBlocksButton({ preset }: { preset: GenerationLayoutPreset }) {
  const { t } = useI18n()
  const { updatePreset } = useGenerationLayout()
  if (preset.hidden.length === 0) {
    return (
      <IconButton size="icon-sm" variant="ghost" label={t({ ko: '숨긴 블록 없음', en: 'No hidden blocks' })} disabled>
        <Plus />
      </IconButton>
    )
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton size="icon-sm" variant="ghost" label={t({ ko: '숨긴 블록', en: 'Hidden blocks' })}>
          <Plus />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-1">
        {preset.hidden.map((block) => (
          <div key={block} className="flex h-11 items-center gap-2 rounded-sm pr-1 pl-3 hover:bg-fill">
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{t(GENERATION_LAYOUT_BLOCK_LABELS[block])}</span>
            <IconButton
              size="icon-sm"
              variant="ghost"
              label={t({ ko: '{name} 다시 표시', en: 'Show {name}' }, { name: t(GENERATION_LAYOUT_BLOCK_LABELS[block]) })}
              onClick={() => updatePreset((current) => setLayoutBlockHidden(current, block, false))}
            >
              <EyeOff />
            </IconButton>
          </div>
        ))}
      </PopoverContent>
    </Popover>
  )
}
