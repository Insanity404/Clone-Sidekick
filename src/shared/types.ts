/* ────────────────────────────────────────────────────────────────
 *  Shared types used by both the server and the React client.
 * ──────────────────────────────────────────────────────────────── */

// ── Enchor.us Search ────────────────────────────────────────────

export const INSTRUMENTS = [
  'guitar', 'guitarcoop', 'rhythm', 'bass',
  'drums', 'keys', 'guitarghl', 'guitarcoopghl',
  'rhythmghl', 'bassghl',
] as const;
export type Instrument = (typeof INSTRUMENTS)[number];

export const DIFFICULTIES = ['expert', 'hard', 'medium', 'easy'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const DRUM_TYPES = ['fourLane', 'fourLanePro', 'fiveLane'] as const;
export type DrumType = (typeof DRUM_TYPES)[number];

export const SORT_FIELDS = [
  'name', 'artist', 'album', 'genre', 'year',
  'charter', 'length', 'modifiedTime',
] as const;
export type SortField = (typeof SORT_FIELDS)[number];

/** Body sent to our server's /api/search endpoint (mirrors Enchor.us). */
export interface SearchRequest {
  search: string;
  page: number;
  per_page?: number;
  instrument?: Instrument | null;
  difficulty?: Difficulty | null;
  drumType?: DrumType | null;
  drumsReviewed?: boolean;
  sort?: { type: SortField; direction: 'asc' | 'desc' } | null;
}

// ── Advanced Search (mirrors Enchor.us /advancedSearch) ─────────

export interface TextFilter {
  value: string;
  exact: boolean;
  exclude: boolean;
}

export interface AdvancedSearchRequest {
  page: number;
  per_page?: number;
  instrument?: string | null;
  difficulty?: Difficulty | null;
  drumType?: DrumType | null;
  drumsReviewed?: boolean;
  sort?: { type: SortField; direction: 'asc' | 'desc' } | null;
  // Text fields with exact/exclude toggles
  name: TextFilter;
  artist: TextFilter;
  album: TextFilter;
  genre: TextFilter;
  year: TextFilter;
  charter: TextFilter;
  // Numeric ranges
  minLength?: number | null;
  maxLength?: number | null;
  minIntensity?: number | null;
  maxIntensity?: number | null;
  minAverageNPS?: number | null;
  maxAverageNPS?: number | null;
  minMaxNPS?: number | null;
  maxMaxNPS?: number | null;
  minYear?: number | null;
  maxYear?: number | null;
  // Date filter
  modifiedAfter?: string | null;
  // Hash lookup
  hash?: string | null;
  trackHash?: string | null;
  // Boolean toggles
  hasForcedNotes?: boolean | null;
  hasOpenNotes?: boolean | null;
  hasTapNotes?: boolean | null;
  hasSoloSections?: boolean | null;
  hasLyrics?: boolean | null;
  hasVocals?: boolean | null;
  hasRollLanes?: boolean | null;
  has2xKick?: boolean | null;
  hasIssues?: boolean | null;
  hasVideoBackground?: boolean | null;
  modchart?: boolean | null;
}

export interface NoteCount {
  instrument: string;
  difficulty: string;
  count: number;
}

export interface NotesData {
  instruments: string[];
  drumType: string | null;
  hasSoloSections: boolean;
  hasLyrics: boolean;
  hasVocals: boolean;
  hasForcedNotes: boolean;
  hasTapNotes: boolean;
  hasOpenNotes: boolean;
  has2xKick: boolean;
  hasFlexLanes: boolean;
  noteCounts: NoteCount[];
}

/** Single chart result coming back from Enchor.us. */
export interface ChartResult {
  chartId: number;
  songId: number | null;
  groupId: number;
  name: string | null;
  artist: string | null;
  album: string | null;
  genre: string | null;
  year: string | null;
  charter: string | null;
  song_length: number | null;
  md5: string;
  chartHash: string;
  albumArtMd5: string | null;
  modifiedTime: string;
  hasVideoBackground: boolean;
  diff_guitar: number | null;
  diff_guitar_coop: number | null;
  diff_rhythm: number | null;
  diff_bass: number | null;
  diff_drums: number | null;
  diff_drums_real: number | null;
  diff_keys: number | null;
  diff_guitarghl: number | null;
  diff_guitar_coop_ghl: number | null;
  diff_rhythm_ghl: number | null;
  diff_bassghl: number | null;
  diff_vocals: number | null;
  diff_band: number | null;
  loading_phrase: string | null;
  icon: string | null;
  preview_start_time: number | null;
  hasLyrics?: boolean | null;
  hasVocals?: boolean | null;
  notesData?: NotesData | null;
  [key: string]: unknown;
}

export interface SearchResponse {
  found: number;
  out_of: number;
  page: number;
  search_time_ms: number;
  data: ChartResult[];
}

// ── Download ────────────────────────────────────────────────────

export type DownloadStatus = 'queued' | 'downloading' | 'extracting' | 'done' | 'error';

export interface DownloadProgress {
  md5: string;
  name: string;
  artist: string;
  charter: string;
  status: DownloadStatus;
  percent: number | null;
  error?: string;
  destinationPath?: string;
  albumArtMd5?: string | null;
  /** ISO-8601 timestamp — set when download completes or inferred from folder mtime during scan. */
  downloadedAt?: string;
  /** Full chart data from Enchor.us — stored on enqueue so the UI can show features / note counts. */
  chart?: ChartResult;
}

// ── Auth ────────────────────────────────────────────────────────

export interface UserInfo {
  email: string;
  displayName: string;
  photo?: string;
}

// ── User preferences ─────────────────────────────────────────────

export type DownloadFormat = 'sng' | 'folder';

export interface UserPrefs {
  instrument: string | null;
  difficulty: string | null;
  emhxOnly: boolean;
  downloadFormat: DownloadFormat;
  downloadVideoBackground: boolean;
}

// ── App Config (stored in data/config.json) ──────────────────────

export interface AppConfigGoogle {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
  allowedEmails: string[];
}

export interface AppConfigAuth {
  mode: 'none' | 'google';
  google: AppConfigGoogle;
}

export interface AppConfigTunnel {
  enabled: boolean;
  hostname: string;
}

export interface AppConfig {
  port: number;
  sessionSecret: string;
  cloneHeroSongsDir: string;
  auth: AppConfigAuth;
  tunnel: AppConfigTunnel;
}
