// Společné konstanty ZaZa-BaseCamp. Stejné seznamy posílá /api/me i do prohlížeče.

export const SECTIONS = [
  { id: 'spolecne', name: 'Společné' },
  { id: 'zaza-bar', name: 'ZaZa Bar' },
  { id: 'zaza-kuchyne', name: 'ZaZa Kuchyně' },
  { id: 'little-bar', name: 'Little Bar' },
  { id: 'little-kuchyne', name: 'Little Kuchyně' },
  // Veřejná sekce bez přihlášení a bez evidence čtení (dokumenty před zkušební směnou).
  { id: 'novy-zamestnanec', name: 'Nový zaměstnanec', public: true },
];

export const POSITIONS = [
  { id: 'zaza-barman', name: 'ZaZa Barman' },
  { id: 'zaza-plac', name: 'ZaZa Plac' },
  { id: 'zaza-kuchyn', name: 'ZaZa Kuchyň' },
  { id: 'little-bar', name: 'Little Bar' },
  { id: 'little-kuchyn', name: 'Little Kuchyň' },
];

// Předvyplnění „Povinné pro pozice“ podle sekce při nahrávání dokumentu.
export const DEFAULT_MANDATORY = {
  'spolecne': POSITIONS.map((p) => p.id),
  'zaza-bar': ['zaza-barman', 'zaza-plac'],
  'zaza-kuchyne': ['zaza-kuchyn'],
  'little-bar': ['little-bar'],
  'little-kuchyne': ['little-kuchyn'],
  'novy-zamestnanec': [],
};

export const FILE_TYPES = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

// Netlify Functions přijmou požadavek do 6 MB včetně režie formuláře, proto 5 MB na soubor.
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

export const SESSION_DAYS = 14;
export const WELCOME_TOKEN_HOURS = 72;
export const RESET_TOKEN_HOURS = 1;
export const ADMIN_RESET_TOKEN_HOURS = 24;
export const MIN_PASSWORD = 8;
