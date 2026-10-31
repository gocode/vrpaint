# VRpaint — graffiti en réalité virtuelle

Un mur (8 m × 3 m par défaut, réglable) et les devantures de la rue à peindre à la bombe ou au pinceau, dans le casque Meta Quest (WebXR) ou à la souris sur PC, ou au doigt sur téléphone et tablette.
Aucune installation ni compilation : du HTML/JavaScript servi par WAMP, Three.js chargé depuis le CDN jsDelivr.

## Lancer

- **PC** : http://localhost/VRpaint/
- **Test automatique** (peinture scriptée, sans casque) : http://localhost/VRpaint/?test (ou `?test=night`)
- **Test des caches et du raclage** : http://localhost/VRpaint/?test=caches (fond bleu, caches superposés, aplat rouge,
  retrait des caches, raclage au couteau, à la spatule et au grattoir, puis contrôles d'annulation exacte)
- **Test du papier journal et des pinceaux** : http://localhost/VRpaint/?test=outils (fond bleu sec, rouge par-dessus,
  appuis et frottement au papier journal, traits de pinceau rond et plat, puis annulation exacte et enregistrement ;
  lignes `VRPAINT_OUTILS_…` dans la console). Contrôle complet, en headless : `node tests/outils.mjs`
  (voir [Pinceaux et papier journal](#pinceaux-et-papier-journal)).
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
| Changer d'outil | onglet **Outils** de la palette ; gâchette latérale (grip) de la main droite = bombe ⇄ dernier outil |
| Revenir au navigateur | **Quitter la VR** en haut à droite de la palette, puis **Confirmer ?** dans les 3 s (ou bouton Meta de la manette droite, puis « Quitter ») ; le projet est enregistré à la sortie |

**Caches** (outil « Caches ») :
| Action | Commande |
|---|---|
| Poser un cache | viser le mur + gâchette : le cache apparaît, on le place en gardant la gâchette, on lâche pour le coller |
| Déplacer / tourner | gâchette sur un cache, puis bouger la main ; tourner le poignet le fait pivoter |
| Taille | joystick droit ↑ ↓ en visant (ou en tenant) un cache |
| Retirer | A en visant un cache · « Retirer tous les caches » dans l'onglet Outils |

**Pinceaux** (rond, plat) : les poils dépassent de la manette et peignent dès qu'ils touchent le mur, avec la couleur en
cours. Plus on les plie « dans » le mur (jusqu'à 3 cm), plus le pinceau s'écrase et charge le trait ; la gâchette ajoute
de la pression au contact. La tranche du pinceau plat suit le poignet : à plat en travers du geste, il couvre une bande ;
de chant, il trace un filet. La charge s'épuise le long du trait ; décoller le pinceau du mur une demi-seconde le
recharge. Taille : onglet **Outils** (rond : 1, 2,5 ou 5 cm ; plat : 2, 4 ou 8 cm).

**Papier journal** : une boule de papier froissé au bout de la manette. La presser contre le mur (tamponner) ou la
frotter emporte une fine couche de la peinture fraîche ou récente ; l'écraser davantage (jusqu'à 3,5 cm) élargit le
contact. À chaque nouvel appui, le papier a tourné et s'est re-froissé : le motif change. Vibrations : un petit choc
à l'appui, puis un grain en frottant.

**Racloirs** (couteau, spatule, grattoir) : la lame dépasse de la manette. Elle racle dès qu'elle touche le mur ; plus on
l'enfonce « dans » le mur (jusqu'à 3 cm), plus on appuie. La gâchette ajoute de la pression au contact. Le fil de la lame
suit le poignet : tirer la lame en travers racle, la faire glisser dans son axe ne fait rien. Tenue presque à plat, elle
glisse ; entre 20 et 50°, elle mord. Les manettes vibrent : un choc au contact, puis un grain qui suit la pression et la
vitesse. L'outil recule dans la main au lieu de traverser le mur.

Palette à 6 onglets :
- **Couleurs** : le nuancier ;
- **Perso** : teinte, finition, Enregistrer, Mes couleurs ;
- **Outils** : en haut ce qui pose la peinture (bombe, pinceau rond, pinceau plat, caches : forme, taille,
  décollement, tout retirer), en bas ce qui l'enlève (couteau, spatule, grattoir, papier journal) ; tailles des pinceaux ;
- **Modèle** : choisir la photo de référence, l'afficher à gauche, à droite ou au-dessus de la palette, ou sur un chevalet près du mur, et régler sa taille. Les photos s'ajoutent depuis le panneau du navigateur, avant d'entrer en VR ;
- **Réglages** : annuler, effacer, nuit, coulures, viseur, main droite/gauche, type et taille du mur ;
- **Projets** : nouveau, enregistrer, ouvrir (les projets du PC, communs au PC et au casque).

Les caps et le potentiomètre de largeur restent visibles en bas, quel que soit l'onglet, comme **Quitter la VR** en haut.
`node tests/sortie-vr.mjs` vérifie, sur une séance simulée, que ce bouton est présent sur chaque onglet sans rien
chevaucher, qu'un appui seul ne quitte pas et que la sortie rend bien la page du navigateur.

### PC
Clic gauche : peindre (Maj : pression légère) · molette : distance au mur · Maj + molette : angle du flat cap ·
clic droit + glisser : regarder · ZQSD ou flèches : se déplacer · A/E : descendre/monter · 1–5 : caps ·
Ctrl+Z : annuler · N : nuit · V : viseur · C : coulures · X : secouer.
Clic sur la pastille de la couleur en cours : éditeur de couleur perso. Clic droit sur une couleur de « Mes couleurs » : la retirer.

Outils : B = bombe · P = pinceau rond ⇄ plat · M = caches · R = racloir suivant (couteau, spatule, grattoir) ·
J = papier journal, ou la section **Outil** du panneau.
- Pinceaux : glisser sur le mur · molette = pression (le rond s'écrase et s'élargit) · Maj + molette = angle du pinceau
  plat (curseur « Angle ») · taille dans le panneau. Relâcher un instant recharge le pinceau.
- Papier journal : clic = tamponner, glisser = frotter · molette = pression. Chaque clic est un nouveau froissage.
- Caches : clic sur le mur = poser (glisser avant de lâcher pour le placer) · clic sur un cache = le déplacer ·
  molette sur un cache = taille · Maj + molette = rotation · Suppr = le retirer. Sans cache sous le pointeur, la molette
  règle la taille du prochain cache et Maj + molette son angle.
- Racloirs : glisser sur le mur · molette = pression · Maj + molette = angle de la lame (curseur « Angle »).

### Téléphone et tablette (au doigt)
Chaque geste a un seul rôle, pour qu'aucun ne déclenche l'autre :

| Geste | Effet |
|---|---|
| **Un doigt** | peindre (avec les caches : poser ou déplacer un cache ; avec un racloir : racler ; avec le papier journal : tamponner, ou frotter en glissant). Une tape brève fait un point. |
| **Deux doigts qui glissent** | regarder autour : on « attrape » le décor, qui suit les doigts (glisser vers le bas lève la tête). |
| **Pincer / écarter** | largeur du jet de la bombe (30 à 250 %), avec une bulle « Jet 120 % · ≈ 18 cm » et l'anneau du viseur qui suit. Avec les caches : taille du cache touché, et en tournant les doigts son angle (sans cache sous les doigts : taille du prochain). Avec un racloir, un pinceau ou le papier journal : pression. |
| **Croix en bas à gauche** | avancer, reculer, se décaler, y compris en diagonale. Elle est progressive : plus le pouce s'éloigne du centre, plus on va vite. |
| **⤒ ⤓** | monter, descendre la nacelle. |

Garde-fous :
- **Pas de peinture parasite.** Un doigt seul ne peint qu'après 120 ms, ou dès qu'il glisse de plus de 10 px. Un deuxième
  doigt posé dans ce délai n'a donc rien laissé. Le trait part quand même bien du point de contact.
- Un geste à deux doigts se décide dès le départ : **glisser** si le milieu bouge d'abord de 18 px, **pincer** si l'écart
  change d'abord de 22 px. Un glisser à deux doigts un peu ouvert ne change pas la largeur en passant.
- Lever un doigt ne relance pas la peinture : il faut lever les deux pour revenir au pinceau.
- **Pas de zoom ni de défilement de la page.** Pour cela : `touch-action: none` sur la scène et la croix,
  `touch-action: pan-y` sur le panneau, `maximum-scale=1` (pas de zoom automatique d'iOS sur les champs) et
  `gesturestart` bloqué pour Safari.
- **Petit écran.** Le bouton ☰ ouvre le panneau, qui recouvre la croix. Toucher la scène à côté le referme, sans peindre.

Réglages, dans la section **Écran tactile** du panneau (visible seulement sur un écran tactile) :
- **Deux doigts : glisser le long du mur.** Au lieu de tourner la tête, on se déplace parallèlement au mur ;
  le mur suit les doigts.
- **Pincer : avancer / reculer.** Écarter les doigts rapproche du mur ; le mur grossit autant que l'écart. La largeur se
  règle alors avec le curseur « Largeur du jet ».
- Afficher ou masquer la croix.

La souris et le clavier ne passent pas par ce code : sur PC, rien ne change. La croix n'apparaît qu'avec un écran
tactile, détecté par `pointer: coarse` ou au premier contact d'un doigt.

Contrôle automatique : Chrome headless avec GPU, sans fenêtre. Il émule un téléphone et envoie de vrais événements
tactiles CDP. Il vérifie chaque geste ci-dessus, la souris et le clavier du PC, puis `?test`. Captures dans `tmp/tactile/`.
```bash
node tests/tactile.mjs
```

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
- **Pinceaux** : un pinceau rond (1, 2,5 et 5 cm) et un pinceau plat (2, 4 et 8 cm), chargés de la couleur en cours
  (mate, métallisée, fluo, phospho…).
  - **Trace de poils** : la touffe est faite de 10 à 50 mèches, toujours les mêmes pour un pinceau donné. Chacune a sa
    place dans la touffe, son épaisseur (au moins 1,7 texel du mur, sinon elle se tramerait) et son opacité. Chaque mèche suit sa propre trajectoire et y pose de petits
    tampons nets, tous les ½ rayon : le trait est strié dans le sens du geste.
  - **Charge** : chaque mèche a sa réserve, qui baisse avec la peinture posée (plus vite en appuyant). Chargé, le
    pinceau couvre presque entièrement. En se vidant, une mèche pâlit, puis ne touche plus que par endroits (bruit le
    long de son chemin) : le trait se casse en traînées sèches, mèche après mèche, sur 1 m environ. Décoller le
    pinceau du mur une demi-seconde le recharge (on le retrempe) ; changer de couleur aussi. La couleur des poils du
    pinceau tenu en main pâlit avec la charge.
  - **Pression** : le pinceau rond s'écrase (de 30 % de son diamètre, la pointe, jusqu'au ventre entier). Le pinceau
    plat garde sa largeur, mais sa tranche épaissit.
  - **Tranche** : le pinceau plat est orienté par le poignet (par le curseur « Angle » à la souris). En travers du
    geste, il couvre une bande de toute sa largeur ; de chant, il trace un filet de quelques millimètres.
  - La peinture passe par les mêmes tampons que la bombe : les caches l'arrêtent, la couche « fond » garde ce qu'elle
    recouvre (le raclage et le papier journal le retrouvent), l'annulation est exacte.
- **Papier journal froissé** : une boule de 11 cm. Pressée sur le mur, elle n'en touche que les crêtes.
  - **Motif** : le papier est modélisé comme un relief plan par morceaux. Chaque pli est une cellule de Voronoi
    (environ 2,5 cm) dont la hauteur est la distance aux arêtes de la cellule. Les cellules sont donc de petites
    pyramides : des facettes planes séparées par des arêtes vives, comme un relief de montagnes vu du ciel. Deux
    échelles de plis se superposent (2,5 cm et 1,1 cm) ; plus fins, les plis tomberaient sous la taille d'un texel du
    mur. La boule est bombée : le contact part du centre. La pression abaisse le niveau de contact. Le bord du contact
    est net, sur un texel, et chaque facette emporte plus ou moins selon sa pente : ce n'est pas un bruit flou.
  - **Chaque appui est différent** : à chaque nouvel appui, une nouvelle graine (un autre froissage) et une rotation au
    hasard ; en VR, le motif tourne aussi avec le poignet.
  - **Tamponner, appuyer, frotter** : appuyer plus fort sur place agrandit le contact, sans repasser sur ce qui est
    déjà parti. Le shader n'emporte que la différence entre les deux pressions : 1 − (1 − e₁)/(1 − e₀). En frottant, le
    motif est reposé tous les 5 mm (ou tous les 4° de rotation), moins fort qu'un appui franc. La boule roule à 80 % et
    glisse à 20 % : d'autres plis viennent toucher, et la bande frottée est une mosaïque de facettes, pas des rayures.
  - **Fraîche ou récente** : le papier travaille comme le raclage, sur l'écart entre la couche visible et le « fond ».
    Il ramène la dernière couche vers ce qu'elle recouvrait, sans jamais toucher au fond : il montre les couches sèches
    du dessous, jamais le mur. La peinture fraîche (posée il y a quelques secondes) part bien mieux que la peinture
    récente, déjà prise. La fraîcheur vient d'une carte à mailles de 3 cm, tenue par la bombe et les pinceaux ; elle
    n'est pas enregistrée, et un projet rouvert est sec.
  - Un cache protège aussi du papier. Chaque appui (et chaque frottement) s'annule d'un coup ; les passes sont des
    rendus, comme le raclage.
- **Murs** :
  - 11 types : briques, briques peintes, parpaings, pierre, béton banché, crépi, tôle ondulée, palissade bois, carrelage métro, mur blanc, mur noir ;
  - taille réglable de 3 à 16 m de large et de 2 à 6 m de haut ; la peinture déjà faite reste à sa place, et Annuler rend le mur d'avant intact.
- **Autres surfaces** : les devantures et rideaux de toutes les boutiques de la rue se peignent aussi. La bombe vise la surface la plus proche. Une devanture n'occupe de mémoire qu'au premier coup de bombe.
- **Annulation** : chaque geste s'annule :
  - un trait et ses coulures ;
  - un raclage, un appui ou un frottement au papier journal, un trait de pinceau ;
  - la pose, le déplacement, le redimensionnement ou le retrait d'un cache ;
  - un effacement ;
  - un changement de taille.

  Deux gestes rapprochés restent deux annulations : avant d'ouvrir un geste, ce qui attend encore d'être écrit est
  écrit et rangé dans le geste d'avant (le test, qui rejoue 40 pas par image, l'avait révélé avec le papier journal).

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

### Garder un projet dans un fichier

Le navigateur peut effacer ses données (nettoyage, manque de place, navigation privée) : sur la version en ligne,
c'est là que sont les projets. « Télécharger » (panneau du navigateur, et onglet Projets de la palette VR) enregistre le
projet ouvert puis le télécharge en fichier `.vrpaint` (le même format que sur le PC : peinture du mur et des devantures,
caches, couleurs perso, photos modèles). « Ouvrir un fichier » (panneau du navigateur) le remet dans la liste et l'ouvre,
là où on en était. Il marche partout : version en ligne, PC, casque, d'un appareil à l'autre.

- Le fichier est contrôlé avant d'être rangé (en-tête, blocs complets, couches intactes) : un fichier abîmé est refusé.
- Rouvrir le fichier d'une version déjà dans la liste ne crée pas de doublon. Si la liste en a une autre version, le
  fichier devient un projet à part « … (fichier) » : rien n'est écrasé.
- Dans le casque, le fichier arrive dans les téléchargements du Quest ; pour le rouvrir, sortir de la VR et passer par
  « Ouvrir un fichier » dans la page (le sélecteur de fichiers n'existe pas en VR).

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
  anciens projets du navigateur, renommage et suppression, puis fichier `.vrpaint` téléchargé et rouvert identique dans
  un navigateur neuf sans le PC (sans doublon la seconde fois, fichier tronqué refusé). Affiche `PROJETS_OK` ou `PROJETS_ECHEC` (environ 4 min ;
  `--rapide` remplace la peinture scriptée par des rayures). Utilise `playwright-core` (variable `PLAYWRIGHT_CORE`).
  Pour vérifier une autre copie du jeu (un worktree), `VRPAINT_PC` et `VRPAINT_CASQUE` remplacent les deux adresses.

À essayer dans le casque (non vérifiable en headless) :
- au premier lancement dans le navigateur du Quest (https://&lt;IP du PC&gt;/), les anciens projets du casque rejoignent la liste ;
- un projet commencé sur le PC, repris dans le casque puis de nouveau sur le PC ;
- le temps d'ouverture d'un grand mur en Wi-Fi et la mémoire du Quest 2 ;
- « Télécharger » depuis la palette en VR (le fichier doit arriver dans les téléchargements du Quest), puis
  « Ouvrir un fichier » dans la page du navigateur du casque.

## Architecture

| Fichier | Rôle |
|---|---|
| `js/paint.js` | Moteur de peinture GPU : tampons instanciés rendus dans 3 render targets half-float (couleur, rugosité/métal, émission), annulation, export/import, redimensionnement |
| `js/spray.js` | Physique de la bombe : projection du cône, caps, largeur réglable, gouttelettes, peinture fraîche, coulures |
| `js/world.js` | Mur (textures procédurales), ciel, éclairage jour/nuit, environnement de reflets, bombe 3D, viseur, nacelle |
| `js/history.js` | Historique d'annulation par carreaux, commun à toutes les surfaces (couches visibles et « fond ») |
| `js/stencils.js` | Caches : formes (fonctions de distance GLSL et JS), films 3D, pose / déplacement / retrait annulables |
| `js/scraper.js` | Racloirs : géométrie de la lame, pression, angle d'attaque, modèles 3D |
| `js/brush.js` | Pinceaux rond et plat : touffe de mèches, charge de chaque mèche, tranche, modèles 3D |
| `js/newspaper.js` | Papier journal : motif de papier froissé (GLSL), appuis et frottements, fraîcheur de la peinture, boule de papier 3D |
| `js/canvases.js` | Devantures peignables (surfaces créées à la demande, calques de peinture) |
| `js/street.js` | Rue, immeubles, fenêtres et vitrines en profondeur (interior mapping), mobilier, réverbères |
| `js/cars.js` | Voitures procédurales (profils extrudés et galbés) et circulation |
| `js/sky.js` | Ciel jour/nuit, Voie lactée, étoiles, avions, étoiles filantes |
| `js/refs.js` | Modèles photo (import, affichage à côté de la palette ou sur chevalet) |
| `adresse.php` | Adresse réseau du PC à taper dans le casque |
| `projets.php`, `js/projectfile.js` | Collection de projets sur le PC, commune au PC et au casque ; format de fichier d'un projet |
| `js/xr.js` | Manettes Quest : pulvérisation, palette, déplacements, retour haptique |
| `js/vrui.js` | Palette tenue en main en VR (canvas texturé, 6 onglets) |
| `js/spectator.js` | Vue spectateur sur l'écran du PC pendant une session Link (casque lissé, vue du mur, silhouette du peintre) |
| `js/desktop.js`, `js/ui.js` | Mode PC : souris/clavier et panneau d'outils |
| `js/touch.js` | Écran tactile : un doigt peint, gestes à deux doigts, croix de déplacement, bulle du pincement |
| `js/state.js` | État partagé, couleurs perso, préférences (localStorage) |
| `js/storage.js` | Projets : sur le PC (projets.php) ou dans le navigateur (IndexedDB), couches compressées gzip, reprise des anciens projets |
| `js/audio.js` | Souffle de la bombe et cliquetis de la bille (Web Audio, sans fichier son) |
| `js/frames.js` | Rendu à la demande sur PC : pas d'image recalculée quand l'écran n'a pas à changer |
| `js/test.js`, `js/test-outils.js` | Peinture scriptée de contrôle (`?test`, `?test=caches`, `?test=outils`) |

Toute écriture dans les couches de peinture passe par un rendu, jamais par un simple `clear()`. Sinon les niveaux de
mipmap, utilisés quand on regarde le mur de loin en VR, garderaient l'ancienne peinture. Le test `?test` vérifie ce point :
après « Tout effacer », une vue basse résolution doit être identique au mur vierge. Il affiche `VRPAINT_CLEAR_CHECK OK`
ou `ECHEC` dans la console.
Le raclage obéit à la même règle : les passes « visible − fond », raclage et « + fond » sont des rendus, et les mipmaps
ne sont régénérées qu'au dernier. `?test=caches` vérifie l'annulation sur les données brutes half-float de toutes les
couches, fond compris :
- `VRPAINT_UNDO_CHECK` : annuler les raclages rend les couches d'avant au bit près ;
- `VRPAINT_UNDO_ALL_CHECK` : tout annuler rend le mur vierge, sans aucun cache.

Le papier journal utilise les mêmes passes : il multiplie l'écart (visible − fond) sans toucher au fond.

### Pinceaux et papier journal

`?test=outils` rejoue des gestes image par image et mesure le résultat sur des images du mur (2 mm par pixel, 1 mm
pour les traits de pinceau) :

| Contrôle | Ce qui est vérifié |
|---|---|
| `PAPIER_REVELE` | sur un rouge posé sur un bleu sec, le papier ne fait apparaître que du bleu : aucun pixel hors du mélange rouge-bleu (le mur ne se montre jamais) |
| `PAPIER_NET` | bord de contact net : peu de pixels de transition entre « touché » et « pas touché » |
| `PAPIER_CHAQUE_APPUI` | deux appuis identiques ne donnent pas le même motif (corrélation faible) |
| `PAPIER_PRESSION` | un appui fort touche bien plus de surface qu'un appui léger |
| `PAPIER_FRAIS` | la peinture fraîche part mieux que la peinture récente |
| `PAPIER_FOND_INTACT` | huit appuis forts au même endroit montrent le bleu presque entier, et toujours pas le mur |
| `PAPIER_FROTTE` | frotter laisse une bande continue |
| `PINCEAU_CHARGE` | le long d'un trait de 2,3 m, la couverture baisse : le pinceau se vide |
| `PINCEAU_POILS` | en travers du trait, le profil est strié ; au milieu, le trait se casse en traînées |
| `PINCEAU_COULEUR` | le trait a la couleur en cours |
| `PINCEAU_PLAT_TRANCHE` | le pinceau plat en travers du geste couvre une bande ; de chant, un filet |
| `PINCEAU_TAILLES` | le pinceau rond de 5 cm trace bien plus large que celui de 1 cm |
| `UNDO` | annuler tous ces gestes rend les couches brutes (half-float) d'avant, au bit près |
| `ENREGISTRE` | après un trait de pinceau, un appui et un frottement, enregistrer puis rouvrir rend les mêmes couches et la même image |

`node tests/outils.mjs` (≈ 3 min, Chrome headless avec GPU D3D11, aucune fenêtre) lance `?test=outils`, puis vérifie
le panneau du navigateur (boutons d'outil et de taille, HUD), les touches P et J, de vrais gestes de souris (trait de
pinceau, tampon et frottement du papier sur de la peinture, Ctrl+Z), l'onglet Outils de la palette VR (8 outils, rien
ne se chevauche ni ne descend sur les caps, appuis sur un outil et sur une taille), le doigt sur téléphone (trait,
pincer = pression) et enfin `?test=caches`. Images dans `tmp/outils/`.

Non vérifiable en headless, à essayer dans le casque : le contact des poils et de la boule de papier avec le mur,
l'orientation de la tranche au poignet, les vibrations, la lisibilité de l'onglet Outils.

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
- Peinture qui s'accumule sur les caches (et qu'on reporte en les déplaçant) ; raclage qui étale la peinture encore fraîche.
- Pinceau qui mêle la peinture fraîche du mur à sa charge (mouillé sur mouillé) ; papier journal qui se charge de ce
  qu'il emporte et le redépose plus loin ; pot de peinture où tremper le pinceau.
- Pipette (prélever une couleur sur le mur), niveau de la bombe qui se vide.
