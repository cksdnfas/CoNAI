import * as iq from 'image-q'
import { applyImageToPixelStylePalette, boostPixelPreviewEdges, sharpenPixelPreview, type PixelPreviewProfile } from './image-detail-pixel-preview-utils'

type PixelPreviewWorkerRequest = {
  imageData: ImageData
  profile: Pick<PixelPreviewProfile, 'colorCount' | 'ditherStrength' | 'edgeBoost' | 'sharpness'>
}

type PixelPreviewWorkerResponse = {
  imageData: ImageData
  warning?: string
}

/** Run expensive pixel preview palette work away from the React/UI thread. */
self.onmessage = (event: MessageEvent<PixelPreviewWorkerRequest>) => {
  const { imageData, profile } = event.data
  let outputImageData = imageData
  let warning: string | undefined

  try {
    const sourceContainer = iq.utils.PointContainer.fromImageData(outputImageData)
    const palette = iq.buildPaletteSync([sourceContainer], {
      colors: profile.colorCount,
      colorDistanceFormula: 'euclidean-bt709-noalpha',
      paletteQuantization: 'wuquant',
    })
    outputImageData = applyImageToPixelStylePalette(
      outputImageData,
      palette.getPointContainer().getPointArray().map((point) => ({ r: point.r, g: point.g, b: point.b })),
      profile.ditherStrength,
    )
  } catch (error) {
    warning = error instanceof Error ? error.message : 'Unknown pixel preview worker error.'
  }

  const processedImageData = sharpenPixelPreview(boostPixelPreviewEdges(outputImageData, profile.edgeBoost), profile.sharpness)
  const response: PixelPreviewWorkerResponse = { imageData: processedImageData, warning }
  self.postMessage(response)
}
