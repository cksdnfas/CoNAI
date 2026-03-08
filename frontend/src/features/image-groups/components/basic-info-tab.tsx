import React from 'react'
import { useTranslation } from 'react-i18next'
import type { GroupWithHierarchy } from '@conai/shared'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { GroupParentSelector } from './group-parent-selector'
import { cn } from '@/lib/utils'

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
  '#f44336', // Red
  '#e91e63', // Pink
  '#9c27b0', // Purple
  '#673ab7', // Deep Purple
  '#3f51b5', // Indigo
  '#2196f3', // Blue
  '#03a9f4', // Light Blue
  '#00bcd4', // Cyan
  '#009688', // Teal
  '#4caf50', // Green
  '#8bc34a', // Light Green
  '#cddc39', // Lime
  '#ffeb3b', // Yellow
  '#ffc107', // Amber
  '#ff9800', // Orange
  '#ff5722', // Deep Orange
]

const BasicInfoTab: React.FC<BasicInfoTabProps> = ({
  formData,
  onFormChange,
  availableParents = [],
  currentGroupId,
  isEditMode = false,
}) => {
  const { t } = useTranslation(['imageGroups'])

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
          className="bg-card"
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
          className="bg-card resize-none"
        />
      </div>

      <GroupParentSelector
        groups={availableParents}
        selectedParentId={formData.parent_id}
        onParentChange={(parentId) => onFormChange('parent_id', parentId)}
        excludeIds={React.useMemo(() => (isEditMode && currentGroupId ? [currentGroupId] : []), [isEditMode, currentGroupId])}
        label={t('imageGroups:modal.parentGroup')}
        noParentLabel={t('imageGroups:modal.noParent')}
      />

      <div>
        <label className="text-sm font-medium">{t('imageGroups:modal.groupColor')}</label>
        <div className="mt-2.5 flex flex-wrap gap-2.5">
          {PRESET_COLORS.map((color) => {
            const isActive = formData.color === color;
            return (
              <button
                type="button"
                key={color}
                className={cn(
                  "h-9 w-9 rounded-full border-2 transition-all duration-200 hover:scale-110 flex items-center justify-center",
                  isActive ? "ring-2 ring-offset-2 ring-primary border-transparent scale-110 shadow-md" : "border-background/20"
                )}
                style={{
                  backgroundColor: color,
                }}
                onClick={() => onFormChange('color', color)}
                aria-label={`Select color ${color}`}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    onFormChange('color', color)
                  }
                }}
              >
                {isActive && (
                  <div className="w-2 h-2 rounded-full bg-white shadow-sm ring-1 ring-black/10" />
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default BasicInfoTab
