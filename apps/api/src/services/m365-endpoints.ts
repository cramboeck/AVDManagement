/**
 * Microsoft-365-Endpunktliste (oeffentlich, endpoints.office.com)
 *
 * Wird einmal am Tag geladen und im Speicher gehalten. Ohne Netz bleibt
 * der letzte Stand; ohne jeden Stand laeuft der Regelvorschlag ohne
 * M365-Zuordnung weiter und sagt das.
 */

import { randomUUID } from 'node:crypto';
import { parseM365Endpoints, type M365Endpoint } from '@zerostress/core';

const ENDPOINTS_URL = 'https://endpoints.office.com/endpoints/worldwide';
const VERSION_URL = 'https://endpoints.office.com/version/worldwide';
const TTL_MS = 24 * 60 * 60 * 1000;

interface Cached {
  endpoints: M365Endpoint[];
  version: string | null;
  loadedAt: number;
}

let cache: Cached | null = null;
let clientRequestId: string | null = null;

export async function getM365Endpoints(fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<{ endpoints: M365Endpoint[]; version: string | null; error: string | null }> {
  if (cache && now - cache.loadedAt < TTL_MS) return { endpoints: cache.endpoints, version: cache.version, error: null };
  // Microsoft verlangt eine feste Client-Id je Installation, um Abrufe zu zaehlen
  if (!clientRequestId) clientRequestId = randomUUID();
  try {
    const [endpointsRes, versionRes] = await Promise.all([fetchImpl(`${ENDPOINTS_URL}?clientrequestid=${clientRequestId}`), fetchImpl(`${VERSION_URL}?clientrequestid=${clientRequestId}`)]);
    if (!endpointsRes.ok) throw new Error(`endpoints.office.com antwortete mit ${endpointsRes.status}`);
    const endpoints = parseM365Endpoints(await endpointsRes.json());
    let version: string | null = null;
    if (versionRes.ok) {
      const v = (await versionRes.json()) as { latest?: string };
      version = v.latest ?? null;
    }
    cache = { endpoints, version, loadedAt: now };
    return { endpoints, version, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (cache) return { endpoints: cache.endpoints, version: cache.version, error: message };
    return { endpoints: [], version: null, error: message };
  }
}
