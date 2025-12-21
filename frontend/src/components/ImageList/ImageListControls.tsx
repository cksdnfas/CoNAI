import React, { useState } from 'react';
import {
    Box,
    Fab,
    Popover,
    Stack,
    Slider,
    Typography,
    ToggleButton,
    ToggleButtonGroup,
    Tooltip,
    Fade,
    Switch,
} from '@mui/material';
import {
    Settings as SettingsIcon,
    Search as SearchIcon,
    GridView as GridIcon,
    ViewModule as MasonryIcon,
    Close as CloseIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import type { ImageListSettings, ViewMode } from '../../hooks/useImageListSettings';

interface ImageListControlsProps {
    settings: ImageListSettings;
    onViewModeChange: (mode: ViewMode) => void;
    onColumnsChange: (columns: number) => void;
    onFitToScreenChange?: (fit: boolean) => void;
    onSearchClick?: () => void;
    visible?: boolean;
}

const ImageListControls: React.FC<ImageListControlsProps> = ({
    settings,
    onViewModeChange,
    onColumnsChange,
    onFitToScreenChange,
    onSearchClick,
    visible = true,
}) => {
    const { t } = useTranslation(['common']);
    const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);

    const handleSettingsClick = (event: React.MouseEvent<HTMLButtonElement>) => {
        setAnchorEl(event.currentTarget);
    };

    const handleClose = () => {
        setAnchorEl(null);
    };

    const open = Boolean(anchorEl);

    // Settings Handlers
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
        <Fade in={visible}>
            <Box
                sx={{
                    position: 'fixed',
                    bottom: 32,
                    right: 32,
                    zIndex: 1000,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                    alignItems: 'center',
                }}
            >
                {/* Search FAB */}
                {onSearchClick && (
                    <Tooltip title={t('common:search')} placement="left">
                        <Fab
                            color="primary"
                            aria-label="search"
                            onClick={onSearchClick}
                            size="medium"
                        >
                            <SearchIcon />
                        </Fab>
                    </Tooltip>
                )}

                {/* Settings FAB */}
                <Tooltip title={t('common:settings')} placement="left">
                    <Fab
                        color="secondary"
                        aria-label="settings"
                        onClick={handleSettingsClick}
                        size="medium"
                    >
                        {open ? <CloseIcon /> : <SettingsIcon />}
                    </Fab>
                </Tooltip>

                {/* Settings Popover */}
                <Popover
                    open={open}
                    anchorEl={anchorEl}
                    onClose={handleClose}
                    anchorOrigin={{
                        vertical: 'top',
                        horizontal: 'left',
                    }}
                    transformOrigin={{
                        vertical: 'bottom',
                        horizontal: 'right',
                    }}
                    slotProps={{
                        paper: {
                            sx: {
                                p: 2,
                                width: 300,
                                mb: 1, // Add some margin from the FAB
                                borderRadius: 4,
                            }
                        }
                    }}
                >
                    <Stack spacing={3}>
                        <Typography variant="subtitle1" fontWeight="bold">
                            {t('common:viewSettings')}
                        </Typography>

                        {/* View Mode */}
                        <Box>
                            <Typography variant="caption" color="text.secondary" gutterBottom>
                                {t('common:layout')}
                            </Typography>
                            <ToggleButtonGroup
                                value={settings.viewMode}
                                exclusive
                                onChange={handleViewModeChange}
                                fullWidth
                                size="small"
                                color="primary"
                            >
                                <ToggleButton value="masonry">
                                    <MasonryIcon sx={{ mr: 1 }} />
                                    {t('common:masonry')}
                                </ToggleButton>
                                <ToggleButton value="grid">
                                    <GridIcon sx={{ mr: 1 }} />
                                    {t('common:grid')}
                                </ToggleButton>
                            </ToggleButtonGroup>
                        </Box>

                        {/* Columns */}
                        <Box>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                                <Typography variant="caption" color="text.secondary">
                                    {t('common:columns')}
                                </Typography>
                                <Typography variant="caption" fontWeight="bold">
                                    {settings.gridColumns}
                                </Typography>
                            </Box>

                            {/* Fit to Screen (Single Column Only) */}
                            {settings.gridColumns === 1 && onFitToScreenChange && (
                                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                                    <Typography variant="caption" color="text.secondary">
                                        {t('common:fitToScreen')}
                                    </Typography>
                                    <Switch
                                        size="small"
                                        checked={settings.fitToScreen || false}
                                        onChange={(_, checked) => onFitToScreenChange(checked)}
                                    />
                                </Box>
                            )}

                            <Slider
                                value={settings.gridColumns}
                                min={1}
                                max={12}
                                step={1}
                                onChange={handleColumnsChange}
                                valueLabelDisplay="auto"
                                marks
                            />
                        </Box>
                    </Stack>
                </Popover>
            </Box>
        </Fade>
    );
};

export default ImageListControls;
