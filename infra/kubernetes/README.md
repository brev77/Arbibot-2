# Arbibot 2 — Kubernetes Manifests (Phase D)

**Статус:** Phase D Reference — НЕ для paper deploy
**Дата:** 2026-06-13
**Scope:** K8s manifests для масштабирования за пределы docker-compose prod stack.

> ⚠️ **Не использовать для paper deploy.** Текущий canonical deployment target — `infra/docker-compose.prod.yml`. K8s манифесты ниже — reference implementation для Phase D, когда docker-compose перестанет справляться или потребуется cloud-managed k8s (EKS/GKE/AKS).

---

## Когда переходить с docker-compose на K8s

| Критерий | Threshold | Текущее состояние |
|----------|-----------|-------------------|
| Concurrent services | >30 контейнеров | 15 (✅ compose OK) |
| Multi-region deploy | требуется | нет |
| Auto-scaling | требуется | нет (paper trading) |
| Blue-green / canary | требуется | нет |
| Managed DB/Redis | требуется | нет (self-hosted) |
| Multi-tenancy | требуется | нет |

**Рекомендация:** остаться на docker-compose пока активна paper trading фаза. Переход на K8s оправдан при:
- Live capital на mainnet + рост volume в 10x
- Появлении региональных инстансов
- Команде ops > 5 человек

---

## Структура манифестов

```
infra/kubernetes/
├── README.md                        # этот файл
├── namespace.yml                    # namespace + labels
├── configmaps.yml                   # non-sensitive config
├── secrets.yml.example              # template для kubectl create secret
├── postgres-statefulset.yml         # PostgreSQL (StatefulSet + PVC + Service)
├── redis-statefulset.yml            # Redis (StatefulSet + PVC + Service)
├── redpanda-statefulset.yml         # Redpanda (StatefulSet + PVC + Service)
├── nest-deployments.yml             # 12 NestJS services (Deployment + Service per app)
├── web-deployment.yml               # Next.js operator web (Deployment + Service)
├── hermes-gateway-deployment.yml    # HERMES gateway
├── nginx-ingress.yml                # nginx Ingress (TLS termination)
├── observability/                   # Prometheus, Grafana, Loki, Promtail, Alertmanager
│   ├── prometheus.yml
│   ├── grafana.yml
│   ├── dashboards.yml
│   ├── loki.yml
│   ├── promtail-daemonset.yml
│   └── alertmanager.yml
├── networkpolicies.yml              # NetworkPolicy для изоляции (аналог docker network)
├── poddisruptionbudgets.yml         # PDB для maintenance windows
├── horizontalpodautoscalers.yml     # HPA для autoscaling
└── kustomization.yaml               # Kustomize для multi-env overlays
```

---

## Namespace + базовая конфигурация

### `namespace.yml`
```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: arbibot
  labels:
    app.kubernetes.io/part-of: arbibot
    app.kubernetes.io/managed-by: kustomize
    security.arbibot/allow-egress: "false"  # default deny, NetworkPolicy разблокирует
---
apiVersion: v1
kind: ResourceQuota
metadata:
  name: arbibot-quota
  namespace: arbibot
spec:
  hard:
    requests.cpu: "20"
    requests.memory: 40Gi
    limits.cpu: "40"
    limits.memory: 80Gi
    persistentvolumeclaims: "10"
    services.loadbalancers: "2"
```

---

## NestJS services — Deployment pattern

Для всех 12 NestJS сервисов одинаковый шаблон, отличается только `metadata.name`, `image`, `port`, env vars.

### `nest-deployments.yml` (фрагмент — risk-service)

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: risk-service
  namespace: arbibot
  labels:
    app.kubernetes.io/name: risk-service
    app.kubernetes.io/part-of: arbibot
    app.kubernetes.io/component: backend
spec:
  replicas: 2  # HA: минимум 2 реплики
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 0
      maxSurge: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: risk-service
  template:
    metadata:
      labels:
        app.kubernetes.io/name: risk-service
        app.kubernetes.io/part-of: arbibot
        app.kubernetes.io/component: backend
      annotations:
        # Force redeploy on config change
        kubectl.kubernetes.io/restartedAt: "2026-06-13T00:00:00Z"
        prometheus.io/scrape: "true"
        prometheus.io/port: "3000"
        prometheus.io/path: "/metrics"
    spec:
      serviceAccountName: arbibot-backend
      securityContext:
        runAsNonRoot: true
        runAsUser: 1001
        runAsGroup: 1001
        fsGroup: 1001
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: risk-service
          image: ghcr.io/brev77/arbibot-2/risk-service:latest
          imagePullPolicy: IfNotPresent
          ports:
            - name: http
              containerPort: 3000
              protocol: TCP
          envFrom:
            - configMapRef:
                name: arbibot-shared-config
            - secretRef:
                name: risk-service-secrets
          env:
            - name: NODE_ENV
              value: "production"
            - name: PORT
              value: "3000"
            - name: POD_NAME
              valueFrom:
                fieldRef:
                  fieldPath: metadata.name
            - name: POD_NAMESPACE
              valueFrom:
                fieldRef:
                  fieldPath: metadata.namespace
          resources:
            requests:
              cpu: "250m"
              memory: "512Mi"
            limits:
              cpu: "1000m"
              memory: "1Gi"
          readinessProbe:
            httpGet:
              path: /metrics
              port: http
            initialDelaySeconds: 15
            periodSeconds: 10
            timeoutSeconds: 5
            failureThreshold: 3
          livenessProbe:
            httpGet:
              path: /metrics
              port: http
            initialDelaySeconds: 60
            periodSeconds: 30
            timeoutSeconds: 5
            failureThreshold: 3
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
            runAsNonRoot: true
            runAsUser: 1001
          volumeMounts:
            - name: tmp
              mountPath: /tmp
            - name: tls
              mountPath: /etc/ssl/arbibot
              readOnly: true
      volumes:
        - name: tmp
          emptyDir: {}
        - name: tls
          secret:
            secretName: risk-service-tls
            defaultMode: 0400
      affinity:
        podAntiAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
            - weight: 100
              podAffinityTerm:
                labelSelector:
                  matchLabels:
                    app.kubernetes.io/name: risk-service
                topologyKey: kubernetes.io/hostname
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: topology.kubernetes.io/zone
          whenUnsatisfiable: ScheduleAnyway
          labelSelector:
            matchLabels:
              app.kubernetes.io/name: risk-service
      tolerations:
        - key: "dedicated"
          operator: "Equal"
          value: "arbibot"
          effect: "NoSchedule"
---
apiVersion: v1
kind: Service
metadata:
  name: risk-service
  namespace: arbibot
spec:
  type: ClusterIP
  selector:
    app.kubernetes.io/name: risk-service
  ports:
    - name: http
      port: 80
      targetPort: http
      protocol: TCP
```

**Аналогично для других 11 NestJS сервисов** (opportunity, capital, execution, audit, canonical-market, market-intake, portfolio, reconciliation, paper-trading, config, hermes-gateway). Каждый со своим `port` (3000–3020).

---

## StatefulSet: PostgreSQL

### `postgres-statefulset.yml`
```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgres
  namespace: arbibot
spec:
  serviceName: postgres
  replicas: 1  # Primary only; read replicas via Patroni если потребуется
  selector:
    matchLabels:
      app.kubernetes.io/name: postgres
  template:
    metadata:
      labels:
        app.kubernetes.io/name: postgres
    spec:
      securityContext:
        fsGroup: 999  # postgres GID in official image
      containers:
        - name: postgres
          image: postgres:16-alpine
          ports:
            - name: tcp-pg
              containerPort: 5432
          env:
            - name: POSTGRES_DB
              valueFrom:
                secretKeyRef:
                  name: postgres-secrets
                  key: database
            - name: POSTGRES_USER
              valueFrom:
                secretKeyRef:
                  name: postgres-secrets
                  key: username
            - name: POSTGRES_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: postgres-secrets
                  key: password
          resources:
            requests:
              cpu: "1"
              memory: "2Gi"
            limits:
              cpu: "4"
              memory: "8Gi"
          volumeMounts:
            - name: data
              mountPath: /var/lib/postgresql/data
          readinessProbe:
            exec:
              command: ["pg_isready", "-U", "$(POSTGRES_USER)"]
            initialDelaySeconds: 30
            periodSeconds: 10
          livenessProbe:
            tcpSocket:
              port: tcp-pg
            initialDelaySeconds: 60
            periodSeconds: 30
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        storageClassName: fast-ssd
        resources:
          requests:
            storage: 100Gi
---
apiVersion: v1
kind: Service
metadata:
  name: postgres
  namespace: arbibot
spec:
  type: ClusterIP
  selector:
    app.kubernetes.io/name: postgres
  ports:
    - name: tcp-pg
      port: 5432
      targetPort: tcp-pg
```

> **Рекомендация для production:** использовать managed PostgreSQL (AWS RDS, GCP Cloud SQL, Azure Database) вместо self-hosted StatefulSet. Это снимает backup, replication, patching с команды ops.

---

## ConfigMap (shared non-sensitive config)

### `configmaps.yml`
```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: arbibot-shared-config
  namespace: arbibot
data:
  NODE_ENV: "production"
  LOG_LEVEL: "info"
  CORS_ORIGINS: "https://arbibot.example.com"
  # Service URLs (K8s DNS)
  RISK_SERVICE_URL: "http://risk-service"
  OPPORTUNITY_SERVICE_URL: "http://opportunity-service"
  CAPITAL_SERVICE_URL: "http://capital-service"
  EXECUTION_SERVICE_URL: "http://execution-orchestrator"
  AUDIT_SERVICE_URL: "http://audit-service"
  CANONICAL_MARKET_SERVICE_URL: "http://canonical-market-service"
  MARKET_INTAKE_SERVICE_URL: "http://market-intake-service"
  PORTFOLIO_SERVICE_URL: "http://portfolio-service"
  RECONCILIATION_SERVICE_URL: "http://reconciliation-service"
  PAPER_TRADING_SERVICE_URL: "http://paper-trading-service"
  CONFIG_SERVICE_URL: "http://config-service"
  HERMES_GATEWAY_URL: "http://hermes-gateway"
  # Feature flags
  DEX_LIVE_KILL_SWITCH: "true"
  AUDIT_CLIENT_ENABLED: "true"
```

---

## Secrets

### `secrets.yml.example`
```yaml
# Template — реальные секреты создаются через:
#   kubectl create secret generic postgres-secrets \
#     --from-literal=database=arbibot \
#     --from-literal=username=arbibot_app \
#     --from-literal=password=$(openssl rand -base64 32) \
#     -n arbibot
#
# Или через Sealed Secrets / External Secrets Operator / Vault Agent Injector.

apiVersion: v1
kind: Secret
metadata:
  name: postgres-secrets
  namespace: arbibot
type: Opaque
stringData:
  database: "REPLACE_VIA_KUBECTL"
  username: "REPLACE_VIA_KUBECTL"
  password: "REPLACE_VIA_KUBECTL"
```

**Для production** предпочтительно использовать:
- **External Secrets Operator** + Vault (см. `docs/vault-integration-guide.md`)
- **Sealed Secrets** (Bitnami) — encrypt-in-git
- **Cloud KMS** + CSI Secrets Store

---

## NetworkPolicies (аналог docker network isolation)

### `networkpolicies.yml`
```yaml
# Default deny all ingress/egress в namespace
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: arbibot
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress
---
# Разрешить ingress к nginx-ingress из internet (через LoadBalancer)
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-ingress-to-nginx
  namespace: arbibot
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/name: nginx-ingress
  policyTypes:
    - Ingress
  ingress:
    - from:
        - ipBlock:
            cidr: 0.0.0.0/0
      ports:
        - protocol: TCP
          port: 80
        - protocol: TCP
          port: 443
---
# Разрешить backend сервисам ходить в PostgreSQL/Redis/Redpanda
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-backend-to-datastores
  namespace: arbibot
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/component: backend
  policyTypes:
    - Egress
  egress:
    - to:
        - podSelector:
            matchLabels:
              app.kubernetes.io/name: postgres
        - podSelector:
            matchLabels:
              app.kubernetes.io/name: redis
        - podSelector:
            matchLabels:
              app.kubernetes.io/name: redpanda
      ports:
        - protocol: TCP
          port: 5432
        - protocol: TCP
          port: 6379
        - protocol: TCP
          port: 9092
    # DNS
    - to:
        - namespaceSelector: {}
          podSelector:
            matchLabels:
              k8s-app: kube-dns
      ports:
        - protocol: UDP
          port: 53
    # HTTPS egress для bridge APIs, DEX RPCs
    - to:
        - ipBlock:
            cidr: 0.0.0.0/0
            except:
              - 10.0.0.0/8
              - 172.16.0.0/12
              - 192.168.0.0/16
      ports:
        - protocol: TCP
          port: 443
---
# Observability isolation — только Prometheus может скрапить метрики
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-prometheus-scrape
  namespace: arbibot
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/component: backend
  policyTypes:
    - Ingress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: arbibot-observability
          podSelector:
            matchLabels:
              app.kubernetes.io/name: prometheus
      ports:
        - protocol: TCP
          port: 3000  # /metrics
```

---

## Ingress (nginx)

### `nginx-ingress.yml`
```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: arbibot-ingress
  namespace: arbibot
  annotations:
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
    nginx.ingress.kubernetes.io/rate-limit-connections: "100"
    nginx.ingress.kubernetes.io/rate-limit-requests: "500"
    nginx.ingress.kubernetes.io/proxy-body-size: "10m"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "60"
    nginx.ingress.kubernetes.io/configuration-snippet: |
      more_set_headers "X-Frame-Options: DENY";
      more_set_headers "X-Content-Type-Options: nosniff";
      more_set_headers "X-XSS-Protection: 1; mode=block";
      more_set_headers "Referrer-Policy: strict-origin-when-cross-origin";
      more_set_headers "Permissions-Policy: geolocation=(), microphone=(), camera=()";
spec:
  ingressClassName: nginx
  tls:
    - hosts: [arbibot.example.com]
      secretName: arbibot-tls
  rules:
    - host: arbibot.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: web
                port:
                  number: 80
    - host: api.arbibot.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: hermes-gateway
                port:
                  number: 80
```

---

## PodDisruptionBudgets

### `poddisruptionbudgets.yml`
```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: risk-service-pdb
  namespace: arbibot
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: risk-service
---
# Аналогично для других stateless сервисов (opportunity, capital, execution, ...)
# Для stateful (postgres) — minAvailable: 1, never voluntary evict
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: postgres-pdb
  namespace: arbibot
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: postgres
```

---

## HorizontalPodAutoscalers

### `horizontalpodautoscalers.yml`
```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: risk-service-hpa
  namespace: arbibot
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: risk-service
  minReplicas: 2
  maxReplicas: 6
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 60
      policies:
        - type: Percent
          value: 50
          periodSeconds: 60
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
        - type: Percent
          value: 25
          periodSeconds: 60
---
# Аналогично для execution-orchestrator (CPU-bound), opportunity-service
# Paper/capital — без HPA (sticky sessions, state)
```

---

## Kustomize multi-env overlays

### `kustomization.yaml` (base)
```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

namespace: arbibot

resources:
  - namespace.yml
  - configmaps.yml
  - postgres-statefulset.yml
  - redis-statefulset.yml
  - redpanda-statefulset.yml
  - nest-deployments.yml  # contains all 12 NestJS services
  - web-deployment.yml
  - hermes-gateway-deployment.yml
  - nginx-ingress.yml
  - observability/
  - networkpolicies.yml
  - poddisruptionbudgets.yml
  - horizontalpodautoscalers.yml

commonLabels:
  app.kubernetes.io/part-of: arbibot
  app.kubernetes.io/managed-by: kustomize

images:
  - name: ghcr.io/brev77/arbibot-2/risk-service
    newTag: latest
  # ... остальные образы
```

### `overlays/staging/kustomization.yaml`
```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

namespace: arbibot-staging

resources:
  - ../../base

patches:
  - target:
      kind: Deployment
    patch: |-
      - op: replace
        path: /spec/replicas
        value: 1  # single replica в staging
  - target:
      kind: HorizontalPodAutoscaler
    patch: |-
      - op: replace
        path: /spec/maxReplicas
        value: 2

configMapGenerator:
  - name: arbibot-shared-config
    behavior: merge
    literals:
      - NODE_ENV=staging
      - LOG_LEVEL=debug
```

---

## Deployment Workflow

```bash
# 1. Создать namespace
kubectl apply -f infra/kubernetes/namespace.yml

# 2. Создать secrets (через Vault External Secrets Operator в prod)
kubectl create secret generic postgres-secrets \
  --from-literal=database=arbibot \
  --from-literal=username=arbibot_app \
  --from-literal=password=$(openssl rand -base64 32) \
  -n arbibot

# 3. Apply base manifests
kubectl apply -k infra/kubernetes/

# Или для staging overlay
kubectl apply -k infra/kubernetes/overlays/staging/

# 4. Проверить rollout
kubectl rollout status deployment/risk-service -n arbibot
kubectl rollout status deployment/execution-orchestrator -n arbibot

# 5. Verify
npm run verify:deployment  # работает против любого target через env overrides
```

---

## Monitoring & Observability

- **Prometheus Operator** (kube-prometheus-stack) — рекомендуется вместо raw manifests.
- **Grafana** через Helm chart.
- **Loki Stack** (loki + promtail) через Helm.
- Дашборды из `infra/grafana/dashboards/` автоматически подхватываются через ConfigMap или sidecar.

См. также `infra/prometheus/prometheus.yml`, `infra/grafana/dashboards/`.

---

## Helm Charts (альтернатива raw manifests)

Если в команде есть опыт с Helm, предпочтительнее упаковать Arbibot в Helm chart:

```
charts/arbibot/
├── Chart.yaml
├── values.yaml              # defaults
├── values-production.yaml   # overrides
└── templates/
    ├── _helpers.tpl
    ├── deployment.yaml      # одна шаблонизируемая Deployment per service
    ├── service.yaml
    ├── ingress.yaml
    ├── configmap.yaml
    ├── secret.yaml
    └── NOTES.txt
```

Преимущества Helm:
- Параметризация replicas, resources, image tags через `values.yaml`.
- `helm upgrade --install` — atomic rollout.
- `helm rollback` — одношаговый rollback.
- Интеграция с ArgoCD / Flux для GitOps.

---

## Acceptance Criteria для Phase D

- [ ] K8s cluster развёрнут (EKS/GKE/AKS/self-managed).
- [ ] Все 15 сервисов деплоятся через `kubectl apply -k`.
- [ ] NetworkPolicies протестированы (deny по умолчанию работает).
- [ ] PersistentVolumes для Postgres/Redis/Redpanda настроены.
- [ ] Ingress + TLS certs (cert-manager) работают.
- [ ] HPA тестируется под нагрузкой (scale-up/scale-down).
- [ ] PDB тестируется при voluntary disruptions (kubectl drain).
- [ ] Observability стек подтянут (kube-prometheus-stack).
- [ ] External Secrets Operator + Vault интегрирован.
- [ ] Disaster recovery: etcd backup, PVC snapshots.
- [ ] Runbook `docs/k8s-runbook.md` создан.
- [ ] Paper trading успешно гоняется на K8s неделю перед live.

---

## References

- Kubernetes Docs — https://kubernetes.io/docs/
- Kustomize — https://kustomize.io/
- Prometheus Operator — https://prometheus-operator.dev/
- External Secrets Operator — https://external-secrets.io/
- `docs/deployment-readiness-assessment.md` — assessment matrix
- `docs/vault-integration-guide.md` — secret management
- `docs/security-hardening-guide.md` — security roadmap
- `infra/docker-compose.prod.yml` — canonical compose target (пока K8s не нужен)