import { CHARACTER_APPEARANCE_SECTION_KEYS, CHAT_PROFILE_TEXT_LIMITS, composeCharacterAppearance, type CharacterSettingBulkInput, type ChatPageData } from '@conai/shared'
import { useChatPageRegistration, type WorkflowUndo } from '@/features/codex-chat/chat-page-context'
import { pageAction, pageArray, pageChoice, pageNumber, pageObject, pageRecord, pageText } from '@/features/codex-chat/page-action-helpers'
import { useI18n } from '@/i18n'
import { fillCharacterAppearance, type CharacterFacetKey, type CharacterFolder, type CharacterLibraryFacets, type CharacterSettingFilters, type CharacterSettingPage, type CharacterSettingSort } from '@/lib/api-character-library'
import { localizedTagName, type SettingDraft } from './character-library-shared'
import type { CharacterSettingEditorState } from './use-character-setting-editor'
import type { CharacterAppearanceTab } from '@/features/settings/components/character-appearance-editor'
import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { editReferenceDraft, type ReferenceEdit } from './character-reference-draft'

/** Tags per dimension the page data lists as filter choices (the most common first). */
const FACET_CHOICE_LIMIT = 30

/** Folders listed (and accepted as choices); the open folder's path, its subfolders and the draft's folder come first. */
const FOLDER_LIMIT = 300

/** Settings listed (and accepted as choices): the latest loaded ones, as many as the paged list's largest page held. */
const SETTING_LIMIT = 200

/**
 * Connects 캐릭터 라이브러리 to a chat: it reads the open folder (path, subfolders, the loaded settings with their
 * revisions, more on request) and the open editor, moves between folders and settings, fills the editor's draft without
 * saving, and saves, deletes or arranges folders through review cards with the person's own session.
 */
export function useCharacterLibraryChatPage({ folders, folderId, path, subfolders, query, settings, loadMore, editor, canEdit, editorTab, setEditorTab, openFolder, search, openSetting, newSetting, createFolder, renameFolder, moveFolder, sort, favoriteOnly, filters, facets, setListView, bulk }: {
  sort: CharacterSettingSort
  favoriteOnly: boolean
  filters: CharacterSettingFilters
  facets: CharacterLibraryFacets | undefined
  setListView: (changes: { sort?: CharacterSettingSort; favorite?: boolean; filters?: CharacterSettingFilters }) => void
  bulk: (input: CharacterSettingBulkInput) => Promise<unknown>
  folders: CharacterFolder[]
  folderId: number | null
  path: CharacterFolder[]
  subfolders: CharacterFolder[]
  query: string
  /** The settings loaded in the list so far (undefined until the first batch lands). */
  settings: CharacterSettingPage | undefined
  /** Loads the list's next batch; null when everything is loaded. */
  loadMore: (() => Promise<unknown>) | null
  editor: CharacterSettingEditorState
  canEdit: boolean
  editorTab: CharacterAppearanceTab
  setEditorTab: (tab: CharacterAppearanceTab) => void
  openFolder: (folderId: number | null) => void
  search: (query: string) => void
  openSetting: (settingId: number) => void
  newSetting: (folderId: number | null) => void
  createFolder: (parentId: number | null, name: string) => Promise<unknown>
  renameFolder: (folder: CharacterFolder, name: string) => Promise<unknown>
  moveFolder: (folder: CharacterFolder, parentId: number | null) => Promise<unknown>
}) {
  const { t, language } = useI18n()
  const { canViewImages } = useImagePermissions()
  const { base, draft, ready } = editor
  const targetSettingId = editor.target && 'settingId' in editor.target ? editor.target.settingId : null
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  const pinned = [...path.map((folder) => folder.id), ...subfolders.map((folder) => folder.id), ready ? draft.folderId : null, base?.folderId ?? null]
  const listedIds = [...new Set([...pinned.filter((id): id is number => id !== null && byId.has(id)), ...folders.map((folder) => folder.id)])].slice(0, FOLDER_LIMIT)
  const listed = listedIds.map((id) => byId.get(id)!)
  const folderChoice = { ...pageChoice([0, ...listedIds]), description: '0: the top level; one of data.folders' }
  const hashSchema = { ...pageText(128), description: 'Library composite hash; empty clears' }
  const folderName = pageText(CHAT_PROFILE_TEXT_LIMITS.name)
  const listedSettings = settings?.items.slice(-SETTING_LIMIT) ?? []
  const listedSettingIds = listedSettings.map((setting) => setting.id)

  const sectionText = pageText(CHAT_PROFILE_TEXT_LIMITS.text)
  const draftSchema = pageObject({
    name: pageText(CHAT_PROFILE_TEXT_LIMITS.name),
    folderId: folderChoice,
    sections: { ...pageObject(Object.fromEntries(CHARACTER_APPEARANCE_SECTION_KEYS.map((key) => [key, sectionText]))), description: 'Comma-separated tags per section; given sections replace, others stay. identity: character/work tags and 1girl…; traits: species, kemonomimi, roles; other: unsorted' },
    outfits: { ...pageArray(pageObject({ name: pageText(CHAT_PROFILE_TEXT_LIMITS.name), tags: sectionText }, ['name', 'tags'])), description: 'The whole outfit list (clothing/accessory tags); the first is the default profiles and generation use' },
    referenceHash: hashSchema,
    avatarHash: hashSchema,
    avatarCrop: { ...pageObject({ x: pageNumber(0, 100), y: pageNumber(0, 100), scale: pageNumber(1, 4) }, ['x', 'y', 'scale']), description: 'Square avatar crop of avatarHash: x/y percent of the overflow, scale 1–4' },
  })

  useChatPageRegistration({
    kind: 'page',
    title: editor.open
      ? (base ? t({ ko: '외형 설정 · {name}', en: 'Appearance setting · {name}' }, { name: base.name }) : targetSettingId !== null ? t({ ko: '외형 설정', en: 'Appearance setting' }) : t({ ko: '새 외형 설정', en: 'New appearance setting' }))
      : [t({ ko: '캐릭터 라이브러리', en: 'Character library' }), ...path.map((folder) => folder.name)].join(' / '),
    resourceId: editor.open ? (targetSettingId !== null ? `setting:${targetSettingId}` : `setting:new:${editor.draftSerial}`) : query ? 'search' : `folder:${folderId ?? 'root'}`,
    priority: editor.open ? 10 : 0,
    dirty: editor.dirty,
    fields: [],
    data: {
      editor: { open: editor.open, tab: editor.open ? editorTab : null, busy: editor.busy },
      view: query ? 'search' : favoriteOnly || Object.keys(filters).length ? 'filtered' : 'folder',
      query,
      sort,
      favoriteOnly,
      filters: filters as Record<string, ChatPageData>,
      filterChoices: facets?.available ? facets.dimensions.map((dimension) => ({ key: dimension.key, values: dimension.values.slice(0, FACET_CHOICE_LIMIT).map((value) => ({ tag: value.tag, label: localizedTagName(language, value.label, value.translated), count: value.count ?? 0 })) })) : null,
      folder: { id: folderId ?? 0, path: path.map((folder) => folder.name) },
      subfolders: query ? [] : subfolders.slice(0, FOLDER_LIMIT).map((folder) => ({ id: folder.id, name: folder.name, settingCount: folder.settingCount })),
      folders: listed.map((folder) => ({ id: folder.id, name: folder.name, parentId: folder.parentId ?? 0 })),
      foldersTotal: folders.length,
      settings: settings ? {
        total: settings.total,
        hasMore: settings.hasMore,
        offset: settings.items.length - listedSettings.length,
        items: listedSettings.map((setting) => ({ id: setting.id, name: setting.name, folderId: setting.folderId ?? 0, revision: setting.revision, favorite: setting.favorite, linkedProfileCount: setting.linkedProfileCount, hasReference: Boolean(setting.referenceHash), hasAvatar: Boolean(setting.avatarHash) })),
      } : null,
      selected: !editor.open ? null : !ready ? { ready: false, id: targetSettingId } : {
        ready: true,
        saved: Boolean(base),
        id: base?.id ?? null,
        revision: base?.revision ?? null,
        dirty: editor.dirty,
        path: base?.path ?? [],
        name: draft.name,
        folderId: draft.folderId ?? 0,
        sections: draft.sections,
        outfits: draft.outfits,
        appearance: composeCharacterAppearance(draft),
        favorite: base?.favorite ?? false,
        referenceHash: draft.referenceHash,
        references: canViewImages ? draft.references : [],
        referenceCategories: draft.referenceCategories,
        avatarHash: draft.avatarHash,
        avatarCrop: draft.avatarCrop,
        expressionGroupId: base?.expressionGroupId ?? null,
        candidateGroupId: base?.candidateGroupId ?? null,
        linkedProfileCount: base?.linkedProfileCount ?? 0,
        linkedProfiles: (base?.linkedProfiles ?? []).map((profile) => ({ id: profile.id, name: profile.name })),
      },
    } as Record<string, ChatPageData>,
    actions: [
      pageAction('character.open_folder', t({ ko: '폴더 열기', en: 'Open folder' }), t({ ko: '폴더(0은 최상위)를 열어. 외형 설정 목록은 첫 묶음부터 보여.', en: 'Open a folder (0: top level); its settings list starts from the first batch.' }), pageObject({ folderId: folderChoice }, ['folderId'])),
      pageAction('character.search', t({ ko: '외형 설정 검색', en: 'Search settings' }), t({ ko: '라이브러리 전체에서 이름·태그·한국어 태그 이름으로 외형 설정을 찾아. 빈 검색어는 검색을 끝내.', en: 'Find settings by name, tag or Korean tag name across the library; an empty query ends the search.' }), pageObject({ query: pageText(200) }, ['query'])),
      ...(loadMore ? [pageAction('character.load_more', t({ ko: '외형 설정 더 불러오기', en: 'Load more settings' }), t({ ko: '목록의 다음 묶음을 불러와. data.settings.items는 마지막으로 불러온 최대 {limit}개이고 offset은 그 첫 설정의 위치야. hasMore가 false면 다 불러온 거야.', en: 'Load the next batch; data.settings.items holds the latest {limit} loaded settings at most and offset is the first one’s position. hasMore false means everything is loaded.' }, { limit: SETTING_LIMIT }), pageObject({}))] : []),
      pageAction('character.filter', t({ ko: '목록 필터·정렬', en: 'Filter and sort' }), t({ ko: '정렬, 즐겨찾기만 보기, 태그 필터({차원: [태그]}, data.filterChoices에서 골라. 같은 차원은 하나라도, 차원끼리는 모두)를 바꿔. 필터와 즐겨찾기는 라이브러리 전체에서 찾아. 주어진 항목만 바뀌어.', en: 'Change the sort, favorites-only and tag filters ({dimension: [tags]} from data.filterChoices; any tag of a dimension, all dimensions). Filters look across the whole library; only given fields change.' }), pageObject({ sort: pageChoice(['name', 'updated', 'created', 'created_asc']), favoriteOnly: { type: 'boolean' }, filters: pageObject(Object.fromEntries(['copyright', 'character', 'subject', 'hairColor', 'hairLength', 'hairStyle', 'eyeColor', 'skinColor', 'species', 'outfit'].map((key) => [key, pageArray(pageText(200), 20)]))) })),
      pageAction('character.open_setting', t({ ko: '외형 설정 열기', en: 'Open setting' }), t({ ko: '외형 설정을 상세 창으로 열어.', en: 'Open a setting in its detail dialog.' }), pageObject({ settingId: pageNumber(1, undefined, true) }, ['settingId'])),
      ...(editor.open && ready ? [pageAction('character.editor_tab', t({ ko: '상세 탭 열기', en: 'Open detail tab' }), t({ ko: '열린 외형 설정의 탭을 바꿔. 초안은 그대로 둬.', en: 'Switch the open setting’s tab without changing the draft.' }), pageObject({ tab: pageChoice(['tags', 'images', 'expressions', 'candidates']) }, ['tab']))] : []),
      ...(canEdit ? [
        pageAction('character.folder_create', t({ ko: '폴더 만들기', en: 'Create folder' }), t({ ko: '상위 폴더(0은 최상위) 안에 폴더를 만들어. 같은 이름의 형제 폴더는 거절돼.', en: 'Create a folder inside a parent (0: top level); duplicate sibling names are refused.' }), pageObject({ name: folderName, parentId: folderChoice }, ['name', 'parentId']), 'save'),
        ...(listedIds.length ? [
          pageAction('character.folder_rename', t({ ko: '폴더 이름 바꾸기', en: 'Rename folder' }), t({ ko: 'data.folders의 폴더 이름을 바꿔.', en: 'Rename a folder from data.folders.' }), pageObject({ folderId: pageChoice(listedIds), name: folderName }, ['folderId', 'name']), 'save'),
          pageAction('character.folder_move', t({ ko: '폴더 옮기기', en: 'Move folder' }), t({ ko: '폴더를 다른 상위 폴더(0은 최상위)로 옮겨. 자기 자신이나 하위 폴더로는 못 옮겨. 폴더 삭제는 propose_character_library(delete_folder)로 제안해.', en: 'Move a folder under another parent (0: top level); not into itself or a subfolder. Delete folders with propose_character_library(delete_folder).' }), pageObject({ folderId: pageChoice(listedIds), parentId: folderChoice }, ['folderId', 'parentId']), 'save'),
        ] : []),
        pageAction('character.new_setting', t({ ko: '새 외형 설정', en: 'New setting' }), t({ ko: '폴더(0은 최상위)에 새 외형 설정 초안을 열어. 저장하지 않아.', en: 'Open a new setting draft in a folder (0: top level); nothing is saved.' }), pageObject({ folderId: folderChoice }, ['folderId'])),
        ...(listedSettingIds.length ? [
          pageAction('character.favorite', t({ ko: '즐겨찾기 표시', en: 'Mark favorites' }), t({ ko: 'data.settings의 외형 설정에 즐겨찾기를 켜거나 꺼. 바로 반영돼.', en: 'Turn the favorite mark of listed settings on or off; applies at once.' }), pageObject({ settingIds: pageArray(pageChoice(listedSettingIds), listedSettingIds.length, 1), favorite: { type: 'boolean' } }, ['settingIds', 'favorite']), 'save'),
          pageAction('character.bulk_move', t({ ko: '여러 외형 설정 옮기기', en: 'Move settings' }), t({ ko: 'data.settings의 외형 설정 여러 개를 폴더(0은 최상위)로 옮겨. 대상 폴더에 같은 이름이 있으면 전부 거절돼.', en: 'Move listed settings into a folder (0: top level); a taken name refuses the whole move.' }), pageObject({ settingIds: pageArray(pageChoice(listedSettingIds), listedSettingIds.length, 1), folderId: folderChoice }, ['settingIds', 'folderId']), 'save'),
          pageAction('character.bulk_delete', t({ ko: '여러 외형 설정 삭제', en: 'Delete settings' }), t({ ko: 'data.settings의 외형 설정 여러 개를 지워. 연결된 프로필은 지금 값의 사본을 유지하고 이미지는 남아.', en: 'Delete listed settings; linked profiles keep a copy and images stay.' }), pageObject({ settingIds: pageArray(pageChoice(listedSettingIds), listedSettingIds.length, 1) }, ['settingIds']), 'save'),
        ] : []),
        ...(editor.open && ready ? [
          pageAction('character.draft', t({ ko: '외형 설정 초안 채우기', en: 'Fill setting draft' }), t({ ko: '열린 편집기의 주어진 항목만 채워. 저장하지 않아.', en: 'Fill only the given fields of the open editor; nothing is saved.' }), draftSchema),
          ...(canViewImages ? [
            pageAction('character.references_add', t({ ko: '참고 이미지 추가', en: 'Add reference images' }), t({ ko: '라이브러리 composite hash로 참고 이미지를 초안에 추가해. category는 기존 분류 이름이고, 비우면 미분류야. character.save로 저장해.', en: 'Add library composite hashes to the draft gallery. category is an existing name; empty means uncategorized. Save with character.save.' }), pageObject({ hashes: pageArray(pageText(128)), category: pageText() }, ['hashes'])),
            pageAction('character.reference_category', t({ ko: '참고 이미지 분류 바꾸기', en: 'Categorize reference image' }), t({ ko: '참고 이미지 한 장의 분류를 바꿔. 빈 분류는 미분류야. 저장하지 않아.', en: 'Change a reference image’s category; empty means uncategorized. Nothing is saved.' }), pageObject({ hash: pageText(128), category: pageText() }, ['hash', 'category'])),
            pageAction('character.reference_remove', t({ ko: '참고 이미지 빼기', en: 'Remove reference image' }), t({ ko: '갤러리 초안에서만 빼. 라이브러리의 이미지는 지우지 않아.', en: 'Remove from the gallery draft, not from the image library.' }), pageObject({ hash: pageText(128) }, ['hash'])),
            pageAction('character.reference_set', t({ ko: '기준 이미지 정하기', en: 'Set main reference' }), t({ ko: '갤러리의 한 장을 기준 이미지로 정해. 저장하지 않아.', en: 'Use one gallery image as the main reference. Nothing is saved.' }), pageObject({ hash: pageText(128) }, ['hash'])),
            pageAction('character.category_add', t({ ko: '이미지 분류 추가', en: 'Add image category' }), t({ ko: '갤러리에 분류 초안을 추가해. 같은 이름은 쓸 수 없어.', en: 'Add a draft gallery category. Names must be unique.' }), pageObject({ name: pageText() }, ['name'])),
            pageAction('character.category_rename', t({ ko: '이미지 분류 이름 바꾸기', en: 'Rename image category' }), t({ ko: '분류와 그 안의 이미지 분류를 함께 바꿔. 저장하지 않아.', en: 'Rename a category and its images together. Nothing is saved.' }), pageObject({ name: pageText(), next: pageText() }, ['name', 'next'])),
            pageAction('character.category_remove', t({ ko: '이미지 분류 빼기', en: 'Remove image category' }), t({ ko: '분류를 빼고 안의 이미지는 미분류로 둬. 저장하지 않아.', en: 'Remove a category; its images become uncategorized. Nothing is saved.' }), pageObject({ name: pageText() }, ['name'])),
          ] : []),
          pageAction('character.fill', t({ ko: '외형 자동 채우기', en: 'Fill appearance' }), t({ ko: '열린 편집기의 항목을 Danbooru 캐릭터(character: 영문 태그나 정확한 한국어 이름), 기준 이미지 자동 태그(image) 또는 지금 태그 다시 분류(resort)로 채워. 의상 태그는 기본 의상에 들어가. 저장하지 않아.', en: 'Fill the open editor from a Danbooru character (character: tag or exact Korean name), the reference image tags (image) or a re-sort of the current tags (resort); outfit tags go to the default outfit. Nothing is saved.' }), pageObject({ source: pageChoice(['danbooru', 'image', 'resort']), character: pageText(200) }, ['source'])),
          pageAction('character.save', t({ ko: '외형 설정 저장', en: 'Save setting' }), t({ ko: '편집기의 현재 초안을 저장해. 기존 설정은 selected.revision 기준이고, 그사이 바뀌었으면 거절돼.', en: 'Save the editor draft as it is; an existing setting saves against selected.revision and is refused if it changed.' }), pageObject({}), 'save'),
          ...(base ? [pageAction('character.delete', t({ ko: '외형 설정 삭제', en: 'Delete setting' }), t({ ko: '열린 외형 설정을 지워. 연결된 프로필은 지금 값의 사본을 유지해.', en: 'Delete the open setting; linked profiles keep a copy of its values.' }), pageObject({}), 'save')] : []),
        ] : []),
      ] : []),
    ],
    apply: () => {},
    applyAction: async (id, args, assertCurrent): Promise<WorkflowUndo | void> => {
      assertCurrent()
      if (editor.isBusy() && !['character.search', 'character.filter', 'character.load_more'].includes(id)) throw new Error(t({ ko: '이미지 작업이나 저장이 끝난 뒤 다시 해줘.', en: 'Wait for the image operation or save to finish.' }))
      const folderArg = (value: ChatPageData | undefined) => (Number(value) > 0 ? Number(value) : null)
      if (id === 'character.open_folder') { openFolder(folderArg(args.folderId)); return }
      if (id === 'character.search') { search(String(args.query ?? '')); return }
      if (id === 'character.load_more') {
        if (!loadMore) throw new Error('목록을 이미 다 불러왔어.')
        await loadMore()
        return
      }
      if (id === 'character.open_setting') { openSetting(Number(args.settingId)); return }
      if (id === 'character.new_setting') { newSetting(folderArg(args.folderId)); return }
      if (id === 'character.filter') {
        setListView({
          ...(args.sort !== undefined ? { sort: String(args.sort) as CharacterSettingSort } : {}),
          ...(args.favoriteOnly !== undefined ? { favorite: args.favoriteOnly === true } : {}),
          ...(args.filters !== undefined ? { filters: Object.fromEntries(Object.entries(pageRecord(args.filters)).map(([key, tags]) => [key as CharacterFacetKey, Array.isArray(tags) ? tags.map(String) : []]).filter(([, tags]) => tags.length)) } : {}),
        })
        return
      }
      const settingIdsArg = () => (Array.isArray(args.settingIds) ? args.settingIds.map(Number) : [])
      if (id === 'character.favorite') { await bulk({ action: 'favorite', ids: settingIdsArg(), favorite: args.favorite === true }); return }
      if (id === 'character.bulk_move') { await bulk({ action: 'move', ids: settingIdsArg(), folderId: folderArg(args.folderId) }); return }
      if (id === 'character.bulk_delete') { await bulk({ action: 'delete', ids: settingIdsArg() }); return }
      if (id === 'character.folder_create') { await createFolder(folderArg(args.parentId), String(args.name ?? '')); return }
      if (id === 'character.folder_rename' || id === 'character.folder_move') {
        const folder = byId.get(Number(args.folderId))
        if (!folder) throw new Error('폴더를 찾을 수 없어. 목록을 다시 확인해줘.')
        await (id === 'character.folder_rename' ? renameFolder(folder, String(args.name ?? '')) : moveFolder(folder, folderArg(args.parentId)))
        return
      }
      if (!editor.open) throw new Error('외형 설정 편집기를 먼저 열어줘 (character.open_setting / character.new_setting).')
      if (!ready) throw new Error('외형 설정을 아직 불러오는 중이야. 잠시 뒤 다시 해줘.')
      if (id === 'character.editor_tab') { setEditorTab(String(args.tab) as CharacterAppearanceTab); return }
      if (id === 'character.save') { await editor.save(); return }
      if (id === 'character.delete') { await editor.remove(false); return }
      let next: Partial<SettingDraft> = {}
      const galleryEdit: ReferenceEdit | null = id === 'character.references_add' ? { kind: 'add', hashes: Array.isArray(args.hashes) ? args.hashes.map(String) : [], category: String(args.category ?? '') || null }
        : id === 'character.reference_category' ? { kind: 'category', hash: String(args.hash), category: String(args.category) || null }
          : id === 'character.reference_remove' ? { kind: 'remove', hash: String(args.hash) }
            : id === 'character.reference_set' ? { kind: 'reference', hash: String(args.hash) }
              : id === 'character.category_add' ? { kind: 'add-category', name: String(args.name) }
                : id === 'character.category_rename' ? { kind: 'rename-category', name: String(args.name), next: String(args.next) }
                  : id === 'character.category_remove' ? { kind: 'remove-category', name: String(args.name) } : null
      if (galleryEdit) {
        if (!canEdit || !canViewImages) throw new Error(t({ ko: '참고 이미지를 편집할 권한이 없어.', en: 'You do not have permission to edit reference images.' }))
        next = editReferenceDraft(editor.draftRef.current, galleryEdit)
      } else if (id === 'character.fill') {
        const current = editor.draftRef.current
        const source = String(args.source)
        const fill = source === 'danbooru' ? await fillCharacterAppearance({ source: 'danbooru', character: String(args.character ?? '').trim() || current.name })
          : source === 'image' ? (current.referenceHash ? await fillCharacterAppearance({ source: 'image', imageHash: current.referenceHash }) : null)
            : await fillCharacterAppearance({ source: 'text', text: CHARACTER_APPEARANCE_SECTION_KEYS.map((key) => current.sections[key]).filter(Boolean).join(', ') })
        if (!fill) throw new Error('기준 이미지가 없어. 먼저 referenceHash를 정해줘.')
        const [first, ...rest] = current.outfits
        const outfitTags = source === 'resort' ? [first?.tags ?? '', fill.outfitTags].filter(Boolean).join(', ') : fill.outfitTags
        next.sections = fill.sections
        if (outfitTags) next.outfits = first ? [{ ...first, tags: outfitTags }, ...rest] : [{ name: '기본', tags: outfitTags }]
        if (fill.name && !current.name.trim()) next.name = fill.name
      } else if (id !== 'character.draft') throw new Error('캐릭터 라이브러리에 없는 작업이야.')
      const input = id === 'character.draft' ? pageRecord(args) : {}
      if (input.name !== undefined) next.name = String(input.name)
      if (input.folderId !== undefined) next.folderId = folderArg(input.folderId)
      if (input.sections !== undefined) next.sections = { ...editor.draftRef.current.sections, ...Object.fromEntries(Object.entries(pageRecord(input.sections)).filter(([key]) => (CHARACTER_APPEARANCE_SECTION_KEYS as readonly string[]).includes(key)).map(([key, value]) => [key, String(value)])) }
      if (input.outfits !== undefined) next.outfits = (Array.isArray(input.outfits) ? input.outfits : []).map((outfit) => { const value = pageRecord(outfit); return { name: String(value.name), tags: String(value.tags) } })
      if (input.referenceHash !== undefined) next.referenceHash = String(input.referenceHash) || null
      if (input.avatarHash !== undefined) next.avatarHash = String(input.avatarHash) || null
      if (input.avatarCrop !== undefined) { const crop = pageRecord(input.avatarCrop); next.avatarCrop = { x: Number(crop.x), y: Number(crop.y), scale: Number(crop.scale) } }
      const keys = Object.keys(next) as Array<keyof SettingDraft>
      if (!keys.length) throw new Error('채울 항목이 없어.')
      const before = editor.draftRef.current
      editor.patch(next)
      return {
        isCurrent: () => keys.every((key) => JSON.stringify(editor.draftRef.current[key]) === JSON.stringify(next[key])),
        restore: () => editor.patch(Object.fromEntries(keys.map((key) => [key, before[key]])) as Partial<SettingDraft>),
      }
    },
  })
}
