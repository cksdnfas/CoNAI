import type { ComponentProps } from 'react'
import type { CustomDropdownList } from '@/lib/api-image-generation-types'
import { ComfyDropdownListsSection, ComfyServerListSection } from './comfy-home-sections'

type ServerListProps = ComponentProps<typeof ComfyServerListSection>
type DropdownListsProps = ComponentProps<typeof ComfyDropdownListsSection>

/** ComfyUI management on the home view, always open: servers, then custom dropdown lists. */
export function ComfyManagementArea({
  servers,
  serverTests,
  dropdownLists,
  isRefreshingDropdownLists,
  onCreateManualList,
  onUpdateList,
  onDeleteList,
  onScanAutoLists,
  onOpenCreateServer,
  onEditServer,
  onDeleteServer,
  onTestServer,
  onToggleServerActive,
}: {
  servers: ServerListProps['servers']
  serverTests: ServerListProps['serverTests']
  dropdownLists: CustomDropdownList[] | undefined
  isRefreshingDropdownLists: boolean
  onCreateManualList: DropdownListsProps['onCreateManualList']
  onUpdateList: DropdownListsProps['onUpdateList']
  onDeleteList: DropdownListsProps['onDeleteList']
  onScanAutoLists: DropdownListsProps['onScanAutoLists']
  onOpenCreateServer: ServerListProps['onOpenCreateServer']
  onEditServer: ServerListProps['onEditServer']
  onDeleteServer: ServerListProps['onDeleteServer']
  onTestServer: ServerListProps['onTestServer']
  onToggleServerActive: ServerListProps['onToggleServerActive']
}) {
  return (
    <>
      <ComfyServerListSection
        servers={servers}
        serverTests={serverTests}
        onOpenCreateServer={onOpenCreateServer}
        onEditServer={onEditServer}
        onDeleteServer={onDeleteServer}
        onTestServer={onTestServer}
        onToggleServerActive={onToggleServerActive}
      />
      <ComfyDropdownListsSection
        dropdownLists={dropdownLists ?? []}
        isSubmitting={isRefreshingDropdownLists}
        onCreateManualList={onCreateManualList}
        onUpdateList={onUpdateList}
        onDeleteList={onDeleteList}
        onScanAutoLists={onScanAutoLists}
      />
    </>
  )
}
