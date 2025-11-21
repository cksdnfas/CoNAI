import { useState, useEffect } from 'react';
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
import { HierarchicalModelSelector } from './HierarchicalModelSelector';
import { WildcardTextField } from './WildcardTextField';
import { customDropdownListApi } from '../../../services/api/customDropdownListApi';

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
  const [dropdownOptions, setDropdownOptions] = useState<Record<string, string[]>>({});

  // 워크플로우가 변경될 때마다 참조된 드롭다운 목록들의 최신 데이터 로드
  useEffect(() => {
    const loadDropdownLists = async () => {
      if (!workflow.marked_fields) return;

      const optionsMap: Record<string, string[]> = {};

      for (const field of workflow.marked_fields) {
        if (field.type === 'select' && field.dropdown_list_name) {
          try {
            const response = await customDropdownListApi.getListByName(field.dropdown_list_name);
            if (response.success && response.data) {
              optionsMap[field.id] = response.data.items;
            } else {
              // 목록을 찾지 못한 경우 폴백 옵션 사용
              console.warn(`Dropdown list "${field.dropdown_list_name}" not found, using fallback options`);
              optionsMap[field.id] = field.options || [];
            }
          } catch (error) {
            // 에러 발생 시 폴백 옵션 사용
            console.error(`Failed to load dropdown list "${field.dropdown_list_name}":`, error);
            optionsMap[field.id] = field.options || [];
          }
        } else if (field.type === 'select') {
          // 참조가 없는 경우 기존 options 사용
          optionsMap[field.id] = field.options || [];
        }
      }

      setDropdownOptions(optionsMap);

      // 드롭다운 옵션이 로드된 후, 값이 없는 select 필드에 첫 번째 옵션 자동 설정
      for (const field of workflow.marked_fields) {
        if (field.type === 'select') {
          const options = optionsMap[field.id] || field.options || [];
          const currentValue = formData[field.id];

          // 값이 없거나 빈 문자열인 경우, 첫 번째 옵션으로 자동 설정
          if ((!currentValue || currentValue === '') && options.length > 0) {
            onFieldChange(field.id, options[0]);
          }
        }
      }
    };

    loadDropdownLists();
  }, [workflow]);

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
          <WildcardTextField
            key={field.id}
            multiline
            rows={4}
            label={field.label}
            value={value}
            onChange={(newValue) => onFieldChange(field.id, newValue)}
            required={field.required}
            placeholder={field.placeholder}
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

      case 'select': {
        // dropdown_list_name이 있으면 최신 데이터 사용, 없으면 기존 options 사용
        const options = dropdownOptions[field.id] || field.options || [];
        const hasSubfolders = options.some((opt: string) => opt.includes('/'));

        // 하위폴더가 있는 경우 계층형 선택기 사용
        if (hasSubfolders) {
          return (
            <Box key={field.id} sx={{ mb: 2 }}>
              <HierarchicalModelSelector
                options={options}
                value={value}
                onChange={(newValue) => onFieldChange(field.id, newValue)}
                label={field.label}
                helperText={field.dropdown_list_name ? `📋 ${field.dropdown_list_name}` : undefined}
              />
            </Box>
          );
        }

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
            helperText={field.dropdown_list_name ? `📋 ${field.dropdown_list_name}` : undefined}
          >
            {options.map((option: string) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </TextField>
        );
      }

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
              {t('workflows:form.selectImage')}
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
          <WildcardTextField
            key={field.id}
            label={field.label}
            value={value}
            onChange={(newValue) => onFieldChange(field.id, newValue)}
            required={field.required}
            placeholder={field.placeholder}
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
