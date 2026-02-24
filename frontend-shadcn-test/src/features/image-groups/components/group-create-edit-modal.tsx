import React, { useCallback, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Tab,
  Tabs,
} from '@mui/material'
import DeleteIcon from '@mui/icons-material/Delete'
import { useTranslation } from 'react-i18next'
import type { AutoCollectCondition, ComplexFilter, GroupCreateData, GroupUpdateData, GroupWithHierarchy } from '@comfyui-image-manager/shared'
import { useAllGroupsWithHierarchy, useCreateGroup, useDeleteGroup, useUpdateGroup } from '@/hooks/use-groups'
import BasicInfoTab from './basic-info-tab'
import AutoCollectTab from './auto-collect-tab'
import { GroupDeleteConfirmDialog } from './group-delete-confirm-dialog'

interface GroupCreateEditModalProps {
  open: boolean
  onClose: () => void
  onSuccess: () => void
  group?: GroupWithHierarchy
  initialAutoCollectConditions?: ComplexFilter
}

interface TabPanelProps {
  children?: React.ReactNode
  index: number
  value: number
}

const TabPanel: React.FC<TabPanelProps> = ({ children, value, index }) => {
  return (
    <div role="tabpanel" hidden={value !== index} id={`group-tabpanel-${index}`} aria-labelledby={`group-tab-${index}`}>
      {value === index ? <Box sx={{ py: 2 }}>{children}</Box> : null}
    </div>
  )
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
  const [activeTab, setActiveTab] = useState(0)
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
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{isEditMode ? t('imageGroups:modal.editTitle') : t('imageGroups:modal.createTitle')}</DialogTitle>

      <DialogContent dividers>
        {error ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        ) : null}

        <Tabs
          value={activeTab}
          onChange={(_event, next) => setActiveTab(next)}
          aria-label="group editor tabs"
          sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}
        >
          <Tab label={t('imageGroups:tabs.basicInfo')} id="group-tab-0" aria-controls="group-tabpanel-0" />
          <Tab label={t('imageGroups:tabs.autoCollect')} id="group-tab-1" aria-controls="group-tabpanel-1" />
        </Tabs>

        <TabPanel value={activeTab} index={0}>
          <BasicInfoTab
            formData={formData}
            onFormChange={handleFormChange}
            availableParents={availableParents}
            currentGroupId={group?.id}
            isEditMode={isEditMode}
          />
        </TabPanel>

        <TabPanel value={activeTab} index={1}>
          <AutoCollectTab
            enabled={formData.auto_collect_enabled}
            conditions={conditions}
            onEnabledChange={(enabled) => handleFormChange('auto_collect_enabled', enabled)}
            onConditionsChange={handleConditionsChange}
          />
        </TabPanel>
      </DialogContent>

      <DialogActions sx={{ justifyContent: 'space-between' }}>
        <Box>
          {isEditMode ? (
            <Button
              onClick={handleDelete}
              color="error"
              startIcon={<DeleteIcon />}
              disabled={createGroupMutation.isPending || updateGroupMutation.isPending || deleteGroupMutation.isPending}
            >
              {t('common:delete')}
            </Button>
          ) : null}
        </Box>

        <Box>
          <Button onClick={onClose} disabled={createGroupMutation.isPending || updateGroupMutation.isPending || deleteGroupMutation.isPending}>
            {t('imageGroups:modal.buttonCancel')}
          </Button>
          <Button
            onClick={handleSubmit}
            variant="contained"
            disabled={createGroupMutation.isPending || updateGroupMutation.isPending || deleteGroupMutation.isPending}
            startIcon={createGroupMutation.isPending || updateGroupMutation.isPending ? <CircularProgress size={20} /> : null}
            sx={{ ml: 1 }}
          >
            {isEditMode ? t('imageGroups:modal.buttonUpdate') : t('imageGroups:modal.buttonCreate')}
          </Button>
        </Box>
      </DialogActions>

      <GroupDeleteConfirmDialog
        open={deleteDialogOpen}
        group={group || null}
        childCount={childCount}
        onClose={() => setDeleteDialogOpen(false)}
        onConfirm={handleDeleteConfirm}
      />
    </Dialog>
  )
}

export default GroupCreateEditModal
