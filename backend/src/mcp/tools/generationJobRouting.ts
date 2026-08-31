import { ComfyUIServerModel, WorkflowServerModel } from '../../models/ComfyUIServer';
import {
  GENERATION_QUEUE_ROUTING_TAG_PATTERN_TEXT,
  hasGenerationQueueServerRoutingTag,
  normalizeGenerationQueueRoutingTag,
  parseGenerationQueueRoutingTag,
} from '../../services/generationQueueRouting';
import type { ComfyUIServerRecord } from '../../types/comfyuiServer';
import type { GenerationQueueJobListRecord } from '../../types/generationQueue';
import type { ServiceType } from '../../types/generationHistory';

export type McpGenerationRoutingMode = 'service' | 'auto' | 'server_id' | 'server_tag';

type McpGenerationRoutingServer = Pick<
  ComfyUIServerRecord,
  'id' | 'name' | 'backend_type' | 'capacity' | 'routing_tags'
>;

export interface McpGenerationRoutingOptions {
  workflow_id: number | null;
  has_explicit_server_links: boolean;
  eligible_servers: McpGenerationRoutingServer[];
  auto_servers: McpGenerationRoutingServer[];
  tag_routes: Array<{
    tag: string;
    server_ids: number[];
    server_names: string[];
  }>;
}

function summarizeRoutingServer(server: ComfyUIServerRecord): McpGenerationRoutingServer {
  return {
    id: server.id,
    name: server.name,
    backend_type: server.backend_type,
    capacity: server.capacity,
    routing_tags: server.routing_tags ?? [],
  };
}

/** Describe the queue routing rules exposed to MCP clients. */
export function getMcpGenerationRoutingRules() {
  return {
    auto: {
      request: 'Omit both server_id and server_tag.',
      behavior: 'The queue assigns the job to an available active regular ComfyUI server allowed for the workflow, using current connectivity and free capacity.',
      modal_included: false,
    },
    server_id: {
      request: 'Provide server_id only.',
      behavior: 'The queue targets that one active server. If the workflow has explicit server links, the server must be one of them.',
    },
    server_tag: {
      request: 'Provide server_tag only.',
      behavior: 'The queue assigns the job to an active allowed server whose routing tag exactly matches after trim-and-lowercase normalization.',
      format: GENERATION_QUEUE_ROUTING_TAG_PATTERN_TEXT,
      modal_included_when_tagged: true,
    },
    constraints: [
      'server_id and server_tag are mutually exclusive.',
      'Server routing arguments are valid only for comfyui jobs.',
      'Workflow-linked servers take precedence over the global active server pool.',
    ],
  };
}

/** Resolve the active servers and tags currently available for one workflow scope. */
export function getMcpGenerationRoutingOptions(workflowId?: number | null): McpGenerationRoutingOptions {
  const activeServers = ComfyUIServerModel.findActiveServers();
  const allLinkedServers = workflowId
    ? WorkflowServerModel.findServersByWorkflow(workflowId, false) as ComfyUIServerRecord[]
    : [];
  const hasExplicitServerLinks = Boolean(workflowId && allLinkedServers.length > 0);
  const eligibleServers = hasExplicitServerLinks
    ? WorkflowServerModel.findServersByWorkflow(workflowId as number, true) as ComfyUIServerRecord[]
    : activeServers;
  const autoServers = eligibleServers.filter((server) => server.backend_type !== 'modal');
  const tagServers = new Map<string, ComfyUIServerRecord[]>();

  for (const server of eligibleServers) {
    for (const rawTag of server.routing_tags ?? []) {
      const tag = normalizeGenerationQueueRoutingTag(rawTag);
      if (!tag) continue;
      const current = tagServers.get(tag);
      if (current) current.push(server);
      else tagServers.set(tag, [server]);
    }
  }

  return {
    workflow_id: workflowId ?? null,
    has_explicit_server_links: hasExplicitServerLinks,
    eligible_servers: eligibleServers.map(summarizeRoutingServer),
    auto_servers: autoServers.map(summarizeRoutingServer),
    tag_routes: [...tagServers.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([tag, servers]) => ({
        tag,
        server_ids: servers.map((server) => server.id),
        server_names: servers.map((server) => server.name),
      })),
  };
}

/** Validate MCP routing input against the current active workflow server scope. */
export function resolveMcpGenerationRoutingInput(input: {
  serviceType: ServiceType;
  workflowId?: number | null;
  serverId?: number | null;
  serverTag?: string | null;
}) {
  const normalizedServerTag = parseGenerationQueueRoutingTag(input.serverTag, 'server_tag');

  if (input.serverId != null && normalizedServerTag !== undefined) {
    throw new Error('server_id and server_tag cannot be combined');
  }

  if (input.serviceType !== 'comfyui') {
    if (input.serverId != null || normalizedServerTag !== undefined) {
      throw new Error('server_id and server_tag are only valid for comfyui jobs');
    }
    return {
      mode: 'service' as const,
      requestedServerId: null,
      requestedServerTag: null,
      eligibleServers: [] as McpGenerationRoutingServer[],
    };
  }

  if (!input.workflowId) {
    throw new Error('workflow_id is required for ComfyUI jobs');
  }

  const options = getMcpGenerationRoutingOptions(input.workflowId);
  if (options.has_explicit_server_links && options.eligible_servers.length === 0) {
    throw new Error('This workflow has no active linked ComfyUI servers');
  }

  if (input.serverId != null) {
    const eligibleServers = options.eligible_servers.filter((server) => server.id === input.serverId);
    if (eligibleServers.length === 0) {
      throw new Error(options.has_explicit_server_links
        ? 'server_id does not identify an active server linked to this workflow'
        : 'server_id does not identify an active ComfyUI server');
    }
    return {
      mode: 'server_id' as const,
      requestedServerId: input.serverId,
      requestedServerTag: null,
      eligibleServers,
    };
  }

  if (normalizedServerTag !== undefined) {
    const eligibleServers = options.eligible_servers.filter((server) => hasGenerationQueueServerRoutingTag(server, normalizedServerTag));
    if (eligibleServers.length === 0) {
      throw new Error(options.has_explicit_server_links
        ? 'server_tag does not match any active server linked to this workflow'
        : 'server_tag does not match any active ComfyUI server');
    }
    return {
      mode: 'server_tag' as const,
      requestedServerId: null,
      requestedServerTag: normalizedServerTag,
      eligibleServers,
    };
  }

  if (options.auto_servers.length === 0) {
    throw new Error(options.has_explicit_server_links
      ? 'Automatic routing requires at least one active regular ComfyUI server linked to this workflow'
      : 'Automatic routing requires at least one active regular ComfyUI server');
  }

  return {
    mode: 'auto' as const,
    requestedServerId: null,
    requestedServerTag: null,
    eligibleServers: options.auto_servers,
  };
}

/** Describe the effective routing mode and current candidates for one queue job. */
export function describeMcpGenerationJobRouting(job: Pick<
  GenerationQueueJobListRecord,
  'service_type' | 'workflow_id' | 'requested_server_id' | 'requested_server_tag' | 'assigned_server_id'
>) {
  if (job.service_type !== 'comfyui') {
    return {
      mode: 'service' as McpGenerationRoutingMode,
      summary: `${job.service_type} uses its service queue and does not accept ComfyUI server routing arguments.`,
    };
  }

  const options = getMcpGenerationRoutingOptions(job.workflow_id);
  const requestedTag = job.requested_server_tag
    ? normalizeGenerationQueueRoutingTag(job.requested_server_tag)
    : null;
  const mode: McpGenerationRoutingMode = job.requested_server_id != null
    ? 'server_id'
    : requestedTag
      ? 'server_tag'
      : 'auto';
  const eligibleServers = mode === 'server_id'
    ? options.eligible_servers.filter((server) => server.id === job.requested_server_id)
    : mode === 'server_tag'
      ? options.eligible_servers.filter((server) => hasGenerationQueueServerRoutingTag(server, requestedTag as string))
      : options.auto_servers;
  const summary = mode === 'server_id'
    ? 'Fixed-server routing: only the requested active workflow-eligible server may run this job.'
    : mode === 'server_tag'
      ? 'Tag routing: any active workflow-eligible server with the normalized exact tag may run this job.'
      : 'Automatic routing: the queue selects an available active regular ComfyUI server using connectivity and free capacity.';

  return {
    mode,
    summary,
    requested_server_id: job.requested_server_id ?? null,
    requested_server_tag: requestedTag,
    assigned_server_id: job.assigned_server_id ?? null,
    eligible_servers: eligibleServers,
  };
}
