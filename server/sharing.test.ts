import { describe, expect, it } from 'vitest';
import { createProjectShareToken, verifyProjectShareToken } from './sharing';

describe('project share tokens', () => {
  const config = {
    authSessionSecret: 'test-sharing-secret-with-sufficient-entropy',
    now: () => new Date('2026-07-26T10:00:00.000Z'),
  };

  it('signs, verifies and expires a project-scoped token', () => {
    const token = createProjectShareToken('project-1', 'version-2', '2026-08-26T10:00:00.000Z', config);
    expect(verifyProjectShareToken(token, config)).toEqual({
      projectId: 'project-1',
      tokenVersion: 'version-2',
      expiresAt: 1787738400,
    });
    expect(verifyProjectShareToken(`${token}tampered`, config)).toBeNull();
    expect(verifyProjectShareToken(token, { ...config, now: () => new Date('2026-09-01T00:00:00.000Z') })).toBeNull();
  });
});
