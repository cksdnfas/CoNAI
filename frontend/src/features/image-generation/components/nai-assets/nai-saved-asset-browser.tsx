import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Section } from '@/components/ui/section'
import { Select } from '@/components/ui/select'
import { Text } from '@/components/ui/text'
import { cn } from '@/lib/utils'
import { useI18n } from '@/i18n'
import type { NaiSavedAssetSortOption } from './nai-saved-asset-preferences'
import { NaiSavedAssetTile } from './nai-saved-asset-tile'

export type NaiSavedAssetBrowserItem = {
  id: string
  title: string
  subtitle?: string
  imageUrl?: string
}

export type NaiSavedAssetBrowserProps = {
  title?: string
  items: NaiSavedAssetBrowserItem[]
  searchValue: string
  searchPlaceholder?: string
  emptyMessage: string
  isLoading: boolean
  defaultExpanded?: boolean
  className?: string
  onSearchChange: (value: string) => void
  onSelect: (assetId: string) => void
  onEdit?: (assetId: string) => void
  onDelete?: (assetId: string) => void
  /** Optional sort picker (module graph keeps pinned / recent-use ordering per browser). */
  sort?: { value: NaiSavedAssetSortOption; onChange: (value: NaiSavedAssetSortOption) => void }
  pinnedIds?: ReadonlySet<string>
  onTogglePin?: (assetId: string) => void
}

/** Render one collapsible saved vibe/reference library: count + search (+ sort) stay visible while collapsed. */
export function NaiSavedAssetBrowser({
  title = 'Save Image',
  items,
  searchValue,
  searchPlaceholder,
  emptyMessage,
  isLoading,
  defaultExpanded = false,
  className,
  onSearchChange,
  onSelect,
  onEdit,
  onDelete,
  sort,
  pinnedIds,
  onTogglePin,
}: NaiSavedAssetBrowserProps) {
  const { t } = useI18n()
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)
  const effectiveSearchPlaceholder = searchPlaceholder ?? t('image-generation.components.nai.saved.image.browser.section.search.name.description')
  const toggleLabel = isExpanded
    ? t('image-generation.components.nai.saved.image.browser.section.collapse', { title })
    : t('image-generation.components.nai.saved.image.browser.section.expand', { title })

  return (
    <Section
      variant="controller"
      heading={<Text as="span" variant="overline" className="font-semibold">{title}</Text>}
      className={className}
      bodyClassName={isExpanded ? 'space-y-0' : 'hidden'}
      actions={(
        <>
          <span className="px-1 text-xs tabular-nums text-muted-foreground">{items.length}</span>
          <div className="w-[9.5rem] sm:w-44 md:w-52">
            <Input value={searchValue} onChange={(event) => onSearchChange(event.target.value)} placeholder={effectiveSearchPlaceholder} />
          </div>
          {sort ? (
            <div className="w-32">
              <Select
                aria-label={t({ ko: '정렬', en: 'Sort' })}
                value={sort.value}
                onChange={(event) => sort.onChange(event.target.value as NaiSavedAssetSortOption)}
              >
                <option value="pinned">{t({ ko: '핀 우선', en: 'Pinned first' })}</option>
                <option value="recent">{t({ ko: '최근 사용순', en: 'Recently used' })}</option>
                <option value="latest">{t({ ko: '최신순', en: 'Newest first' })}</option>
                <option value="oldest">{t({ ko: '오래된순', en: 'Oldest first' })}</option>
                <option value="name">{t({ ko: '이름순', en: 'By name' })}</option>
              </Select>
            </div>
          ) : null}
          <IconButton
            size="icon-sm"
            variant="ghost"
            onClick={() => setIsExpanded((current) => !current)}
            aria-expanded={isExpanded}
            label={toggleLabel}
          >
            <ChevronDown className={cn('transition-transform', !isExpanded && '-rotate-90')} />
          </IconButton>
        </>
      )}
    >
      {isExpanded ? (
        isLoading ? (
          <Text variant="muted">{t('image-generation.components.nai.saved.image.browser.section.loading')}</Text>
        ) : items.length > 0 ? (
          <div className="max-h-[41rem] overflow-y-auto pr-1">
            <div className="grid grid-cols-2 gap-3 @lg:grid-cols-3">
              {items.map((item) => (
                <NaiSavedAssetTile
                  key={item.id}
                  title={item.title}
                  subtitle={item.subtitle}
                  imageUrl={item.imageUrl}
                  isPinned={pinnedIds?.has(item.id)}
                  onSelect={() => onSelect(item.id)}
                  onEdit={onEdit ? () => onEdit(item.id) : undefined}
                  onDelete={onDelete ? () => onDelete(item.id) : undefined}
                  onTogglePin={onTogglePin ? () => onTogglePin(item.id) : undefined}
                />
              ))}
            </div>
          </div>
        ) : (
          <Text variant="muted">{emptyMessage}</Text>
        )
      ) : null}
    </Section>
  )
}
