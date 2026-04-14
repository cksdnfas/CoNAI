import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { AppearanceColorControl } from './appearance-tab-editor-shared'
import { SettingsField } from './settings-primitives'
import { SettingsModal } from './settings-modal'
import { getPermissionGroupDisplayName, getPermissionGroupKindLabel } from './security-ui-text'
import { getDefaultSecurityGroupColor, getSecurityGroupBadgeStyle, type SecurityGroupColorMap } from './security-group-color-utils'

interface SecurityGroupColorEditorModalProps {
  open: boolean
  groups: Array<{
    groupKey: string
    name?: string | null
    systemGroup?: boolean
  }>
  groupColors: SecurityGroupColorMap
  onClose: () => void
  onChangeColor: (groupKey: string, color: string) => void
  onResetColor: (groupKey: string) => void
}

export function SecurityGroupColorEditorModal({
  open,
  groups,
  groupColors,
  onClose,
  onChangeColor,
  onResetColor,
}: SecurityGroupColorEditorModalProps) {
  return (
    <SettingsModal
      open={open}
      onClose={onClose}
      title="권한 그룹 색상"
      description="계정과 권한 그룹 목록에서 같은 색으로 보여줄 그룹 색을 정해."
      widthClassName="max-w-3xl"
    >
      <div className="space-y-3">
        {groups.map((group) => {
          const defaultColor = getDefaultSecurityGroupColor(group.groupKey)
          const colorText = groupColors[group.groupKey] ?? defaultColor
          const colorValue = /^#(?:[0-9a-fA-F]{3}){1,2}$/.test(colorText) ? colorText : defaultColor

          return (
            <div key={group.groupKey} className="rounded-sm border border-border bg-surface-container p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Badge className="border-0 normal-case tracking-normal" style={getSecurityGroupBadgeStyle(colorValue)}>
                    {getPermissionGroupDisplayName(group.groupKey, group.name)}
                  </Badge>
                  <Badge variant={group.systemGroup ? 'secondary' : 'outline'}>
                    {getPermissionGroupKindLabel(group.systemGroup === true)}
                  </Badge>
                </div>

                <Button
                  type="button"
                  size="icon-sm"
                  variant="outline"
                  onClick={() => onResetColor(group.groupKey)}
                  title="기본 색으로 되돌리기"
                  aria-label="기본 색으로 되돌리기"
                >
                  <RotateCcw className="h-4 w-4" />
                </Button>
              </div>

              <SettingsField label="색상">
                <AppearanceColorControl
                  colorValue={colorValue}
                  textValue={colorText}
                  placeholder={defaultColor}
                  onChangeColor={(value) => onChangeColor(group.groupKey, value)}
                  onChangeText={(value) => onChangeColor(group.groupKey, value)}
                />
              </SettingsField>
            </div>
          )
        })}
      </div>
    </SettingsModal>
  )
}
