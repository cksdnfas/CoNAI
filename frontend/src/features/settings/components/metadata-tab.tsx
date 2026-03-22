import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type { MetadataExtractionSettings } from '@/types/settings'

interface MetadataTabProps {
  metadataDraft: MetadataExtractionSettings | null
  onPatchMetadata: (patch: Partial<MetadataExtractionSettings>) => void
  onSave: () => void
  isSaving: boolean
}

export function MetadataTab({ metadataDraft, onPatchMetadata, onSave, isSaving }: MetadataTabProps) {
  return (
    <div className="space-y-8">
      <Card className="bg-surface-container">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>Metadata</CardTitle>
            <Button size="sm" onClick={onSave} disabled={!metadataDraft || isSaving}>
              <Sparkles className="h-4 w-4" />
              저장
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          {metadataDraft ? (
            <>
              <label className="flex items-center gap-3 rounded-sm bg-surface-low px-4 py-3 text-sm text-foreground md:col-span-2">
                <input
                  type="checkbox"
                  checked={metadataDraft.enableSecondaryExtraction}
                  onChange={(event) => onPatchMetadata({ enableSecondaryExtraction: event.target.checked })}
                />
                Secondary extraction 활성화
              </label>

              <label className="space-y-2 text-sm">
                <span className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">Stealth scan mode</span>
                <select
                  value={metadataDraft.stealthScanMode}
                  onChange={(event) => onPatchMetadata({ stealthScanMode: event.target.value as MetadataExtractionSettings['stealthScanMode'] })}
                  className="h-10 w-full rounded-sm bg-surface-lowest px-3 text-foreground outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="fast">fast</option>
                  <option value="full">full</option>
                  <option value="skip">skip</option>
                </select>
              </label>

              <label className="space-y-2 text-sm">
                <span className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">최대 파일 크기(MB)</span>
                <input
                  type="number"
                  min={1}
                  value={metadataDraft.stealthMaxFileSizeMB}
                  onChange={(event) => onPatchMetadata({ stealthMaxFileSizeMB: Number(event.target.value) || 1 })}
                  className="h-10 w-full rounded-sm bg-surface-lowest px-3 text-foreground outline-none focus:ring-1 focus:ring-primary"
                />
              </label>

              <label className="space-y-2 text-sm">
                <span className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">최대 해상도(MP)</span>
                <input
                  type="number"
                  min={1}
                  value={metadataDraft.stealthMaxResolutionMP}
                  onChange={(event) => onPatchMetadata({ stealthMaxResolutionMP: Number(event.target.value) || 1 })}
                  className="h-10 w-full rounded-sm bg-surface-lowest px-3 text-foreground outline-none focus:ring-1 focus:ring-primary"
                />
              </label>

              <label className="flex items-center gap-3 rounded-sm bg-surface-low px-4 py-3 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={metadataDraft.skipStealthForComfyUI}
                  onChange={(event) => onPatchMetadata({ skipStealthForComfyUI: event.target.checked })}
                />
                ComfyUI 스킵
              </label>

              <label className="flex items-center gap-3 rounded-sm bg-surface-low px-4 py-3 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={metadataDraft.skipStealthForWebUI}
                  onChange={(event) => onPatchMetadata({ skipStealthForWebUI: event.target.checked })}
                />
                WebUI 스킵
              </label>
            </>
          ) : (
            <Skeleton className="h-48 w-full rounded-sm md:col-span-2" />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
