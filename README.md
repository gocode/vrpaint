# VRpaint — graffiti en réalité virtuelle

Un mur (8 m × 3 m par défaut, réglable) et les devantures de la rue à peindre à la bombe, dans le casque Meta Quest (WebXR) ou à la souris sur PC.
Aucune installation ni compilation : du HTML/JavaScript servi par WAMP, Three.js chargé depuis le CDN jsDelivr.

## Lancer

- **PC** : http://localhost/VRpaint/
- **Test automatique** (peinture scriptée, sans casque) : http://localhost/VRpaint/?test (ou `?test=night`)
- **Test des caches et du raclage** : http://localhost/VRpaint/?test=caches (fond bleu, caches superposés, aplat rouge,
  retrait des caches, raclage au couteau, à la spatule et au grattoir, puis contrôles d'annulation exacte)
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
| Changer d'outil | onglet **Outils** de la palette ; gâchette latérale (grip) de la main droite = bombe ⇄ dernier outil |

**Caches** (outil « Caches ») :
| Action | Commande |
|---|---|
| Poser un cache | viser le mur + gâchette : le cache apparaît, on le place en gardant la gâchette, on lâche pour le coller |
| Déplacer / tourner | gâchette sur un cache, puis bouger la main ; tourner le poignet le fait pivoter |
| Taille | joystick droit ↑ ↓ en visant (ou en tenant) un cache |
| Retirer | A en visant un cache · « Retirer tous les caches » dans l'onglet Outils |

**Racloirs** (couteau, spatule, grattoir) : la lame dépasse de la manette. Elle racle dès qu'elle touche le mur ; plus on
l'enfonce « dans » le mur (jusqu'à 3 cm), plus on appuie. La gâchette ajoute de la pression au contact. Le fil de la lame
suit le poignet : tirer la lame en travers racle, la faire glisser dans son axe ne fait rien. Tenue presque à plat, elle
glisse ; entre 20 et 50°, elle mord. Les manettes vibrent : un choc au contact, puis un grain qui suit la pression et la
vitesse. L'outil recule dans la main au lieu de traverser le mur.

Palette à 6 onglets :
- **Couleurs** : le nuancier ;
- **Perso** : teinte, finition, Enregistrer, Mes couleurs ;
- **Outils** : bombe, caches (forme, taille, décollement, tout retirer), couteau, spatule, grattoir ;
- **Modèle** : choisir la photo de référence, l'afficher à gauche, à droite ou au-dessus de la palette, ou sur un chevalet près du mur, et régler sa taille. Les photos s'ajoutent depuis le panneau du navigateur, avant d'entrer en VR ;
- **Réglages** : annuler, effacer, nuit, coulures, viseur, main droite/gauche, type et taille du mur ;
- **Projets** : nouveau, enregistrer, ouvrir.

Les caps et le potentiomètre de largeur restent visibles en bas, quel que soit l'onglet.

### PC
Clic gauche : peindre (Maj : pression légère) · molette : distance au mur · Maj + molette : angle du flat cap ·
clic droit + glisser : regarder · ZQSD ou flèches : se déplacer · A/E : descendre/monter · 1–5 : caps ·
Ctrl+Z : annuler · N : nuit · V : viseur · C : coulures · X : secouer.
Clic sur la pastille de la couleur en cours : éditeur de couleur perso. Clic droit sur une couleur de « Mes couleurs » : la retirer.

Outils : B = bombe · M = caches · R = racloir suivant (couteau, spatule, grattoir), ou la section **Outil** du panneau.
- Caches : clic sur le mur = poser (glisser avant de lâcher pour le placer) · clic sur un cache = le déplacer ·
  molette sur un cache = taille · Maj + molette = rotation · Suppr = le retirer. Sans cache sous le pointeur, la molette
  règle la taille du prochain cache et Maj + molette son angle.
- Racloirs : glisser sur le mur · molette = pression · Maj + molette = angle de la lame (curseur « Angle »).

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
- **Caches (pochoirs)** : rond, carré, triangle, cerceau, étoile et ruban de masquage de 48 mm, sur le mur comme sur
  les devantures, 16 au plus par surface, superposables. Ce sont des films transparents posés devant le mur.
  La peinture ne passe pas dessous. Les formes sont calculées exactement dans le shader des tampons (fonctions de
  distance), donc nettes à toute résolution, sans mémoire en plus.
  Chaque cache a un **décollement** (0 à 30 mm). Plaqué, il donne un bord net. Décollé, le jet le prend en biais :
  le bord se décale selon l'inclinaison de la bombe (parallaxe) et s'estompe, car le brouillard file dessous.
  Les coulures s'arrêtent sur les caches. Un cache protège aussi du raclage, pour racler au pochoir.
- **Raclage et couches** : trois racloirs, chacun avec sa largeur, la souplesse de sa lame, ses stries, ses éclats et ses
  ébréchures.
  - **Couteau à peindre** (3 cm, souple) : stries fines.
  - **Spatule** (8 cm) : arrache la peinture par plaques irrégulières.
  - **Grattoir à lame de rasoir** (4 cm) : coupe net et descend facilement jusqu'au mur.

  Une pression légère retire la dernière couche et montre celle du dessous. Une pression forte ronge aussi le
  dessous jusqu'au mur nu, avec des éclats et des rayures. Les stries suivent la lame ; l'efficacité dépend de
  l'angle de la lame sur le mur et de sa direction par rapport au geste.
  Stratification retenue : chaque surface a, en plus des couches visibles, une couche **« fond »**. À chaque trait,
  là où il dépose de la peinture, le fond reçoit ce que ce trait recouvre : l'état du mur au début du geste, que
  l'historique a de toute façon copié. Racler ramène donc la couche visible vers ce qu'il y avait juste dessous, au
  texel près, sans découpage par carreau. Tout se fait automatiquement, sans bouton « figer ».
  Options écartées :
  - une épaisseur par texel : elle sait combien retirer, pas quelle couleur révéler ;
  - un fond figé à chaque séance ou à la demande : il force à gérer les couches à la main, et figer tout le mur
    coûte, dans l'historique, deux fois la surface peinte ;
  - une pile de N couches : N fois la mémoire, hors de portée du Quest 2.

  Le fond coûte environ 56 Mo de plus pour un mur de 8 m sur Quest 2. Le raclage travaille sur l'écart
  (visible − fond), qu'il efface de façon multiplicative : le résultat ne dépend ni de l'ordre ni du recouvrement des
  passages. Chaque passage de lame balaie un quadrilatère sans recouvrement : racler vite ou lentement retire autant.
- **Murs** :
  - 11 types : briques, briques peintes, parpaings, pierre, béton banché, crépi, tôle ondulée, palissade bois, carrelage métro, mur blanc, mur noir ;
  - taille réglable de 3 à 16 m de large et de 2 à 6 m de haut ; la peinture déjà faite reste à sa place, et Annuler rend le mur d'avant intact.
- **Autres surfaces** : les devantures et rideaux de toutes les boutiques de la rue se peignent aussi. La bombe vise la surface la plus proche. Une devanture n'occupe de mémoire qu'au premier coup de bombe.
- **Annulation** : chaque geste s'annule :
  - un trait et ses coulures ;
  - un raclage ;
  - la pose, le déplacement, le redimensionnement ou le retrait d'un cache ;
  - un effacement ;
  - un changement de taille.

  L'historique ne garde que les carreaux de 256 × 256 points réellement touchés, couche « fond » comprise : on remonte
  des dizaines, voire des centaines d'étapes. Le budget est de 200 Mo sur Quest 2 autonome et de 900 Mo sur PC ;
  au-delà, les plus vieux gestes sont oubliés.
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
- les caches posés et la couche « fond » de chaque surface (un projet plus ancien s'ouvre sans cache, avec un fond vide : le raclage y révèle le mur) ;
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
| `js/history.js` | Historique d'annulation par carreaux, commun à toutes les surfaces (couches visibles et « fond ») |
| `js/stencils.js` | Caches : formes (fonctions de distance GLSL et JS), films 3D, pose / déplacement / retrait annulables |
| `js/scraper.js` | Racloirs : géométrie de la lame, pression, angle d'attaque, modèles 3D |
| `js/canvases.js` | Devantures peignables (surfaces créées à la demande, calques de peinture) |
| `js/street.js` | Rue, immeubles, fenêtres et vitrines en profondeur (interior mapping), mobilier, réverbères |
| `js/cars.js` | Voitures procédurales (profils extrudés et galbés) et circulation |
| `js/sky.js` | Ciel jour/nuit, Voie lactée, étoiles, avions, étoiles filantes |
| `js/refs.js` | Modèles photo (import, affichage à côté de la palette ou sur chevalet) |
| `adresse.php` | Adresse réseau du PC à taper dans le casque |
| `js/xr.js` | Manettes Quest : pulvérisation, palette, déplacements, retour haptique |
| `js/vrui.js` | Palette tenue en main en VR (canvas texturé, 6 onglets) |
| `js/desktop.js`, `js/ui.js` | Mode PC : souris/clavier et panneau d'outils |
| `js/state.js` | État partagé, couleurs perso, préférences (localStorage) |
| `js/storage.js` | Projets IndexedDB (couches compressées gzip), migration de l'ancienne sauvegarde |
| `js/audio.js` | Souffle de la bombe et cliquetis de la bille (Web Audio, sans fichier son) |
| `js/test.js` | Peinture scriptée de contrôle (`?test`, `?test=caches`) |

Toute écriture dans les couches de peinture passe par un rendu, jamais par un simple `clear()`. Sinon les niveaux de
mipmap, utilisés quand on regarde le mur de loin en VR, garderaient l'ancienne peinture. Le test `?test` vérifie ce point :
après « Tout effacer », une vue basse résolution doit être identique au mur vierge. Il affiche `VRPAINT_CLEAR_CHECK OK`
ou `ECHEC` dans la console.
Le raclage obéit à la même règle : les passes « visible − fond », raclage et « + fond » sont des rendus, et les mipmaps
ne sont régénérées qu'au dernier. `?test=caches` vérifie l'annulation sur les données brutes half-float de toutes les
couches, fond compris :
- `VRPAINT_UNDO_CHECK` : annuler les raclages rend les couches d'avant au bit près ;
- `VRPAINT_UNDO_ALL_CHECK` : tout annuler rend le mur vierge, sans aucun cache.

Résolution : environ 2 mm par texel sur Quest 2 et 1,5 mm sur PC pour le mur, 3,5 et 2,5 mm pour les devantures,
4096 texels au plus. La rue a une implantation fixe, prévue pour un mur de 16 m : les devantures peintes retrouvent
toujours leur place.

## Pistes suivantes

- Phosphorescence réaliste : charge à la lumière, déclin progressif dans le noir, lampe UV.
- Peinture qui s'accumule sur les caches (et qu'on reporte en les déplaçant) ; raclage qui étale la peinture encore fraîche.
- Pipette (prélever une couleur sur le mur), niveau de la bombe qui se vide.
- Export et import d'un projet en fichier, pour passer du PC au casque.