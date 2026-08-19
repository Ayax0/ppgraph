// Environment discovery. This is what makes the tool usable without any configuration file: one
// call returns every environment the signed-in account can see, with its Dataverse URL attached.
import { RESOURCE, apiGetAll } from './http.js';
import { getToken, tokenError } from './auth.js';
import type { DiscoveredEnvironment } from '../types.js';

const FLOW_API = 'https://api.flow.microsoft.com/providers/Microsoft.ProcessSimple';

interface FlowApiEnvironment {
  name: string;
  properties?: {
    displayName?: string;
    isDefault?: boolean;
    environmentSku?: string;
    linkedEnvironmentMetadata?: {
      instanceUrl?: string;
      instanceApiUrl?: string;
    };
  };
}

export async function listEnvironments(tenantId?: string): Promise<DiscoveredEnvironment[]> {
  const token = await getToken(RESOURCE.flow, tenantId);
  if (!token) {
    throw new Error(`Cannot list environments: no token (${tokenError(RESOURCE.flow)}).`);
  }

  const listed = await apiGetAll<FlowApiEnvironment>(`${FLOW_API}/environments?api-version=2016-11-01`, token);
  return listed
    .map((entry): DiscoveredEnvironment => ({
      environmentId: entry.name,
      name: entry.properties?.displayName ?? entry.name,
      isDefault: Boolean(entry.properties?.isDefault),
      sku: entry.properties?.environmentSku,
      dataverseUrl: dataverseUrlOf(entry),
    }))
    // Named environments first, the default last — the default is rarely the one being asked about.
    .sort((a, b) => Number(a.isDefault) - Number(b.isDefault) || a.name.localeCompare(b.name, 'en'));
}

/**
 * Both URLs the API offers work against the Web API and both accept a token of their own (verified),
 * but `instanceUrl` is the plain org URL people recognise from `pac env list`, so it wins.
 */
function dataverseUrlOf(entry: FlowApiEnvironment): string | undefined {
  const meta = entry.properties?.linkedEnvironmentMetadata;
  const url = meta?.instanceUrl ?? meta?.instanceApiUrl;
  return url ? url.replace(/\/+$/, '') : undefined;
}

/** Match by environment id first, then by exact display name, then by a substring of it. */
export function resolveDiscovered(
  environments: DiscoveredEnvironment[],
  wanted: string | undefined,
): DiscoveredEnvironment | null {
  if (!wanted) return null;
  const needle = wanted.toLowerCase();
  return environments.find((entry) => entry.environmentId.toLowerCase() === needle)
    ?? environments.find((entry) => entry.name.toLowerCase() === needle)
    ?? environments.find((entry) => entry.name.toLowerCase().includes(needle))
    ?? null;
}
