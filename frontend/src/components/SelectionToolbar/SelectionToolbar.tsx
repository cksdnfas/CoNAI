import React from 'react';
import {
  Paper,
  Box,
  Typography,
  IconButton,
  Tooltip,
  Divider,
  Chip,
} from '@mui/material';
import {
  CheckBox as CheckBoxIcon,
  CheckBoxOutlineBlank as CheckBoxOutlineBlankIcon,
  SelectAll as SelectAllIcon,
  Deselect as DeselectIcon,
  Info as InfoIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

interface SelectionToolbarProps {
  selectionEnabled: boolean;
  onToggleSelection: () => void;
  selectedCount: number;
  totalCount: number;
  onSelectAll?: () => void;
  onDeselectAll?: () => void;
  showHelp?: boolean;
}

const SelectionToolbar: React.FC<SelectionToolbarProps> = ({
  selectionEnabled,
  onToggleSelection,
  selectedCount,
  totalCount,
  onSelectAll,
  onDeselectAll,
  showHelp = true,
}) => {
  const { t } = useTranslation(['gallery']);

  return (
    <Paper
      elevation={1}
      sx={{
        p: 2,
        mb: 2,
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        flexWrap: 'wrap',
      }}
    >
      {/* 선택 모드 토글 */}
      <Tooltip title={selectionEnabled ? t('gallery:selection.toggleMode') : t('gallery:selection.activateMode')}>
        <IconButton
          onClick={onToggleSelection}
          color={selectionEnabled ? 'primary' : 'default'}
          sx={{
            border: selectionEnabled ? 2 : 1,
            borderColor: selectionEnabled ? 'primary.main' : 'divider',
          }}
        >
          {selectionEnabled ? <CheckBoxIcon /> : <CheckBoxOutlineBlankIcon />}
        </IconButton>
      </Tooltip>

      {/* 선택 상태 표시 */}
      {selectionEnabled && (
        <>
          <Divider orientation="vertical" flexItem />

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="body1" sx={{ fontWeight: 500 }}>
              {t('gallery:selection.selectedImages')}
            </Typography>
            <Chip
              label={`${selectedCount} / ${totalCount}`}
              color={selectedCount > 0 ? 'primary' : 'default'}
              size="small"
            />
          </Box>

          {/* 전체 선택/해제 버튼 */}
          {onSelectAll && onDeselectAll && (
            <>
              <Divider orientation="vertical" flexItem />

              <Box sx={{ display: 'flex', gap: 1 }}>
                <Tooltip title={t('gallery:selection.selectAll')}>
                  <IconButton
                    size="small"
                    onClick={onSelectAll}
                    disabled={selectedCount === totalCount}
                    color="primary"
                  >
                    <SelectAllIcon />
                  </IconButton>
                </Tooltip>

                <Tooltip title={t('gallery:selection.deselectAll')}>
                  <IconButton
                    size="small"
                    onClick={onDeselectAll}
                    disabled={selectedCount === 0}
                    color="default"
                  >
                    <DeselectIcon />
                  </IconButton>
                </Tooltip>
              </Box>
            </>
          )}

          {/* 도움말 */}
          {showHelp && (
            <>
              <Divider orientation="vertical" flexItem />

              <Tooltip
                title={
                  <Box sx={{ p: 1 }}>
                    <Typography variant="caption" component="div" gutterBottom>
                      <strong>{t('gallery:selection.methods.title')}</strong>
                    </Typography>
                    <Typography variant="caption" component="div">
                      {t('gallery:selection.methods.click')}
                    </Typography>
                    <Typography variant="caption" component="div">
                      {t('gallery:selection.methods.drag')}
                    </Typography>
                    <Typography variant="caption" component="div">
                      {t('gallery:selection.methods.shiftClick')}
                    </Typography>
                    <Typography variant="caption" component="div">
                      {t('gallery:selection.methods.ctrlClick')}
                    </Typography>
                    <Typography variant="caption" component="div">
                      {t('gallery:selection.methods.ctrlA')}
                    </Typography>
                    <Typography variant="caption" component="div">
                      {t('gallery:selection.methods.esc')}
                    </Typography>
                  </Box>
                }
                arrow
              >
                <IconButton size="small" color="info">
                  <InfoIcon />
                </IconButton>
              </Tooltip>
            </>
          )}
        </>
      )}
    </Paper>
  );
};

export default SelectionToolbar;
