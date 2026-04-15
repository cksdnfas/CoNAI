import { Braces, Copy, Sparkles, WandSparkles } from 'lucide-react'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { WildcardTool } from '@/lib/api'

export interface WildcardPreviewResult {
  usedWildcards: string[]
  results: string[]
}

export interface WildcardPreviewModalProps {
  open: boolean
  selectedWildcardSyntax: string
  selectedWildcardSyntaxLabel: string
  previewTool: WildcardTool
  previewCount: string
  previewText: string
  isParsing: boolean
  parseErrorMessage?: string | null
  parseResult?: WildcardPreviewResult | null
  onClose: () => void
  onPreviewToolChange: (value: WildcardTool) => void
  onPreviewCountChange: (value: string) => void
  onPreviewTextChange: (value: string) => void
  onFillSelectedSyntax: () => void
  onParsePreview: () => void
  onCopyResult: (text: string, label: string) => void
}

/** Render the wildcard parsing test modal for tool/count/text input and sample results. */
export function WildcardPreviewModal({
  open,
  selectedWildcardSyntax,
  selectedWildcardSyntaxLabel,
  previewTool,
  previewCount,
  previewText,
  isParsing,
  parseErrorMessage,
  parseResult,
  onClose,
  onPreviewToolChange,
  onPreviewCountChange,
  onPreviewTextChange,
  onFillSelectedSyntax,
  onParsePreview,
  onCopyResult,
}: WildcardPreviewModalProps) {
  return (
    <SettingsModal
      open={open}
      onClose={onClose}
      title={(
        <span className="flex items-center gap-2">
          <WandSparkles className="h-4 w-4 text-primary" />
          파싱 테스트
        </span>
      )}
      widthClassName="max-w-4xl"
    >
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_120px]">
          <Input value={selectedWildcardSyntax} readOnly placeholder={`선택한 ${selectedWildcardSyntaxLabel}`} />
          <Select value={previewTool} onChange={(event) => onPreviewToolChange(event.target.value as WildcardTool)}>
            <option value="nai">NAI</option>
            <option value="comfyui">ComfyUI</option>
          </Select>
          <Select value={previewCount} onChange={(event) => onPreviewCountChange(event.target.value)}>
            <option value="3">3개</option>
            <option value="5">5개</option>
            <option value="10">10개</option>
          </Select>
        </div>

        <Textarea
          value={previewText}
          onChange={(event) => onPreviewTextChange(event.target.value)}
          rows={5}
          placeholder="예: masterpiece, character_pose, ++lighting_style++, cinematic lighting"
        />

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={onFillSelectedSyntax} disabled={!selectedWildcardSyntax}>
            <Braces className="h-4 w-4" />
            선택 항목 넣기
          </Button>
          <Button type="button" onClick={onParsePreview} disabled={isParsing || previewText.trim().length === 0}>
            <Sparkles className="h-4 w-4" />
            {isParsing ? '테스트 중…' : '테스트'}
          </Button>
        </div>

        {parseErrorMessage ? (
          <Alert variant="destructive">
            <AlertTitle>테스트 실패</AlertTitle>
            <AlertDescription>{parseErrorMessage}</AlertDescription>
          </Alert>
        ) : null}

        {parseResult ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline">used</Badge>
              {parseResult.usedWildcards.length > 0
                ? parseResult.usedWildcards.map((name) => <Badge key={name} variant="outline">{name}</Badge>)
                : <span>감지된 와일드카드가 없어.</span>}
            </div>

            <div className="space-y-2">
              {parseResult.results.map((result, index) => (
                <div key={`${index}:${result}`} className="rounded-sm border border-border bg-surface-low p-3 text-sm text-muted-foreground">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs uppercase tracking-[0.18em]">sample {index + 1}</div>
                    <Button type="button" size="sm" variant="ghost" onClick={() => onCopyResult(result, `프리뷰 결과 ${index + 1}`)}>
                      <Copy className="h-4 w-4" />
                      복사
                    </Button>
                  </div>
                  <div className="mt-2 break-words whitespace-pre-wrap text-foreground">{result}</div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </SettingsModal>
  )
}
