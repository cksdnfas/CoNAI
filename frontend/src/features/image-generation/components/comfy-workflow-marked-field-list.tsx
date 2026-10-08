import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { GripVertical, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'
import type { WorkflowMarkedField } from '@/lib/api-image-generation-types'
import { cn } from '@/lib/utils'
import { groupWorkflowMarkedFieldsByNode } from '../workflow-marked-field-groups'
import { markedFieldMatchesQuery } from './comfy-workflow-marked-field-utils'
import { useMarkedFieldTypeLabel } from './comfy-workflow-marked-field-editor'

type ComfyWorkflowMarkedFieldListProps = {
  markedFields: WorkflowMarkedField[]
  selectedFieldId: string | null
  onFieldSelect: (fieldId: string) => void
  onReorderMarkedField: (sourceFieldId: string, targetFieldId: string) => void
  onReorderMarkedFieldGroup: (sourceGroupKey: string, targetGroupKey: string) => void
}

type DragState =
  | { kind: 'group', groupKey: string }
  | { kind: 'field', groupKey: string, fieldId: string }

/**
 * Marked fields grouped by source node. A row selects the field for the editor below; the grip on a group heading
 * moves the whole group and the grip on a row moves that field inside its group. Dragging is off while searching.
 */
export function ComfyWorkflowMarkedFieldList({
  markedFields,
  selectedFieldId,
  onFieldSelect,
  onReorderMarkedField,
  onReorderMarkedFieldGroup,
}: ComfyWorkflowMarkedFieldListProps) {
  const { t } = useI18n()
  const formatType = useMarkedFieldTypeLabel()
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [dragState, setDragState] = useState<DragState | null>(null)
  const [dropTargetKey, setDropTargetKey] = useState<string | null>(null)
  const selectedRowRef = useRef<HTMLDivElement | null>(null)
  const isFiltering = query.trim().length > 0
  const groups = useMemo(() => {
    const allGroups = groupWorkflowMarkedFieldsByNode(markedFields)
    if (!isFiltering) return allGroups
    return allGroups
      .map((group) => ({ ...group, fields: group.fields.filter((field) => markedFieldMatchesQuery(field, query)) }))
      .filter((group) => group.fields.length > 0)
  }, [isFiltering, markedFields, query])

  // Picking an input on the graph selects its field; bring that row into view.
  useEffect(() => {
    selectedRowRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selectedFieldId])

  const clearDrag = () => {
    setDragState(null)
    setDropTargetKey(null)
  }
  const startDrag = (state: DragState) => (event: DragEvent<HTMLSpanElement>) => {
    event.stopPropagation()
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', state.kind === 'group' ? state.groupKey : state.fieldId)
    setDragState(state)
  }
  const dragOverGroup = (groupKey: string) => (event: DragEvent<HTMLDivElement>) => {
    if (dragState?.kind !== 'group' || dragState.groupKey === groupKey) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDropTargetKey(`group:${groupKey}`)
  }
  const dropOnGroup = (groupKey: string) => (event: DragEvent<HTMLDivElement>) => {
    if (dragState?.kind !== 'group') return
    event.preventDefault()
    if (dragState.groupKey !== groupKey) onReorderMarkedFieldGroup(dragState.groupKey, groupKey)
    clearDrag()
  }
  const dragOverField = (groupKey: string, fieldId: string) => (event: DragEvent<HTMLDivElement>) => {
    if (dragState?.kind !== 'field' || dragState.groupKey !== groupKey || dragState.fieldId === fieldId) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    setDropTargetKey(`field:${fieldId}`)
  }
  const dropOnField = (groupKey: string, fieldId: string) => (event: DragEvent<HTMLDivElement>) => {
    if (dragState?.kind !== 'field' || dragState.groupKey !== groupKey) return
    event.preventDefault()
    event.stopPropagation()
    if (dragState.fieldId !== fieldId) onReorderMarkedField(dragState.fieldId, fieldId)
    clearDrag()
  }

  const dropHighlight = 'bg-primary/8 ring-1 ring-inset ring-primary/45'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 pr-2 pl-4">
        {isSearchOpen ? (
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              variant="settings"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Escape') return
                event.preventDefault()
                setQuery('')
                setIsSearchOpen(false)
              }}
              placeholder={t({ ko: '필드 검색', en: 'Search fields' })}
              aria-label={t({ ko: '필드 검색', en: 'Search fields' })}
              className="h-8 pl-8"
            />
          </div>
        ) : (
          <>
            <span className="text-sm font-bold text-foreground">{t({ ko: '필드', en: 'Fields' })}</span>
            <span className="font-mono text-2xs text-muted-foreground">{markedFields.length}</span>
            <span className="flex-1" />
          </>
        )}
        <IconButton
          size="icon-sm"
          variant="ghost"
          onClick={() => {
            if (isSearchOpen) setQuery('')
            setIsSearchOpen((open) => !open)
          }}
          label={isSearchOpen ? t({ ko: '검색 닫기', en: 'Close search' }) : t({ ko: '필드 검색', en: 'Search fields' })}
        >
          {isSearchOpen ? <X /> : <Search />}
        </IconButton>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2">
        {groups.length === 0 ? (
          <div className="px-4 py-3 text-sm text-muted-foreground">
            {isFiltering ? t({ ko: '맞는 필드가 없어', en: 'No matching fields' }) : t({ ko: '아직 필드가 없어', en: 'No fields yet' })}
          </div>
        ) : groups.map((group) => (
          <div
            key={group.key}
            onDragOver={dragOverGroup(group.key)}
            onDrop={dropOnGroup(group.key)}
            className={cn('rounded-sm transition-colors', dropTargetKey === `group:${group.key}` && dropHighlight)}
          >
            <div className="group/heading flex items-center gap-1 pt-3 pr-4 pb-1 pl-2">
              <span
                draggable={!isFiltering}
                onDragStart={startDrag({ kind: 'group', groupKey: group.key })}
                onDragEnd={clearDrag}
                title={t({ ko: '드래그해서 그룹 순서 바꾸기', en: 'Drag to reorder the group' })}
                className={cn('flex size-5 shrink-0 items-center justify-center text-muted-foreground/40', !isFiltering && 'cursor-grab hover:text-muted-foreground active:cursor-grabbing')}
              >
                <GripVertical className="size-3.5" />
              </span>
              <span className="min-w-0 truncate text-2xs font-bold tracking-overline text-muted-foreground uppercase">
                {group.nodeTitle ?? t({ ko: '노드 없음', en: 'No node' })}
                {group.nodeId ? <span className="font-mono font-normal normal-case"> · #{group.nodeId}</span> : null}
              </span>
            </div>
            {group.fields.map((field) => {
              const isSelected = field.id === selectedFieldId
              return (
                <div
                  key={field.id}
                  ref={isSelected ? selectedRowRef : undefined}
                  onDragOver={dragOverField(group.key, field.id)}
                  onDrop={dropOnField(group.key, field.id)}
                  className={cn(
                    'mx-2 flex h-9 items-center rounded-sm transition-colors',
                    isSelected ? 'bg-fill' : 'hover:bg-fill/60',
                    dropTargetKey === `field:${field.id}` && dropHighlight,
                  )}
                >
                  <span
                    draggable={!isFiltering}
                    onDragStart={startDrag({ kind: 'field', groupKey: group.key, fieldId: field.id })}
                    onDragEnd={clearDrag}
                    title={t({ ko: '드래그해서 순서 바꾸기', en: 'Drag to reorder' })}
                    className={cn('flex h-full w-6 shrink-0 items-center justify-center text-muted-foreground/40', !isFiltering && 'cursor-grab hover:text-muted-foreground active:cursor-grabbing')}
                  >
                    <GripVertical className="size-3.5" />
                  </span>
                  <Button
                    type="button"
                    variant="nav"
                    size="sm"
                    aria-current={isSelected || undefined}
                    onClick={() => onFieldSelect(field.id)}
                    className="h-full min-w-0 flex-1 justify-start gap-2 rounded-sm bg-transparent pr-2.5 pl-0 font-normal hover:bg-transparent"
                  >
                    <span className={cn('min-w-0 truncate', isSelected ? 'font-bold text-secondary-text' : 'text-foreground')}>{field.label || field.id}</span>
                    {field.required ? <span role="img" className="size-1.5 shrink-0 rounded-full bg-secondary-text" aria-label={t({ ko: '필수', en: 'Required' })} /> : null}
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">{formatType(field.type)}</span>
                  </Button>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
