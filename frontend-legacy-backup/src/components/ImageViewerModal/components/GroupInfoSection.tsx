import React from 'react';
import { Box, Typography, Chip } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { ImageRecord } from '../../../types/image';

type ImageGroupInfo = NonNullable<ImageRecord['groups']>[number];

interface GroupInfoSectionProps {
  groups?: ImageGroupInfo[];
  onGroupClick: (group: ImageGroupInfo) => void;
}

/**
 * Group information section with clickable chips - optimized for light/dark modes
 */
export const GroupInfoSection: React.FC<GroupInfoSectionProps> = ({ groups, onGroupClick }) => {
  const { t } = useTranslation();

  if (!groups || groups.length === 0) return null;

  return (
    <Box sx={{ mb: 3 }}>
      <Typography variant="subtitle2" gutterBottom color="primary">
        {t('imageDetail:sections.groupInfo')}
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
        {groups.map((group, index) => (
          <Chip
            key={group.id ?? `group-${index}`}
            label={group.name}
            size="small"
            variant="filled"
            clickable
            onClick={() => onGroupClick(group)}
            sx={{
              backgroundColor: group.color
                ? group.color
                : (theme) =>
                    group.collection_type === 'auto'
                      ? theme.palette.mode === 'dark'
                        ? 'rgba(33, 150, 243, 0.2)'
                        : 'rgba(33, 150, 243, 0.15)'
                      : theme.palette.mode === 'dark'
                        ? 'rgba(156, 39, 176, 0.2)'
                        : 'rgba(156, 39, 176, 0.15)',
              color: group.color
                ? '#fff'
                : (theme) =>
                    group.collection_type === 'auto'
                      ? theme.palette.mode === 'dark'
                        ? '#64b5f6'
                        : '#1976d2'
                      : theme.palette.mode === 'dark'
                        ? '#ba68c8'
                        : '#7b1fa2',
              fontSize: '0.7rem',
              fontWeight: 500,
              border: (theme) =>
                group.color
                  ? 'none'
                  : group.collection_type === 'auto'
                    ? theme.palette.mode === 'dark'
                      ? '1px solid rgba(33, 150, 243, 0.4)'
                      : '1px solid rgba(33, 150, 243, 0.3)'
                    : theme.palette.mode === 'dark'
                      ? '1px solid rgba(156, 39, 176, 0.4)'
                      : '1px solid rgba(156, 39, 176, 0.3)',
              cursor: 'pointer',
              transition: 'all 0.2s ease-in-out',
              '&:hover': {
                backgroundColor: group.color
                  ? group.color
                  : (theme) =>
                      group.collection_type === 'auto'
                        ? theme.palette.mode === 'dark'
                          ? 'rgba(33, 150, 243, 0.3)'
                          : 'rgba(33, 150, 243, 0.25)'
                        : theme.palette.mode === 'dark'
                          ? 'rgba(156, 39, 176, 0.3)'
                          : 'rgba(156, 39, 176, 0.25)',
                transform: 'translateY(-1px)',
                boxShadow: (theme) =>
                  theme.palette.mode === 'dark'
                    ? '0 2px 8px rgba(0, 0, 0, 0.4)'
                    : '0 2px 8px rgba(0, 0, 0, 0.15)',
              },
            }}
          />
        ))}
      </Box>
    </Box>
  );
};
