import { RotateCcw } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { Badge } from '@/components/ui/badge'
import { useI18n } from '@/i18n'
import { AppearanceColorControl } from './appearance-tab-editor-shared'
import { Field } from '@/components/ui/field'
import { Modal } from '@/components/ui/modal'
import { InstantApplyHint } from './settings-section-status'
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
  const { language, t } = useI18n()

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('securityGroupColorEditorModal.permissionGroupColors')}
      description={t('securityGroupColorEditorModal.chooseGroupColorsShownConsistently')}
      widthClassName="max-w-3xl"
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <InstantApplyHint />
          {t({ ko: '서버에 저장돼서 모든 관리자 브라우저에 똑같이 보여.', en: 'Stored on the server, so every admin browser shows the same colors.' })}
        </div>
        {groups.map((group) => {
          const defaultColor = getDefaultSecurityGroupColor(group.groupKey)
          const colorText = groupColors[group.groupKey] ?? defaultColor
          const colorValue = /^#(?:[0-9a-fA-F]{3}){1,2}$/.test(colorText) ? colorText : defaultColor

          return (
            <div key={group.groupKey} className="rounded-sm border border-border bg-surface-container p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Badge className="border-0 normal-case tracking-normal" style={getSecurityGroupBadgeStyle(colorValue)}>
                    {getPermissionGroupDisplayName(language, group.groupKey, group.name)}
                  </Badge>
                  <Badge variant={group.systemGroup ? 'secondary' : 'outline'}>
                    {getPermissionGroupKindLabel(language, group.systemGroup === true)}
                  </Badge>
                </div>

                <IconButton
                  size="icon-sm"
                  variant="secondary"
                  onClick={() => onResetColor(group.groupKey)}
                  label={t('securityGroupColorEditorModal.restoreDefaultColor')}
                >
                  <RotateCcw className="h-4 w-4" />
                </IconButton>
              </div>

              <Field label={t('securityGroupColorEditorModal.color')}>
                <AppearanceColorControl
                  colorValue={colorValue}
                  textValue={colorText}
                  placeholder={defaultColor}
                  onChangeColor={(value) => onChangeColor(group.groupKey, value)}
                  onChangeText={(value) => onChangeColor(group.groupKey, value)}
                />
              </Field>
            </div>
          )
        })}
      </div>
    </Modal>
  )
}
