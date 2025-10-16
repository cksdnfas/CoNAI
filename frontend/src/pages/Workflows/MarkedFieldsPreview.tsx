import { useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  Alert,
  Divider,
  Button,
  TextField,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Chip
} from '@mui/material';
import {
  Visibility as VisibilityIcon,
  ExpandMore as ExpandMoreIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon
} from '@mui/icons-material';
import { type MarkedField } from '../../services/api/workflowApi';

interface MarkedFieldsPreviewProps {
  workflowJson: string;
  markedFields: MarkedField[];
}

export function MarkedFieldsPreview({ workflowJson, markedFields }: MarkedFieldsPreviewProps) {
  const [testData, setTestData] = useState<Record<string, any>>({});
  const [showSubstituted, setShowSubstituted] = useState(false);

  // Workflow JSON 파싱
  let workflowObj: any = null;
  let parseError: string | null = null;

  try {
    if (workflowJson.trim()) {
      workflowObj = JSON.parse(workflowJson);
    }
  } catch (err) {
    parseError = 'Workflow JSON을 파싱할 수 없습니다';
  }

  // 각 필드의 경로 검증
  const validatePath = (jsonPath: string): { valid: boolean; currentValue: any; error?: string } => {
    if (!workflowObj) {
      return { valid: false, currentValue: null, error: 'Workflow JSON이 없습니다' };
    }

    try {
      const keys = jsonPath.split('.');
      let current: any = workflowObj;

      for (const key of keys) {
        if (current && typeof current === 'object' && key in current) {
          current = current[key];
        } else {
          return { valid: false, currentValue: null, error: `경로를 찾을 수 없습니다: ${jsonPath}` };
        }
      }

      return { valid: true, currentValue: current };
    } catch (err) {
      return { valid: false, currentValue: null, error: '경로 검증 중 오류 발생' };
    }
  };

  // 테스트 데이터 생성
  const generateTestData = () => {
    const data: Record<string, any> = {};
    markedFields.forEach((field) => {
      data[field.id] = field.default_value || (field.type === 'number' ? 0 : '');
    });
    setTestData(data);
    setShowSubstituted(true);
  };

  // 워크플로우 JSON에 테스트 데이터 치환
  const substituteTestData = (): string => {
    if (!workflowObj) return '';

    try {
      const cloned = JSON.parse(JSON.stringify(workflowObj));

      markedFields.forEach((field) => {
        const value = testData[field.id] || field.default_value;
        if (value === undefined || value === null) return;

        const keys = field.jsonPath.split('.');
        let current: any = cloned;

        for (let i = 0; i < keys.length - 1; i++) {
          if (!(keys[i] in current)) {
            current[keys[i]] = {};
          }
          current = current[keys[i]];
        }

        const lastKey = keys[keys.length - 1];
        current[lastKey] = field.type === 'number' ? parseFloat(value) || 0 : value;
      });

      return JSON.stringify(cloned, null, 2);
    } catch (err) {
      return '치환 중 오류 발생';
    }
  };

  // 필드 렌더링 (실제 생성 페이지와 동일)
  const renderField = (field: MarkedField) => {
    const value = testData[field.id] || field.default_value || '';

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
            onChange={(e) => setTestData({ ...testData, [field.id]: e.target.value })}
            placeholder={field.placeholder}
            size="small"
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
            onChange={(e) => setTestData({ ...testData, [field.id]: e.target.value })}
            placeholder={field.placeholder}
            inputProps={{
              min: field.min,
              max: field.max
            }}
            size="small"
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
            onChange={(e) => setTestData({ ...testData, [field.id]: e.target.value })}
            SelectProps={{ native: true }}
            size="small"
            sx={{ mb: 2 }}
          >
            <option value="">선택하세요</option>
            {field.options?.map((option: string) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </TextField>
        );

      default: // text
        return (
          <TextField
            key={field.id}
            fullWidth
            label={field.label}
            value={value}
            onChange={(e) => setTestData({ ...testData, [field.id]: e.target.value })}
            placeholder={field.placeholder}
            size="small"
            sx={{ mb: 2 }}
          />
        );
    }
  };

  if (markedFields.length === 0) {
    return null;
  }

  return (
    <Paper sx={{ p: 3, mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <VisibilityIcon color="primary" />
        <Typography variant="h6">
          Marked Fields 미리보기
        </Typography>
      </Box>
      <Divider sx={{ mb: 3 }} />

      {parseError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {parseError}
        </Alert>
      )}

      {/* 경로 검증 결과 */}
      {workflowObj && (
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle1" gutterBottom>
            경로 검증 결과
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {markedFields.map((field) => {
              const validation = validatePath(field.jsonPath);
              return (
                <Box
                  key={field.id}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    p: 1,
                    bgcolor: validation.valid ? 'success.50' : 'error.50',
                    borderRadius: 1
                  }}
                >
                  {validation.valid ? (
                    <CheckCircleIcon color="success" fontSize="small" />
                  ) : (
                    <ErrorIcon color="error" fontSize="small" />
                  )}
                  <Typography variant="body2">
                    <strong>{field.label}</strong> ({field.jsonPath})
                  </Typography>
                  {validation.valid && validation.currentValue !== undefined && (
                    <Chip
                      label={`현재 값: ${JSON.stringify(validation.currentValue)}`}
                      size="small"
                      sx={{ ml: 'auto' }}
                    />
                  )}
                  {!validation.valid && (
                    <Typography variant="caption" color="error" sx={{ ml: 'auto' }}>
                      ⚠️ {validation.error}
                    </Typography>
                  )}
                </Box>
              );
            })}
          </Box>
        </Box>
      )}

      {/* 미리보기 폼 */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="subtitle1" gutterBottom>
          이미지 생성 시 표시될 폼
        </Typography>
        <Box sx={{ p: 2, border: '1px dashed', borderColor: 'divider', borderRadius: 1, bgcolor: 'background.default' }}>
          {markedFields.map((field) => renderField(field))}
          <Button variant="contained" fullWidth disabled>
            이미지 생성 (미리보기)
          </Button>
        </Box>
      </Box>

      {/* 테스트 치환 */}
      <Box>
        <Button
          variant="outlined"
          onClick={generateTestData}
          sx={{ mb: 2 }}
        >
          테스트 데이터로 미리보기
        </Button>

        {showSubstituted && (
          <Accordion>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography variant="body2">
                치환된 Workflow JSON 보기
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
                {substituteTestData()}
              </Box>
            </AccordionDetails>
          </Accordion>
        )}
      </Box>
    </Paper>
  );
}
