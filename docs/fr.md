# JewelBox

## Présentation

Votre collection de CD JewelBox Music Library dans Gladys : les compteurs de l’étagère, les prêts, ce que jouent les lecteurs JewelBox, cinq widgets, des déclencheurs et des actions de scène. Le serveur JewelBox est trouvé sur le réseau local par mDNS ; rien ne sort du réseau local (transport `local`).

C’est une intégration personnelle, absente du store : installez-la depuis l’URL de son dépôt.

## Prérequis

- Gladys 5.1.0 ou plus récent.
- JewelBox Music Library 1.17.0 ou plus récent sur le même réseau, avec son annonce mDNS active (par défaut). JewelBox en Docker : `network_mode: host`, ou saisissez son adresse dans la configuration.

## Configuration

| Champ                     | Par défaut | Rôle                                                        |
| ------------------------- | ---------- | ----------------------------------------------------------- |
| Adresse du serveur        | vide       | vide : trouvé par mDNS ; sinon `http://hôte:3001`           |
| Langue des textes         | Français   | noms des appareils, états, textes des actions               |
| Rappel de prêt (jours)    | 30         | délai du déclencheur « Prêt en retard »                     |
| Lecteurs proposés (jours) | 90         | l’onglet Découverte propose les lecteurs utilisés récemment |

Enregistrez, puis cliquez sur **Tester la connexion** : il cherche le serveur et indique la collection, le nombre d’albums et les lecteurs vus.

## Utilisation

### Appareils

Dans l’onglet **Découverte**, ajoutez :

- **Collection JewelBox** : albums, liste de souhaits, prêtés, artistes, note moyenne, durée d’écoute (heures), plus ancien prêt (jours). Lue chaque minute.
- **Un appareil par lecteur** (appli web, bureau, Android) : lecture, titre, artiste, album. Lu toutes les 10 s.

Un lecteur est « en lecture » quand sa position avance à son rythme habituel : JewelBox n’enregistre pas d’état lecture / pause, une pause est donc vue avec 10 à 50 s de retard. Les lecteurs ne se pilotent pas depuis Gladys.

### Widgets

![Les cinq widgets (illustration générée, pas une capture d’écran)](https://raw.githubusercontent.com/William-De71/gladys-jewelbox/main/docs/assets/widgets.fr.png)

Illustration générée, pas une capture d’écran (albums inventés, pochettes neutres).

- **Lecteur JewelBox** : pochette, titre, artiste, album, état.
- **Collection de CD** : compteurs, albums par décennie, genres phares, note moyenne.
- **Albums prêtés** : qui a quel album, depuis quand ; en orange passé le délai de rappel.
- **Album du jour** : la suggestion du jour de JewelBox ; « Un autre album » en tire un au hasard.
- **Derniers ajouts** : les pochettes des derniers albums (collection, liste de souhaits ou les deux).

### Scènes

Déclencheurs : album ajouté, album prêté, album rendu, prêt en retard, lecture démarrée, lecture arrêtée, nouveau titre. Un prêt ou un retour fait par une action de scène ne déclenche rien (pas de boucle).

Actions : titre en cours, album au hasard (genre facultatif), album du jour, prêter un album, le marquer rendu (par numéro d’album — celui de son adresse dans JewelBox — ou titre exact), scanner la bibliothèque musicale.

Exemples : quand un album est prêté, envoyer « {{triggerEvent.data.title}} prêté à {{triggerEvent.data.borrower}} » ; quand un prêt est en retard, envoyer un rappel ; chaque dimanche, envoyer l’album du jour.

## Dépannage

- **Aucun serveur JewelBox trouvé** : vérifiez que JewelBox tourne et s’annonce (`avahi-browse -rt _jewelbox._tcp`), ou saisissez son adresse.
- **Un lecteur reste « à l’arrêt »** : il n’a pas enregistré de position récemment ; relancez la lecture.
- **Pas de pochette** : la pochette n’est pas stockée sur le serveur JewelBox, ou pèse plus de 300 Ko.
- Journaux : Paramètres → Supervision.
