export type FieldType = "text" | "secret";

export type IntegrationField = {
  key: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  help?: string;
};

export type IntegrationCategory = "gl" | "psa" | "payroll" | "spend" | "ai" | "crm";

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
      { key: "clientId", label: "Client ID", type: "secret" },
      { key: "clientSecret", label: "Client Secret", type: "secret" },
      { key: "environment", label: "Environment", type: "text", placeholder: "production or demo" },
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
    id: "anthropic",
    name: "Anthropic API",
    category: "ai",
    blurb:
      "Used for AI-assisted reconciliation explanations, anomaly detection, and journal-entry drafting.",
    docsUrl: "https://docs.claude.com/en/api/overview",
    fields: [
      { key: "apiKey", label: "API Key", type: "secret", placeholder: "sk-ant-..." },
      { key: "model", label: "Default Model", type: "text", placeholder: "claude-sonnet-4-6" },
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
};

export function getIntegration(id: string): Integration | undefined {
  return integrations.find((i) => i.id === id);
}
