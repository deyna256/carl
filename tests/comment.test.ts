import { describe, it, expect, vi } from 'vitest';
import {
  buildCarlMarker,
  deletePreviousCarlComments,
  postReviewComment,
  buildFallbackComment,
} from '../src/comment';

function makeMockOctokit(existingComments: Array<{ id: number; body: string }> = []) {
  return {
    rest: {
      issues: {
        listComments: vi.fn().mockResolvedValue({ data: existingComments }),
        deleteComment: vi.fn().mockResolvedValue({}),
        createComment: vi.fn().mockResolvedValue({ data: { id: 1 } }),
      },
    },
  };
}

describe('buildCarlMarker', () => {
  it('embeds the instance id in the marker', () => {
    expect(buildCarlMarker('backend')).toBe('<!-- carl:review instance=backend -->');
  });
});

describe('deletePreviousCarlComments', () => {
  it('deletes comments that contain the matching instance marker', async () => {
    const octokit = makeMockOctokit([
      { id: 10, body: '<!-- carl:review instance=backend -->\n### carl review\n\nOld review' },
      { id: 11, body: 'Some unrelated comment' },
    ]);

    await deletePreviousCarlComments({
      octokit: octokit as never,
      owner: 'o',
      repo: 'r',
      pullNumber: 1,
      instanceId: 'backend',
    });

    expect(octokit.rest.issues.deleteComment).toHaveBeenCalledOnce();
    expect(octokit.rest.issues.deleteComment).toHaveBeenCalledWith({
      owner: 'o',
      repo: 'r',
      comment_id: 10,
    });
  });

  it('deletes multiple carl comments for the same instance', async () => {
    const octokit = makeMockOctokit([
      { id: 10, body: '<!-- carl:review instance=backend -->\n### carl review\n\nFirst' },
      { id: 11, body: '<!-- carl:review instance=backend -->\n### carl review\n\nSecond' },
    ]);

    await deletePreviousCarlComments({
      octokit: octokit as never,
      owner: 'o',
      repo: 'r',
      pullNumber: 1,
      instanceId: 'backend',
    });

    expect(octokit.rest.issues.deleteComment).toHaveBeenCalledTimes(2);
  });

  it('does not delete comments from a different instance', async () => {
    const octokit = makeMockOctokit([
      {
        id: 10,
        body: '<!-- carl:review instance=frontend -->\n### carl review\n\nFrontend review',
      },
    ]);

    await deletePreviousCarlComments({
      octokit: octokit as never,
      owner: 'o',
      repo: 'r',
      pullNumber: 1,
      instanceId: 'backend',
    });

    expect(octokit.rest.issues.deleteComment).not.toHaveBeenCalled();
  });

  it('does not delete comments without a carl marker', async () => {
    const octokit = makeMockOctokit([
      { id: 10, body: '### carl review\n\nNo marker, legacy comment' },
      { id: 11, body: 'Unrelated comment' },
    ]);

    await deletePreviousCarlComments({
      octokit: octokit as never,
      owner: 'o',
      repo: 'r',
      pullNumber: 1,
      instanceId: 'backend',
    });

    expect(octokit.rest.issues.deleteComment).not.toHaveBeenCalled();
  });
});

describe('postReviewComment', () => {
  it('calls createComment with correct parameters', async () => {
    const octokit = makeMockOctokit();

    await postReviewComment({
      octokit: octokit as never,
      owner: 'deyna256',
      repo: 'carl',
      pullNumber: 42,
      body: '### carl review\n\nLooks good!',
    });

    expect(octokit.rest.issues.createComment).toHaveBeenCalledOnce();
    expect(octokit.rest.issues.createComment).toHaveBeenCalledWith({
      owner: 'deyna256',
      repo: 'carl',
      issue_number: 42,
      body: '### carl review\n\nLooks good!',
    });
  });

  it('propagates errors from the GitHub API', async () => {
    const octokit = makeMockOctokit();
    octokit.rest.issues.createComment.mockRejectedValueOnce(new Error('API error'));

    await expect(
      postReviewComment({
        octokit: octokit as never,
        owner: 'o',
        repo: 'r',
        pullNumber: 1,
        body: 'body',
      }),
    ).rejects.toThrow('API error');
  });
});

describe('buildFallbackComment', () => {
  it('includes the reason in the output', () => {
    const comment = buildFallbackComment('service unavailable');
    expect(comment).toContain('service unavailable');
  });

  it('contains a warning indicator', () => {
    const comment = buildFallbackComment('timeout');
    expect(comment).toContain(':warning:');
  });

  it('matches snapshot', () => {
    expect(
      buildFallbackComment('OpenRouter returned HTTP 503: Service Unavailable'),
    ).toMatchSnapshot();
  });
});
