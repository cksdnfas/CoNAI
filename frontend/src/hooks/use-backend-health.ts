import { useQuery } from '@tanstack/react-query'
import { fetchHealth } from '@/lib/api/endpoints'

export const useBackendHealth = () =>
  useQuery({
    queryKey: ['backend-health'],
    queryFn: fetchHealth,
    refetchInterval: 15_000,
  })
