import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { KaloscopeServerStatus, TaggerServerStatus } from '@/types/settings'

interface AutoOverviewCardProps {
  taggerStatus: TaggerServerStatus | undefined
  kaloscopeStatus: KaloscopeServerStatus | undefined
}

export function AutoOverviewCard({ taggerStatus, kaloscopeStatus }: AutoOverviewCardProps) {
  return (
    <Card className="bg-surface-container">
      <CardHeader>
        <CardTitle>Auto</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-3">
        <div className="rounded-sm bg-surface-low px-4 py-3">
          <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">loaded model</div>
          <div className="mt-2 text-sm font-semibold text-foreground">{taggerStatus?.currentModel ?? '—'}</div>
        </div>
        <div className="rounded-sm bg-surface-low px-4 py-3">
          <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">current device</div>
          <div className="mt-2 text-sm font-semibold text-foreground">{taggerStatus?.currentDevice ?? '—'}</div>
        </div>
        <div className="rounded-sm bg-surface-low px-4 py-3">
          <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">kaloscope</div>
          <div className="mt-2 text-sm font-semibold text-foreground">{kaloscopeStatus?.statusMessage ?? '—'}</div>
        </div>
      </CardContent>
    </Card>
  )
}
