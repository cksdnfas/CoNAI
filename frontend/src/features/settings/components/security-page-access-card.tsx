import { SectionHeading } from '@/components/common/section-heading'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import type { PageAccessMatrixRecord } from '@/lib/api-auth'
import { SettingsToggleRow, SettingsValueTile } from './settings-primitives'

interface SecurityPageAccessCardProps {
  pageAccessMatrix: PageAccessMatrixRecord | null
  anonymousPermissionKeys: string[]
  guestPermissionKeys: string[]
  adminPermissionKeys: string[]
  isLoading: boolean
  isUpdatingPageAccess: boolean
  onAnonymousWallpaperAccessChange: (enabled: boolean) => void
  onGuestPermissionChange: (permissionKey: string, enabled: boolean) => void
}

/** Render the built-in anonymous and guest page-access controls. */
export function SecurityPageAccessCard({
  pageAccessMatrix,
  anonymousPermissionKeys,
  guestPermissionKeys,
  adminPermissionKeys,
  isLoading,
  isUpdatingPageAccess,
  onAnonymousWallpaperAccessChange,
  onGuestPermissionChange,
}: SecurityPageAccessCardProps) {
  return (
    <Card>
      <CardContent className="space-y-4">
        <SectionHeading
          variant="inside"
          heading="기본 권한"
          actions={
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">anonymous 라이브 페이지</Badge>
              <Badge variant="outline">guest 설정 가능</Badge>
              <Badge variant="secondary">admin 전체 허용</Badge>
            </div>
          }
        />

        {isLoading ? (
          <div className="min-h-[180px] rounded-sm bg-surface-low animate-pulse" />
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-3">
              <SettingsValueTile
                label="anonymous"
                value={anonymousPermissionKeys.includes('page.wallpaper.runtime.view') ? '라이브 열림' : '잠김'}
              />
              <SettingsValueTile
                label="guest"
                value={`${guestPermissionKeys.length} / ${pageAccessMatrix?.permissions.length ?? 0}`}
              />
              <SettingsValueTile
                label="admin"
                value={`${adminPermissionKeys.length} / ${pageAccessMatrix?.permissions.length ?? 0}`}
              />
            </div>

            <div className="space-y-3">
              <SettingsToggleRow className="justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-foreground">익명 월페이퍼 라이브 페이지</div>
                </div>
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--primary)]"
                  checked={anonymousPermissionKeys.includes('page.wallpaper.runtime.view')}
                  disabled={isUpdatingPageAccess}
                  onChange={(event) => onAnonymousWallpaperAccessChange(event.target.checked)}
                />
              </SettingsToggleRow>

              {(pageAccessMatrix?.permissions ?? []).map((permission) => {
                const checked = guestPermissionKeys.includes(permission.permissionKey)
                return (
                  <SettingsToggleRow key={permission.permissionKey} className="justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-foreground">{permission.label}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      {adminPermissionKeys.includes(permission.permissionKey) ? <Badge variant="secondary">admin</Badge> : null}
                      <input
                        type="checkbox"
                        className="size-4 accent-[var(--primary)]"
                        checked={checked}
                        disabled={isUpdatingPageAccess}
                        onChange={(event) => onGuestPermissionChange(permission.permissionKey, event.target.checked)}
                      />
                    </div>
                  </SettingsToggleRow>
                )
              })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
