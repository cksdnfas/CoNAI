import type { ComfyUIServerRecord, ComfyUIServerRuntimeStatus } from '../../types/comfyuiServer';
import { ComfyUIService } from '../comfyuiService';
import { resolveAxiosErrorMessage } from './errors';
import { buildRuntimeStatusError, buildUnprobedModalRuntimeStatus } from './runtimeStatus';

/**
 * Collect runtime occupancy status for multiple ComfyUI servers in parallel.
 */
export async function getComfyUIServerRuntimeStatuses(servers: ComfyUIServerRecord[]): Promise<ComfyUIServerRuntimeStatus[]> {
  const results = await Promise.allSettled(
    servers.map(async (server) => {
      if (server.backend_type === 'modal') {
        return buildUnprobedModalRuntimeStatus(server);
      }

      const comfyService = new ComfyUIService(server.endpoint, {
        backendType: server.backend_type,
        capacity: server.capacity,
      });
      return comfyService.getRuntimeStatus(server);
    })
  );

  return results.map((result, index) => {
    const server = servers[index];
    if (result.status === 'fulfilled') {
      return result.value;
    }

    return buildRuntimeStatusError({
      serverMeta: server,
      apiEndpoint: server.endpoint,
      backendType: server.backend_type,
      capacity: server.capacity,
      startedAt: undefined,
      observedAt: new Date().toISOString(),
      errorMessage: resolveAxiosErrorMessage(result.reason),
    });
  });
}
