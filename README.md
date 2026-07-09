# NexusPlay

Architecture microservices hautement disponible et scalable pour une plateforme de mini-jeux
multijoueurs — projet de POC. Jeu implemente : **morpion multijoueur en temps reel** (WebSocket),
avec classement des joueurs.

- **Schema d'architecture** : [`docs/architecture-diagram.md`](docs/architecture-diagram.md)
- **Rapport de POC complet** : [`docs/POC-report.md`](docs/POC-report.md)
- **Video de demo** (montee en charge + alerting Slack) : [`docs/videos/NexusPlay_Demo_Autoscaling_Slack.mp4`](docs/videos/NexusPlay_Demo_Autoscaling_Slack.mp4)

## Stack

| Brique | Technologie |
|---|---|
| Jeu temps reel | Node.js, WebSocket (`ws`), Redis (etat partage + pub/sub) |
| Classement | Node.js, Express, PostgreSQL, cache Redis |
| Frontend | nginx (reverse proxy + client web statique) |
| Orchestration | Kubernetes (Docker Desktop local) |
| Autoscaling | Horizontal Pod Autoscaler (CPU) |
| Monitoring | Prometheus, Grafana, Alertmanager (kube-prometheus-stack) |
| Secrets | HashiCorp Vault (auth Kubernetes) |
| CI/CD | GitHub Actions (self-hosted runner) |
| Test de charge | k6 |
| Notifications | Slack (via Alertmanager + pipeline CI/CD) |
| DNS interne HA | dnsmasq (2 replicas + Service Kubernetes) |

## Structure du depot

```
services/
  game-service/         Service de jeu (WebSocket + Redis)
  leaderboard-service/  Service de classement (REST + Postgres + cache)
  frontend/             Client web + reverse proxy nginx
k8s/base/                Manifests Kubernetes (un dossier par composant)
monitoring/               Config Prometheus/Grafana/Alertmanager (Helm values, dashboards, regles)
loadtest/k6/               Scripts de test de charge (demo manuelle + gate CI/CD)
.github/workflows/         Pipeline CI/CD
docs/                       Schema d'architecture + rapport de POC
```

## Demarrage local (Docker Compose)

```powershell
docker compose up -d --build
```
Puis ouvrir http://localhost:8090 dans 2 onglets pour jouer une partie.

## Deploiement Kubernetes

```powershell
kubectl apply -f k8s/base/namespace.yaml
kubectl apply -f k8s/base/redis/
kubectl apply -f k8s/base/postgres/
kubectl apply -f k8s/base/game-service/
kubectl apply -f k8s/base/leaderboard-service/
kubectl apply -f k8s/base/frontend/
kubectl apply -f k8s/base/vault/
kubectl apply -f k8s/base/dns-ha/
```
Puis ouvrir http://localhost (Docker Desktop mappe automatiquement le Service `LoadBalancer` du
frontend sur `localhost`).

Monitoring : voir [`monitoring/README.md`](monitoring/README.md).
DNS HA : voir [`k8s/base/dns-ha/README.md`](k8s/base/dns-ha/README.md).

## CI/CD

Push sur `main` -> build & push des images Docker Hub -> rolling update Kubernetes -> test de
charge k6 (gate) -> notification Slack en cas d'echec. Voir
[`.github/workflows/ci-cd.yml`](.github/workflows/ci-cd.yml).

## Versioning

Tags git semver (`vX.Y.Z`) + tags d'image Docker `sha-<commit court>` sur chaque build. Voir les
[releases](https://github.com/Yazmhog27200/NexusPlay/tags).
