import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as yaml from 'js-yaml';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export interface CarlConfig {
  readonly instance_id: string;
  readonly model: string;
  readonly guidelines: string;
  readonly max_diff_chars: number;
  readonly max_files: number;
  readonly ignore: readonly string[];
}

export interface LoadedConfig {
  readonly config: CarlConfig;
  readonly guidelinesContent: string;
}

const DEFAULTS = {
  model: 'anthropic/claude-sonnet-4-5',
  guidelines: '.github/carl.md',
  max_diff_chars: 20000,
  max_files: 10,
  ignore: [] as readonly string[],
} as const;

const INSTANCE_ID_RE = /^[a-zA-Z0-9_-]+$/;

export function parseConfig(raw: unknown): CarlConfig {
  if (typeof raw !== 'object' || raw === null) {
    throw new ConfigError('carl.yml must be a YAML mapping');
  }

  const r = raw as Record<string, unknown>;

  const instance_id = r['instance_id'];
  if (typeof instance_id !== 'string' || instance_id.trim().length === 0) {
    throw new ConfigError('`instance_id` is required and must be a non-empty string');
  }
  if (!INSTANCE_ID_RE.test(instance_id)) {
    throw new ConfigError(
      '`instance_id` may only contain letters, digits, hyphens, and underscores',
    );
  }

  const model = r['model'] !== undefined ? r['model'] : DEFAULTS.model;
  if (typeof model !== 'string' || model.trim().length === 0) {
    throw new ConfigError('`model` must be a non-empty string');
  }

  const guidelines = r['guidelines'] !== undefined ? r['guidelines'] : DEFAULTS.guidelines;
  if (typeof guidelines !== 'string' || guidelines.trim().length === 0) {
    throw new ConfigError('`guidelines` must be a non-empty string');
  }

  const max_diff_chars =
    r['max_diff_chars'] !== undefined ? r['max_diff_chars'] : DEFAULTS.max_diff_chars;
  if (
    typeof max_diff_chars !== 'number' ||
    !Number.isInteger(max_diff_chars) ||
    max_diff_chars <= 0
  ) {
    throw new ConfigError('`max_diff_chars` must be a positive integer');
  }

  const max_files = r['max_files'] !== undefined ? r['max_files'] : DEFAULTS.max_files;
  if (typeof max_files !== 'number' || !Number.isInteger(max_files) || max_files <= 0) {
    throw new ConfigError('`max_files` must be a positive integer');
  }

  const ignore = r['ignore'] !== undefined ? r['ignore'] : DEFAULTS.ignore;
  if (!Array.isArray(ignore) || !ignore.every((item) => typeof item === 'string')) {
    throw new ConfigError('`ignore` must be an array of strings');
  }

  return { instance_id, model, guidelines, max_diff_chars, max_files, ignore };
}

export async function loadConfig(configPath: string): Promise<LoadedConfig> {
  let rawYaml: string;
  try {
    rawYaml = await fs.readFile(configPath, 'utf-8');
  } catch {
    throw new ConfigError(`Cannot read config file: ${configPath}`);
  }

  let rawParsed: unknown;
  try {
    rawParsed = yaml.load(rawYaml);
  } catch (err) {
    throw new ConfigError(
      `Failed to parse carl.yml: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (rawParsed === null || rawParsed === undefined) {
    rawParsed = {};
  }

  const config = parseConfig(rawParsed);

  const guidelinesPath = path.isAbsolute(config.guidelines)
    ? config.guidelines
    : path.resolve(process.cwd(), config.guidelines);

  let guidelinesContent: string;
  try {
    guidelinesContent = await fs.readFile(guidelinesPath, 'utf-8');
  } catch {
    throw new ConfigError(`Cannot read guidelines file: ${config.guidelines}`);
  }

  return { config, guidelinesContent };
}
