import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import type { TaggerDependencyCheckResult, TaggerModelInfo, TaggerSettings } from '@/types/settings'

interface TaggerSettingsCardProps {
  taggerDraft: TaggerSettings | null
  taggerModels: TaggerModelInfo[]
  taggerDependencyResult: TaggerDependencyCheckResult | null
  onPatchTagger: (patch: Partial<TaggerSettings>) => void
  onSaveTagger: () => void
  onCheckTaggerDependencies: () => void
  isSavingTagger: boolean
  isCheckingTaggerDependencies: boolean
}

export function TaggerSettingsCard({
  taggerDraft,
  taggerModels,
  taggerDependencyResult,
  onPatchTagger,
  onSaveTagger,
  onCheckTaggerDependencies,
  isSavingTagger,
  isCheckingTaggerDependencies,
}: TaggerSettingsCardProps) {
  return (
    <Card className="bg-surface-container">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>WD Tagger</CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={onCheckTaggerDependencies} disabled={isCheckingTaggerDependencies}>
              의존성 확인
            </Button>
            <Button size="sm" onClick={onSaveTagger} disabled={!taggerDraft || isSavingTagger}>
              저장
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        {taggerDraft ? (
          <>
            <label className="flex items-center gap-3 rounded-sm bg-surface-low px-4 py-3 text-sm text-foreground md:col-span-2">
              <input type="checkbox" checked={taggerDraft.enabled} onChange={(event) => onPatchTagger({ enabled: event.target.checked })} />
              WD Tagger 활성화
            </label>

            <label className="flex items-center gap-3 rounded-sm bg-surface-low px-4 py-3 text-sm text-foreground md:col-span-2">
              <input
                type="checkbox"
                checked={taggerDraft.autoTagOnUpload}
                onChange={(event) => onPatchTagger({ autoTagOnUpload: event.target.checked })}
              />
              업로드 시 자동 태깅
            </label>

            <label className="space-y-2 text-sm">
              <span className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">모델</span>
              <select
                value={taggerDraft.model}
                onChange={(event) => onPatchTagger({ model: event.target.value as TaggerSettings['model'] })}
                className="h-10 w-full rounded-sm bg-surface-lowest px-3 text-foreground outline-none focus:ring-1 focus:ring-primary"
              >
                {taggerModels.map((model) => (
                  <option key={model.name} value={model.name}>
                    {model.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-2 text-sm">
              <span className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">디바이스</span>
              <select
                value={taggerDraft.device}
                onChange={(event) => onPatchTagger({ device: event.target.value as TaggerSettings['device'] })}
                className="h-10 w-full rounded-sm bg-surface-lowest px-3 text-foreground outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="auto">auto</option>
                <option value="cpu">cpu</option>
                <option value="cuda">cuda</option>
              </select>
            </label>

            <label className="space-y-2 text-sm">
              <span className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">General threshold</span>
              <input
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={taggerDraft.generalThreshold}
                onChange={(event) => onPatchTagger({ generalThreshold: Number(event.target.value) || 0 })}
                className="h-10 w-full rounded-sm bg-surface-lowest px-3 text-foreground outline-none focus:ring-1 focus:ring-primary"
              />
            </label>

            <label className="space-y-2 text-sm">
              <span className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">Character threshold</span>
              <input
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={taggerDraft.characterThreshold}
                onChange={(event) => onPatchTagger({ characterThreshold: Number(event.target.value) || 0 })}
                className="h-10 w-full rounded-sm bg-surface-lowest px-3 text-foreground outline-none focus:ring-1 focus:ring-primary"
              />
            </label>

            <label className="space-y-2 text-sm md:col-span-2">
              <span className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">Python path</span>
              <input
                value={taggerDraft.pythonPath}
                onChange={(event) => onPatchTagger({ pythonPath: event.target.value })}
                className="h-10 w-full rounded-sm bg-surface-lowest px-3 text-foreground outline-none focus:ring-1 focus:ring-primary"
              />
            </label>

            <label className="flex items-center gap-3 rounded-sm bg-surface-low px-4 py-3 text-sm text-foreground">
              <input
                type="checkbox"
                checked={taggerDraft.keepModelLoaded}
                onChange={(event) => onPatchTagger({ keepModelLoaded: event.target.checked })}
              />
              모델 메모리 유지
            </label>

            <label className="space-y-2 text-sm">
              <span className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">자동 언로드(분)</span>
              <input
                type="number"
                min={1}
                value={taggerDraft.autoUnloadMinutes}
                onChange={(event) => onPatchTagger({ autoUnloadMinutes: Number(event.target.value) || 1 })}
                className="h-10 w-full rounded-sm bg-surface-lowest px-3 text-foreground outline-none focus:ring-1 focus:ring-primary"
              />
            </label>
          </>
        ) : (
          <Skeleton className="h-48 w-full rounded-sm md:col-span-2" />
        )}

        {taggerDependencyResult ? (
          <div
            className={cn(
              'rounded-sm px-4 py-3 text-sm md:col-span-2',
              taggerDependencyResult.available ? 'bg-surface-low text-foreground' : 'bg-destructive/12 text-destructive',
            )}
          >
            {taggerDependencyResult.message}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
