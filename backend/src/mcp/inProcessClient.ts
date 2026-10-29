import { Client } from '@modelcontextprotocol/client'

/** The current SDK always installs a request timer; zero here means no deadline for an in-process tool call. */
export const NO_TOOL_DEADLINE = 0

export function inProcessMcpClient(info: { name: string; version: string }) {
  const client = new Client(info)
  // SDK 2.3's timeout hook is private and has no public "none" option. Leave normal handshake/list timeouts intact.
  const protocol = client as unknown as {
    _setupTimeout: (id: number | string, timeout: number, maxTotal: number | undefined, onTimeout: () => void, reset: boolean) => void
  }
  const setup = protocol._setupTimeout.bind(client)
  protocol._setupTimeout = (id, timeout, maxTotal, onTimeout, reset) => {
    if (timeout !== NO_TOOL_DEADLINE) setup(id, timeout, maxTotal, onTimeout, reset)
  }
  return client
}
