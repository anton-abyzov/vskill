---
description: Azure Bicep and AKS expert for modular infrastructure-as-code, Managed Identity, Workload Identity, and AKS cluster deployment patterns.
allowed-tools: Read, Write, Edit, Bash
model: opus
context: fork
---

# Azure Bicep & AKS

## Bicep Template Patterns

### Parameters with Decorators and Conditions

```bicep
@description('The Azure region for all resources')
param location string = resourceGroup().location

@allowed(['dev', 'staging', 'production'])
param environment string

@secure()
param adminPassword string

var prefix = 'myapp-${environment}'
var tags = {
  Environment: environment
  ManagedBy: 'Bicep'
}

// Conditional deployment
param deployRedis bool = false

resource redis 'Microsoft.Cache/redis@2023-08-01' = if (deployRedis) {
  name: '${prefix}-redis'
  location: location
  properties: {
    sku: {
      name: environment == 'production' ? 'Premium' : 'Basic'
      family: environment == 'production' ? 'P' : 'C'
      capacity: environment == 'production' ? 1 : 0
    }
    enableNonSslPort: false
    minimumTlsVersion: '1.2'
  }
}

// Loop with index
resource nsgRules 'Microsoft.Network/networkSecurityGroups/securityRules@2023-11-01' = [
  for (rule, i) in allowedPorts: {
    name: 'Allow-${rule.name}'
    parent: nsg
    properties: {
      priority: 100 + (i * 10)
      direction: 'Inbound'
      access: 'Allow'
      protocol: 'Tcp'
      sourceAddressPrefix: rule.source
      destinationPortRange: string(rule.port)
      sourcePortRange: '*'
      destinationAddressPrefix: '*'
    }
  }
]
```

### User-Defined Types and Functions

```bicep
@export()
type environmentConfig = {
  name: 'dev' | 'staging' | 'production'
  skuTier: 'Basic' | 'Standard' | 'Premium'
  instanceCount: int
  enableHA: bool
}

@export()
func getSubnetId(vnetId string, subnetName string) string =>
  '${vnetId}/subnets/${subnetName}'

// Discriminated union type
@export()
type storageConfig = {
  kind: 'blob'
  containerName: string
} | {
  kind: 'table'
  tableName: string
}
```

### Module Composition

```bicep
// main.bicep - orchestrator
targetScope = 'subscription'

param location string = 'eastus2'
param environment string

resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: 'rg-myapp-${environment}'
  location: location
}

module network 'modules/network.bicep' = {
  name: 'network-deployment'
  scope: rg
  params: {
    location: location
    environment: environment
    vnetAddressPrefix: '10.0.0.0/16'
  }
}

module aks 'modules/aks.bicep' = {
  name: 'aks-deployment'
  scope: rg
  params: {
    location: location
    environment: environment
    subnetId: network.outputs.aksSubnetId
    logAnalyticsWorkspaceId: monitoring.outputs.workspaceId
  }
}
```

### Parameter Files (.bicepparam)

```bicep
using '../main.bicep'

param environment = 'production'
param location = 'eastus2'
param deployRedis = true
param appServices = [
  { name: 'api', sku: 'P2v3' }
  { name: 'web', sku: 'P1v3' }
]
```

## Managed Identity Configuration

```bicep
// User-assigned managed identity for workloads
resource appIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-myapp-${environment}'
  location: location
}

// Federated credential for Kubernetes service account (Workload Identity)
resource federatedCredential 'Microsoft.ManagedIdentity/userAssignedIdentities/federatedIdentityCredentials@2023-01-31' = {
  parent: appIdentity
  name: 'myapp-federated'
  properties: {
    issuer: aksCluster.properties.oidcIssuerProfile.issuerURL
    subject: 'system:serviceaccount:production:myapp-sa'
    audiences: ['api://AzureADTokenExchange']
  }
}
```

```yaml
# Kubernetes ServiceAccount with Workload Identity
apiVersion: v1
kind: ServiceAccount
metadata:
  name: myapp-sa
  namespace: production
  annotations:
    azure.workload.identity/client-id: "<managed-identity-client-id>"
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
  namespace: production
spec:
  template:
    metadata:
      labels:
        azure.workload.identity/use: "true"
    spec:
      serviceAccountName: myapp-sa
      containers:
        - name: myapp
          image: myacr.azurecr.io/myapp:latest
```

## AKS Deployment with Bicep

```bicep
param location string
param environment string
param subnetId string
param logAnalyticsWorkspaceId string

var clusterName = 'aks-myapp-${environment}'

resource aksIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${clusterName}-identity'
  location: location
}

resource aksCluster 'Microsoft.ContainerService/managedClusters@2024-02-01' = {
  name: clusterName
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${aksIdentity.id}': {} }
  }
  sku: {
    name: 'Base'
    tier: environment == 'production' ? 'Standard' : 'Free'
  }
  properties: {
    dnsPrefix: clusterName
    kubernetesVersion: '1.30'
    networkProfile: {
      networkPlugin: 'azure'
      networkPluginMode: 'overlay'
      networkPolicy: 'calico'
      serviceCidr: '10.1.0.0/16'
      dnsServiceIP: '10.1.0.10'
      loadBalancerSku: 'standard'
    }
    agentPoolProfiles: [
      {
        name: 'system'
        count: environment == 'production' ? 3 : 1
        vmSize: 'Standard_D4s_v5'
        mode: 'System'
        osType: 'Linux'
        osSKU: 'AzureLinux'
        vnetSubnetID: subnetId
        enableAutoScaling: true
        minCount: environment == 'production' ? 3 : 1
        maxCount: environment == 'production' ? 5 : 3
        availabilityZones: environment == 'production' ? ['1', '2', '3'] : []
        nodeTaints: ['CriticalAddonsOnly=true:NoSchedule']
      }
    ]
    aadProfile: { managed: true; enableAzureRBAC: true }
    addonProfiles: {
      omsagent: {
        enabled: true
        config: { logAnalyticsWorkspaceResourceID: logAnalyticsWorkspaceId }
      }
      azureKeyvaultSecretsProvider: {
        enabled: true
        config: { enableSecretRotation: 'true'; rotationPollInterval: '120s' }
      }
    }
    enableRBAC: true
    disableLocalAccounts: true
    securityProfile: {
      defender: { securityMonitoring: { enabled: environment == 'production' } }
      workloadIdentity: { enabled: true }
    }
    oidcIssuerProfile: { enabled: true }
    autoUpgradeProfile: {
      upgradeChannel: 'stable'
      nodeOSUpgradeChannel: 'NodeImage'
    }
  }
}

// User node pool (workloads)
resource userPool 'Microsoft.ContainerService/managedClusters/agentPools@2024-02-01' = {
  parent: aksCluster
  name: 'workload'
  properties: {
    mode: 'User'
    vmSize: 'Standard_D8s_v5'
    osType: 'Linux'
    osSKU: 'AzureLinux'
    vnetSubnetID: subnetId
    enableAutoScaling: true
    minCount: 2
    maxCount: 20
    availabilityZones: environment == 'production' ? ['1', '2', '3'] : []
    nodeLabels: { 'workload-type': 'general' }
  }
}

// Spot instance pool (non-production cost optimization)
resource spotPool 'Microsoft.ContainerService/managedClusters/agentPools@2024-02-01' = if (environment != 'production') {
  parent: aksCluster
  name: 'spot'
  properties: {
    mode: 'User'
    vmSize: 'Standard_D4s_v5'
    osType: 'Linux'
    scaleSetPriority: 'Spot'
    spotMaxPrice: -1
    scaleSetEvictionPolicy: 'Delete'
    enableAutoScaling: true
    minCount: 0
    maxCount: 10
    nodeTaints: ['kubernetes.azure.com/scalesetpriority=spot:NoSchedule']
    nodeLabels: { 'kubernetes.azure.com/scalesetpriority': 'spot' }
  }
}

output clusterName string = aksCluster.name
output oidcIssuerUrl string = aksCluster.properties.oidcIssuerProfile.issuerURL
```
