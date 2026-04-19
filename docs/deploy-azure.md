# Deploying to Azure Container Apps

This guide covers a production-grade deployment: Azure Container Registry
for the image, Azure Container Apps for the runtime, Azure Files for
persistent `.data/` storage, and (optionally) a user-assigned managed
identity to bootstrap credentials from Azure Key Vault on first start.

## Prerequisites

- `az` CLI ≥ 2.70, logged in to the target tenant
- `containerapp` extension installed — `az extension add -n containerapp`
- A resource group in the region you want to deploy to
- The `gravity-shared-kv` Key Vault already holds the integration secrets
  (or the equivalent in your tenant)

## 1. Create the infrastructure

```bash
# pick a name prefix + location
NAME=bs-recon
RG=${NAME}-rg
LOC=eastus

az group create -n $RG -l $LOC

# Container Registry (Basic SKU is enough; Private if you need VNet)
az acr create -n ${NAME}acr -g $RG --sku Basic --admin-enabled true

# Container Apps environment
az containerapp env create -n ${NAME}-env -g $RG -l $LOC

# Storage account for the .data volume
az storage account create \
  -n ${NAME//-/}sa -g $RG -l $LOC --sku Standard_LRS
az storage share-rm create \
  -g $RG --storage-account ${NAME//-/}sa \
  -n ${NAME}-data --quota 1
```

## 2. Build and push the image

```bash
# ACR Tasks builds remotely — faster than local + push
az acr build -t ${NAME}:latest -r ${NAME}acr ./app
```

## 3. Register the Azure Files volume in the Container Apps environment

```bash
STORAGE_KEY=$(az storage account keys list -g $RG -n ${NAME//-/}sa \
  --query "[0].value" -o tsv)

az containerapp env storage set \
  -g $RG -n ${NAME}-env \
  --storage-name ${NAME}-data \
  --azure-file-account-name ${NAME//-/}sa \
  --azure-file-account-key "$STORAGE_KEY" \
  --azure-file-share-name ${NAME}-data \
  --access-mode ReadWrite
```

## 4. Deploy the container app

```bash
ACR_LOGIN=$(az acr show -n ${NAME}acr --query loginServer -o tsv)
ACR_USER=$(az acr credential show -n ${NAME}acr --query username -o tsv)
ACR_PASS=$(az acr credential show -n ${NAME}acr --query "passwords[0].value" -o tsv)

az containerapp create \
  -g $RG -n ${NAME} \
  --environment ${NAME}-env \
  --image ${ACR_LOGIN}/${NAME}:latest \
  --registry-server $ACR_LOGIN \
  --registry-username $ACR_USER \
  --registry-password $ACR_PASS \
  --target-port 3000 \
  --ingress external \
  --min-replicas 1 --max-replicas 1 \
  --cpu 0.5 --memory 1.0Gi
```

> **Single replica only.** The app's credential store is file-based
> (`.data/settings.json` encrypted with a local master key). Running more
> than one replica against the same Azure Files share can race on writes.
> Scale-out would require moving the store to a shared secret backend
> (Key Vault, Azure App Configuration with customer-managed keys, etc.).

## 5. Mount the `.data` volume

Container Apps needs a YAML tweak to mount the Azure Files share at
`/app/.data`. Fetch the current config, edit, and reapply:

```bash
az containerapp show -g $RG -n $NAME -o yaml > containerapp.yaml

# Edit containerapp.yaml — under properties.template.containers[0] add:
#   volumeMounts:
#     - mountPath: /app/.data
#       volumeName: data
# And under properties.template add:
#   volumes:
#     - name: data
#       storageName: bs-recon-data
#       storageType: AzureFile

az containerapp update -g $RG -n $NAME --yaml containerapp.yaml
```

## 6. Bootstrap credentials

You have two options:

### Option A — Enter credentials via the UI on first launch

1. Open the Container App's ingress URL
2. You'll land at `/onboarding` — connect BC + CW
3. Go to **Settings** and fill in Ramp + Gusto + Anthropic

The encrypted `.data/settings.json` is written to the mounted Azure Files
share and persists across restarts and rolling deploys.

### Option B — Prime from Key Vault (recommended for shared tenants)

Attach a user-assigned managed identity and grant it `get` on the Key
Vault that holds the integration secrets. Then POST those values through
`/api/settings` on first boot via a startup hook or manual `curl`:

```bash
# once the app is up, exec from cloud shell:
INGRESS=https://$(az containerapp show -g $RG -n $NAME --query properties.configuration.ingress.fqdn -o tsv)

# fetch each secret from KV, POST to /api/settings
for kv_name in bc-tenant-id bc-environment bc-client-id bc-client-secret \
               cw-client-id cw-url cw-company-id \
               ramp-client-id ramp-client-secret anthropic-api-key; do
  value=$(az keyvault secret show --vault-name gravity-shared-kv \
          --name $kv_name --query value -o tsv)
  # ...build the JSON body, curl POST $INGRESS/api/settings
done
```

See the repo's root bootstrap script (not yet checked in) for the
full shape of this payload.

## 7. Custom domain + HTTPS

```bash
az containerapp hostname add -g $RG -n $NAME \
  --hostname close.yourdomain.com
az containerapp hostname bind -g $RG -n $NAME \
  --hostname close.yourdomain.com --validation-method CNAME
```

Managed certificates renew automatically.

## 8. Rolling updates

```bash
# rebuild + push a new tag
az acr build -t ${NAME}:$(git rev-parse --short HEAD) -r ${NAME}acr ./app
az containerapp update -g $RG -n $NAME \
  --image ${ACR_LOGIN}/${NAME}:$(git rev-parse --short HEAD)
```

Container Apps does zero-downtime rolling revisions by default. The old
revision keeps serving traffic until the new one passes health checks.

## Troubleshooting

- **Container won't start** — `az containerapp logs show -g $RG -n $NAME --follow`
- **`.data` writes fail** — verify the Azure Files share is mounted:
  `az containerapp exec -g $RG -n $NAME --command "ls -la /app/.data"`
- **403 on Ramp receipts** — the scope wasn't enabled when the cached
  token was issued. The app auto-retries after scope changes, but you can
  force-evict by restarting the container:
  `az containerapp revision restart -g $RG -n $NAME --revision <active>`

## Cost estimate

Baseline (1 replica, 0.5 vCPU / 1 GiB, ~100 requests/day):
- Container Apps: ~$25/month
- Azure Files (1 GB): ~$0.06/month
- ACR Basic: ~$5/month
- **Total: ~$30/month**
