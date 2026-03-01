import fs from 'node:fs'
import path from 'node:path'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ImageItem } from '@/lib/api/types'
import { ImagesPage } from '@/features/images/images-page'

const useImagesMock = vi.fn()

vi.mock('@/hooks/use-images', () => ({
  useImages: (limit: number) => useImagesMock(limit),
}))

function makeItem(overrides: Partial<ImageItem> = {}): ImageItem {
  return {
    id: 1,
    composite_hash: 'hash-1',
    width: 640,
    height: 480,
    file_size: 2048,
    mime_type: 'image/png',
    original_file_path: '/images/1.png',
    first_seen_date: '2026-01-01T00:00:00.000Z',
    ai_tool: 'comfyui',
    model_name: 'model-a',
    ...overrides,
  }
}

describe('images-page adapter alignment', () => {
  beforeEach(() => {
    useImagesMock.mockReset()
  })

  it('renders table columns and shared preview/model/size/resolution values', () => {
    useImagesMock.mockReturnValue({
      data: {
        data: {
          images: [makeItem({ composite_hash: 'hash-preview' })],
          total: 1,
        },
      },
      isLoading: false,
    })

    render(<ImagesPage />)

    expect(screen.getByText('Thumbnail')).toBeInTheDocument()
    expect(screen.getByText('Resolution')).toBeInTheDocument()
    expect(screen.getByText('Size')).toBeInTheDocument()
    expect(screen.getByText('Model')).toBeInTheDocument()
    expect(screen.getByText('640 × 480')).toBeInTheDocument()
    expect(screen.getByText('2.0 KB')).toBeInTheDocument()
    expect(screen.getByText('model-a')).toBeInTheDocument()

    const thumbnail = screen.getByRole('img', { name: 'hash-preview' })
    expect(thumbnail.getAttribute('src')).toContain('/api/images/hash-preview/thumbnail')
  })

  it('keeps safe fallback behavior for missing model/path/hash', () => {
    useImagesMock.mockReturnValue({
      data: {
        data: {
          images: [
            makeItem({
              composite_hash: '',
              model_name: undefined,
              original_file_path: undefined,
              width: undefined,
              height: undefined,
              file_size: undefined,
            }),
          ],
          total: 1,
        },
      },
      isLoading: false,
    })

    render(<ImagesPage />)

    expect(screen.getByText('- × -')).toBeInTheDocument()
    expect(screen.queryByText('표시할 이미지가 없습니다.')).not.toBeInTheDocument()

    const preview = screen.getByRole('img', { name: '-' })
    expect(preview.getAttribute('src')).toContain('/api/images/by-path/')

    fireEvent.change(screen.getByPlaceholderText('hash / path / model'), { target: { value: 'no-match' } })
    expect(screen.getByText('표시할 이미지가 없습니다.')).toBeInTheDocument()
  })

  it('does not keep local thumbnail URL helper logic in images-page', () => {
    const sourcePath = path.resolve(process.cwd(), 'src/features/images/images-page.tsx')
    const source = fs.readFileSync(sourcePath, 'utf8')

    expect(source).not.toContain('buildThumbnailUrl(')
    expect(source).not.toContain('row.original_file_path?.toLowerCase()')
  })
})
