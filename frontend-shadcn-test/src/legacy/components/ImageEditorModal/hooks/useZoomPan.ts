import { useState, useCallback, useRef } from 'react';
import type { Position } from '../types/EditorTypes';

export const useZoomPan = (initialZoom = 1) => {
  const [zoom, setZoom] = useState(initialZoom);
  const [stagePos, setStagePos] = useState<Position>({ x: 0, y: 0 });
  const [rotation, setRotation] = useState(0);
  const [scaleX, setScaleX] = useState(1);

  const isPanningRef = useRef(false);
  const lastPosRef = useRef<Position>({ x: 0, y: 0 });

  const handleZoomIn = useCallback(() => {
    setZoom((prev) => Math.min(prev * 1.2, 5));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom((prev) => Math.max(prev / 1.2, 0.1));
  }, []);

  const handleFitScreen = useCallback(() => {
    setZoom(1);
    setStagePos({ x: 0, y: 0 });
  }, []);

  const handleWheel = useCallback((e: any, stageRef: any) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;

    const oldScale = zoom;
    const pointer = stage.getPointerPosition();

    const mousePointTo = {
      x: (pointer.x - stagePos.x) / oldScale,
      y: (pointer.y - stagePos.y) / oldScale,
    };

    const newScale = e.evt.deltaY > 0 ? oldScale / 1.1 : oldScale * 1.1;
    const bounded = Math.max(0.1, Math.min(5, newScale));

    setZoom(bounded);

    const newPos = {
      x: pointer.x - mousePointTo.x * bounded,
      y: pointer.y - mousePointTo.y * bounded,
    };
    setStagePos(newPos);
  }, [zoom, stagePos.x, stagePos.y]);

  const startPan = useCallback((pos: Position) => {
    isPanningRef.current = true;
    lastPosRef.current = pos;
  }, []);

  const movePan = useCallback((pos: Position) => {
    if (!isPanningRef.current) return false;

    const dx = pos.x - lastPosRef.current.x;
    const dy = pos.y - lastPosRef.current.y;

    // Direct update for smooth panning
    setStagePos((prev) => ({
      x: prev.x + dx,
      y: prev.y + dy,
    }));

    lastPosRef.current = pos;
    return true;
  }, []);

  const endPan = useCallback(() => {
    isPanningRef.current = false;
  }, []);

  const handleRotate = useCallback(() => {
    setRotation((prev) => (prev + 90) % 360);
  }, []);

  const handleFlip = useCallback(() => {
    setScaleX((prev) => prev * -1);
  }, []);

  const reset = useCallback(() => {
    setZoom(1);
    setStagePos({ x: 0, y: 0 });
    setRotation(0);
    setScaleX(1);
  }, []);

  const setInitialZoom = useCallback((newZoom: number) => {
    setZoom(newZoom);
  }, []);

  const setInitialZoomAndPosition = useCallback((newZoom: number, newPos: Position) => {
    setZoom(newZoom);
    setStagePos(newPos);
  }, []);

  return {
    zoom,
    stagePos,
    rotation,
    scaleX,
    isPanning: isPanningRef.current,
    handleZoomIn,
    handleZoomOut,
    handleFitScreen,
    handleWheel,
    startPan,
    movePan,
    endPan,
    handleRotate,
    handleFlip,
    reset,
    setInitialZoom,
    setInitialZoomAndPosition,
  };
};
