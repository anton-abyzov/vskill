---
description: GitHub Actions expert for OIDC cloud authentication, reusable workflows, composite actions, and monorepo path-based triggering patterns.
allowed-tools: Read, Write, Edit, Bash
model: opus
context: fork
---

# GitHub Actions Advanced Patterns

## OIDC Authentication with Cloud Providers

### AWS OIDC

```yaml
permissions:
  id-token: write
  contents: read

steps:
  - uses: aws-actions/configure-aws-credentials@v4
    with:
      role-to-assume: arn:aws:iam::123456789012:role/github-actions
      aws-region: us-east-1
      # No access keys needed - uses OIDC token
```

**AWS IAM Trust Policy:**

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "Federated": "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com"
    },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
      },
      "StringLike": {
        "token.actions.githubusercontent.com:sub": "repo:org/repo:*"
      }
    }
  }]
}
```

### Azure OIDC

```yaml
steps:
  - uses: azure/login@v2
    with:
      client-id: ${{ secrets.AZURE_CLIENT_ID }}
      tenant-id: ${{ secrets.AZURE_TENANT_ID }}
      subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}
```

### GCP OIDC

```yaml
steps:
  - uses: google-github-actions/auth@v2
    with:
      workload_identity_provider: 'projects/123/locations/global/workloadIdentityPools/pool/providers/github'
      service_account: 'github-actions@project.iam.gserviceaccount.com'
```

## Reusable Workflows (workflow_call)

### Defining a Reusable Workflow

```yaml
# .github/workflows/reusable-deploy.yml
name: Reusable Deploy

on:
  workflow_call:
    inputs:
      environment:
        required: true
        type: string
      image_tag:
        required: true
        type: string
      region:
        type: string
        default: 'us-east-1'
    secrets:
      AWS_ROLE_ARN:
        required: true
    outputs:
      deploy_url:
        description: 'Deployment URL'
        value: ${{ jobs.deploy.outputs.url }}

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: ${{ inputs.environment }}
    outputs:
      url: ${{ steps.deploy.outputs.url }}
    steps:
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
          aws-region: ${{ inputs.region }}

      - id: deploy
        run: |
          echo "url=https://${{ inputs.environment }}.example.com" >> "$GITHUB_OUTPUT"
```

### Calling a Reusable Workflow

```yaml
jobs:
  deploy-staging:
    needs: build
    uses: ./.github/workflows/reusable-deploy.yml
    with:
      environment: staging
      image_tag: ${{ needs.build.outputs.image_tag }}
    secrets:
      AWS_ROLE_ARN: ${{ secrets.STAGING_AWS_ROLE_ARN }}

  deploy-production:
    needs: deploy-staging
    uses: ./.github/workflows/reusable-deploy.yml
    with:
      environment: production
      image_tag: ${{ needs.build.outputs.image_tag }}
    secrets:
      AWS_ROLE_ARN: ${{ secrets.PROD_AWS_ROLE_ARN }}
```

## Composite Action Authoring

```yaml
# .github/actions/setup-project/action.yml
name: 'Setup Project'
description: 'Install dependencies with caching'

inputs:
  node_version:
    description: 'Node.js version'
    default: '20'
  working_directory:
    description: 'Working directory'
    default: '.'

outputs:
  cache_hit:
    description: 'Whether cache was hit'
    value: ${{ steps.cache.outputs.cache-hit }}

runs:
  using: 'composite'
  steps:
    - uses: actions/setup-node@v4
      with:
        node-version: ${{ inputs.node_version }}

    - name: Get npm cache directory
      id: npm-cache-dir
      shell: bash
      run: echo "dir=$(npm config get cache)" >> "$GITHUB_OUTPUT"

    - uses: actions/cache@v4
      id: cache
      with:
        path: |
          ${{ steps.npm-cache-dir.outputs.dir }}
          ${{ inputs.working_directory }}/node_modules
        key: ${{ runner.os }}-node-${{ inputs.node_version }}-${{ hashFiles('**/package-lock.json') }}
        restore-keys: |
          ${{ runner.os }}-node-${{ inputs.node_version }}-

    - name: Install dependencies
      if: steps.cache.outputs.cache-hit != 'true'
      shell: bash
      working-directory: ${{ inputs.working_directory }}
      run: npm ci
```

### Using the Composite Action

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: ./.github/actions/setup-project
    with:
      node_version: '20'
  - run: npm test
```

## Monorepo Path-Based Triggering

### Path Triggers

```yaml
on:
  push:
    paths:
      - 'packages/frontend/**'
      - 'packages/shared/**'
      - 'package.json'
```

### Changed File Detection with Conditional Jobs

```yaml
jobs:
  detect-changes:
    runs-on: ubuntu-latest
    outputs:
      frontend: ${{ steps.changes.outputs.frontend }}
      backend: ${{ steps.changes.outputs.backend }}
      infra: ${{ steps.changes.outputs.infra }}
    steps:
      - uses: actions/checkout@v4
      - uses: dorny/paths-filter@v3
        id: changes
        with:
          filters: |
            frontend:
              - 'packages/frontend/**'
              - 'packages/shared/**'
            backend:
              - 'packages/backend/**'
              - 'packages/shared/**'
            infra:
              - 'infrastructure/**'

  build-frontend:
    needs: detect-changes
    if: needs.detect-changes.outputs.frontend == 'true'
    runs-on: ubuntu-latest
    steps:
      - run: echo "Building frontend..."

  build-backend:
    needs: detect-changes
    if: needs.detect-changes.outputs.backend == 'true'
    runs-on: ubuntu-latest
    steps:
      - run: echo "Building backend..."
```

### Concurrency Control

```yaml
# Cancel redundant runs on the same PR
concurrency:
  group: ${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

# Serialize deployments (never cancel)
jobs:
  deploy:
    concurrency:
      group: deploy-production
      cancel-in-progress: false
```
