import { infiniteQueryOptions } from '@tanstack/react-query'
import { getGroupImages, nextGroupImagesCursor } from '@/lib/api-groups'
import { getImages, nextLibraryImagesCursor, searchImagesComplex, type LibraryImagesCursor } from '@/lib/api-images'
import { withPluginLendWindow } from '@/lib/plugin-lend-window'
import type { ImageRecord } from '@/types/image'

/** Inside a shared plugin page's picker, media addresses name its window (lib/plugin-lend-window). */
const lent = (images: ImageRecord[]) => images.map(image => ({ ...image, thumbnail_url: withPluginLendWindow(image.thumbnail_url), image_url: withPluginLendWindow(image.image_url) }))

type PickerCursor = LibraryImagesCursor & { cursorOrderIndex?: number | null; cursorAddedDate?: string | null }

/** Picker pages never render totals. Follow the last server sort key so additions/deletions cannot shift a page. */
export function mediaLibraryPages(groupId: number | null, search: string, tool: string, order: 'ASC' | 'DESC') {
  return infiniteQueryOptions({
    queryKey: groupId === null ? ['home-images', 'media-library', search, tool, order] : ['group-images', 'custom', groupId, 'media-library'],
    initialPageParam: {} as PickerCursor,
    queryFn: async ({ pageParam, signal }) => {
      if (groupId !== null) {
        const page = await getGroupImages(groupId, { ...pageParam, limit: 48, includeChildren: true, includeTotal: false }, { signal })
        return { images: lent(page.images), next: nextGroupImagesCursor(page) }
      }
      const searching = Boolean(search || tool)
      const params = { ...pageParam, limit: 48, sortOrder: order, pagination: 'cursor' as const, includeTotal: false }
      const page = searching ? await searchImagesComplex({
        ...params, sortBy: 'first_seen_date',
        complex_filter: {
          or_group: search ? [
            { category: 'positive_prompt', type: 'prompt_contains', value: search },
            { category: 'auto_tag', type: 'auto_tag_any', value: search, min_score: 0, max_score: 1 },
          ] : [],
          and_group: tool ? [{ category: 'basic', type: 'ai_tool_group', value: tool }] : [],
        },
      }, { signal }) : await getImages(params, { signal })
      return { images: lent(page.images), next: nextLibraryImagesCursor(page, searching) }
    },
    getNextPageParam: last => last.next,
  })
}
