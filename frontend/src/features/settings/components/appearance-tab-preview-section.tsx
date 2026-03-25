import { AlertTriangle } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  GLASS_PRESETS,
  RADIUS_PRESETS,
  SHADOW_PRESETS,
  type AppearanceContrastIssue,
} from '@/lib/appearance'
import { getThemeTonePanelStyle } from '@/lib/theme-tones'
import { cn } from '@/lib/utils'
import type { AppearanceSettings } from '@/types/settings'
import { SettingsValueTile } from './settings-primitives'

interface AppearanceTabPreviewSectionProps {
  appearanceDraft: AppearanceSettings
  savedAppearance: AppearanceSettings
  isDirty: boolean
  contrastIssues: AppearanceContrastIssue[]
  resolvedColors: { primary: string; secondary: string }
  resolvedSurface: {
    background: string
    surfaceContainer: string
    surfaceHigh: string
  }
}

export function AppearanceTabPreviewSection({
  appearanceDraft,
  savedAppearance,
  isDirty,
  contrastIssues,
  resolvedColors,
  resolvedSurface,
}: AppearanceTabPreviewSectionProps) {
  return (
    <>
      <div className="theme-settings-panel rounded-sm border border-border bg-surface-low">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-foreground">Live preview</div>
            <div className="mt-1 text-xs text-muted-foreground">
              변경값은 즉시 전체 UI에 미리보기로 반영돼. 저장하지 않으면 마지막 저장 상태는 유지돼.
            </div>
          </div>
          <div className={cn(
            'rounded-full px-3 py-1 text-xs font-semibold',
            isDirty ? 'bg-primary/12 text-primary' : 'bg-surface-high text-muted-foreground',
          )}>
            {isDirty ? 'Unsaved draft' : 'Saved'}
          </div>
        </div>
      </div>

      {contrastIssues.length > 0 ? (
        <Alert className="border" style={getThemeTonePanelStyle('rating')}>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Contrast guardrail</AlertTitle>
          <AlertDescription>
            <p>현재 조합은 일부 텍스트/상태 색 대비가 약해 보여. 저장 전 확인하는 편이 좋아.</p>
            <div className="flex flex-wrap gap-2 pt-1">
              {contrastIssues.map((issue) => (
                <span key={issue.id} className="rounded-full border bg-background/70 px-2 py-1 text-xs text-foreground" style={getThemeTonePanelStyle('rating')}>
                  {issue.label}: {issue.ratio}:1
                </span>
              ))}
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <SettingsValueTile label="Mode" value={appearanceDraft.themeMode} />
        <SettingsValueTile label="Accent" value={appearanceDraft.accentPreset} />
        <SettingsValueTile label="Surface" value={appearanceDraft.surfacePreset} />
        <SettingsValueTile label="Radius" value={appearanceDraft.radiusPreset} />
        <SettingsValueTile label="Glass" value={appearanceDraft.glassPreset} />
        <SettingsValueTile label="Shadow" value={appearanceDraft.shadowPreset} />
        <SettingsValueTile label="Density" value={appearanceDraft.density} />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <SettingsValueTile
          label="Applied Colors"
          value={
            <div className="flex items-center gap-2">
              <span className="h-4 w-4 rounded-full border border-border" style={{ backgroundColor: resolvedColors.primary }} />
              <span className="h-4 w-4 rounded-full border border-border" style={{ backgroundColor: resolvedColors.secondary }} />
              <span className="text-xs font-medium text-muted-foreground">
                {resolvedColors.primary} / {resolvedColors.secondary}
              </span>
            </div>
          }
        />
        <SettingsValueTile
          label="Surface Preview"
          value={
            <div className="flex items-center gap-2">
              <span className="h-4 w-4 rounded-full border border-border" style={{ backgroundColor: resolvedSurface.background }} />
              <span className="h-4 w-4 rounded-full border border-border" style={{ backgroundColor: resolvedSurface.surfaceContainer }} />
              <span className="h-4 w-4 rounded-full border border-border" style={{ backgroundColor: resolvedSurface.surfaceHigh }} />
            </div>
          }
        />
        <SettingsValueTile
          label="Current Finish"
          value={`${RADIUS_PRESETS[appearanceDraft.radiusPreset].label} · ${GLASS_PRESETS[appearanceDraft.glassPreset].label} · ${SHADOW_PRESETS[appearanceDraft.shadowPreset].label}`}
        />
        <SettingsValueTile
          label="Saved Baseline"
          value={`${savedAppearance.themeMode} · ${savedAppearance.surfacePreset} · ${savedAppearance.density}`}
        />
      </div>
    </>
  )
}
