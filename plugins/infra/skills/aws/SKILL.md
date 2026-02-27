---
description: AWS CDK expert for EKS managed node groups, construct-level decisions, and IAM least-privilege patterns. Generates production-grade CDK stacks ONE COMPONENT AT A TIME.
allowed-tools: Read, Write, Edit, Bash
model: opus
context: fork
---

# AWS CDK Infrastructure

## CDK Construct Level Decision Framework

```
┌────────────────────────────────────────────────────────┐
│ L3 - Patterns (aws-solutions-constructs)               │
│   High-level, opinionated combinations of resources    │
│   Example: ApplicationLoadBalancedFargateService       │
├────────────────────────────────────────────────────────┤
│ L2 - Curated (default CDK constructs)                  │
│   AWS resource with sensible defaults and helpers      │
│   Example: s3.Bucket, lambda.Function                  │
├────────────────────────────────────────────────────────┤
│ L1 - CFN Resources (CfnBucket, CfnFunction)           │
│   1:1 CloudFormation mapping, no defaults              │
│   Use only when L2 doesn't expose a property           │
└────────────────────────────────────────────────────────┘

RULE: Always start with L2. Drop to L1 only for missing properties.
      Use L3 patterns for common architectures.

WHEN L1:
- Property not yet exposed by L2 (check CDK GitHub issues first)
- Custom CloudFormation resource type
- escape hatch: (l2Construct.node.defaultChild as CfnXxx).addPropertyOverride(...)

WHEN L3:
- Standard patterns: ALB+Fargate, API GW+Lambda, CloudFront+S3
- Prototype/MVP (speed over customization)
- Avoid L3 when you need fine-grained control over sub-resources
```

## EKS Managed Node Group Patterns

```typescript
import * as cdk from 'aws-cdk-lib';
import * as eks from 'aws-cdk-lib/aws-eks';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';

export class EksStack extends cdk.Stack {
  public readonly cluster: eks.Cluster;

  constructor(scope: Construct, id: string, props: EksStackProps) {
    super(scope, id, props);

    this.cluster = new eks.Cluster(this, 'Cluster', {
      version: eks.KubernetesVersion.V1_30,
      vpc: props.vpc,
      vpcSubnets: [{ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }],
      defaultCapacity: 0, // We manage node groups explicitly
      endpointAccess: eks.EndpointAccess.PRIVATE,
      clusterLogging: [
        eks.ClusterLoggingTypes.API,
        eks.ClusterLoggingTypes.AUDIT,
        eks.ClusterLoggingTypes.AUTHENTICATOR,
      ],
    });

    // Managed node group (general workloads)
    this.cluster.addNodegroupCapacity('GeneralNodes', {
      instanceTypes: [
        new ec2.InstanceType('m7i.xlarge'),
        new ec2.InstanceType('m6i.xlarge'),
      ],
      minSize: 3,
      maxSize: 20,
      desiredSize: 3,
      diskSize: 100,
      amiType: eks.NodegroupAmiType.AL2023_X86_64_STANDARD,
      labels: { 'workload-type': 'general' },
      capacityType: eks.CapacityType.ON_DEMAND,
    });

    // Spot node group (cost optimization for non-critical)
    this.cluster.addNodegroupCapacity('SpotNodes', {
      instanceTypes: [
        new ec2.InstanceType('m6i.xlarge'),
        new ec2.InstanceType('m5.xlarge'),
        new ec2.InstanceType('m5a.xlarge'),
        new ec2.InstanceType('c6i.xlarge'),
      ],
      minSize: 0,
      maxSize: 30,
      desiredSize: 2,
      capacityType: eks.CapacityType.SPOT,
      labels: { 'workload-type': 'spot' },
      taints: [{
        key: 'spot-instance',
        value: 'true',
        effect: eks.TaintEffect.NO_SCHEDULE,
      }],
    });

    // Fargate profile for system workloads
    this.cluster.addFargateProfile('SystemProfile', {
      selectors: [
        { namespace: 'kube-system', labels: { 'fargate': 'true' } },
        { namespace: 'external-secrets' },
      ],
    });
  }
}
```

### IRSA (IAM Roles for Service Accounts)

```typescript
const saRole = new iam.Role(this, 'AppServiceAccountRole', {
  assumedBy: new iam.FederatedPrincipal(
    cluster.openIdConnectProvider.openIdConnectProviderArn,
    {
      'StringEquals': {
        [`${cluster.clusterOpenIdConnectIssuer}:sub`]:
          'system:serviceaccount:production:myapp-sa',
        [`${cluster.clusterOpenIdConnectIssuer}:aud`]:
          'sts.amazonaws.com',
      },
    },
    'sts:AssumeRoleWithWebIdentity'
  ),
});

bucket.grantRead(saRole);

cluster.addManifest('AppSA', {
  apiVersion: 'v1',
  kind: 'ServiceAccount',
  metadata: {
    name: 'myapp-sa',
    namespace: 'production',
    annotations: {
      'eks.amazonaws.com/role-arn': saRole.roleArn,
    },
  },
});
```

## IAM Least-Privilege Patterns

```typescript
// Fine-grained IAM with conditions
const processorRole = new iam.Role(this, 'ProcessorRole', {
  assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
});

// Scoped to specific resources with conditions
processorRole.addToPolicy(new iam.PolicyStatement({
  actions: ['dynamodb:PutItem', 'dynamodb:GetItem', 'dynamodb:Query'],
  resources: [
    table.tableArn,
    `${table.tableArn}/index/*`,
  ],
  conditions: {
    'ForAllValues:StringEquals': {
      'dynamodb:LeadingKeys': ['ORDER#*'],
    },
  },
}));

// Permission boundary (org-wide guardrails)
const boundary = new iam.ManagedPolicy(this, 'Boundary', {
  statements: [
    new iam.PolicyStatement({
      effect: iam.Effect.DENY,
      actions: [
        'iam:CreateUser',
        'iam:CreateAccessKey',
        'organizations:*',
        'account:*',
      ],
      resources: ['*'],
    }),
    new iam.PolicyStatement({
      effect: iam.Effect.DENY,
      actions: ['*'],
      resources: ['*'],
      conditions: {
        'StringNotEquals': {
          'aws:RequestedRegion': ['us-east-1', 'us-west-2'],
        },
      },
    }),
  ],
});

processorRole.addManagedPolicy(boundary);
```

### Cross-Account Access

```typescript
// Account A: Role that Account B can assume
const crossAccountRole = new iam.Role(this, 'CrossAccountRole', {
  roleName: 'SharedDataAccess',
  assumedBy: new iam.AccountPrincipal('222222222222'),
  externalId: 'unique-external-id', // Confused deputy protection
  maxSessionDuration: cdk.Duration.hours(1),
});

bucket.grantRead(crossAccountRole);

// Account B: Assume the role
const assumeRolePolicy = new iam.PolicyStatement({
  actions: ['sts:AssumeRole'],
  resources: ['arn:aws:iam::111111111111:role/SharedDataAccess'],
  conditions: {
    'StringEquals': {
      'sts:ExternalId': 'unique-external-id',
    },
  },
});
```
