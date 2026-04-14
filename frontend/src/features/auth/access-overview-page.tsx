import { ArrowRight, ShieldCheck, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { listAccessiblePageAccessItems } from './page-access-catalog'
import { useAuthStatusQuery } from './use-auth-status-query'

interface AccessEntryCardProps {
  label: string
  description: string
  href: string
  icon: LucideIcon
  badge?: string | null
}

/** Render one compact access card with a direct jump target. */
function AccessEntryCard({ label, description, href, icon: Icon, badge }: AccessEntryCardProps) {
  return (
    <Link
      to={href}
      className={cn(
        'group flex items-center gap-3 rounded-sm border border-border bg-surface-container/72 px-4 py-3 transition-colors',
        'hover:bg-surface-high focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35',
      )}
    >
      <div className="rounded-sm bg-primary/10 p-2 text-primary transition-colors group-hover:bg-primary/14">
        <Icon className="h-4 w-4" />
      </div>

      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-center gap-2">
          <div className="truncate text-sm font-semibold text-foreground">{label}</div>
          {badge ? <Badge variant="outline">{badge}</Badge> : null}
        </div>
        <div className="truncate text-xs text-muted-foreground">{description}</div>
      </div>

      <div className="shrink-0 text-muted-foreground transition-colors group-hover:text-foreground">
        <ArrowRight className="h-4 w-4" />
      </div>
    </Link>
  )
}

/** Render one compact landing page for the pages the current account can use. */
export function AccessOverviewPage() {
  const authStatusQuery = useAuthStatusQuery()

  if (authStatusQuery.isLoading) {
    return <div className="min-h-[40vh] rounded-sm bg-surface-low animate-pulse" />
  }

  const authStatus = authStatusQuery.data
  const accessibleItems = listAccessiblePageAccessItems(authStatus?.permissionKeys ?? [])
  const totalVisibleEntries = accessibleItems.length
  const accountTypeLabel = authStatus?.accountType === 'admin'
    ? '관리자'
    : authStatus?.accountType === 'guest'
      ? '게스트'
      : '계정'

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-base font-semibold text-foreground">이용 가능 페이지</h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {authStatus?.username ? <Badge variant="secondary">{authStatus.username}</Badge> : null}
          <Badge variant="outline">{accountTypeLabel}</Badge>
          <Badge variant="outline">항목 {totalVisibleEntries}</Badge>
        </div>
      </div>

      {accessibleItems.length === 0 ? (
        <div className="flex items-center gap-3 rounded-sm border border-border bg-surface-container/72 px-4 py-3 text-foreground">
          <div className="rounded-sm bg-primary/10 p-2 text-primary">
            <ShieldCheck className="h-4 w-4" />
          </div>
          <div className="text-sm font-semibold">지금 열 수 있는 페이지가 없어.</div>
        </div>
      ) : (
        <section className="space-y-2.5">
          <div className="flex items-center gap-2">
            <div className="text-sm font-semibold text-foreground">기본 페이지</div>
            <div className="text-xs text-muted-foreground">{accessibleItems.length}</div>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {accessibleItems.map(({ path, label, description, icon }) => (
              <AccessEntryCard
                key={path}
                href={path}
                label={label}
                description={description}
                icon={icon}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
