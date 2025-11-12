import React from 'react';
import {
  Box,
  TextField,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { GroupWithHierarchy } from '@comfyui-image-manager/shared';

interface BasicInfoTabProps {
  formData: {
    name: string;
    description: string;
    color: string;
    parent_id?: number | null;
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

  // 선택 불가능한 그룹 필터링 (자기 자신과 자손들)
  const getFilteredParents = () => {
    if (!isEditMode || !currentGroupId) {
      return availableParents;
    }

    // 편집 모드에서는 자기 자신과 자손들을 제외
    // 실제로는 백엔드 validate-hierarchy API를 사용해야 하지만,
    // UI에서 간단하게 자기 자신만 제외
    return availableParents.filter(group => group.id !== currentGroupId);
  };

  const filteredParents = getFilteredParents();

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
      <FormControl fullWidth sx={{ mb: 3 }}>
        <InputLabel id="parent-group-label">
          {t('imageGroups:modal.parentGroup')}
        </InputLabel>
        <Select
          labelId="parent-group-label"
          label={t('imageGroups:modal.parentGroup')}
          value={formData.parent_id ?? ''}
          onChange={(e) => {
            const value = e.target.value;
            onFormChange('parent_id', value === '' ? null : Number(value));
          }}
        >
          <MenuItem value="">
            {t('imageGroups:modal.noParent')}
          </MenuItem>
          {filteredParents.map((group) => (
            <MenuItem key={group.id} value={group.id}>
              {group.name}
              {group.has_children && ` (${t('imageGroups:hierarchy.childGroups', { count: group.child_count })})`}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

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
