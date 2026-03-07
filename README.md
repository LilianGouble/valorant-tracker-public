# 🎯 Valorant Squad Tracker V3

Un tableau de bord complet et auto-hébergé pour suivre les statistiques Valorant de votre groupe d'amis.
Fini les fichiers de configuration codés en dur : cette V3 intègre une base de données SQLite et un Panel d'Administration sécurisé pour tout gérer dynamiquement (Joueurs, Clés API, Webhooks Discord, etc.).

___


## ✨ Fonctionnalités
- 📊 Tableau de bord global : Suivez la progression (RR), l'ACS, le K/D et les statistiques de toute votre équipe.

- 🔫 Analyses détaillées : Matrice de style de jeu, efficacité des armes, analyse des rôles et des agents.

- 🗺️ Cartographie & Stratégie : Heatmaps des morts, winrate par site de plant (Post-plant) et suggestions de compositions d'équipe par l'IA.

- 🏆 Modes supportés : Ranked, Deathmatch (FFA) et Team Deathmatch (TDM).

- 🤖 Automatisation Discord : Alertes automatiques à chaque fin de match et rapport météorologique quotidien de l'escouade.

- 🔒 Panel Admin Sécurisé : Gestion des joueurs, de la configuration et des clés API directement via l'interface web (Protégé par JWT & Bcrypt).
___

## 🛠️ Prérequis
Avant de commencer, assurez-vous d'avoir installé :

- Node.js (v18 ou supérieur recommandé)
- Git
- PM2 (Recommandé pour la mise en production) : npm install -g pm2
___
## 🚀 Installation & Lancement Rapide (Local / Développement)
1. Cloner le repository

```Bash
git clone https://github.com/VOTRE_PSEUDO/valorant-tracker-public.git
cd valorant-tracker-public
```
2. Lancer le Backend (Serveur & Base de données)
Le backend s'occupe de la base de données, des tâches planifiées (CRON) et de l'authentification.

```Bash
cd server
npm install
npm start
```
Le backend tourne désormais sur http://localhost:3001.

3. Lancer le Frontend (Interface Web)
Ouvrez un nouveau terminal, retournez à la racine du projet, puis lancez le site :

```Bash
npm install
npm run dev
```
Le site est accessible sur http://localhost:5173.
___
## ⚙️ Configuration Initiale (Panel Admin)
Au tout premier lancement, la base de données est vide. Vous devez configurer le tracker via le Panel d'Administration.

1. Allez sur la page /admin de votre site (ex: http://localhost:5173/admin).
2. Connectez-vous avec les identifiants par défaut :

**Utilisateur** : admin  
**Mot de passe** : admin  

3. _Le système vous forcera immédiatement à créer un nouveau mot de passe sécurisé._

4. Une fois dans le panel, naviguez dans les onglets pour :  
- Ajouter vos joueurs (Pseudo, Tag, Couleur).
- Ajouter vos clés API HenrikDev (Le tracker a besoin d'au moins une clé pour fonctionner, voir ci-dessous).
- Configurer l'URL de votre application et votre Webhook Discord (Onglet Configuration).

### 🔑 Comment obtenir des Clés API Riot ?
Ce projet utilise l'excellente API non-officielle HenrikDev.  
1. Rendez-vous sur le site de HenrikDev.
2. Connectez-vous avec Discord.
3. Allez dans l'onglet API Keys et "+ Generate New Key".
Astuce : Ajoutez plusieurs clés issues de comptes Discord différents pour éviter la limite de requêtes (Rate Limit 429) lors du scan !  
  
___

## 🌍 Mise en Production (Serveur VPS / AWS / Debian)
Si vous souhaitez héberger le tracker publiquement avec votre propre nom de domaine (ex: tracker.mondomaine.com).

1. Préparer le Backend avec PM2

```Bash
cd server
npm install
pm2 start server.js --name "valo-tracker-api"
pm2 save
```
2. Compiler le Frontend
À la racine du projet :

```Bash
npm install
npm run build
```
_(Cela générera un dossier dist contenant les fichiers statiques HTML/CSS/JS optimisés)._

3. Configuration Nginx (Reverse Proxy)
Pour que votre site puisse communiquer avec l'API Node.js et servir le frontend sur le même port (80/443), voici la configuration Nginx requise :

``` Nginx
server {
    listen 80;
    server_name tracker.mondomaine.com;

    # Redirige les requêtes API vers le Backend Node.js (Port 3001)
    location ~ ^/(api|history|sync|test-match|test-report|trigger-report) {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # Sert les fichiers statiques React (Dossier dist)
    location / {
        root /chemin/vers/votre/projet/dist;
        index index.html;
        try_files $uri $uri/ /index.html;
    }
}
```

_(N'oubliez pas de redémarrer Nginx : sudo systemctl restart nginx)._

___

## 💾 Sauvegarde des données
Toutes les données (Historique des matchs, Utilisateurs, Configuration) sont stockées dans un fichier local SQLite situé ici :
```server/database.sqlite```

Pour faire une sauvegarde complète de votre tracker, il vous suffit de copier/sauvegarder ce seul fichier !

___
## ⚠️ Avertissement légal
Ce projet n'est pas affilié, sponsorisé, ou approuvé par Riot Games. L'utilisation des assets (images des agents, rangs, etc.) est à but non commercial. Valorant est une marque déposée de Riot Games, Inc.
