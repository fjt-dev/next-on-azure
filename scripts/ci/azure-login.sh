#!/usr/bin/env bash
# Signs the Azure CLI in with GitHub's OIDC token (workload identity federation): no stored secret.
# Needs `permissions: id-token: write` and the variables AZURE_CLIENT_ID, AZURE_TENANT_ID and
# AZURE_SUBSCRIPTION_ID. Only first-party tooling is used (curl, jq, az), no third-party action.
set -euo pipefail

: "${ACTIONS_ID_TOKEN_REQUEST_URL:?id-token: write permission is missing}"
: "${ACTIONS_ID_TOKEN_REQUEST_TOKEN:?id-token: write permission is missing}"
: "${AZURE_CLIENT_ID:?}" "${AZURE_TENANT_ID:?}" "${AZURE_SUBSCRIPTION_ID:?}"

token="$(curl -sSf -H "Authorization: bearer ${ACTIONS_ID_TOKEN_REQUEST_TOKEN}" \
  "${ACTIONS_ID_TOKEN_REQUEST_URL}&audience=api://AzureADTokenExchange" | jq -r '.value')"
if [ -z "$token" ] || [ "$token" = "null" ]; then
  echo "could not obtain a GitHub OIDC token" >&2
  exit 1
fi
echo "::add-mask::${token}"

az login --service-principal --username "$AZURE_CLIENT_ID" --tenant "$AZURE_TENANT_ID" \
  --federated-token "$token" --allow-no-subscriptions --output none
az account set --subscription "$AZURE_SUBSCRIPTION_ID"
echo "signed in to subscription ${AZURE_SUBSCRIPTION_ID} as the federated identity"
