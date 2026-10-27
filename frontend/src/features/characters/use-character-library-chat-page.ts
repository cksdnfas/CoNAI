import { CHAT_PROFILE_TEXT_LIMITS, type ChatPageData } from '@conai/shared'
import { useChatPageRegistration, type WorkflowUndo } from '@/features/codex-chat/chat-page-context'
import { pageAction, pageChoice, pageNumber, pageObject, pageRecord, pageText } from '@/features/codex-chat/page-action-helpers'
import { useI18n } from '@/i18n'
import type { CharacterFolder, CharacterSettingPage } from '@/lib/api-character-library'
import type { SettingDraft } from './character-library-shared'
import type { CharacterSettingEditorState } from './use-character-setting-editor'

/** Folders listed (and accepted as choices); the open folder's path, its subfolders and the draft's folder come first. */
const FOLDER_LIMIT = 300

/**
 * Connects 캐릭터 라이브러리 to a chat: it reads the open folder (path, subfolders, one page of settings with their
 * revisions) and the open editor, moves between folders and settings, fills the editor's draft without saving, and
 * saves or deletes through review cards with the person's own session.
 */
export function useCharacterLibraryChatPage({ folders, folderId, path, subfolders, query, settingsPage, offset, editor, canEdit, openFolder, search, openSetting, newSetting }: {
  folders: CharacterFolder[]
  folderId: number | null
  path: CharacterFolder[]
  subfolders: CharacterFolder[]
  query: string
  settingsPage: CharacterSettingPage | undefined
  offset: number
  editor: CharacterSettingEditorState
  canEdit: boolean
  openFolder: (folderId: number | null, offset?: number) => void
  search: (query: string, offset?: number) => void
  openSetting: (settingId: number) => void
  newSetting: (folderId: number | null) => void
}) {
  const { t } = useI18n()
  const { base, draft, ready } = editor
  const targetSettingId = editor.target && 'settingId' in editor.target ? editor.target.settingId : null
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  const pinned = [...path.map((folder) => folder.id), ...subfolders.map((folder) => folder.id), ready ? draft.folderId : null, base?.folderId ?? null]
  const listedIds = [...new Set([...pinned.filter((id): id is number => id !== null && byId.has(id)), ...folders.map((folder) => folder.id)])].slice(0, FOLDER_LIMIT)
  const listed = listedIds.map((id) => byId.get(id)!)
  const folderChoice = { ...pageChoice([0, ...listedIds]), description: '0: the top level; one of data.folders' }
  const offsetSchema = { ...pageNumber(0, undefined, true), description: 'First item of the settings page (multiples of the page size)' }
  const hashSchema = { ...pageText(128), description: 'Library composite hash; empty clears' }

  const draftSchema = pageObject({
    name: pageText(CHAT_PROFILE_TEXT_LIMITS.name),
    folderId: folderChoice,
    appearance: { ...pageText(CHAT_PROFILE_TEXT_LIMITS.text), description: 'Image-prompt tags of the look (hair, eyes, outfit…)' },
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
      view: query ? 'search' : 'folder',
      query,
      folder: { id: folderId ?? 0, path: path.map((folder) => folder.name) },
      subfolders: query ? [] : subfolders.slice(0, FOLDER_LIMIT).map((folder) => ({ id: folder.id, name: folder.name, settingCount: folder.settingCount })),
      folders: listed.map((folder) => ({ id: folder.id, name: folder.name, parentId: folder.parentId ?? 0 })),
      foldersTotal: folders.length,
      settings: settingsPage ? {
        offset,
        total: settingsPage.total,
        hasMore: settingsPage.hasMore,
        items: settingsPage.items.map((setting) => ({ id: setting.id, name: setting.name, folderId: setting.folderId ?? 0, revision: setting.revision, hasReference: Boolean(setting.referenceHash), hasAvatar: Boolean(setting.avatarHash) })),
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
        appearance: draft.appearance,
        referenceHash: draft.referenceHash,
        avatarHash: draft.avatarHash,
        avatarCrop: draft.avatarCrop,
        expressionGroupId: base?.expressionGroupId ?? null,
        candidateGroupId: base?.candidateGroupId ?? null,
        linkedProfileCount: base?.linkedProfileCount ?? 0,
        linkedProfiles: (base?.linkedProfiles ?? []).map((profile) => ({ id: profile.id, name: profile.name })),
      },
    } as Record<string, ChatPageData>,
    actions: [
      pageAction('character.open_folder', t({ ko: '폴더 열기', en: 'Open folder' }), t({ ko: '폴더(0은 최상위)를 열어. offset으로 외형 설정 목록의 다음 쪽을 봐.', en: 'Open a folder (0: top level); offset pages through its settings.' }), pageObject({ folderId: folderChoice, offset: offsetSchema }, ['folderId'])),
      pageAction('character.search', t({ ko: '외형 설정 검색', en: 'Search settings' }), t({ ko: '라이브러리 전체에서 이름으로 외형 설정을 찾아. 빈 검색어는 검색을 끝내.', en: 'Find settings by name across the library; an empty query ends the search.' }), pageObject({ query: pageText(200), offset: offsetSchema }, ['query'])),
      pageAction('character.open_setting', t({ ko: '외형 설정 열기', en: 'Open setting' }), t({ ko: '외형 설정을 편집기로 열어.', en: 'Open a setting in the editor.' }), pageObject({ settingId: pageNumber(1, undefined, true) }, ['settingId'])),
      ...(canEdit ? [
        pageAction('character.new_setting', t({ ko: '새 외형 설정', en: 'New setting' }), t({ ko: '폴더(0은 최상위)에 새 외형 설정 초안을 열어. 저장하지 않아.', en: 'Open a new setting draft in a folder (0: top level); nothing is saved.' }), pageObject({ folderId: folderChoice }, ['folderId'])),
        ...(editor.open && ready ? [
          pageAction('character.draft', t({ ko: '외형 설정 초안 채우기', en: 'Fill setting draft' }), t({ ko: '열린 편집기의 주어진 항목만 채워. 저장하지 않아.', en: 'Fill only the given fields of the open editor; nothing is saved.' }), draftSchema),
          pageAction('character.save', t({ ko: '외형 설정 저장', en: 'Save setting' }), t({ ko: '편집기의 현재 초안을 저장해. 기존 설정은 selected.revision 기준이고, 그사이 바뀌었으면 거절돼.', en: 'Save the editor draft as it is; an existing setting saves against selected.revision and is refused if it changed.' }), pageObject({}), 'save'),
          ...(base ? [pageAction('character.delete', t({ ko: '외형 설정 삭제', en: 'Delete setting' }), t({ ko: '열린 외형 설정을 지워. 연결된 프로필은 지금 값의 사본을 유지해.', en: 'Delete the open setting; linked profiles keep a copy of its values.' }), pageObject({}), 'save')] : []),
        ] : []),
      ] : []),
    ],
    apply: () => {},
    applyAction: async (id, args, assertCurrent): Promise<WorkflowUndo | void> => {
      assertCurrent()
      const folderArg = (value: ChatPageData | undefined) => (Number(value) > 0 ? Number(value) : null)
      if (id === 'character.open_folder') { openFolder(folderArg(args.folderId), Number(args.offset ?? 0)); return }
      if (id === 'character.search') { search(String(args.query ?? ''), Number(args.offset ?? 0)); return }
      if (id === 'character.open_setting') { openSetting(Number(args.settingId)); return }
      if (id === 'character.new_setting') { newSetting(folderArg(args.folderId)); return }
      if (!editor.open) throw new Error('외형 설정 편집기를 먼저 열어줘 (character.open_setting / character.new_setting).')
      if (!ready) throw new Error('외형 설정을 아직 불러오는 중이야. 잠시 뒤 다시 해줘.')
      if (id === 'character.save') { await editor.save(); return }
      if (id === 'character.delete') { await editor.remove(false); return }
      if (id !== 'character.draft') throw new Error('캐릭터 라이브러리에 없는 작업이야.')
      const input = pageRecord(args)
      const next: Partial<SettingDraft> = {}
      if (input.name !== undefined) next.name = String(input.name)
      if (input.folderId !== undefined) next.folderId = folderArg(input.folderId)
      if (input.appearance !== undefined) next.appearance = String(input.appearance)
      if (input.referenceHash !== undefined) next.referenceHash = String(input.referenceHash) || null
      if (input.avatarHash !== undefined) next.avatarHash = String(input.avatarHash) || null
      if (input.avatarCrop !== undefined) { const crop = pageRecord(input.avatarCrop); next.avatarCrop = { x: Number(crop.x), y: Number(crop.y), scale: Number(crop.scale) } }
      const keys = Object.keys(next) as Array<keyof SettingDraft>
      if (!keys.length) throw new Error('채울 항목이 없어.')
      const before = draft
      editor.patch(next)
      return {
        isCurrent: () => keys.every((key) => JSON.stringify(editor.draftRef.current[key]) === JSON.stringify(next[key])),
        restore: () => editor.patch(Object.fromEntries(keys.map((key) => [key, before[key]])) as Partial<SettingDraft>),
      }
    },
  })
}
