import { ChevronRight, FolderOpen, Home } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { BreadcrumbItem } from '@conai/shared'
import { Button } from '@/components/ui/button'

interface GroupBreadcrumbProps {
  breadcrumb: BreadcrumbItem[]
  currentGroupName?: string
  onNavigate: (groupId: number | null) => void
  showGroupListRoot?: boolean
}

export function GroupBreadcrumb({
  breadcrumb,
  currentGroupName,
  onNavigate,
  showGroupListRoot = false,
}: GroupBreadcrumbProps) {
  const { t } = useTranslation(['imageGroups'])

  return (
    <div className="rounded-md border bg-card px-3 py-2">
      <div className="flex flex-wrap items-center gap-1 text-sm">
        <Button variant="ghost" size="xs" onClick={() => onNavigate(null)} className="h-7 px-2">
          {showGroupListRoot ? <FolderOpen className="h-3.5 w-3.5" /> : <Home className="h-3.5 w-3.5" />}
          {showGroupListRoot ? t('imageGroups:hierarchy.groupList') : t('imageGroups:hierarchy.root')}
        </Button>

        {breadcrumb.map((item) => (
          <div key={item.id} className="flex items-center gap-1">
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            <Button variant="ghost" size="xs" onClick={() => onNavigate(item.id)} className="h-7 px-2">
              {item.name}
            </Button>
          </div>
        ))}

        {currentGroupName ? (
          <div className="flex items-center gap-1">
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="px-2 text-foreground">{currentGroupName}</span>
          </div>
        ) : null}
      </div>
    </div>
  )
}
