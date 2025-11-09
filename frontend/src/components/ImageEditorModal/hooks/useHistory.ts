/**
 * useHistory Hook
 * Optimized undo/redo system with RAF batching
 * Replaces slow JSON.parse/stringify with structuredClone
 */

import { useCallback, useRef, useMemo } from 'react';
import type { HistoryState } from '../types/EditorTypes';
import { createHistorySnapshot, historyStatesEqual, rafThrottle } from '../utils/editorUtils';

interface UseHistoryOptions {
  maxHistorySize?: number;
  onHistoryChange?: (canUndo: boolean, canRedo: boolean) => void;
}

interface UseHistoryReturn {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => HistoryState | null;
  redo: () => HistoryState | null;
  saveHistory: (state: HistoryState) => void;
  clearHistory: () => void;
  getHistory: () => { history: HistoryState[]; index: number };
}

/**
 * Custom hook for managing editor history with optimized performance
 */
export function useHistory(options: UseHistoryOptions = {}): UseHistoryReturn {
  const {
    maxHistorySize = 50,
    onHistoryChange,
  } = options;

  // Use refs to avoid re-renders on every history change
  const historyRef = useRef<HistoryState[]>([]);
  const indexRef = useRef<number>(-1);
  const pendingSaveRef = useRef<HistoryState | null>(null);
  const saveRafIdRef = useRef<number | null>(null);

  /**
   * Batched save using requestAnimationFrame
   * Prevents multiple saves in the same frame
   */
  const saveHistoryImmediate = useCallback((state: HistoryState) => {
    // Check if duplicate of last state
    const lastState = historyRef.current[indexRef.current];
    if (historyStatesEqual(state, lastState)) {
      return;
    }

    // Trim future history if we're not at the end
    if (indexRef.current < historyRef.current.length - 1) {
      historyRef.current = historyRef.current.slice(0, indexRef.current + 1);
    }

    // Add new state
    historyRef.current.push(state);
    indexRef.current++;

    // Trim old history if exceeds max size
    if (historyRef.current.length > maxHistorySize) {
      const removeCount = historyRef.current.length - maxHistorySize;
      historyRef.current = historyRef.current.slice(removeCount);
      indexRef.current -= removeCount;
    }

    // Notify listeners
    if (onHistoryChange) {
      const canUndo = indexRef.current > 0;
      const canRedo = indexRef.current < historyRef.current.length - 1;
      onHistoryChange(canUndo, canRedo);
    }
  }, [maxHistorySize, onHistoryChange]);

  /**
   * Throttled save using RAF
   */
  const saveHistoryThrottled = useMemo(
    () => rafThrottle((state: HistoryState) => {
      saveHistoryImmediate(state);
      pendingSaveRef.current = null;
    }),
    [saveHistoryImmediate]
  );

  /**
   * Public API: Save history state
   */
  const saveHistory = useCallback((state: HistoryState) => {
    pendingSaveRef.current = state;
    saveHistoryThrottled(state);
  }, [saveHistoryThrottled]);

  /**
   * Undo to previous state
   */
  const undo = useCallback((): HistoryState | null => {
    if (indexRef.current <= 0) return null;

    indexRef.current--;
    const state = historyRef.current[indexRef.current];

    if (onHistoryChange) {
      const canUndo = indexRef.current > 0;
      const canRedo = indexRef.current < historyRef.current.length - 1;
      onHistoryChange(canUndo, canRedo);
    }

    return state;
  }, [onHistoryChange]);

  /**
   * Redo to next state
   */
  const redo = useCallback((): HistoryState | null => {
    if (indexRef.current >= historyRef.current.length - 1) return null;

    indexRef.current++;
    const state = historyRef.current[indexRef.current];

    if (onHistoryChange) {
      const canUndo = indexRef.current > 0;
      const canRedo = indexRef.current < historyRef.current.length - 1;
      onHistoryChange(canUndo, canRedo);
    }

    return state;
  }, [onHistoryChange]);

  /**
   * Clear all history
   */
  const clearHistory = useCallback(() => {
    historyRef.current = [];
    indexRef.current = -1;
    pendingSaveRef.current = null;

    if (saveRafIdRef.current !== null) {
      cancelAnimationFrame(saveRafIdRef.current);
      saveRafIdRef.current = null;
    }

    if (onHistoryChange) {
      onHistoryChange(false, false);
    }
  }, [onHistoryChange]);

  /**
   * Get current history state (for debugging)
   */
  const getHistory = useCallback(() => ({
    history: historyRef.current,
    index: indexRef.current,
  }), []);

  // Computed properties
  const canUndo = indexRef.current > 0;
  const canRedo = indexRef.current < historyRef.current.length - 1;

  return {
    canUndo,
    canRedo,
    undo,
    redo,
    saveHistory,
    clearHistory,
    getHistory,
  };
}
