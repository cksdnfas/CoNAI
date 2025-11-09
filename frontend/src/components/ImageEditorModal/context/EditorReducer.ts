/**
 * Editor State Reducer
 * Centralized state management for the image editor
 */

import Konva from 'konva';
import type {
  EditorState,
  EditorAction,
  EditorLayer,
  KonvaNode,
  FilterConfig,
  ToolProperties,
} from '../types/EditorTypes';
import {
  updateNodeInArray,
  removeNodeFromArray,
  deepClone,
  isMobileDevice,
  createLayer,
} from '../utils/editorUtils';

/**
 * Initial state factory
 */
export function createInitialState(): EditorState {
  const isMobile = isMobileDevice();

  // Create default layers
  const imageLayer = createLayer('Image', 0);
  const drawingLayer = createLayer('Drawing', 1);

  return {
    // Tool state
    tool: 'select',
    toolProperties: {
      brushSize: 5,
      brushColor: '#000000',
      brushOpacity: 1,
      fontSize: 24,
      fontFamily: 'Arial',
      textColor: '#000000',
      fontStyle: 'normal',
      strokeColor: '#000000',
      fillColor: 'transparent',
      strokeWidth: 2,
      shapeOpacity: 1,
    },

    // Layers & Nodes
    layers: [imageLayer, drawingLayer],
    nodes: [],
    activeLayerId: drawingLayer.id,
    selectedNodeId: null,

    // Stage configuration
    stageConfig: {
      width: 800,
      height: 600,
      scale: 1,
      position: { x: 0, y: 0 },
    },

    // Filters
    filters: [
      { name: 'Blur', enabled: false, params: { blurRadius: 5 } },
      { name: 'Brighten', enabled: false, params: { brightness: 0 } },
      { name: 'Contrast', enabled: false, params: { contrast: 0 } },
      { name: 'Grayscale', enabled: false, params: {} },
      { name: 'Sepia', enabled: false, params: {} },
      { name: 'Invert', enabled: false, params: {} },
      { name: 'Pixelate', enabled: false, params: { pixelSize: 10 } },
    ],

    // Drawing state
    drawing: {
      isDrawing: false,
      currentPoints: [],
      startPos: null,
    },

    // Crop state
    crop: {
      isActive: false,
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      isDragging: false,
    },

    // History (managed separately but stored here for state snapshots)
    history: [],
    historyIndex: -1,

    // Image loading
    imageLoad: {
      image: null,
      isLoading: false,
      error: null,
      originalDimensions: null,
    },

    // UI
    isMobile,
  };
}

/**
 * Editor reducer
 */
export function editorReducer(
  state: EditorState,
  action: EditorAction
): EditorState {
  switch (action.type) {
    // ========================================================================
    // Tool Actions
    // ========================================================================

    case 'SET_TOOL':
      return {
        ...state,
        tool: action.payload,
        selectedNodeId: null, // Deselect when switching tools
      };

    case 'UPDATE_TOOL_PROPERTIES':
      return {
        ...state,
        toolProperties: {
          ...state.toolProperties,
          ...action.payload,
        },
      };

    // ========================================================================
    // Layer Actions
    // ========================================================================

    case 'ADD_LAYER':
      return {
        ...state,
        layers: [...state.layers, action.payload],
      };

    case 'UPDATE_LAYER': {
      const { id, updates } = action.payload;
      return {
        ...state,
        layers: state.layers.map(layer =>
          layer.id === id ? { ...layer, ...updates } : layer
        ),
      };
    }

    case 'DELETE_LAYER': {
      const layerId = action.payload;
      return {
        ...state,
        layers: state.layers.filter(layer => layer.id !== layerId),
        nodes: state.nodes.filter(node => node.layerId !== layerId),
        activeLayerId:
          state.activeLayerId === layerId
            ? state.layers.find(l => l.id !== layerId)?.id || state.layers[0]?.id
            : state.activeLayerId,
      };
    }

    case 'REORDER_LAYERS':
      return {
        ...state,
        layers: action.payload,
      };

    case 'SET_ACTIVE_LAYER':
      return {
        ...state,
        activeLayerId: action.payload,
        selectedNodeId: null,
      };

    // ========================================================================
    // Node Actions
    // ========================================================================

    case 'ADD_NODE':
      return {
        ...state,
        nodes: [...state.nodes, action.payload],
      };

    case 'UPDATE_NODE': {
      const { id, updates } = action.payload;
      return {
        ...state,
        nodes: updateNodeInArray(state.nodes, id, updates),
      };
    }

    case 'DELETE_NODE':
      return {
        ...state,
        nodes: removeNodeFromArray(state.nodes, action.payload),
        selectedNodeId:
          state.selectedNodeId === action.payload ? null : state.selectedNodeId,
      };

    case 'SET_NODES':
      return {
        ...state,
        nodes: action.payload,
      };

    case 'SET_SELECTED_NODE':
      return {
        ...state,
        selectedNodeId: action.payload,
      };

    // ========================================================================
    // Stage Actions
    // ========================================================================

    case 'UPDATE_STAGE_CONFIG':
      return {
        ...state,
        stageConfig: {
          ...state.stageConfig,
          ...action.payload,
        },
      };

    case 'UPDATE_STAGE_TRANSFORM': {
      const { scale, x, y } = action.payload;
      return {
        ...state,
        stageConfig: {
          ...state.stageConfig,
          scale,
          position: { x, y },
        },
      };
    }

    // ========================================================================
    // Filter Actions
    // ========================================================================

    case 'UPDATE_FILTER': {
      const { index, updates } = action.payload;
      return {
        ...state,
        filters: state.filters.map((filter, i) =>
          i === index ? { ...filter, ...updates } : filter
        ),
      };
    }

    // ========================================================================
    // Drawing Actions
    // ========================================================================

    case 'START_DRAWING':
      return {
        ...state,
        drawing: {
          isDrawing: true,
          currentPoints: [action.payload.x, action.payload.y],
          startPos: action.payload,
        },
      };

    case 'UPDATE_DRAWING':
      return {
        ...state,
        drawing: {
          ...state.drawing,
          currentPoints: action.payload,
        },
      };

    case 'END_DRAWING':
      return {
        ...state,
        drawing: {
          isDrawing: false,
          currentPoints: [],
          startPos: null,
        },
      };

    // ========================================================================
    // Crop Actions
    // ========================================================================

    case 'START_CROP':
      return {
        ...state,
        crop: {
          isActive: true,
          x: action.payload.x,
          y: action.payload.y,
          width: 0,
          height: 0,
          isDragging: true,
        },
      };

    case 'UPDATE_CROP':
      return {
        ...state,
        crop: {
          ...state.crop,
          ...action.payload,
        },
      };

    case 'END_CROP':
      return {
        ...state,
        crop: {
          ...state.crop,
          isDragging: false,
        },
      };

    case 'APPLY_CROP':
      // Crop application is handled externally
      return {
        ...state,
        crop: {
          isActive: false,
          x: 0,
          y: 0,
          width: 0,
          height: 0,
          isDragging: false,
        },
      };

    // ========================================================================
    // History Actions (managed externally, but state updates here)
    // ========================================================================

    case 'SAVE_HISTORY':
      // History is managed by useHistory hook, but we store it for snapshots
      return state;

    case 'UNDO':
    case 'REDO':
      // Handled externally by useHistory hook
      return state;

    // ========================================================================
    // Image Actions
    // ========================================================================

    case 'SET_IMAGE':
      return {
        ...state,
        imageLoad: {
          ...state.imageLoad,
          image: action.payload,
          isLoading: false,
          error: null,
          originalDimensions: {
            width: action.payload.width,
            height: action.payload.height,
          },
        },
      };

    case 'SET_IMAGE_LOADING':
      return {
        ...state,
        imageLoad: {
          ...state.imageLoad,
          isLoading: action.payload,
        },
      };

    case 'SET_IMAGE_ERROR':
      return {
        ...state,
        imageLoad: {
          ...state.imageLoad,
          error: action.payload,
          isLoading: false,
        },
      };

    // ========================================================================
    // Reset
    // ========================================================================

    case 'RESET_EDITOR':
      return createInitialState();

    default:
      return state;
  }
}
