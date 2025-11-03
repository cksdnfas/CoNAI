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
} from '@mui/material';
import {
  Delete as DeleteIcon,
  ExpandMore as ExpandMoreIcon,
  DragIndicator as DragIndicatorIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import type { MarkedField } from '../../../../services/api/workflowApi';
import { generateFieldId } from './utils/smartDefaults';
import type { FieldError } from './hooks/useMarkedFieldValidation';

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
};

interface MarkedFieldCardProps {
  field: MarkedField;
  index: number;
  onUpdate: (index: number, updates: Partial<MarkedField>) => void;
  onDelete: (index: number) => void;
  dragHandleProps?: any;
  fieldErrors?: FieldError[];
}

export const MarkedFieldCard: React.FC<MarkedFieldCardProps> = ({
  field,
  index,
  onUpdate,
  onDelete,
  dragHandleProps,
  fieldErrors = [],
}) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const typeConfig = FIELD_TYPE_CONFIG[field.type];

  // Check if field has errors or warnings
  const hasErrors = fieldErrors.some((e) => e.severity === 'error');
  const hasWarnings = fieldErrors.some((e) => e.severity === 'warning');

  const handleToggleExpand = () => {
    setExpanded(!expanded);
  };

  // Auto-generate Field ID from label
  const handleLabelChange = (newLabel: string) => {
    const updates: Partial<MarkedField> = { label: newLabel };

    // Auto-generate ID if it's empty or looks auto-generated (starts with 'field_')
    if (!field.id || field.id.startsWith('field_')) {
      const generatedId = generateFieldId(newLabel);
      if (generatedId) {
        updates.id = generatedId;
      }
    }

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
        bgcolor: expanded ? alpha(typeConfig.color, 0.02) : 'background.paper',
        '&:hover': {
          boxShadow: expanded ? 6 : 4,
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
        onClick={handleToggleExpand}
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
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.3s',
          }}
        >
          <ExpandMoreIcon />
        </IconButton>
      </Box>

      {/* Expanded Content */}
      <Collapse in={expanded} timeout={{ enter: 300, exit: 250 }} unmountOnExit>
        <CardContent
          sx={{
            pt: 2,
            pb: 2,
            borderTop: '1px solid',
            borderColor: 'divider',
            bgcolor: (theme) => alpha(theme.palette.background.default, 0.3),
          }}
        >
          {/* Field ID and Label */}
          <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
            <TextField
              label={t('workflows:fieldForm.fieldId')}
              value={field.id}
              onChange={(e) => onUpdate(index, { id: e.target.value })}
              size="small"
              placeholder={t('workflows:fieldForm.fieldIdPlaceholder')}
              helperText={t('workflows:fieldForm.fieldIdHelper')}
              sx={{ flex: 1 }}
            />
            <TextField
              label={t('workflows:fieldForm.label')}
              value={field.label}
              onChange={(e) => handleLabelChange(e.target.value)}
              size="small"
              placeholder={t('workflows:fieldForm.labelPlaceholder')}
              helperText={t('workflows:fieldForm.labelHelper')}
              sx={{ flex: 1 }}
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
            </TextField>
          </Box>

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
                label="단위 (Step)"
                type="number"
                value={field.step ?? ''}
                onChange={(e) => onUpdate(index, { step: e.target.value ? parseFloat(e.target.value) : undefined })}
                size="small"
                placeholder="0.01"
                helperText="값 변화 단위 (예: 0.01)"
                inputProps={{ step: 'any', min: 0 }}
                sx={{ flex: 1 }}
              />
            </Box>
          )}

          {/* Select Options */}
          {field.type === 'select' && (
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
              helperText={t('workflows:fieldForm.selectOptionsHelper')}
              sx={{ mb: 2 }}
            />
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
    </Card>
  );
};
