import React from 'react';
import {
  Box,
  TextField,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { GroupWithHierarchy } from '@comfyui-image-manager/shared';
import { GroupParentSelector } from '../../../components/GroupTreeSelector';

interface BasicInfoTabProps {
  formData: {
    name: string;
    description: string;
    color: string;
    parent_id: number | null;
    auto_collect_enabled: boolean;
  };
  onFormChange: <K extends keyof BasicInfoTabProps['formData']>(
    field: K,
    value: BasicInfoTabProps['formData'][K]
  ) => void;
  availableParents?: GroupWithHierarchy[];
  currentGroupId?: number;
  isEditMode?: boolean;
}

const PRESET_COLORS = [
  '#f44336', '#e91e63', '#9c27b0', '#673ab7',
  '#3f51b5', '#2196f3', '#03a9f4', '#00bcd4',
  '#009688', '#4caf50', '#8bc34a', '#cddc39',
  '#ffeb3b', '#ffc107', '#ff9800', '#ff5722',
];

const BasicInfoTab: React.FC<BasicInfoTabProps> = ({
  formData,
  onFormChange,
  availableParents = [],
  currentGroupId,
  isEditMode = false,
}) => {
  const { t } = useTranslation(['imageGroups']);

  return (
    <Box>
      {/* 그룹명 */}
      <TextField
        label={t('imageGroups:modal.groupName')}
        fullWidth
        required
        value={formData.name}
        onChange={(e) => onFormChange('name', e.target.value)}
        sx={{ mb: 2 }}
        autoFocus
      />

      {/* 설명 */}
      <TextField
        label={t('imageGroups:modal.description')}
        fullWidth
        multiline
        rows={3}
        value={formData.description}
        onChange={(e) => onFormChange('description', e.target.value)}
        sx={{ mb: 2 }}
      />

      {/* 상위 그룹 선택 */}
      <GroupParentSelector
        groups={availableParents}
        selectedParentId={formData.parent_id}
        onParentChange={(parentId) => onFormChange('parent_id', parentId)}
        excludeIds={isEditMode && currentGroupId ? [currentGroupId] : []}
        label={t('imageGroups:modal.parentGroup')}
        noParentLabel={t('imageGroups:modal.noParent')}
      />

      {/* 색상 선택 */}
      <Box>
        <Typography variant="subtitle2" gutterBottom>
          {t('imageGroups:modal.groupColor')}
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1 }}>
          {PRESET_COLORS.map((color) => (
            <Box
              key={color}
              sx={{
                width: 40,
                height: 40,
                backgroundColor: color,
                borderRadius: '50%',
                cursor: 'pointer',
                border: formData.color === color ? '3px solid #000' : '2px solid #e0e0e0',
                transition: 'all 0.2s',
                '&:hover': {
                  transform: 'scale(1.15)',
                  boxShadow: 2,
                },
              }}
              onClick={() => onFormChange('color', color)}
              role="button"
              aria-label={`Select color ${color}`}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  onFormChange('color', color);
                }
              }}
            />
          ))}
        </Box>
      </Box>
    </Box>
  );
};

export default BasicInfoTab;
