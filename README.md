# VRpaint — graffiti en réalité virtuelle

Un mur (8 m × 3 m par défaut, réglable) et les devantures de la rue à peindre à la bombe, dans le casque Meta Quest (WebXR) ou à la souris sur PC.
Aucune installation ni compilation : du HTML/JavaScript servi par WAMP, Three.js chargé depuis le CDN jsDelivr.

## Lancer

- **PC** : http://localhost/VRpaint/
- **Test automatique** (peinture scriptée, sans casque) : http://localhost/VRpaint/?test (ou `?test=night`)
- Paramètre `?res=2048|3072|4096` pour forcer la résolution du mur (par défaut 4096 sur PC, 3072 sur Quest).

## Jouer sur le Meta Quest 2

**Le plus simple : la version en ligne, https://gocode.github.io/vrpaint/** (adresse fixe, vrai certificat,
fonctionne sur n'importe quel réseau). Elle est publiée par GitHub Pages depuis le dépôt
https://github.com/gocode/vrpaint, branche `main` : chaque `git push` met le jeu à jour en une minute environ.
Attention : la version en ligne ne peut pas joindre le PC ; ses projets restent dans le navigateur du casque.
Pour retrouver les mêmes projets sur le PC et dans le casque, jouer avec le jeu servi par le PC (ci-dessous) :
voir [Projets communs au PC et au casque](#projets-communs-au-pc-et-au-casque).

WebXR n'accepte que des pages sécurisées : `https://…` ou `http://localhost`.
Ouvrir `http://192.168.x.x/VRpaint/` dans le casque affichera « VR non disponible ». Autres solutions, avec le jeu
servi par le PC :

1. **Meta Horizon Link, câble ou Air Link (le plus simple, aucune adresse IP)** : connecter le casque au PC
   (dans le casque, Paramètres rapides → Link), puis ouvrir http://localhost/VRpaint/ dans Chrome ou Edge sur le PC
   et cliquer sur « Entrer en VR ». Le rendu est fait par le PC, et les projets sont les mêmes qu'en mode souris.
   Meta Horizon Link doit être le runtime OpenXR actif : c'est déjà le cas sur ce PC.
2. **Câble USB + adb** (mode développeur activé sur le casque) :
   ```bash
   adb reverse tcp:8080 tcp:80
   ```
   puis, dans le navigateur du Quest : `http://localhost:8080/VRpaint/`. Le jeu tourne alors dans le casque.
3. **HTTPS en Wi-Fi (configuré)** : dans le navigateur du Quest, ouvrir **https://<adresse du PC>/**.
   L'adresse change avec le réseau : la page ouverte sur le PC l'affiche dans son panneau
   (« Dans le navigateur du casque… », fournie par `adresse.php`).
   À l'avertissement de certificat : « Avancé » → « Continuer vers le site ». Puis « Entrer en VR ».
   Les projets sont ceux du PC : les mêmes qu'en mode souris ou par Link, quelle que soit l'adresse.
   - vhost : `D:\wamp\bin\apache\apache2.4.65\conf\extra\httpd-vrpaint-ssl.conf` (inclus depuis `httpd.conf`,
     sauvegarde d'origine `httpd.conf.bak-vrpaint`) ; il ne sert que ce dossier, `tmp/` reste réservé au PC.
   - certificat auto-signé : `conf\ssl\vrpaint.crt` / `vrpaint.key`, valable jusqu'en 2029, pour localhost,
     vrpaint.test, 127.0.0.1, 192.168.103.206, 192.168.101.128 et 192.168.70.10. Si l'IP du PC change,
     le site reste accessible (simple avertissement de nom en plus).
   - le casque doit avoir accès à Internet : Three.js est chargé depuis cdn.jsdelivr.net.

## Montrer la partie sur l'écran du PC (spectateur)

Le moyen dépend de l'endroit où tourne le jeu.

### Jeu lancé depuis le PC (Meta Horizon Link) : vue spectateur intégrée

Pendant une session Link, Three.js dessine l'image dans le casque et le canvas de la page resterait figé.
La page affiche donc une **vue spectateur** sur toute la fenêtre : le panneau d'outils se replie (☰ pour le rouvrir)
et une barre en haut à droite permet de choisir la vue.

| Vue | Ce qu'on voit |
|---|---|
| **Vue du casque** (par défaut) | ce que regarde le peintre, **lissé** : la caméra suit la tête avec un léger retard et garde l'horizon droit (pas de roulis), pour ne pas donner le mal de mer à ceux qui regardent |
| **Vue du mur** | une caméra posée dans la rue cadre tout le mur (ou, pour un grand mur, la partie où travaille le peintre) ; le peintre y apparaît avec une silhouette simple (tête, casque, buste), sa bombe et sa palette. Le casque ne voit pas cette silhouette |
| **Coupée** | aucun calcul en plus pour le PC |

- **Plein écran** : bouton de la barre, Échap pour sortir ; en plein écran, la barre s'efface tant que la souris n'est pas dessus.
- La vue choisie est mémorisée ; on peut aussi la régler à l'avance dans le panneau (« Vue sur le PC pendant la VR »).
- Coût : un rendu de plus, une image du casque sur deux (36 à 45 images/s) et 1,44 million de pixels au plus
  (1600 × 900 à pleine fenêtre). Si le casque saccade, choisir « Coupée ».
- Brancher un second écran ou un vidéoprojecteur et y placer la fenêtre de Chrome : rien d'autre à régler.

Diffuser la fenêtre Chrome dans OBS, Teams ou Discord donne la même image.

### Jeu ouvert dans le navigateur du Quest : diffusion native du casque

Le jeu tourne alors dans le casque, sans lien avec le PC. La solution retenue est la **diffusion (Cast) du Quest**,
sans rien à installer ni à coder :

1. sur le PC, ouvrir **https://www.oculus.com/casting** dans Chrome ou Edge et se connecter avec le compte Meta du casque ;
2. le casque et le PC doivent être sur le même réseau Wi-Fi ;
3. dans le casque : menu universel → **Appareil photo → Diffuser → Ordinateur** → Suivant
   (en anglais *Camera → Cast → Computer* ; selon la version du système, l'entrée est parfois sous **Partager / Sharing**) ;
4. pour arrêter : même menu → Arrêter la diffusion.

On peut aussi diffuser vers l'appli Meta Horizon du téléphone ou vers une TV Chromecast.
La diffusion montre l'image brute d'un œil, avec environ une demi-seconde de retard et sans lissage : moins confortable
à regarder que la vue spectateur de Link. Pour une démonstration devant du public, préférer Link.

Écarté pour l'instant : un miroir maison (le casque enverrait sa vidéo à une page « spectateur » du PC par WebRTC).
Il faudrait rendre une vue de plus sur le Quest 2, déjà à la limite, et un serveur de signalisation joignable
depuis GitHub Pages ; la diffusion native fait le même travail sans coût pour le jeu.

## Commandes

### Casque Quest (main droite = bombe, main gauche = palette)
| Action | Commande |
|---|---|
| Peindre | gâchette de la bombe (analogique : appuyer à moitié = jet léger qui crachote) |
| Choisir couleur, cap, options | viser la palette de l'autre main + gâchette |
| Personnaliser la couleur en main | toucher la grande pastille en haut de la palette (onglet **Perso**) |
| Largeur du jet | glisser le potentiomètre en bas de la palette (30 % à 250 %) |
| Se déplacer | joystick gauche |
| Tourner par crans de 30° | joystick droit ← → |
| Monter / descendre (nacelle) | joystick droit ↑ ↓ (jusqu'à hauteur du mur − 1,2 m) |
| Viseur on/off · Annuler | A · B |
| Masquer la palette · Jour/Nuit | X · Y |
| Secouer la bombe | secouer la manette (bruit de bille) |

Palette à 5 onglets :
- **Couleurs** : le nuancier ;
- **Perso** : teinte, finition, Enregistrer, Mes couleurs ;
- **Modèle** : choisir la photo de référence, l'afficher à gauche, à droite ou au-dessus de la palette, ou sur un chevalet près du mur, et régler sa taille. Les photos s'ajoutent depuis le panneau du navigateur, avant d'entrer en VR ;
- **Réglages** : annuler, effacer, nuit, coulures, viseur, main droite/gauche, type et taille du mur ;
- **Projets** : nouveau, enregistrer, ouvrir (les projets du PC, communs au PC et au casque).

Les caps et le potentiomètre de largeur restent visibles en bas, quel que soit l'onglet.

### PC
Clic gauche : peindre (Maj : pression légère) · molette : distance au mur · Maj + molette : angle du flat cap ·
clic droit + glisser : regarder · ZQSD ou flèches : se déplacer · A/E : descendre/monter · 1–5 : caps ·
Ctrl+Z : annuler · N : nuit · V : viseur · C : coulures · X : secouer.
Clic sur la pastille de la couleur en cours : éditeur de couleur perso. Clic droit sur une couleur de « Mes couleurs » : la retirer.

## Ce qui est simulé

- **Cône de pulvérisation** : la tache s'élargit avec la distance (σ = distance × tan(angle du cap)) et la densité
  baisse avec le carré de la distance. De près, le trait est net et sature vite ; de loin, on obtient un voile léger.
  Au-delà de 1,4 m, la peinture n'atteint plus le mur.
- **Jet oblique** : une bombe inclinée donne une tache elliptique étirée.
- **Caps** :
  - Skinny (détails), Standard, Fat, Super fat (fonds) ;
  - Flat : éventail plat d'environ 25 cm à 15 cm du mur, qui pivote avec le poignet ; une passe couvre environ 85 %, pour remplir.

  Le potentiomètre élargit ou resserre le cap choisi, et le débit suit.
- **Grain** : nuage fin gaussien + gouttelettes + halo d'overspray ; à mi-pression, le jet crachote de grosses gouttes.
- **Coulures** : une carte d'épaisseur de peinture fraîche sèche en ~4 s. Trop de peinture au même endroit
  (bombe immobile ou trop près) fait partir une coulure qui descend, ralentit et finit en perle.
- **Peintures** :
  - 40 teintes mates ou satinées ;
  - 8 métallisées avec de vrais reflets ;
  - 8 fluos ;
  - 8 phosphorescentes, pâles le jour et lumineuses la nuit.

  La couleur perso accepte n'importe quelle teinte en mat, satiné, brillant, métal, fluo ou phospho. En phospho, la teinte choisie est celle de la lueur.
  « Mes couleurs » garde jusqu'à 16 couleurs perso.
- **Murs** :
  - 11 types : briques, briques peintes, parpaings, pierre, béton banché, crépi, tôle ondulée, palissade bois, carrelage métro, mur blanc, mur noir ;
  - taille réglable de 3 à 16 m de large et de 2 à 6 m de haut ; la peinture déjà faite reste à sa place, et Annuler rend le mur d'avant intact.
- **Autres surfaces** : les devantures et rideaux de toutes les boutiques de la rue se peignent aussi. La bombe vise la surface la plus proche. Une devanture n'occupe de mémoire qu'au premier coup de bombe.
- **Annulation** : chaque geste (un trait et ses coulures, un effacement, un changement de taille) s'annule. L'historique ne garde que les carreaux de 256 × 256 points réellement touchés : on remonte des dizaines, voire des centaines d'étapes. Le budget est de 120 Mo sur Quest 2 autonome et de 600 Mo sur PC ; au-delà, les plus vieux gestes sont oubliés.
- **Décor** :
  - une rue avec trottoirs, chaussée, passage piéton, arbres, bancs, poubelles et réverbères ;
  - des immeubles à côté du mur, derrière et en face, avec appuis de fenêtre, corniches et garde-corps en relief ;
  - des fenêtres et des vitrines **en profondeur** : derrière chaque vitre, une pièce ou une boutique (rayonnages, meubles, plafonnier) qui suit le point de vue, avec le reflet du ciel et des voilages ;
  - des voitures garées (citadine, berline, SUV) et d'autres qui **circulent** de temps en temps, avec leur bruit.

  La nuit, une partie des pièces s'allume (parfois une télé bleutée), les vitrines et les enseignes s'éclairent, et les voitures roulent phares allumés.
  Le ciel de nuit montre la **Voie lactée** et des étoiles qui scintillent ; de temps en temps passe un **avion**, et plus rarement une **étoile filante**.

## Projets

Chaque projet garde :
- la peinture ;
- le type et la taille du mur ;
- ses couleurs perso (« Mes couleurs ») ;
- les devantures peintes ;
- ses modèles photo ;
- une vignette.

L'enregistrement est automatique quelques secondes après chaque trait, et le dernier projet se rouvre au lancement.
« Nouveau projet » repart d'un mur vierge en reprenant les réglages et les couleurs perso du moment. Ouvrir un projet recharge ses propres couleurs perso.
Les projets sont rangés sur le PC et sont les mêmes depuis le PC et depuis le casque (voir ci-dessous).
« Exporter une photo » télécharge une image PNG de face du mur.
Le bouton « Entrer en AR » apparaît quand le casque le permet (Quest 3 / Pro, passthrough couleur) : le mur flotte alors dans la pièce.

## Projets communs au PC et au casque

Quand le jeu est servi par le PC, il n'y a qu'une seule collection de projets, rangée sur le PC :
http://localhost/VRpaint/ (souris, Link) et https://&lt;IP du PC&gt;/ (navigateur du casque) voient la même liste.
Un projet créé ou enregistré d'un côté apparaît de l'autre dans les 15 secondes (tout de suite en rouvrant l'onglet Projets
de la palette). On l'ouvre comme n'importe quel projet : rien d'autre à faire. Tout le projet suit : peinture du mur et des
devantures, type et taille du mur, couleurs perso, photos modèles, vignette.

- **Le projet ouvert suit l'autre appareil** : si l'autre appareil enregistre une version plus récente du projet ouvert ici,
  et qu'on n'est pas en train de le modifier, elle est rechargée automatiquement.
- **Modifié des deux côtés à la fois** : aucune version n'est perdue. Le premier enregistrement passe ; le second,
  fait sur une version dépassée, est refusé par le PC et gardé à part sous le nom « … (copie PC) » ou « … (copie casque) »,
  qui devient le projet ouvert sur cet appareil.
- **Projets d'avant** : au premier lancement, les projets restés dans le navigateur (PC ou casque, à chaque adresse) sont
  copiés une fois dans la collection du PC. Ils restent aussi dans le navigateur, en secours.
- **Version en ligne** (GitHub Pages) : une page https publique ne peut pas joindre le PC (contenu mixte, certificat
  auto-signé). Ses projets restent dans le navigateur, comme avant. Le panneau du PC indique où sont rangés les projets
  (« Enregistrés sur le PC » ou « dans ce navigateur seulement »). `?local` force le rangement dans le navigateur.

Détails techniques :
- `projets.php` : un fichier `projets/<id>.vrpaint` par projet (dossier ignoré par git, à sauvegarder avec le PC).
  Format (`js/projectfile.js`) : `VRPAINT1`, longueur de l'en-tête, en-tête JSON (nom, date, mur, couleurs perso, vignette,
  emplacement des blocs), puis les blocs : couches gzip du mur et des devantures, photos JPEG.
  La liste ne lit que les en-têtes et répond « 304 inchangé » tant que rien n'a bougé.
- Chaque enregistrement indique la version sur laquelle l'appareil a travaillé ; le PC refuse (409) si le projet a changé
  entre-temps. Les couches reçues sont contrôlées à la décompression (CRC du gzip, taille).
- Comme le reste du dossier, les projets sont lisibles par les appareils du réseau local.
- Contrôle automatique, en headless (deux profils, deux adresses : http://localhost/VRpaint/ et https://localhost/,
  sur une collection d'essai supprimée à la fin) :
  ```bash
  node tests/projets.mjs
  ```
  Projet peint sur l'un et ouvert sur l'autre (empreintes des couches, couverture de peinture, image du mur, devanture,
  couleurs perso, photo), rechargement de la version enregistrée ailleurs, modification simultanée sans perte, copie des
  anciens projets du navigateur, renommage et suppression. Affiche `PROJETS_OK` ou `PROJETS_ECHEC` (environ 4 min ;
  `--rapide` remplace la peinture scriptée par des rayures). Utilise `playwright-core` (variable `PLAYWRIGHT_CORE`).

À essayer dans le casque (non vérifiable en headless) :
- au premier lancement dans le navigateur du Quest (https://&lt;IP du PC&gt;/), les anciens projets du casque rejoignent la liste ;
- un projet commencé sur le PC, repris dans le casque puis de nouveau sur le PC ;
- le temps d'ouverture d'un grand mur en Wi-Fi et la mémoire du Quest 2.

## Architecture

| Fichier | Rôle |
|---|---|
| `js/paint.js` | Moteur de peinture GPU : tampons instanciés rendus dans 3 render targets half-float (couleur, rugosité/métal, émission), annulation, export/import, redimensionnement |
| `js/spray.js` | Physique de la bombe : projection du cône, caps, largeur réglable, gouttelettes, peinture fraîche, coulures |
| `js/world.js` | Mur (textures procédurales), ciel, éclairage jour/nuit, environnement de reflets, bombe 3D, viseur, nacelle |
| `js/history.js` | Historique d'annulation par carreaux, commun à toutes les surfaces |
| `js/canvases.js` | Devantures peignables (surfaces créées à la demande, calques de peinture) |
| `js/street.js` | Rue, immeubles, fenêtres et vitrines en profondeur (interior mapping), mobilier, réverbères |
| `js/cars.js` | Voitures procédurales (profils extrudés et galbés) et circulation |
| `js/sky.js` | Ciel jour/nuit, Voie lactée, étoiles, avions, étoiles filantes |
| `js/refs.js` | Modèles photo (import, affichage à côté de la palette ou sur chevalet) |
| `adresse.php` | Adresse réseau du PC à taper dans le casque |
| `projets.php`, `js/projectfile.js` | Collection de projets sur le PC, commune au PC et au casque ; format de fichier d'un projet |
| `js/xr.js` | Manettes Quest : pulvérisation, palette, déplacements, retour haptique |
| `js/vrui.js` | Palette tenue en main en VR (canvas texturé, 5 onglets) |
| `js/spectator.js` | Vue spectateur sur l'écran du PC pendant une session Link (casque lissé, vue du mur, silhouette du peintre) |
| `js/desktop.js`, `js/ui.js` | Mode PC : souris/clavier et panneau d'outils |
| `js/state.js` | État partagé, couleurs perso, préférences (localStorage) |
| `js/storage.js` | Projets : sur le PC (projets.php) ou dans le navigateur (IndexedDB), couches compressées gzip, reprise des anciens projets |
| `js/audio.js` | Souffle de la bombe et cliquetis de la bille (Web Audio, sans fichier son) |
| `js/frames.js` | Rendu à la demande sur PC : pas d'image recalculée quand l'écran n'a pas à changer |
| `js/test.js` | Peinture scriptée de contrôle (`?test`) |

Toute écriture dans les couches de peinture passe par un rendu, jamais par un simple `clear()`. Sinon les niveaux de
mipmap, utilisés quand on regarde le mur de loin en VR, garderaient l'ancienne peinture. Le test `?test` vérifie ce point :
après « Tout effacer », une vue basse résolution doit être identique au mur vierge. Il affiche `VRPAINT_CLEAR_CHECK OK`
ou `ECHEC` dans la console.

L'enregistrement des couches est exact : exporter puis réimporter une couche redonne les mêmes octets, sur le mur comme
sur les devantures, même pour les texels presque transparents (l'export et l'import à taille égale lisent texel à texel, sans filtrage ;
un texel dont l'alpha s'arrondit à 0 est enregistré vide).
Sans cela, chaque enregistrement suivi d'une réouverture modifiait la peinture. `tests/projets.mjs` vérifie cette égalité.
Seul le premier passage du mur vivant à l'enregistrement arrondit les couches (demi-flottants) à 8 bits par canal :
sur les bords fins du jet, un petit nombre de pixels d'une vue du mur peut bouger de quelques niveaux ; ensuite plus rien ne change.

Résolution : environ 2 mm par texel sur Quest 2 et 1,5 mm sur PC pour le mur, 3,5 et 2,5 mm pour les devantures,
4096 texels au plus. La rue a une implantation fixe, prévue pour un mur de 16 m : les devantures peintes retrouvent
toujours leur place.

### Ressources de l'ordinateur

Rien n'est sacrifié à l'image : les optimisations ne changent pas un pixel (vérifié par comparaison avec la version précédente).

- **Rendu à la demande (PC, hors casque)** : une image n'est recalculée que si l'écran doit changer : vue qui bouge,
  peinture, réglage, action à la souris ou au clavier, voiture qui roule dans le champ, avion ou étoile filante. Les
  changements sont détectés de façon générale : tout rendu hors écran, toute nouvelle texture ou tout nouveau shader
  relance l'image, et une image est de toute façon redessinée tous les quarts de seconde. Face au mur, de jour, la
  carte graphique calcule ainsi environ 4 images par seconde au lieu de 60 ou plus. La nuit, elle en calcule 30 pour le
  scintillement des étoiles et des télés. Dans le casque, toutes les images sont rendues, comme l'exige la VR.
  `?frames=all` rétablit le rendu continu, pour comparer.
- **Rue en tronçons** : les immeubles, vitrines, arbres et voitures garées sont regroupés par matériau et par tronçon
  de 24 m. Ce qui est hors du champ n'est plus envoyé à la carte graphique : 8 000 à 15 000 triangles par vue au lieu
  de 169 000, ce qui compte surtout sur le Quest 2.
- **Profondeur** : la vitre des fenêtres (6 mm devant la façade) et le mur à peindre (0,5 mm devant son massif) ont un
  décalage de profondeur. De loin, sans lui, l'ordre de dessin décidait de la surface visible, en rayures. Le test
  `?test` le vérifie : il rend chaque vue avec les matériaux dans un ordre puis dans l'autre et affiche
  `VRPAINT_ORDER_CHECK OK` ou `ECHEC`.

## Pistes suivantes

- Phosphorescence réaliste : charge à la lumière, déclin progressif dans le noir, lampe UV.
- Pochoirs (stencils), ruban de masquage.
- Pipette (prélever une couleur sur le mur), niveau de la bombe qui se vide.
