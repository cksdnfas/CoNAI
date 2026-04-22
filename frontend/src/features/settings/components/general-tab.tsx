import { Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import type { GeneralSettings } from '@/types/settings'
import { SettingsField, SettingsInsetBlock, SettingsSection, SettingsToggleRow } from './settings-primitives'

interface GeneralTabProps {
  generalDraft: GeneralSettings | null
  onPatchGeneral: (patch: Partial<GeneralSettings>) => void
  onPatchDeleteProtection: (patch: Partial<GeneralSettings['deleteProtection']>) => void
  onSave: () => void
  isSaving: boolean
}

/** Render app-wide defaults that should be easy to find from the first settings tab. */
export function GeneralTab({ generalDraft, onPatchGeneral, onPatchDeleteProtection, onSave, isSaving }: GeneralTabProps) {
  return (
    <div className="space-y-6">
      <section>
        <SettingsSection
          heading="일반 설정"
          actions={(
            <Button
              size="icon-sm"
              onClick={onSave}
              disabled={!generalDraft || isSaving}
              aria-label="일반 설정 저장"
              title="일반 설정 저장"
            >
              <Save className="h-4 w-4" />
            </Button>
          )}
        >
          <div className="grid gap-4 md:grid-cols-2">
            {generalDraft ? (
              <>
                <SettingsInsetBlock className="text-sm text-muted-foreground md:col-span-2">
                  기본 동작과 삭제 보호를 여기서 먼저 조절해. RecycleBin은 user 폴더 기준 경로를 사용해.
                </SettingsInsetBlock>

                <SettingsField label="언어">
                  <Select
                    variant="settings"
                    value={generalDraft.language}
                    onChange={(event) => onPatchGeneral({ language: event.target.value as GeneralSettings['language'] })}
                  >
                    <option value="ko">한국어</option>
                    <option value="en">English</option>
                    <option value="ja">日本語</option>
                    <option value="zh-CN">简体中文</option>
                    <option value="zh-TW">繁體中文</option>
                  </Select>
                </SettingsField>

                <SettingsField label="RecycleBin 경로">
                  <Input
                    variant="settings"
                    value={generalDraft.deleteProtection.recycleBinPath}
                    onChange={(event) => onPatchDeleteProtection({ recycleBinPath: event.target.value })}
                    placeholder="RecycleBin"
                  />
                </SettingsField>

                <SettingsToggleRow className="md:col-span-2">
                  <input
                    type="checkbox"
                    checked={generalDraft.deleteProtection.enabled}
                    onChange={(event) => onPatchDeleteProtection({ enabled: event.target.checked })}
                  />
                  삭제 시 RecycleBin 보호 사용
                </SettingsToggleRow>

                <SettingsToggleRow>
                  <input
                    type="checkbox"
                    checked={generalDraft.enableGallery ?? true}
                    onChange={(event) => onPatchGeneral({ enableGallery: event.target.checked })}
                  />
                  갤러리 기능 사용
                </SettingsToggleRow>

                <SettingsToggleRow>
                  <input
                    type="checkbox"
                    checked={generalDraft.showRatingBadges ?? true}
                    onChange={(event) => onPatchGeneral({ showRatingBadges: event.target.checked })}
                  />
                  등급 배지 표시
                </SettingsToggleRow>

                <SettingsToggleRow className="md:col-span-2">
                  <input
                    type="checkbox"
                    checked={generalDraft.autoCleanupCanvasOnShutdown ?? false}
                    onChange={(event) => onPatchGeneral({ autoCleanupCanvasOnShutdown: event.target.checked })}
                  />
                  종료 시 캔버스 임시 데이터를 자동 정리
                </SettingsToggleRow>
              </>
            ) : (
              <Skeleton className="h-56 w-full rounded-sm md:col-span-2" />
            )}
          </div>
        </SettingsSection>
      </section>
    </div>
  )
}
