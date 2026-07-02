export type LayerKey = "original" | "ipa" | "translationPt" | "pfc" | "tip";

export type PlayerMode = "karaoke" | "study";

export type SyncQuality = "excellent" | "good" | "estimated" | "poor" | "fair";

export type SyncGranularity = "line" | "segment" | "word" | "syllable";

export type PhoneticsMode = "ai_generated" | "external_ipa";

export type StudyDifficulty = "easy" | "medium" | "hard";

export type StudySkillFocus = string;

export interface StudyDrill {
  slow?: string;
  connected?: string;
  rhythm?: string;
}

export interface StudyCues {
  listeningGoalPt?: string;
  mouthCuePt?: string;
  preEntryCuePt?: string;
}

export interface LineStudyData {
  difficulty: StudyDifficulty;
  focusSounds: string[];
  skillFocus?: StudySkillFocus[];
  practiceHintPt: string;
  commonMistakesPt: string[];
  drill?: StudyDrill;
  cues?: StudyCues;
}

export interface TokenStudyData {
  tokenId: string;
  difficulty: StudyDifficulty;
  focusSounds: string[];
  hintPt: string;
  commonMistakesPt: string[];
}

export type SongDifficultyLevel = "easy" | "medium" | "hard";

export interface SongDifficultyRating {
  level: SongDifficultyLevel;
  score: number;
  reasons: string[];
  metrics?: Record<string, number>;
  topSkills?: StudySkillFocus[];
}

export interface SongDifficultyData {
  pronunciation?: SongDifficultyRating;
  rhythm?: SongDifficultyRating;
  version: number;
  updatedAt: string;
}

export interface KaraokeToken {
  id: string;
  text: string;
  pfc?: string;
  ipa?: string;
  start: number;
  end: number;
  confidence?: number;
  syncSource?: string;
  study?: TokenStudyData;
}

export interface KaraokeSegment {
  id: string;
  original: string;
  pfc: string;
  translationPt?: string;
  start: number;
  end: number;
  weight?: number;
  confidence?: number;
  syncSource?: string;
}

export interface SongLine {
  id: string;
  start: number;
  end: number;
  original: string;
  ipa?: string;
  translationPt?: string;
  pfc?: string;
  tip?: string;
  syncSource?: string;
  syncGranularity?: SyncGranularity;
  syncConfidence?: number;
  tokens?: KaraokeToken[];
  segments?: KaraokeSegment[];
  needsReview?: boolean;
  warnings?: string[];
  study?: LineStudyData;
  words?: {
    word: string;
    pfc: string;
    start: number;
    end: number;
  }[];
}

export interface AudioFileMetadata {
  mimeType?: string;
  size?: number;
  bitrate?: number;
  sampleRate?: number;
  codec?: string;
}

export interface YouTubeSourceMetadata {
  sourceUrl?: string;
  videoId?: string;
  sourceTitle?: string;
  sourceChannel?: string;
  sourceThumbnailUrl?: string;
  sourceUploadDate?: string;
  sourceTags?: string[];
  audioBitrate?: number;
  audioFormat?: string;
}

export interface SongMetadata {
  title: string;
  artist: string;
  additionalInfo?: string;
  album?: string;
  year?: string;
  date?: string;
  duration?: number;
  sourceType: "local-audio" | "youtube" | "manual";
  audio?: AudioFileMetadata;
  youtube?: YouTubeSourceMetadata;
  sourceUrl?: string;
  fileName?: string;
  mimeType?: string;
  size?: number;
  coverUrl?: string;
  videoId?: string;
}

export interface LyricsSourceData {
  provider: string;
  selectedBy: string;
  confidence: string;
  score: number;
  queryTitle?: string;
  queryArtist?: string;
  durationDiff?: number;
  lrclibId?: number;
  trackName?: string;
  artistName?: string;
  albumName?: string;
  duration?: number;
  syncLevel?: "line" | "word" | "syllable" | "segment" | "none";
  warning?: string;
}

export type PracticeItemType = 'line' | 'token' | 'skill';

export type PracticeStatus = 'new' | 'learning' | 'review' | 'mastered';

export type PracticeMode =
  | 'listen'
  | 'repeat'
  | 'shadowing'
  | 'recording';

export interface UserProgressItem {
  id: string;
  projectId: string;
  lineId: string;
  tokenId?: string;

  type: PracticeItemType;
  skillFocus: string[];

  difficulty: 'easy' | 'medium' | 'hard';

  attempts: number;
  correctAttempts: number;

  bestScore?: number;
  lastScore?: number;

  easeFactor: number;
  intervalDays: number;

  dueAt: string;
  lastReviewedAt?: string;

  status: PracticeStatus;

  createdAt: string;
  updatedAt: string;
}

export interface PracticeAttempt {
  id: string;
  projectId: string;
  lineId: string;
  tokenId?: string;

  mode: PracticeMode;

  score?: number;
  selfRating?: 1 | 2 | 3 | 4;

  speed: number;
  usedPfc: boolean;
  usedVocalIsolated: boolean;

  createdAt: string;
}

export interface UserProgressStore {
  version: 1;
  items: UserProgressItem[];
  attempts: PracticeAttempt[];
}

export interface SongProject {
  id: string;
  metadata: SongMetadata;
  audioUrl?: string;
  audioBlobId?: string;
  vocalsBlobId?: string;
  lines: SongLine[];
  difficulty?: SongDifficultyData;
  visibleLayers: LayerKey[];
  createdAt: string;
  updatedAt: string;
  isPartial?: boolean;
  favorite?: boolean;
  playerMode?: PlayerMode;
  aiProvider?: string;
  aiModel?: string;
  phoneticsMode?: PhoneticsMode;
  syncOffset?: number;
  syncQuality?: SyncQuality;
  syncConfidence?: number;
  syncGranularity?: SyncGranularity;
  lyricsSource?: LyricsSourceData;
  lrcMatch?: {
    provider?: string;
    score?: number;
    durationDiff?: number;
    syncLevel?: "none" | "line" | "word" | "syllable" | "segment";
    selectedTrackName?: string;
    selectedArtistName?: string;
  };
  progress?: {
    lastTimestamp?: number;
    practiceScores?: Record<number, number[]>;
  };
  studyProgress?: {
    lineScores?: Record<string, number[]>;
    wordScores?: Record<string, number[]>;
    difficultWords?: Record<string, {
      count: number;
      bestScore: number;
      lastPracticedAt: string;
    }>;
  };
}
