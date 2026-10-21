import { SlidersHorizontal } from 'lucide-react'
import { CountBadge } from '@/components/ui/count-badge'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { IconButton } from '@/components/ui/icon-button'
import { buildGroupOptionItems } from '@/features/groups/group-option-utils'
import { HOME_HIDDEN_GROUPS_LIMIT } from '@/features/home/home-hidden-groups'
import { useI18n } from '@/i18n'
import type { GroupWithHierarchy } from '@/types/group'

interface HomeGalleryOptionsMenuProps {
  groups: GroupWithHierarchy[]
  groupsStatus: 'pending' | 'error' | 'success'
  hiddenGroupIds: number[]
  onHiddenGroupIdsChange: (groupIds: number[]) => void
}

/** Home gallery options: tick the custom groups whose images the feed and its searches leave out. */
export function HomeGalleryOptionsMenu({ groups, groupsStatus, hiddenGroupIds, onHiddenGroupIdsChange }: HomeGalleryOptionsMenuProps) {
  const { t, formatNumber } = useI18n()
  const options = buildGroupOptionItems(groups)
  const hidden = new Set(hiddenGroupIds)
  // Only existing groups: ids of deleted groups drop out with the next change.
  const hiddenOptionIds = options.filter((option) => hidden.has(option.id)).map((option) => option.id)
  const label = hiddenOptionIds.length > 0
    ? t({ ko: '갤러리 옵션 · 그룹 {count}개 숨김', en: 'Gallery options · {count} groups hidden' }, { count: formatNumber(hiddenOptionIds.length) })
    : t({ ko: '갤러리 옵션', en: 'Gallery options' })

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton size="icon-sm" variant="ghost" label={label} className="relative">
          <SlidersHorizontal className="size-4" />
          {hiddenOptionIds.length > 0 ? <CountBadge corner="top-right" size="xs" count={hiddenOptionIds.length} max={99} /> : null}
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>{t({ ko: '갤러리에서 숨길 그룹', en: 'Groups to hide' })}</DropdownMenuLabel>
        {groupsStatus === 'pending' ? (
          <DropdownMenuItem disabled>{t({ ko: '그룹을 불러오는 중…', en: 'Loading groups…' })}</DropdownMenuItem>
        ) : groupsStatus === 'error' ? (
          <DropdownMenuItem disabled>{t('useHomePageData.failedToLoadGroupList')}</DropdownMenuItem>
        ) : options.length === 0 ? (
          <DropdownMenuItem disabled>{t({ ko: '아직 그룹이 없어', en: 'No groups yet' })}</DropdownMenuItem>
        ) : options.map((option) => (
          <DropdownMenuCheckboxItem
            key={option.id}
            checked={hidden.has(option.id)}
            disabled={!hidden.has(option.id) && hiddenOptionIds.length >= HOME_HIDDEN_GROUPS_LIMIT}
            // Keep the menu open so several groups can be ticked in a row.
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={(checked) => onHiddenGroupIdsChange(checked ? [...hiddenOptionIds, option.id] : hiddenOptionIds.filter((id) => id !== option.id))}
          >
            <span className="min-w-0 truncate">{option.label}</span>
          </DropdownMenuCheckboxItem>
        ))}
        {hiddenOptionIds.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onHiddenGroupIdsChange([])}>{t({ ko: '모두 다시 보기', en: 'Show all groups' })}</DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
