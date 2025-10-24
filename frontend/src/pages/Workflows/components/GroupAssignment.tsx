import { Box, Typography, Paper, Button, Chip, Divider } from '@mui/material';
import { FolderOpen as FolderIcon } from '@mui/icons-material';
import type { GroupWithStats } from '@comfyui-image-manager/shared';

interface GroupAssignmentProps {
  selectedGroup: GroupWithStats | null;
  onOpenModal: () => void;
  onRemove: () => void;
}

/**
 * 그룹 할당 컴포넌트
 * - 그룹 선택 UI
 * - 선택된 그룹 표시 및 제거
 */
export function GroupAssignment({
  selectedGroup,
  onOpenModal,
  onRemove
}: GroupAssignmentProps) {
  return (
    <Paper sx={{ p: 3 }}>
      <Typography variant="subtitle1" gutterBottom fontWeight="bold">
        그룹 할당
      </Typography>
      <Divider sx={{ mb: 2 }} />
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {selectedGroup ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Chip
              icon={<FolderIcon />}
              label={selectedGroup.name}
              onDelete={onRemove}
              color="primary"
              sx={{ flex: 1 }}
            />
          </Box>
        ) : (
          <Button
            variant="outlined"
            startIcon={<FolderIcon />}
            onClick={onOpenModal}
            fullWidth
          >
            그룹 선택
          </Button>
        )}
        <Typography variant="caption" color="text.secondary">
          생성된 이미지가 선택한 그룹에 자동으로 추가됩니다
        </Typography>
      </Box>
    </Paper>
  );
}
