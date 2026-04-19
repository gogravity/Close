import "server-only";
import { getIntegrationSecrets } from "./settings";

export class ConnectWiseError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown
  ) {
    super(message);
    this.name = "ConnectWiseError";
  }
}

type CwCredentials = {
  siteUrl: string;
  companyId: string;
  publicKey: string;
  privateKey: string;
  clientId: string;
};

async function loadCredentials(): Promise<CwCredentials> {
  const secrets = await getIntegrationSecrets("connectwise");
  const required = ["siteUrl", "companyId", "publicKey", "privateKey", "clientId"] as const;
  for (const k of required) {
    if (!secrets[k]) throw new ConnectWiseError(`Missing ConnectWise credential: ${k}`, 400);
  }
  return secrets as CwCredentials;
}

function buildAuthHeader(creds: CwCredentials): string {
  const userPart = `${creds.companyId}+${creds.publicKey}`;
  const token = Buffer.from(`${userPart}:${creds.privateKey}`).toString("base64");
  return `Basic ${token}`;
}

function normalizeHost(siteUrl: string): string {
  // Accept any of: "na.myconnectwise.net", "https://na.myconnectwise.net",
  // or a full API URL like "https://na.myconnectwise.net/v4_6_release/apis/3.0".
  // We always want just the host.
  const trimmed = siteUrl.trim().replace(/^https?:\/\//i, "");
  const slashIdx = trimmed.indexOf("/");
  return slashIdx === -1 ? trimmed : trimmed.slice(0, slashIdx);
}

export async function cwGet<T = unknown>(pathAndQuery: string): Promise<T> {
  const creds = await loadCredentials();
  const host = normalizeHost(creds.siteUrl);
  const url = `https://${host}/v4_6_release/apis/3.0${pathAndQuery}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: buildAuthHeader(creds),
      clientId: creds.clientId,
      Accept: "application/vnd.connectwise.com+json; version=2020.1",
    },
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) {
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // keep as text
    }
    throw new ConnectWiseError(`CW ${res.status} ${res.statusText}`, res.status, body);
  }
  return JSON.parse(text) as T;
}

export type CwSystemInfo = {
  version: string;
  isCloud: boolean;
  serverTimeZone: string;
  cloudRegion?: string;
  licenseBits: { name: string; activeFlag: boolean }[];
};

export async function getSystemInfo(): Promise<CwSystemInfo> {
  return cwGet<CwSystemInfo>("/system/info");
}

export type CwCompanyRow = {
  id: number;
  identifier: string;
  name: string;
};

/**
 * Lightweight reachability check used by the settings "Test" button.
 * Confirms the key pair can authenticate and list at least one company.
 */
export async function pingCompanies(): Promise<number> {
  const rows = await cwGet<CwCompanyRow[]>(
    "/company/companies?pageSize=1&fields=id"
  );
  return rows.length;
}
