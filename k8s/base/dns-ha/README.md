# DNS haute disponibilite (NexusPlay)

## Choix d'architecture : redondance niveau Service, pas VRRP

Ce cluster Kubernetes est **mono-noeud** (Docker Desktop / kind). Un vrai mecanisme de VIP flottante
(VRRP/keepalived, comme demontre dans `network-ha-lab/mission1-keepalived-vip`) suppose au moins
2 noeuds reels pour avoir un sens : la VIP doit pouvoir "sauter" d'une machine a une autre quand l'une
tombe. Ici, il n'y a qu'une seule machine sous-jacente.

**Teste et confirme (Phase 0 du projet)** : faire tourner 2 replicas d'un service DNS en
`hostNetwork: true` (necessaire pour VRRP/port 53 au niveau hote) sur ce cluster mono-noeud provoque
un conflit de port immediat — le 2e pod part en `CrashLoopBackOff` puisque les deux replicas essaient
de biner le meme port 53 sur le meme et seul noeud. Ce n'est pas un bug de config, c'est une
consequence directe de n'avoir qu'un seul noeud.

**Solution retenue ici** : 2 replicas `dnsmasq` (sans hostNetwork) derriere un Service Kubernetes
classique (`ClusterIP`). C'est une redondance reelle et differente de VRRP :
- kube-proxy repartit les requetes DNS entre les 2 pods (equivalent fonctionnel d'un load balancer).
- Si un pod meurt, sa `readinessProbe` (verification TCP du port 53) le sort de la rotation en
  quelques secondes, et le Deployment le remplace automatiquement — teste : 5 resolutions DNS
  consecutives pendant qu'un pod etait force-delete, 0 echec.
- Difference cle avec VRRP : ici c'est le **Service** qui route vers un pod vivant (niveau 4, apres
  connexion), alors que VRRP deplace une **adresse IP** vers une autre machine (niveau reseau, avant
  toute connexion). Les deux resolvent "un client ne doit pas voir la panne", par des mecanismes
  differents adaptes a des topologies differentes.

Le vrai VRRP/keepalived (topologie a 2 machines) reste demontre separement dans
[`network-ha-lab/mission1-keepalived-vip`](../../../../network-ha-lab/mission1-keepalived-vip/) —
voir ce dossier pour la version "2 noeuds reels + VIP flottante".

## Test

```powershell
kubectl apply -f configmap.yaml -f deployment.yaml -f service.yaml
kubectl get pods -n nexusplay -l app=dns-ha

$svcIp = kubectl get svc dns-ha -n nexusplay -o jsonpath='{.spec.clusterIP}'
kubectl run dns-test --image=alpine:3.19 --restart=Never -n nexusplay -- sh -c "apk add --no-cache bind-tools >/dev/null 2>&1 && sleep 3600"
kubectl exec -n nexusplay dns-test -- dig +short "nexusplay.local." "@$svcIp"
# -> IP du Service frontend

# Resilience : supprimer un pod et revérifier
$pod1 = kubectl get pods -n nexusplay -l app=dns-ha -o jsonpath='{.items[0].metadata.name}'
kubectl delete pod $pod1 -n nexusplay --grace-period=0 --force
kubectl exec -n nexusplay dns-test -- dig +short "nexusplay.local." "@$svcIp"
# -> resout toujours, sans interruption

kubectl delete pod dns-test -n nexusplay
```
