# vskill Plugin Marketplace — Skills Showcase

> **41 expert skills. 12 domain plugins. One command to install.**
>
> Each skill gives your AI agent deep, production-ready expertise in a specific domain. Not generic advice — battle-tested patterns, real CLI tooling, and actual code you can ship.

---

## Mobile — 9 Skills

The mobile plugin turns your AI agent into a full mobile engineering team. Build, test, sign, and ship iOS and Android apps — without touching a browser portal.

### `/mobile:appstore` — App Store Connect Automation

**The tool**: [`asc`](https://github.com/cidverse/asc) — a single Go binary that wraps the entire App Store Connect API.

This is the skill that makes people say _"wait, it can do THAT?"_

Your AI agent can:

- **Upload builds** to TestFlight (`asc builds upload --wait`) and distribute to beta testers (`asc publish testflight`)
- **Submit to the App Store** (`asc publish appstore`) — the agent fills metadata, selects the build, and submits for review
- **Manage in-app purchases and subscriptions** — create products, set pricing, configure offers
- **Upload screenshots** programmatically — no more dragging files into the portal
- **Handle code signing** — manage certificates, provisioning profiles, and bundle IDs from the terminal
- **Pull analytics** — download sales reports, view crash metrics, check app ratings
- **Trigger Xcode Cloud builds** and monitor their status
- **Notarize macOS apps** — submit, poll status, staple the ticket

The entire App Store Connect web portal — replaced by a CLI that returns structured JSON. The agent parses every response, makes decisions, and acts. No screenshots of browser tabs. No manual clicking.

**End-to-end example**: Agent builds with EAS → uploads via `asc builds upload --wait` → distributes to TestFlight via `asc publish testflight` → collects feedback → submits to App Store via `asc publish appstore` — all without leaving the terminal.

Works with any framework. Build your IPA with Xcode, Expo, Flutter, React Native, or Capacitor — `asc` handles the delivery side.

---

### `/mobile:react-native` — React Native New Architecture

Deep expertise in React Native's New Architecture: **Fabric** (the new rendering system), **TurboModules** (type-safe native bridge), and **JSI** (direct C++ interop). The agent knows how to enable it, migrate existing modules, and build new native components from scratch.

Also covers state management decision-making (Zustand vs TanStack Query vs Jotai vs Legend State) and performance optimization (FlashList, expo-image, Hermes engine tuning).

### `/mobile:expo` — Expo SDK 52+ & EAS

Modern Expo development with dynamic `app.config.ts`, EAS Build/Submit workflows, config plugins for native project modifications, and the Expo Modules API for custom native modules. The agent can configure OTA updates, set up monorepo builds, and analyze bundle sizes with Expo Atlas.

### `/mobile:flutter` — Flutter & Dart 3+

Dart 3 language features (records, pattern matching, sealed classes), Riverpod 2.0 with code-generated providers, GoRouter declarative routing, and Freezed for type-safe data classes. The agent writes idiomatic Flutter, not "React translated to Dart."

### `/mobile:swiftui` — SwiftUI & Swift 6

Native iOS expertise: NavigationStack (not the deprecated NavigationView), @Observable (the new Observation framework), SwiftData for persistence, structured concurrency with async/await and Actors. Covers both MVVM and The Composable Architecture (TCA).

### `/mobile:jetpack` — Jetpack Compose & Android

Gradle version catalogs (`libs.versions.toml`), Material Design 3 dynamic color theming, type-safe Navigation (2.8+), Hilt dependency injection, and Room database with Kotlin DSL. The agent writes modern Android, not legacy XML layouts.

### `/mobile:capacitor` — Capacitor 6+ Plugin Development

Custom plugin development with Swift/Kotlin native bridges, live reload configuration, and Appflow Live Updates for OTA deployments. For teams that want native capabilities without ejecting from their web stack.

### `/mobile:deep-linking` — Deep Linking & Push Notifications

The unglamorous but critical infrastructure: iOS Universal Links (AASA files), Android App Links (assetlinks.json), APNs and FCM push notifications, rich notifications with media, silent push for background sync. The agent generates the correct config files, entitlements, and server-side payloads.

### `/mobile:testing` — Maestro E2E & Device Farms

YAML-based E2E testing with [Maestro](https://maestro.mobile.dev/) that works across iOS, Android, React Native, and Flutter. Plus device farm configuration for Firebase Test Lab, AWS Device Farm, and BrowserStack. The agent writes test flows, not just unit tests.

---

## Frontend — 5 Skills

### `/frontend:frontend-core` — React 19 & Modern CSS

React 19's new APIs: `use()` for promise reading, `useActionState` for form handling, `useOptimistic` for instant UI updates. Modern CSS patterns: container queries, `@layer` for cascade management, `:has()` selectors. Image placeholder strategies (blur hash, LQIP, SQIP).

### `/frontend:nextjs` — Next.js 15 App Router

The caching layer interactions that trip everyone up: fetch cache vs React.cache vs unstable_cache — when to use each and how they interact. Server Actions with useActionState, parallel and intercepting routes, streaming with Suspense boundaries.

### `/frontend:design` — UI Design & Micro-Interactions

Frontend design expert that goes beyond "make it look nice." CSS animations with proper easing curves, box shadows that look realistic, gradient techniques, view transitions API, and scroll-driven animations. The agent makes bold design choices, not safe defaults.

### `/frontend:figma` — Figma Design-to-Code

Extracts designs from Figma using the official MCP server, manages Code Connect mappings between Figma components and codebase components, generates responsive components from mockups, and creates design system rules from existing Figma libraries.

### `/frontend:i18n` — Internationalization

Next.js App Router i18n routing, RTL layout with CSS logical properties, translation CI pipelines (Crowdin, Lokalise), `Intl` APIs for date/number/currency formatting. The agent handles the entire i18n stack, not just string extraction.

---

## Infrastructure — 7 Skills

The largest plugin. Covers all three major clouds, CI/CD, secrets, observability, and security pipelines.

### `/infra:aws` — AWS CDK & EKS

L2/L3 construct decisions, EKS managed node groups, IRSA (IAM Roles for Service Accounts), cross-account access patterns, and IAM least-privilege policies. The agent writes CDK constructs, not raw CloudFormation.

### `/infra:azure` — Azure Bicep & AKS

Bicep template patterns with user-defined types and functions, module composition, Managed Identity, Workload Identity, and AKS deployment configurations. Modern Azure IaC, not ARM templates.

### `/infra:gcp` — GCP & Terraform

GKE Autopilot with Terraform, Cloud Run service deployment, Workload Identity Federation setup. The agent generates working Terraform modules with proper state management.

### `/infra:github-actions` — GitHub Actions CI/CD

OIDC cloud authentication (eliminates stored secrets for AWS/Azure/GCP), reusable workflows, composite actions, monorepo path-based triggering, and concurrency control. The agent writes workflows that are secure by default.

### `/infra:devsecops` — Security Pipelines

SLSA attestation, container image signing with Cosign (keyless), SBOM generation with Syft, Semgrep custom rules, and Kyverno admission policies. The agent builds security into the pipeline, not bolted on after.

### `/infra:opentelemetry` — Observability

OpenTelemetry Collector pipeline configuration, auto-instrumentation per language (Node.js, Python, Java, .NET), sampling strategies (head vs tail vs parent-based), and cardinality control to keep costs manageable.

### `/infra:secrets` — Secret Management

Decision framework: HashiCorp Vault vs External Secrets Operator vs SOPS — which to use when. External Secrets Operator CRD patterns, SOPS with age encryption, and Flux GitOps integration.

---

## Machine Learning — 5 Skills

From training to deployment. Build, fine-tune, and ship ML models to production — including edge devices.

### `/ml:rag` — RAG & Vector Databases

Chunking strategy comparison (recursive, semantic, markdown-aware), vector database selection guide (Pinecone vs Weaviate vs Qdrant vs pgvector), and retrieval optimization patterns: HyDE, multi-query retrieval, reranking with Cohere, MMR for diversity, and hybrid search.

### `/ml:langchain` — LangChain & AI Agents

LCEL chain composition, LangGraph stateful agent workflows with human-in-the-loop, structured output parsing, token trimming strategies, and v0.1 → v0.2 migration warnings. The agent builds real agent systems, not toy chains.

### `/ml:huggingface` — Hugging Face Ecosystem

Text Generation Inference (TGI) deployment, Accelerate multi-GPU training, Safetensors for safe model storage, big model inference techniques, and PEFT adapter switching for multi-LoRA serving.

### `/ml:fine-tuning` — LLM Fine-Tuning

The decision that saves you weeks: fine-tune vs RAG — when each approach wins and loses. LoRA/QLoRA hyperparameter configs, quantization format comparison (GPTQ vs AWQ vs GGUF), SFTTrainer setup, and distributed training with ZeRO stages.

### `/ml:edge` — Edge & Mobile ML

Deploy models to phones and embedded devices. Core ML for iOS, TensorFlow Lite for Android, ONNX Runtime Mobile, and ML Kit. Model optimization pipeline: pruning → distillation → quantization. Federated learning patterns for privacy-preserving training.

---

## Kafka & Confluent — 5 Skills

Two complementary plugins for the complete Kafka ecosystem.

### `/kafka:streams-topology` — Kafka Streams Design

KStream vs KTable vs GlobalKTable — selection criteria. Join co-partitioning requirements (the #1 source of bugs), windowing patterns (tumbling, hopping, sliding, session), and state store configuration.

### `/kafka:n8n` — n8n Workflow Automation

Kafka trigger and producer nodes in n8n, event-driven workflow patterns, error handling with DLQ routing, batch processing, and integration patterns. Low-code meets event streaming.

### `/confluent:kafka-connect` — Debezium & CDC

Debezium CDC connector configuration for PostgreSQL and MySQL, Single Message Transform (SMT) chains, dead letter queue setup, and idempotent delivery patterns. Change Data Capture done right.

### `/confluent:ksqldb` — ksqlDB Streaming SQL

STREAM vs TABLE semantics (the fundamental concept), push vs pull queries, windowed aggregations (tumbling, hopping, session), join types with partition alignment, and materialized views for serving.

### `/confluent:schema-registry` — Schema Evolution

Compatibility mode decision table (BACKWARD, FORWARD, FULL, NONE — and when each applies), schema evolution rules, and Avro vs Protobuf vs JSON Schema comparison for schema format selection.

---

## Testing — 3 Skills

Beyond "does it work?" — does it work for everyone, under load, and are your tests actually testing anything?

### `/testing:accessibility` — Accessibility Auditing

Playwright + axe-core integration for automated accessibility testing. Scoped audits (test specific components, not the whole page), dynamic content testing (modals, tooltips, live regions), custom rule configuration, and CI gates that block inaccessible deploys.

### `/testing:performance` — Load Testing

k6 load test scenarios (stress, soak, spike — each with different purposes and thresholds), Lighthouse CI performance budgets, and resource budget enforcement. The agent writes load tests that model real traffic patterns.

### `/testing:mutation` — Mutation Testing

[Stryker Mutator](https://stryker-mutator.io/) for TypeScript/JavaScript. Mutation testing answers the question your code coverage number can't: "would my tests catch a bug?" The agent configures mutation operators, analyzes survived mutants, triages results, and integrates with CI.

---

## Payments — 2 Skills

### `/payments:billing` — Subscription Billing

The subscription state machine (active → past_due → canceled → expired, with all edge cases), dunning retry schedules (exponential backoff with grace periods), and proration calculations for plan changes and seat count adjustments.

### `/payments:pci` — PCI Compliance

SAQ type selection guide (A, A-EP, D — choose wrong and you're doing 10x the work), compliance levels by transaction volume, scope reduction strategies, and audit requirement mapping. The agent helps you stay compliant without over-engineering.

---

## Security — 1 Skill

### `/security:patterns` — Vulnerability Pattern Detection

Finds the bugs that generic linters miss:

- **GitHub Actions injection** — `${{ github.event.issue.title }}` used unsanitized in `run:` blocks
- **Unsafe deserialization** — Java, Python, and Node.js patterns that lead to RCE
- **Path traversal edge cases** — double encoding, null bytes, platform-specific bypasses
- **Template injection** — server-side template engines with user-controlled input

This isn't a linter. It's a security-aware code reviewer that understands intent.

---

## Backend — 2 Skills

### `/backend:java-spring` — Java 21 & Spring Boot 3

Virtual Threads in Spring Boot 3.x (one config flag, but the implications are deep — connection pool sizing, replacing `synchronized` with `ReentrantLock`, understanding the thread model change). Spring Security 6 lambda DSL configuration with CORS, CSRF, session management, and authorization rules.

### `/backend:rust` — Axum & Tower Middleware

Tower middleware composition for Axum (layer ordering matters — bottom-to-top wrapping), `thiserror` custom errors with `IntoResponse` for structured HTTP error handling, and the `thiserror` vs `anyhow` decision table.

---

## Blockchain — 1 Skill

### `/blockchain:blockchain-core` — Solidity & Foundry

Checks-Effects-Interactions (CEI) pattern for reentrancy prevention, Foundry fuzz and invariant testing (the agent writes property-based tests, not just happy-path assertions), gas optimization techniques (storage packing, calldata vs memory, unchecked arithmetic), and a comprehensive security audit checklist covering reentrancy, oracle manipulation, flash loans, MEV, and access control.

---

## Discovery — 1 Skill

### `/skills:scout` — Skill Discovery

The recommended starting point. Scout analyzes your project structure and recommends the right skills:

- Detects `package.json` → suggests frontend/backend plugins
- Detects `docker-compose.yml` → suggests infra plugin
- Detects `.github/workflows/` → suggests GitHub Actions skill
- Detects test files → suggests testing plugin

Search the [verified-skill.com](https://verified-skill.com) registry by keyword, browse available plugins, or install entire bundles with one command.

---

## Installation

```bash
# Install a single plugin
npx vskill install --repo anton-abyzov/vskill --plugin mobile

# Install everything
npx vskill install --repo anton-abyzov/vskill --all

# Install a specific skill by name from the registry
npx vskill install remotion-best-practices
```

Every skill is scanned before installation. No exceptions. No `--skip-scan`.

Invoke skills in your agent:

```
/mobile:appstore     "Upload this build to TestFlight"
/infra:aws           "Create an EKS cluster with IRSA"
/ml:rag              "Set up hybrid search with pgvector"
/testing:mutation    "Are my tests actually catching bugs?"
```

---

## Why Skills, Not Prompts

A prompt tells the AI what to say. A skill tells the AI what it **knows**.

Each skill is packed with:
- **Decision frameworks** — not "here are the options" but "given your constraints, use this one"
- **Real CLI tooling** — `asc`, `maestro`, `k6`, `stryker`, `cosign` — tools the agent can actually execute
- **Production patterns** — code that ships, not tutorial code
- **Anti-patterns** — what NOT to do and why (deprecated APIs, common footguns, security traps)

The result: your AI agent doesn't just generate code. It makes engineering decisions.
