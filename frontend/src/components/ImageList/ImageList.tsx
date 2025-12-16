import React, { useState, useMemo, useCallback } from 'react';
import {
    Box,
    Pagination,
    Typography,
} from '@mui/material';
import Masonry from 'react-masonry-css';
import InfiniteScroll from 'react-infinite-scroll-component';
import { useTranslation } from 'react-i18next';
import type { ImageRecord } from '../../types/image';
import { useImageListSettings } from '../../hooks/useImageListSettings';
import ImageListControls from './ImageListControls';
import MasonryImageCard from './components/MasonryImageCard';
import ImageCard from '../ImageCard/ImageCard';
import ImageViewerModal from '../ImageViewerModal';
import { ImageEditorModal } from '../ImageEditorModal';

import './components/MasonryImageCard.css';

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

    // Control Props
    onSearchClick?: () => void;
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
    onSearchClick,
}) => {
    const { t } = useTranslation(['common', 'gallery']);
    const {
        settings,
        setViewMode,
        setGridColumns,
        setFitToScreen,
    } = useImageListSettings(contextId);

    // isMinimal is now handled internally by components using useCardWidth
    // const isMinimal = settings.gridColumns >= 8;

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
        1536: settings.gridColumns,
        1200: Math.min(settings.gridColumns, 10),
        900: Math.min(settings.gridColumns, 6),
        600: Math.min(settings.gridColumns, 3),
        0: Math.min(settings.gridColumns, 2),
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
                    // minimal={isMinimal} // Handled internally
                    fitScreen={settings.fitToScreen && settings.gridColumns === 1}
                />
            ))}
        </Masonry>
    );

    const renderGrid = () => (
        <Box
            sx={{
                display: 'grid',
                gap: 2,
                gridTemplateColumns: {
                    xs: `repeat(${Math.min(settings.gridColumns, 2)}, 1fr)`,
                    sm: `repeat(${Math.min(settings.gridColumns, 3)}, 1fr)`,
                    md: `repeat(${Math.min(settings.gridColumns, 6)}, 1fr)`,
                    lg: `repeat(${Math.min(settings.gridColumns, 10)}, 1fr)`,
                    xl: `repeat(${settings.gridColumns}, 1fr)`,
                }
            }}
        >
            {images.map((image, index) => (
                <Box key={image.id ? `id-${image.id}` : `hash-${image.composite_hash}-${index}`}>
                    <ImageCard
                        image={image}
                        selected={image.id ? selectedSet.has(image.id) : false}
                        selectable={selectable}
                        onSelectionChange={handleSelectionWrapper}
                        onDelete={onImageDelete}
                        onImageClick={() => handleImageClick(index)}
                        showCollectionType={showCollectionType}
                        currentGroupId={currentGroupId}
                        // minimal={isMinimal} // Handled internally
                        fitScreen={settings.fitToScreen}
                    />
                </Box>
            ))}
        </Box>
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
            <ImageListControls
                settings={settings}
                onViewModeChange={setViewMode}
                onColumnsChange={setGridColumns}
                onFitToScreenChange={setFitToScreen}
                onSearchClick={onSearchClick}
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
