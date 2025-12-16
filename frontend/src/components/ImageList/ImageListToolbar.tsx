import React from 'react';
import {
    Box,
    ToggleButton,
    ToggleButtonGroup,
    Stack,
    Typography,
    Slider,
    Tooltip,
    IconButton,
} from '@mui/material';
import {
    GridView as GridIcon,
    ViewModule as MasonryIcon,
    ViewStream as ListIcon, // Placeholder for valid list icon if needed
    FormatListBulleted as ListModeIcon, // Alternative
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import type { ImageListSettings, ViewMode } from '../../hooks/useImageListSettings';

interface ImageListToolbarProps {
    settings: ImageListSettings;
    onViewModeChange: (mode: ViewMode) => void;
    onColumnsChange: (columns: number) => void;
    totalImages?: number;
}

const ImageListToolbar: React.FC<ImageListToolbarProps> = ({
    settings,
    onViewModeChange,
    onColumnsChange,
    totalImages,
}) => {
    const { t } = useTranslation(['common']);

    const handleViewModeChange = (
        event: React.MouseEvent<HTMLElement>,
        newMode: ViewMode | null,
    ) => {
        if (newMode !== null) {
            onViewModeChange(newMode);
        }
    };

    const handleColumnsChange = (event: Event, newValue: number | number[]) => {
        onColumnsChange(newValue as number);
    };

    return (
        <Box
            sx={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                mb: 2,
                p: 1,
                borderRadius: 1,
                bgcolor: 'background.paper',
                border: 1,
                borderColor: 'divider',
            }}
        >
            <Stack direction="row" spacing={2} alignItems="center">
                <Typography variant="body2" color="text.secondary">
                    {totalImages !== undefined ? t('common:totalImages', { count: totalImages }) : ''}
                </Typography>
            </Stack>

            <Stack direction="row" spacing={3} alignItems="center">
                {/* Column Slider */}
                <Box sx={{ width: 150, display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="caption" color="text.secondary">
                        Cols
                    </Typography>
                    <Slider
                        value={settings.gridColumns}
                        min={2}
                        max={12}
                        step={1}
                        onChange={handleColumnsChange}
                        size="small"
                        valueLabelDisplay="auto"
                    />
                </Box>

                {/* View Mode Toggle */}
                <ToggleButtonGroup
                    value={settings.viewMode}
                    exclusive
                    onChange={handleViewModeChange}
                    size="small"
                    aria-label="view mode"
                >
                    <ToggleButton value="masonry" aria-label="masonry view">
                        <Tooltip title="Masonry">
                            <MasonryIcon fontSize="small" />
                        </Tooltip>
                    </ToggleButton>
                    <ToggleButton value="grid" aria-label="grid view">
                        <Tooltip title="Grid">
                            <GridIcon fontSize="small" />
                        </Tooltip>
                    </ToggleButton>
                </ToggleButtonGroup>
            </Stack>
        </Box>
    );
};

export default ImageListToolbar;
