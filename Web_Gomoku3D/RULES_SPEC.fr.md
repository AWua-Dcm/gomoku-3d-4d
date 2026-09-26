# Gomoku 3D · Règles

Du gomoku (cinq en ligne) sur un plateau en volume N×N×N : **le premier à aligner 5 pions de même couleur sur toute une ligne droite gagne**.

Par rapport au gomoku à plat, la grande différence est qu'il y a bien plus de « lignes droites » — **13 directions** en tout.
Bloquer la face avant ne sert donc à rien : une percée en biais, une percée à la verticale, ou même une ligne qui traverse plusieurs couches, tout cela peut être le coup gagnant.

Sur le plateau il n'y a pas de gravité : **les pions peuvent flotter**, sans aucun support, et on peut jouer sur n'importe quelle case vide.

---

## 1. Le plateau

| Élément | Règle |
|---|---|
| Forme | Plateau cubique, N × N × N cases jouables |
| Taille | 8 ≤ N ≤ 50 au choix, 15 par défaut |
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

## 10. Mode 4D : faire tourner une couche

C'est une variante optionnelle ; on l'active en début de partie avec « 4D · Couche rotative » : **faire tourner une couche de 90° comme dans un Rubik's Cube**,
et les pions déjà posés sur cette couche partent avec elle. « 4D » désigne le temps — le plateau lui-même change,
alors que les coordonnées restent trois axes et que le nombre total de cases reste N×N×N.

Le mode se choisit au début de la partie et **ne peut plus être changé dans la même partie**. Si vous ne l'avez pas choisi, toute cette section ne s'applique pas,
et les règles des sections 1 à 9 n'en sont pas affectées.

### 10.1 Comment tourner

| Paramètre | Valeurs |
|---|---|
| Axe | x / y / z |
| Couche | laquelle (0 à N−1) |
| Sens | horaire / antihoraire |
| Tours | 1 / 2 / 3, soit 90° / 180° / 270° |

**Le sens « horaire » s'observe depuis le côté négatif de l'axe, en regardant vers l'origine.**
Pour l'axe `z`, c'est le sens que vous voyez à l'écran, sans conversion à faire ;
les axes `x` et `y` s'observent respectivement depuis la gauche et depuis le bas du plateau.

Un tour en sens antihoraire équivaut à trois tours en sens horaire. Quatre tours équivalent à rien, donc **cette option n'est pas proposée**.

### 10.2 L'effet d'une rotation

Seules les cases de la couche tournée bougent ; tout ce qui est hors de la couche reste immobile.
Chaque case de la couche a une destination unique, deux pions ne peuvent donc pas se percuter, et **le nombre total de pions ne change jamais**.

### 10.3 Quelles rotations sont refusées

Les contrôles s'enchaînent dans l'ordre ; si l'un d'eux échoue, toute l'opération est abandonnée : le plateau ne bouge pas, cela ne compte pas comme un coup, et rien n'est enregistré.

| Contrôle | En cas d'échec |
|---|---|
| La partie doit être en mode 4D | refus |
| La partie doit être encore en cours | refus |
| Le numéro de couche doit exister | refus |
| La recharge doit être prête | refus |
| Le plateau tourné doit être **différent** d'avant | « aucun changement », ne compte pas comme un coup |
| Après la rotation, le plateau **ne doit pas présenter 5 en ligne** | tout est remis en arrière |

« Doit être différent » regarde **l'aspect du plateau**, et non « combien de tours » :
une couche déjà vide, ou un motif qui retombe exactement sur lui-même, sont tous deux jugés « aucun changement ».
L'interface vous dit laquelle des deux causes, sinon le bouton semblerait cassé.

Le dernier contrôle signifie qu'**une rotation ne peut jamais décider du gain** : elle ne peut pas servir d'arme offensive,
seulement à casser la ligne de l'adversaire ou à réajuster sa propre structure.

### 10.4 Recharge de rotation

> Entre deux rotations, il faut **poser** au moins 5 pions.

- **Seules les poses comptent**, pas la rotation elle-même — sinon cela reviendrait à « un seul coup sur cinq peut être une rotation », trop difficile à suivre.
- Elle se règle sur 3 / 5 / 8 / 10, 5 par défaut.
- La première rotation y est soumise aussi : après le début de la partie, il faut poser 5 pions avant de pouvoir tourner.
- Annuler un coup remet la recharge en arrière elle aussi : le compteur et le plateau ne peuvent pas se désaccorder.

### 10.5 Le coût d'une rotation

Une rotation **consomme tout le tour** : l'adversaire joue aussitôt après, impossible de « tourner puis poser ».
Autrement dit, chaque coup est « poser un pion ou tourner, au choix ».

Une rotation ne compte pas comme « le N-ième coup » ; le N-ième coup désigne toujours la N-ième pose de pion (l'interface indique séparément le nombre de rotations).

### 10.6 Annuler une rotation

| Action | Effet |
|---|---|
| Annuler `Z` | Si le dernier coup est une rotation, la rotation est retirée, si c'est une pose, la pose est retirée ; on peut annuler jusqu'avant le début de la partie |
| Rétablir la rotation `Y` | Disponible seulement quand « le dernier coup est exactement une rotation » |

Dès que quelqu'un pose un pion, cette rotation est acquise et ne peut plus être retirée à part — sinon elle deviendrait une machine à remonter le temps qui traverse plusieurs coups.

Après une annulation, la recharge revient elle aussi à son état d'avant la rotation.

### 10.7 Tailles

| Mode | Tailles possibles | Par défaut |
|---|---|---|
| 3D | 8 ≤ N ≤ 50, les trois axes peuvent différer | 15 |
| 4D | 8 ≤ N ≤ 50, **cubique obligatoire** | 8 |

L'obligation du cube en 4D n'est pas de la paresse : faire tourner une couche exige que les deux côtés de cette couche soient égaux,
et comme les trois axes doivent pouvoir tourner, les trois doivent avoir la même longueur.

Si la taille par défaut en 4D est 8 et non 15, c'est que **plus le plateau est grand, moins une couche contient de pions et moins la rotation se voit** —
sur un plateau 15×15×15, une couche contient en moyenne moins d'un pion, et la plupart des rotations tombent sur « aucun changement ».

## 11. Jouer contre l'ordinateur

- **L'écran de départ a une ligne « Adversaire »** : humain (deux joueurs, un seul appareil) /
  ordinateur · facile / moyen / difficile. Les trois niveaux sont **volontairement faibles** : ils ne
  regardent qu'un coup d'avance, et même le plus difficile ne calcule pas plus loin. Un adversaire
  « facile » qui bat les débutants à tous les coups est le défaut habituel de cette fonction, donc
  tout est tiré vers le bas.
- **Deux choix, deux rôles.** « Premier joueur » choisit la **couleur** qui commence (celle qui porte
  aussi la défaite pour alignement trop long) ; « Qui commence » choisit **lequel des deux** joue cette
  couleur. Ainsi « Noirs en premier + Ordinateur » : l'ordinateur joue Noirs et ouvre, vous jouez
  Blancs. La ligne sous les réglages indique votre couleur.
- **L'ordinateur est soumis lui aussi à la règle de l'alignement trop long** — il évite les cases qui
  lui donneraient six alignés et la défaite. Il rate quand même des trois ouverts et ne voit pas les
  menaces doubles : c'est délibéré, pas un bug.
- **Annuler retire votre coup et la réponse de l'ordinateur ensemble.** « Restaurer la rotation » est
  indisponible contre l'ordinateur : utilisez Annuler.
- **En 4D, l'ordinateur tourne aussi des couches**, mais rarement (au niveau facile, environ une fois
  sur dix), et une rotation ne fait jamais gagner.

## 12. Ce que ce jeu ne fait pas

- **Pas de double-trois ni de double-quatre.** Dans le renju traditionnel, le premier joueur a aussi des interdits comme
  « un coup qui forme à la fois deux trois ouverts / deux quatre » ; ce jeu n'implémente que la défaite pour alignement trop long. La sanction tombe après la pose du pion : il n'existe pas de « cette case est interdite ».
- **Pas d'ordinateur qui calcule.** Les trois niveaux ne regardent qu'un coup d'avance : ils ne
  reconnaissent pas les figures à trou, ne voient pas les menaces doubles, et même le plus difficile ne
  fait aucune recherche sur plusieurs coups. Une vraie force demanderait une implémentation avec recherche.
- **Les rotations n'ont pas d'animation** : elles se font instantanément, seule la couche tournée est brièvement mise en évidence.
- **Les rotations ne se font qu'avec les boutons du panneau**, pas en glissant directement dans la vue 3D.
