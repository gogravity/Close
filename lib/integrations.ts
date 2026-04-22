export type FieldType = "text" | "secret";

export type IntegrationField = {
  key: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  help?: string;
};

export type IntegrationCategory = "gl" | "psa" | "payroll" | "spend" | "ai" | "crm" | "distributor" | "security";

export type Integration = {
  id: string;
  name: string;
  category: IntegrationCategory;
  blurb: string;
  docsUrl?: string;
  fields: IntegrationField[];
};

export const integrations: Integration[] = [
  {
    id: "business-central",
    name: "Microsoft Dynamics 365 Business Central",
    category: "gl",
    blurb:
      "General ledger. Pulls trial balance, AR/AP subledgers, and posts adjusting journal entries.",
    docsUrl: "https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/api-reference/v2.0/",
    fields: [
      { key: "tenantId", label: "Tenant ID (Azure AD)", type: "text", placeholder: "00000000-0000-0000-0000-000000000000" },
      { key: "environmentName", label: "Environment Name", type: "text", placeholder: "Production" },
      { key: "companyName", label: "Company Name", type: "text", placeholder: "CRONUS USA, Inc." },
      { key: "clientId", label: "Client ID", type: "secret" },
      { key: "clientSecret", label: "Client Secret", type: "secret" },
    ],
  },
  {
    id: "connectwise",
    name: "ConnectWise Manage (PSA)",
    category: "psa",
    blurb:
      "Time entries, tickets, agreements. Feeds unbilled time revenue and deferred revenue (block hours).",
    docsUrl: "https://developer.connectwise.com/Products/Manage",
    fields: [
      { key: "siteUrl", label: "Site URL", type: "text", placeholder: "na.myconnectwise.net" },
      { key: "companyId", label: "Company ID", type: "text" },
      { key: "publicKey", label: "Public Key", type: "secret" },
      { key: "privateKey", label: "Private Key", type: "secret" },
      { key: "clientId", label: "Client ID", type: "secret", help: "From Developer Portal app registration" },
    ],
  },
  {
    id: "ramp",
    name: "Ramp",
    category: "spend",
    blurb: "Corporate cards + bill pay. Feeds credit card reconciliations and AP activity.",
    docsUrl: "https://docs.ramp.com/developer-api/v1/overview/introduction",
    fields: [
      {
        key: "clientId",
        label: "Client ID",
        type: "secret",
        help: "Create an OAuth app at developers.ramp.com → Developer → OAuth. Required scopes: transactions:read receipts:read statements:read",
      },
      {
        key: "clientSecret",
        label: "Client Secret",
        type: "secret",
        help: "Generated alongside the Client ID in the Ramp Developer Portal.",
      },
      {
        key: "environment",
        label: "Environment",
        type: "text",
        placeholder: "production",
        help: "Use \"production\" for api.ramp.com (live cards) or \"demo\" for demo-api.ramp.com (Ramp sandbox).",
      },
    ],
  },
  {
    id: "gusto",
    name: "Gusto",
    category: "payroll",
    blurb:
      "Payroll runs, PTO balances, employer taxes. Feeds payroll accrual and PTO accrual.",
    docsUrl: "https://docs.gusto.com/embedded-payroll/docs/getting-started",
    fields: [
      { key: "companyUuid", label: "Company UUID", type: "text" },
      { key: "accessToken", label: "Access Token", type: "secret" },
    ],
  },
  {
    id: "hubspot",
    name: "HubSpot",
    category: "crm",
    blurb:
      "CRM pipeline. Feeds signed-not-onboarded MRR (closed-won deals not yet billed through BC/CW) into the MRR bridge.",
    docsUrl: "https://developers.hubspot.com/docs/api/overview",
    fields: [
      {
        key: "accessToken",
        label: "Private App Access Token",
        type: "secret",
        placeholder: "pat-...",
        help: "HubSpot Private App with crm.objects.deals.read + crm.objects.line_items.read scopes",
      },
    ],
  },
  {
    id: "pax8",
    name: "Pax8",
    category: "distributor",
    blurb:
      "Cloud distribution platform. Pulls monthly invoices, line items, and active subscriptions for billing reconciliation and per-client cost breakdown.",
    docsUrl: "https://developer.pax8.com/",
    fields: [
      { key: "clientId",     label: "Client ID",     type: "secret", help: "OAuth2 client ID from the Pax8 Developer Portal" },
      { key: "clientSecret", label: "Client Secret", type: "secret", help: "OAuth2 client secret from the Pax8 Developer Portal" },
    ],
  },
  {
    id: "ironscales",
    name: "Ironscales",
    category: "security",
    blurb:
      "AI-powered email security. Pulls per-company mailbox counts and plan types for seat reconciliation against Pax8 billing.",
    docsUrl: "https://ironscales.com/",
    fields: [
      { key: "apiKey", label: "API Key", type: "secret", help: "Partner API key from the Ironscales partner portal" },
    ],
  },
  {
    id: "anthropic",
    name: "Anthropic API",
    category: "ai",
    blurb:
      "Claude API. Currently used for bank statement PDF parsing in the Cash reconciliation section — extracts ending balance, outstanding checks, and deposits in transit.",
    docsUrl: "https://docs.anthropic.com/en/api/getting-started",
    fields: [
      {
        key: "apiKey",
        label: "API Key",
        type: "secret",
        placeholder: "sk-ant-...",
        help: "Create at console.anthropic.com → API Keys. The key is only shown once — copy it immediately.",
      },
      {
        key: "model",
        label: "Model",
        type: "text",
        placeholder: "claude-sonnet-4-6",
        help: "Defaults to claude-sonnet-4-6 if left blank. See docs.anthropic.com/en/docs/about-claude/models for available model IDs.",
      },
    ],
  },
];

export const categoryLabels: Record<IntegrationCategory, string> = {
  gl: "General Ledger",
  psa: "Professional Services Automation",
  payroll: "Payroll",
  spend: "Spend Management",
  crm: "CRM",
  ai: "AI",
  distributor: "Distribution",
  security: "Security",
};

export function getIntegration(id: string): Integration | undefined {
  return integrations.find((i) => i.id === id);
}
