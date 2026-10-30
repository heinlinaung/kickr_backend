// src/tournaments/tournament.constants.ts
/**
 * Vocabulary and default settings for tournament formats and phases.
 * Shared by the schemas, DTOs and the pure engine, so it imports nothing.
 */

export const TOURNAMENT_FORMATS = [
  'LEAGUE',
  'KNOCKOUT',
  'LEAGUE_KNOCKOUT',
] as const;
export type TournamentFormat = (typeof TOURNAMENT_FORMATS)[number];

/** Lifecycle, in order. Phases a format doesn't use are skipped. */
export const TOURNAMENT_STATUSES = [
  'DRAFT',
  'REGISTRATION_OPEN',
  'REGISTRATION_CLOSED',
  'LEAGUE_IN_PROGRESS',
  'QUALIFICATION_REVIEW',
  'KNOCKOUT_IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
] as const;
export type TournamentStatus = (typeof TOURNAMENT_STATUSES)[number];

/** Statuses in which the format can still be changed freely. */
export const PRE_START_STATUSES: readonly TournamentStatus[] = [
  'DRAFT',
  'REGISTRATION_OPEN',
  'REGISTRATION_CLOSED',
];

export const REGISTRATION_STATUSES = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'WITHDRAWN',
] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

/**
 * Registrations that count as approved. Rows created before registration
 * statuses existed have no `status`, and were always treated as joined.
 */
export const APPROVED_REGISTRATION = {
  status: {
    $nin: ['PENDING', 'REJECTED', 'WITHDRAWN'] as RegistrationStatus[],
  },
};

export const PHASE_TYPES = ['LEAGUE', 'KNOCKOUT'] as const;
export type PhaseType = (typeof PHASE_TYPES)[number];

export const PHASE_STATUSES = ['PENDING', 'IN_PROGRESS', 'COMPLETED'] as const;
export type PhaseStatus = (typeof PHASE_STATUSES)[number];

export const MATCH_STATUSES = ['SCHEDULED', 'COMPLETED', 'VOID'] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

export const MATCH_SIDES = ['HOME', 'AWAY'] as const;
export type MatchSide = (typeof MATCH_SIDES)[number];

export const TIEBREAKERS = [
  'H2H_POINTS',
  'H2H_GOAL_DIFF',
  'GOAL_DIFF',
  'GOALS_FOR',
  'FAIR_PLAY',
  'LOTS',
] as const;
export type Tiebreaker = (typeof TIEBREAKERS)[number];

export const ROUND_ROBINS = ['SINGLE', 'DOUBLE'] as const;
export const GROUP_DRAWS = ['MANUAL', 'RANDOM', 'SEEDED'] as const;
export type GroupDraw = (typeof GROUP_DRAWS)[number];
export const SEEDINGS = [
  'CROSS_GROUP',
  'RANKED',
  'RANDOM_DRAW',
  'MANUAL',
] as const;
export type Seeding = (typeof SEEDINGS)[number];
export const DRAW_RESOLUTIONS = [
  'PENALTIES',
  'EXTRA_TIME_THEN_PENALTIES',
] as const;
export const BRACKET_SEEDINGS = ['RANDOM_DRAW', 'MANUAL'] as const;

export interface PointsSettings {
  win: number;
  draw: number;
  loss: number;
}

export interface LeagueSettings {
  groupCount: number;
  /** Upper bound per group; null means "team count ÷ groups". */
  teamsPerGroup: number | null;
  roundRobin: (typeof ROUND_ROBINS)[number];
  points: PointsSettings;
  groupDraw: GroupDraw;
  separateSameClub: boolean;
  tiebreakers: Tiebreaker[];
}

export interface QualificationSettings {
  qualifyPerGroup: number;
  bestOfRest: number;
  seeding: Seeding;
}

export interface KnockoutSettings {
  legs: 1 | 2;
  drawResolution: (typeof DRAW_RESOLUTIONS)[number];
  thirdPlaceMatch: boolean;
  /** Knockout-only tournaments; mixed ones seed from qualification. */
  bracketSeeding: (typeof BRACKET_SEEDINGS)[number];
}

export interface TournamentSettings {
  league?: LeagueSettings;
  qualification?: QualificationSettings;
  knockout?: KnockoutSettings;
}

export const DEFAULT_LEAGUE: LeagueSettings = {
  groupCount: 1,
  teamsPerGroup: null,
  roundRobin: 'SINGLE',
  points: { win: 3, draw: 1, loss: 0 },
  groupDraw: 'RANDOM',
  separateSameClub: false,
  tiebreakers: [...TIEBREAKERS],
};

export const DEFAULT_QUALIFICATION: QualificationSettings = {
  qualifyPerGroup: 2,
  bestOfRest: 0,
  seeding: 'CROSS_GROUP',
};

export const DEFAULT_KNOCKOUT: KnockoutSettings = {
  legs: 1,
  drawResolution: 'PENALTIES',
  thirdPlaceMatch: false,
  bracketSeeding: 'RANDOM_DRAW',
};

/** Fair-play weight per card; fewer points ranks higher. */
export const YELLOW_CARD_POINTS = 1;
export const RED_CARD_POINTS = 3;

/** Score recorded for a forfeit or walkover, from the winner's side. */
export const FORFEIT_SCORE = 3;
