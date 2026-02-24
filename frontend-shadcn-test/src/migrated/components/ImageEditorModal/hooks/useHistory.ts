import { useState, useCallback } from 'react';
import type { DrawLine } from '../types/EditorTypes';

export const useHistory = () => {
  const [history, setHistory] = useState<DrawLine[][]>([[]]);
  const [historyStep, setHistoryStep] = useState(0);

  const saveToHistory = useCallback((lines: DrawLine[]) => {
    const newHistory = history.slice(0, historyStep + 1);
    newHistory.push([...lines]);
    setHistory(newHistory);
    setHistoryStep(newHistory.length - 1);
  }, [history, historyStep]);

  const undo = useCallback(() => {
    if (historyStep > 0) {
      setHistoryStep(historyStep - 1);
      return history[historyStep - 1];
    }
    return null;
  }, [history, historyStep]);

  const redo = useCallback(() => {
    if (historyStep < history.length - 1) {
      setHistoryStep(historyStep + 1);
      return history[historyStep + 1];
    }
    return null;
  }, [history, historyStep]);

  const canUndo = historyStep > 0;
  const canRedo = historyStep < history.length - 1;

  const reset = useCallback(() => {
    setHistory([[]]);
    setHistoryStep(0);
  }, []);

  return {
    saveToHistory,
    undo,
    redo,
    canUndo,
    canRedo,
    reset,
  };
};
