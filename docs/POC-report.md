# NexusPlay — Rapport de POC

## Contexte et objectif

NexusPlay est une startup fictive qui souhaite lancer une plateforme de mini-jeux multijoueurs
disponible 24/7, avec un trafic croissant et des pics lors d'evenements communautaires. Ce POC
demontre un prototype d'architecture microservices hautement disponible et scalable repondant a ce
besoin, avec un vrai jeu fonctionnel (morpion multijoueur temps reel) plutot qu'un simple service
de demonstration, et un vrai systeme de versioning/CI-CD plutot qu'un deploiement manuel.

Le prototype est deploye sur un cluster Kubernetes local (Docker Desktop, mono-noeud) — un choix
assume qui introduit certaines limitations honnetement documentees plus bas, mais qui permet de
demontrer l'integralite de la chaine (du code au monitoring en passant par la CI/CD) sans dependre
d'un compte cloud payant.

Schema d'architecture complet : [`architecture-diagram.md`](./architecture-diagram.md).
Code source : [github.com/Yazmhog27200/NexusPlay](https://github.com/Yazmhog27200/NexusPlay).

## Le jeu

Morpion (tic-tac-toe) multijoueur temps reel : 2 joueurs sont mis en relation automatiquement
(file d'attente), jouent tour a tour via WebSocket, et le resultat (victoire/defaite/nul) est
enregistre au classement. Interface web simple (`services/frontend`), testee manuellement dans un
navigateur et de facon automatisee (`test-game.js` : simule 2 joueurs, joue une partie complete,
verifie la victoire et la mise a jour du classement).

**Design cle** : `game-service` est stateless au niveau process — l'etat de chaque partie vit dans
Redis (hash + pub/sub), et non en memoire locale. Sans cela, 2 joueurs connectes a 2 replicas
differents ne pourraient jamais se rencontrer des que le service scale horizontalement. Ce design a
ete verifie explicitement : le meme test de bout en bout, rejoue contre le cluster Kubernetes
(3 replicas de `game-service`), passe a l'identique.

## Les 10 briques techniques

### 1. Microservices (au moins 2 services distincts)
- `game-service` (Node.js, WebSocket, logique de morpion + matchmaking).
- `leaderboard-service` (Node.js/Express, API REST scores + classement).
- `frontend` (nginx, sert le client web et fait office de reverse-proxy vers les 2 services ci-dessus).

### 2. Equilibrage de charge avec redondance
Chaque service applicatif tourne en plusieurs replicas (2 a 6 selon la charge, voir HPA ci-dessous)
derriere un Service Kubernetes, qui repartit le trafic via `kube-proxy` et retire automatiquement
un pod defaillant de la rotation (readiness probe). Le Service `frontend` est de type `LoadBalancer`
— verifie que Docker Desktop le mappe automatiquement sur `localhost`, sans composant supplementaire
(pas besoin de MetalLB).

### 3. Scalabilite automatique
`HorizontalPodAutoscaler` sur `game-service` et `leaderboard-service` (metrique CPU, cible 60%,
2 a 6 replicas). **Demontre en conditions reelles** avec un test de charge k6 (150 utilisateurs
virtuels en rampe sur 3 minutes) : `leaderboard-service` est passe de 3 a 6 replicas (CPU monte a
273% de la cible), `game-service` est reste a 2 replicas (aucune charge dessus, comportement
attendu). 76 170 requetes traitees pendant le test, 0% d'echec, p95 = 748 ms.

### 4. Monitoring centralise
`kube-prometheus-stack` (Prometheus + Grafana + Alertmanager), allege pour un cluster mono-noeud
(composants de control-plane non exposes par kind desactives). Les 2 services Node exposent des
metriques Prometheus (`prom-client`) : metriques par defaut (CPU, memoire, event loop) et metriques
custom (`websocket_connections_active`, `websocket_messages_total`, `http_request_duration_seconds`).
Dashboard Grafana provisionne automatiquement avec 3 panneaux : nombre de pods par Deployment, etat
de l'autoscaling HPA, latence p95 des requetes HTTP.

### 5. Pipeline CI/CD pour les mises a jour continues
GitHub Actions avec un self-hosted runner (necessaire car le cluster Kubernetes est local, un
runner cloud ne peut pas y deployer). A chaque push sur `main` : build + push des 3 images Docker
(tag `sha-<court>` systematique, tag semver additionnel sur les tags git `vX.Y.Z`) -> rolling
update Kubernetes (`kubectl set image`) -> test de charge k6 (gate) -> notification Slack
uniquement en cas d'echec. **Verifie sur un run reel** : le tag d'image effectivement deploye dans
le cluster correspondait exactement au SHA du commit pousse.

### 6. Test de charge integre a la CI/CD
Script k6 (`loadtest/k6/ci-smoke.js`, 20 VU / 20s) rejoue apres chaque deploiement, avec des seuils
stricts (`p(95)<1000ms`, `taux d'echec <5%`) qui font echouer la pipeline si depasses — verifie en
conditions reelles lors du run de validation de la Phase 8.

### 7. Cache pour ameliorer les performances
Redis (image Valkey, fork BSD compatible pour eviter toute question de licence) utilise en
cache-aside par `leaderboard-service` (`GET /leaderboard/top`, TTL 30s, invalidation a chaque
nouveau score) et comme bus pub/sub pour l'etat de jeu partage entre les replicas de `game-service`.

### 8. Gestion securisee des secrets
HashiCorp Vault (mode dev), authentification Kubernetes configuree (ServiceAccount dedie, policy en
lecture seule, role lie au ServiceAccount de `leaderboard-service`). Les identifiants PostgreSQL
sont recuperes par un init-container au demarrage du pod (et non plus lus depuis un Secret
Kubernetes statique), ecrits dans un fichier partage lu par le conteneur applicatif. **Verifie
fonctionnellement** : apres migration, `leaderboard-service` continue de repondre normalement et
d'interroger PostgreSQL avec succes.

### 9. Notifications en cas d'incident
Alertmanager configure avec un receiver Slack (webhook stocke en Secret Kubernetes, jamais commit
dans le depot qui est public). Les alertes standard du chart (ex. pod en crash-loop) et une regle
custom (`HPAMaxedOut`, un HPA reste au maximum de replicas plus de 5 minutes) sont routees vers
Slack. **Teste de bout en bout** : une alerte de demonstration a ete declenchee et la notification
recue et confirmee dans le canal Slack `#tous-nessus-play`.

### 10. Serveur DNS hautement disponible (Active/Backup)
2 replicas `dnsmasq` derriere un Service Kubernetes. **Choix honnetement documente** : ce cluster
etant mono-noeud, une vraie VIP flottante VRRP/keepalived n'a pas de sens (il n'y a pas de 2e
machine vers laquelle basculer) — teste explicitement en Phase 0 (2 replicas en `hostNetwork` sur le
port 53 -> conflit de port confirme, `CrashLoopBackOff`). La redondance est donc assuree au niveau
Service Kubernetes (kube-proxy + readiness probe), un mecanisme different mais tout aussi reel :
**verifie** en supprimant un pod de force pendant 5 requetes DNS consecutives, 0 echec. Le vrai
mecanisme VRRP a 2 noeuds reste demontre separement dans le lab reseau precedent
(`network-ha-lab/mission1-keepalived-vip`), reference explicitement dans la documentation du
composant.

## Versioning

- Depot Git reel (github.com/Yazmhog27200/NexusPlay), commits normaux au fil des phases.
- Tags semver (`v1.0.0` : premiere version fonctionnelle du jeu ; `v1.1.0` : ajout des metriques
  Prometheus), qui declenchent le tag additionnel des images Docker avec le meme numero de version.
- Chaque image Docker porte aussi un tag `sha-<commit court>`, permettant de tracer n'importe quel
  pod en cours d'execution jusqu'au commit exact qui l'a produit.

## Limitations connues (assumees et documentees)

- **Cluster mono-noeud** : pas de vraie haute disponibilite infrastructure (perte du noeud = perte
  du cluster). La redondance demontree est au niveau applicatif/Service, pas physique. Un vrai VRRP
  a ete demontre separement dans un lab different, a 2 noeuds reels.
- **Vault en mode dev** : stockage en memoire, aucune persistance, se reinitialise a chaque
  redemarrage du pod. Explicitement inadapte a la production, choisi ici pour la simplicite de demo.
- **HPA base uniquement sur le CPU** : des metriques personnalisees (requetes/seconde, latence)
  necessiteraient un Prometheus Adapter supplementaire, hors perimetre de ce POC.
- **DNS interne statique** : `nexusplay.local` pointe vers l'IP du Service frontend au moment de la
  configuration, pas de synchronisation dynamique si ce Service etait recree.
- **Runner self-hosted en session interactive** : lance manuellement (pas en service Windows), pour
  garder acces simplement au kubeconfig/pipe Docker Desktop. Ne survit pas a une deconnexion/reboot
  sans relance manuelle — acceptable pour une demo, a revoir pour une disponibilite 24/7 reelle.

## Deroulement (pour reference)

Le prototype a ete construit et valide incrementalement, phase par phase, chaque brique testee en
conditions reelles avant de passer a la suivante (voir l'historique de commits du depot) :
de-risking environnement -> jeu local -> premier deploiement Kubernetes -> autoscaling -> monitoring
-> secrets -> notifications -> CI/CD -> DNS HA -> ce rapport.

## Conclusion

Les 10 exigences techniques et les 3 livrables demandes sont couverts par un prototype reellement
deploye et teste, pas par de la configuration ecrite mais jamais executee. Chaque brique a ete
verifiee avec des donnees concretes (nombre de requetes, taux d'echec, latences, comportement en cas
de panne simulee) plutot que supposee fonctionner. Les limitations rencontrees en cours de route
(conflit de port DNS en cluster mono-noeud, bugs d'environnement sur le runner Windows, proxy Docker
Desktop bloquant un registre) ont ete diagnostiquees et documentees plutot que contournees
silencieusement, ce qui constitue en soi une partie de la valeur de ce POC.
