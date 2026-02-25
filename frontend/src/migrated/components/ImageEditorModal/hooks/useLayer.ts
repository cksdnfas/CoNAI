import { useState, useCallback } from 'react';
import type { Layer, DrawLine } from '../types/EditorTypes';

let layerIdCounter = 0;
const generateLayerId = () => `layer_${Date.now()}_${layerIdCounter++}`;

export const useLayer = () => {
  const [layers, setLayers] = useState<Layer[]>([]);
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);

  // Initialize with base image layer
  const initializeLayers = useCallback((image: HTMLImageElement) => {
    const imageLayer: Layer = {
      id: generateLayerId(),
      name: 'Background',
      visible: true,
      locked: true,
      opacity: 1,
      type: 'image',
      imageData: image,
    };

    const drawingLayer: Layer = {
      id: generateLayerId(),
      name: 'Layer 1',
      visible: true,
      locked: false,
      opacity: 1,
      type: 'drawing',
      lines: [],
    };

    setLayers([imageLayer, drawingLayer]);
    setActiveLayerId(drawingLayer.id);

    return { imageLayer, drawingLayer };
  }, []);

  // Add new drawing layer
  const addLayer = useCallback((name?: string) => {
    const newLayer: Layer = {
      id: generateLayerId(),
      name: name || `Layer ${layers.length}`,
      visible: true,
      locked: false,
      opacity: 1,
      type: 'drawing',
      lines: [],
    };

    setLayers(prev => [...prev, newLayer]);
    setActiveLayerId(newLayer.id);
    return newLayer;
  }, [layers.length]);

  // Add paste layer (floating selection)
  const addPasteLayer = useCallback((
    imageData: ImageData,
    x: number,
    y: number
  ) => {
    const pasteLayer: Layer = {
      id: generateLayerId(),
      name: 'Pasted',
      visible: true,
      locked: false,
      opacity: 1,
      type: 'paste',
      pasteData: {
        imageData,
        x,
        y,
        width: imageData.width,
        height: imageData.height,
      },
    };

    setLayers(prev => [...prev, pasteLayer]);
    setActiveLayerId(pasteLayer.id);
    return pasteLayer;
  }, []);

  // Remove layer
  const removeLayer = useCallback((layerId: string) => {
    setLayers(prev => {
      const layer = prev.find(l => l.id === layerId);
      // Cannot remove background image layer
      if (layer?.type === 'image' && layer.locked) return prev;

      const newLayers = prev.filter(l => l.id !== layerId);

      // If removed active layer, select previous one
      if (activeLayerId === layerId && newLayers.length > 0) {
        const lastEditableLayer = [...newLayers].reverse().find(l => l.type !== 'image');
        setActiveLayerId(lastEditableLayer?.id || newLayers[newLayers.length - 1].id);
      }

      return newLayers;
    });
  }, [activeLayerId]);

  // Update layer properties
  const updateLayer = useCallback((layerId: string, updates: Partial<Layer>) => {
    setLayers(prev => prev.map(layer =>
      layer.id === layerId ? { ...layer, ...updates } : layer
    ));
  }, []);

  // Toggle layer visibility
  const toggleLayerVisibility = useCallback((layerId: string) => {
    setLayers(prev => prev.map(layer =>
      layer.id === layerId ? { ...layer, visible: !layer.visible } : layer
    ));
  }, []);

  // Toggle layer lock
  const toggleLayerLock = useCallback((layerId: string) => {
    setLayers(prev => prev.map(layer =>
      layer.id === layerId ? { ...layer, locked: !layer.locked } : layer
    ));
  }, []);

  // Set layer opacity
  const setLayerOpacity = useCallback((layerId: string, opacity: number) => {
    setLayers(prev => prev.map(layer =>
      layer.id === layerId ? { ...layer, opacity: Math.max(0, Math.min(1, opacity)) } : layer
    ));
  }, []);

  // Move layer up/down
  const moveLayer = useCallback((layerId: string, direction: 'up' | 'down') => {
    setLayers(prev => {
      const index = prev.findIndex(l => l.id === layerId);
      if (index === -1) return prev;

      const newIndex = direction === 'up' ? index + 1 : index - 1;
      // Cannot move below background layer (index 0)
      if (newIndex < 1 || newIndex >= prev.length) return prev;

      const newLayers = [...prev];
      [newLayers[index], newLayers[newIndex]] = [newLayers[newIndex], newLayers[index]];
      return newLayers;
    });
  }, []);

  // Update lines in active drawing layer
  const updateActiveLayerLines = useCallback((lines: DrawLine[]) => {
    if (!activeLayerId) return;

    setLayers(prev => prev.map(layer =>
      layer.id === activeLayerId && layer.type === 'drawing'
        ? { ...layer, lines }
        : layer
    ));
  }, [activeLayerId]);

  // Get active layer
  const getActiveLayer = useCallback((): Layer | null => {
    return layers.find(l => l.id === activeLayerId) || null;
  }, [layers, activeLayerId]);

  // Get all visible layers (for rendering)
  const getVisibleLayers = useCallback((): Layer[] => {
    return layers.filter(l => l.visible);
  }, [layers]);

  // Get all drawing lines from visible layers (for export)
  const getAllVisibleLines = useCallback((): DrawLine[] => {
    return layers
      .filter(l => l.visible && l.type === 'drawing' && l.lines)
      .flatMap(l => l.lines || []);
  }, [layers]);

  // Merge paste layer into drawing layer
  const mergePasteLayer = useCallback((pasteLayerId: string, targetLayerId: string) => {
    // This would require canvas compositing - simplified version
    setLayers(prev => prev.filter(l => l.id !== pasteLayerId));
  }, []);

  // Apply (confirm) paste layer - merge it into the base image
  // Returns the paste layer data for external processing
  const applyPasteLayer = useCallback((pasteLayerId: string): Layer['pasteData'] | null => {
    const pasteLayer = layers.find(l => l.id === pasteLayerId && l.type === 'paste');
    if (!pasteLayer || !pasteLayer.pasteData) return null;

    const pasteData = pasteLayer.pasteData;

    // Remove the paste layer
    setLayers(prev => {
      const newLayers = prev.filter(l => l.id !== pasteLayerId);

      // If removed active layer, select a drawing layer
      if (activeLayerId === pasteLayerId && newLayers.length > 0) {
        const drawingLayer = newLayers.find(l => l.type === 'drawing');
        setActiveLayerId(drawingLayer?.id || newLayers[newLayers.length - 1].id);
      }

      return newLayers;
    });

    return pasteData;
  }, [layers, activeLayerId]);

  // Check if there are any paste layers
  const hasPasteLayers = useCallback((): boolean => {
    return layers.some(l => l.type === 'paste' && l.visible);
  }, [layers]);

  // Get active paste layer (if active layer is a paste layer)
  const getActivePasteLayer = useCallback((): Layer | null => {
    const activeLayer = layers.find(l => l.id === activeLayerId);
    return activeLayer?.type === 'paste' ? activeLayer : null;
  }, [layers, activeLayerId]);

  // Flatten all layers (merge visible layers)
  const flattenLayers = useCallback(() => {
    const visibleLayers = layers.filter(l => l.visible);

    // Keep only background and merge all drawings into one layer
    const backgroundLayer = visibleLayers.find(l => l.type === 'image');
    const allLines = visibleLayers
      .filter(l => l.type === 'drawing')
      .flatMap(l => l.lines || []);

    const flattenedDrawingLayer: Layer = {
      id: generateLayerId(),
      name: 'Flattened',
      visible: true,
      locked: false,
      opacity: 1,
      type: 'drawing',
      lines: allLines,
    };

    const newLayers = backgroundLayer
      ? [backgroundLayer, flattenedDrawingLayer]
      : [flattenedDrawingLayer];

    setLayers(newLayers);
    setActiveLayerId(flattenedDrawingLayer.id);
  }, [layers]);

  // Reset layers
  const reset = useCallback(() => {
    setLayers([]);
    setActiveLayerId(null);
  }, []);

  // Move paste layer position
  const movePasteLayer = useCallback((layerId: string, x: number, y: number) => {
    setLayers(prev => prev.map(layer =>
      layer.id === layerId && layer.type === 'paste' && layer.pasteData
        ? { ...layer, pasteData: { ...layer.pasteData, x, y } }
        : layer
    ));
  }, []);

  return {
    layers,
    activeLayerId,
    setActiveLayerId,
    initializeLayers,
    addLayer,
    addPasteLayer,
    removeLayer,
    updateLayer,
    toggleLayerVisibility,
    toggleLayerLock,
    setLayerOpacity,
    moveLayer,
    updateActiveLayerLines,
    getActiveLayer,
    getVisibleLayers,
    getAllVisibleLines,
    mergePasteLayer,
    flattenLayers,
    movePasteLayer,
    applyPasteLayer,
    hasPasteLayers,
    getActivePasteLayer,
    reset,
  };
};
