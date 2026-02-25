import React from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  IconButton,
  Chip,
} from '@mui/material';
import {
  Edit as EditIcon,
  Delete as DeleteIcon,
  Add as AddIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import type { RatingTier } from '../../../../../types/rating';

interface TierManagementProps {
  tiers: RatingTier[];
  saving: boolean;
  onOpenTierDialog: (mode: 'create' | 'edit', tier?: RatingTier) => void;
  onDeleteTier: (id: number) => void;
}

export const TierManagement: React.FC<TierManagementProps> = ({
  tiers,
  saving,
  onOpenTierDialog,
  onDeleteTier,
}) => {
  const { t } = useTranslation('settings');

  const handleDelete = (id: number) => {
    if (window.confirm(t('rating.tiers.alerts.deleteConfirm'))) {
      onDeleteTier(id);
    }
  };

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Box>
            <Typography variant="h6" gutterBottom>
              {t('rating.tiers.title')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('rating.tiers.description')}
            </Typography>
          </Box>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => onOpenTierDialog('create')}
          >
            {t('rating.tiers.addButton')}
          </Button>
        </Box>

        <TableContainer component={Paper} variant="outlined">
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>{t('rating.tiers.table.order')}</TableCell>
                <TableCell>{t('rating.tiers.table.name')}</TableCell>
                <TableCell>{t('rating.tiers.table.scoreRange')}</TableCell>
                <TableCell>{t('rating.tiers.table.color')}</TableCell>
                <TableCell align="right">{t('rating.tiers.table.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {tiers.map((tier) => (
                <TableRow key={tier.id}>
                  <TableCell>{tier.tier_order}</TableCell>
                  <TableCell>
                    <Chip
                      label={tier.tier_name}
                      sx={{
                        bgcolor: tier.color || undefined,
                        color: 'white',
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    {t('rating.tiers.table.scoreFormat', {
                      min: tier.min_score,
                      max: tier.max_score !== null ? tier.max_score : t('rating.tiers.table.infinity'),
                    })}
                  </TableCell>
                  <TableCell>
                    <Box
                      sx={{
                        width: 24,
                        height: 24,
                        bgcolor: tier.color || '#ccc',
                        borderRadius: 1,
                      }}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <IconButton
                      size="small"
                      onClick={() => onOpenTierDialog('edit', tier)}
                      disabled={saving}
                    >
                      <EditIcon fontSize="small" />
                    </IconButton>
                    <IconButton
                      size="small"
                      onClick={() => handleDelete(tier.id)}
                      disabled={saving}
                      color="error"
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
              {tiers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} align="center">
                    <Typography variant="body2" color="text.secondary">
                      {t('rating.tiers.table.empty')}
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </CardContent>
    </Card>
  );
};
