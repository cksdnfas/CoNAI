import {
  Box,
  Button,
  Chip,
  Typography,
  Divider,
  Paper
} from '@mui/material';
import { FolderOpen as FolderIcon } from '@mui/icons-material';
import type { GroupWithStats } from '@comfyui-image-manager/shared';

interface NAIGroupSelectorProps {
  selectedGroup: GroupWithStats | null;
  onOpenModal: () => void;
  onRemoveGroup: () => void;
  disabled?: boolean;
}

export default function NAIGroupSelector({
  selectedGroup,
  onOpenModal,
  onRemoveGroup,
  disabled = false
}: NAIGroupSelectorProps) {
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
              onDelete={onRemoveGroup}
              color="primary"
              sx={{ flex: 1 }}
            />
          </Box>
        ) : (
          <Button
            variant="outlined"
            startIcon={<FolderIcon />}
            onClick={onOpenModal}
            disabled={disabled}
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
