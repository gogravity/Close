<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Deployment rules — read before touching anything in .github/workflows/

## All credentials come from Azure Key Vault. No exceptions.
- The Container App has `AZURE_KEY_VAULT_NAME` set directly in Azure.
- `lib/keyVault.ts` reads all secrets at runtime via managed identity.
- `lib/integrations.ts` maps each field to its KV secret name.
- **Never add credentials, API keys, or secrets to the workflow file.**
- **Never add `--set-env-vars` to `az containerapp update`.** It overwrites the KV env var and breaks auth for every integration.

## The deployment workflow does exactly one thing: swap the image.
To change env vars or KV config: Azure Portal → bs-recon Container App → Settings.
To add a new integration credential: add the secret to Key Vault, add the field to `lib/integrations.ts` with the correct `vaultSecretName`.
