import { Bot, ChevronLeft, ChevronRight, Download, Ellipsis, FolderPlus, FolderTree, Pencil, Play, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { CountSummary } from '@/components/ui/count-summary'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Heading } from '@/components/ui/heading'
import { IconButton } from '@/components/ui/icon-button'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { COUNT_UNITS, type CountState } from '@/lib/count-display'
import type { GroupBreadcrumbItem } from '@/types/group'
import { GroupColorDot } from './group-color-dot'

interface GroupViewHeaderProps {
  name: string
  color?: string | null
  /** Root-to-current path; the last item is the current group. */
  pathItems: GroupBreadcrumbItem[]
  rootLabel: string
  countState: CountState
  isCustomSource: boolean
  autoCollect?: { enabled: boolean; conditionCount: number }
  compact?: boolean
  isAutoCollectPending?: boolean
  isDownloadPending?: boolean
  isDeletePending?: boolean
  onOpenRoot: () => void
  onOpenGroup: (groupId: number) => void
  onOpenTree?: () => void
  onRunAutoCollect: () => void
  onCreateSubgroup: () => void
  onEdit: () => void
  onDownload: () => void
  onDelete: () => void
}

/** One header block for the open group: path, colour + name, count, auto-collect state, and icon actions. */
export function GroupViewHeader({
  name,
  color,
  pathItems,
  rootLabel,
  countState,
  isCustomSource,
  autoCollect,
  compact = false,
  isAutoCollectPending = false,
  isDownloadPending = false,
  isDeletePending = false,
  onOpenRoot,
  onOpenGroup,
  onOpenTree,
  onRunAutoCollect,
  onCreateSubgroup,
  onEdit,
  onDownload,
  onDelete,
}: GroupViewHeaderProps) {
  const { t, formatNumber } = useI18n()
  const ancestors = pathItems.slice(0, -1)
  const parentItem = ancestors.at(-1)
  const autoCollectLabel = autoCollect?.enabled
    ? t({ ko: '자동수집 켜짐 · 조건 {count}개', en: 'Auto-collect on · {count} conditions' }, { count: formatNumber(autoCollect.conditionCount) })
    : t({ ko: '자동수집 꺼짐', en: 'Auto-collect off' })

  const countChip = (
    <Chip tone="muted" className="tabular-nums">
      <CountSummary {...countState} unit={COUNT_UNITS.images} />
    </Chip>
  )

  const autoCollectChip = isCustomSource && autoCollect ? (
    <Tip content={autoCollectLabel}>
      <Chip tone={autoCollect.enabled ? 'primary' : 'muted'} tabIndex={0} aria-label={autoCollectLabel} className="outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
        <Bot />
        {autoCollect.enabled ? formatNumber(autoCollect.conditionCount) : null}
      </Chip>
    </Tip>
  ) : null

  const actions = (
    <div className="flex items-center gap-0.5">
      {isCustomSource ? (
        <>
          <IconButton
            label={isAutoCollectPending ? t('groups.components.group.detail.header.card.auto.collecting') : t('groups.components.group.detail.header.card.run.auto.collect')}
            variant="ghost"
            size="icon-sm"
            onClick={onRunAutoCollect}
            disabled={isAutoCollectPending}
          >
            <Play />
          </IconButton>
          <IconButton label={t({ ko: '하위 그룹 추가', en: 'Add subgroup' })} variant="ghost" size="icon-sm" onClick={onCreateSubgroup}>
            <FolderPlus />
          </IconButton>
          <IconButton label={t({ ko: '그룹 편집', en: 'Edit group' })} variant="ghost" size="icon-sm" onClick={onEdit}>
            <Pencil />
          </IconButton>
        </>
      ) : null}
      <DropdownMenu>
        <Tip content={t({ ko: '더보기', en: 'More' })}>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={t({ ko: '더보기', en: 'More' })}>
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
        </Tip>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onDownload} disabled={isDownloadPending}>
            <Download />
            {isDownloadPending ? t('groups.components.group.detail.header.card.preparing') : t('groups.components.group.detail.header.card.download')}
          </DropdownMenuItem>
          {isCustomSource ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={onDelete} disabled={isDeletePending}>
                <Trash2 />
                {t({ ko: '그룹 삭제', en: 'Delete group' })}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )

  if (compact) {
    return (
      <header className="space-y-2">
        <div className="flex min-h-10 items-center gap-1.5">
          <IconButton
            label={parentItem ? t({ ko: '{name}(으)로', en: 'Back to {name}' }, { name: parentItem.name }) : t({ ko: '모든 그룹', en: 'All groups' })}
            variant="ghost"
            size="icon-sm"
            onClick={() => (parentItem ? onOpenGroup(parentItem.id) : onOpenRoot())}
          >
            <ChevronLeft />
          </IconButton>
          <GroupColorDot color={color} size="md" />
          <Heading level={3} as="h1" className="min-w-0 flex-1 truncate text-lg">{name}</Heading>
          {onOpenTree ? (
            <IconButton label={t({ ko: '그룹 트리', en: 'Group tree' })} variant="subtle" size="icon-sm" onClick={onOpenTree}>
              <FolderTree />
            </IconButton>
          ) : null}
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            {countChip}
            {autoCollectChip}
          </div>
          {actions}
        </div>
      </header>
    )
  }

  return (
    <header className="space-y-1.5">
      <nav aria-label={t({ ko: '그룹 경로', en: 'Group path' })} className="flex min-w-0 items-center gap-0.5 text-xs text-muted-foreground">
        <Button type="button" variant="link" size="xs" className="h-auto px-0.5 text-muted-foreground" onClick={onOpenRoot}>
          {rootLabel}
        </Button>
        {ancestors.map((item) => (
          <span key={item.id} className="flex min-w-0 items-center gap-0.5">
            <ChevronRight className="size-3 shrink-0" aria-hidden="true" />
            <Button type="button" variant="link" size="xs" className="h-auto max-w-40 truncate px-0.5 text-muted-foreground" onClick={() => onOpenGroup(item.id)}>
              {item.name}
            </Button>
          </span>
        ))}
      </nav>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <GroupColorDot color={color} size="lg" />
          <Heading level={1} className="min-w-0 truncate">{name}</Heading>
          {countChip}
          {autoCollectChip}
        </div>
        {actions}
      </div>
    </header>
  )
}
