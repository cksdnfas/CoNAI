import React from 'react';
import {
  Box,
  Button,
  FormControlLabel,
  Switch,
  Typography,
  Alert,
} from '@mui/material';
import { Add as AddIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import type { AutoCollectCondition } from '@comfyui-image-manager/shared';
import ConditionCard from './ConditionCard';

interface AutoCollectTabProps {
  enabled: boolean;
  conditions: AutoCollectCondition[];
  onEnabledChange: (enabled: boolean) => void;
  onAddCondition: () => void;
  onUpdateCondition: <K extends keyof AutoCollectCondition>(
    index: number,
    field: K,
    value: AutoCollectCondition[K]
  ) => void;
  onRemoveCondition: (index: number) => void;
}

const AutoCollectTab: React.FC<AutoCollectTabProps> = ({
  enabled,
  conditions,
  onEnabledChange,
  onAddCondition,
  onUpdateCondition,
  onRemoveCondition,
}) => {
  const { t } = useTranslation(['imageGroups']);

  return (
    <Box>
      {/* 자동수집 활성화 토글 */}
      <Box sx={{ mb: 3 }}>
        <FormControlLabel
          control={
            <Switch
              checked={enabled}
              onChange={(e) => onEnabledChange(e.target.checked)}
              color="primary"
            />
          }
          label={
            <Typography variant="subtitle1" fontWeight={500}>
              {t('imageGroups:modal.autoCollectEnable')}
            </Typography>
          }
        />

        <Typography variant="body2" color="text.secondary" sx={{ mt: 1, ml: 4 }}>
          {t('imageGroups:modal.autoCollectDescription')}
        </Typography>
      </Box>

      {/* OR 조건 안내 */}
      {enabled && (
        <Alert severity="info" sx={{ mb: 3 }}>
          <Typography variant="body2" fontWeight={500} gutterBottom>
            {t('imageGroups:modal.orConditionInfo')}
          </Typography>
          <Typography variant="caption" component="div">
            {t('imageGroups:modal.orConditionExample')}
          </Typography>
        </Alert>
      )}

      {/* 자동수집 조건 리스트 */}
      {enabled && (
        <Box>
          {/* 헤더: 조건 제목 + 추가 버튼 */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6">
              {t('imageGroups:modal.conditionsTitle')}
            </Typography>
            <Button
              startIcon={<AddIcon />}
              onClick={onAddCondition}
              variant="contained"
              size="medium"
            >
              {t('imageGroups:modal.addCondition')}
            </Button>
          </Box>

          {/* 조건 카드 리스트 */}
          {conditions.length > 0 ? (
            <Box>
              {conditions.map((condition, index) => (
                <ConditionCard
                  key={index}
                  condition={condition}
                  index={index}
                  onUpdate={(field, value) => onUpdateCondition(index, field, value)}
                  onRemove={() => onRemoveCondition(index)}
                />
              ))}
            </Box>
          ) : (
            <Box
              sx={{
                border: '2px dashed',
                borderColor: 'grey.300',
                borderRadius: 2,
                p: 4,
                textAlign: 'center',
              }}
            >
              <Typography variant="body2" color="text.secondary">
                {t('imageGroups:modal.emptyConditions')}
              </Typography>
              <Button
                startIcon={<AddIcon />}
                onClick={onAddCondition}
                variant="outlined"
                size="small"
                sx={{ mt: 2 }}
              >
                {t('imageGroups:conditions.addFirstCondition')}
              </Button>
            </Box>
          )}
        </Box>
      )}

      {/* 비활성화 상태 안내 */}
      {!enabled && (
        <Box
          sx={{
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 2,
            p: 3,
            textAlign: 'center',
            backgroundColor: (theme) =>
              theme.palette.mode === 'dark' ? 'background.paper' : 'grey.50',
          }}
        >
          <Typography variant="body2" color="text.secondary">
            {t('imageGroups:conditions.autoCollectDisabled')}
          </Typography>
        </Box>
      )}
    </Box>
  );
};

export default AutoCollectTab;
