---
description: GCP expert for GKE Autopilot with Terraform, Cloud Run service deployment, and Workload Identity Federation patterns.
allowed-tools: Read, Write, Edit, Bash
model: opus
context: fork
---

# GCP Infrastructure

## GKE Autopilot Configuration with Terraform

```hcl
resource "google_container_cluster" "autopilot" {
  name     = "gke-${var.project_name}-${var.environment}"
  location = var.region

  enable_autopilot = true

  network    = var.vpc_id
  subnetwork = var.subnet_id

  ip_allocation_policy {
    cluster_secondary_range_name  = "pods"
    services_secondary_range_name = "services"
  }

  private_cluster_config {
    enable_private_nodes    = true
    enable_private_endpoint = var.environment == "production"
    master_ipv4_cidr_block  = "172.16.0.0/28"
  }

  master_authorized_networks_config {
    dynamic "cidr_blocks" {
      for_each = var.authorized_networks
      content {
        cidr_block   = cidr_blocks.value.cidr
        display_name = cidr_blocks.value.name
      }
    }
  }

  workload_identity_config {
    workload_pool = "${var.project_id}.svc.id.goog"
  }

  release_channel {
    channel = var.environment == "production" ? "REGULAR" : "RAPID"
  }

  logging_config {
    enable_components = ["SYSTEM_COMPONENTS", "WORKLOADS"]
  }

  monitoring_config {
    enable_components = ["SYSTEM_COMPONENTS", "DAEMONSET", "DEPLOYMENT", "STATEFULSET"]
    managed_prometheus { enabled = true }
  }

  binary_authorization {
    evaluation_mode = var.environment == "production" ? "PROJECT_SINGLETON_POLICY_ENFORCE" : "DISABLED"
  }

  maintenance_policy {
    recurring_window {
      start_time = "2024-01-01T02:00:00Z"
      end_time   = "2024-01-01T06:00:00Z"
      recurrence = "FREQ=WEEKLY;BYDAY=TU,WE,TH"
    }
  }
}
```

### GKE Standard vs Autopilot

```
┌──────────────────────┬──────────────────────┬──────────────────────┐
│ Criteria             │ GKE Standard         │ GKE Autopilot        │
├──────────────────────┼──────────────────────┼──────────────────────┤
│ Node management      │ You manage           │ Google manages       │
│ Pricing              │ Pay for nodes        │ Pay for pods         │
│ GPU / TPU            │ Full support         │ Supported            │
│ DaemonSets           │ Full control         │ Restricted           │
│ Privileged pods      │ Allowed              │ Not allowed          │
│ Security posture     │ You harden           │ Pre-hardened         │
│ Scale to zero        │ Manual               │ Built-in             │
│ Best for             │ Complex workloads    │ Most workloads       │
└──────────────────────┴──────────────────────┴──────────────────────┘

RULE: Default to Autopilot. Use Standard for DaemonSets, privileged pods,
      custom node images, GPU/ML with specific node configs.
```

## Cloud Run Service Deployment

```hcl
resource "google_cloud_run_v2_service" "api" {
  name     = "api-${var.environment}"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"

  template {
    service_account = google_service_account.run_sa.email
    scaling {
      min_instance_count = var.environment == "production" ? 2 : 0
      max_instance_count = 100
    }
    containers {
      image = "${var.region}-docker.pkg.dev/${var.project_id}/${var.repo}/api:${var.image_tag}"
      ports { container_port = 8080 }
      resources {
        limits            = { cpu = "2", memory = "1Gi" }
        cpu_idle          = var.environment != "production"
        startup_cpu_boost = true
      }
      env {
        name  = "DB_HOST"
        value = "/cloudsql/${google_sql_database_instance.main.connection_name}"
      }
      env {
        name = "DB_PASSWORD"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.db_password.secret_id
            version = "latest"
          }
        }
      }
      startup_probe {
        http_get { path = "/healthz" }
        initial_delay_seconds = 5
        period_seconds        = 10
        failure_threshold     = 3
      }
      liveness_probe {
        http_get { path = "/healthz" }
        period_seconds = 30
      }
    }
    vpc_access {
      network_interfaces { network = var.vpc_id; subnetwork = var.subnet_id }
      egress = "PRIVATE_RANGES_ONLY"
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }
}

resource "google_cloud_run_v2_service_iam_member" "invoker" {
  name     = google_cloud_run_v2_service.api.name
  location = var.region
  role     = "roles/run.invoker"
  member   = var.public_api ? "allUsers" : "serviceAccount:${var.invoker_sa_email}"
}
```

## Workload Identity Setup

```hcl
resource "google_service_account" "app_sa" {
  account_id   = "myapp-workload"
  display_name = "MyApp Workload Service Account"
}

# Bind GKE K8s SA to GCP SA
resource "google_service_account_iam_binding" "workload_identity" {
  service_account_id = google_service_account.app_sa.name
  role               = "roles/iam.workloadIdentityUser"
  members = [
    "serviceAccount:${var.project_id}.svc.id.goog[production/myapp-sa]"
  ]
}

# Grant least-privilege roles
resource "google_project_iam_member" "app_storage" {
  project = var.project_id
  role    = "roles/storage.objectViewer"
  member  = "serviceAccount:${google_service_account.app_sa.email}"
}

# Disable SA key creation (enforce Workload Identity)
resource "google_project_organization_policy" "disable_sa_keys" {
  project    = var.project_id
  constraint = "iam.disableServiceAccountKeyCreation"
  boolean_policy { enforced = true }
}
```

```yaml
# Kubernetes ServiceAccount linked to GCP SA
apiVersion: v1
kind: ServiceAccount
metadata:
  name: myapp-sa
  namespace: production
  annotations:
    iam.gke.io/gcp-service-account: myapp-workload@my-project-id.iam.gserviceaccount.com
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
  namespace: production
spec:
  template:
    spec:
      serviceAccountName: myapp-sa
      nodeSelector:
        iam.gke.io/gke-metadata-server-enabled: "true"
      containers:
        - name: myapp
          image: us-central1-docker.pkg.dev/my-project-id/myapp/api:latest
```
