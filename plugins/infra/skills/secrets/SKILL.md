---
description: Secret management expert for External Secrets Operator CRD patterns, SOPS with age encryption, and decision framework for Vault vs ESO vs SOPS.
allowed-tools: Read, Write, Edit, Bash
model: opus
context: fork
---

# Secret Management

## Decision Framework: Vault vs ESO vs SOPS

```
Single cloud, simple app?
├─ YES -> Cloud-native (AWS Secrets Manager / Azure Key Vault / GCP Secret Manager)
└─ NO  -> Continue...

Multi-cloud or hybrid?
├─ YES -> HashiCorp Vault (central control plane)
└─ NO  -> Continue...

Kubernetes-native workflow?
├─ YES -> External Secrets Operator + cloud backend
└─ NO  -> Continue...

Secrets in Git (GitOps)?
├─ YES -> SOPS + KMS/age provider
└─ NO  -> Continue...

Dynamic credentials needed (DB, cloud IAM)?
├─ YES -> HashiCorp Vault (dynamic secrets engine)
└─ NO  -> Cloud-native or Vault KV

SUMMARY:
┌──────────────────┬─────────────────────────────────────────┐
│ Tool             │ Best For                                │
├──────────────────┼─────────────────────────────────────────┤
│ Vault            │ Multi-cloud, dynamic secrets, PKI, EaaS │
│ ESO              │ K8s-native sync from any backend        │
│ SOPS             │ GitOps, encrypted secrets in repos      │
│ Cloud-native     │ Single cloud, simplest path             │
└──────────────────┴─────────────────────────────────────────┘
```

## External Secrets Operator CRD Patterns

### ClusterSecretStore (Shared Across Namespaces)

```yaml
apiVersion: external-secrets.io/v1beta1
kind: ClusterSecretStore
metadata:
  name: vault-backend
spec:
  provider:
    vault:
      server: "https://vault.example.com"
      path: "secret"
      version: "v2"
      auth:
        kubernetes:
          mountPath: "kubernetes"
          role: "eso-role"
          serviceAccountRef:
            name: eso-sa
            namespace: external-secrets

---
# AWS Secrets Manager backend
apiVersion: external-secrets.io/v1beta1
kind: ClusterSecretStore
metadata:
  name: aws-secrets
spec:
  provider:
    aws:
      service: SecretsManager
      region: us-east-1
      auth:
        jwt:
          serviceAccountRef:
            name: eso-sa
            namespace: external-secrets
```

### ExternalSecret CRD

```yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: myapp-secrets
  namespace: production
spec:
  refreshInterval: 5m
  secretStoreRef:
    name: aws-secrets
    kind: ClusterSecretStore
  target:
    name: myapp-secrets          # K8s Secret name to create
    creationPolicy: Owner
    template:
      type: Opaque
      data:
        config.yaml: |
          database:
            host: "{{ .db_host }}"
            password: "{{ .db_password }}"
  data:
    - secretKey: db_host
      remoteRef:
        key: production/myapp/database
        property: host
    - secretKey: db_password
      remoteRef:
        key: production/myapp/database
        property: password
```

### PushSecret (K8s to Provider)

```yaml
apiVersion: external-secrets.io/v1alpha1
kind: PushSecret
metadata:
  name: push-to-aws
spec:
  secretStoreRefs:
    - name: aws-secrets
      kind: ClusterSecretStore
  selector:
    secret:
      name: generated-tls-cert
  data:
    - match:
        secretKey: tls.crt
        remoteRef:
          remoteKey: production/tls/certificate
          property: cert
```

## SOPS with age Encryption

### Setup

```bash
# Install age
brew install age  # or: apt install age

# Generate key pair
age-keygen -o keys.txt
# Public key: age1abc123...
# Store private key securely; distribute public key to team

# Set env var for decryption
export SOPS_AGE_KEY_FILE=~/.config/sops/age/keys.txt
```

### Configuration (.sops.yaml)

```yaml
# .sops.yaml - per-repository encryption rules
creation_rules:
  # Production: encrypt with AWS KMS
  - path_regex: environments/production/.*\.yaml$
    kms: "arn:aws:kms:us-east-1:123456789:key/abc-123"
    encrypted_regex: "^(password|secret|token|key|connectionString)$"

  # Staging: encrypt with age key
  - path_regex: environments/staging/.*\.yaml$
    age: "age1abc123..."
    encrypted_regex: "^(password|secret|token|key)$"
```

### Encrypt/Decrypt Workflow

```bash
# Encrypt a file in-place
sops --encrypt --in-place secrets.yaml

# Decrypt to stdout (never write plaintext to disk in CI)
sops --decrypt secrets.yaml

# Edit encrypted file (decrypts in $EDITOR, re-encrypts on save)
sops secrets.yaml

# Rotate data key (after adding/removing recipients)
sops updatekeys secrets.yaml

# Encrypt specific keys only (partial encryption)
sops --encrypt --encrypted-regex '^(password|token)$' config.yaml
```

### Flux GitOps Integration

```yaml
apiVersion: kustomize.toolkit.fluxcd.io/v1
kind: Kustomization
metadata:
  name: myapp
  namespace: flux-system
spec:
  interval: 10m
  path: ./environments/production
  prune: true
  sourceRef:
    kind: GitRepository
    name: myapp
  decryption:
    provider: sops
    secretRef:
      name: sops-age-key  # K8s Secret containing age private key
```
