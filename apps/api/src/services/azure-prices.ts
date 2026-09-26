/**
 * Kostenschaetzung fuer VM-Groessen aus der oeffentlichen Azure-Preisliste
 * (prices.azure.com, ohne Anmeldung). Listenpreis Pay-as-you-go in EUR,
 * einen Tag im Speicher gehalten. Rabatte, Reservierungen und Hybrid
 * Benefit sind nicht enthalten; die Schaetzung dient der Einordnung.
 */

import type { VmCostEstimate } from '@zerostress/types';

const PRICES_URL = 'https://prices.azure.com/api/retail/prices';
const TTL_MS = 24 * 60 * 60 * 1000;
const HOURS_PER_MONTH = 730;

interface PriceItem {
  retailPrice?: number;
  unitOfMeasure?: string;
  productName?: string;
  skuName?: string;
  armSkuName?: string;
  type?: string;
  currencyCode?: string;
}

const cache = new Map<string, { value: VmCostEstimate | null; at: number }>();

function escapeOData(value: string): string {
  return value.replace(/'/g, "''");
}

export async function estimateVmCost(vmSize: string, location: string, osType: 'Windows' | 'Linux', fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<VmCostEstimate | null> {
  if (!/^[A-Za-z0-9_]{3,40}$/.test(vmSize) || !/^[a-z0-9]{3,30}$/.test(location)) return null;
  const key = `${vmSize}|${location}|${osType}`;
  const cached = cache.get(key);
  if (cached && now - cached.at < TTL_MS) return cached.value;
  try {
    const filter = `serviceName eq 'Virtual Machines' and armRegionName eq '${escapeOData(location)}' and armSkuName eq '${escapeOData(vmSize)}' and priceType eq 'Consumption'`;
    const res = await fetchImpl(`${PRICES_URL}?api-version=2023-01-01-preview&currencyCode='EUR'&$filter=${encodeURIComponent(filter)}`);
    if (!res.ok) throw new Error(`prices.azure.com antwortete mit ${res.status}`);
    const body = (await res.json()) as { Items?: PriceItem[] };
    const items = (body.Items ?? []).filter((i) => typeof i.retailPrice === 'number' && /hour/i.test(i.unitOfMeasure ?? '') && !/Spot|Low Priority/i.test(i.skuName ?? ''));
    // Windows-Preise tragen "Windows" im Produktnamen, Linux-Preise nicht
    const match = items.find((i) => (osType === 'Windows' ? /Windows/i.test(i.productName ?? '') : !/Windows/i.test(i.productName ?? '')));
    const value: VmCostEstimate | null = match
      ? { vmSize, location, currency: match.currencyCode ?? 'EUR', hourly: match.retailPrice as number, monthly: Math.round((match.retailPrice as number) * HOURS_PER_MONTH * 100) / 100, productName: match.productName ?? 'Virtual Machines', retrievedAt: new Date(now).toISOString() }
      : null;
    cache.set(key, { value, at: now });
    return value;
  } catch {
    cache.set(key, { value: null, at: now - TTL_MS + 10 * 60 * 1000 });
    return null;
  }
}
