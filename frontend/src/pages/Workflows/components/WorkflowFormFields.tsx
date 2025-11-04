import { useState } from 'react';
import {
  Box,
  TextField,
  Typography,
  Paper,
  Alert,
  Divider,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Button,
  Card,
  CardMedia
} from '@mui/material';
import { ExpandMore as ExpandMoreIcon, Image as ImageIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import type { Workflow, MarkedField } from '../../../services/api/workflowApi';
import ImageSelectionModal from './ImageSelectionModal';

interface WorkflowFormFieldsProps {
  workflow: Workflow;
  formData: Record<string, any>;
  onFieldChange: (fieldId: string, value: any) => void;
  promptData: Record<string, any>;
}

/**
 * 워크플로우 입력 폼 컴포넌트
 * - Marked Fields 렌더링
 * - 전송 데이터 미리보기
 */
export function WorkflowFormFields({
  workflow,
  formData,
  onFieldChange,
  promptData
}: WorkflowFormFieldsProps) {
  const { t } = useTranslation(['workflows']);
  const [imageModalOpen, setImageModalOpen] = useState(false);
  const [currentImageField, setCurrentImageField] = useState<MarkedField | null>(null);

  const handleOpenImageModal = (field: MarkedField) => {
    setCurrentImageField(field);
    setImageModalOpen(true);
  };

  const handleSelectImage = (imagePath: string) => {
    if (currentImageField) {
      onFieldChange(currentImageField.id, imagePath);
    }
    setImageModalOpen(false);
    setCurrentImageField(null);
  };

  const renderField = (field: MarkedField) => {
    const value = formData[field.id] || '';

    switch (field.type) {
      case 'textarea':
        return (
          <TextField
            key={field.id}
            fullWidth
            multiline
            rows={4}
            label={field.label}
            value={value}
            onChange={(e) => onFieldChange(field.id, e.target.value)}
            required={field.required}
            placeholder={field.placeholder}
            sx={{ mb: 2 }}
          />
        );

      case 'number':
        return (
          <TextField
            key={field.id}
            fullWidth
            type="number"
            label={field.label}
            value={value}
            onChange={(e) => onFieldChange(field.id, e.target.value)}
            required={field.required}
            placeholder={field.placeholder}
            inputProps={{
              min: field.min,
              max: field.max,
              step: field.step || 1
            }}
            sx={{ mb: 2 }}
          />
        );

      case 'select':
        return (
          <TextField
            key={field.id}
            fullWidth
            select
            label={field.label}
            value={value}
            onChange={(e) => onFieldChange(field.id, e.target.value)}
            required={field.required}
            SelectProps={{ native: true }}
            sx={{ mb: 2 }}
          >
            <option value="">{t('workflows:generate.selectPlaceholder')}</option>
            {field.options?.map((option: string) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </TextField>
        );

      case 'image':
        return (
          <Box key={field.id} sx={{ mb: 2 }}>
            <Typography variant="subtitle2" gutterBottom>
              {field.label} {field.required && <span style={{ color: 'red' }}>*</span>}
            </Typography>
            <Button
              variant="outlined"
              startIcon={<ImageIcon />}
              onClick={() => handleOpenImageModal(field)}
              fullWidth
              sx={{ mb: 1 }}
            >
              이미지 선택
            </Button>
            {value && (
              <Card sx={{ mt: 1 }}>
                <CardMedia
                  component="img"
                  height="200"
                  image={value.startsWith('data:') ? value : `http://localhost:1566${value}`}
                  alt={field.label}
                  sx={{ objectFit: 'contain' }}
                />
              </Card>
            )}
          </Box>
        );

      default: // text
        return (
          <TextField
            key={field.id}
            fullWidth
            label={field.label}
            value={value}
            onChange={(e) => onFieldChange(field.id, e.target.value)}
            required={field.required}
            placeholder={field.placeholder}
            sx={{ mb: 2 }}
          />
        );
    }
  };

  return (
    <Paper sx={{ p: 3 }}>
      <Typography variant="h6" gutterBottom>
        {t('workflows:generate.settingsTitle')}
      </Typography>
      <Divider sx={{ mb: 3 }} />

      {workflow.marked_fields && workflow.marked_fields.length > 0 ? (
        <Box>
          {workflow.marked_fields.map((field: MarkedField) => renderField(field))}
        </Box>
      ) : (
        <Alert severity="info" sx={{ mb: 2 }}>
          {t('workflows:alerts.noConfigurableFields')}
        </Alert>
      )}

      {/* 전송 데이터 미리보기 */}
      <Accordion>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="body2">
            {t('workflows:generate.previewTitle')}
          </Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Box
            component="pre"
            sx={{
              p: 2,
              borderRadius: 1,
              overflow: 'auto',
              maxHeight: 400,
              fontSize: '0.75rem',
              fontFamily: 'monospace'
            }}
          >
            {JSON.stringify(promptData, null, 2)}
          </Box>
        </AccordionDetails>
      </Accordion>

      {/* Image Selection Modal */}
      {currentImageField && (
        <ImageSelectionModal
          open={imageModalOpen}
          onClose={() => {
            setImageModalOpen(false);
            setCurrentImageField(null);
          }}
          onSelect={handleSelectImage}
          fieldLabel={currentImageField.label}
        />
      )}
    </Paper>
  );
}
