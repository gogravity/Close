# BS Recon

Balance-sheet reconciliation app for Lyra-family companies. Pulls live data
from Business Central, ConnectWise, Ramp, Gusto, and Anthropic; walks the
monthly close per section (unadjusted → adjustments → journal entries →
verification); and exports a paste-ready `.xlsx` that mirrors the master
close workbook.

Ships with **no company-identifying data**. Every API credential is stored
encrypted (AES-256-GCM) on the host and never transits a third party other
than the integration it targets.

---

## Stack

- Next.js 16 (App Router, Turbopack, standalone output)
- TypeScript, Tailwind v4
- Server Components for every outbound API call
- File-based encrypted persistence in `.data/` (gitignored)

## Integrations

| Integration | Purpose | Credentials / scopes |
|---|---|---|
| **Business Central** | Trial balance, AR/AP aging, GL entries, inventory, dimensions | Azure AD app registration with BC `app` permission; stored as tenantId / environment / companyName / clientId / clientSecret |
| **ConnectWise Manage** | Agreements, time entries, owner company info | Dedicated API member on a least-privilege `BS Recon API` role (read-only on Companies / Finance / Time / Service / Project / API Reports). Walkthrough at `/docs/connectwise-setup` |
| **Ramp** | Card statements, transactions, receipts | OAuth client credentials — `transactions:read`, `receipts:read`, `statements:read` |
| **Gusto** | Payroll accrual, PTO, benefits *(pending)* | OAuth 2.0 auth-code flow — `company_read`, `payrolls_read`, `employees_read`, `employee_benefits_read`, `employee_pay_stubs_read` |
| **Anthropic** | Bank-statement PDF extraction, future AI analysis | API key + default model |

## Quick start (local)

```bash
cd app
npm install
npm run dev
# http://localhost:3000
```

First launch redirects to `/onboarding` — connect BC and ConnectWise.
Remaining integrations go in **Settings**.

## Docker

```bash
docker build -t bs-recon ./app
docker run -d \
  -p 3000:3000 \
  -v bs-recon-data:/app/.data \
  --name bs-recon bs-recon
```

The `/app/.data` volume persists the encrypted credential store + master
key across restarts. Do not delete the volume unless you're willing to
re-enter every integration credential.

## Azure Container Apps

Full walkthrough in [`docs/deploy-azure.md`](./docs/deploy-azure.md). TL;DR:

```bash
# one-time
az group create -n bs-recon-rg -l eastus
az acr create -n bsreconacr -g bs-recon-rg --sku Basic --admin-enabled true
az containerapp env create -n bs-recon-env -g bs-recon-rg -l eastus

# build + push
az acr build -t bs-recon:latest -r bsreconacr ./app

# deploy with a persistent Azure Files volume for .data/
# (see docs/deploy-azure.md for the storage + YAML config)
az containerapp create ...
```

## Security notes

- `.data/settings.json` holds every API credential — **each secret is
  individually encrypted** (AES-256-GCM). The master key lives in
  `.data/master.key` with `0600` perms and is never logged.
- Bank-statement PDFs have PII scrubbed locally (`lib/scrubber.ts`)
  before any text is sent to Claude: full account numbers → last 4 only,
  SSNs / phones / emails / addresses / ZIPs / proper-name lines are
  replaced with `[REDACTED]` tokens. Claude sees only the scrubbed text.
- Auth retry: both BC and Ramp clients evict cached tokens and re-auth
  automatically on a 401 / scope-error 403. No restart needed when a
  scope is enabled or a secret rotates.

## Repo layout

```
app/
├── app/                          # Next.js App Router routes
│   ├── api/                      # Route handlers (BC / CW / Ramp / Anthropic)
│   ├── onboarding/               # First-run integration wizard
│   ├── section/<slug>/           # Per-section reconciliation pages
│   ├── settings/                 # API credential manager
│   ├── mapping/                  # BC account → recon section mapper
│   └── docs/connectwise-setup/   # In-app CW API member guide
├── components/
│   ├── Sidebar.tsx
│   └── SidebarNav.tsx
├── lib/
│   ├── businessCentral.ts        # BC REST client + OAuth
│   ├── connectwise.ts            # CW REST client + Basic auth
│   ├── ramp.ts                   # Ramp OAuth client-credentials + statements
│   ├── anthropic.ts              # Claude PDF extraction
│   ├── scrubber.ts               # Pre-AI PII redaction
│   ├── crypto.ts                 # AES-256-GCM for settings.json
│   ├── settings.ts               # Encrypted credential store
│   └── recon.ts                  # Section metadata + CoA template
├── Dockerfile
└── docs/
    └── deploy-azure.md
```

## License

Proprietary — internal tooling for Lyra-family companies.
