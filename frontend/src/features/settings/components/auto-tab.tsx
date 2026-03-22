import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import type { AutoTestKaloscopeResult, AutoTestMediaRecord, AutoTestTaggerResult } from '@/lib/api'
import type {
  KaloscopeServerStatus,
  KaloscopeSettings,
  TaggerDependencyCheckResult,
  TaggerModelInfo,
  TaggerServerStatus,
  TaggerSettings,
} from '@/types/settings'
import { formatFileSize } from '../settings-utils'

interface AutoTabProps {
  taggerDraft: TaggerSettings | null
  kaloscopeDraft: KaloscopeSettings | null
  taggerModels: TaggerModelInfo[]
  taggerStatus: TaggerServerStatus | undefined
  kaloscopeStatus: KaloscopeServerStatus | undefined
  taggerDependencyResult: TaggerDependencyCheckResult | null
  onPatchTagger: (patch: Partial<TaggerSettings>) => void
  onPatchKaloscope: (patch: Partial<KaloscopeSettings>) => void
  onSaveTagger: () => void
  onSaveKaloscope: () => void
  onCheckTaggerDependencies: () => void
  isSavingTagger: boolean
  isSavingKaloscope: boolean
  isCheckingTaggerDependencies: boolean
  autoTestHashInput: string
  onAutoTestHashInputChange: (value: string) => void
  autoTestMedia: AutoTestMediaRecord | null
  taggerTestResult: AutoTestTaggerResult | null
  kaloscopeTestResult: AutoTestKaloscopeResult | null
  onResolveAutoTestMedia: () => void
  onRandomAutoTestMedia: () => void
  onRunTaggerAutoTest: () => void
  onRunKaloscopeAutoTest: () => void
  isResolvingAutoTestMedia: boolean
  isPickingRandomAutoTestMedia: boolean
  isRunningTaggerAutoTest: boolean
  isRunningKaloscopeAutoTest: boolean
}

export function AutoTab({
  taggerDraft,
  kaloscopeDraft,
  taggerModels,
  taggerStatus,
  kaloscopeStatus,
  taggerDependencyResult,
  onPatchTagger,
  onPatchKaloscope,
  onSaveTagger,
  onSaveKaloscope,
  onCheckTaggerDependencies,
  isSavingTagger,
  isSavingKaloscope,
  isCheckingTaggerDependencies,
  autoTestHashInput,
  onAutoTestHashInputChange,
  autoTestMedia,
  taggerTestResult,
  kaloscopeTestResult,
  onResolveAutoTestMedia,
  onRandomAutoTestMedia,
  onRunTaggerAutoTest,
  onRunKaloscopeAutoTest,
  isResolvingAutoTestMedia,
  isPickingRandomAutoTestMedia,
  isRunningTaggerAutoTest,
  isRunningKaloscopeAutoTest,
}: AutoTabProps) {
  return (
    <div className="space-y-8">
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

      <Card className="bg-surface-container">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>Test</CardTitle>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={onResolveAutoTestMedia} disabled={!autoTestHashInput.trim() || isResolvingAutoTestMedia}>
                해시 확인
              </Button>
              <Button size="sm" variant="outline" onClick={onRandomAutoTestMedia} disabled={isPickingRandomAutoTestMedia}>
                랜덤 선택
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="space-y-2 text-sm">
            <span className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">Composite hash</span>
            <input
              value={autoTestHashInput}
              onChange={(event) => onAutoTestHashInputChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return
                if (!autoTestHashInput.trim()) return
                event.preventDefault()
                onResolveAutoTestMedia()
              }}
              placeholder="image hash"
              className="h-10 w-full rounded-sm bg-surface-lowest px-3 font-mono text-foreground outline-none focus:ring-1 focus:ring-primary"
            />
          </label>

          {autoTestMedia ? (
            <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
              <div className="overflow-hidden rounded-sm bg-surface-low">
                {autoTestMedia.fileType === 'video' && autoTestMedia.imageUrl ? (
                  <video src={autoTestMedia.imageUrl} controls preload="metadata" className="aspect-square w-full bg-black object-contain" />
                ) : autoTestMedia.thumbnailUrl || autoTestMedia.imageUrl ? (
                  <img
                    src={autoTestMedia.thumbnailUrl ?? autoTestMedia.imageUrl ?? undefined}
                    alt={autoTestMedia.fileName ?? autoTestMedia.compositeHash}
                    className="aspect-square w-full object-cover"
                  />
                ) : (
                  <div className="flex aspect-square items-center justify-center px-4 text-sm text-muted-foreground">
                    미리보기를 준비하지 못했어.
                  </div>
                )}
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-sm bg-surface-low px-4 py-3">
                  <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">type</div>
                  <div className="mt-2 text-sm font-semibold text-foreground">{autoTestMedia.fileType ?? '—'}</div>
                </div>
                <div className="rounded-sm bg-surface-low px-4 py-3">
                  <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">file</div>
                  <div className="mt-2 text-sm font-semibold text-foreground">{autoTestMedia.fileName ?? '—'}</div>
                </div>
                <div className="rounded-sm bg-surface-low px-4 py-3">
                  <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">exists</div>
                  <div className="mt-2 text-sm font-semibold text-foreground">{autoTestMedia.existsOnDisk ? 'yes' : 'no'}</div>
                </div>
                <div className="rounded-sm bg-surface-low px-4 py-3">
                  <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">size</div>
                  <div className="mt-2 text-sm font-semibold text-foreground">{formatFileSize(autoTestMedia.fileSize)}</div>
                </div>
                <div className="rounded-sm bg-surface-low px-4 py-3 md:col-span-2">
                  <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">hash</div>
                  <div className="mt-2 break-all font-mono text-xs text-foreground">{autoTestMedia.compositeHash}</div>
                </div>
                <div className="rounded-sm bg-surface-low px-4 py-3 md:col-span-2">
                  <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">path</div>
                  <div className="mt-2 break-all font-mono text-xs text-foreground">{autoTestMedia.originalFilePath ?? '—'}</div>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-sm bg-surface-low px-4 py-3 text-sm text-muted-foreground">
              해시를 확인하거나 랜덤으로 하나 골라줘. 파일이 실제로 확인된 대상만 테스트 버튼이 열려.
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={onRunTaggerAutoTest} disabled={!autoTestMedia?.existsOnDisk || isRunningTaggerAutoTest}>
              {isRunningTaggerAutoTest ? '태거 테스트 중…' : '태거 테스트'}
            </Button>
            <Button size="sm" variant="outline" onClick={onRunKaloscopeAutoTest} disabled={!autoTestMedia?.existsOnDisk || isRunningKaloscopeAutoTest}>
              {isRunningKaloscopeAutoTest ? 'Kaloscope 테스트 중…' : 'Kaloscope 테스트'}
            </Button>
          </div>

          {taggerTestResult ? (
            <div className="rounded-sm bg-surface-low px-4 py-3 text-sm text-foreground">
              <div className="flex flex-wrap items-center gap-2">
                <div className="font-medium">WD Tagger 결과</div>
                {taggerTestResult.model ? <Badge variant="outline">{taggerTestResult.model}</Badge> : null}
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div>
                  <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">general</div>
                  <div className="mt-2 text-sm font-semibold">{Object.keys(taggerTestResult.general ?? {}).length}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">character</div>
                  <div className="mt-2 text-sm font-semibold">{Object.keys(taggerTestResult.character ?? {}).length}</div>
                </div>
              </div>
              {taggerTestResult.taglist ? (
                <div className="mt-3 break-words rounded-sm bg-surface-lowest px-3 py-2 text-xs text-foreground">
                  {taggerTestResult.taglist}
                </div>
              ) : null}
            </div>
          ) : null}

          {kaloscopeTestResult ? (
            <div className="rounded-sm bg-surface-low px-4 py-3 text-sm text-foreground">
              <div className="flex flex-wrap items-center gap-2">
                <div className="font-medium">Kaloscope 결과</div>
                {kaloscopeTestResult.model ? <Badge variant="outline">{kaloscopeTestResult.model}</Badge> : null}
              </div>
              <div className="mt-3 grid gap-2">
                {Object.entries(kaloscopeTestResult.artists ?? {}).slice(0, 10).map(([artist, score]) => (
                  <div key={artist} className="flex items-center justify-between gap-3 rounded-sm bg-surface-lowest px-3 py-2 text-xs">
                    <span className="truncate text-foreground">{artist}</span>
                    <span className="font-mono text-muted-foreground">{Number(score).toFixed(4)}</span>
                  </div>
                ))}
              </div>
              {kaloscopeTestResult.taglist ? (
                <div className="mt-3 break-words rounded-sm bg-surface-lowest px-3 py-2 text-xs text-foreground">
                  {kaloscopeTestResult.taglist}
                </div>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
