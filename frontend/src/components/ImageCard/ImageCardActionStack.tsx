import React from 'react';
import {
    Box,
    Tooltip,
    IconButton,
} from '@mui/material';
import {
    Download as DownloadIcon,
    Delete as DeleteIcon,
    AutoAwesome as AutoAwesomeIcon,
    CheckCircle as CheckCircleIcon,
    Block as BlockIcon,
    ThumbUp as ThumbUpIcon,
    ThumbDown as ThumbDownIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import type { ImageRecord } from '../../types/image';

interface ImageCardActionStackProps {
    image: ImageRecord;
    isHovered: boolean;
    selected: boolean;
    isSmall: boolean;
    onDownload: (e: React.MouseEvent) => void;
    onDelete?: (e: React.MouseEvent) => void;
    onCopy: (text: string, label: string) => (e: React.MouseEvent) => void;
}

const ImageCardActionStack: React.FC<ImageCardActionStackProps> = ({
    image,
    isHovered,
    selected,
    isSmall,
    onDownload,
    onDelete,
    onCopy,
}) => {
    const { t } = useTranslation(['common']);

    if (isSmall || (!isHovered && !selected)) {
        return null;
    }

    return (
        <Box
            className="image-card-actions"
            sx={{
                position: 'absolute',
                top: 8,
                right: 8,
                zIndex: 2,
                display: 'flex',
                flexDirection: 'column',
                gap: 0.5,
                alignItems: 'center',
            }}
        >
            {/* Download */}
            <Tooltip title={t('common:imageCard.tooltips.download')} placement="left">
                <IconButton
                    size="small"
                    onClick={onDownload}
                    sx={{
                        bgcolor: (theme) => theme.palette.mode === 'dark'
                            ? 'rgba(0, 0, 0, 0.6)'
                            : 'rgba(255, 255, 255, 0.8)',
                        borderRadius: 1,
                        '&:hover': {
                            bgcolor: (theme) => theme.palette.mode === 'dark'
                                ? 'rgba(0, 0, 0, 0.8)'
                                : 'rgba(255, 255, 255, 0.9)',
                        },
                    }}
                >
                    <DownloadIcon fontSize="small" />
                </IconButton>
            </Tooltip>

            {/* Delete */}
            {onDelete && (
                <Tooltip title={t('common:imageCard.tooltips.delete')} placement="left">
                    <IconButton
                        size="small"
                        onClick={onDelete}
                        sx={{
                            bgcolor: (theme) => theme.palette.mode === 'dark'
                                ? 'rgba(0, 0, 0, 0.6)'
                                : 'rgba(255, 255, 255, 0.8)',
                            borderRadius: 1,
                            '&:hover': {
                                bgcolor: (theme) => theme.palette.mode === 'dark'
                                    ? 'rgba(0, 0, 0, 0.8)'
                                    : 'rgba(255, 255, 255, 0.9)',
                            },
                        }}
                    >
                        <DeleteIcon fontSize="small" />
                    </IconButton>
                </Tooltip>
            )}

            {/* Positive Prompt */}
            {image.prompt && (
                <Tooltip
                    title={
                        <Box sx={{ maxHeight: '200px', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 10, WebkitBoxOrient: 'vertical' }}>
                            {image.prompt}
                        </Box>
                    }
                    placement="left"
                >
                    <IconButton
                        size="small"
                        onClick={onCopy(image.prompt, 'Positive prompt')}
                        sx={{
                            bgcolor: (theme) => theme.palette.mode === 'dark'
                                ? 'rgba(0, 0, 0, 0.6)'
                                : 'rgba(255, 255, 255, 0.8)',
                            borderRadius: 1,
                            '&:hover': {
                                bgcolor: (theme) => theme.palette.mode === 'dark'
                                    ? 'rgba(0, 0, 0, 0.8)'
                                    : 'rgba(255, 255, 255, 0.9)',
                            },
                        }}
                    >
                        <CheckCircleIcon fontSize="small" color="primary" />
                    </IconButton>
                </Tooltip>
            )}

            {/* Negative Prompt */}
            {image.negative_prompt && (
                <Tooltip
                    title={
                        <Box sx={{ maxHeight: '200px', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 10, WebkitBoxOrient: 'vertical' }}>
                            {image.negative_prompt}
                        </Box>
                    }
                    placement="left"
                >
                    <IconButton
                        size="small"
                        onClick={onCopy(image.negative_prompt, 'Negative prompt')}
                        sx={{
                            bgcolor: (theme) => theme.palette.mode === 'dark'
                                ? 'rgba(0, 0, 0, 0.6)'
                                : 'rgba(255, 255, 255, 0.8)',
                            borderRadius: 1,
                            '&:hover': {
                                bgcolor: (theme) => theme.palette.mode === 'dark'
                                    ? 'rgba(0, 0, 0, 0.8)'
                                    : 'rgba(255, 255, 255, 0.9)',
                            },
                        }}
                    >
                        <BlockIcon fontSize="small" color="error" />
                    </IconButton>
                </Tooltip>
            )}

            {/* Auto Tags */}
            {image.auto_tags && image.auto_tags.taglist && (
                <Tooltip
                    title={
                        <Box sx={{ maxHeight: '200px', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 10, WebkitBoxOrient: 'vertical' }}>
                            {image.auto_tags.taglist}
                        </Box>
                    }
                    placement="left"
                >
                    <IconButton
                        size="small"
                        onClick={onCopy(image.auto_tags.taglist, 'Auto tags')}
                        sx={{
                            bgcolor: (theme) => theme.palette.mode === 'dark'
                                ? 'rgba(0, 0, 0, 0.6)'
                                : 'rgba(255, 255, 255, 0.8)',
                            borderRadius: 1,
                            '&:hover': {
                                bgcolor: (theme) => theme.palette.mode === 'dark'
                                    ? 'rgba(0, 0, 0, 0.8)'
                                    : 'rgba(255, 255, 255, 0.9)',
                            },
                        }}
                    >
                        <AutoAwesomeIcon fontSize="small" sx={{ color: '#9c27b0' }} />
                    </IconButton>
                </Tooltip>
            )}
        </Box>
    );
};

export default ImageCardActionStack;
