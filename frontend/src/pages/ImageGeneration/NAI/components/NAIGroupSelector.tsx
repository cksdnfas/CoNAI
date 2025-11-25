import {
  Box,
  Button,
  Chip,
  Typography,
  Divider,
  Paper
} from '@mui/material';
import { FolderOpen as FolderIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation(['imageGeneration']);

  return (
    <Paper sx={{ p: 3 }}>
      <Typography variant="subtitle1" gutterBottom fontWeight="bold">
        {t('imageGeneration:nai.groupSelector.title')}
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
            {t('imageGeneration:nai.groupSelector.selectButton')}
          </Button>
        )}
        <Typography variant="caption" color="text.secondary">
          {t('imageGeneration:nai.groupSelector.description')}
        </Typography>
      </Box>
    </Paper>
  );
}
