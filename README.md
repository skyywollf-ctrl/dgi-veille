# 📊 DGI Veille

PWA personnelle de veille mensuelle pour investisseur Dividend Growth Investing. Remplace ~2h de recherche manuelle (Google Finance, Seeking Alpha, sites IR) par un dashboard à 1 clic.

- **17 actions US** préremplies + ajouts perso
- **13 sociétés Asie** (Chine/Japon/Corée) pour découverte/diversification
- **Verdict IA** 🟢🟡🔴 par action via Claude API
- **Détection automatique** des hausses de dividende
- **Système "déjà vu"** : ce qui n'a pas bougé depuis ta dernière visite est marqué visuellement
- **Tout client-side** : aucun backend, données stockées sur ton téléphone

---

## 🚀 Installation rapide (3 étapes)

### 1. Héberger l'app sur GitHub Pages (gratuit)

> Tu fais ça **une seule fois**, ça te prend 5 minutes.

1. Va sur [github.com](https://github.com) → crée un compte si t'en as pas
2. Clique sur **"New repository"** (bouton vert)
3. Nom du repo : `dgi-veille` (ou ce que tu veux)
4. Coche **"Public"** (obligatoire pour GitHub Pages gratuit)
5. Clique **"Create repository"**
6. Sur la page du repo, clique **"uploading an existing file"** (lien bleu)
7. **Glisse-dépose tous les fichiers du projet** :
   - `index.html`
   - `app.js`
   - `styles.css`
   - `manifest.json`
   - `sw.js`
   - `icon.svg`
   - `README.md` (ce fichier)
   - Dossier `data/` avec `stocks.js` et `asia.js`
8. Clique **"Commit changes"**
9. Va dans **Settings** (onglet du repo) → **Pages** (menu gauche)
10. Sous "Build and deployment" → "Source" : choisis **"Deploy from a branch"**
11. Branch : **main** → Folder : **/ (root)** → **Save**
12. Attends ~1 min, recharge la page : tu auras une URL du type
    `https://TON-USERNAME.github.io/dgi-veille/`

### 2. Récupérer les clés API (gratuites)

**Finnhub** (pour les news) :
1. Va sur [finnhub.io/register](https://finnhub.io/register)
2. Inscription par mail (gratuite, 60 req/min, largement assez)
3. Copie la clé API affichée sur le dashboard

**Claude API** (pour les verdicts IA) :
1. Va sur [console.anthropic.com](https://console.anthropic.com)
2. Crée un compte
3. **API Keys** → **Create Key** → copie-la (commence par `sk-ant-...`)
4. Ajoute du crédit (5$ suffisent pour des mois d'utilisation : 1 analyse complète ≈ 0,05 à 0,15$)

### 3. Installer sur ton iPhone

1. Ouvre **Safari** sur ton iPhone (pas Chrome, sur iOS faut Safari)
2. Tape l'URL GitHub Pages de l'étape 1
3. En bas de Safari, appuie sur l'icône **Partager** (carré avec flèche vers le haut)
4. Fais défiler et touche **"Sur l'écran d'accueil"**
5. Touche **"Ajouter"** en haut à droite
6. ✅ L'icône apparaît sur ton home screen comme une vraie app

### 4. Premier lancement

1. Lance l'app depuis ton écran d'accueil
2. Onglet **Settings** (en bas à droite) → colle tes 2 clés API → **Sauvegarder**
3. Reviens sur **Portefeuille** → clique **🔄 Lancer une analyse**
4. Patiente ~3-5 min (analyse séquentielle de ~30 tickers + macro Asie)
5. C'est bon, tu peux consulter tranquille

---

## 🔧 Usage local sans hébergement (pour tester)

Pas besoin de serveur web, tu peux ouvrir directement :

```bash
# Sur Mac/Linux
open index.html

# Ou double-clic sur index.html
```

⚠️ Limite : le Service Worker (cache offline) ne fonctionne qu'en HTTPS. En local, l'app marche mais sans cache offline. Pas grave pour tester.

---

## 🔐 Sécurité des clés API

Tes clés sont stockées **localement sur ton téléphone** (localStorage du navigateur Safari). Elles ne transitent jamais par un serveur tiers (sauf bien sûr quand l'app appelle directement Finnhub/Anthropic depuis ton navigateur).

⚠️ Comme l'app est hébergée sur GitHub Pages **public**, n'importe qui peut voir le code. Mais **personne ne peut voir tes clés** : elles sont dans ton localStorage iPhone, pas dans le code.

---

## 📁 Structure du projet

```
dgi-veille/
├── index.html          # Structure 4 écrans + nav bas
├── styles.css          # Thème sombre mobile-first
├── app.js              # Logique : fetch, cache, snapshots, rendering
├── manifest.json       # Config PWA (install home screen)
├── sw.js               # Service Worker (cache offline)
├── icon.svg            # Icône PWA (vectorielle)
├── data/
│   ├── stocks.js       # 17 actions US préremplies
│   └── asia.js         # 13 sociétés Asie + notes piégeuses
└── README.md           # Ce fichier
```

---

## 🐛 Si quelque chose foire

**"Données indisponibles" sur plusieurs actions** :
- Yahoo Finance bloque parfois les proxies CORS publics. L'app a un fallback automatique entre 2 proxies. Si les 2 tombent, attends quelques minutes.

**"Clé Claude manquante"** :
- Settings → recolle la clé → Sauvegarder. Vérifie qu'elle commence par `sk-ant-`.

**Erreur Claude API "credit_balance_too_low"** :
- Va sur console.anthropic.com → ajoute du crédit.

**Cards macro Asie vide** :
- Indices Yahoo `^HSI`, `^N225`, `^KS11` peuvent rater. L'app continue quand même avec ce qu'elle a.

**L'app n'apparaît pas comme installable** :
- Sur iOS, l'install se fait **toujours manuellement** via Safari → Partager → "Sur l'écran d'accueil". Pas de prompt automatique comme sur Android.

---

## 💸 Coûts

- **Hébergement** : 0€ (GitHub Pages public)
- **Finnhub** : 0€ (free tier suffisant)
- **Claude API** : ~0,05 à 0,15$ par analyse complète (1 fois par mois = 1-2$/an)

---

## 🛠 Tech

- Vanilla JS (ES6+ modules), pas de framework
- Yahoo Finance (chart + quoteSummary) via proxy CORS
- Finnhub free tier pour les news
- Claude API (`claude-sonnet-4-20250514`) pour verdicts + macro
- localStorage pour persistence
- Service Worker pour cache offline

v1.0
