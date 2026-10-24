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
  feature_playing: { en: 'Playback', fr: 'Lecture' },
  feature_track: { en: 'Track', fr: 'Titre' },
  feature_artist: { en: 'Artist', fr: 'Artiste' },
  feature_album: { en: 'Album', fr: 'Album' },

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
