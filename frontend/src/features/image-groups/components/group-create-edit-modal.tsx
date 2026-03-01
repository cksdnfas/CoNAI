import React, { useCallback, useState } from 'react'
import { Loader2, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AutoCollectCondition, ComplexFilter, GroupCreateData, GroupUpdateData, GroupWithHierarchy } from '@comfyui-image-manager/shared'
import { useAllGroupsWithHierarchy, useCreateGroup, useDeleteGroup, useUpdateGroup } from '@/hooks/use-groups'
import BasicInfoTab from './basic-info-tab'
import AutoCollectTab from './auto-collect-tab'
import { GroupDeleteConfirmDialog } from './group-delete-confirm-dialog'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

interface GroupCreateEditModalProps {
  open: boolean
  onClose: () => void
  onSuccess: () => void
  group?: GroupWithHierarchy
  initialAutoCollectConditions?: ComplexFilter
}

function getInitialFormData(group?: GroupWithHierarchy, initialAutoCollectConditions?: ComplexFilter) {
  if (group) {
    return {
      name: group.name,
      description: group.description || '',
      color: group.color || '#2196f3',
      parent_id: group.parent_id || null,
      auto_collect_enabled: Boolean(group.auto_collect_enabled),
    }
  }

  return {
    name: '',
    description: '',
    color: '#2196f3',
    parent_id: null as number | null,
    auto_collect_enabled: Boolean(initialAutoCollectConditions),
  }
}

function getInitialConditions(group?: GroupWithHierarchy, initialAutoCollectConditions?: ComplexFilter): ComplexFilter {
  if (group?.auto_collect_conditions) {
    try {
      const parsedConditions = JSON.parse(group.auto_collect_conditions)
      if (
        parsedConditions &&
        typeof parsedConditions === 'object' &&
        ('exclude_group' in parsedConditions || 'or_group' in parsedConditions || 'and_group' in parsedConditions)
      ) {
        return parsedConditions
      }
    } catch {
      return {}
    }
  }

  return initialAutoCollectConditions || {}
}

const GroupCreateEditModal: React.FC<GroupCreateEditModalProps> = ({
  open,
  onClose,
  onSuccess,
  group,
  initialAutoCollectConditions,
}) => {
  const { t } = useTranslation(['imageGroups', 'common'])
  const [activeTab, setActiveTab] = useState<'basic' | 'auto'>('basic')
  const [formData, setFormData] = useState(() => getInitialFormData(group, initialAutoCollectConditions))
  const [conditions, setConditions] = useState<ComplexFilter>(() => getInitialConditions(group, initialAutoCollectConditions))
  const [error, setError] = useState<string | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)

  const isEditMode = Boolean(group)

  const { data: availableParents = [] } = useAllGroupsWithHierarchy()
  const createGroupMutation = useCreateGroup()
  const updateGroupMutation = useUpdateGroup()
  const deleteGroupMutation = useDeleteGroup()

  const childCount = group?.child_count || 0

  const handleFormChange = <K extends keyof typeof formData>(field: K, value: (typeof formData)[K]) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  const handleConditionsChange = useCallback((nextConditions: ComplexFilter) => {
    setConditions(nextConditions)
  }, [])

  const validateForm = (): boolean => {
    if (!formData.name.trim()) {
      setError(t('imageGroups:validation.nameRequired'))
      return false
    }

    if (formData.auto_collect_enabled) {
      const isComplexFilter = conditions && typeof conditions === 'object' && !Array.isArray(conditions)
      const hasConditions = isComplexFilter
        ? (conditions.exclude_group?.length || 0) + (conditions.or_group?.length || 0) + (conditions.and_group?.length || 0) > 0
        : (conditions as AutoCollectCondition[]).length > 0

      if (!hasConditions) {
        setError(t('imageGroups:validation.conditionRequired'))
        return false
      }
    }

    return true
  }

  const handleSubmit = async () => {
    if (!validateForm()) return

    setError(null)

    try {
      const isComplexFilter = conditions && typeof conditions === 'object' && !Array.isArray(conditions)
      const hasConditions = isComplexFilter
        ? (conditions.exclude_group?.length || 0) + (conditions.or_group?.length || 0) + (conditions.and_group?.length || 0) > 0
        : (conditions as AutoCollectCondition[]).length > 0

      const requestData: GroupCreateData | GroupUpdateData = {
        name: formData.name.trim(),
        description: formData.description.trim() || undefined,
        color: formData.color,
        parent_id: formData.parent_id || undefined,
        auto_collect_enabled: formData.auto_collect_enabled,
        auto_collect_conditions: formData.auto_collect_enabled && hasConditions ? conditions : undefined,
      }

      if (isEditMode && group) {
        await updateGroupMutation.mutateAsync({ id: group.id, data: requestData })
      } else {
        await createGroupMutation.mutateAsync(requestData as GroupCreateData)
      }

      onSuccess()
    } catch (submitError: unknown) {
      console.error('Error saving group:', submitError)
      const message = submitError instanceof Error ? submitError.message : t(`imageGroups:messages.${isEditMode ? 'updateFailed' : 'createFailed'}`)
      setError(message)
    }
  }

  const handleDelete = () => {
    setDeleteDialogOpen(true)
  }

  const handleDeleteConfirm = async (cascade: boolean) => {
    if (!group) return

    try {
      await deleteGroupMutation.mutateAsync({ id: group.id, cascade })
      setDeleteDialogOpen(false)
      onSuccess()
    } catch (deleteError) {
      console.error('Error deleting group:', deleteError)
      setError(t('imageGroups:messages.deleteFailed'))
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => (!nextOpen ? onClose() : null)}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{isEditMode ? t('imageGroups:modal.editTitle') : t('imageGroups:modal.createTitle')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
        {error ? (
          <Alert>
            {error}
          </Alert>
        ) : null}

        <Tabs
          value={activeTab}
          onValueChange={(next) => setActiveTab(next as 'basic' | 'auto')}
        >
          <TabsList>
            <TabsTrigger value="basic">{t('imageGroups:tabs.basicInfo')}</TabsTrigger>
            <TabsTrigger value="auto">{t('imageGroups:tabs.autoCollect')}</TabsTrigger>
          </TabsList>
          <TabsContent value="basic" className="pt-2">
            <BasicInfoTab
              formData={formData}
              onFormChange={handleFormChange}
              availableParents={availableParents}
              currentGroupId={group?.id}
              isEditMode={isEditMode}
            />
          </TabsContent>
          <TabsContent value="auto" className="pt-2">
            <AutoCollectTab
              enabled={formData.auto_collect_enabled}
              conditions={conditions}
              onEnabledChange={(enabled) => handleFormChange('auto_collect_enabled', enabled)}
              onConditionsChange={handleConditionsChange}
            />
          </TabsContent>
        </Tabs>
        </div>

        <DialogFooter className="!justify-between">
        <div>
          {isEditMode ? (
            <Button
              onClick={handleDelete}
              variant="destructive"
              disabled={createGroupMutation.isPending || updateGroupMutation.isPending || deleteGroupMutation.isPending}
            >
              <Trash2 className="h-4 w-4" />
              {t('common:delete')}
            </Button>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={onClose} disabled={createGroupMutation.isPending || updateGroupMutation.isPending || deleteGroupMutation.isPending}>
            {t('imageGroups:modal.buttonCancel')}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={createGroupMutation.isPending || updateGroupMutation.isPending || deleteGroupMutation.isPending}
          >
            {createGroupMutation.isPending || updateGroupMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {isEditMode ? t('imageGroups:modal.buttonUpdate') : t('imageGroups:modal.buttonCreate')}
          </Button>
        </div>
      </DialogFooter>

      <GroupDeleteConfirmDialog
        open={deleteDialogOpen}
        group={group || null}
        childCount={childCount}
        onClose={() => setDeleteDialogOpen(false)}
        onConfirm={handleDeleteConfirm}
      />
      </DialogContent>
    </Dialog>
  )
}

export default GroupCreateEditModal
