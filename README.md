# Actualités — Parlement de la rivière Isère

Grille d'affichage des actualités du Parlement de la rivière Isère.
Application statique (HTML/CSS/JS vanille, zéro build, zéro base de
données) : un carrousel de cartes en 3 lignes × 3 colonnes (9 cartes
visibles), servi par GitHub Pages.

**URL publique :** https://konsilion.github.io/actualites-parlement-riviere-isere/

Direction artistique : calque strict de la vitrine Zotero
(https://konsilion.github.io/zotero-parlement-riviere-isere/) — thème
clair unique, fond blanc, accent #0b4387, halo bleu au survol des cartes.

## Structure

```
index.html            — page unique
css/style.css         — styles (calque vitrine, tokens identiques)
js/app.js             — fetch + parse CSV + rendu grille/carrousel
data/actualites.csv   — SOURCE DE VÉRITÉ : les actualités validées
data/pending_proposals.json — propositions en attente de validation CEO
scripts/valider.py    — validation CEO (pending → CSV → push)
scripts/lister.py     — affichage des propositions / actualités
```

## Le CSV (source de vérité unique)

`data/actualites.csv` — UTF-8, séparateur virgule, guillemets doubles si
besoin. Colonnes :

| Colonne | Rôle |
|---|---|
| `id` | identifiant unique (A0001, A0002…) |
| `date_ajout` | date d'ajout (validation) au format AAAA-MM-JJ |
| `type` | `evenement_a_venir` / `ressource_publiee` / `evenement_passe` / `information_parlement` |
| `titre` | titre de la carte |
| `description` | brève description (1-2 phrases) |
| `date_debut`, `date_fin` | dates de l'événement (AAA-MM-JJ, fin vide si unique) |
| `lieu` | lieu (vide si non applicable) |
| `lien` | lien utile (inscription, source, programme…) |
| `source_message_id` | message-id du mail d'origine (anti-doublon) |

Aucune donnée inventée : une date ou un lieu non prouvé reste vide.

## Pipeline quotidien (cron Hermes)

Chaque matin à **08:15 (Europe/Paris)**, un cron Hermes sur le profil
copilote (modèle **mistral-medium-latest**, provider mistral,
reasoning_effort none) tourne APRÈS le cron de tri mail (~08:04) :

1. Le **monitor** (`actus_monitor.py`) lit le dossier mail
   « INBOX.Parlement de la rivière isère.Actualités & Partenaires ».
   Rien de nouveau → l'agent n'est pas réveillé (silence, pas de spam).
2. S'il y a de nouveaux mails, le **tick** (`actus_tick.py`) émet leur
   listing compact (uid, date, expéditeur, message-id, sujet, extrait)
   et avance le curseur (`~/.local/state/actualites-parlement/state.json`).
3. L'agent (mistral) identifie les actualités potentielles, déduplique
   (message_id, lien, titre) contre le CSV et le pending, cherche sur le
   web si des infos manquent (dates, lieu, lien), rédige les cartes avec
   un niveau de confiance en %.
4. Les propositions numérotées sont écrites dans
   `data/pending_proposals.json` (commit local, PAS de push automatique
   tant qu'elles ne sont pas validées) et livrées au CEO sur **Telegram**
   (liste numérotée, courte et aérée).

Le cron ne déplace JAMAIS de mails, n'écrit JAMAIS dans le CSV sans
validation, ne pousse JAMAIS sur le site public sans validation, et ne
crée JAMAIS de tâche Todoist.

## Procédure de validation (CEO répond par numéros)

Quand Nicolas valide sur Telegram (ex. « valide 1 et 3 ») :

```bash
cd ~/actualites-parlement
python3 scripts/valider.py 1 3
```

Le script :
- déplace les propositions n° 1 et 3 du pending vers `data/actualites.csv`
  (id unique, date_ajout du jour),
- refuse tout doublon (message_id, lien ou titre déjà présent),
- commit et pousse → GitHub Pages resert en ~2 minutes.

Pour voir les propositions en attente :
```bash
python3 scripts/valider.py --liste    # propositions en attente
python3 scripts/lister.py             # actualités déjà validées
```

L'usage complet est documenté dans le skill copilote
`parlement-actualites`.

## Test local

```bash
cd ~/actualites-parlement
python3 -m http.server 8124 --bind 127.0.0.1
# puis http://127.0.0.1:8124 — ARRÊTER le serveur après test (Ctrl-C)
```

Le bind 127.0.0.1 est OBLIGATOIRE sur ce VPS (incident réel déjà vécu :
un http.server sans bind expose le contenu du dossier).

## Notes techniques

- Le parseur CSV côté JS gère virgules, guillemets et retours ligne dans
  les champs (RFC 4180 simplifié) ; les écritures passent par le module
  `csv` Python (UTF-8).
- Tri : événements à venir en premier (par date croissante), puis le
  reste par date décroissante.
- Pas d'iframe pour l'instant : application autonome uniquement
  (décision CEO — l'intégration dans parlement-isere.org viendra plus
  tard, après validation du fonctionnement autonome).
