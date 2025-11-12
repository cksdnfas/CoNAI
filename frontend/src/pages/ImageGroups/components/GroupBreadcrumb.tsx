import React from 'react';
import { Breadcrumbs, Link, Typography, Box } from '@mui/material';
import { NavigateNext, Home } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import type { BreadcrumbItem } from '@comfyui-image-manager/shared';

interface GroupBreadcrumbProps {
  breadcrumb: BreadcrumbItem[];
  currentGroupName?: string;
  onNavigate: (groupId: number | null) => void;
}

/**
 * Breadcrumb navigation component for group hierarchy
 * Shows path from root to current group (Windows Explorer style)
 */
export const GroupBreadcrumb: React.FC<GroupBreadcrumbProps> = ({
  breadcrumb,
  currentGroupName,
  onNavigate,
}) => {
  const { t } = useTranslation();

  return (
    <Box sx={{ mb: 2, p: 1, bgcolor: 'background.paper', borderRadius: 1 }}>
      <Breadcrumbs
        separator={<NavigateNext fontSize="small" />}
        aria-label="group navigation"
      >
        {/* Root level */}
        <Link
          component="button"
          variant="body1"
          onClick={() => onNavigate(null)}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            textDecoration: 'none',
            color: 'primary.main',
            '&:hover': {
              textDecoration: 'underline',
              cursor: 'pointer',
            },
          }}
        >
          <Home fontSize="small" />
          {t('imageGroups.hierarchy.root')}
        </Link>

        {/* Ancestor groups */}
        {breadcrumb.map((item) => (
          <Link
            key={item.id}
            component="button"
            variant="body1"
            onClick={() => onNavigate(item.id)}
            sx={{
              textDecoration: 'none',
              color: 'primary.main',
              '&:hover': {
                textDecoration: 'underline',
                cursor: 'pointer',
              },
            }}
          >
            {item.name}
          </Link>
        ))}

        {/* Current group (not clickable) */}
        {currentGroupName && (
          <Typography variant="body1" color="text.primary" fontWeight="medium">
            {currentGroupName}
          </Typography>
        )}
      </Breadcrumbs>
    </Box>
  );
};
