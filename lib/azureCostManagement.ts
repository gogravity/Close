/**
 * Azure Cost Management client
 *
 * Auth: OAuth2 client_credentials → management.azure.com
 * Scope: configurable — subscription, billing account, management group, etc.
 *
 * Typical scopes:
 *   /subscriptions/{subscriptionId}
 *   /providers/Microsoft.Billing/billingAccounts/{billingAccountId}
 *   /providers/Microsoft.Management/managementGroups/{managementGroupId}
 */
import "server-only";
import { getIntegrationSecrets } from "./settings";

export class AzureCostError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "AzureCostError";
  }
}

// ── Auth ──────────────────────────────────────────────────────────────────────

let _tokenCache: { token: string; expiresAt: number } | null = null;

async function getCredentials(): Promise<{
  tenantId: string;
  clientId: string;
  clientSecret: string;
  scope: string;
}> {
  const s = await getIntegrationSecrets("azure-cost");
  if (!s.tenantId || !s.clientId || !s.clientSecret || !s.scope) {
    throw new AzureCostError(
      "Azure Cost Management not configured — add credentials in Settings → Azure Cost Management",
      400
    );
  }
  return {
    tenantId:     s.tenantId,
    clientId:     s.clientId,
    clientSecret: s.clientSecret,
    scope:        s.scope,
  };
}

async function getToken(tenantId: string, clientId: string, clientSecret: string): Promise<string> {
  const now = Date.now();
  if (_tokenCache && _tokenCache.expiresAt > now + 30_000) return _tokenCache.token;

  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id:     clientId,
        client_secret: clientSecret,
        grant_type:    "client_credentials",
        scope:         "https://management.azure.com/.default",
      }),
      cache: "no-store",
    }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AzureCostError(`Azure auth failed (${res.status}): ${body}`, res.status);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  _tokenCache = {
    token:     data.access_token,
    expiresAt: now + (data.expires_in - 60) * 1000,
  };
  return _tokenCache.token;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type AzureCostRow = {
  name: string;
  cost: number;
  currency: string;
};

export type AzureCostResult = {
  asOfDate: string;
  timeframe: string;
  scope: string;
  totalCost: number;
  currency: string;
  rows: AzureCostRow[];
};

// ── Query builder ─────────────────────────────────────────────────────────────

type Timeframe = "BillingMonthToDate" | "MonthToDate" | "TheLastMonth" | "TheLast3Months";

/**
 * Run a Cost Management query.
 *
 * groupByDimension controls what each row represents:
 *   "SubscriptionName" — one row per Azure subscription (works with sub scope)
 *   "CustomerName"     — one row per CSP customer (works with billing account scope)
 *   "ResourceGroup"    — one row per resource group
 *   "ServiceName"      — one row per Azure service/product
 */
async function queryCosts(
  scope: string,
  token: string,
  {
    timeframe = "BillingMonthToDate",
    groupByDimension = "SubscriptionName",
  }: { timeframe?: Timeframe; groupByDimension?: string } = {}
): Promise<AzureCostRow[]> {
  const url = `https://management.azure.com${scope}/providers/Microsoft.CostManagement/query?api-version=2023-11-01`;

  const body = {
    type: "ActualCost",
    timeframe,
    dataSet: {
      granularity: "None",
      aggregation: {
        totalCost: { name: "Cost", function: "Sum" },
      },
      grouping: [
        { type: "Dimension", name: groupByDimension },
        { type: "Dimension", name: "Currency" },
      ],
      sorting: [{ name: "totalCost", direction: "Descending" }],
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new AzureCostError(
      `Azure Cost Management query failed (${res.status}): ${text}`,
      res.status
    );
  }

  const data = (await res.json()) as {
    properties: {
      columns: Array<{ name: string; type: string }>;
      rows: Array<Array<number | string>>;
      nextLink?: string;
    };
  };

  const cols = data.properties.columns.map((c) => c.name.toLowerCase());
  const costIdx     = cols.indexOf("cost");
  const nameIdx     = cols.findIndex((c) => c !== "cost" && c !== "currency");
  const currencyIdx = cols.indexOf("currency");

  const rows: AzureCostRow[] = [];
  for (const row of data.properties.rows ?? []) {
    const cost = typeof row[costIdx] === "number" ? (row[costIdx] as number) : 0;
    if (cost === 0) continue;
    rows.push({
      name:     String(nameIdx >= 0 ? row[nameIdx] : "Unknown"),
      cost:     Math.round(cost * 100) / 100,
      currency: String(currencyIdx >= 0 ? row[currencyIdx] : "USD"),
    });
  }

  // Handle pagination
  if (data.properties.nextLink) {
    const nextRes = await fetch(data.properties.nextLink, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (nextRes.ok) {
      // For simplicity, only handle one additional page
      const nextData = (await nextRes.json()) as typeof data;
      for (const row of nextData.properties.rows ?? []) {
        const cost = typeof row[costIdx] === "number" ? (row[costIdx] as number) : 0;
        if (cost === 0) continue;
        rows.push({
          name:     String(nameIdx >= 0 ? row[nameIdx] : "Unknown"),
          cost:     Math.round(cost * 100) / 100,
          currency: String(currencyIdx >= 0 ? row[currencyIdx] : "USD"),
        });
      }
    }
  }

  return rows.sort((a, b) => b.cost - a.cost);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetch Azure costs for the current billing month, grouped by the best
 * dimension for the configured scope.
 *
 * Automatically tries "CustomerName" (CSP billing account) first, then
 * falls back to "SubscriptionName" if the first query errors.
 */
export async function getAzureCosts(
  timeframe: Timeframe = "BillingMonthToDate"
): Promise<AzureCostResult> {
  const { tenantId, clientId, clientSecret, scope } = await getCredentials();
  const token = await getToken(tenantId, clientId, clientSecret);

  // Detect scope type to pick the best grouping dimension
  let groupBy = "SubscriptionName";
  if (scope.includes("billingAccounts")) groupBy = "CustomerName";
  else if (scope.includes("managementGroups")) groupBy = "SubscriptionName";

  let rows: AzureCostRow[];
  try {
    rows = await queryCosts(scope, token, { timeframe, groupByDimension: groupBy });
  } catch (err) {
    // Fall back to SubscriptionName if CustomerName isn't available for this scope
    if (groupBy !== "SubscriptionName") {
      rows = await queryCosts(scope, token, { timeframe, groupByDimension: "SubscriptionName" });
    } else {
      throw err;
    }
  }

  const totalCost = Math.round(rows.reduce((s, r) => s + r.cost, 0) * 100) / 100;
  const currency  = rows[0]?.currency ?? "USD";

  return {
    asOfDate:  new Date().toISOString().slice(0, 10),
    timeframe,
    scope,
    totalCost,
    currency,
    rows,
  };
}

/**
 * Fetch costs broken down by Azure service/product (ServiceName dimension).
 * Useful for understanding what Azure services are driving spend.
 */
export async function getAzureCostsByService(
  timeframe: Timeframe = "BillingMonthToDate"
): Promise<AzureCostResult> {
  const { tenantId, clientId, clientSecret, scope } = await getCredentials();
  const token = await getToken(tenantId, clientId, clientSecret);
  const rows  = await queryCosts(scope, token, { timeframe, groupByDimension: "ServiceName" });
  const totalCost = Math.round(rows.reduce((s, r) => s + r.cost, 0) * 100) / 100;
  return {
    asOfDate:  new Date().toISOString().slice(0, 10),
    timeframe,
    scope,
    totalCost,
    currency: rows[0]?.currency ?? "USD",
    rows,
  };
}
