import type { ComponentProps } from 'react'
import { ChevronDown, Wrench } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { useI18n } from '@/i18n'
import type { CustomDropdownList } from '@/lib/api-image-generation-types'
import { cn } from '@/lib/utils'
import { ComfyDropdownListsSection, ComfyServerListSection } from './comfy-home-sections'

type ServerListProps = ComponentProps<typeof ComfyServerListSection>
type DropdownListsProps = ComponentProps<typeof ComfyDropdownListsSection>

/** Collapsible ComfyUI management area on the home view: servers and custom dropdown lists. */
export function ComfyManagementArea({
  servers,
  activeServerCount,
  serverTests,
  dropdownLists,
  isManagementOpen,
  onToggleManagement,
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
  activeServerCount: number
  serverTests: ServerListProps['serverTests']
  dropdownLists: CustomDropdownList[] | undefined
  isManagementOpen: boolean
  onToggleManagement: () => void
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
  const { t } = useI18n()

  return (
    <>
    <div>
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Text as="div" variant="label">{t({ ko: 'ComfyUI 관리', en: 'ComfyUI management' })}</Text>
          <Badge variant="outline">{t({ ko: '서버 {count}', en: '{count} servers' }, { count: servers.length })}</Badge>
          <Badge variant="outline">{t({ ko: '목록 {count}', en: '{count} lists' }, { count: dropdownLists?.length ?? 0 })}</Badge>
        </div>
        <Button type="button" size="sm" variant="ghost" onClick={onToggleManagement} aria-expanded={isManagementOpen}>
          <Wrench className="h-4 w-4" />
          {isManagementOpen ? t({ ko: '관리 닫기', en: 'Close management' }) : t({ ko: '관리 열기', en: 'Open management' })}
          <ChevronDown className={cn('h-4 w-4 transition-transform', isManagementOpen && 'rotate-180')} />
        </Button>
      </div>
    </div>

    {servers.length === 0 || isManagementOpen ? (
      <>
        {isManagementOpen ? (
          <ComfyDropdownListsSection
            dropdownLists={dropdownLists ?? []}
            isSubmitting={isRefreshingDropdownLists}
            onCreateManualList={onCreateManualList}
            onUpdateList={onUpdateList}
            onDeleteList={onDeleteList}
            onScanAutoLists={onScanAutoLists}
          />
        ) : null}
        <ComfyServerListSection
          servers={servers}
          activeServerCount={activeServerCount}
          serverTests={serverTests}
          onOpenCreateServer={onOpenCreateServer}
          onEditServer={onEditServer}
          onDeleteServer={onDeleteServer}
          onTestServer={onTestServer}
          onToggleServerActive={onToggleServerActive}
        />
      </>
    ) : null}
    </>
  )
}
