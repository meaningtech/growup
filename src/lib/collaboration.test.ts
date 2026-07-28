import { describe, expect, it } from 'vitest';
import { createProjectComment, defaultProjectCollaboration, MAX_PROJECT_COMMENTS, normalizeProjectCollaboration, requireProjectReview } from './collaboration';

describe('project collaboration', () => {
  it('validates comments and review decisions', () => {
    const comment = createProjectComment({
      authorName: 'Reviewer',
      message: 'Move this tree.',
      coordinate: { lat: 36.9, lng: 14.7 },
      target: 'tree',
      targetId: 'tree-4',
      revision: 3,
      now: '2026-07-26T09:00:00.000Z',
    });
    expect(comment).toEqual(expect.objectContaining({ target: 'tree', targetId: 'tree-4', revision: 3 }));
    expect(requireProjectReview({
      status: 'approved',
      reviewerName: 'Reviewer',
      note: 'Approved for field verification.',
      revision: 3,
      now: '2026-07-26T09:05:00.000Z',
    })).toEqual(expect.objectContaining({ status: 'approved', revision: 3 }));
  });

  it('keeps the persisted comment list bounded', () => {
    const value = defaultProjectCollaboration();
    value.comments = Array.from({ length: MAX_PROJECT_COMMENTS + 5 }, (_, index) => ({
      id: `comment-${index}`,
      authorName: 'Reviewer',
      message: `Comment ${index}`,
      coordinate: null,
      target: 'general' as const,
      targetId: null,
      revision: 1,
      createdAt: '2026-07-26T09:00:00.000Z',
      resolvedAt: null,
    }));
    const normalized = normalizeProjectCollaboration(value);
    expect(normalized.comments).toHaveLength(MAX_PROJECT_COMMENTS);
    expect(normalized.comments[0].id).toBe('comment-5');
  });

  it('keeps cost sharing private unless it is explicitly enabled', () => {
    expect(normalizeProjectCollaboration({
      share: {
        enabled: true,
        mode: 'view',
        tokenVersion: 'legacy-share',
        createdAt: null,
        expiresAt: null,
      } as ReturnType<typeof defaultProjectCollaboration>['share'],
    }).share.includeCosts).toBe(false);
    expect(normalizeProjectCollaboration({
      share: {
        ...defaultProjectCollaboration().share,
        includeCosts: true,
      },
    }).share.includeCosts).toBe(true);
  });
});
