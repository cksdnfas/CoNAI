const AVATAR_SIZE_PX = 128
const BACKGROUND_MAX_SIDE_PX = 1600

/** Draw a picked image onto a canvas and return it as a WebP data URL. */
function drawImageFile(file: File, draw: (image: HTMLImageElement, canvas: HTMLCanvasElement) => void, quality: number) {
  return new Promise<string>((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      draw(image, canvas)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/webp', quality))
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('image'))
    }
    image.src = url
  })
}

/** Square-crop and shrink a picked image to a small WebP data URL for an avatar. */
export function readAvatarFile(file: File) {
  return drawImageFile(file, (image, canvas) => {
    const side = Math.min(image.naturalWidth, image.naturalHeight)
    canvas.width = AVATAR_SIZE_PX
    canvas.height = AVATAR_SIZE_PX
    canvas.getContext('2d')?.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, AVATAR_SIZE_PX, AVATAR_SIZE_PX)
  }, 0.85)
}

/** Shrink a picked image to a WebP data URL of at most 1600px on its long side, for a chat background. */
export function readBackgroundFile(file: File) {
  return drawImageFile(file, (image, canvas) => {
    const scale = Math.min(1, BACKGROUND_MAX_SIDE_PX / Math.max(image.naturalWidth, image.naturalHeight))
    canvas.width = Math.round(image.naturalWidth * scale)
    canvas.height = Math.round(image.naturalHeight * scale)
    canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height)
  }, 0.82)
}
