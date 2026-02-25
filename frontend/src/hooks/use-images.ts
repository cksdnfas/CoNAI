import { useQuery } from '@tanstack/react-query'
import { fetchImages } from '@/lib/api/endpoints'

export const useImages = (limit = 12) =>
  useQuery({
    queryKey: ['images', limit],
    queryFn: () => fetchImages(limit),
  })
