import { useQuery } from '@tanstack/react-query'
import { fetchSettings } from '@/lib/api/endpoints'

export const useSettings = () =>
  useQuery({
    queryKey: ['settings'],
    queryFn: fetchSettings,
  })
