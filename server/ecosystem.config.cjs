// Configuration PM2 pour valo-api.
// Objectif : éviter les crash OOM (FatalProcessOutOfMemory) observés sur le VPS.
//
// Déploiement :
//   pm2 delete valo-api            (si déjà lancé)
//   pm2 start ecosystem.config.cjs
//   pm2 save
//
module.exports = {
  apps: [{
    name: 'valo-api',
    script: 'server.js',
    cwd: __dirname,                 // travaille depuis /home/admin/tracker-backend
    exec_mode: 'fork',
    instances: 1,

    // Relance automatique si la mémoire dépasse ce seuil (garde-fou anti-OOM).
    // Ajuste selon la RAM du VPS : ~400M convient pour un petit serveur.
    max_memory_restart: '400M',

    // Donne à V8 un heap plus large que le défaut (~256-512M selon la version),
    // pour absorber les pics de /history et de génération d'images.
    node_args: '--max-old-space-size=512',

    // Redémarre si crash, avec back-off pour ne pas boucler indéfiniment.
    autorestart: true,
    max_restarts: 15,
    restart_delay: 3000,

    env: { NODE_ENV: 'production' },
  }],
};
