import "server-only";
import { getIntegrationSecrets } from "./settings";

export class HubSpotError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown
  ) {
    super(message);
    this.name = "HubSpotError";
  }
}

const HS_BASE = "https://api.hubapi.com";

// Closed-Won stage IDs by pipeline. Map comes from the MRR-Bridge prototype —
// add more entries here if additional pipelines need to be tracked.
const CLOSED_WON_STAGES: Record<string, string> = {
  default: "closedwon",
  "1188560601": "1885844155", // Lyra | Sales Pipeline
};

async function loadAccessToken(): Promise<string> {
  const secrets = await getIntegrationSecrets("hubspot");
  if (!secrets.accessToken) {
    throw new HubSpotError("HubSpot accessToken not set", 400);
  }
  return secrets.accessToken;
}

async function hsFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = await loadAccessToken();
  const res = await fetch(`${HS_BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });
  return res;
}

export type HsDeal = {
  id: string;
  properties: Record<string, string | null | undefined>;
};

export type HsLineItem = {
  name?: string;
  quantity?: string;
  price?: string;
  amount?: string;
  hs_mrr?: string;
  recurringbillingfrequency?: string;
};

/**
 * Closed-won deals across all configured pipelines, optionally filtered by
 * `closedate` in [startDate, endDate] (YYYY-MM-DD).
 */
export async function listClosedWonDeals(
  startDate?: string,
  endDate?: string
): Promise<HsDeal[]> {
  const out: HsDeal[] = [];
  for (const stageId of Object.values(CLOSED_WON_STAGES)) {
    const filters: Array<Record<string, unknown>> = [
      { propertyName: "dealstage", operator: "EQ", value: stageId },
    ];
    if (startDate) {
      filters.push({
        propertyName: "closedate",
        operator: "GTE",
        value: `${startDate}T00:00:00.000Z`,
      });
    }
    if (endDate) {
      filters.push({
        propertyName: "closedate",
        operator: "LTE",
        value: `${endDate}T23:59:59.999Z`,
      });
    }

    let after: string | undefined;
    while (true) {
      const body: Record<string, unknown> = {
        filterGroups: [{ filters }],
        properties: [
          "dealname",
          "amount",
          "closedate",
          "pipeline",
          "hs_mrr",
          "hubspot_owner_id",
        ],
        limit: 100,
      };
      if (after) body.after = after;
      const res = await hsFetch("/crm/v3/objects/deals/search", {
        method: "POST",
        body: JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) {
        let parsed: unknown = text;
        try {
          parsed = JSON.parse(text);
        } catch {
          // ignore
        }
        throw new HubSpotError(
          `HubSpot ${res.status} ${res.statusText}`,
          res.status,
          parsed
        );
      }
      const data = JSON.parse(text) as {
        results: HsDeal[];
        paging?: { next?: { after: string } };
      };
      out.push(...data.results);
      const next = data.paging?.next?.after;
      if (!next) break;
      after = next;
    }
  }
  return out;
}

async function hsGetJson<T>(path: string): Promise<T> {
  const res = await hsFetch(path);
  const text = await res.text();
  if (!res.ok) {
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // ignore
    }
    throw new HubSpotError(
      `HubSpot ${res.status} ${res.statusText}`,
      res.status,
      parsed
    );
  }
  return JSON.parse(text) as T;
}

export async function getDealLineItems(dealId: string): Promise<HsLineItem[]> {
  const assocs = await hsGetJson<{ results: Array<{ id: string }> }>(
    `/crm/v3/objects/deals/${dealId}/associations/line_items`
  );
  const items: HsLineItem[] = [];
  for (const a of assocs.results ?? []) {
    const li = await hsGetJson<{ properties: HsLineItem }>(
      `/crm/v3/objects/line_items/${a.id}?properties=name,quantity,price,amount,hs_mrr,recurringbillingfrequency`
    );
    items.push(li.properties);
  }
  return items;
}

/**
 * Monthly recurring revenue for a deal. Prefers per-line-item `hs_mrr`; falls
 * back to dividing `amount` by frequency; final fallback is the deal's own
 * `amount` property. Matches the prototype's calculation.
 */
export async function calculateDealMrr(deal: HsDeal): Promise<number> {
  const items = await getDealLineItems(deal.id);
  if (items.length > 0) {
    let total = 0;
    for (const it of items) {
      const mrr = it.hs_mrr ? Number(it.hs_mrr) : NaN;
      if (!isNaN(mrr) && mrr) {
        total += mrr;
        continue;
      }
      const amount = Number(it.amount ?? 0) || 0;
      const freq = (it.recurringbillingfrequency ?? "monthly").toLowerCase();
      if (freq === "annually") total += amount / 12;
      else if (freq === "quarterly") total += amount / 3;
      else total += amount;
    }
    return Math.round(total * 100) / 100;
  }
  const dealAmount = Number(deal.properties.amount ?? 0) || 0;
  return Math.round(dealAmount * 100) / 100;
}
