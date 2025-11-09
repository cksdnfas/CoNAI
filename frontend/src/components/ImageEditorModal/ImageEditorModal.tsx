/**
 * ImageEditorModal - Main Component
 * Completely rewritten with Konva.js + react-konva best practices
 * Optimized for performance with RAF batching, memoization, and proper state management
 */

import React, { useEffect, useMemo, useCallback } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  CircularProgress,
  Alert,
  useMediaQuery,
  useTheme,
  IconButton,
  Snackbar,
  Drawer,
} from '@mui/material';
import {
  Close as CloseIcon,
  Undo as UndoIcon,
  Redo as RedoIcon,
} from '@mui/icons-material';
import { EditorProvider, useEditorContext } from './context/EditorContext';
import { KonvaStage } from './components/KonvaStage';
import { ToolPalette } from './components/ToolPalette';
import { PropertiesPanel } from './components/PropertiesPanel';
import { LayerPanel } from './components/LayerPanel';
import { FilterPanel } from './components/FilterPanel';
import { stageToBlob, fitImageToStage, calculateStageSize } from './utils/editorUtils';
import type { ImageEditorModalProps, ImageNodeAttrs } from './types/EditorTypes';

// ============================================================================
// Inner Component (has access to EditorContext)
// ============================================================================

const EditorContent: React.FC<{
  imageUrl: string;
  onSave: (blob: Blob) => void;
  onClose: () => void;
}> = React.memo(({ imageUrl, onSave, onClose }) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const {
    state,
    stageRef,
    loadImage,
    addNode,
    saveHistory,
    canUndo,
    canRedo,
    undo,
    redo,
    dispatch,
  } = useEditorContext();

  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);

  // ========================================================================
  // Image Loading on Mount
  // ========================================================================

  useEffect(() => {
    const loadAndSetupImage = async () => {
      try {
        await loadImage(imageUrl);
      } catch (error) {
        console.error('Failed to load image:', error);
      }
    };

    loadAndSetupImage();
  }, [imageUrl, loadImage]);

  // ========================================================================
  // Setup image node when image loads
  // ========================================================================

  useEffect(() => {
    const { image, isLoading } = state.imageLoad;
    if (!image || isLoading) return;

    const imageLayer = state.layers.find(l => l.name === 'Image');
    if (!imageLayer) return;

    // Check if image node already exists
    const existingImageNode = state.nodes.find(n => n.id === 'main-image');
    if (existingImageNode) return;

    // Calculate optimal stage size
    const stageSize = calculateStageSize(isMobile);

    // Fit image to stage
    const fit = fitImageToStage(
      image.width,
      image.height,
      stageSize.width,
      stageSize.height
    );

    // Update stage config
    dispatch({
      type: 'UPDATE_STAGE_CONFIG',
      payload: {
        width: stageSize.width,
        height: stageSize.height,
      },
    });

    dispatch({
      type: 'UPDATE_STAGE_TRANSFORM',
      payload: {
        scale: fit.scale,
        x: fit.x,
        y: fit.y,
      },
    });

    // Create image node
    const imageNode = {
      id: 'main-image',
      type: 'image' as const,
      layerId: imageLayer.id,
      attrs: {
        x: 0,
        y: 0,
        image: image,
        width: image.width,
        height: image.height,
      } as ImageNodeAttrs,
      name: 'main-image',
    };

    addNode(imageNode);
    saveHistory();
  }, [state.imageLoad, state.layers, state.nodes, isMobile, addNode, saveHistory, dispatch]);

  // ========================================================================
  // Save Handler
  // ========================================================================

  const handleSave = useCallback(async () => {
    const stage = stageRef.current;
    if (!stage) {
      setSaveError('Stage not found');
      return;
    }

    setIsSaving(true);
    setSaveError(null);

    try {
      // If crop is active, apply it first
      if (state.crop.isActive && state.crop.width > 0 && state.crop.height > 0) {
        // Crop logic would go here
        // For now, just export the whole stage
      }

      const blob = await stageToBlob(stage, 'image/png', 0.95);
      onSave(blob);
      onClose();
    } catch (error) {
      console.error('Failed to save image:', error);
      setSaveError(error instanceof Error ? error.message : 'Failed to save image');
    } finally {
      setIsSaving(false);
    }
  }, [stageRef, state.crop, onSave, onClose]);

  // ========================================================================
  // Responsive Layout Configuration
  // ========================================================================

  const layoutConfig = useMemo(() => {
    if (isMobile) {
      return {
        toolPaletteWidth: '100%',
        propertiesWidth: '100%',
        showDrawers: true,
        stageHeight: 'calc(100vh - 200px)',
      };
    }

    return {
      toolPaletteWidth: 80,
      propertiesWidth: 280,
      layerPanelWidth: 250,
      filterPanelWidth: 280,
      showDrawers: false,
      stageHeight: '600px',
    };
  }, [isMobile]);

  // ========================================================================
  // Loading State
  // ========================================================================

  if (state.imageLoad.isLoading) {
    return (
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: 400,
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  // ========================================================================
  // Error State
  // ========================================================================

  if (state.imageLoad.error) {
    return (
      <Box sx={{ p: 2 }}>
        <Alert severity="error">{state.imageLoad.error}</Alert>
      </Box>
    );
  }

  // ========================================================================
  // Main Editor Layout
  // ========================================================================

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Toolbar */}
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          p: 1,
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Box>
          <IconButton onClick={undo} disabled={!canUndo} size="small">
            <UndoIcon />
          </IconButton>
          <IconButton onClick={redo} disabled={!canRedo} size="small">
            <RedoIcon />
          </IconButton>
        </Box>

        <Box>
          <Button onClick={onClose} sx={{ mr: 1 }}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={isSaving || !state.imageLoad.image}
          >
            {isSaving ? <CircularProgress size={20} /> : 'Save'}
          </Button>
        </Box>
      </Box>

      {/* Main Content */}
      <Box sx={{ flexGrow: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Desktop Layout */}
        {!isMobile && (
          <>
            {/* Left Sidebar - Tools */}
            <Box
              sx={{
                width: layoutConfig.toolPaletteWidth,
                borderRight: 1,
                borderColor: 'divider',
                overflow: 'auto',
              }}
            >
              <ToolPalette />
            </Box>

            {/* Center - Canvas */}
            <Box
              sx={{
                flexGrow: 1,
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                bgcolor: '#f5f5f5',
                overflow: 'hidden',
              }}
            >
              <KonvaStage />
            </Box>

            {/* Right Sidebar - Properties + Layers + Filters */}
            <Box
              sx={{
                width: 300,
                borderLeft: 1,
                borderColor: 'divider',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
              }}
            >
              <Box sx={{ height: '40%', overflow: 'auto', borderBottom: 1, borderColor: 'divider' }}>
                <PropertiesPanel />
              </Box>
              <Box sx={{ height: '30%', overflow: 'auto', borderBottom: 1, borderColor: 'divider' }}>
                <LayerPanel />
              </Box>
              <Box sx={{ height: '30%', overflow: 'auto' }}>
                <FilterPanel />
              </Box>
            </Box>
          </>
        )}

        {/* Mobile Layout */}
        {isMobile && (
          <Box sx={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
            {/* Canvas */}
            <Box
              sx={{
                flexGrow: 1,
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                bgcolor: '#f5f5f5',
                overflow: 'hidden',
              }}
            >
              <KonvaStage />
            </Box>

            {/* Bottom Toolbar */}
            <Box
              sx={{
                height: 60,
                borderTop: 1,
                borderColor: 'divider',
                overflow: 'auto',
              }}
            >
              <ToolPalette />
            </Box>
          </Box>
        )}
      </Box>

      {/* Error Snackbar */}
      <Snackbar
        open={!!saveError}
        autoHideDuration={6000}
        onClose={() => setSaveError(null)}
      >
        <Alert severity="error" onClose={() => setSaveError(null)}>
          {saveError}
        </Alert>
      </Snackbar>
    </Box>
  );
});

EditorContent.displayName = 'EditorContent';

// ============================================================================
// Main Modal Component (Wrapper)
// ============================================================================

export const ImageEditorModal: React.FC<ImageEditorModalProps> = React.memo(
  ({ open, onClose, imageUrl, onSave }) => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));

    return (
      <Dialog
        open={open}
        onClose={onClose}
        maxWidth={false}
        fullWidth
        fullScreen={isMobile}
        PaperProps={{
          sx: {
            height: isMobile ? '100%' : '90vh',
            maxHeight: isMobile ? '100%' : '90vh',
            width: isMobile ? '100%' : '90vw',
            m: isMobile ? 0 : 2,
          },
        }}
      >
        <DialogTitle sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          Image Editor
          <IconButton onClick={onClose} size="small">
            <CloseIcon />
          </IconButton>
        </DialogTitle>

        <DialogContent sx={{ p: 0, height: '100%', overflow: 'hidden' }}>
          <EditorProvider>
            <EditorContent imageUrl={imageUrl} onSave={onSave} onClose={onClose} />
          </EditorProvider>
        </DialogContent>
      </Dialog>
    );
  }
);

ImageEditorModal.displayName = 'ImageEditorModal';

export default ImageEditorModal;
