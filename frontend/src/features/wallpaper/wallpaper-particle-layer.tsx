import { useEffect, useRef } from 'react'
import type { WallpaperParticleKind } from './wallpaper-types'
import { runWallpaperFrameLoop } from './wallpaper-playback'

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  phase: number
  spin: number
  angle: number
  alpha: number
}

/** Particles per 1080p screen at 100%. */
const DENSITY: Record<Exclude<WallpaperParticleKind, 'none'>, number> = {
  snow: 180,
  sakura: 70,
  rain: 260,
  dust: 140,
  fireflies: 46,
}

function random(min: number, max: number) {
  return min + Math.random() * (max - min)
}

function spawn(kind: Exclude<WallpaperParticleKind, 'none'>, width: number, height: number, anywhere: boolean): Particle {
  const base = {
    x: random(0, width),
    y: anywhere ? random(0, height) : random(-height * 0.1, -8),
    phase: random(0, Math.PI * 2),
    angle: random(0, Math.PI * 2),
  }
  switch (kind) {
    case 'snow':
      return { ...base, vx: random(-8, 8), vy: random(24, 70), size: random(1.2, 3.6), spin: random(0.4, 1.2), alpha: random(0.45, 0.95) }
    case 'sakura':
      return { ...base, vx: random(10, 40), vy: random(26, 60), size: random(4, 8), spin: random(-1.6, 1.6), alpha: random(0.6, 0.95) }
    case 'rain':
      return { ...base, vx: -120, vy: random(700, 1000), size: random(10, 22), spin: 0, alpha: random(0.18, 0.4) }
    case 'dust':
      return { ...base, y: random(0, height), vx: random(-6, 6), vy: random(-6, 6), size: random(0.8, 2), spin: random(0.3, 0.9), alpha: random(0.15, 0.5) }
    case 'fireflies':
      return { ...base, y: random(height * 0.25, height), vx: random(-14, 14), vy: random(-10, 10), size: random(1.6, 3), spin: random(0.6, 1.4), alpha: 1 }
  }
}

function draw(context: CanvasRenderingContext2D, kind: Exclude<WallpaperParticleKind, 'none'>, particle: Particle) {
  switch (kind) {
    case 'snow':
    case 'dust':
      context.globalAlpha = particle.alpha * (kind === 'dust' ? 0.6 + Math.sin(particle.phase) * 0.4 : 1)
      context.fillStyle = '#ffffff'
      context.beginPath()
      context.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2)
      context.fill()
      break
    case 'sakura':
      context.globalAlpha = particle.alpha
      context.fillStyle = '#ffc4d8'
      context.save()
      context.translate(particle.x, particle.y)
      context.rotate(particle.angle)
      context.scale(1, 0.55 + Math.sin(particle.phase) * 0.35)
      context.beginPath()
      context.ellipse(0, 0, particle.size, particle.size * 0.62, 0, 0, Math.PI * 2)
      context.fill()
      context.restore()
      break
    case 'rain':
      context.globalAlpha = particle.alpha
      context.strokeStyle = '#cfe3ff'
      context.lineWidth = 1
      context.beginPath()
      context.moveTo(particle.x, particle.y)
      context.lineTo(particle.x + particle.vx * 0.02, particle.y - particle.size)
      context.stroke()
      break
    case 'fireflies': {
      const glow = 0.35 + (Math.sin(particle.phase) + 1) * 0.32
      const gradient = context.createRadialGradient(particle.x, particle.y, 0, particle.x, particle.y, particle.size * 6)
      gradient.addColorStop(0, `rgba(222, 255, 140, ${glow})`)
      gradient.addColorStop(1, 'rgba(222, 255, 140, 0)')
      context.globalAlpha = 1
      context.fillStyle = gradient
      context.beginPath()
      context.arc(particle.x, particle.y, particle.size * 6, 0, Math.PI * 2)
      context.fill()
      break
    }
  }
}

function step(kind: Exclude<WallpaperParticleKind, 'none'>, particle: Particle, seconds: number, width: number, height: number) {
  particle.phase += particle.spin * seconds * 2
  switch (kind) {
    case 'snow':
      particle.x += (particle.vx + Math.sin(particle.phase) * 14) * seconds
      particle.y += particle.vy * seconds
      break
    case 'sakura':
      particle.x += (particle.vx + Math.sin(particle.phase) * 22) * seconds
      particle.y += particle.vy * seconds
      particle.angle += particle.spin * seconds
      break
    case 'rain':
      particle.x += particle.vx * seconds
      particle.y += particle.vy * seconds
      break
    case 'dust':
    case 'fireflies':
      particle.vx += random(-20, 20) * seconds
      particle.vy += random(-20, 20) * seconds
      particle.vx = Math.max(-18, Math.min(18, particle.vx))
      particle.vy = Math.max(-14, Math.min(14, particle.vy))
      particle.x += particle.vx * seconds
      particle.y += particle.vy * seconds
      break
  }
  const margin = 24
  if (kind === 'dust' || kind === 'fireflies') {
    if (particle.x < -margin) particle.x = width + margin
    if (particle.x > width + margin) particle.x = -margin
    if (particle.y < -margin) particle.y = height + margin
    if (particle.y > height + margin) particle.y = -margin
    return false
  }
  return particle.y > height + margin || particle.x < -margin * 4 || particle.x > width + margin * 4
}

/** Drifting snow, petals, rain, dust or fireflies over the background, on one canvas. */
export function WallpaperParticleLayer({ kind, amount, width, height, pixelRatio = 1 }: {
  kind: WallpaperParticleKind
  /** 0-100 */
  amount: number
  /** Layout units (the stage's 1080p box). */
  width: number
  height: number
  pixelRatio?: number
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || kind === 'none' || amount <= 0 || width <= 0 || height <= 0) return undefined
    const context = canvas.getContext('2d')
    if (!context) return undefined
    const ratio = Math.min(2, Math.max(1, pixelRatio))
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
    const count = Math.round(DENSITY[kind] * (amount / 100) * ((width * height) / (1920 * 1080)))
    const particles = Array.from({ length: count }, () => spawn(kind, width, height, true))

    return runWallpaperFrameLoop((_now, deltaMs) => {
      const seconds = deltaMs / 1000
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.clearRect(0, 0, width, height)
      for (let index = 0; index < particles.length; index += 1) {
        if (step(kind, particles[index], seconds, width, height)) particles[index] = spawn(kind, width, height, false)
        draw(context, kind, particles[index])
      }
      context.globalAlpha = 1
    }, 100)
  }, [amount, height, kind, pixelRatio, width])

  if (kind === 'none' || amount <= 0) return null
  return <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" />
}
