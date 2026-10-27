import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, UserRound } from 'lucide-react'
import { PathBreadcrumbs } from '@/components/common/path-breadcrumbs'
import { SearchField } from '@/components/common/search-field'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Spinner } from '@/components/ui/loading-state'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useFeaturePermissions } from '@/features/auth/use-feature-permissions'
import { useI18n } from '@/i18n'
import { CHARACTER_SETTINGS_PAGE_SIZE, characterSettingQueryKey, getCharacterSetting, type CharacterSetting } from '@/lib/api-character-library'
import { getErrorMessage } from '@/lib/error-message'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import { folderPath, useCharacterFolders, useCharacterSettingsPage } from '../character-library-shared'
import { CharacterFolderSidebar } from './character-folder-nav'
import { CharacterSettingCard } from './character-setting-card'
import { CharacterSettingGrid } from './character-setting-grid'

export type CharacterSettingPickerDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The full stored setting (read fresh when the pick is confirmed); the dialog closes after. */
  onPick: (setting: CharacterSetting) => void
  title?: string
  confirmLabel?: string
  /** The folder the browsing starts in; null or left out: the top level. */
  initialFolderId?: number | null
}

/**
 * Pick one appearance setting from the character library: the folder tree, a name search across the library and the
 * open folder's settings a page at a time. Browsing needs only `characters.view`; nothing here changes the library.
 */
export function CharacterSettingPickerDialog(props: CharacterSettingPickerDialogProps) {
  // Mounted only while open, so each opening starts from `initialFolderId` with no leftover search or selection.
  return props.open ? <CharacterSettingPicker {...props} /> : null
}

function CharacterSettingPicker({ onOpenChange, onPick, title, confirmLabel, initialFolderId = null }: CharacterSettingPickerDialogProps) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const canView = useFeaturePermissions().has('characters.view')
  const [folderId, setFolderId] = useState(initialFolderId)
  const [searchText, setSearchText] = useState('')
  const query = useDebouncedValue(searchText.trim())
  const [paging, setPaging] = useState({ key: '', page: 0 })
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const foldersQuery = useCharacterFolders(canView)
  const folders = foldersQuery.data ?? []
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  // A start folder that no longer exists falls back to the top level.
  const openFolderId = folderId !== null && foldersQuery.isSuccess && !byId.has(folderId) ? null : folderId
  const scopeKey = query ? `q:${query}` : `f:${openFolderId ?? 'root'}`
  const page = paging.key === scopeKey ? paging.page : 0
  const scope = { folder: query ? 'all' as const : openFolderId ?? 'root' as const, query, offset: page * CHARACTER_SETTINGS_PAGE_SIZE, limit: CHARACTER_SETTINGS_PAGE_SIZE }
  const settingsQuery = useCharacterSettingsPage(scope, canView)
  const path = folderPath(byId, openFolderId)
  const rootLabel = t({ ko: '캐릭터 라이브러리', en: 'Character library' })

  const openFolder = (id: number | null) => { setFolderId(id); setSearchText('') }
  const confirm = useMutation({
    mutationFn: (settingId: number) => queryClient.fetchQuery({ queryKey: characterSettingQueryKey(settingId), queryFn: ({ signal }) => getCharacterSetting(settingId, signal), staleTime: 0 }),
    onSuccess: (setting) => { onPick(setting); onOpenChange(false) },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '외형 설정을 불러오지 못했어.', en: 'Could not load the setting.' })), tone: 'error' }),
  })
  const pick = (settingId: number) => { if (!confirm.isPending) confirm.mutate(settingId) }

  return (
    <Modal open title={title ?? t({ ko: '외형 설정 고르기', en: 'Choose appearance setting' })} onClose={() => onOpenChange(false)} size="wide" height="tall">
      {!canView ? (
        <ModalBody>
          <EmptyState icon={UserRound} title={t({ ko: '캐릭터 라이브러리를 볼 권한이 없어', en: 'You cannot view the character library' })} description={t({ ko: '관리자에게 캐릭터 보기 권한을 받아야 외형 설정을 고를 수 있어.', en: 'Ask an administrator for character view access to choose a setting.' })} />
        </ModalBody>
      ) : (
        <ModalBody>
          <div className="grid min-h-0 gap-4 md:grid-cols-[14rem_minmax(0,1fr)]">
            <div className="min-w-0 md:max-h-[60vh] md:overflow-y-auto">
              <CharacterFolderSidebar folders={folders} selectedId={query ? null : openFolderId} loading={foldersQuery.isPending} error={foldersQuery.isError ? foldersQuery.error : null} onSelect={openFolder} inDialog />
            </div>
            <div className="min-w-0 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                {query ? (
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{t({ ko: '‘{query}’ 검색 결과', en: 'Results for ‘{query}’' }, { query })}</span>
                ) : (
                  <PathBreadcrumbs
                    className="flex-1"
                    ariaLabel={t({ ko: '폴더 경로', en: 'Folder path' })}
                    items={[{ key: 'root', label: rootLabel, onClick: () => openFolder(null) }, ...path.map((folder) => ({ key: String(folder.id), label: folder.name, onClick: () => openFolder(folder.id) }))]}
                  />
                )}
                <SearchField className="sm:max-w-64" value={searchText} onChange={setSearchText} placeholder={t({ ko: '외형 설정 이름 검색', en: 'Search settings by name' })} />
              </div>
              <CharacterSettingGrid
                query={settingsQuery}
                page={page}
                onPageChange={(next) => setPaging({ key: scopeKey, page: next })}
                gridClassName="grid-cols-2 sm:grid-cols-3 lg:grid-cols-4"
                renderSetting={(setting) => (
                  <CharacterSettingCard key={setting.id} setting={setting} selected={selectedId === setting.id} onOpen={() => setSelectedId(setting.id)} onDoubleClick={() => pick(setting.id)} />
                )}
                empty={<EmptyState size="compact" icon={UserRound} title={query ? t({ ko: '맞는 외형 설정이 없어', en: 'No matching settings' }) : t({ ko: '여기엔 외형 설정이 없어', en: 'No appearance settings here' })} />}
              />
            </div>
          </div>
        </ModalBody>
      )}
      <ModalFooter>
        <span className="flex-1" />
        <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>{t({ ko: '취소', en: 'Cancel' })}</Button>
        {canView ? (
          <Button type="button" disabled={selectedId === null || confirm.isPending} onClick={() => { if (selectedId !== null) pick(selectedId) }}>
            {confirm.isPending ? <Spinner className="size-3" /> : <Check />}
            {confirmLabel ?? t({ ko: '선택', en: 'Select' })}
          </Button>
        ) : null}
      </ModalFooter>
    </Modal>
  )
}
