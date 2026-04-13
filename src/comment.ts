import type { getOctokit } from '@actions/github';

type Octokit = ReturnType<typeof getOctokit>;

export interface PostCommentOptions {
  readonly octokit: Octokit;
  readonly owner: string;
  readonly repo: string;
  readonly pullNumber: number;
  readonly body: string;
}

export function buildCarlMarker(instanceId: string): string {
  return `<!-- carl:review instance=${instanceId} -->`;
}

export async function deletePreviousCarlComments(
  options: Omit<PostCommentOptions, 'body'> & { readonly instanceId: string },
): Promise<void> {
  const { octokit, owner, repo, pullNumber, instanceId } = options;

  const { data: comments } = await octokit.rest.issues.listComments({
    owner,
    repo,
    issue_number: pullNumber,
    per_page: 100,
  });

  const marker = buildCarlMarker(instanceId);
  const carlComments = comments.filter((c) => c.body?.includes(marker));

  await Promise.all(
    carlComments.map((c) =>
      octokit.rest.issues.deleteComment({
        owner,
        repo,
        comment_id: c.id,
      }),
    ),
  );
}

export async function postReviewComment(options: PostCommentOptions): Promise<void> {
  const { octokit, owner, repo, pullNumber, body } = options;
  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: pullNumber,
    body,
  });
}

export function buildFallbackComment(reason: string): string {
  return `:warning: **carl** could not complete the review: ${reason}`;
}
