import type { ReactNode } from 'react'
import { folderPath, sortFoldersByName, type LibraryFolder } from '@conai/shared'
import { Folder } from 'lucide-react'
import { ActionContextMenu, type ActionMenuEntry } from '@/components/ui/action-menu'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { RowGroup } from '@/components/ui/row-group'
import { useI18n } from '@/i18n'

export function libraryFolderView<T extends LibraryFolder>(folders: T[], folderId: number | null, loaded: boolean) {
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  const currentFolder = folderId === null ? null : byId.get(folderId) ?? null
  return { currentFolder, path: folderPath(byId, folderId), subfolders: folders.filter((folder) => folder.parentId === folderId).sort(sortFoldersByName), folderMissing: folderId !== null && loaded && !currentFolder }
}

export function LibraryFolderContent<T extends LibraryFolder>({ folderMissing, subfolders, query, rootLabel, onOpen, getMenu, children }: {
  folderMissing: boolean; subfolders: T[]; query: string; rootLabel: string
  onOpen: (id: number | null) => void; getMenu: (folder: T) => ActionMenuEntry[]; children: ReactNode
}) {
  const { t } = useI18n()
  return <section className="min-w-0 space-y-6">
    {folderMissing ? <EmptyState icon={Folder} title={t({ ko: '폴더를 찾지 못했어', en: 'Folder not found' })} action={<Button variant="secondary" size="sm" onClick={() => onOpen(null)}>{rootLabel}</Button>} /> : <>
      {!query && subfolders.length ? <RowGroup heading={t('characterLibraryPage.folders')} count={subfolders.length}>
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 xl:grid-cols-4">
          {subfolders.map((folder) => <ActionContextMenu key={folder.id} entries={getMenu(folder)}>
            <Button type="button" variant="nav" size="sm" onClick={() => onOpen(folder.id)}>
              <Folder /><span className="min-w-0 flex-1 truncate">{folder.name}</span>
              {(folder.settingCount ?? folder.profileCount) ? <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{folder.settingCount ?? folder.profileCount}</span> : null}
            </Button>
          </ActionContextMenu>)}
        </div>
      </RowGroup> : null}
      {children}
    </>}
  </section>
}
