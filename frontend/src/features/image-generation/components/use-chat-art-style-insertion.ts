import { useQueryClient } from '@tanstack/react-query'
import { ART_STYLE_LIMITS, type ChatPageData, type ChatPageSchema } from '@conai/shared'
import { useFeaturePermissions } from '@/features/auth/use-feature-permissions'
import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { pageAction, pageArray, pageNumber, pageObject, pageText } from '@/features/codex-chat/page-action-helpers'
import { useI18n } from '@/i18n'
import { artStyleImageUrl, artStyleQueryKey, getArtStyle, type ArtStyle, type ArtStyleImage } from '@/lib/api-art-styles'
import { buildSelectedImageDraftFromUrl } from '../image-generation-drafts'
import type { SelectedImageDraft } from '../image-generation-shared'
import { appendPromptText, type TextSegmentSpreadsheetValue } from './prompt-text-segment-helpers'
import { insertChatPageText } from './use-chat-preset-insertion'

/** One of a style's own images as a form image (a copy of its file, named after the style). */
export async function loadArtStyleImageDraft(style: Pick<ArtStyle, 'id' | 'title'>, image: Pick<ArtStyleImage, 'id'>): Promise<SelectedImageDraft> {
  const draft = await buildSelectedImageDraftFromUrl(artStyleImageUrl(style.id, image.id))
  const baseName = style.title.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'art-style'
  const extension = draft.mimeType?.split('/')[1]?.split(/[;+]/)[0]
  return { ...draft, fileName: extension ? `${baseName}.${extension}` : baseName }
}

/**
 * Page action `art_style.insert` for the generation forms, the assistant's "스타일 불러오기": read the stored style now
 * and append its prompts to the form's inputs (never replacing them), with its images only when `imageIds` asks
 * for them. The form keeps a copy; nothing links it to the style. Each form adds its target arguments and writes the
 * result through its draft transaction (undo).
 */
export function useChatArtStyleInsertion() {
  const queryClient = useQueryClient()
  const { t } = useI18n()
  const canView = useFeaturePermissions().canRead
  const { canViewImages } = useImagePermissions()

  return {
    /** Whether the form can take the style's images (the read right). */
    canImages: canViewImages,
    /** `images`: the form has somewhere for them (then `imageIds` is offered). */
    actions: (targets: Record<string, ChatPageSchema>, required: string[], description: string, images: boolean) => canView ? [pageAction(
      'art_style.insert',
      t({ ko: '그림 스타일 불러오기', en: 'Load art style' }),
      `Append an art style's prompts (styleId from list_art_styles) to this form as a copy. ${description}${images && canViewImages ? ' imageIds (images[].id from get_art_style, in order) also sets those images; none go in without it.' : ''}`,
      pageObject({ styleId: pageNumber(1, undefined, true), ...targets, ...(images && canViewImages ? { imageIds: pageArray(pageText(32), ART_STYLE_LIMITS.images, 1) } : {}) }, ['styleId', ...required]),
    )] : [],
    /** The stored style now (not a cached copy), its trimmed prompts and the requested images. `multiple`: the form takes several. */
    load: async (args: Record<string, ChatPageData>, multiple = false) => {
      if (!canView) throw new Error(t({ ko: '그림 스타일 조회 권한이 없어.', en: 'Art style view permission is required.' }))
      const styleId = Number(args.styleId)
      const style = await queryClient.fetchQuery({ queryKey: artStyleQueryKey(styleId), queryFn: ({ signal }) => getArtStyle(styleId, signal), staleTime: 0 })
      const imageIds = Array.isArray(args.imageIds) ? [...new Set(args.imageIds.map(String))] : []
      const unknown = imageIds.filter((id) => !style.images.some((image) => image.id === id))
      if (unknown.length) throw new Error(t({ ko: '이 스타일에 없는 이미지야: {ids}. get_art_style의 images[].id를 확인해줘.', en: 'Not an image of this style: {ids}. Check images[].id in get_art_style.' }, { ids: unknown.join(', ') }))
      if (!multiple && imageIds.length > 1) throw new Error(t({ ko: '이 입력엔 이미지를 한 장만 넣을 수 있어.', en: 'This input takes one image.' }))
      const positive = style.positive.trim()
      const negative = style.negative.trim()
      if (!positive && !negative && !imageIds.length) throw new Error(t({ ko: '이 스타일엔 넣을 프롬프트가 없어.', en: 'This style has no prompt to insert.' }))
      const references = await Promise.all(imageIds.map((id) => loadArtStyleImageDraft(style, { id })))
      return { style, positive, negative, references }
    },
    /** The input with `text` appended the way loading appends; unchanged when `text` is empty. */
    append: <T extends TextSegmentSpreadsheetValue>(before: T, text: string): T => {
      if (!text) return before
      return insertChatPageText('append', before, before, (current) => appendPromptText(current, text), t({ ko: '스타일을 넣으면 입력이 너무 길어져.', en: 'Inserting the style makes the input too long.' }))
    },
  }
}
