/**
 * Editor Context
 * Provides editor state and actions to all child components
 */

import React, { createContext, useContext, useReducer, useCallback, useMemo, useRef } from 'react';
import Konva from 'konva';
import type {
  EditorState,
  EditorAction,
  EditorTool,
  ToolProperties,
  EditorLayer,
  KonvaNode,
  FilterConfig,
  StageConfig,
  HistoryState,
} from '../types/EditorTypes';
import { editorReducer, createInitialState } from './EditorReducer';
import { useHistory } from '../hooks/useHistory';
import { useImageLoader } from '../hooks/useImageLoader';
import { createHistorySnapshot } from '../utils/editorUtils';

// ============================================================================
// Context Types
// ============================================================================

interface EditorContextValue {
  // State
  state: EditorState;
  dispatch: React.Dispatch<EditorAction>;

  // Refs
  stageRef: React.RefObject<Konva.Stage | null>;
  transformerRef: React.RefObject<Konva.Transformer | null>;

  // History
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  saveHistory: () => void;

  // Image loading
  loadImage: (url: string) => Promise<void>;

  // Convenience actions
  setTool: (tool: EditorTool) => void;
  updateToolProperties: (props: Partial<ToolProperties>) => void;
  addNode: (node: KonvaNode) => void;
  updateNode: (id: string, updates: Partial<KonvaNode>) => void;
  deleteNode: (id: string) => void;
  setSelectedNode: (id: string | null) => void;
  updateFilter: (index: number, updates: Partial<FilterConfig>) => void;
  addLayer: (layer: EditorLayer) => void;
  updateLayer: (id: string, updates: Partial<EditorLayer>) => void;
  deleteLayer: (id: string) => void;
  setActiveLayer: (id: string) => void;
}

// ============================================================================
// Context Creation
// ============================================================================

const EditorContext = createContext<EditorContextValue | null>(null);

// ============================================================================
// Provider Component
// ============================================================================

interface EditorProviderProps {
  children: React.ReactNode;
}

export const EditorProvider: React.FC<EditorProviderProps> = ({ children }) => {
  const [state, dispatch] = useReducer(editorReducer, undefined, createInitialState);

  // Refs for Konva stage and transformer
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);

  // History management
  const {
    canUndo,
    canRedo,
    undo: undoHistory,
    redo: redoHistory,
    saveHistory: saveHistoryState,
  } = useHistory({
    maxHistorySize: 50,
  });

  // Image loading
  const { loadImage: loadImageFromUrl } = useImageLoader({
    onLoad: (image) => {
      dispatch({ type: 'SET_IMAGE', payload: image });
    },
    onError: (error) => {
      dispatch({ type: 'SET_IMAGE_ERROR', payload: error.message });
    },
  });

  // ========================================================================
  // History Actions
  // ========================================================================

  const saveHistory = useCallback(() => {
    const snapshot = createHistorySnapshot(
      state.layers,
      state.nodes,
      state.stageConfig
    );
    saveHistoryState(snapshot);
  }, [state.layers, state.nodes, state.stageConfig, saveHistoryState]);

  const undo = useCallback(() => {
    const previousState = undoHistory();
    if (previousState) {
      dispatch({ type: 'REORDER_LAYERS', payload: previousState.layers });
      dispatch({ type: 'SET_NODES', payload: previousState.nodes });
      dispatch({
        type: 'UPDATE_STAGE_TRANSFORM',
        payload: {
          scale: previousState.stageAttrs.scale,
          x: previousState.stageAttrs.position.x,
          y: previousState.stageAttrs.position.y,
        },
      });
    }
  }, [undoHistory]);

  const redo = useCallback(() => {
    const nextState = redoHistory();
    if (nextState) {
      dispatch({ type: 'REORDER_LAYERS', payload: nextState.layers });
      dispatch({ type: 'SET_NODES', payload: nextState.nodes });
      dispatch({
        type: 'UPDATE_STAGE_TRANSFORM',
        payload: {
          scale: nextState.stageAttrs.scale,
          x: nextState.stageAttrs.position.x,
          y: nextState.stageAttrs.position.y,
        },
      });
    }
  }, [redoHistory]);

  // ========================================================================
  // Image Loading
  // ========================================================================

  const loadImage = useCallback(
    async (url: string) => {
      dispatch({ type: 'SET_IMAGE_LOADING', payload: true });
      await loadImageFromUrl(url);
    },
    [loadImageFromUrl]
  );

  // ========================================================================
  // Convenience Actions (memoized)
  // ========================================================================

  const setTool = useCallback((tool: EditorTool) => {
    dispatch({ type: 'SET_TOOL', payload: tool });
  }, []);

  const updateToolProperties = useCallback((props: Partial<ToolProperties>) => {
    dispatch({ type: 'UPDATE_TOOL_PROPERTIES', payload: props });
  }, []);

  const addNode = useCallback((node: KonvaNode) => {
    dispatch({ type: 'ADD_NODE', payload: node });
  }, []);

  const updateNode = useCallback((id: string, updates: Partial<KonvaNode>) => {
    dispatch({ type: 'UPDATE_NODE', payload: { id, updates } });
  }, []);

  const deleteNode = useCallback((id: string) => {
    dispatch({ type: 'DELETE_NODE', payload: id });
  }, []);

  const setSelectedNode = useCallback((id: string | null) => {
    dispatch({ type: 'SET_SELECTED_NODE', payload: id });
  }, []);

  const updateFilter = useCallback((index: number, updates: Partial<FilterConfig>) => {
    dispatch({ type: 'UPDATE_FILTER', payload: { index, updates } });
  }, []);

  const addLayer = useCallback((layer: EditorLayer) => {
    dispatch({ type: 'ADD_LAYER', payload: layer });
  }, []);

  const updateLayer = useCallback((id: string, updates: Partial<EditorLayer>) => {
    dispatch({ type: 'UPDATE_LAYER', payload: { id, updates } });
  }, []);

  const deleteLayer = useCallback((id: string) => {
    dispatch({ type: 'DELETE_LAYER', payload: id });
  }, []);

  const setActiveLayer = useCallback((id: string) => {
    dispatch({ type: 'SET_ACTIVE_LAYER', payload: id });
  }, []);

  // ========================================================================
  // Context Value (memoized)
  // ========================================================================

  const contextValue = useMemo(
    () => ({
      state,
      dispatch,
      stageRef,
      transformerRef,
      canUndo,
      canRedo,
      undo,
      redo,
      saveHistory,
      loadImage,
      setTool,
      updateToolProperties,
      addNode,
      updateNode,
      deleteNode,
      setSelectedNode,
      updateFilter,
      addLayer,
      updateLayer,
      deleteLayer,
      setActiveLayer,
    }),
    [
      state,
      canUndo,
      canRedo,
      undo,
      redo,
      saveHistory,
      loadImage,
      setTool,
      updateToolProperties,
      addNode,
      updateNode,
      deleteNode,
      setSelectedNode,
      updateFilter,
      addLayer,
      updateLayer,
      deleteLayer,
      setActiveLayer,
    ]
  );

  return (
    <EditorContext.Provider value={contextValue}>
      {children}
    </EditorContext.Provider>
  );
};

// ============================================================================
// Custom Hook
// ============================================================================

export function useEditorContext(): EditorContextValue {
  const context = useContext(EditorContext);
  if (!context) {
    throw new Error('useEditorContext must be used within EditorProvider');
  }
  return context;
}
