import React, { useState, useMemo, useCallback } from 'react';
import {
    Box,
    Grid, // using MUI v6 Grid (Grid2)
    Pagination,
    Typography,
} from '@mui/material';
import Masonry from 'react-masonry-css';
import InfiniteScroll from 'react-infinite-scroll-component';
import { useTranslation } from 'react-i18next';
import type { ImageRecord } from '../../types/image';
import { useImageListSettings } from '../../hooks/useImageListSettings';
import ImageListToolbar from './ImageListToolbar';
import MasonryImageCard from '../ImageMasonry/MasonryImageCard';
import ImageCard from '../ImageCard/ImageCard';
import ImageViewerModal from '../ImageViewerModal';
import { ImageEditorModal } from '../ImageEditorModal';

import '../ImageMasonry/ImageMasonry.css';

export interface ImageListProps {
    images: ImageRecord[];
    loading: boolean;
    contextId: string;

    // Pagination / Scroll
    mode?: 'infinite' | 'pagination';
    pagination?: {
        currentPage: number;
        totalPages: number;
        onPageChange: (page: number) => void;
        pageSize: number;
        onPageSizeChange: (size: number) => void;
    };
    infiniteScroll?: {
        hasMore: boolean;
        loadMore: () => void;
    };

    // Selection
    selectable?: boolean;
    selection?: {
        selectedIds: number[];
        onSelectionChange: (ids: number[]) => void;
    };

    // Actions
    onImageDelete?: (compositeHash: string) => void;

    // Extra Context for Cards
    showCollectionType?: boolean;
    currentGroupId?: number;
    total?: number;
}

const ImageList: React.FC<ImageListProps> = ({
    images,
    loading,
    contextId,
    mode: propMode,
    pagination,
    infiniteScroll,
    selectable = false,
    selection,
    onImageDelete,
    showCollectionType,
    currentGroupId,
    total,
}) => {
    const { t } = useTranslation(['common', 'gallery']);
    const {
        settings,
        setViewMode,
        setGridColumns,
    } = useImageListSettings(contextId);

    const activeMode = propMode || settings.activeScrollMode;

    const [viewerOpen, setViewerOpen] = useState(false);
    const [currentImageIndex, setCurrentImageIndex] = useState(0);

    // Editor state
    const [editorOpen, setEditorOpen] = useState(false);
    const [editorImageId, setEditorImageId] = useState<number | null>(null);

    // Selection Logic
    const selectedIds = selection?.selectedIds || [];
    const onSelectionChange = selection?.onSelectionChange;
    const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
    const [lastClickedIndex, setLastClickedIndex] = useState<number>(-1);

    const handleImageClick = useCallback((index: number) => {
        setCurrentImageIndex(index);
        setViewerOpen(true);
    }, []);

    const handleSelectionWrapper = useCallback((id: number, event?: React.MouseEvent) => {
        if (!onSelectionChange) return;

        const imageIndex = images.findIndex(img => img.id === id);

        // Ctrl/Cmd + Click: Toggle
        if (event && (event.ctrlKey || event.metaKey)) {
            const newSelectedIds = selectedSet.has(id)
                ? selectedIds.filter(sid => sid !== id)
                : [...selectedIds, id];
            onSelectionChange(newSelectedIds);
            setLastClickedIndex(imageIndex);
            return;
        }

        // Shift + Click: Range
        if (event && event.shiftKey && lastClickedIndex >= 0) {
            const start = Math.min(lastClickedIndex, imageIndex);
            const end = Math.max(lastClickedIndex, imageIndex);
            const rangeIds = images.slice(start, end + 1)
                .map(img => img.id)
                .filter((id): id is number => id !== undefined && id !== null);

            const newSelectedIds = Array.from(new Set([...selectedIds, ...rangeIds]));
            onSelectionChange(newSelectedIds);
            return;
        }

        // Normal Click: Toggle
        const newSelectedIds = selectedSet.has(id)
            ? selectedIds.filter(sid => sid !== id)
            : [...selectedIds, id];
        onSelectionChange(newSelectedIds);
        setLastClickedIndex(imageIndex);
    }, [images, selectedIds, selectedSet, onSelectionChange, lastClickedIndex]);

    // View Mode Renderers
    const breakpointColumns = {
        default: settings.gridColumns,
        1536: Math.max(2, settings.gridColumns - 1),
        1200: Math.max(2, settings.gridColumns - 2),
        900: Math.max(2, settings.gridColumns - 3),
        600: Math.max(2, settings.gridColumns - 4),
    };

    const renderMasonry = () => (
        <Masonry
            breakpointCols={breakpointColumns}
            className="my-masonry-grid"
            columnClassName="my-masonry-grid_column"
        >
            {images.map((image, index) => (
                <MasonryImageCard
                    key={image.id ? `id-${image.id}` : `hash-${image.composite_hash}-${index}`}
                    image={image}
                    onClick={() => handleImageClick(index)}
                    selected={image.id ? selectedSet.has(image.id) : false}
                    selectable={selectable}
                    onSelectionChange={handleSelectionWrapper}
                />
            ))}
        </Masonry>
    );

    const renderGrid = () => (
        <Grid container spacing={2}>
            {images.map((image, index) => {
                // Calculate Grid Size based on columns
                // MUI Grid is 12 columns total.
                const xl = Math.max(1, Math.floor(12 / settings.gridColumns));
                const lg = Math.max(1, Math.floor(12 / Math.max(2, settings.gridColumns - 1)));
                const md = Math.max(1, Math.floor(12 / Math.max(2, settings.gridColumns - 2)));
                const sm = Math.max(1, Math.floor(12 / Math.max(2, settings.gridColumns - 3)));
                const xs = 6;

                return (
                    <Grid
                        size={{ xs, sm, md, lg, xl }}
                        key={image.id ? `id-${image.id}` : `hash-${image.composite_hash}-${index}`}
                    >
                        <ImageCard
                            image={image}
                            selected={image.id ? selectedSet.has(image.id) : false}
                            selectable={selectable}
                            onSelectionChange={handleSelectionWrapper}
                            onDelete={onImageDelete}
                            onImageClick={() => handleImageClick(index)}
                            showCollectionType={showCollectionType}
                            currentGroupId={currentGroupId}
                        />
                    </Grid>
                );
            })}
        </Grid>
    );

    const renderContent = () => {
        if (loading && images.length === 0) {
            return (
                <Box sx={{ width: '100%' }}>
                    <Typography>{t('common:loading')}</Typography>
                </Box>
            );
        }

        if (images.length === 0) {
            return (
                <Box sx={{ textAlign: 'center', py: 8 }}>
                    <Typography variant="h6" color="text.secondary">
                        {t('gallery:status.noImages')}
                    </Typography>
                </Box>
            );
        }

        if (settings.viewMode === 'masonry') {
            return renderMasonry();
        } else {
            return renderGrid();
        }
    };

    return (
        <Box sx={{ width: '100%', position: 'relative' }}>
            <ImageListToolbar
                settings={settings}
                onViewModeChange={setViewMode}
                onColumnsChange={setGridColumns}
                totalImages={total}
            />

            {activeMode === 'infinite' && infiniteScroll ? (
                <InfiniteScroll
                    dataLength={images.length}
                    next={infiniteScroll.loadMore}
                    hasMore={infiniteScroll.hasMore}
                    loader={<Typography align="center" py={2}>{t('common:loading')}</Typography>}
                    endMessage={
                        images.length > 0 && (
                            <Typography align="center" py={4} color="text.secondary">
                                {t('gallery:allImagesLoaded')}
                            </Typography>
                        )
                    }
                    style={{ overflow: 'visible' }}
                >
                    {renderContent()}
                </InfiniteScroll>
            ) : (
                <>
                    {renderContent()}
                    {pagination && pagination.totalPages > 1 && (
                        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
                            <Pagination
                                count={pagination.totalPages}
                                page={pagination.currentPage}
                                onChange={(_, p) => pagination.onPageChange(p)}
                                color="primary"
                                size="large"
                                showFirstButton
                                showLastButton
                            />
                        </Box>
                    )}
                </>
            )}

            {/* Modals */}
            <ImageViewerModal
                open={viewerOpen}
                onClose={() => setViewerOpen(false)}
                image={images[currentImageIndex] || null}
                images={images}
                currentIndex={currentImageIndex}
                onImageChange={setCurrentImageIndex}
                onImageDeleted={onImageDelete}
                // Pass partial context if needed
                groupId={currentGroupId}
                onOpenEditor={(id) => {
                    setEditorImageId(id);
                    setEditorOpen(true);
                }}
            />

            {editorImageId && (
                <ImageEditorModal
                    open={editorOpen}
                    onClose={() => {
                        setEditorOpen(false);
                        setEditorImageId(null);
                    }}
                    imageId={editorImageId}
                    onSaved={() => {
                        setEditorOpen(false);
                        setEditorImageId(null);
                    }}
                />
            )}
        </Box>
    );
};

export default ImageList;
