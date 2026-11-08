// Next.js on Azure (next-on-azure, ADR-0016/0017): one Function app (Flex Consumption) with Blob and
// Table Storage, and Azure Front Door as an optional extra.
//
//   Without Front Door (default):   client ──▶ Function app ──▶ Storage
//   With    Front Door:             client ──▶ Front Door ──▶ Function app ──▶ Storage
//
// The Function app has one function, `server` ({*path}): it forwards every request, static files
// included, to the Next.js server that runs in the same worker. Cache entries and tags live in
// Storage (container `cache`, table `tagcache`).
// Verified on Azure for the spike (2026-11-08) with the template of the previous package; this
// simplified template was not deployed yet.

targetScope = 'resourceGroup'

@description('Base name used to derive resource names (3-12 lowercase letters/digits).')
@minLength(3)
@maxLength(12)
param name string

param location string = resourceGroup().location

@description('Put Azure Front Door in front of the app. Adds a recurring base fee (Standard: 35 USD/month per profile, list price) and restricts direct access to the Function app.')
param frontDoor bool = false

@description('Node.js runtime version supported by Flex Consumption.')
@allowed(['22', '24'])
param nodeVersion string = '22'

@description('Instance memory (MB). Must cover SSR and sharp image processing, which share the instance.')
@allowed([512, 2048, 4096])
param instanceMemoryMB int = 2048

@description('Upper bound on instances. Set explicitly: the platform default is very large.')
@minValue(1)
@maxValue(1000)
param maximumInstanceCount int = 20

@description('Send every telemetry item to Application Insights instead of a sample. Costs more with traffic. Useful when counting invocations in a measurement; requests are never sampled either way.')
param fullTelemetry bool = false

@description('Always-ready instances for HTTP (0 = scale to zero, with cold starts). Billed continuously.')
@minValue(0)
param alwaysReadyInstances int = 0

@description('What happens to deferred work (after(), queue enqueues) when the response is complete. "hold" keeps the response open until the work is done (safe, the client waits). "detach" ends the response at once and lets the work run in the background (see ADR-0006 for what is known about the platform).')
@allowed(['hold', 'detach'])
param waitUntilMode string = 'hold'

var suffix = uniqueString(resourceGroup().id, name)
var storageName = toLower('st${take(name, 8)}${take(suffix, 8)}')
var tableName = 'tagcache'

var roles = {
  blobOwner: 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b'
  blobContributor: 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
  queueContributor: '974c5e8b-45b9-4653-ba55-5f855dd0fb88'
  tableContributor: '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3'
}

// ---------------------------------------------------------------- Storage
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  kind: 'StorageV2'
  sku: { name: 'Standard_LRS' }
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowSharedKeyAccess: false // identity-based access only
    allowBlobPublicAccess: false // everything is served by the app
    defaultToOAuthAuthentication: true
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource cache 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'cache'
  properties: { publicAccess: 'None' }
}

resource deployContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'deploy-app'
  properties: { publicAccess: 'None' }
}

resource tableService 'Microsoft.Storage/storageAccounts/tableServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource tagCacheTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' = {
  parent: tableService
  name: tableName
}

// ------------------------------------------------------------ Monitoring
resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-${name}-${suffix}'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

resource insights 'Microsoft.Insights/components@2020-02-02' = {
  name: 'appi-${name}-${suffix}'
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logs.id
    DisableLocalAuth: false
  }
}

// ---------------------------------------------------- Front Door profile
// Declared before the app because the app needs its id (X-Azure-FDID check and access restriction).
resource profile 'Microsoft.Cdn/profiles@2024-02-01' = if (frontDoor) {
  name: 'afd-${name}-${suffix}'
  location: 'global'
  sku: { name: 'Standard_AzureFrontDoor' }
}

var frontDoorId = frontDoor ? profile!.properties.frontDoorId : ''

// ------------------------------------------------------------ Function app
resource plan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: 'plan-${name}-${suffix}'
  location: location
  kind: 'functionapp'
  sku: {
    tier: 'FlexConsumption'
    name: 'FC1'
  }
  properties: { reserved: true }
}

resource app 'Microsoft.Web/sites@2024-04-01' = {
  name: 'func-${name}-${suffix}'
  location: location
  kind: 'functionapp,linux'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    functionAppConfig: {
      deployment: {
        storage: {
          type: 'blobContainer'
          value: '${storage.properties.primaryEndpoints.blob}${deployContainer.name}'
          authentication: { type: 'SystemAssignedIdentity' }
        }
      }
      scaleAndConcurrency: {
        maximumInstanceCount: maximumInstanceCount
        instanceMemoryMB: instanceMemoryMB
        alwaysReady: alwaysReadyInstances > 0 ? [
          {
            name: 'http'
            instanceCount: alwaysReadyInstances
          }
        ] : []
      }
      runtime: {
        name: 'node'
        version: nodeVersion
      }
    }
    siteConfig: {
      // Unverified on Flex Consumption: with Front Door, accept only its backend IPs carrying our profile id.
      ipSecurityRestrictions: frontDoor ? [
        {
          name: 'AllowFrontDoor'
          action: 'Allow'
          priority: 100
          tag: 'ServiceTag'
          ipAddress: 'AzureFrontDoor.Backend'
          headers: { 'x-azure-fdid': [frontDoorId] }
        }
      ] : []
      appSettings: concat([
        { name: 'AzureWebJobsStorage__accountName', value: storage.name }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: insights.properties.ConnectionString }
        // Read by the cache handlers of next-on-azure
        { name: 'AZURE_STORAGE_ACCOUNT_NAME', value: storage.name }
        { name: 'CACHE_CONTAINER_NAME', value: cache.name }
        { name: 'CACHE_TABLE_NAME', value: tagCacheTable.name }
        { name: 'WAIT_UNTIL_MODE', value: waitUntilMode }
        // Large request bodies / Server Actions
        { name: 'FUNCTIONS_REQUEST_BODY_SIZE_LIMIT', value: '104857600' }
      ], fullTelemetry ? [
        // Overrides host.json logging.applicationInsights.samplingSettings.isEnabled
        {
          name: 'AzureFunctionsJobHost__logging__applicationInsights__samplingSettings__isEnabled'
          value: 'false'
        }
      ] : [], frontDoor ? [
        // The Functions entry rejects requests whose X-Azure-FDID differs
        { name: 'FRONT_DOOR_ID', value: frontDoorId }
      ] : [])
    }
  }
}

// Data-plane RBAC for the app's managed identity
resource blobRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: storage
  name: guid(storage.id, app.id, roles.blobOwner)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.blobOwner)
    principalId: app.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// Kept from the previous template: the Functions host may use queues of the host storage account.
// Whether an HTTP-only app needs this role was not tested.
resource queueRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: storage
  name: guid(storage.id, app.id, roles.queueContributor)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.queueContributor)
    principalId: app.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource tableRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: storage
  name: guid(storage.id, app.id, roles.tableContributor)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.tableContributor)
    principalId: app.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// ------------------------------------------------- Front Door (optional)
resource endpoint 'Microsoft.Cdn/profiles/afdEndpoints@2024-02-01' = if (frontDoor) {
  parent: profile
  name: 'ep-${name}-${suffix}'
  location: 'global'
  properties: { enabledState: 'Enabled' }
}

resource originGroup 'Microsoft.Cdn/profiles/originGroups@2024-02-01' = if (frontDoor) {
  parent: profile
  name: 'og-app'
  properties: {
    loadBalancingSettings: {
      sampleSize: 4
      successfulSamplesRequired: 3
    }
    // No active probing: one origin, and a probe would only add cost and cold starts.
    sessionAffinityState: 'Disabled'
  }
}

resource origin 'Microsoft.Cdn/profiles/originGroups/origins@2024-02-01' = if (frontDoor) {
  parent: originGroup
  name: 'origin-app'
  properties: {
    hostName: app.properties.defaultHostName
    originHostHeader: app.properties.defaultHostName
    httpPort: 80
    httpsPort: 443
    priority: 1
    weight: 1000
    enabledState: 'Enabled'
  }
}

// Content-hashed build assets are cached at the edge; their Cache-Control is already immutable.
resource staticRoute 'Microsoft.Cdn/profiles/afdEndpoints/routes@2024-02-01' = if (frontDoor) {
  parent: endpoint
  name: 'route-static'
  dependsOn: [origin]
  properties: {
    originGroup: { id: originGroup.id }
    patternsToMatch: ['/_next/static/*']
    supportedProtocols: ['Https']
    httpsRedirect: 'Enabled'
    forwardingProtocol: 'HttpsOnly'
    linkToDefaultDomain: 'Enabled'
    cacheConfiguration: {
      queryStringCachingBehavior: 'IgnoreQueryString'
      compressionSettings: {
        isCompressionEnabled: true
        contentTypesToCompress: ['text/css', 'text/javascript', 'application/javascript', 'application/json', 'image/svg+xml']
      }
    }
  }
}

// Everything else is dynamic: no edge caching, Next.js sets its own Cache-Control.
resource defaultRoute 'Microsoft.Cdn/profiles/afdEndpoints/routes@2024-02-01' = if (frontDoor) {
  parent: endpoint
  name: 'route-default'
  dependsOn: [origin]
  properties: {
    originGroup: { id: originGroup.id }
    patternsToMatch: ['/*']
    supportedProtocols: ['Http', 'Https']
    httpsRedirect: 'Enabled'
    forwardingProtocol: 'HttpsOnly'
    linkToDefaultDomain: 'Enabled'
  }
}

output appName string = app.name
output storageAccountName string = storage.name
output url string = frontDoor ? 'https://${endpoint!.properties.hostName}' : 'https://${app.properties.defaultHostName}'
