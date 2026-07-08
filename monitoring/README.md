# Monitoring NexusPlay

Stack : `kube-prometheus-stack` (Prometheus + Grafana + Alertmanager) dans le namespace `monitoring`.

## Installation

```powershell
kubectl create namespace monitoring
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update
helm install kube-prometheus-stack prometheus-community/kube-prometheus-stack -n monitoring -f values-kube-prometheus-stack.yaml
```

## Notifications Slack (a faire AVANT l'install/upgrade)

Le webhook Slack n'est **jamais commit dans ce repo public**. Le creer a part :

```powershell
kubectl create secret generic alertmanager-slack -n monitoring `
  --from-literal=slack_api_url=<url du webhook Slack, format https://hooks.slack.com/services/...>
```

`values-kube-prometheus-stack.yaml` reference uniquement le **chemin du fichier monte** depuis ce
Secret (`api_url_file`), jamais l'URL elle-meme.

## Dashboard Grafana

```powershell
kubectl create configmap nexusplay-overview-dashboard -n monitoring --from-file=dashboards/nexusplay-overview.json
kubectl label configmap nexusplay-overview-dashboard -n monitoring grafana_dashboard=1
```

Acces :
```powershell
kubectl port-forward -n monitoring svc/kube-prometheus-stack-grafana 3001:80
```
puis http://localhost:3001 (admin / voir `adminPassword` dans values-kube-prometheus-stack.yaml).

## Alertes

`alerting/nexusplay-rules.yaml` : regle `HPAMaxedOut` (un HPA reste au maximum de replicas plus de
5 minutes -> notification Slack). Les regles par defaut du chart (ex. `KubePodCrashLooping`, seuil
15 minutes) sont aussi routees vers Slack via le receiver par defaut.

Test rapide du pipeline Alertmanager -> Slack (sans attendre 15 min) : appliquer une regle de test
avec `expr: vector(1) == 1` et un `for` court (~30s), verifier la reception dans Slack, puis la
supprimer. C'est ce qui a ete fait pour valider la Phase 7 (voir POC report).
