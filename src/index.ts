import * as core from '@actions/core';
import * as github from '@actions/github';
import { loadConfig, ConfigError } from './config';
import { getFilteredDiff, fetchLinkedIssues, DiffError } from './diff';
import { buildPrompt, callOpenRouter, AiError, type PrContext } from './ai';
import { deletePreviousCarlComments, postReviewComment, buildFallbackComment } from './comment';

async function run(): Promise<void> {
  const apiKey = core.getInput('openrouter-api-key', { required: true });
  const configPath = core.getInput('config-path') || '.github/carl.yml';

  const pr = github.context.payload.pull_request;
  if (pr == null) {
    core.setFailed('carl must be triggered on a pull_request event');
    return;
  }

  const { owner, repo } = github.context.repo;
  const pullNumber = pr.number as number;

  const token = core.getInput('github-token') || process.env['GITHUB_TOKEN'];
  if (!token) {
    core.setFailed('GitHub token is required — set github-token input or GITHUB_TOKEN env var');
    return;
  }

  const octokit = github.getOctokit(token);

  try {
    const { config, guidelinesContent } = await loadConfig(configPath);

    const { files, rawDiff, totalChars } = await getFilteredDiff(
      octokit,
      owner,
      repo,
      pullNumber,
      config.ignore,
    );

    if (files.length > config.max_files) {
      core.setFailed(`PR has ${files.length} files, exceeding the limit of ${config.max_files}`);
      return;
    }

    if (totalChars > config.max_diff_chars) {
      core.setFailed(
        `PR diff is ${totalChars} chars, exceeding the limit of ${config.max_diff_chars}`,
      );
      return;
    }

    const linkedIssues = await fetchLinkedIssues(octokit, owner, repo, pullNumber);

    const prContext: PrContext = {
      title: pr.title as string,
      body: (pr.body as string | null) ?? '',
      linkedIssues,
    };
    const messages = buildPrompt(guidelinesContent, rawDiff, prContext);
    const { review, usage } = await callOpenRouter(apiKey, config.model, messages);

    if (usage !== undefined) {
      core.info(
        `Tokens — prompt: ${usage.prompt_tokens}, completion: ${usage.completion_tokens}, total: ${usage.total_tokens}`,
      );
    }

    await deletePreviousCarlComments({ octokit, owner, repo, pullNumber });
    await postReviewComment({
      octokit,
      owner,
      repo,
      pullNumber,
      body: `<!-- carl:review -->\n### carl review\n\n${review}`,
    });

    core.info('Review posted successfully');
  } catch (err) {
    if (err instanceof ConfigError) {
      core.setFailed(`Configuration error: ${err.message}`);
      return;
    }

    if (err instanceof DiffError) {
      core.setFailed(`Failed to fetch diff: ${err.message}`);
      return;
    }

    if (err instanceof AiError) {
      const isClientError =
        err.statusCode !== undefined && err.statusCode >= 400 && err.statusCode < 500;
      if (isClientError) {
        core.setFailed(`AI error (${err.statusCode}): ${err.message}`);
        return;
      }
      core.warning(`AI service unavailable: ${err.message}`);
      try {
        await postReviewComment({
          octokit,
          owner,
          repo,
          pullNumber,
          body: buildFallbackComment(err.message),
        });
      } catch {
        core.warning('Also failed to post fallback comment');
      }
      return;
    }

    throw err;
  }
}

run().catch(core.setFailed);
