# L'Ardoise

Une app Android simple pour noter à la voix ou au clavier ses tâches, rendez-vous, rappels et pense-bêtes datés. C'est une application web installable (PWA) qui fonctionne hors ligne. Les notes sont enregistrées uniquement sur le téléphone.

L'Ardoise remplace le bot Telegram « Daily Notes ».

## Les 3 versions

| Version | Où | Rôle | Icône |
|---|---|---|---|
| **LOCAL** | `http://localhost:8080` sur le PC | Développer et tester à chaud | balise LOCAL |
| **TEST** | `https://<compte>.github.io/ardoise-test/` | Valider sur un téléphone | badge orange « T », « Ardoise T » |
| **PROD** | `https://<compte>.github.io/ardoise/` | Usage réel sur les téléphones | « L'Ardoise » |

Chaque version garde ses propres données. Tester en TEST ne touche donc jamais les vraies notes.

## Mise en route (une seule fois)

```powershell
cd F:\ARDOISE
.\tools\setup-github.ps1
```

Ce script ouvre la connexion GitHub si besoin, puis crée les dépôts `ardoise-test` et `ardoise`.

## Cycle de travail

1. **Modifier, puis tester sur le PC** : lancer `.\tools\serve.ps1`. Chrome s'ouvre sur la version LOCAL. Recharger la page (F5) suffit à voir les changements.
2. **Envoyer en TEST** : lancer `.\tools\deploy.ps1 test`. Le script enregistre les modifications et propose d'augmenter le numéro de version. Le site est en ligne 1 à 2 minutes après.
3. **Valider sur le téléphone**, avec l'app « Ardoise T » (orange).
4. **Publier en PROD** : lancer `.\tools\deploy.ps1 prod`, puis taper `OUI` pour confirmer. Seul le code déjà passé par TEST est accepté.

## Installer sur un téléphone

1. Ouvrir l'adresse PROD (ou TEST) dans **Chrome**.
2. Menu ⋮ → **Ajouter à l'écran d'accueil** → **Installer**.
3. L'app apparaît parmi les applications. Elle s'ouvre en plein écran et fonctionne sans réseau.

## Mises à jour automatiques

À chaque ouverture de l'app avec du réseau, L'Ardoise vérifie si une nouvelle version existe et se met à jour toute seule, sans toucher aux notes. Le déclencheur est **le numéro de version dans `version.js`** ; `deploy.ps1 test` le fait évoluer pour toi.

## Services n8n

L'app n'appelle qu'un seul service : l'API de L'Ardoise sur n8n (`https://monn8n06.duckdns.org`). Aucun secret n'est dans le code : chaque téléphone a un **jeton** personnel, saisi une fois dans les Réglages et révocable dans n8n.

| Workflow | Rôle | Adresse |
|---|---|---|
| ardoise · api · test / prod | Analyse d'une note (texte ou voix) par l'IA ; abonnement aux notifications | `/webhook/ardoise-test/api` · `/webhook/ardoise/api` |
| ardoise · reveil · test / prod | Chaque jour à 7 h, réveille tous les téléphones abonnés pour le récap du matin | (planifié) |

n8n ne garde ni texte, ni audio, ni note : seulement, pour chaque téléphone, l'empreinte de son jeton et son adresse d'abonnement aux notifications.

## Fichiers

```
index.html                 page de l'app
css/app.css                styles (clair / sombre / auto)
js/app.js                  logique
version.js                 numéro de version (déclenche les mises à jour)
sw.js                      service worker : hors ligne, mise à jour, notifications
manifest*.webmanifest      fiches d'installation (PROD / TEST)
icons/                     icônes (PROD, et TEST avec badge orange « T »)
tools/                     serve.ps1, setup-github.ps1, deploy.ps1
```

## Plus tard : Play Store

La même PWA peut être emballée en application Play Store (format « Trusted Web Activity »), sans réécrire le code.
