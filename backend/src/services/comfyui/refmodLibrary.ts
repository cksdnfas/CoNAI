import axios from 'axios';
import {
  MINIMAX_H3_REFMOD_LIBRARY_PATH,
  parseMiniMaxH3RefModLibraryEntry,
  type MiniMaxH3RefModLibraryEntry,
} from '@conai/shared';
import type { ComfyUIServerRecord } from '../../types/comfyuiServer';

export class MiniMaxH3RefModLibraryError extends Error {
  constructor(message: string, readonly statusCode: 404 | 502) {
    super(message);
    this.name = 'MiniMaxH3RefModLibraryError';
  }
}

export async function fetchMiniMaxH3RefModLibrary(server: ComfyUIServerRecord): Promise<MiniMaxH3RefModLibraryEntry[]> {
  // Modal backends expose no ComfyUI REST routes; probing would only wake a container.
  if (server.backend_type === 'modal') {
    throw new MiniMaxH3RefModLibraryError(`RefMod library is not available on Modal server "${server.name}"; use a standard ComfyUI server.`, 404);
  }
  try {
    const response = await axios.get<unknown>(MINIMAX_H3_REFMOD_LIBRARY_PATH, {
      baseURL: server.endpoint,
      timeout: 15_000,
      headers: { Accept: 'application/json' },
    });
    if (!Array.isArray(response.data)) throw new Error('Expected a JSON array from the RefMod library');
    return response.data.map(parseMiniMaxH3RefModLibraryEntry)
      .filter((entry): entry is MiniMaxH3RefModLibraryEntry => entry !== null);
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      throw new MiniMaxH3RefModLibraryError(`DaSiWa pack is not installed on ComfyUI server "${server.name}" (${MINIMAX_H3_REFMOD_LIBRARY_PATH} returned 404).`, 404);
    }
    throw new MiniMaxH3RefModLibraryError(`Failed to fetch MiniMax H3 RefMod library from "${server.name}": ${error instanceof Error ? error.message : String(error)}`, 502);
  }
}
