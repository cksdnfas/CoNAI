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
 * Group information section with clickable chips
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
              backgroundColor: group.color || (group.collection_type === 'auto' ? '#e3f2fd' : '#f3e5f5'),
              color: group.color ? '#fff' : (group.collection_type === 'auto' ? '#1976d2' : '#7b1fa2'),
              fontSize: '0.7rem',
              cursor: 'pointer',
              '&:hover': {
                opacity: 0.8,
              },
            }}
          />
        ))}
      </Box>
    </Box>
  );
};
