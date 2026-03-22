import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type { KaloscopeServerStatus, KaloscopeSettings } from '@/types/settings'

interface KaloscopeSettingsCardProps {
  kaloscopeDraft: KaloscopeSettings | null
  kaloscopeStatus: KaloscopeServerStatus | undefined
  onPatchKaloscope: (patch: Partial<KaloscopeSettings>) => void
  onSaveKaloscope: () => void
  isSavingKaloscope: boolean
}

export function KaloscopeSettingsCard({
  kaloscopeDraft,
  kaloscopeStatus,
  onPatchKaloscope,
  onSaveKaloscope,
  isSavingKaloscope,
}: KaloscopeSettingsCardProps) {
  return (
    <Card className="bg-surface-container">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Kaloscope</CardTitle>
          <Button size="sm" onClick={onSaveKaloscope} disabled={!kaloscopeDraft || isSavingKaloscope}>
            저장
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        {kaloscopeDraft ? (
          <>
            <label className="flex items-center gap-3 rounded-sm bg-surface-low px-4 py-3 text-sm text-foreground md:col-span-2">
              <input type="checkbox" checked={kaloscopeDraft.enabled} onChange={(event) => onPatchKaloscope({ enabled: event.target.checked })} />
              Kaloscope 활성화
            </label>

            <label className="flex items-center gap-3 rounded-sm bg-surface-low px-4 py-3 text-sm text-foreground md:col-span-2">
              <input
                type="checkbox"
                checked={kaloscopeDraft.autoTagOnUpload}
                onChange={(event) => onPatchKaloscope({ autoTagOnUpload: event.target.checked })}
              />
              업로드/스케줄러 자동 처리
            </label>

            <label className="space-y-2 text-sm">
              <span className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">디바이스</span>
              <select
                value={kaloscopeDraft.device}
                onChange={(event) => onPatchKaloscope({ device: event.target.value as KaloscopeSettings['device'] })}
                className="h-10 w-full rounded-sm bg-surface-lowest px-3 text-foreground outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="auto">auto</option>
                <option value="cpu">cpu</option>
                <option value="cuda">cuda</option>
              </select>
            </label>

            <label className="space-y-2 text-sm">
              <span className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">Top K</span>
              <input
                type="number"
                min={1}
                max={200}
                value={kaloscopeDraft.topK}
                onChange={(event) => onPatchKaloscope({ topK: Number(event.target.value) || 1 })}
                className="h-10 w-full rounded-sm bg-surface-lowest px-3 text-foreground outline-none focus:ring-1 focus:ring-primary"
              />
            </label>
          </>
        ) : (
          <Skeleton className="h-40 w-full rounded-sm md:col-span-2" />
        )}

        {kaloscopeStatus ? (
          <div className="rounded-sm bg-surface-low px-4 py-3 text-sm text-muted-foreground md:col-span-2">
            <div className="font-medium text-foreground">{kaloscopeStatus.statusMessage}</div>
            <div className="mt-2 flex flex-wrap gap-3 text-xs">
              <span>cached {String(kaloscopeStatus.modelCached)}</span>
              <span>deps {String(kaloscopeStatus.dependenciesAvailable)}</span>
              <span>device {kaloscopeStatus.currentDevice}</span>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
