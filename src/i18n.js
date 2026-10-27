// -----------------------------------------------------------------------------
// Texts of the integration, in English and French (English fallback), the
// two languages of JewelBox itself.
//
// The manifest carries its own labels; these are the texts the code writes at
// runtime: device and feature names, widget contents, statuses, errors,
// toasts and the result of the configuration button. Vocabulary of the
// Gladys interface (appareil, scène). Titles, artists and borrowers come from
// JewelBox as they are, never translated.
// -----------------------------------------------------------------------------

const LANGUAGES = ['en', 'fr'];

const TEXTS = {
  // Devices and features (the device name comes first: "JewelBox collection - Albums").
  deviceCollection: { en: 'JewelBox collection', fr: 'Collection JewelBox' },
  feature_owned: { en: 'Albums', fr: 'Albums' },
  feature_wanted: { en: 'Wish list', fr: 'Liste de souhaits' },
  feature_lent: { en: 'Lent out', fr: 'Prêtés' },
  feature_artists: { en: 'Artists', fr: 'Artistes' },
  feature_rating: { en: 'Average rating', fr: 'Note moyenne' },
  feature_play_time: { en: 'Playing time', fr: 'Durée d’écoute' },
  feature_oldest_loan: { en: 'Oldest loan', fr: 'Plus ancien prêt' },
  feature_plays_today: { en: 'Plays today', fr: 'Écoutes du jour' },
  feature_plays_month: { en: 'Plays this month', fr: 'Écoutes du mois' },
  feature_playing: { en: 'Playback', fr: 'Lecture' },
  feature_track: { en: 'Track', fr: 'Titre' },
  feature_artist: { en: 'Artist', fr: 'Artiste' },
  feature_album: { en: 'Album', fr: 'Album' },
  feature_music_title: { en: 'Now playing: title', fr: 'En cours : titre' },
  feature_music_artist: { en: 'Now playing: artist', fr: 'En cours : artiste' },
  feature_music_album: { en: 'Now playing: album', fr: 'En cours : album' },
  feature_music_artwork: { en: 'Now playing: cover', fr: 'En cours : pochette' },
  feature_music_duration: { en: 'Track duration', fr: 'Durée du titre' },
  feature_music_position: { en: 'Position in the track', fr: 'Position dans le titre' },
  feature_next: { en: 'Next track', fr: 'Titre suivant' },
  feature_previous: { en: 'Previous track', fr: 'Titre précédent' },
  feature_volume: { en: 'Volume', fr: 'Volume' },
  feature_mute: { en: 'Mute', fr: 'Muet' },
  feature_shuffle: { en: 'Shuffle', fr: 'Aléatoire' },
  feature_repeat: { en: 'Repeat', fr: 'Répétition' },
  playbackPaused: { en: 'Paused', fr: 'En pause' },
  playbackPlaying: { en: 'Playing', fr: 'En lecture' },

  // Music players: the catalog of JewelBox in Gladys.
  folderAlbums: { en: 'Albums', fr: 'Albums' },
  folderPlaylists: { en: 'Playlists', fr: 'Playlists' },
  folderSmart: { en: 'Smart playlists', fr: 'Listes intelligentes' },
  albumRadio: { en: 'Radio of this album', fr: 'Radio de cet album' },
  artistRadio: { en: 'Artist radio', fr: 'Radio de l’artiste' },
  tracksCount: { en: '{count} tracks', fr: '{count} titres' },
  smart_newest: { en: 'Recently added', fr: 'Ajouts récents' },
  smart_ever_played: { en: 'Already played', fr: 'Déjà écoutées' },
  smart_never_played: { en: 'Never played', fr: 'Jamais écoutées' },
  smart_last_played: { en: 'Recently played', fr: 'Écoutées récemment' },
  smart_most_played: { en: 'Most played', fr: 'Les plus écoutées' },
  smart_favourites: { en: 'Favourites', fr: 'Favoris' },
  smart_all_tracks: { en: 'All tracks', fr: 'Toutes les pistes' },
  smart_dynamic_mix: { en: 'Dynamic mix', fr: 'Mix dynamique' },

  // Remote control errors (dashboard, scenes).
  errorPlayerOffline: {
    en: '{player} is not connected to JewelBox or does not allow remote control (setting of the player).',
    fr: '{player} n’est pas connecté à JewelBox ou n’autorise pas le contrôle à distance (réglage du lecteur).',
  },
  errorPlaylistNotFound: {
    en: 'No JewelBox playlist named “{playlist}”.',
    fr: 'Aucune playlist JewelBox nommée « {playlist} ».',
  },
  wakeDynamicMix: { en: 'Dynamic mix', fr: 'Mix dynamique' },
  wakeFavourites: { en: 'Favourites', fr: 'Favoris' },
  errorSleepDuration: {
    en: 'Unknown sleep timer duration: choose a delay, the end of the track or cancel.',
    fr: 'Durée de minuteur inconnue : choisissez un délai, la fin de la piste ou l’annulation.',
  },
  errorPlayerUnsupported: {
    en: '{player} cannot do that ({error}).',
    fr: '{player} ne sait pas faire cela ({error}).',
  },
  errorRemoteUnavailable: {
    en: 'This JewelBox server cannot command its players: update it to 1.18 or later.',
    fr: 'Ce serveur JewelBox ne peut pas piloter ses lecteurs : mettez-le à jour en 1.18 ou plus.',
  },

  // Connection status (Integrations → JewelBox).
  statusNoServer: {
    en: 'No JewelBox server found on the network. Check that JewelBox runs, or type its address in the configuration.',
    fr: 'Aucun serveur JewelBox trouvé sur le réseau. Vérifiez que JewelBox tourne, ou saisissez son adresse dans la configuration.',
  },
  statusUnreachable: {
    en: 'The JewelBox server does not answer at {url} ({error}). Next try in a minute.',
    fr: 'Le serveur JewelBox ne répond pas à {url} ({error}). Nouvel essai dans une minute.',
  },

  // Configuration button.
  testOk: {
    en: 'Connected to {name} {version} at {url}: collection “{collection}”, {owned} albums, {players} players seen.',
    fr: 'Connecté à {name} {version} à {url} : collection « {collection} », {owned} albums, {players} lecteurs vus.',
  },

  // Errors shown to the user (scene actions, widget buttons).
  errorNoServer: {
    en: 'No JewelBox server: check that it runs, or type its address in the configuration.',
    fr: 'Pas de serveur JewelBox : vérifiez qu’il tourne, ou saisissez son adresse dans la configuration.',
  },
  errorServer: {
    en: 'JewelBox refused the request ({error}).',
    fr: 'JewelBox a refusé la demande ({error}).',
  },
  errorAlbumNotFound: {
    en: 'No album “{album}” in the collection (an album id or its exact title).',
    fr: 'Aucun album « {album} » dans la collection (un numéro d’album ou son titre exact).',
  },
  errorAlbumAmbiguous: {
    en: '{count} albums are called “{album}”: give the album id instead.',
    fr: '{count} albums s’appellent « {album} » : indiquez plutôt le numéro de l’album.',
  },
  errorAlbumWanted: {
    en: '“{album}” is in the wish list, not in the collection.',
    fr: '« {album} » est dans la liste de souhaits, pas dans la collection.',
  },
  errorAlreadyLent: {
    en: '“{album}” is already lent to {who}.',
    fr: '« {album} » est déjà prêté à {who}.',
  },
  errorNotLent: {
    en: '“{album}” is not lent out.',
    fr: '« {album} » n’est pas prêté.',
  },
  errorNoBorrower: {
    en: 'Say to whom the album is lent.',
    fr: 'Indiquez à qui l’album est prêté.',
  },
  errorNoAlbum: {
    en: 'No album in the collection.',
    fr: 'Aucun album dans la collection.',
  },
  errorNoAlbumOfGenre: {
    en: 'No album of the genre “{genre}” in the collection.',
    fr: 'Aucun album du genre « {genre} » dans la collection.',
  },
  errorNoPlayer: {
    en: 'No JewelBox player: create one in Gladys first (Discover tab).',
    fr: 'Aucun lecteur JewelBox : créez-en un dans Gladys d’abord (onglet Découverte).',
  },
  errorScanRunning: {
    en: 'A scan of the music library is already running.',
    fr: 'Un scan de la bibliothèque musicale est déjà en cours.',
  },
  errorScanNoLibrary: {
    en: 'No music folder set in JewelBox (Settings → Music library).',
    fr: 'Aucun dossier de musique réglé dans JewelBox (Paramètres → Bibliothèque musicale).',
  },

  // Widget toasts.
  toastAnother: { en: 'Here is {album}.', fr: 'Voici {album}.' },
  toastToday: { en: 'Back to the suggestion of the day.', fr: 'Retour à la suggestion du jour.' },

  // Widgets.
  widgetNoServer: {
    en: 'The JewelBox server does not answer.',
    fr: 'Le serveur JewelBox ne répond pas.',
  },
  widgetNoPlayer: {
    en: 'No JewelBox player yet: start playing in JewelBox, then add the player in Gladys (Discover tab).',
    fr: 'Pas encore de lecteur JewelBox : lancez une lecture dans JewelBox, puis ajoutez le lecteur dans Gladys (onglet Découverte).',
  },
  widgetNoQueue: { en: 'Nothing in the queue', fr: 'Rien dans la file' },
  widgetCoverOf: { en: 'Cover of {album}', fr: 'Pochette de {album}' },
  widgetState: { en: 'State', fr: 'État' },
  widgetTrack: { en: 'Track', fr: 'Titre' },
  widgetArtist: { en: 'Artist', fr: 'Artiste' },
  widgetAlbum: { en: 'Album', fr: 'Album' },
  widgetSource: { en: 'Playing from', fr: 'Lu depuis' },
  widgetPlaying: { en: 'Playing', fr: 'En lecture' },
  widgetStopped: { en: 'Stopped, {ago}', fr: 'À l’arrêt, {ago}' },
  widgetHours: { en: 'Hours', fr: 'Heures' },
  widgetListeningTime: { en: 'Listening', fr: 'Écoute' },
  widgetPlaysToday: { en: 'Today', fr: 'Aujourd’hui' },
  widgetPlaysMonth: { en: 'This month', fr: 'Ce mois-ci' },
  widgetPlaysYear: { en: 'This year', fr: 'Cette année' },
  widgetPlaysAll: { en: 'All time', fr: 'En tout' },
  widgetPlays: { en: '{n} plays', fr: '{n} écoutes' },
  widgetPlay: { en: '1 play', fr: '1 écoute' },
  widgetNoPlays: {
    en: 'No play over this period yet.',
    fr: 'Aucune écoute sur cette période pour l’instant.',
  },
  widgetListeningUnavailable: {
    en: 'The listening statistics need JewelBox 1.20 or later.',
    fr: 'Les statistiques d’écoute demandent JewelBox 1.20 ou plus récent.',
  },
  // Tile labels: about 12 characters before the card cuts them.
  widgetTileWanted: { en: 'Wish list', fr: 'Souhaits' },
  widgetByDecade: { en: 'Albums by decade', fr: 'Albums par décennie' },
  widgetAlbums: { en: 'Albums', fr: 'Albums' },
  widgetAverageRating: { en: 'Average rating', fr: 'Note moyenne' },
  widgetNoLoan: {
    en: 'No album lent out: every album is on the shelf.',
    fr: 'Aucun album prêté : tous les albums sont sur l’étagère.',
  },
  widgetSomeone: { en: 'someone', fr: 'quelqu’un' },
  widgetLentSince: {
    en: '{who} since {since} · {artist}',
    fr: '{who} depuis le {since} · {artist}',
  },
  widgetLentTo: { en: '{who} · {artist}', fr: '{who} · {artist}' },
  widgetDays: { en: '{n} d', fr: '{n} j' },
  widgetMore: { en: 'and {n} more', fr: 'et {n} de plus' },
  widgetEmptyCollection: {
    en: 'The collection is empty: add albums in JewelBox.',
    fr: 'La collection est vide : ajoutez des albums dans JewelBox.',
  },
  widgetYear: { en: 'Year', fr: 'Année' },
  widgetGenre: { en: 'Genre', fr: 'Genre' },
  widgetLabel: { en: 'Label', fr: 'Label' },
  widgetRating: { en: 'Rating', fr: 'Note' },
  widgetLent: { en: 'Lent to', fr: 'Prêté à' },
  widgetPick: { en: 'Pick', fr: 'Choix' },
  widgetPickToday: { en: 'Suggestion of the day', fr: 'Suggestion du jour' },
  widgetPickDrawn: { en: 'Drawn at random', fr: 'Tiré au hasard' },
  widgetAnother: { en: 'Another album', fr: 'Un autre album' },
  widgetToday: { en: 'Today’s pick', fr: 'Celui du jour' },
  widgetNothingAdded: {
    en: 'No album added yet.',
    fr: 'Aucun album ajouté pour l’instant.',
  },
  widgetWishlist: { en: 'Wish list', fr: 'Souhait' },

  // Ages.
  never: { en: 'never', fr: 'jamais' },
  justNow: { en: 'just now', fr: 'à l’instant' },
  minutesAgo: { en: '{n} min ago', fr: 'il y a {n} min' },
  hoursAgo: { en: '{n} h ago', fr: 'il y a {n} h' },
  daysAgo: { en: '{n} d ago', fr: 'il y a {n} j' },
};

const isLanguage = (language) => LANGUAGES.includes(language);

/**
 * @description A text in a language, with its values.
 * @param {string} key - A TEXTS key.
 * @param {string} language - The language (English when unknown).
 * @param {object} [values] - The values of the `{placeholders}`.
 * @returns {string} The text, the key itself when unknown.
 */
function t(key, language, values = {}) {
  const entry = TEXTS[key];
  if (!entry) {
    return key;
  }
  const template = entry[isLanguage(language) ? language : 'en'] ?? entry.en;
  return template.replace(/\{(\w+)\}/g, (whole, name) =>
    values[name] === undefined || values[name] === null ? '' : String(values[name]),
  );
}

/**
 * @description A text in every language.
 * @param {string|Function} key - A TEXTS key, or `(language) => text`.
 * @param {object|Function} [values] - The values, or `(language) => values`.
 * @returns {object} `{ en, fr }`.
 */
function all(key, values = {}) {
  return Object.fromEntries(
    LANGUAGES.map((language) => [
      language,
      typeof key === 'function'
        ? key(language)
        : t(key, language, typeof values === 'function' ? values(language) : values),
    ]),
  );
}

/**
 * @description How long ago an instant was: "just now", "12 min ago".
 * @param {number} at - The instant, in ms (0: never).
 * @param {number} now - Now, in ms.
 * @param {string} language - The language.
 * @returns {string} The text.
 */
function ago(at, now, language) {
  if (!at) {
    return t('never', language);
  }
  const minutes = Math.floor((now - at) / 60000);
  if (minutes < 1) {
    return t('justNow', language);
  }
  if (minutes < 60) {
    return t('minutesAgo', language, { n: minutes });
  }
  if (minutes < 48 * 60) {
    return t('hoursAgo', language, { n: Math.floor(minutes / 60) });
  }
  return t('daysAgo', language, { n: Math.floor(minutes / 1440) });
}

export { LANGUAGES, TEXTS, isLanguage, t, all, ago };
