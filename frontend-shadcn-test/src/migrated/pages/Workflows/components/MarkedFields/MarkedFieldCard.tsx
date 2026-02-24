import React, { useState } from 'react';
import {
  Card,
  CardContent,
  Box,
  TextField,
  IconButton,
  FormControlLabel,
  Switch,
  Collapse,
  Typography,
  Chip,
  alpha,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
} from '@mui/material';
import {
  Delete as DeleteIcon,
  ExpandMore as ExpandMoreIcon,
  DragIndicator as DragIndicatorIcon,
  PlaylistAdd as PlaylistAddIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import type { MarkedField } from '../../../../services/api/workflowApi';
import { generateFieldId } from './utils/smartDefaults';
import type { FieldError } from './hooks/useMarkedFieldValidation';
import { customDropdownListApi, type CustomDropdownList } from '../../../../services/api/customDropdownListApi';

// Field type configuration
const FIELD_TYPE_CONFIG = {
  text: {
    label: 'Text',
    icon: '📝',
    color: '#4caf50',
  },
  textarea: {
    label: 'Textarea',
    icon: '📝',
    color: '#4caf50',
  },
  number: {
    label: 'Number',
    icon: '🔢',
    color: '#2196f3',
  },
  select: {
    label: 'Select',
    icon: '📋',
    color: '#ff9800',
  },
  image: {
    label: 'Image',
    icon: '🖼️',
    color: '#9c27b0',
  },
};

interface MarkedFieldCardProps {
  field: MarkedField;
  index: number;
  onUpdate: (index: number, updates: Partial<MarkedField>) => void;
  onDelete: (index: number) => void;
  dragHandleProps?: any;
  fieldErrors?: FieldError[];
  isExpanded: boolean;
  onToggleExpand: () => void;
}

export const MarkedFieldCard: React.FC<MarkedFieldCardProps> = ({
  field,
  index,
  onUpdate,
  onDelete,
  dragHandleProps,
  fieldErrors = [],
  isExpanded,
  onToggleExpand,
}) => {
  const { t } = useTranslation();
  const [listDialogOpen, setListDialogOpen] = useState(false);
  const [customLists, setCustomLists] = useState<CustomDropdownList[]>([]);

  const typeConfig = FIELD_TYPE_CONFIG[field.type];

  const handleOpenListDialog = async () => {
    try {
      const response = await customDropdownListApi.getAllLists();
      setCustomLists(response.data || []);
      setListDialogOpen(true);
    } catch (error) {
      console.error('Failed to load custom lists:', error);
    }
  };

  const handleSelectList = (list: CustomDropdownList) => {
    onUpdate(index, {
      dropdown_list_name: list.name, // 커스텀 드롭다운 목록 이름 참조
      options: list.items // 폴백/미리보기용
    });
    setListDialogOpen(false);
  };

  // Handle label change - Field ID is auto-generated once and never changed
  const handleLabelChange = (newLabel: string) => {
    const updates: Partial<MarkedField> = { label: newLabel };

    // Auto-generate ID ONLY if it's completely empty (on first creation)
    // Once set, the ID remains stable even if the label changes
    if (!field.id || field.id.trim() === '') {
      const generatedId = generateFieldId(newLabel);
      if (generatedId) {
        updates.id = generatedId;
      }
    }
    // If field.id already exists, don't modify it - keep it stable

    onUpdate(index, updates);
  };

  // Extract node number from JSON path (e.g., "115.inputs.value" -> "Node 115")
  const getNodeInfo = (jsonPath: string) => {
    const match = jsonPath.match(/^(\d+)\./);
    return match ? `Node ${match[1]}` : jsonPath;
  };

  return (
    <Card
      sx={{
        mb: 2,
        borderLeft: `4px solid ${typeConfig.color}`,
        borderRadius: 2,
        overflow: 'hidden',
        transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
        bgcolor: isExpanded ? alpha(typeConfig.color, 0.02) : 'background.paper',
        '&:hover': {
          boxShadow: isExpanded ? 6 : 4,
          transform: 'translateY(-2px)',
          borderLeftWidth: '6px',
        },
      }}
    >
      {/* Collapsed Header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          px: 2,
          py: 1.5,
          cursor: 'pointer',
          '&:hover': {
            bgcolor: (theme) => alpha(theme.palette.action.hover, 0.04),
          },
        }}
        onClick={onToggleExpand}
      >
        {/* Drag Handle */}
        <Box
          {...dragHandleProps}
          sx={{
            display: 'flex',
            alignItems: 'center',
            mr: 1.5,
            cursor: 'grab',
            opacity: 0.3,
            transition: 'all 0.2s ease',
            color: typeConfig.color,
            '&:hover': {
              opacity: 1,
              transform: 'scale(1.1)',
            },
            '&:active': {
              cursor: 'grabbing',
              transform: 'scale(0.95)',
            },
          }}
          onClick={(e: React.MouseEvent) => e.stopPropagation()}
        >
          <DragIndicatorIcon fontSize="small" />
        </Box>

        {/* Field Type Icon */}
        <Typography sx={{ fontSize: '1.2rem', mr: 1 }}>
          {typeConfig.icon}
        </Typography>

        {/* Field Label and JSON Path */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
            {field.label || t('workflows:markedFields.unnamedField')}
            {field.required && (
              <Chip
                label="Required"
                size="small"
                color="error"
                sx={{ ml: 1, height: 20, fontSize: '0.7rem' }}
              />
            )}
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{
              display: 'block',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {field.jsonPath ? `${getNodeInfo(field.jsonPath)} • ${field.jsonPath}` : t('workflows:markedFields.noJsonPath')}
          </Typography>
          {/* Show validation errors/warnings */}
          {fieldErrors.length > 0 && (
            <Box sx={{ mt: 0.5 }}>
              {fieldErrors.map((error, idx) => (
                <Typography
                  key={idx}
                  variant="caption"
                  sx={{
                    display: 'block',
                    color: error.severity === 'error' ? 'error.main' : 'warning.main',
                    fontSize: '0.7rem',
                  }}
                >
                  {error.severity === 'error' ? '❌' : '⚠️'} {error.message}
                </Typography>
              ))}
            </Box>
          )}
        </Box>

        {/* Field Type Badge */}
        <Chip
          label={typeConfig.label}
          size="small"
          sx={{
            bgcolor: alpha(typeConfig.color, 0.1),
            color: typeConfig.color,
            fontWeight: 600,
            mr: 1,
          }}
        />

        {/* Expand/Collapse Icon */}
        <IconButton
          size="small"
          sx={{
            transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.3s',
          }}
        >
          <ExpandMoreIcon />
        </IconButton>
      </Box>

      {/* Expanded Content */}
      <Collapse in={isExpanded} timeout={{ enter: 300, exit: 250 }} unmountOnExit>
        <CardContent
          sx={{
            pt: 2,
            pb: 2,
            borderTop: '1px solid',
            borderColor: 'divider',
            bgcolor: (theme) => alpha(theme.palette.background.default, 0.3),
          }}
        >
          {/* Label and Type (Field ID is auto-generated internally) */}
          <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
            <TextField
              label={t('workflows:fieldForm.label')}
              value={field.label}
              onChange={(e) => handleLabelChange(e.target.value)}
              size="small"
              placeholder={t('workflows:fieldForm.labelPlaceholder')}
              helperText={t('workflows:fieldForm.labelHelper')}
              sx={{ flex: 2 }}
            />
            <TextField
              select
              label={t('workflows:fieldForm.type')}
              value={field.type}
              onChange={(e) => onUpdate(index, { type: e.target.value as any })}
              size="small"
              helperText={t('workflows:fieldForm.typeHelper')}
              sx={{ flex: 1 }}
              SelectProps={{ native: true }}
            >
              <option value="text">{t('workflows:fieldForm.typeText')}</option>
              <option value="textarea">{t('workflows:fieldForm.typeTextarea')}</option>
              <option value="number">{t('workflows:fieldForm.typeNumber')}</option>
              <option value="select">{t('workflows:fieldForm.typeSelect')}</option>
              <option value="image">Image</option>
            </TextField>
          </Box>

          {/* Description - guide text for this field */}
          <TextField
            fullWidth
            multiline
            minRows={2}
            maxRows={4}
            label={t('workflows:fieldForm.description')}
            value={field.description || ''}
            onChange={(e) => onUpdate(index, { description: e.target.value })}
            size="small"
            placeholder={t('workflows:fieldForm.descriptionPlaceholder')}
            helperText={t('workflows:fieldForm.descriptionHelper')}
            sx={{ mb: 2 }}
          />

          {/* JSON Path and Default Value */}
          <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
            <TextField
              fullWidth
              label={t('workflows:fieldForm.jsonPath')}
              value={field.jsonPath}
              onChange={(e) => onUpdate(index, { jsonPath: e.target.value })}
              placeholder={t('workflows:fieldForm.jsonPathPlaceholder')}
              size="small"
              helperText={t('workflows:fieldForm.jsonPathHelper')}
              sx={{ flex: 2 }}
            />
            <TextField
              fullWidth
              label={t('workflows:fieldForm.defaultValue')}
              value={field.default_value || ''}
              onChange={(e) => onUpdate(index, { default_value: e.target.value })}
              size="small"
              placeholder={t('workflows:fieldForm.defaultValuePlaceholder')}
              helperText={t('workflows:fieldForm.defaultValueHelper')}
              sx={{ flex: 1 }}
            />
          </Box>

          {/* Number Range Fields */}
          {field.type === 'number' && (
            <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
              <TextField
                label={t('workflows:fieldForm.minValue')}
                type="number"
                value={field.min ?? ''}
                onChange={(e) => onUpdate(index, { min: e.target.value ? parseFloat(e.target.value) : undefined })}
                size="small"
                placeholder={t('workflows:fieldForm.minPlaceholder')}
                sx={{ flex: 1 }}
              />
              <TextField
                label={t('workflows:fieldForm.maxValue')}
                type="number"
                value={field.max ?? ''}
                onChange={(e) => onUpdate(index, { max: e.target.value ? parseFloat(e.target.value) : undefined })}
                size="small"
                placeholder={t('workflows:fieldForm.maxPlaceholder')}
                sx={{ flex: 1 }}
              />
              <TextField
                label={t('workflows:markedFields.stepLabel')}
                type="number"
                value={field.step ?? ''}
                onChange={(e) => onUpdate(index, { step: e.target.value ? parseFloat(e.target.value) : undefined })}
                size="small"
                placeholder={t('workflows:markedFields.stepPlaceholder')}
                helperText={t('workflows:markedFields.stepHelperText')}
                inputProps={{ step: 'any', min: 0 }}
                sx={{ flex: 1 }}
              />
            </Box>
          )}

          {/* Select Options */}
          {field.type === 'select' && (
            <Box sx={{ mb: 2 }}>
              {/* 참조 중인 커스텀 드롭다운 목록 표시 */}
              {field.dropdown_list_name && (
                <Box sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Chip
                    label={`📋 ${field.dropdown_list_name}`}
                    size="small"
                    color="primary"
                    variant="outlined"
                    onDelete={() => onUpdate(index, { dropdown_list_name: undefined })}
                    sx={{ fontWeight: 500 }}
                  />
                  <Typography variant="caption" color="text.secondary">
                    {t('workflows:markedFields.autoUpdated')}
                  </Typography>
                </Box>
              )}
              <Box sx={{ display: 'flex', gap: 1 }}>
                <TextField
                  fullWidth
                  label={t('workflows:fieldForm.selectOptions')}
                  value={field.options?.join(', ') || ''}
                  onChange={(e) =>
                    onUpdate(index, {
                      options: e.target.value
                        .split(',')
                        .map((s) => s.trim())
                        .filter((s) => s),
                    })
                  }
                  size="small"
                  placeholder={t('workflows:fieldForm.selectOptionsPlaceholder')}
                  helperText={field.dropdown_list_name ? t('workflows:markedFields.listPreviewHelper') : t('workflows:fieldForm.selectOptionsHelper')}
                  disabled={!!field.dropdown_list_name}
                />
                <IconButton
                  size="small"
                  onClick={handleOpenListDialog}
                  title={t('workflows:markedFields.loadFromListTooltip')}
                  sx={{ alignSelf: 'flex-start', mt: 0.5 }}
                >
                  <PlaylistAddIcon />
                </IconButton>
              </Box>
            </Box>
          )}

          {/* Actions */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <FormControlLabel
              control={
                <Switch
                  checked={field.required || false}
                  onChange={(e) => onUpdate(index, { required: e.target.checked })}
                  size="small"
                />
              }
              label={t('workflows:fieldForm.required')}
            />
            <IconButton onClick={() => onDelete(index)} color="error" size="small">
              <DeleteIcon />
            </IconButton>
          </Box>
        </CardContent>
      </Collapse>

      {/* Custom List Selection Dialog */}
      <Dialog
        open={listDialogOpen}
        onClose={() => setListDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{t('workflows:markedFields.loadFromListTitle')}</DialogTitle>
        <DialogContent>
          {customLists.length === 0 ? (
            <Typography variant="body2" color="text.secondary" align="center" sx={{ py: 2 }}>
              {t('workflows:markedFields.noCustomLists')}
            </Typography>
          ) : (
            <List>
              {customLists.map((list) => (
                <ListItem key={list.id} disablePadding>
                  <ListItemButton onClick={() => handleSelectList(list)}>
                    <ListItemText
                      primary={list.name}
                      secondary={`${t('workflows:markedFields.itemCount', { count: list.items.length })}${list.items.slice(0, 3).join(', ')}${list.items.length > 3 ? '...' : ''}`}
                    />
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setListDialogOpen(false)}>{t('common:buttons.cancel')}</Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
};
