---
description: DevSecOps expert for security pipeline architecture, SLSA attestation, SBOM generation, and Semgrep custom rule authoring. Designs shift-left security gates for CI/CD pipelines.
allowed-tools: Read, Write, Edit, Bash
model: opus
context: fork
---

# DevSecOps - Shift-Left Security

## Security Pipeline Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Developer Workstation                      │
│  pre-commit: secret detection, linting, SAST (fast checks)  │
└──────────────────────┬───────────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                    CI Pipeline                                │
│  ┌──────────┐ ┌──────────┐ ┌───────────┐ ┌──────────────┐  │
│  │ SAST     │ │ SCA/Deps │ │ Secrets   │ │ IaC Scan     │  │
│  │ Semgrep  │ │ Snyk     │ │ Gitleaks  │ │ Checkov      │  │
│  │ CodeQL   │ │ Trivy    │ │ Trufflehog│ │ KICS         │  │
│  └────┬─────┘ └────┬─────┘ └─────┬─────┘ └──────┬───────┘  │
│       └─────────────┴─────────────┴──────────────┘           │
│                          ▼                                    │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ Container Build                                       │    │
│  │  Build → Scan (Trivy/Grype) → Sign (Cosign) → Push  │    │
│  └──────────────────────┬───────────────────────────────┘    │
│                          ▼                                    │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ SBOM Generation (Syft) → Attestation (SLSA)          │    │
│  └──────────────────────────────────────────────────────┘    │
└──────────────────────┬───────────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                    CD Pipeline                                │
│  Admission Control (Kyverno/Gatekeeper) → DAST → Deploy     │
└─────────────────────────────────────────────────────────────┘
```

### Security Gates: Blocking vs Advisory

```
BLOCKING (fail pipeline):
  - Critical/High CVEs with known exploits
  - Hardcoded secrets in code
  - SQL injection, XSS, RCE findings (SAST)
  - Unsigned container images (production)
  - Missing encryption at rest/transit
  - Privileged containers

ADVISORY (warn, don't block):
  - Medium/Low CVEs without exploits
  - Informational SAST findings
  - Style/best-practice violations
  - CVEs in dev dependencies only
  - Findings with accepted risk exceptions
```

## SLSA Attestation Workflow

### SLSA Levels

| Level | Requirement |
|-------|-------------|
| SLSA 1 | Build process documented, provenance exists |
| SLSA 2 | Version-controlled build process, authenticated provenance |
| SLSA 3 | Hardened build platform, non-falsifiable provenance |
| SLSA 4 | Two-person review, hermetic builds |

### Provenance Attestation

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
      attestations: write
      packages: write
    steps:
      - uses: actions/checkout@v4

      - name: Build and push
        id: build
        uses: docker/build-push-action@v5
        with:
          push: true
          tags: ghcr.io/${{ github.repository }}:${{ github.sha }}

      - name: Generate SLSA provenance
        uses: actions/attest-build-provenance@v1
        with:
          subject-name: ghcr.io/${{ github.repository }}
          subject-digest: ${{ steps.build.outputs.digest }}
          push-to-registry: true
```

### Image Signing (Cosign Keyless)

```yaml
jobs:
  build-sign:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      packages: write
    steps:
      - uses: sigstore/cosign-installer@v3

      - name: Build and push
        id: build
        uses: docker/build-push-action@v5
        with:
          push: true
          tags: ghcr.io/${{ github.repository }}:${{ github.sha }}

      - name: Sign image (keyless)
        run: cosign sign --yes ghcr.io/${{ github.repository }}@${{ steps.build.outputs.digest }}
```

```bash
# Verify keyless signature
cosign verify \
  --certificate-identity=https://github.com/org/repo/.github/workflows/build.yml@refs/heads/main \
  --certificate-oidc-issuer=https://token.actions.githubusercontent.com \
  myregistry.com/myapp:v1.0.0
```

## SBOM Generation with Syft

```bash
# Generate SBOM from container image
syft myapp:latest -o spdx-json > sbom.spdx.json
syft myapp:latest -o cyclonedx-json > sbom.cdx.json

# Generate SBOM from source directory
syft dir:. -o spdx-json > sbom.spdx.json

# Attach SBOM to container image (OCI artifact)
syft myapp:latest -o spdx-json | cosign attach sbom --sbom - myapp:latest

# Scan SBOM for vulnerabilities (faster than re-scanning image)
grype sbom:sbom.spdx.json
```

### CI Pipeline SBOM

```yaml
jobs:
  sbom:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Build image
        run: docker build -t myapp:${{ github.sha }} .

      - name: Generate SBOM
        uses: anchore/sbom-action@v0
        with:
          image: myapp:${{ github.sha }}
          format: spdx-json
          output-file: sbom.spdx.json

      - name: Upload SBOM
        uses: actions/upload-artifact@v4
        with:
          name: sbom
          path: sbom.spdx.json
```

## Semgrep Custom Rule Authoring

```yaml
# .semgrep/custom-rules.yml
rules:
  - id: no-hardcoded-secrets
    patterns:
      - pattern: |
          $KEY = "..."
      - metavariable-regex:
          metavariable: $KEY
          regex: '(?i)(password|secret|token|api_key|apikey)'
    message: "Hardcoded secret detected in variable '$KEY'"
    severity: ERROR
    languages: [python, javascript, typescript, java, go]

  - id: sql-injection
    patterns:
      - pattern: |
          $QUERY = f"... {$INPUT} ..."
      - pattern-not: |
          $QUERY = f"... {$SAFE} ..."
    message: "Potential SQL injection via string formatting"
    severity: ERROR
    languages: [python]
```

### Kyverno: Require Image Signatures

```yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: verify-image-signatures
spec:
  validationFailureAction: Enforce
  rules:
    - name: verify-cosign
      match:
        resources:
          kinds: [Pod]
      verifyImages:
        - imageReferences: ["ghcr.io/myorg/*"]
          attestors:
            - entries:
                - keyless:
                    issuer: "https://token.actions.githubusercontent.com"
                    subject: "https://github.com/myorg/*"
```

## Tool Selection Guide

| Category | Recommended | Alternative | Notes |
|----------|------------|-------------|-------|
| Container scan | Trivy | Grype, Snyk | Trivy: free, comprehensive |
| SAST | Semgrep | CodeQL, SonarQube | Semgrep: fast, custom rules |
| DAST | ZAP | Nuclei | ZAP: comprehensive; Nuclei: fast |
| Dependencies | Renovate | Dependabot | Renovate: more flexible |
| Secrets | Gitleaks | TruffleHog | Gitleaks: fast; TH: deep history |
| SBOM | Syft | Trivy | Syft: dedicated SBOM tool |
| Signing | Cosign | Notary | Cosign: Sigstore ecosystem |
| IaC scan | Checkov | KICS, tfsec | Checkov: multi-framework |
| K8s policy | Kyverno | OPA/Gatekeeper | Kyverno: K8s-native YAML |
| Runtime | Falco | Sysdig | Falco: open-source standard |
