import type { WallpaperImageTransitionStyle } from './wallpaper-types'

export type WallpaperImageTransitionLayer = 'current' | 'previous'

export interface WallpaperImageTransitionFrame {
  opacity: number
  translateX: number
  translateY: number
  scale: number
  rotate: number
  rotateX: number
  blur: number
}

interface WallpaperImageTransitionFrameRange {
  from: WallpaperImageTransitionFrame
  to: WallpaperImageTransitionFrame
}

const WALLPAPER_IMAGE_TRANSITION_BASE_FRAME: WallpaperImageTransitionFrame = {
  opacity: 1,
  translateX: 0,
  translateY: 0,
  scale: 1,
  rotate: 0,
  rotateX: 0,
  blur: 0,
}

function createWallpaperImageTransitionFrame(overrides: Partial<WallpaperImageTransitionFrame>): WallpaperImageTransitionFrame {
  return {
    ...WALLPAPER_IMAGE_TRANSITION_BASE_FRAME,
    ...overrides,
  }
}

const WALLPAPER_IMAGE_TRANSITION_FRAMES = {
  none: {
    current: {
      from: createWallpaperImageTransitionFrame({}),
      to: createWallpaperImageTransitionFrame({}),
    },
    previous: {
      from: createWallpaperImageTransitionFrame({ opacity: 0 }),
      to: createWallpaperImageTransitionFrame({ opacity: 0 }),
    },
  },
  fade: {
    current: {
      from: createWallpaperImageTransitionFrame({ opacity: 0, scale: 1.02, blur: 3 }),
      to: createWallpaperImageTransitionFrame({}),
    },
    previous: {
      from: createWallpaperImageTransitionFrame({}),
      to: createWallpaperImageTransitionFrame({ opacity: 0, scale: 0.98, blur: 4 }),
    },
  },
  zoom: {
    current: {
      from: createWallpaperImageTransitionFrame({ opacity: 0, scale: 1.14, blur: 2 }),
      to: createWallpaperImageTransitionFrame({}),
    },
    previous: {
      from: createWallpaperImageTransitionFrame({}),
      to: createWallpaperImageTransitionFrame({ opacity: 0, scale: 0.86, blur: 3 }),
    },
  },
  slide: {
    current: {
      from: createWallpaperImageTransitionFrame({ opacity: 0, translateY: 12, scale: 0.985, blur: 2 }),
      to: createWallpaperImageTransitionFrame({}),
    },
    previous: {
      from: createWallpaperImageTransitionFrame({}),
      to: createWallpaperImageTransitionFrame({ opacity: 0, translateY: -12, scale: 1.015, blur: 4 }),
    },
  },
  blur: {
    current: {
      from: createWallpaperImageTransitionFrame({ opacity: 0, scale: 1.035, blur: 14 }),
      to: createWallpaperImageTransitionFrame({}),
    },
    previous: {
      from: createWallpaperImageTransitionFrame({}),
      to: createWallpaperImageTransitionFrame({ opacity: 0, scale: 0.97, blur: 18 }),
    },
  },
  flip: {
    current: {
      from: createWallpaperImageTransitionFrame({ opacity: 0, rotateX: -84, scale: 0.96, blur: 2 }),
      to: createWallpaperImageTransitionFrame({}),
    },
    previous: {
      from: createWallpaperImageTransitionFrame({}),
      to: createWallpaperImageTransitionFrame({ opacity: 0, rotateX: 84, scale: 1.03, blur: 4 }),
    },
  },
  shuffle: {
    current: {
      from: createWallpaperImageTransitionFrame({ opacity: 0, translateX: -12, translateY: 8, rotate: -3, scale: 0.92, blur: 4 }),
      to: createWallpaperImageTransitionFrame({}),
    },
    previous: {
      from: createWallpaperImageTransitionFrame({}),
      to: createWallpaperImageTransitionFrame({ opacity: 0, translateX: 12, translateY: -8, rotate: 3, scale: 1.05, blur: 5 }),
    },
  },
} satisfies Record<WallpaperImageTransitionStyle, Record<WallpaperImageTransitionLayer, WallpaperImageTransitionFrameRange>>

function clampWallpaperImageTransitionProgress(progress: number) {
  return Math.min(1, Math.max(0, progress))
}

function interpolateWallpaperImageTransitionMetric(start: number, end: number, progress: number) {
  return start + ((end - start) * progress)
}

export function resolveWallpaperImageTransitionFrame(
  transitionStyle: WallpaperImageTransitionStyle,
  layer: WallpaperImageTransitionLayer,
  progress: number,
): WallpaperImageTransitionFrame {
  const normalizedProgress = clampWallpaperImageTransitionProgress(progress)
  const frameRange = WALLPAPER_IMAGE_TRANSITION_FRAMES[transitionStyle][layer]

  return {
    opacity: interpolateWallpaperImageTransitionMetric(frameRange.from.opacity, frameRange.to.opacity, normalizedProgress),
    translateX: interpolateWallpaperImageTransitionMetric(frameRange.from.translateX, frameRange.to.translateX, normalizedProgress),
    translateY: interpolateWallpaperImageTransitionMetric(frameRange.from.translateY, frameRange.to.translateY, normalizedProgress),
    scale: interpolateWallpaperImageTransitionMetric(frameRange.from.scale, frameRange.to.scale, normalizedProgress),
    rotate: interpolateWallpaperImageTransitionMetric(frameRange.from.rotate, frameRange.to.rotate, normalizedProgress),
    rotateX: interpolateWallpaperImageTransitionMetric(frameRange.from.rotateX, frameRange.to.rotateX, normalizedProgress),
    blur: interpolateWallpaperImageTransitionMetric(frameRange.from.blur, frameRange.to.blur, normalizedProgress),
  }
}

export function buildWallpaperImageTransitionTransform(
  frame: WallpaperImageTransitionFrame,
  translateMode: 'translate3d' | 'translate' = 'translate3d',
) {
  const transforms = [
    frame.rotateX !== 0 ? `perspective(1200px) rotateX(${frame.rotateX}deg)` : null,
    translateMode === 'translate3d'
      ? `translate3d(${frame.translateX}px, ${frame.translateY}px, 0)`
      : frame.translateX !== 0 || frame.translateY !== 0
        ? frame.translateX === 0
          ? `translateY(${frame.translateY}px)`
          : frame.translateY === 0
            ? `translateX(${frame.translateX}px)`
            : `translate(${frame.translateX}px, ${frame.translateY}px)`
        : null,
    frame.rotate !== 0 ? `rotate(${frame.rotate}deg)` : null,
    `scale(${frame.scale})`,
  ].filter((value): value is string => Boolean(value))

  return transforms.join(' ')
}
