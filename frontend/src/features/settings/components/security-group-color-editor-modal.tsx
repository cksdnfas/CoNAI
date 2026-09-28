import { RotateCcw } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { Badge } from '@/components/ui/badge'
import { useI18n } from '@/i18n'
import { AppearanceColorControl } from './appearance-tab-editor-shared'
import { SettingRow } from '@/components/ui/setting-row'
import { Modal } from '@/components/ui/modal'
import { InstantApplyHint } from './settings-section-status'
import { getPermissionGroupDisplayName } from './security-ui-text'
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
  const { language, t } = useI18n()

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('securityGroupColorEditorModal.permissionGroupColors')}
      widthClassName="max-w-3xl"
    >
      <div>
        <div className="flex justify-end pb-2">
          <InstantApplyHint />
        </div>
        {groups.map((group) => {
          const defaultColor = getDefaultSecurityGroupColor(group.groupKey)
          const colorText = groupColors[group.groupKey] ?? defaultColor
          const colorValue = /^#(?:[0-9a-fA-F]{3}){1,2}$/.test(colorText) ? colorText : defaultColor

          return (
            <SettingRow
              key={group.groupKey}
              label={(
                <Badge className="border-0 normal-case tracking-normal" style={getSecurityGroupBadgeStyle(colorValue)}>
                  {getPermissionGroupDisplayName(language, group.groupKey, group.name)}
                </Badge>
              )}
            >
              <AppearanceColorControl
                ariaLabel={t('securityGroupColorEditorModal.color')}
                colorValue={colorValue}
                textValue={colorText}
                placeholder={defaultColor}
                onChangeColor={(value) => onChangeColor(group.groupKey, value)}
                onChangeText={(value) => onChangeColor(group.groupKey, value)}
              />
              <IconButton
                size="icon-sm"
                variant="ghost"
                onClick={() => onResetColor(group.groupKey)}
                label={t('securityGroupColorEditorModal.restoreDefaultColor')}
              >
                <RotateCcw className="h-4 w-4" />
              </IconButton>
            </SettingRow>
          )
        })}
      </div>
    </Modal>
  )
}
