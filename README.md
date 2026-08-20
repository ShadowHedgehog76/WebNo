# WebNo — UNO en pair-à-pair

Un UNO multijoueur jouable dans le navigateur, **jusqu'à 4 joueurs**, sans serveur de jeu à héberger :
les navigateurs se parlent directement en WebRTC (via [PeerJS](https://peerjs.com/)). Le site est
100 % statique, donc déployable tel quel sur **GitHub Pages**.

## Ce que ça fait

- **Salon avec code** : l'hôte crée la room, obtient un code à 5 caractères et le partage. Les joueurs
  entrent le code (ou ouvrent le lien `…/#CODE`) pour rejoindre.
- **Pseudos** : chacun choisit le sien, mémorisé d'une partie à l'autre ; les doublons sont
  automatiquement différenciés.
- **Bots** : l'hôte complète les places libres d'un clic. Trois niveaux (facile / normal / difficile).
  Un joueur qui se déconnecte est immédiatement repris par un bot, la partie continue.
- **Deux modes** : *chacun pour soi*, ou *équipes 2 v 2* (les places 1-3 contre les places 2-4,
  l'hôte peut permuter les joueurs avec le bouton ⇅). En équipes, **les coéquipiers jouent à
  cartes ouvertes** : la main de votre partenaire s'affiche triée sur sa plaque.
- **Victoire** : au score (200 / 300 / 500 points, décompte UNO classique) ou en une seule manche.
- **Table en 3D légère** (perspective CSS), cartes dessinées entièrement en CSS, aucune image.
- **Tout au clavier** : ← → pour parcourir la main, Entrée pour poser, Espace pour piocher,
  U pour UNO, C pour dénoncer, 1-4 pour choisir une couleur. La touche `?` ouvre la liste.
- **Mobile** : quand la main devient trop fournie, elle bascule en bande défilante horizontale
  au lieu d'empiler des cartes illisibles.
- **Habillage** aux couleurs officielles du jeu, décor animé (halos, cartes dérivantes, grain),
  liseré de table qui prend la couleur en cours, confettis de victoire.
- **Son** : musique de menu, musique de table et une quinzaine de bruitages, **entièrement
  synthétisés au Web Audio** — aucun fichier audio, aucune licence, rien à télécharger.
  Réglages Musique / Effets dans la console en haut à droite, mémorisés d'une session à l'autre.

## Les règles maison (réglables par l'hôte)

| Règle | Effet |
|---|---|
| **Accumulation** | Les +2 et +4 s'empilent sur le joueur suivant, qui doit surenchérir ou tout ramasser. Un +4 peut couvrir un +2, l'inverse est interdit. |
| **7-0** | En posant un **7**, on échange sa main avec le joueur de son choix. En posant un **0**, toutes les mains tournent d'un cran dans le sens du jeu. |
| **À la volée** | On peut poser hors de son tour une carte strictement identique (même couleur *et* même valeur) à celle du dessus ; le jeu reprend à partir du poseur. |
| **Bluff sur le +4** | Désactivé par défaut, conformément à la demande : **impossible de dénoncer un +4**. Activable pour retrouver la contestation classique. |
| **Annonce « UNO »** | Oublier d'annoncer à l'avant-dernière carte expose à une dénonciation (+2 cartes). Le bouton UNO peut être armé à l'avance. |

## Déployer sur GitHub Pages

```bash
git init && git add . && git commit -m "WebNo"
git branch -M main
git remote add origin git@github.com:<votre-compte>/<votre-repo>.git
git push -u origin main
```

Puis, dans le dépôt : **Settings → Pages → Source : `Deploy from a branch` → branche `main`, dossier `/ (root)`**.
Le jeu sera servi sur `https://<votre-compte>.github.io/<votre-repo>/`.

> HTTPS est indispensable au WebRTC — GitHub Pages le fournit d'office.

Les polices *Archivo Black* et *Outfit* sont chargées depuis Google Fonts ; sans réseau, le jeu
retombe sur les polices système sans rien casser.

## Jouer en local

Il faut un serveur HTTP (les modules ES ne se chargent pas en `file://`) :

```bash
python3 -m http.server 8777
# puis http://localhost:8777/
```

## Architecture

Topologie en étoile : **l'hôte fait autorité**. Il exécute le moteur de jeu, applique les règles et
diffuse à chaque joueur une vue filtrée de la partie — un client ne reçoit jamais les cartes des
autres, et toute action est revalidée par l'hôte.

```
index.html          écrans : accueil, salon, table, overlays
css/style.css       thème, cartes CSS, table 3D, responsive
js/audio.js         synthèse des musiques et bruitages (Web Audio)
js/deck.js          modèle de cartes, paquet de 108, points
js/engine.js        moteur autoritaire : règles, tours, manches, scores
js/bot.js           IA des joueurs virtuels (heuristiques + niveaux)
js/net.js           transport pair-à-pair (PeerJS/WebRTC), codes de room
js/ui.js            rendu du DOM et animations
js/app.js           orchestration hôte / client, boucle IA, câblage
```

## Limites connues

- L'échange de signalisation passe par le serveur public gratuit de PeerJS. Si vos joueurs sont
  derrière des réseaux très fermés (NAT symétrique), la connexion directe peut échouer : il faudrait
  alors ajouter un serveur TURN dans `js/net.js`.
- Si l'hôte quitte, la partie s'arrête : c'est lui qui détient l'état du jeu.
