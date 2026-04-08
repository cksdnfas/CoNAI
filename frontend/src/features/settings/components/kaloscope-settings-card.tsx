import type { ReactNode } from 'react'
import { RotateCcw } from 'lucide-react'
import { SectionHeading } from '@/components/common/section-heading'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { DEFAULT_ARTIST_LINK_URL_TEMPLATE, type KaloscopeServerStatus, type KaloscopeSettings } from '@/types/settings'
import { SettingsField, SettingsToggleRow } from './settings-primitives'

interface KaloscopeSettingsCardProps {
  heading: ReactNode
  actions?: ReactNode
  kaloscopeDraft: KaloscopeSettings | null
  kaloscopeStatus: KaloscopeServerStatus | undefined
  onPatchKaloscope: (patch: Partial<KaloscopeSettings>) => void
}

function formatKaloscopeDependencyLabel(status: KaloscopeServerStatus | undefined) {
  if (!status) return '확인 중…'
  return status.scriptExists && status.dependenciesAvailable ? '준비 OK' : '확인 필요'
}

export function KaloscopeSettingsCard({
  heading,
  actions,
  kaloscopeDraft,
  kaloscopeStatus,
  onPatchKaloscope,
}: KaloscopeSettingsCardProps) {
  return (
    <Card>
      <CardContent className="space-y-4">
        <SectionHeading variant="inside" heading={heading} actions={actions} />
        <div className="grid gap-4 md:grid-cols-2">
          {kaloscopeDraft ? (
            <>
              <SettingsToggleRow className="md:col-span-2">
                <input type="checkbox" checked={kaloscopeDraft.enabled} onChange={(event) => onPatchKaloscope({ enabled: event.target.checked })} />
                Kaloscope 활성화
              </SettingsToggleRow>

              <SettingsToggleRow className="md:col-span-2">
                <input
                  type="checkbox"
                  checked={kaloscopeDraft.autoTagOnUpload}
                  onChange={(event) => onPatchKaloscope({ autoTagOnUpload: event.target.checked })}
                />
                업로드/스케줄러 자동 처리
              </SettingsToggleRow>

              <SettingsField label="디바이스">
                <Select variant="settings" value={kaloscopeDraft.device} onChange={(event) => onPatchKaloscope({ device: event.target.value as KaloscopeSettings['device'] })}>
                  <option value="auto">auto</option>
                  <option value="cpu">cpu</option>
                  <option value="cuda">cuda</option>
                </Select>
              </SettingsField>

              <SettingsField label="Top K">
                <Input type="number" min={1} max={200} variant="settings" value={kaloscopeDraft.topK} onChange={(event) => onPatchKaloscope({ topK: Number(event.target.value) || 1 })} />
              </SettingsField>

              <SettingsField label="Artist 링크 URL" className="md:col-span-2">
                <div className="space-y-2">
                  <Input
                    variant="settings"
                    value={kaloscopeDraft.artistLinkUrlTemplate}
                    onChange={(event) => onPatchKaloscope({ artistLinkUrlTemplate: event.target.value })}
                    placeholder={DEFAULT_ARTIST_LINK_URL_TEMPLATE}
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">{`{key}`} 자리에 아티스트 배지 텍스트가 들어가.</p>
                    <Button type="button" size="sm" variant="outline" onClick={() => onPatchKaloscope({ artistLinkUrlTemplate: DEFAULT_ARTIST_LINK_URL_TEMPLATE })}>
                      <RotateCcw className="h-4 w-4" />
                      기본값
                    </Button>
                  </div>
                </div>
              </SettingsField>
            </>
          ) : (
            <Skeleton className="h-40 w-full rounded-sm md:col-span-2" />
          )}

          <div className="flex flex-wrap gap-2 text-xs md:col-span-2">
            <span className="rounded-full bg-surface-low px-3 py-1.5 text-foreground">의존성 {formatKaloscopeDependencyLabel(kaloscopeStatus)}</span>
            <span className="rounded-full bg-surface-low px-3 py-1.5 text-muted-foreground">캐시 {kaloscopeStatus?.modelCached ? '준비됨' : '없음'}</span>
            <span className="rounded-full bg-surface-low px-3 py-1.5 text-muted-foreground">device {kaloscopeStatus?.currentDevice ?? '—'}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
