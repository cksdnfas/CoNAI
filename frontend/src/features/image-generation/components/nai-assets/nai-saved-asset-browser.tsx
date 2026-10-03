import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Text } from '@/components/ui/text'
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
  items: NaiSavedAssetBrowserItem[]
  searchValue: string
  searchPlaceholder?: string
  emptyMessage: string
  isLoading: boolean
  onSearchChange: (value: string) => void
  onSelect: (assetId: string) => void
  onEdit?: (assetId: string) => void
  onDelete?: (assetId: string) => void
  /** Optional sort picker (module graph keeps pinned / recent-use ordering per browser). */
  sort?: { value: NaiSavedAssetSortOption; onChange: (value: NaiSavedAssetSortOption) => void }
  pinnedIds?: ReadonlySet<string>
  onTogglePin?: (assetId: string) => void
}

/** Saved vibe/reference library shown as the "saved" tab of the add picker: search (+ sort) over a masonry of tiles. */
export function NaiSavedAssetBrowser({
  items,
  searchValue,
  searchPlaceholder,
  emptyMessage,
  isLoading,
  onSearchChange,
  onSelect,
  onEdit,
  onDelete,
  sort,
  pinnedIds,
  onTogglePin,
}: NaiSavedAssetBrowserProps) {
  const { t } = useI18n()

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={searchValue}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={searchPlaceholder ?? t('image-generation.components.nai.saved.image.browser.section.search.name.description')}
          className="max-w-md flex-1"
        />
        {sort ? (
          <div className="w-36">
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
        <span className="text-xs tabular-nums text-muted-foreground">{items.length}</span>
      </div>

      {isLoading ? (
        <Text variant="muted">{t('image-generation.components.nai.saved.image.browser.section.loading')}</Text>
      ) : items.length > 0 ? (
        <div className="max-h-[60vh] overflow-y-auto pr-1">
          <div className="columns-2 gap-3 sm:columns-3 lg:columns-5">
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
      )}
    </div>
  )
}
