// OpenNext on Azure: one Function app (Flex Consumption) + Storage (Blob/Queue/Table),
// with Azure Front Door as an optional extra. See docs/plan/decisions.md, ADR-0009.
//
//   Without Front Door (default):   client ──▶ Function app ──▶ Storage
//   With    Front Door:             client ──▶ Front Door ──▶ Function app ──▶ Storage
//
// The Function app contains three functions: `server` ({*path}, also serves static files from the
// assets container), `image` (_next/image) and `revalidation` (queue trigger).
// Never deployed to Azure yet: everything here is unverified against a real subscription.

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

@description('Always-ready instances for the queue-triggered revalidation function (0 = it scales from zero, so a stale page can wait minutes for its regeneration, see ADR-0010). 1 keeps one instance running and billed continuously.')
@minValue(0)
param revalidationAlwaysReady int = 0

@description('How long (seconds) a request that found a page stale holds the right to enqueue its revalidation; other requests for the same page version enqueue nothing meanwhile. 0 turns the deduplication off (every stale request enqueues). See ADR-0010.')
@minValue(0)
param revalidationDedupeSeconds int = 60

@description('Longest wait (seconds, 1 to 60) between polls of an empty revalidation queue. The platform default is 60: an idle queue listener backs off to it, so a message can wait up to that long. Lower values cut the wait and add a small constant number of storage transactions per running instance. Not measured on Azure yet (ADR-0010).')
@minValue(1)
@maxValue(60)
param revalidationPollingSeconds int = 60

@description('Create an alert when the storage account holds more than this many queue messages on average over one hour (revalidation and poison queues together; the metric is reported hourly). 0 = no alert. Without an action group it is only visible in the portal.')
@minValue(0)
param queueBacklogAlertThreshold int = 0

@description('Resource id of an action group to notify when the queue backlog alert fires. Empty = none.')
param alertActionGroupId string = ''

@description('What happens to deferred work (after(), queue enqueues) when the response is complete. "hold" keeps the response open until the work is done (safe, the client waits). "detach" ends the response at once and lets the work run in the background (see ADR-0006 for what is known about the platform).')
@allowed(['hold', 'detach'])
param waitUntilMode string = 'hold'

@description('Object id of the user or service principal that runs `opennext-azure deploy`. It gets Storage Blob Data Contributor on the storage account, because uploading static files and the prerender cache uses its Azure AD identity (shared keys are disabled, and Owner on the subscription does not include data access). Empty = no assignment.')
param deployerPrincipalId string = ''

@allowed(['User', 'ServicePrincipal', 'Group'])
param deployerPrincipalType string = 'User'

var suffix = uniqueString(resourceGroup().id, name)
var storageName = toLower('st${take(name, 8)}${take(suffix, 8)}')
var queueName = 'revalidation'
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
    allowBlobPublicAccess: false // static files are served by the app, not directly from Blob
    defaultToOAuthAuthentication: true
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource assets 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'assets'
  properties: { publicAccess: 'None' }
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

resource queueService 'Microsoft.Storage/storageAccounts/queueServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource revalidationQueue 'Microsoft.Storage/storageAccounts/queueServices/queues@2023-05-01' = {
  parent: queueService
  name: queueName
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
        alwaysReady: concat(
          alwaysReadyInstances > 0 ? [
            {
              name: 'http'
              instanceCount: alwaysReadyInstances
            }
          ] : [],
          revalidationAlwaysReady > 0 ? [
            {
              name: 'function:revalidation'
              instanceCount: revalidationAlwaysReady
            }
          ] : []
        )
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
        // Read by the opennextjs-azure overrides
        { name: 'AZURE_STORAGE_ACCOUNT_NAME', value: storage.name }
        { name: 'CACHE_CONTAINER_NAME', value: cache.name }
        { name: 'ASSETS_CONTAINER_NAME', value: assets.name }
        { name: 'CACHE_TABLE_NAME', value: tagCacheTable.name }
        { name: 'REVALIDATION_QUEUE_NAME', value: revalidationQueue.name }
        { name: 'WAIT_UNTIL_MODE', value: waitUntilMode }
        // Optimized images carry an ETag and a matching If-None-Match is answered 304 without running sharp (ADR-0014)
        { name: 'OPENNEXT_STATIC_ETAG', value: 'true' }
        { name: 'REVALIDATION_DEDUPE_SECONDS', value: string(revalidationDedupeSeconds) }
        // Large request bodies / Server Actions
        { name: 'FUNCTIONS_REQUEST_BODY_SIZE_LIMIT', value: '104857600' }
      ], revalidationPollingSeconds < 60 ? [
        // Overrides host.json extensions.queues.maxPollingInterval (hh:mm:ss)
        {
          name: 'AzureFunctionsJobHost__extensions__queues__maxPollingInterval'
          value: '00:00:${padLeft(string(revalidationPollingSeconds), 2, '0')}'
        }
      ] : [], fullTelemetry ? [
        // Overrides host.json logging.applicationInsights.samplingSettings.isEnabled
        {
          name: 'AzureFunctionsJobHost__logging__applicationInsights__samplingSettings__isEnabled'
          value: 'false'
        }
      ] : [], frontDoor ? [
        // The wrapper rejects requests whose X-Azure-FDID differs
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

// The deploying identity uploads assets and the prerender cache (see the deployerPrincipalId parameter)
resource deployerBlobRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(deployerPrincipalId)) {
  scope: storage
  name: guid(storage.id, deployerPrincipalId, roles.blobContributor)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.blobContributor)
    principalId: deployerPrincipalId
    principalType: deployerPrincipalType
  }
}

// ------------------------------------------------ Queue backlog alert (optional)
// Storage reports no "age of the oldest message", so a count that stays high is the signal: a
// healthy consumer keeps the queues near empty (ADR-0010).
resource queueBacklogAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = if (queueBacklogAlertThreshold > 0) {
  name: 'alert-queue-backlog-${name}-${suffix}'
  location: 'global'
  properties: {
    description: 'Revalidation messages are piling up in storage; the revalidation function may not be running (ADR-0010).'
    severity: 3
    enabled: true
    scopes: [queueService.id]
    // QueueMessageCount is reported hourly: Azure Monitor only accepts PT1H, PT6H, PT12H or P1D as
    // the window for it (a shorter one passes `validate` and fails the real deployment).
    evaluationFrequency: 'PT15M'
    windowSize: 'PT1H'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'QueueMessageCount'
          criterionType: 'StaticThresholdCriterion'
          metricName: 'QueueMessageCount'
          metricNamespace: 'Microsoft.Storage/storageAccounts/queueServices'
          timeAggregation: 'Average'
          operator: 'GreaterThan'
          threshold: queueBacklogAlertThreshold
        }
      ]
    }
    actions: empty(alertActionGroupId) ? [] : [
      {
        actionGroupId: alertActionGroupId
      }
    ]
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
