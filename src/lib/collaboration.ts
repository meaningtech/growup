import type { Coordinate, ProjectCollaboration, ProjectComment, ProjectCommentTarget, ProjectReviewStatus } from '../types';

export const MAX_PROJECT_COMMENTS = 200;

export function defaultProjectCollaboration(): ProjectCollaboration {
  return {
    share: {
      enabled: false,
      mode: 'view',
      tokenVersion: cryptoId(),
      createdAt: null,
      expiresAt: null,
    },
    comments: [],
    review: null,
  };
}

export function normalizeProjectCollaboration(value: Partial<ProjectCollaboration> | null | undefined): ProjectCollaboration {
  const fallback = defaultProjectCollaboration();
  const share = value?.share;
  const comments = Array.isArray(value?.comments)
    ? value.comments.slice(-MAX_PROJECT_COMMENTS).flatMap((comment) => {
      const normalized = normalizeProjectComment(comment);
      return normalized ? [normalized] : [];
    })
    : [];
  const review = value?.review;
  return {
    share: {
      enabled: share?.enabled === true,
      mode: share?.mode === 'review' ? 'review' : 'view',
      tokenVersion: boundedText(share?.tokenVersion, 128) || fallback.share.tokenVersion,
      createdAt: validDate(share?.createdAt) ? share?.createdAt ?? null : null,
      expiresAt: validDate(share?.expiresAt) ? share?.expiresAt ?? null : null,
    },
    comments,
    review: review && validReviewStatus(review.status) && boundedText(review.reviewerName, 100)
      ? {
        status: review.status,
        reviewerName: boundedText(review.reviewerName, 100),
        note: boundedText(review.note, 2_000),
        revision: Math.max(0, Math.floor(Number(review.revision) || 0)),
        updatedAt: validDate(review.updatedAt) ? review.updatedAt : new Date(0).toISOString(),
      }
      : null,
  };
}

export function createProjectComment(input: {
  authorName: unknown;
  message: unknown;
  coordinate?: unknown;
  target?: unknown;
  targetId?: unknown;
  revision: number;
  now?: string;
}): ProjectComment {
  const authorName = boundedText(input.authorName, 100);
  const message = boundedText(input.message, 2_000);
  if (!authorName || !message) throw collaborationError(400, 'INVALID_PROJECT_COMMENT', 'Reviewer name and comment are required.');
  return {
    id: cryptoId(),
    authorName,
    message,
    coordinate: validCoordinate(input.coordinate) ? input.coordinate : null,
    target: validTarget(input.target) ? input.target : 'general',
    targetId: boundedText(input.targetId, 128) || null,
    revision: Math.max(0, Math.floor(input.revision)),
    createdAt: input.now && validDate(input.now) ? input.now : new Date().toISOString(),
    resolvedAt: null,
  };
}

export function requireProjectReview(input: {
  status?: unknown;
  reviewerName?: unknown;
  note?: unknown;
  revision: number;
  now?: string;
}) {
  const reviewerName = boundedText(input.reviewerName, 100);
  if (!validReviewStatus(input.status) || !reviewerName) throw collaborationError(400, 'INVALID_PROJECT_REVIEW', 'A valid review decision and reviewer name are required.');
  return {
    status: input.status,
    reviewerName,
    note: boundedText(input.note, 2_000),
    revision: Math.max(0, Math.floor(input.revision)),
    updatedAt: input.now && validDate(input.now) ? input.now : new Date().toISOString(),
  };
}

export function rotateShareVersion() {
  return cryptoId();
}

function normalizeProjectComment(value: Partial<ProjectComment>): ProjectComment | null {
  const authorName = boundedText(value.authorName, 100);
  const message = boundedText(value.message, 2_000);
  const id = boundedText(value.id, 128);
  if (!id || !authorName || !message || !validDate(value.createdAt)) return null;
  return {
    id,
    authorName,
    message,
    coordinate: validCoordinate(value.coordinate) ? value.coordinate : null,
    target: validTarget(value.target) ? value.target : 'general',
    targetId: boundedText(value.targetId, 128) || null,
    revision: Math.max(0, Math.floor(Number(value.revision) || 0)),
    createdAt: value.createdAt,
    resolvedAt: validDate(value.resolvedAt) ? value.resolvedAt ?? null : null,
  };
}

function validCoordinate(value: unknown): value is Coordinate {
  const coordinate = value as Coordinate | null;
  return coordinate !== null
    && typeof coordinate === 'object'
    && Number.isFinite(coordinate.lat)
    && coordinate.lat >= -90
    && coordinate.lat <= 90
    && Number.isFinite(coordinate.lng)
    && coordinate.lng >= -180
    && coordinate.lng <= 180;
}

function validTarget(value: unknown): value is ProjectCommentTarget {
  return ['general', 'tree', 'firebreak', 'water'].includes(String(value));
}

function validReviewStatus(value: unknown): value is ProjectReviewStatus {
  return ['pending', 'approved', 'changes-requested'].includes(String(value));
}

function validDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function boundedText(value: unknown, maximum: number) {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : '';
}

function cryptoId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function collaborationError(code: number, status: string, message: string) {
  return { code, status, message };
}
