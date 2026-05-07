import { Braces, Copy, Sparkles, WandSparkles } from 'lucide-react'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import type { WildcardTool } from '@/lib/api-wildcards'

export interface WildcardPreviewResult {
  usedWildcards: string[]
  results: string[]
}

interface WildcardPreviewModalProps {
  open: boolean
  selectedWildcardSyntax: string
  selectedWildcardSyntaxLabel: string
  previewTool: WildcardTool | 'codex'
  previewCount: string
  previewText: string
  isParsing: boolean
  parseErrorMessage?: string | null
  parseResult?: WildcardPreviewResult | null
  onClose: () => void
  onPreviewToolChange: (value: WildcardTool | 'codex') => void
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
  const { t } = useI18n()

  return (
    <SettingsModal
      open={open}
      onClose={onClose}
      title={(
        <span className="flex items-center gap-2">
          <WandSparkles className="h-4 w-4 text-primary" />
          {t('image-generation.components.wildcard.generation.panel.parsing.test')}
        </span>
      )}
      widthClassName="max-w-4xl"
    >
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_120px]">
          <Input value={selectedWildcardSyntax} readOnly placeholder={t({ ko: '선택한 {label}', en: 'Selected {label}' }, { label: selectedWildcardSyntaxLabel })} />
          <Select value={previewTool} onChange={(event) => onPreviewToolChange(event.target.value as WildcardTool | 'codex')}>
            <option value="general">General</option>
            <option value="nai">NAI</option>
            <option value="comfyui">ComfyUI</option>
            <option value="codex">Codex</option>
          </Select>
          <Select value={previewCount} onChange={(event) => onPreviewCountChange(event.target.value)}>
            <option value="3">{t('image-generation.components.wildcard.preview.modal.3.items')}</option>
            <option value="5">{t('image-generation.components.wildcard.preview.modal.5.items')}</option>
            <option value="10">{t('image-generation.components.wildcard.preview.modal.10.items')}</option>
          </Select>
        </div>

        <Textarea
          value={previewText}
          onChange={(event) => onPreviewTextChange(event.target.value)}
          rows={5}
          placeholder={t('image-generation.components.wildcard.preview.modal.e.g.masterpiece.character.pose.lighting.style')}
        />

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={onFillSelectedSyntax} disabled={!selectedWildcardSyntax}>
            <Braces className="h-4 w-4" />
            {t({ ko: '선택 항목 넣기', en: 'Insert selection' })}
          </Button>
          <Button type="button" onClick={onParsePreview} disabled={isParsing || previewText.trim().length === 0}>
            <Sparkles className="h-4 w-4" />
            {isParsing ? t('image-generation.components.wildcard.preview.modal.testing') : t('image-generation.components.wildcard.preview.modal.test')}
          </Button>
        </div>

        {parseErrorMessage ? (
          <Alert variant="destructive">
            <AlertTitle>{t('image-generation.components.wildcard.preview.modal.test.failed')}</AlertTitle>
            <AlertDescription>{parseErrorMessage}</AlertDescription>
          </Alert>
        ) : null}

        {parseResult ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline">{t({ ko: '사용됨', en: 'Used' })}</Badge>
              {parseResult.usedWildcards.length > 0
                ? parseResult.usedWildcards.map((name) => <Badge key={name} variant="outline">{name}</Badge>)
                : <span>{t('image-generation.components.wildcard.preview.modal.no.wildcards.detected')}</span>}
            </div>

            <div className="space-y-2">
              {parseResult.results.map((result, index) => (
                <div key={`${index}:${result}`} className="rounded-sm border border-border bg-surface-low p-3 text-sm text-muted-foreground">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs uppercase tracking-[0.18em]">{t({ ko: '샘플 {count}', en: 'Sample {count}' }, { count: index + 1 })}</div>
                    <Button type="button" size="sm" variant="ghost" onClick={() => onCopyResult(result, t({ ko: '프리뷰 결과 {count}', en: 'Preview result {count}' }, { count: index + 1 }))}>
                      <Copy className="h-4 w-4" />
                      {t({ ko: '복사', en: 'Copy' })}
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
