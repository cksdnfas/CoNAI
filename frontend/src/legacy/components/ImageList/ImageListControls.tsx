import React, { useState, useRef } from 'react';
import {
    Box,
    Fab,
    Stack,
    Slider,
    Typography,
    ToggleButton,
    ToggleButtonGroup,
    Tooltip,
    Fade,
    Switch,
    Paper,
    Zoom,
    ClickAwayListener,
    useTheme,
    alpha,
    IconButton,
} from '@mui/material';
import {
    Settings as SettingsIcon,
    Search as SearchIcon,
    GridView as GridIcon,
    ViewModule as MasonryIcon,
    Close as CloseIcon,
    Tune as TuneIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import type { ImageListSettings, ViewMode } from '../../hooks/useImageListSettings';

interface ImageListControlsProps {
    settings: ImageListSettings;
    onViewModeChange: (mode: ViewMode) => void;
    onColumnsChange: (columns: number) => void;
    onFitToScreenChange?: (fit: boolean) => void;
    onScrollModeChange?: (mode: 'infinite' | 'pagination') => void;
    onPageSizeChange?: (size: number) => void;
    onSearchClick?: () => void;
    visible?: boolean;
}

const ImageListControls: React.FC<ImageListControlsProps> = ({
    settings,
    onViewModeChange,
    onColumnsChange,
    onFitToScreenChange,
    onScrollModeChange,
    onPageSizeChange,
    onSearchClick,
    visible = true,
}) => {
    const { t } = useTranslation(['common']);
    const theme = useTheme();
    const [isOpen, setIsOpen] = useState(false);

    // Toggle internal state
    const handleToggle = () => {
        setIsOpen((prev) => !prev);
    };

    const handleClose = () => {
        setIsOpen(false);
    };

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
        <Box
            sx={{
                position: 'fixed',
                bottom: { xs: 16, sm: 32 },
                right: { xs: 16, sm: 32 },
                zIndex: 1000,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'end',
                pointerEvents: 'none', // Allow clicks to pass through wrapper
                maxWidth: '100vw', // Ensure container doesn't overflow
            }}
        >
            <ClickAwayListener onClickAway={handleClose}>
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'end', pointerEvents: 'auto', maxWidth: '100%' }}>

                    {/* Control Panel */}
                    <Box sx={{ position: 'relative', mb: 2, maxWidth: 'calc(100vw - 32px)' }}>
                        <Zoom in={isOpen} unmountOnExit>
                            <Paper
                                elevation={4}
                                sx={{
                                    width: 320,
                                    maxWidth: '100%',
                                    p: 3,
                                    borderRadius: 4,
                                    backdropFilter: 'blur(12px)',
                                    backgroundColor: alpha(theme.palette.background.paper, 0.85),
                                    border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
                                    overflow: 'hidden',
                                }}
                            >
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                                    <Typography variant="h6" fontWeight="bold" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <TuneIcon fontSize="small" color="primary" />
                                        {t('common:viewSettings')}
                                    </Typography>
                                    <IconButton size="small" onClick={handleClose} sx={{ color: 'text.secondary' }}>
                                        <CloseIcon fontSize="small" />
                                    </IconButton>
                                </Box>

                                <Stack spacing={3}>
                                    {/* View Mode */}
                                    <Box>
                                        <Typography variant="caption" color="text.secondary" fontWeight="bold" sx={{ mb: 1, display: 'block' }}>
                                            {t('common:layout')}
                                        </Typography>
                                        <ToggleButtonGroup
                                            value={settings.viewMode}
                                            exclusive
                                            onChange={handleViewModeChange}
                                            fullWidth
                                            size="medium"
                                            color="primary"
                                            sx={{
                                                backgroundColor: alpha(theme.palette.action.hover, 0.05),
                                                p: 0.5,
                                                borderRadius: 2,
                                                '& .MuiToggleButton-root': {
                                                    border: 'none',
                                                    borderRadius: 1.5,
                                                    textTransform: 'none',
                                                    fontWeight: 600,
                                                    color: 'text.secondary',
                                                    '&.Mui-selected': {
                                                        backgroundColor: theme.palette.background.paper,
                                                        color: theme.palette.primary.main,
                                                        boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
                                                        '&:hover': {
                                                            backgroundColor: theme.palette.background.paper,
                                                        }
                                                    }
                                                }
                                            }}
                                        >
                                            <ToggleButton value="masonry">
                                                <MasonryIcon sx={{ mr: 1, fontSize: 20 }} />
                                                {t('common:masonry')}
                                            </ToggleButton>
                                            <ToggleButton value="grid">
                                                <GridIcon sx={{ mr: 1, fontSize: 20 }} />
                                                {t('common:grid')}
                                            </ToggleButton>
                                        </ToggleButtonGroup>
                                    </Box>

                                    {/* Columns */}
                                    <Box>
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1, alignItems: 'center' }}>
                                            <Typography variant="caption" color="text.secondary" fontWeight="bold">
                                                {t('common:columns')}
                                            </Typography>
                                            <Box
                                                sx={{
                                                    bgcolor: alpha(theme.palette.primary.main, 0.1),
                                                    color: 'primary.main',
                                                    px: 1,
                                                    py: 0.25,
                                                    borderRadius: 1,
                                                    typography: 'caption',
                                                    fontWeight: 'bold'
                                                }}
                                            >
                                                {settings.gridColumns}
                                            </Box>
                                        </Box>

                                        <Slider
                                            value={settings.gridColumns}
                                            min={1}
                                            max={12}
                                            step={1}
                                            onChange={handleColumnsChange}
                                            valueLabelDisplay="off"
                                            marks
                                            sx={{
                                                '& .MuiSlider-thumb': {
                                                    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                                                },
                                            }}
                                        />
                                    </Box>

                                    {/* Fit to Screen (Single Column Only) */}
                                    {settings.gridColumns === 1 && onFitToScreenChange && (
                                        <Fade in={settings.gridColumns === 1}>
                                            <Box
                                                sx={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'space-between',
                                                    p: 1.5,
                                                    borderRadius: 2,
                                                    bgcolor: alpha(theme.palette.action.hover, 0.05)
                                                }}
                                            >
                                                <Typography variant="body2" fontWeight="medium">
                                                    {t('common:fitToScreen')}
                                                </Typography>
                                                <Switch
                                                    size="small"
                                                    checked={settings.fitToScreen || false}
                                                    onChange={(_, checked) => onFitToScreenChange?.(checked)}
                                                />
                                            </Box>
                                        </Fade>
                                    )}

                                    {/* Scroll Mode */}
                                    {onScrollModeChange && (
                                        <Box>
                                            <Typography variant="caption" color="text.secondary" fontWeight="bold" sx={{ mb: 1, display: 'block' }}>
                                                {t('common:scrollMode', 'Scroll Mode')}
                                            </Typography>
                                            <ToggleButtonGroup
                                                value={settings.activeScrollMode}
                                                exclusive
                                                onChange={(_, newMode) => newMode && onScrollModeChange(newMode)}
                                                fullWidth
                                                size="small"
                                                color="primary"
                                                sx={{
                                                    backgroundColor: alpha(theme.palette.action.hover, 0.05),
                                                    p: 0.5,
                                                    borderRadius: 2,
                                                    '& .MuiToggleButton-root': {
                                                        border: 'none',
                                                        borderRadius: 1.5,
                                                        textTransform: 'none',
                                                        fontWeight: 600,
                                                        color: 'text.secondary',
                                                        '&.Mui-selected': {
                                                            backgroundColor: theme.palette.background.paper,
                                                            color: theme.palette.primary.main,
                                                            boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
                                                            '&:hover': {
                                                                backgroundColor: theme.palette.background.paper,
                                                            }
                                                        }
                                                    }
                                                }}
                                            >
                                                <ToggleButton value="infinite">
                                                    {t('common:infinite', 'Infinite')}
                                                </ToggleButton>
                                                <ToggleButton value="pagination">
                                                    {t('common:paginationMode', 'Pagination')}
                                                </ToggleButton>
                                            </ToggleButtonGroup>
                                        </Box>
                                    )}

                                    {/* Page Size (Only for Pagination) */}
                                    {settings.activeScrollMode === 'pagination' && onPageSizeChange && (
                                        <Fade in={settings.activeScrollMode === 'pagination'}>
                                            <Box>
                                                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1, alignItems: 'center' }}>
                                                    <Typography variant="caption" color="text.secondary" fontWeight="bold">
                                                        {t('common:pageSize', 'Page Size')}
                                                    </Typography>
                                                    <Box
                                                        sx={{
                                                            bgcolor: alpha(theme.palette.primary.main, 0.1),
                                                            color: 'primary.main',
                                                            px: 1,
                                                            py: 0.25,
                                                            borderRadius: 1,
                                                            typography: 'caption',
                                                            fontWeight: 'bold'
                                                        }}
                                                    >
                                                        {settings.pageSize}
                                                    </Box>
                                                </Box>
                                                <Slider
                                                    value={settings.pageSize}
                                                    min={10}
                                                    max={100}
                                                    step={10}
                                                    onChange={(_, newValue) => onPageSizeChange(newValue as number)}
                                                    valueLabelDisplay="auto"
                                                    marks={[
                                                        { value: 25, label: '25' },
                                                        { value: 50, label: '50' },
                                                        { value: 100, label: '100' },
                                                    ]}
                                                    sx={{
                                                        '& .MuiSlider-thumb': {
                                                            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                                                        },
                                                    }}
                                                />
                                            </Box>
                                        </Fade>
                                    )}
                                </Stack>
                            </Paper>
                        </Zoom>
                    </Box>

                    {/* Action Buttons */}
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {visible && (
                            <>
                                {/* Search FAB */}
                                {onSearchClick && (
                                    <Zoom in={visible} style={{ transitionDelay: visible ? '100ms' : '0ms' }}>
                                        <Tooltip title={t('common:search')} placement="left" arrow>
                                            <Fab
                                                color="primary"
                                                aria-label="search"
                                                onClick={onSearchClick}
                                                size="medium"
                                                sx={{
                                                    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                                                    '&:hover': { transform: 'scale(1.05)' },
                                                    transition: 'transform 0.2s',
                                                }}
                                            >
                                                <SearchIcon />
                                            </Fab>
                                        </Tooltip>
                                    </Zoom>
                                )}

                                {/* Settings FAB */}
                                <Zoom in={visible}>
                                    <Tooltip title={t('common:settings')} placement="left" arrow>
                                        <Fab
                                            color={isOpen ? 'default' : 'secondary'}
                                            aria-label="settings"
                                            onClick={handleToggle}
                                            size="medium"
                                            sx={{
                                                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                                                transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                                                transition: 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), background-color 0.3s',
                                                zIndex: 1001,
                                            }}
                                        >
                                            {isOpen ? <CloseIcon /> : <SettingsIcon />}
                                        </Fab>
                                    </Tooltip>
                                </Zoom>
                            </>
                        )}
                    </Box>
                </Box>
            </ClickAwayListener>
        </Box>
    );
};

export default ImageListControls;
