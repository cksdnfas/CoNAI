import { SegmentedControl } from '@/components/common/segmented-control'
import { FieldInfo } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { RowGroup } from '@/components/ui/row-group'
import { SettingRow } from '@/components/ui/setting-row'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { getPermissionGroupDisplayName } from '@/features/settings/components/security-ui-text'
import { useI18n } from '@/i18n'
import { clampPublicQueueMaxCount, slugifyPublicWorkflow } from './comfy-workflow-public-settings'
import type { ComfyWorkflowDraft } from './use-comfy-workflow-authoring-controller'

type ComfyWorkflowAuthoringSettingsProps = {
  draft: ComfyWorkflowDraft
  roleLimitGroups: Array<{ groupKey: string, name: string | null }>
  onPatch: (patch: Partial<ComfyWorkflowDraft>) => void
}

/** The settings tab: description, kind, result view and the public page, as flat setting rows. */
export function ComfyWorkflowAuthoringSettings({ draft, roleLimitGroups, onPatch }: ComfyWorkflowAuthoringSettingsProps) {
  const { t, language } = useI18n()

  return (
    <div className="h-full overflow-y-auto overscroll-contain px-4">
      <div className="mx-auto max-w-3xl space-y-8 py-6">
        <RowGroup heading={t({ ko: '기본', en: 'Basics' })}>
          <SettingRow label={t({ ko: '설명', en: 'Description' })} htmlFor="comfy-workflow-description" stacked>
            <Textarea
              id="comfy-workflow-description"
              variant="settings"
              rows={3}
              value={draft.description}
              onChange={(event) => onPatch({ description: event.target.value })}
              placeholder={t({ ko: '선택', en: 'Optional' })}
            />
          </SettingRow>
          <SettingRow label={t({ ko: '종류', en: 'Kind' })}>
            <SegmentedControl
              size="sm"
              ariaLabel={t({ ko: '종류', en: 'Kind' })}
              value={draft.kind}
              onChange={(value) => onPatch({ kind: value === 'audio' ? 'audio' : 'image' })}
              items={[
                { value: 'image', label: t({ ko: '이미지', en: 'Image' }) },
                { value: 'audio', label: t({ ko: '오디오', en: 'Audio' }) },
              ]}
            />
          </SettingRow>
        </RowGroup>

        <RowGroup heading={t({ ko: '결과', en: 'Results' })}>
          <SettingRow label={t({ ko: '표시 방식', en: 'Result view' })}>
            <SegmentedControl
              size="sm"
              ariaLabel={t({ ko: '표시 방식', en: 'Result view' })}
              value={draft.resultViewMode}
              onChange={(value) => onPatch({ resultViewMode: value === 'artifact_explorer' ? 'artifact_explorer' : 'history' })}
              items={[
                { value: 'history', label: t({ ko: '히스토리', en: 'History' }) },
                { value: 'artifact_explorer', label: t({ ko: '탐색형', en: 'Explorer' }) },
              ]}
            />
          </SettingRow>
          {draft.resultViewMode === 'artifact_explorer' ? (
            <>
              <SettingRow label={t({ ko: '저장 방식', en: 'Storage mode' })}>
                <SegmentedControl
                  size="sm"
                  ariaLabel={t({ ko: '저장 방식', en: 'Storage mode' })}
                  value={draft.artifactDirectoryMode}
                  onChange={(value) => onPatch({ artifactDirectoryMode: value === 'per_run' ? 'per_run' : 'shared' })}
                  items={[
                    { value: 'shared', label: t({ ko: '공유 폴더', en: 'Shared folder' }) },
                    { value: 'per_run', label: t({ ko: '실행별 폴더', en: 'Folder per run' }) },
                  ]}
                />
              </SettingRow>
              <SettingRow label={t({ ko: '저장 경로', en: 'Storage path' })} htmlFor="comfy-workflow-artifact-root" stacked>
                <Input
                  id="comfy-workflow-artifact-root"
                  variant="settings"
                  className="font-mono text-xs"
                  value={draft.artifactRootPath}
                  onChange={(event) => onPatch({ artifactRootPath: event.target.value })}
                  placeholder="runtime/artifacts/comfy-workflows/<workflow>"
                />
              </SettingRow>
            </>
          ) : null}
        </RowGroup>

        <RowGroup heading={t({ ko: '공용 페이지', en: 'Public page' })}>
          <SettingRow label={t({ ko: '사용', en: 'Enabled' })} htmlFor="comfy-workflow-public-page">
            <Switch id="comfy-workflow-public-page" checked={draft.isPublicPage} onCheckedChange={(checked) => onPatch({ isPublicPage: checked })} />
          </SettingRow>
          {draft.isPublicPage ? (
            <>
              <SettingRow label={t({ ko: '주소', en: 'Address' })} htmlFor="comfy-workflow-public-slug">
                <div className="flex w-full min-w-0 items-center gap-1.5 sm:w-80">
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">/public/workflows/</span>
                  <Input
                    id="comfy-workflow-public-slug"
                    variant="settings"
                    className="min-w-0 font-mono text-xs"
                    value={draft.publicSlug}
                    onChange={(event) => onPatch({ publicSlug: slugifyPublicWorkflow(event.target.value) })}
                    placeholder="character-poster"
                  />
                </div>
              </SettingRow>
              <SettingRow label={t({ ko: '1회 요청 상한', en: 'Per-request limit' })}>
                <NumberStepperInput
                  variant="settings"
                  className="w-44"
                  min={1}
                  max={32}
                  value={draft.publicQueueMaxCount}
                  aria-label={t({ ko: '1회 요청 상한', en: 'Per-request limit' })}
                  onValueCommit={(nextValue) => onPatch({ publicQueueMaxCount: String(clampPublicQueueMaxCount(nextValue)) })}
                />
              </SettingRow>
              <SettingRow
                align="start"
                label={(
                  <span className="inline-flex items-center gap-1">
                    {t({ ko: '등급별 동시 대기열', en: 'Active queue per role' })}
                    <FieldInfo>
                      {t({
                        ko: '회원 한 명이 동시에 둘 수 있는 대기열 개수야. 비우면 무제한, 0은 등록 금지.',
                        en: 'Active queue jobs one member of the role can keep. Empty: unlimited; 0 blocks the role.',
                      })}
                    </FieldInfo>
                  </span>
                )}
              >
                <div className="grid gap-1.5">
                  {roleLimitGroups.map((group) => {
                    const groupName = getPermissionGroupDisplayName(language, group.groupKey, group.name)
                    return (
                      <div key={group.groupKey} className="flex items-center justify-end gap-3">
                        <span className="min-w-0 truncate text-sm text-foreground">{groupName}</span>
                        <NumberStepperInput
                          variant="settings"
                          min={0}
                          max={999}
                          allowEmpty
                          className="w-44 shrink-0"
                          value={draft.publicQueueRoleLimits[group.groupKey] ?? ''}
                          placeholder={t({ ko: '무제한', en: 'Unlimited' })}
                          aria-label={t({ ko: '{name} 동시 대기열 제한', en: '{name} active queue limit' }, { name: groupName })}
                          onValueCommit={(nextValue) => onPatch({ publicQueueRoleLimits: { ...draft.publicQueueRoleLimits, [group.groupKey]: nextValue } })}
                        />
                      </div>
                    )
                  })}
                </div>
              </SettingRow>
            </>
          ) : null}
        </RowGroup>
      </div>
    </div>
  )
}
