import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { SearchField } from '@/components/common/search-field'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { ListRow } from '@/components/ui/list-row'
import { LoadingState } from '@/components/ui/loading-state'
import { Modal, ModalBody } from '@/components/ui/modal'
import { useI18n } from '@/i18n'
import { getDanbooruBrowserCharacters } from '@/lib/api-danbooru-browser'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import type { DanbooruBrowserCharacterRecord } from '@/types/danbooru-browser'

/** Matches shown while typing; more specific text narrows them (the catalog tab browses everything). */
const PICKER_RESULT_LIMIT = 20

/** Pick a Danbooru character by English tag name or Korean name (most posts first); `initialQuery` starts the search. */
export function DanbooruCharacterPicker({ initialQuery, onPick, onClose }: {
  initialQuery: string
  onPick: (character: DanbooruBrowserCharacterRecord) => void
  onClose: () => void
}) {
  const { t, formatNumber } = useI18n()
  const [text, setText] = useState(initialQuery)
  const query = useDebouncedValue(text.trim(), 300)
  const result = useQuery({
    queryKey: ['character-library', 'danbooru-picker', query],
    queryFn: () => getDanbooruBrowserCharacters({ query, page: 1, limit: PICKER_RESULT_LIMIT, relatedTagLimit: 0 }),
    enabled: query.length > 0,
    placeholderData: keepPreviousData,
  })
  const items = result.data?.items ?? []
  return (
    <Modal open size="md" title={t({ ko: 'Danbooru 캐릭터에서 채우기', en: 'Fill from a Danbooru character' })} onClose={onClose}>
      <ModalBody spacing="sm">
        <SearchField value={text} onChange={setText} placeholder={t({ ko: '캐릭터 이름 (hatsune miku, 하츠네 미쿠…)', en: 'Character name (hatsune miku…)' })} autoFocus />
        {!query ? null : result.isPending ? <LoadingState variant="inline" /> : result.isError ? (
          <ErrorState title={t({ ko: 'Danbooru 사전을 읽지 못했어', en: 'Could not read the Danbooru dictionary' })} error={result.error} onRetry={() => void result.refetch()} />
        ) : items.length ? (
          <div>
            {items.map((item) => (
              <ListRow key={item.tagId} asChild interactive size="sm" trailing={<span className="text-xs tabular-nums">{formatNumber(item.worksCount)}</span>}>
                <button type="button" onClick={() => onPick(item)}>
                  <span className="min-w-0 truncate">{item.displayName}</span>
                  {item.translatedName ? <span className="min-w-0 truncate text-muted-foreground">{item.translatedName}</span> : null}
                  {item.copyrights[0] ? <span className="min-w-0 truncate text-xs text-muted-foreground">{item.copyrights[0].displayName}</span> : null}
                </button>
              </ListRow>
            ))}
          </div>
        ) : <EmptyState size="compact" title={t({ ko: '맞는 캐릭터가 없어. Danbooru 사전이 설치되어 있는지도 확인해줘.', en: 'No matching character. Check that the Danbooru dictionary is installed.' })} />}
      </ModalBody>
    </Modal>
  )
}
