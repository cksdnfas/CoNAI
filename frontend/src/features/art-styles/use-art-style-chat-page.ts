import { ART_STYLE_LIMITS, type ChatPageData, type ChatPageSchema } from '@conai/shared'
import { useChatPageRegistration, type WorkflowUndo } from '@/features/codex-chat/chat-page-context'
import { pageAction, pageArray, pageChoice, pageFreeText, pageNumber, pageObject, pageRecord, pageText } from '@/features/codex-chat/page-action-helpers'
import { useI18n } from '@/i18n'
import type { ArtStyleSort } from '@/lib/api-art-styles'
import { artStyleImageKey, isStagedArtStyleImage, type ArtStyleDraft, type ArtStyleDraftImage } from './use-art-style-editor'
import type { ArtStyleLibrary } from './use-art-style-library'

/** Styles listed (and accepted as choices): the latest loaded ones, like the appearance library's page. */
const STYLE_LIMIT = 200
/** Badges the page data offers as filter choices (the most used first). */
const BADGE_CHOICE_LIMIT = 30
const SORTS: ArtStyleSort[] = ['name', 'updated', 'created', 'created_asc']

/** Trimmed, each once (case-insensitive, first spelling kept), like the chip inputs. */
const terms = (value: ChatPageData | undefined) => {
  const list = Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : []
  return list.filter((term, index) => list.findIndex((other) => other.toLowerCase() === term.toLowerCase()) === index)
}

/** The page's image item tags and the draft key each one names (as artStyleImageKey builds it). */
const IMAGE_TAGS = { id: 'id', composite_hash: 'hash', file_id: 'file', upload: 'upload' } as const
/** A draft image as the page shows it: tagged by kind, a staged upload by its asset id (items go back as shown). */
const pageImageOf = (image: ArtStyleDraftImage): ChatPageData => isStagedArtStyleImage(image) ? { upload: image.id } : image

/**
 * Connects the art styles view (/characters?view=styles) to a chat: it reads the list's scope and the loaded styles,
 * opens and closes a style, fills the open style's draft (text, badges, keywords and its images as tagged items)
 * without saving, marks favorites directly, and creates, saves or deletes through review cards with the person's
 * own session. Everything goes through the same library state and actions as the screen.
 */
export function useArtStyleChatPage(library: ArtStyleLibrary) {
  const { t } = useI18n()
  const { editor, canEdit, canDelete, canViewImages, loaded, total, loadMore } = library
  const { base, draft, ready } = editor
  const listed = loaded?.slice(-STYLE_LIMIT) ?? []
  const listedIds = listed.map((style) => style.id)
  // Tags are plain strings (the page sends this schema with every view; the handler and the save check the values).
  const tag: ChatPageSchema = { type: 'string' }
  const imageItem = pageObject({ id: tag, composite_hash: tag, file_id: tag, upload: tag })
  const addItem = pageObject({ id: tag, composite_hash: tag })
  /** One image item's draft key; exactly one tag. */
  const imageKey = (value: ChatPageData) => {
    const item = pageRecord(value)
    const tags = (Object.keys(IMAGE_TAGS) as Array<keyof typeof IMAGE_TAGS>).filter((tag) => item[tag] !== undefined)
    if (tags.length !== 1) throw new Error(t({ ko: '이미지 항목은 { id }, { composite_hash }, { file_id }, { upload } 중 하나만 줘.', en: 'Give each image as one of { id }, { composite_hash }, { file_id }, { upload }.' }))
    return `${IMAGE_TAGS[tags[0]]}:${String(item[tags[0]]).trim()}`
  }
  const imageKeys = (value: ChatPageData | undefined) => Array.isArray(value) ? [...new Set(value.map(imageKey))] : []
  const termList = (chars: number, count: number) => pageArray(pageText(chars), count)

  useChatPageRegistration({
    kind: 'page',
    title: editor.open ? (base ? t({ ko: '그림 스타일 · {name}', en: 'Art style · {name}' }, { name: base.title }) : t({ ko: '새 그림 스타일', en: 'New art style' })) : t({ ko: '그림 스타일', en: 'Art styles' }),
    resourceId: editor.open ? (editor.styleId !== null ? `style:${editor.styleId}` : 'style:new') : 'styles',
    priority: editor.open ? 10 : 0,
    dirty: editor.dirty,
    fields: [],
    data: {
      query: library.query,
      badges: library.badges,
      favoriteOnly: library.favoriteOnly,
      sort: library.sort,
      badgeChoices: library.badgeList.slice(0, BADGE_CHOICE_LIMIT).map((entry) => ({ badge: entry.badge, count: entry.count })),
      styles: loaded ? {
        total: total ?? loaded.length,
        hasMore: Boolean(loadMore),
        offset: loaded.length - listed.length,
        items: listed.map((style) => ({ id: style.id, title: pageFreeText(style.title), description: pageFreeText(style.description), badges: style.badges, imageCount: style.imageCount, favorite: style.favorite, revision: style.revision })),
      } : null,
      selected: !editor.open ? null : !ready ? { ready: false, id: editor.styleId } : {
        ready: true,
        id: base?.id ?? null,
        revision: base?.revision ?? null,
        dirty: editor.dirty,
        busy: editor.busy,
        favorite: base?.favorite ?? false,
        title: pageFreeText(draft.title),
        description: pageFreeText(draft.description),
        badges: draft.badges,
        keywords: draft.keywords,
        positive: pageFreeText(draft.positive),
        negative: pageFreeText(draft.negative),
        images: canViewImages ? draft.images.map(pageImageOf) : [],
      },
    } as Record<string, ChatPageData>,
    actions: [
      pageAction('art_style.filter', t({ ko: '스타일 목록 필터·정렬', en: 'Filter and sort styles' }), t({ ko: '검색어(낱말마다 제목·설명·배지·검색어 중 하나와 맞아야 해), 배지(모두 붙은 스타일만, data.badgeChoices에서), 즐겨찾기만, 정렬을 바꿔. 주어진 항목만 바뀌고 열린 스타일은 그대로야.', en: 'Change the query (each word must match a title, description, badge or keyword), badges (all must be on the style; from data.badgeChoices), favorites only and the sort. Only given fields change; an open style stays open.' }), pageObject({ query: pageText(200), badges: termList(ART_STYLE_LIMITS.badge, ART_STYLE_LIMITS.badges), favoriteOnly: { type: 'boolean' }, sort: pageChoice(SORTS) })),
      ...(loadMore ? [pageAction('art_style.load_more', t({ ko: '스타일 더 불러오기', en: 'Load more styles' }), t({ ko: '목록의 다음 묶음을 불러와. data.styles.items는 마지막으로 불러온 최대 {limit}개이고 offset은 그 첫 스타일의 위치야.', en: 'Load the next batch; data.styles.items holds the latest {limit} loaded styles at most and offset is the first one’s position.' }, { limit: STYLE_LIMIT }), pageObject({}))] : []),
      pageAction('art_style.open', t({ ko: '스타일 열기', en: 'Open style' }), t({ ko: '스타일을 상세 창으로 열어. 초안은 data.selected야.', en: 'Open a style in its window; its draft is data.selected.' }), pageObject({ styleId: pageNumber(1, undefined, true) }, ['styleId'])),
      ...(editor.open ? [pageAction('art_style.close', t({ ko: '스타일 닫기', en: 'Close style' }), t({ ko: '열린 스타일 창을 닫아.', en: 'Close the open style window.' }), pageObject({}))] : []),
      ...(canEdit ? [
        pageAction('art_style.create', t({ ko: '새 스타일 만들기', en: 'Create style' }), t({ ko: '제목으로 새 스타일을 만들고 열어. 같은 제목은 거절돼.', en: 'Create a style with this title and open it; a taken title is refused.' }), pageObject({ title: pageText(ART_STYLE_LIMITS.title) }, ['title']), 'save'),
        ...(listedIds.length ? [pageAction('art_style.favorite', t({ ko: '즐겨찾기 표시', en: 'Mark favorites' }), t({ ko: 'data.styles의 스타일에 즐겨찾기를 켜거나 꺼. 바로 반영돼.', en: 'Turn the favorite mark of listed styles on or off; applies at once.' }), pageObject({ styleIds: pageArray(pageChoice(listedIds), listedIds.length, 1), favorite: { type: 'boolean' } }, ['styleIds', 'favorite']), 'save')] : []),
        ...(editor.open && ready ? [
          pageAction('art_style.draft', t({ ko: '스타일 초안 채우기', en: 'Fill style draft' }), t({ ko: '열린 스타일 초안의 주어진 항목만 바꿔. 배지·검색어는 목록 전체를 바꿔. 저장하지 않아.', en: 'Change only the given fields of the open style’s draft; badges and keywords replace the whole list. Nothing is saved.' }), pageObject({
            title: pageText(ART_STYLE_LIMITS.title), description: pageText(ART_STYLE_LIMITS.description),
            badges: termList(ART_STYLE_LIMITS.badge, ART_STYLE_LIMITS.badges), keywords: termList(ART_STYLE_LIMITS.keyword, ART_STYLE_LIMITS.keywords),
            positive: pageText(ART_STYLE_LIMITS.prompt), negative: pageText(ART_STYLE_LIMITS.prompt),
          })),
          ...(canViewImages ? [pageAction('art_style.images', t({ ko: '스타일 이미지 편집', en: 'Edit style images' }), t({ ko: '초안의 이미지를 selected.images의 항목으로 바꿔: remove로 빼고 add({ composite_hash } 라이브러리 이미지, 저장된 { id })로 끝에 넣고, order는 남은 이미지 전체의 새 순서, cover는 맨 앞(대표)으로 옮길 이미지야. 저장할 때 스타일로 복사돼. 저장하지 않아.', en: 'Edit the draft’s images with selected.images items: remove drops, add appends ({ composite_hash } a library image, or a saved { id }), order is the new order of every remaining image, cover moves one to the front. A save copies them into the style. Nothing is saved.' }), pageObject({ remove: pageArray(imageItem, ART_STYLE_LIMITS.images), add: pageArray(addItem, ART_STYLE_LIMITS.images), order: pageArray(imageItem, ART_STYLE_LIMITS.images), cover: imageItem }))] : []),
          pageAction('art_style.save', t({ ko: '스타일 저장', en: 'Save style' }), t({ ko: '열린 스타일의 지금 초안을 selected.revision 기준으로 저장해.', en: 'Save the open style’s draft against selected.revision.' }), pageObject({}), 'save'),
          ...(base && canDelete ? [pageAction('art_style.delete', t({ ko: '스타일 삭제', en: 'Delete style' }), t({ ko: '열린 스타일을 지워. 참조 이미지도 함께 지워져.', en: 'Delete the open style with its reference images.' }), pageObject({}), 'save')] : []),
        ] : []),
      ] : []),
    ],
    apply: () => {},
    applyAction: async (id, args, assertCurrent): Promise<WorkflowUndo | void> => {
      assertCurrent()
      if (editor.isBusy() && !['art_style.filter', 'art_style.load_more'].includes(id)) throw new Error(t({ ko: '이미지 작업이나 저장이 끝난 뒤 다시 해줘.', en: 'Wait for the image operation or save to finish.' }))
      if (id === 'art_style.filter') {
        library.setListView({
          ...(args.query !== undefined ? { query: String(args.query) } : {}),
          ...(args.sort !== undefined ? { sort: String(args.sort) as ArtStyleSort } : {}),
          ...(args.favoriteOnly !== undefined ? { favorite: args.favoriteOnly === true } : {}),
          ...(args.badges !== undefined ? { badges: terms(args.badges) } : {}),
        })
        return
      }
      if (id === 'art_style.load_more') {
        if (!loadMore) throw new Error(t({ ko: '목록을 이미 다 불러왔어.', en: 'Everything is loaded already.' }))
        await loadMore()
        return
      }
      if (id === 'art_style.open') { library.openStyle(Number(args.styleId)); return }
      if (id === 'art_style.close') { library.closeStyle(); return }
      if (id === 'art_style.create') { await library.create(String(args.title ?? '')); return }
      if (id === 'art_style.favorite') { await library.bulk({ action: 'favorite', ids: Array.isArray(args.styleIds) ? args.styleIds.map(Number) : [], favorite: args.favorite === true }); return }
      if (!editor.open) throw new Error(t({ ko: '스타일을 먼저 열어줘 (art_style.open).', en: 'Open a style first (art_style.open).' }))
      if (!ready) throw new Error(t({ ko: '스타일을 아직 불러오는 중이야. 잠시 뒤 다시 해줘.', en: 'The style is still loading. Try again shortly.' }))
      if (id === 'art_style.save') { await editor.save(); return }
      if (id === 'art_style.delete') { await editor.remove(false); return }
      const current = editor.draftRef.current
      const next: Partial<ArtStyleDraft> = {}
      if (id === 'art_style.draft') {
        const input = pageRecord(args)
        for (const key of ['title', 'description', 'positive', 'negative'] as const) if (input[key] !== undefined) next[key] = String(input[key])
        if (input.badges !== undefined) next.badges = terms(input.badges)
        if (input.keywords !== undefined) next.keywords = terms(input.keywords)
      } else if (id === 'art_style.images') {
        if (!canViewImages) throw new Error(t({ ko: '이미지를 편집할 권한이 없어.', en: 'You do not have permission to edit images.' }))
        const byKey = new Map(current.images.map((image) => [artStyleImageKey(image), image]))
        const saved = new Set((editor.baseRef.current?.images ?? []).map((image) => `id:${image.id}`))
        const remove = new Set(imageKeys(args.remove))
        let images = [...byKey.keys()].filter((key) => !remove.has(key))
        for (const key of imageKeys(args.add)) {
          if (images.includes(key)) continue
          if (key.startsWith('hash:')) byKey.set(key, { composite_hash: key.slice('hash:'.length) })
          else if (saved.has(key)) byKey.set(key, { id: key.slice('id:'.length) })
          else throw new Error(t({ ko: 'add에는 { composite_hash }나 저장된 스타일의 { id }만 줘.', en: 'add takes { composite_hash } or an { id } of the saved style.' }))
          images.push(key)
        }
        if (args.order !== undefined) {
          const order = imageKeys(args.order)
          if (order.length !== images.length || order.some((key) => !images.includes(key))) throw new Error(t({ ko: 'order에는 남는 이미지를 빠짐없이 한 번씩 넣어줘.', en: 'order must list every remaining image once.' }))
          images = order
        }
        if (args.cover !== undefined) {
          const cover = imageKey(args.cover)
          if (!images.includes(cover)) throw new Error(t({ ko: '대표로 정할 이미지가 초안에 없어.', en: 'The cover image is not in the draft.' }))
          images = [cover, ...images.filter((key) => key !== cover)]
        }
        if (images.length > ART_STYLE_LIMITS.images) throw new Error(t({ ko: '이미지는 {count}장까지야.', en: 'At most {count} images.' }, { count: ART_STYLE_LIMITS.images }))
        next.images = images.map((key) => byKey.get(key)!)
      } else throw new Error(t({ ko: '그림 스타일에 없는 작업이야.', en: 'Not an art style operation.' }))
      const keys = Object.keys(next) as Array<keyof ArtStyleDraft>
      if (!keys.length) throw new Error(t({ ko: '바꿀 항목이 없어.', en: 'Nothing to change.' }))
      editor.patch(next)
      return {
        isCurrent: () => keys.every((key) => JSON.stringify(editor.draftRef.current[key]) === JSON.stringify(next[key])),
        restore: () => editor.patch(Object.fromEntries(keys.map((key) => [key, current[key]])) as Partial<ArtStyleDraft>),
      }
    },
  })
}
