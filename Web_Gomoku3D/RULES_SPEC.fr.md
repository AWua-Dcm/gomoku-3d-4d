# Gomocube · Règles

Du gomoku (cinq en ligne) sur un plateau en volume N×N×N : **le premier à aligner 5 pions de même couleur sur toute une ligne droite gagne**.

Par rapport au gomoku à plat, la grande différence est qu'il y a bien plus de « lignes droites » — **13 directions** en tout.
Bloquer la face avant ne sert donc à rien : une percée en biais, une percée à la verticale, ou même une ligne qui traverse plusieurs couches, tout cela peut être le coup gagnant.

Sur le plateau il n'y a pas de gravité : **les pions peuvent flotter**, sans aucun support, et on peut jouer sur n'importe quelle case vide.

---

## 1. Le plateau

| Élément | Règle |
|---|---|
| Forme | Plateau cubique, N × N × N cases jouables |
| Taille | 8 ≤ N ≤ 30 au choix, 15 par défaut |
| Coordonnées | `(x, y, z)`, les trois axes numérotés de 0 à N−1 |
| Couche | les cases de même `z` forment une « couche » ; la « k-ième couche » est celle où `z = k` |
| État d'une case | vide / pion noir / pion blanc |

Les directions des trois axes :

- `x` : croît vers la droite
- `y` : croît vers le haut
- `z` : croît vers l'intérieur de l'écran

Donc, depuis la vue par défaut, **la couche 0 est la plus proche de vous et la plus difficile à masquer**, et une nouvelle partie démarre elle aussi sur la couche 0.

En mode 3D, les trois axes peuvent avoir des longueurs différentes (par exemple un plateau rectangulaire 8×12×30) :
il suffit de désactiver « Liaison des trois axes » pour les saisir séparément.

## 2. Poser un pion

- On peut jouer sur **n'importe quelle case vide**. Ni gravité, ni obligation qu'un pion en soutienne un autre : un pion peut rester suspendu en l'air.
- Un pion par coup, et le tour passe aussitôt à l'adversaire.
- Un pion posé ne peut pas être annulé sur-le-champ, mais on peut annuler un coup.

## 3. Qui joue en premier

- Avant la partie, on choisit « Noir en premier » ou « Blanc en premier », et ce choix **ne change plus de toute la partie**.
- **Le « premier joueur » est celui qui joue le premier coup de la partie** ; ce n'est pas le noir en particulier.
- Pour en changer en cours de partie, « Changer de premier joueur » **relance une partie** avec le nouveau premier joueur — cela ne fait pas changer de camp dans la partie en cours.

## 4. Directions gagnantes : 13

Chaque case participe à au plus 13 lignes à la fois :

| Catégorie | Nombre | Directions |
|---|---|---|
| Axiales | 3 | une le long de chacun des axes x / y / z |
| Diagonales de face | 6 | les obliques de chaque plan de coordonnées (celles du type `(1,1,0)`, `(1,-1,0)`) |
| Diagonales de volume | 4 | les obliques qui traversent les trois axes à la fois (`(±1,±1,±1)`) |

3 axiales + 6 diagonales de face + 4 diagonales de volume = 13.

Le contrôle ne regarde que les 13 directions qui traversent **le pion qui vient d'être posé**, et pour chacune il **compte des deux côtés** :
la longueur d'une ligne entière = 1 + la suite de même couleur d'un côté + la suite de même couleur de l'autre côté.
Ne compter qu'un seul côté laisserait échapper le cas où « un coup relie deux segments de ligne séparés ».

## 5. Victoire et défaite

### 5.1 Second joueur : 5 ou plus gagne

Si une ligne traversant le pion qui vient d'être posé contient 5 pions de même couleur ou plus, la victoire est immédiate.

### 5.2 Premier joueur : exactement 5 en ligne

Le premier joueur **perd pour en avoir trop aligné** :

- **Exactement 5** sur une ligne → victoire.
- **6 ou plus** sur une ligne (alignement trop long) → **défaite immédiate**, l'adversaire gagne.

**La défaite pour alignement trop long suit toujours le rôle de « premier joueur »** : si le noir commence, c'est le noir qui l'assume, si le blanc commence, c'est le blanc,
et le noir devient alors libre (5 ou plus gagne).

### 5.3 Un coup qui fait à la fois 5 et 6

Sur un plateau en volume, il est courant qu'un coup touche deux lignes à la fois ; dans ce cas **l'alignement trop long l'emporte** : c'est une défaite pour alignement trop long.

### 5.4 Une conséquence utile

Quand le premier joueur aligne pion après pion le long d'une ligne, **au 5e pion il a déjà gagné et la partie s'arrête sur-le-champ**,
il n'atteint jamais le 6e. Donc :

> Un alignement trop long ne peut venir que d'« un coup qui relie deux segments » — par exemple avec `0,1,2` et `4,5`
> déjà en place, jouer sur `3` les relie en 6 pions. On n'obtient pas d'alignement trop long en posant les pions un à un.

## 6. Annuler un coup

- On peut annuler jusqu'à revenir avant le début de la partie.
- Annuler efface aussi l'état de victoire : la partie repasse à « en cours » et c'est au tour du camp dont le coup a été retiré.
- Raccourci `Z`, ou le bouton « Annuler Z » sur le panneau.

## 7. Match nul

Le plateau est rempli sans qu'aucun camp n'ait gagné → match nul.
Un 15×15×15 compte 3375 cases : en pratique cela n'arrive presque jamais, mais le règlement prévoit cette issue.

## 8. Pourquoi le premier joueur est limité

Le plateau en volume offre bien plus de lignes que le plateau à plat. Sur un plateau 15×15×15, il y a **23639** lignes de longueur exactement 5,
soit **41 fois** plus que sur un plateau à plat de même côté. Avec autant de directions, « un coup qui crée deux menaces à la fois, l'adversaire ne pouvant en bloquer qu'une »
est bien plus facile qu'à plat — si les deux camps jouaient avec des règles identiques, l'avantage du premier joueur serait trop grand pour que le second ait une partie.

C'est pourquoi le premier joueur porte la restriction « exactement 5 en ligne ». C'est la différence la plus fondamentale entre ce jeu et le gomoku à plat.

## 9. Le panneau de droite : le plateau vu par couches

Le panneau de droite dessine **la couche k vue de face** :

- en horizontal `x`, qui croît vers la droite
- en vertical `y`, qui croît vers le haut
- le numéro de couche `z` est la profondeur ; on le change avec `＜` `＞`, ou en cliquant sur la bande de vignettes en dessous

Le panneau est orienté exactement comme la vue 3D : rien à faire tourner dans sa tête, les deux affichent toujours la même couche.

## 10. Mode 4D : trois mécaniques supplémentaires

La 4D, ce sont les règles 3D inchangées, **plus trois mécaniques**. Choisissez « 4D · Mille facettes » avant la partie et les trois sont actives :

- **Rotation type Rubik** : faire tourner une couche de 90°, comme un cube Rubik ; les pierres déjà posées sur cette couche partent avec elle.
- **Pliage de l'espace** : les six faces du plateau sont reliées, donc un cinq peut traverser un bord.
- **Jour et nuit** : le plateau alterne entre deux phases, et seules les lignes de la phase courante comptent.

« 4D » désigne le temps : le plateau lui-même change, alors que les coordonnées restent trois axes et le nombre total de
cases reste N×N×N.

**Les deux premières peuvent aussi être activées séparément en 3D.** En mode 3D, deux cases à cocher se trouvent sous la
ligne de la taille du plateau — « Rotation type Rubik » et « Pliage de l'espace » — vides par défaut. Chacune cochée ajoute
cette mécanique à la partie 3D ; les deux à la fois, c'est la 4D sans le jour et la nuit. **Le jour et la nuit n'existent
qu'en 4D.**

Cocher « Rotation type Rubik » verrouille le plateau en cube (faire tourner une couche exige que ses deux côtés soient
égaux, et un pavé droit ne peut pas tourner du tout), et la touche « Lier les trois axes » est alors désactivée — même
raison et même traitement qu'en 4D.

Le mode se choisit avant la partie et **ne peut pas être changé pendant**. En 3D sans aucune case cochée, toute cette
section ne s'applique pas, et les sections 1 à 9 n'en sont pas affectées.

### 10.1 Rotation type Rubik : comment tourner

| Paramètre | Valeurs |
|---|---|
| Axe | x / y / z |
| Couche | laquelle (de 0 à N−1) |
| Sens | horaire / antihoraire |
| Nombre de tours | 1 / 2 / 3 quarts de tour, soit 90° / 180° / 270° |

**Le sens « horaire » se regarde depuis l'extrémité négative de cet axe, vers l'origine.**
Pour l'axe `z`, c'est exactement le sens que vous voyez à l'écran, sans conversion ;
pour `x` et `y`, le point de vue est respectivement à gauche du plateau et en dessous.

Un tour antihoraire vaut trois tours horaires. Quatre tours ne sont pas un tour du tout, donc cette option **n'est pas
proposée**.

**La rotation se fait en deux temps : « Exécuter la rotation » montre le résultat, « Confirmer » la fait compter.**
Après avoir appuyé sur « Exécuter la rotation », le plateau **tourne immédiatement pour que vous le voyiez**, mais le coup
n'est pas encore joué : il ne consomme pas le tour, ne compte pas comme un coup et n'entre pas dans l'historique.
Les touches « Confirmer » et « Annuler » sont **toujours sur le panneau** — normalement grisées et inertes ; maintenant
elles s'éclairent avec un anneau, vous rappelant qu'une décision est en attente : « Confirmer » tourne vraiment,
« Annuler » remet le plateau exactement comme avant, comme si rien ne s'était passé. On ne peut pas poser de pierre
pendant l'aperçu — le plateau montre la position tournée, donc cliquer dessus poserait au mauvais endroit.

### 10.2 Rotation type Rubik : ce que fait une rotation

Seules les cases de la couche tournée bougent ; tout ce qui est en dehors reste en place.
Chaque case de cette couche a exactement une destination, donc deux pierres ne se heurtent jamais, et
**le nombre total de pierres ne change jamais**.

### 10.3 Rotation type Rubik : quelles rotations sont refusées

Les contrôles s'enchaînent dans l'ordre ; si l'un échoue, tout est abandonné : le plateau ne bouge pas, cela ne compte pas
comme un coup, et aucune trace n'est gardée.

| Contrôle | En cas d'échec |
|---|---|
| La partie doit être en 4D, ou en 3D avec « Rotation type Rubik » cochée | refus |
| La partie doit être encore en cours | refus |
| Le numéro de couche doit exister | refus |
| La recharge doit être prête | refus |
| Le plateau tourné doit être **différent** d'avant | « aucun changement », ne compte pas comme un coup |
| Après la rotation, le plateau **ne doit pas donner 5 en ligne à l'adversaire** | tout est remis en arrière |

« Doit être différent » regarde **l'aspect du plateau**, et non « combien de tours » : une couche déjà vide, ou un motif qui
retombe exactement sur lui-même, sont tous deux jugés « aucun changement ». L'interface vous dit laquelle des deux causes,
sinon le bouton semblerait cassé.

Le dernier contrôle n'arrête que les lignes de **l'adversaire**. Une rotation **peut faire cinq pour vous** : c'est une
victoire, exactement comme un cinq posé par un coup, et la partie s'arrête là. Si la rotation donne cinq en ligne à
**l'adversaire** (vous avez poussé ses pierres en place), tout est toujours remis en arrière : offrir un cinq à
l'adversaire n'est pas ce que ce coup voulait dire.

Donc **une rotation peut être une arme offensive** : elle casse les lignes adverses, réajuste vos pierres, et peut amener
la dernière pierre manquante à sa place pour gagner.

### 10.4 Pliage de l'espace : les six faces sont cousues

**Les six faces du plateau sont reliées** : on sort d'un bord et on revient par le bord opposé. Idem pour les trois axes.

Il y a plus simple pour se le représenter : **pensez à 3×3×3, soit 27 plateaux identiques empilés**. Vous ne jouez que sur
celui du milieu, et chaque coup s'imprime aussi sur les 26 autres. Ces 26 ne sont pas dessinés — donc « deux pierres à
droite plus trois à gauche » forment bel et bien une suite de cinq dans cet espace empilé.

- On pose les pierres de la même façon : **une pierre n'a qu'une seule position** — elle est là où vous la posez.
- Mais pour que ce soit **visible**, l'anneau de cases qui borde l'extérieur du plateau porte des **ombres** : chaque pierre
  sur le bord a son image une case plus loin. Une ligne qui sort par le bord droit montre sa suite juste au-delà — un cinq
  à travers la couture n'est plus à deviner. Les ombres sont plus petites et plus pâles ; ce ne sont **pas des pierres** :
  seules les vraies pierres comptent, et on ne peut pas jouer sur une ombre.
- **Un anneau complet d'une seule couleur (N pierres) compte aussi comme alignement trop long.** Le pliage allonge les
  lignes, donc vérifiez le côté opposé avant de compléter un cinq ; la règle elle-même n'a pas changé — le premier joueur
  perd encore à 6 en ligne ou plus.
- Cela n'interfère pas avec la rotation : l'une dit « comment une couche permute ses propres cases », l'autre « ce qui se
  passe au-delà d'un bord » ; les deux peuvent être actives en même temps et chacune s'occupe de son côté.

### 10.5 Jour et nuit : seules les lignes de la phase courante comptent

Le plateau alterne entre deux phases : **le jour** et **la nuit**. Chaque pierre retient la phase où elle a été posée.

- **Seules les lignes de la phase courante sont réglées.** Un cinq de nuit qui existe le jour est bien là, mais ne compte
  pas ; à l'instant où la phase bascule vers la nuit et qu'il est toujours là, il est réglé aussitôt.
- **Les pierres de l'autre phase occupent quand même leur case et coupent les lignes** (ce sont des corps, pas du vide).
- Chaque pierre du plateau porte un mince **halo** dont la couleur est sa phase : **rouge pâle pour le jour, bleu pâle pour
  la nuit**. Les pierres des deux phases sont dessinées avec la même netteté (plus de distinction par l'opacité), donc on
  voit d'un coup d'œil à quel camp elles appartiennent. Les vignettes de couches à droite utilisent un petit carré de la
  même couleur (là où la case est trop petite pour un halo, rien n'est dessiné plutôt que de passer à une autre notation).
- La phase bascule tous les 12 coups (modifiable à l'écran de départ, de 10 à 30).

Un coup peut être déclaré :

| Déclaration | Effet |
|---|---|
| normal | l'horloge avance d'une case |
| retenir | l'horloge n'avance pas ; une case est empruntée à la phase suivante |
| hâter | l'horloge avance de deux cases, remboursant une case empruntée |

**On peut seulement décaler le temps, jamais le créer** : un cycle complet vaut toujours 2 × la période, et ce qui est
emprunté est déduit de la phase suivante. Aucune phase ne peut durer moins de 2 coups, et l'emprunt comme le remboursement
sont plafonnés.

### 10.6 Recharge de rotation

> Entre deux rotations, il faut **poser** au moins 5 pierres.

- **Seules les poses comptent** ; la rotation elle-même non — sinon cela deviendrait « un seul coup sur cinq peut être une rotation », trop difficile à suivre.
- Réglable sur 3 / 5 / 8 / 10, par défaut 5.
- La première rotation y est soumise aussi : il faut poser 5 pierres après le début de la partie.
- **La recharge ne commence qu'après avoir appuyé sur « Confirmer »** — l'aperçu n'a pas eu lieu, il ne doit donc pas la consommer.
- L'annulation remet aussi la recharge en arrière, si bien que le compteur et le plateau ne se contredisent jamais.

### 10.7 Ce que coûte une rotation

Une rotation **consomme tout le tour** : l'adversaire joue juste après, et on ne peut pas « tourner puis poser ».
Chaque tour est donc « poser ou tourner, l'un ou l'autre ».

Une rotation ne compte pas comme le coup numéro N ; le Nième coup désigne toujours la Nième pose (l'interface signale les rotations à part).

### 10.8 Annuler une rotation

| Action | Effet |
|---|---|
| Annuler `Z` | Retire le dernier pas — une rotation ou une pose — et peut revenir avant le début de la partie |
| Restaurer la rotation `Y` | Disponible seulement quand le dernier coup est exactement une rotation. **Clavier uniquement — il n'y a pas ce bouton sur le panneau** (cette place revient à « Confirmer » / « Annuler ») ; à la souris ou au tactile, utilisez « Annuler », qui retire cette rotation quand c'est le dernier coup |

Dès que quelqu'un pose une pierre, la rotation a eu lieu et ne peut plus être retirée seule — sinon elle deviendrait une
machine à remonter le temps sur plusieurs coups.

> **Pour retirer une rotation déjà jouée, utilisez « Annuler »** (`Z` ou le bouton). Le panneau avait autrefois une touche
> dédiée « Restaurer la rotation » ; cette place revient maintenant à « Confirmer » et « Annuler », et la capacité
> elle-même n'est pas perdue — quand le dernier coup est exactement une rotation, c'est elle que « Annuler » retire.

L'annulation remet aussi la recharge dans l'état d'avant la rotation.

### 10.9 Tailles

| Mode | Tailles | Par défaut |
|---|---|---|
| 3D | 8 ≤ N ≤ 30, les trois axes peuvent différer | 15 |
| 4D | 8 ≤ N ≤ 30, **obligatoirement cubique** | 8 |

L'obligation de cube en 4D n'est pas de la paresse : faire tourner une couche exige que ses deux côtés soient égaux, et
pour que les trois axes soient rotatifs, les trois doivent avoir la même longueur. Idem en 3D dès que
« Rotation type Rubik » est cochée.

La 4D part sur 8 plutôt que 15 parce que **plus le plateau est grand, moins une couche contient de pierres, et moins une
rotation se voit** — sur un plateau 15×15×15 une couche contient en moyenne moins d'une pierre, et la plupart des rotations
tombent dans le cas « aucun changement ».

### 10.10 Didacticiel

Un bouton **Didacticiel** apparaît à côté de Démarrer une fois la 4D sélectionnée, ou quand une partie 3D
coche Rotation type Rubik / Pliage de l'espace. Chaque niveau est une position préparée avec un objectif :
en 4D, les trois niveaux couvrent la rotation, le pliage et le jour / nuit, tandis qu'en 3D il n'enseigne
que ce que vous avez coché (sans aucune coche, le bouton n'apparaît pas). Il n'y a pas d'adversaire dans
le didacticiel ; un niveau réussi, on passe automatiquement au suivant après une courte pause, et les
touches Précédent / Suivant dans le coin permettent aussi d'avancer et de reculer. Le dernier niveau reste
affiché une fois réussi — la touche Réglages de cette ligne (elle affiche **Quitter** dans le didacticiel)
ramène à l'écran de départ.

## 11. Jouer contre l'ordinateur

- **L'écran de départ a une ligne « Adversaire »** : humain (deux joueurs, un seul appareil), ou cinq
  forces d'ordinateur **Bas / Moyen / Haut / Très haut / Ultra**. **Elles diffèrent par la profondeur de
  calcul, par la capacité du niveau supérieur à prouver un gain forcé, et par leur façon de décider
  s'il faut faire tourner une couche en 4D** : Bas voit un coup, Moyen une réponse, Haut trois
  demi-coups, Très haut cinq. Ultra aussi cinq, mais approfondit davantage quand il en a les moyens
  (approfondissement itératif).
  Ultra ajoute par-dessus une **recherche de gain forcé** : les suites ininterrompues de quatre
  (chacune de vos réponses est forcée) et les **suites de trois ouvertes**. Ces dernières sont bien plus
  difficiles, car une trois ouverte vous laisse plusieurs réponses : il **essaie chacune de vos réponses,
  celles qui bloquent comme celles qui font une quatre pour vous**, et s'il ne peut pas toutes les
  essayer il répond « inconnu » plutôt
  que d'annoncer un gain qui ne tient pas.
  En 4D, Très haut et Ultra **évaluent aussi une rotation avec la même recherche qu'un coup** :
  savoir si une rotation vaut un tour complet se décide sur la même échelle que poser une pierre. Haut et au-dessus
  évitent donc les positions où votre coup suivant ferait un quatre ouvert, alors que Bas y entre sans
  broncher. Les cinq restent volontairement faibles : un adversaire « facile » qui bat les débutants
  à tous les coups est le défaut habituel de cette fonction.
  **En 4D, chaque niveau calcule un ou deux demi-coups plus loin** : une rotation déplace toute une
  formation, et à la profondeur « 3D » l'ordinateur ne voit pas que son propre dernier coup vient d'être
  déplacé — il offre alors un coup gratuit.
- **Ultra vous battra avant que vous ne voyiez le danger.** C'est le résultat de la recherche de gain
  forcé, pas de la chance : il peut poser une trappe dès l'ouverture qui ne paiera que dix coups plus tard.
- **Deux choix, deux rôles.** « Premier joueur » choisit la **couleur** qui commence (celle qui porte
  aussi la défaite pour alignement trop long) ; « Qui commence » choisit **lequel des deux** joue cette
  couleur. Ainsi « Noirs en premier + Ordinateur » : l'ordinateur joue Noirs et ouvre, vous jouez
  Blancs. La ligne sous les réglages indique votre couleur.
- **L'ordinateur est soumis lui aussi à la règle de l'alignement trop long** — il évite les cases qui
  lui donneraient six alignés et la défaite. Il rate quand même des trois ouverts et ne voit pas les
  menaces doubles : c'est délibéré, pas un bug.
- **Annuler retire votre coup et la réponse de l'ordinateur ensemble.** « Restaurer la rotation » est
  indisponible contre l'ordinateur : utilisez Annuler.
- **En 4D, l'ordinateur tourne aussi des couches, mais seulement quand cela vaut un coup.** Il ne tourne
  jamais « pour voir » : uniquement si la rotation casse réellement un **trois ouvert ou mieux** chez
  l'adversaire, ou si elle fait monter sa propre forme d'un cran entier. Une rotation qui laisserait un
  trois ouvert à l'adversaire, il ne la choisit pas lui-même.
  L'ancien critère — « tourner si le meilleur coup à ma disposition dans la bande touchée a augmenté » —
  produisait trois rotations par partie, un tour sur trois, dont seulement un tiers faisait réellement
  baisser la menace. Au niveau facile, la rotation n'est toujours envisagée qu'une fois sur dix environ.
  Une rotation ne fait jamais gagner : elle ne fait que casser des formations et déplacer vos pierres.

## 12. Ce que ce jeu ne fait pas

- **Pas de double-trois ni de double-quatre.** Dans le renju traditionnel, le premier joueur a aussi des interdits comme
  « un coup qui forme à la fois deux trois ouverts / deux quatre » ; ce jeu n'implémente que la défaite pour alignement trop long. La sanction tombe après la pose du pion : il n'existe pas de « cette case est interdite ».
- **L'ordinateur n'est pas un moteur d'échecs.** Son comptage de menaces utilise une fenêtre
  glissante : **il reconnaît donc les formes trouées et les menaces doubles**. Mais il n'a ni
  bibliothèque d'ouvertures, ni joseki, ni recherche de quiescence.
- **Les rotations n'ont pas d'animation** : elles se font instantanément, seule la couche tournée est brièvement mise en évidence.
- **Les rotations ne se font qu'avec les boutons du panneau**, pas en glissant directement dans la vue 3D.
