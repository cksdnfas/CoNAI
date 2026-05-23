import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Folder, FolderOpen } from 'lucide-react'
import { HierarchyNav } from '@/components/common/hierarchy-nav'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { anchoredPopupBodyClassName, anchoredPopupHeaderClassName, anchoredPopupLabelClassName, AnchoredPopup } from '@/components/ui/anchored-popup'
import { buildPromptPresetInsertionText, getPromptPresets, type PromptPresetRecord } from '@/lib/api-prompt-presets'
import { cn } from '@/lib/utils'
import { useI18n } from '@/i18n'
import type { RefObject } from 'react'

type PromptPresetTreeEntry = {
  preset: PromptPresetRecord
  path: string[]
  insertionText: string
  itemCount: number
}

function flattenPromptPresetTree(records: PromptPresetRecord[], parentPath: string[] = []): PromptPresetTreeEntry[] {
  return records.flatMap((preset) => {
    const path = [...parentPath, preset.name]
    const insertionText = buildPromptPresetInsertionText(preset)
    return [
      { preset, path, insertionText, itemCount: preset.items?.length ?? 0 },
      ...flattenPromptPresetTree(preset.children ?? [], path),
    ]
  })
}

/** Render the mini tree popup used by prompt textarea rows to insert a saved preset. */
export function PromptPresetInlinePicker({
  open,
  anchorRef,
  onClose,
  onInsert,
}: {
  open: boolean
  anchorRef: RefObject<HTMLElement | null>
  onClose: () => void
  onInsert: (text: string) => void
}) {
  const { t } = useI18n()
  const presetsQuery = useQuery({
    queryKey: ['prompt-presets', 'inline-picker'],
    queryFn: () => getPromptPresets({ hierarchical: true, withItems: true }),
    staleTime: 60_000,
  })

  const entries = useMemo(() => flattenPromptPresetTree(presetsQuery.data ?? []), [presetsQuery.data])
  const presetNavItems = useMemo(() => entries.map((entry) => entry.preset), [entries])
  const insertableCount = entries.reduce((count, entry) => count + (entry.insertionText ? 1 : 0), 0)
  const presetEntriesById = useMemo(() => {
    const nextEntriesById = new Map<number, PromptPresetTreeEntry>()
    entries.forEach((entry) => {
      nextEntriesById.set(entry.preset.id, entry)
    })
    return nextEntriesById
  }, [entries])

  const handleSelect = (preset: PromptPresetRecord) => {
    const insertionText = presetEntriesById.get(preset.id)?.insertionText ?? ''
    if (!insertionText) {
      return
    }

    onInsert(insertionText)
    onClose()
  }

  return (
    <AnchoredPopup open={open} anchorRef={anchorRef} onClose={onClose} align="end" side="bottom" className="z-[170] w-[min(28rem,calc(100vw-1.5rem))] overflow-hidden p-0" closeOnBack>
      <div className={cn(anchoredPopupHeaderClassName, 'flex items-center justify-between gap-3')}>
        <div>
          <div className={anchoredPopupLabelClassName}>{t('image-generation.components.prompt.preset.inline.picker.preset')}</div>
          <div className="mt-0.5 text-sm font-medium text-foreground">{t('image-generation.components.prompt.preset.inline.picker.insert.into.prompt')}</div>
        </div>
        <Badge variant="outline">{insertableCount}</Badge>
      </div>

      <div className={cn(anchoredPopupBodyClassName, 'max-h-[24rem] overflow-y-auto')}>
        {presetsQuery.isLoading ? (
          <div className="px-2 py-3 text-sm text-muted-foreground">{t('image-generation.components.prompt.preset.inline.picker.loading.presets')}</div>
        ) : entries.length > 0 ? (
          <HierarchyNav
            items={presetNavItems}
            expandable
            selectedId={null}
            onSelect={handleSelect}
            getId={(preset) => preset.id}
            getParentId={(preset) => preset.parent_id}
            getLabel={(preset) => {
              const entry = presetEntriesById.get(preset.id)
              return (
                <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
                  <span className="truncate">{preset.name}</span>
                  <Badge variant={entry?.insertionText ? 'outline' : 'secondary'}>{entry?.itemCount ?? 0}</Badge>
                </span>
              )
            }}
            sortItems={(left, right) => left.name.localeCompare(right.name)}
            renderIcon={(_, state) => (state.hasChildren || state.isSelected ? <FolderOpen className="h-4 w-4 shrink-0" /> : <Folder className="h-4 w-4 shrink-0" />)}
          />
        ) : (
          <div className="space-y-2 px-2 py-3 text-sm text-muted-foreground">
            <div>{t('image-generation.components.prompt.preset.inline.picker.no.saved.presets')}</div>
            <div className="text-xs">{t('image-generation.components.prompt.preset.inline.picker.create.first.in.prompts.presets')}</div>
          </div>
        )}

        <div className="mt-3 border-t border-border/70 pt-3 text-xs leading-5 text-muted-foreground">
          {t('image-generation.components.prompt.preset.inline.picker.description.comment.prefix')} <code>{t('image-generation.components.prompt.preset.inline.picker.description.comment.token')}</code> {t('image-generation.components.prompt.preset.inline.picker.description.comment.suffix')}
        </div>

        <div className="mt-3 flex justify-end">
          <Button type="button" size="sm" variant="ghost" onClick={onClose}>{t('image-generation.components.prompt.preset.inline.picker.close')}</Button>
        </div>
      </div>
    </AnchoredPopup>
  )
}
