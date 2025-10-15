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
      <Tooltip title={selectionEnabled ? '선택 모드 비활성화' : '선택 모드 활성화'}>
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
              선택된 이미지:
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
                <Tooltip title="전체 선택">
                  <IconButton
                    size="small"
                    onClick={onSelectAll}
                    disabled={selectedCount === totalCount}
                    color="primary"
                  >
                    <SelectAllIcon />
                  </IconButton>
                </Tooltip>

                <Tooltip title="선택 해제">
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
                      <strong>선택 방법:</strong>
                    </Typography>
                    <Typography variant="caption" component="div">
                      • 클릭: 개별 선택/해제
                    </Typography>
                    <Typography variant="caption" component="div">
                      • 드래그: 여러 이미지 선택
                    </Typography>
                    <Typography variant="caption" component="div">
                      • Shift + 클릭: 범위 선택
                    </Typography>
                    <Typography variant="caption" component="div">
                      • Ctrl/Cmd + 클릭: 토글 선택
                    </Typography>
                    <Typography variant="caption" component="div">
                      • Ctrl/Cmd + A: 전체 선택
                    </Typography>
                    <Typography variant="caption" component="div">
                      • ESC: 선택 해제
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
