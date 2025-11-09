/**
 * KonvaStage Component
 * Highly optimized Stage/Layer rendering with best practices
 */

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Stage, Layer, Image as KonvaImage, Line, Rect, Circle, Text as KonvaText, Arrow, Transformer } from 'react-konva';
import Konva from 'konva';
import { useEditorContext } from '../context/EditorContext';
import { useDrawing } from '../hooks/useDrawing';
import {
  getRelativePointerPosition,
  normalizeRect,
  clampZoom,
  rafThrottle,
  getNodesByLayer,
  generateId,
} from '../utils/editorUtils';
import type {
  KonvaNode,
  ImageNodeAttrs,
  LineNodeAttrs,
  RectNodeAttrs,
  CircleNodeAttrs,
  TextNodeAttrs,
  ArrowNodeAttrs,
  Point,
} from '../types/EditorTypes';

// ============================================================================
// Individual Node Components (Memoized for Performance)
// ============================================================================

interface NodeComponentProps {
  node: KonvaNode;
  isSelected: boolean;
  onSelect: () => void;
  onDragEnd: (pos: Point) => void;
  onTransformEnd: () => void;
}

const ImageNode = React.memo<NodeComponentProps>(({ node, isSelected, onSelect, onDragEnd, onTransformEnd }) => {
  const attrs = node.attrs as ImageNodeAttrs;
  const { state, updateFilter } = useEditorContext();

  // Get active filters (memoized)
  const activeFilters = useMemo(() => {
    return state.filters
      .filter(f => f.enabled)
      .map(f => {
        switch (f.name) {
          case 'Blur': return Konva.Filters.Blur;
          case 'Brighten': return Konva.Filters.Brighten;
          case 'Contrast': return Konva.Filters.Contrast;
          case 'Grayscale': return Konva.Filters.Grayscale;
          case 'Sepia': return Konva.Filters.Sepia;
          case 'Invert': return Konva.Filters.Invert;
          case 'Pixelate': return Konva.Filters.Pixelate;
          default: return null;
        }
      })
      .filter(Boolean) as Array<(imageData: ImageData) => void>;
  }, [state.filters]);

  // Apply filter params on transform
  const handleTransform = useCallback((e: Konva.KonvaEventObject<Event>) => {
    const node = e.target;
    state.filters.forEach((filter, index) => {
      if (!filter.enabled) return;

      switch (filter.name) {
        case 'Blur':
          (node as any).blurRadius(filter.params.blurRadius);
          break;
        case 'Brighten':
          (node as any).brightness(filter.params.brightness);
          break;
        case 'Contrast':
          (node as any).contrast(filter.params.contrast);
          break;
        case 'Pixelate':
          (node as any).pixelSize(filter.params.pixelSize);
          break;
      }
    });
  }, [state.filters]);

  return (
    <KonvaImage
      key={node.id}
      id={node.id}
      {...attrs}
      draggable={node.id !== 'main-image'}
      onClick={onSelect}
      onTap={onSelect}
      onDragEnd={(e) => onDragEnd({ x: e.target.x(), y: e.target.y() })}
      onTransformEnd={onTransformEnd}
      onTransform={handleTransform}
      filters={activeFilters}
      cache={true} // IMPORTANT: Enable Konva caching
      perfectDrawEnabled={false} // Performance optimization
    />
  );
});

const LineNode = React.memo<NodeComponentProps>(({ node, onSelect, onDragEnd }) => {
  const attrs = node.attrs as LineNodeAttrs;

  return (
    <Line
      key={node.id}
      id={node.id}
      {...attrs}
      draggable={false} // Lines typically aren't draggable
      onClick={onSelect}
      onTap={onSelect}
      listening={true}
      hitStrokeWidth={Math.max(attrs.strokeWidth * 2, 10)} // Easier to select
      perfectDrawEnabled={false}
    />
  );
});

const RectNode = React.memo<NodeComponentProps>(({ node, isSelected, onSelect, onDragEnd, onTransformEnd }) => {
  const attrs = node.attrs as RectNodeAttrs;

  return (
    <Rect
      key={node.id}
      id={node.id}
      {...attrs}
      draggable={true}
      onClick={onSelect}
      onTap={onSelect}
      onDragEnd={(e) => onDragEnd({ x: e.target.x(), y: e.target.y() })}
      onTransformEnd={onTransformEnd}
      perfectDrawEnabled={false}
    />
  );
});

const CircleNode = React.memo<NodeComponentProps>(({ node, isSelected, onSelect, onDragEnd, onTransformEnd }) => {
  const attrs = node.attrs as CircleNodeAttrs;

  return (
    <Circle
      key={node.id}
      id={node.id}
      {...attrs}
      draggable={true}
      onClick={onSelect}
      onTap={onSelect}
      onDragEnd={(e) => onDragEnd({ x: e.target.x(), y: e.target.y() })}
      onTransformEnd={onTransformEnd}
      perfectDrawEnabled={false}
    />
  );
});

const TextNode = React.memo<NodeComponentProps>(({ node, isSelected, onSelect, onDragEnd, onTransformEnd }) => {
  const attrs = node.attrs as TextNodeAttrs;

  return (
    <KonvaText
      key={node.id}
      id={node.id}
      {...attrs}
      draggable={true}
      onClick={onSelect}
      onTap={onSelect}
      onDragEnd={(e) => onDragEnd({ x: e.target.x(), y: e.target.y() })}
      onTransformEnd={onTransformEnd}
      perfectDrawEnabled={false}
    />
  );
});

const ArrowNode = React.memo<NodeComponentProps>(({ node, isSelected, onSelect, onDragEnd }) => {
  const attrs = node.attrs as ArrowNodeAttrs;

  return (
    <Arrow
      key={node.id}
      id={node.id}
      {...attrs}
      draggable={false}
      onClick={onSelect}
      onTap={onSelect}
      perfectDrawEnabled={false}
    />
  );
});

// ============================================================================
// Node Renderer (Memoized)
// ============================================================================

interface NodesRendererProps {
  nodes: KonvaNode[];
  selectedNodeId: string | null;
  onNodeSelect: (id: string | null) => void;
  onNodeUpdate: (id: string, updates: Partial<KonvaNode>) => void;
  onTransformEnd: () => void;
}

const NodesRenderer = React.memo<NodesRendererProps>(({
  nodes,
  selectedNodeId,
  onNodeSelect,
  onNodeUpdate,
  onTransformEnd,
}) => {
  const handleSelect = useCallback((id: string) => {
    onNodeSelect(id);
  }, [onNodeSelect]);

  const handleDragEnd = useCallback((id: string, pos: Point) => {
    onNodeUpdate(id, {
      attrs: { x: pos.x, y: pos.y } as any,
    });
  }, [onNodeUpdate]);

  return (
    <>
      {nodes.map((node) => {
        const isSelected = node.id === selectedNodeId;
        const props = {
          node,
          isSelected,
          onSelect: () => handleSelect(node.id),
          onDragEnd: (pos: Point) => handleDragEnd(node.id, pos),
          onTransformEnd,
        };

        switch (node.type) {
          case 'image':
            return <ImageNode key={node.id} {...props} />;
          case 'line':
            return <LineNode key={node.id} {...props} />;
          case 'rect':
            return <RectNode key={node.id} {...props} />;
          case 'circle':
            return <CircleNode key={node.id} {...props} />;
          case 'text':
            return <TextNode key={node.id} {...props} />;
          case 'arrow':
            return <ArrowNode key={node.id} {...props} />;
          default:
            return null;
        }
      })}
    </>
  );
});

// ============================================================================
// Main KonvaStage Component
// ============================================================================

export const KonvaStage: React.FC = React.memo(() => {
  const {
    state,
    stageRef,
    transformerRef,
    setSelectedNode,
    updateNode,
    addNode,
    saveHistory,
    dispatch,
  } = useEditorContext();

  const { tool, toolProperties, layers, nodes, activeLayerId, selectedNodeId, stageConfig } = state;

  // Drawing hook
  const {
    isDrawing,
    currentPoints,
    startDrawing,
    updateDrawing,
    endDrawing,
  } = useDrawing({
    tool,
    toolProperties,
    activeLayerId,
    onDrawingComplete: (node) => {
      addNode(node);
      saveHistory();
    },
  });

  // Temporary shape state (for preview while creating)
  const tempShapeRef = useRef<{ type: string; startPoint: Point } | null>(null);

  // ========================================================================
  // Transformer Management
  // ========================================================================

  useEffect(() => {
    const transformer = transformerRef.current;
    const stage = stageRef.current;
    if (!transformer || !stage) return;

    if (selectedNodeId) {
      const selectedNode = stage.findOne(`#${selectedNodeId}`);
      if (selectedNode && selectedNode.draggable()) {
        transformer.nodes([selectedNode]);
      } else {
        transformer.nodes([]);
      }
    } else {
      transformer.nodes([]);
    }
  }, [selectedNodeId, transformerRef, stageRef]);

  // ========================================================================
  // Mouse/Touch Event Handlers (Optimized with RAF)
  // ========================================================================

  const handleMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      const stage = e.target.getStage();
      if (!stage) return;

      // Deselect if clicked on stage
      if (e.target === stage) {
        setSelectedNode(null);
        return;
      }

      const pos = getRelativePointerPosition(stage);
      if (!pos) return;

      switch (tool) {
        case 'brush':
        case 'eraser':
          startDrawing(pos);
          break;

        case 'crop':
          dispatch({ type: 'START_CROP', payload: pos });
          break;

        case 'rect':
        case 'circle':
        case 'line':
        case 'arrow':
          tempShapeRef.current = { type: tool, startPoint: pos };
          break;
      }
    },
    [tool, startDrawing, setSelectedNode, dispatch]
  );

  const handleMouseMove = useMemo(
    () =>
      rafThrottle((e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
        const stage = e.target.getStage();
        if (!stage) return;

        const pos = getRelativePointerPosition(stage);
        if (!pos) return;

        if (isDrawing) {
          updateDrawing(pos);
        } else if (state.crop.isDragging) {
          const { x, y } = state.crop;
          dispatch({
            type: 'UPDATE_CROP',
            payload: {
              width: pos.x - x,
              height: pos.y - y,
            },
          });
        } else if (tempShapeRef.current) {
          // Preview shape creation (handled in render)
        }
      }),
    [isDrawing, updateDrawing, state.crop, dispatch]
  );

  const handleMouseUp = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      const stage = e.target.getStage();
      if (!stage) return;

      const pos = getRelativePointerPosition(stage);
      if (!pos) return;

      if (isDrawing) {
        endDrawing();
      } else if (state.crop.isDragging) {
        dispatch({ type: 'END_CROP' });
      } else if (tempShapeRef.current) {
        const { type, startPoint } = tempShapeRef.current;

        // Create final shape
        const attrs = {
          x: Math.min(startPoint.x, pos.x),
          y: Math.min(startPoint.y, pos.y),
        };

        let node: KonvaNode | null = null;

        switch (type) {
          case 'rect':
            node = {
              id: generateId('rect'),
              type: 'rect',
              layerId: activeLayerId,
              attrs: {
                ...attrs,
                width: Math.abs(pos.x - startPoint.x),
                height: Math.abs(pos.y - startPoint.y),
                fill: toolProperties.fillColor,
                stroke: toolProperties.strokeColor,
                strokeWidth: toolProperties.strokeWidth,
                opacity: toolProperties.shapeOpacity,
              } as RectNodeAttrs,
            };
            break;

          case 'circle':
            const radius = Math.sqrt(
              Math.pow(pos.x - startPoint.x, 2) + Math.pow(pos.y - startPoint.y, 2)
            );
            node = {
              id: generateId('circle'),
              type: 'circle',
              layerId: activeLayerId,
              attrs: {
                x: startPoint.x,
                y: startPoint.y,
                radius,
                fill: toolProperties.fillColor,
                stroke: toolProperties.strokeColor,
                strokeWidth: toolProperties.strokeWidth,
                opacity: toolProperties.shapeOpacity,
              } as CircleNodeAttrs,
            };
            break;

          case 'line':
            node = {
              id: generateId('line'),
              type: 'line',
              layerId: activeLayerId,
              attrs: {
                x: 0,
                y: 0,
                points: [startPoint.x, startPoint.y, pos.x, pos.y],
                stroke: toolProperties.strokeColor,
                strokeWidth: toolProperties.strokeWidth,
                opacity: toolProperties.shapeOpacity,
              } as LineNodeAttrs,
            };
            break;

          case 'arrow':
            node = {
              id: generateId('arrow'),
              type: 'arrow',
              layerId: activeLayerId,
              attrs: {
                x: 0,
                y: 0,
                points: [startPoint.x, startPoint.y, pos.x, pos.y],
                stroke: toolProperties.strokeColor,
                strokeWidth: toolProperties.strokeWidth,
                pointerLength: 10,
                pointerWidth: 10,
                opacity: toolProperties.shapeOpacity,
              } as ArrowNodeAttrs,
            };
            break;
        }

        if (node) {
          addNode(node);
          saveHistory();
        }

        tempShapeRef.current = null;
      }
    },
    [isDrawing, endDrawing, state.crop, dispatch, activeLayerId, toolProperties, addNode, saveHistory]
  );

  // ========================================================================
  // Zoom/Pan Handlers
  // ========================================================================

  const handleWheel = useCallback(
    (e: Konva.KonvaEventObject<WheelEvent>) => {
      e.evt.preventDefault();

      const stage = stageRef.current;
      if (!stage) return;

      const oldScale = stage.scaleX();
      const pointer = stage.getPointerPosition();
      if (!pointer) return;

      const mousePointTo = {
        x: (pointer.x - stage.x()) / oldScale,
        y: (pointer.y - stage.y()) / oldScale,
      };

      const scaleBy = 1.05;
      const direction = e.evt.deltaY > 0 ? -1 : 1;
      const newScale = clampZoom(direction > 0 ? oldScale * scaleBy : oldScale / scaleBy);

      const newPos = {
        x: pointer.x - mousePointTo.x * newScale,
        y: pointer.y - mousePointTo.y * newScale,
      };

      dispatch({
        type: 'UPDATE_STAGE_TRANSFORM',
        payload: {
          scale: newScale,
          x: newPos.x,
          y: newPos.y,
        },
      });
    },
    [stageRef, dispatch]
  );

  // ========================================================================
  // Render Nodes by Layer (Memoized)
  // ========================================================================

  const renderLayerNodes = useCallback((layerId: string) => {
    const layerNodes = getNodesByLayer(nodes, layerId);

    return (
      <NodesRenderer
        nodes={layerNodes}
        selectedNodeId={selectedNodeId}
        onNodeSelect={setSelectedNode}
        onNodeUpdate={updateNode}
        onTransformEnd={saveHistory}
      />
    );
  }, [nodes, selectedNodeId, setSelectedNode, updateNode, saveHistory]);

  // ========================================================================
  // Current Drawing Line Preview (Memoized)
  // ========================================================================

  const currentDrawingLine = useMemo(() => {
    if (!isDrawing || currentPoints.length < 4) return null;

    const isEraser = tool === 'eraser';

    return (
      <Line
        points={currentPoints}
        stroke={isEraser ? '#FFFFFF' : toolProperties.brushColor}
        strokeWidth={toolProperties.brushSize}
        tension={0.5}
        lineCap="round"
        lineJoin="round"
        opacity={isEraser ? 1 : toolProperties.brushOpacity}
        globalCompositeOperation={isEraser ? 'destination-out' : 'source-over'}
        listening={false}
        perfectDrawEnabled={false}
      />
    );
  }, [isDrawing, currentPoints, tool, toolProperties]);

  // ========================================================================
  // Crop Rectangle Preview (Memoized)
  // ========================================================================

  const cropRectangle = useMemo(() => {
    if (!state.crop.isActive) return null;

    const normalized = normalizeRect(state.crop);

    return (
      <Rect
        x={normalized.x}
        y={normalized.y}
        width={normalized.width}
        height={normalized.height}
        stroke="#00ff00"
        strokeWidth={2}
        dash={[10, 5]}
        listening={false}
      />
    );
  }, [state.crop]);

  // ========================================================================
  // Render
  // ========================================================================

  return (
    <Stage
      ref={stageRef}
      width={stageConfig.width}
      height={stageConfig.height}
      scaleX={stageConfig.scale}
      scaleY={stageConfig.scale}
      x={stageConfig.position.x}
      y={stageConfig.position.y}
      draggable={tool === 'pan'}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onTouchStart={handleMouseDown}
      onTouchMove={handleMouseMove}
      onTouchEnd={handleMouseUp}
      onWheel={handleWheel}
      style={{ cursor: tool === 'pan' ? 'grab' : 'crosshair' }}
    >
      {layers.map((layer) => (
        <Layer
          key={layer.id}
          id={layer.id}
          visible={layer.visible}
          opacity={layer.opacity}
          listening={!layer.locked}
        >
          {renderLayerNodes(layer.id)}
          {layer.id === activeLayerId && currentDrawingLine}
          {layer.id === activeLayerId && cropRectangle}
          {layer.id === activeLayerId && tool === 'select' && (
            <Transformer ref={transformerRef} />
          )}
        </Layer>
      ))}
    </Stage>
  );
});

KonvaStage.displayName = 'KonvaStage';
