# WebNo — UNO en pair-à-pair

Un UNO multijoueur jouable dans le navigateur, **jusqu'à 4 joueurs**, sans serveur de jeu à héberger :
les navigateurs se parlent directement en WebRTC (via [PeerJS](https://peerjs.com/)). Le site est
100 % statique, donc déployable tel quel sur **GitHub Pages**.

## Ce que ça fait

- **Bouton « Voir les règles »** : il ouvre une grille où chaque carte du paquet choisi occupe sa
  propre case, avec son dessin, son nom et son effet — et les descriptions suivent les règles
  réellement activées, pour que tout le monde parte avec les mêmes informations.
- **Les quatre réglages** — mode de jeu, paquet, condition de victoire et niveau des bots — se
  choisissent chacun par un bouton illustré qui ouvre une galerie de vignettes : la table et ses
  places pour les modes, quatre cartes sur leur feutre pour les paquets, l'objectif et sa jauge
  pour la victoire, un petit robot et ses barres de force pour les bots.
- **Salon avec code et QR code** : l'hôte crée la room, obtient un code à 5 caractères, un lien
  `…/#CODE` et un **QR code affiché à l'écran** (agrandissable d'un clic pour être scanné de loin —
  pratique en mode party où douze personnes doivent rejoindre). Les joueurs le scannent avec
  l'appareil photo de leur téléphone, ou depuis le jeu via le bouton « Scanner un QR code » quand
  le navigateur sait lire les codes-barres. Le code peut toujours être saisi à la main.
- **Pseudos** : chacun choisit le sien, mémorisé d'une partie à l'autre ; les doublons sont
  automatiquement différenciés.
- **Bots** : l'hôte complète les places libres d'un clic. Trois niveaux (facile / normal / difficile).
  Un joueur qui se déconnecte est immédiatement repris par un bot, la partie continue.
- **Reconnexion** : il suffit de retaper le code pour revenir. On retrouve son siège et sa main
  telle qu'on l'avait laissée, le pseudo servant à reconnaître sa place ; sans correspondance, on
  prend celle d'un bot au hasard. Le code de la dernière room est proposé d'office au retour.
- **Les modes**, rangés dans trois dossiers que l'on ouvre depuis leur galerie :
  - **Chacun pour soi**, jusqu'à 4 joueurs ;
  - **Groupe** — 2 v 2, 3 v 3 ou 4 v 4 (jusqu'à 8 joueurs). Les équipes alternent autour de la
    table — A, B, A, B… — et chaque joueur voit le jeu de tous ses coéquipiers ;
  - **Extra — Party**, de 8 à 32 joueurs, sur le principe du GamePad de la Wii U : **l'écran de
    l'hôte est la table** (plateau, joueurs tout autour, cartes en grand, aucune main visible) et
    **chaque téléphone est une manette** (sa main, ses boutons, aucun plateau). Seuls les
    téléphones peuvent rejoindre ; les deux écrans passent en plein écran, et le téléphone
    réclame le paysage tant qu'il n'y est pas — dans le salon comme en partie. Le salon change
    d'allure : les joueurs à gauche, le code et le QR en grand à droite pour être scannés de loin,
    les réglages derrière un bouton. Chacun reçoit en plus une **main party** — des cartes
    d'action pensées pour les grandes tablées (Tempête, Visée, Bouclier, Contagion, Grand vent,
    Raccourci, Cadeau, Troc), qui se jouent en supplément de son tour, une par tour, et
    **qu'aucun 7-0 ne peut échanger** (les places 1-3 contre les places 2-4,
  l'hôte peut permuter les joueurs avec le bouton ⇅). En équipes, **les coéquipiers jouent à
  cartes ouvertes** : la main de votre partenaire s'affiche triée sur sa plaque.
- **Victoire** : au score (200 / 300 / 500 points, décompte UNO classique) ou en une seule manche.
- **Table en 3D légère** (perspective CSS), cartes dessinées entièrement en CSS, aucune image.
  Des flèches tournent autour des piles et indiquent en permanence le sens du jeu, qui s'inverse
  avec les cartes « sens ».
- **Tout au clavier** : ← → pour parcourir la main, Entrée pour poser, Espace pour piocher,
  U pour UNO, C pour dénoncer, 1-4 pour choisir une couleur. La touche `?` ouvre la liste.
- **Trois mises en page** selon l'écran : grand écran (le plateau grandit avec la fenêtre et la
  main s'étale), téléphone en portrait (table verticale, adversaires en bandeau, gros boutons
  tactiles, main défilante) et téléphone en paysage (tout est resserré pour garder la table lisible).
- **Main défilante** : quand l'éventail deviendrait illisible, la main se transforme en bande que
  l'on fait glisser au doigt, cartes à taille pleine.
- **Habillage** aux couleurs officielles du jeu, décor animé (halos, cartes dérivantes, grain),
  liseré de table qui prend la couleur en cours, confettis de victoire.
- **Son** : musique de menu, musique de table et une quinzaine de bruitages, **entièrement
  synthétisés au Web Audio** — aucun fichier audio, aucune licence, rien à télécharger.
  Réglages Musique / Effets dans la console en haut à droite, mémorisés d'une session à l'autre.

## Les paquets

Chacun a son propre habillage, pour se reconnaître sans lire une seule valeur : le classique et son
ovale incliné, **Flip** et son coin corné qui laisse voir la couleur du verso, **No Mercy** en
bordure noire rayée avec un cartouche anguleux, **Extreme** et son cadre métallique. Les dos de
cartes changent aussi.

| Paquet | Ce qu'il change |
|---|---|
| **Classique** | Le jeu UNO habituel : 108 cartes, quatre couleurs. |
| **No Mercy** | Le paquet sans pitié. **Toutes** les cartes de pioche s'empilent entre elles, sans limite — y compris la redoutable **+10**. S'y ajoutent la *défausse totale* (jetez d'un coup toutes vos cartes d'une couleur), *tout le monde passe*, le *sens +4* et le joker pioche-couleur. Et surtout : **passé 25 cartes, vous êtes éliminé de la manche**. Le dernier debout l'emporte. |
| **Extreme** | Il n'y a plus de pioche : on appuie sur le **lanceur**, qui crache un nombre imprévisible de cartes — rien du tout une fois sur deux, parfois une poignée — puis le tour passe aussitôt. Les cartes +2 et +4 deviennent des *attaques* : le suivant déclenche le lanceur deux ou quatre fois. |
| **Flip** | Chaque carton a **deux faces sans aucun rapport** — une claire, une sombre, avec ses propres couleurs (rose, turquoise, orange, violet) et ses propres cartes : *tout le monde passe*, *+5*, *joker pioche-couleur*. Une carte **Retournement** fait basculer toute la partie d'un côté à l'autre : mains, défausse et couleur en cours changent d'un coup. Et comme les autres tiennent leurs cartes tournées vers eux, **vous voyez déjà leur autre face** — c'est tout l'intérêt. |

## Les règles maison (réglables par l'hôte)

| Règle | Effet |
|---|---|
| **Accumulation** | Les +2 et +4 s'empilent sur le joueur suivant, qui doit surenchérir ou tout ramasser. Un +4 peut couvrir un +2, l'inverse est interdit. |
| **7-0** | En posant un **7**, on échange sa main avec le joueur de son choix. En posant un **0**, toutes les mains tournent d'un cran dans le sens du jeu. |
| **À la volée** | On peut poser hors de son tour une carte strictement identique (même couleur *et* même valeur) à celle du dessus ; le jeu reprend à partir du poseur. |
| **Bluff sur le +4** | Désactivé par défaut, conformément à la demande : **impossible de dénoncer un +4**. Activable pour retrouver la contestation classique. |
| **Annonce « UNO »** | Oublier d'annoncer à l'avant-dernière carte expose à une dénonciation (+2 cartes). Le bouton UNO peut être armé à l'avance. |

## Mettre à jour sans se faire piéger par le cache

GitHub Pages garde les fichiers dix minutes côté navigateur. Après un changement, un visiteur
peut donc récupérer le nouveau `index.html` mais l'ancien CSS ou l'ancien JavaScript — et voir
une page à moitié cassée. Pour l'éviter, **estampillez les fichiers avant de pousser** :

```bash
python3 tools/stamp.py     # écrit ?v=<horodatage> partout
git commit -am "..." && git push
```

Le script réécrit la version dans `index.html` et dans chaque import des modules. Comme l'adresse
change, le navigateur est obligé de tout retélécharger : plus de mélange possible.

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
js/qr.js            encodeur QR autonome (mode octet, correction M, versions 1 à 10)
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
