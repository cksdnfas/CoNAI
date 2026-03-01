import React from 'react'
import { useTranslation } from 'react-i18next'
import type { GroupWithHierarchy } from '@comfyui-image-manager/shared'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

interface BasicInfoTabProps {
  formData: {
    name: string
    description: string
    color: string
    parent_id: number | null
    auto_collect_enabled: boolean
  }
  onFormChange: <K extends keyof BasicInfoTabProps['formData']>(
    field: K,
    value: BasicInfoTabProps['formData'][K],
  ) => void
  availableParents?: GroupWithHierarchy[]
  currentGroupId?: number
  isEditMode?: boolean
}

const PRESET_COLORS = [
  '#f44336',
  '#e91e63',
  '#9c27b0',
  '#673ab7',
  '#3f51b5',
  '#2196f3',
  '#03a9f4',
  '#00bcd4',
  '#009688',
  '#4caf50',
  '#8bc34a',
  '#cddc39',
  '#ffeb3b',
  '#ffc107',
  '#ff9800',
  '#ff5722',
]

const BasicInfoTab: React.FC<BasicInfoTabProps> = ({
  formData,
  onFormChange,
  availableParents = [],
  currentGroupId,
  isEditMode = false,
}) => {
  const { t } = useTranslation(['imageGroups'])

  const selectableParents = availableParents.filter((group) => !(isEditMode && currentGroupId && group.id === currentGroupId))

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <label className="text-sm font-medium" htmlFor="group-name-input">
          {t('imageGroups:modal.groupName')}
        </label>
        <Input
          id="group-name-input"
          required
          value={formData.name}
          onChange={(event) => onFormChange('name', event.target.value)}
          autoFocus
        />
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium" htmlFor="group-description-input">
          {t('imageGroups:modal.description')}
        </label>
        <Textarea
          id="group-description-input"
          rows={3}
          value={formData.description}
          onChange={(event) => onFormChange('description', event.target.value)}
        />
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium" htmlFor="group-parent-select">
          {t('imageGroups:modal.parentGroup')}
        </label>
        <select
          id="group-parent-select"
          className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
          value={formData.parent_id ?? ''}
          onChange={(event) => {
            const value = event.target.value
            onFormChange('parent_id', value === '' ? null : Number(value))
          }}
        >
          <option value="">{t('imageGroups:modal.noParent')}</option>
          {selectableParents.map((group) => {
            const depthPrefix = group.depth && group.depth > 0 ? `${'-- '.repeat(group.depth)}` : ''
            return (
              <option key={group.id} value={group.id}>
                {depthPrefix}
                {group.name}
              </option>
            )
          })}
        </select>
      </div>

      <div>
        <p className="text-sm font-semibold">{t('imageGroups:modal.groupColor')}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {PRESET_COLORS.map((color) => (
            <button
              type="button"
              key={color}
              className="h-10 w-10 rounded-full border-2 transition hover:scale-110"
              style={{
                backgroundColor: color,
                borderColor: formData.color === color ? '#111827' : '#d1d5db',
                borderWidth: formData.color === color ? '3px' : '2px',
              }}
              onClick={() => onFormChange('color', color)}
              aria-label={`Select color ${color}`}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  onFormChange('color', color)
                }
              }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

export default BasicInfoTab
