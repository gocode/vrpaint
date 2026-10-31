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
Les projets restent rangés par adresse : ceux faits sur `https://192.168.x.x/` n'apparaissent pas en ligne.

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
   Attention : le navigateur range les projets par adresse ; à une nouvelle adresse, la liste des projets du casque repart vide.
   - vhost : `D:\wamp\bin\apache\apache2.4.65\conf\extra\httpd-vrpaint-ssl.conf` (inclus depuis `httpd.conf`,
     sauvegarde d'origine `httpd.conf.bak-vrpaint`) ; il ne sert que ce dossier, `tmp/` reste réservé au PC.
   - certificat auto-signé : `conf\ssl\vrpaint.crt` / `vrpaint.key`, valable jusqu'en 2029, pour localhost,
     vrpaint.test, 127.0.0.1, 192.168.103.206, 192.168.101.128 et 192.168.70.10. Si l'IP du PC change,
     le site reste accessible (simple avertissement de nom en plus).
   - le casque doit avoir accès à Internet : Three.js est chargé depuis cdn.jsdelivr.net.

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
- **Projets** : nouveau, enregistrer, ouvrir.

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
Les projets sont stockés dans le navigateur (IndexedDB) : ceux du casque et ceux du PC sont séparés.
« Exporter une photo » télécharge une image PNG de face du mur.
Le bouton « Entrer en AR » apparaît quand le casque le permet (Quest 3 / Pro, passthrough couleur) : le mur flotte alors dans la pièce.

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
| `js/xr.js` | Manettes Quest : pulvérisation, palette, déplacements, retour haptique |
| `js/vrui.js` | Palette tenue en main en VR (canvas texturé, 5 onglets) |
| `js/desktop.js`, `js/ui.js` | Mode PC : souris/clavier et panneau d'outils |
| `js/state.js` | État partagé, couleurs perso, préférences (localStorage) |
| `js/storage.js` | Projets IndexedDB (couches compressées gzip), migration de l'ancienne sauvegarde |
| `js/audio.js` | Souffle de la bombe et cliquetis de la bille (Web Audio, sans fichier son) |
| `js/test.js` | Peinture scriptée de contrôle (`?test`) |

Toute écriture dans les couches de peinture passe par un rendu, jamais par un simple `clear()`. Sinon les niveaux de
mipmap, utilisés quand on regarde le mur de loin en VR, garderaient l'ancienne peinture. Le test `?test` vérifie ce point :
après « Tout effacer », une vue basse résolution doit être identique au mur vierge. Il affiche `VRPAINT_CLEAR_CHECK OK`
ou `ECHEC` dans la console.

Résolution : environ 2 mm par texel sur Quest 2 et 1,5 mm sur PC pour le mur, 3,5 et 2,5 mm pour les devantures,
4096 texels au plus. La rue a une implantation fixe, prévue pour un mur de 16 m : les devantures peintes retrouvent
toujours leur place.

## Pistes suivantes

- Phosphorescence réaliste : charge à la lumière, déclin progressif dans le noir, lampe UV.
- Pochoirs (stencils), ruban de masquage.
- Pipette (prélever une couleur sur le mur), niveau de la bombe qui se vide.
- Export et import d'un projet en fichier, pour passer du PC au casque.