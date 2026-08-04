import express, { type Request, type Response } from 'express';
import cors from 'cors';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { loadRunners, saveRunner, deleteRunner } from './runnerStorage';
import type { RunnerConfig } from './runnerStorage';
import {
  createRunnerInHostContainer,
  containerExists,
  ensureRunnerHostContainer,
  getContainerStatus,
  getExtensionVersion,
  getRunnerHostHealth,
  getHostRunnerStatus,
  getRunnerVersion,
  getVolumeExists,
  getHostRunnerBaseVersion,
  refreshRunnerHostContainer,
  removeVolume,
  startHostRunner,
  stopHostRunner,
  restartHostRunner,
  removeHostRunner
} from './docker';
import {
  loadGithubTokens,
  saveGithubToken,
  deleteGithubToken,
  getGithubTokenById,
  type GithubTokenConfig
} from './githubTokenStorage';
import { appendLogEntry, readLogEntries, clearLogEntries } from './logStorage';
import { loadSettings, saveSettings, type LoggingSettings } from './settingsStorage';
import { logIfEnabled } from './logger';

type GithubTokenResponse = Pick<GithubTokenConfig, 'id' | 'name' | 'login' | 'type' | 'createdAt'>;

interface GithubRegistrationTokenResponse {
  token: string;
  expires_at: string;
}

interface GithubRunnerGroup {
  id: number;
  name: string;
}

const DEFAULT_HOST_CONTAINER_NAME = 'gh-runner-host';
const DEFAULT_RUNNER_ROOT_PATH = '/opt/github/runners';
const EXTENSION_INFO = {
  name: 'GH Runner',
  author: 'MrTrilB',
  documentationUrl: 'https://github.com/MrTrilB/GH-Runner'
};

interface ErrorResponse {
  error: string;
  details?: string;
}

function createErrorResponse(error: unknown): ErrorResponse {
  if (error instanceof Error) {
    return {
      error: error.message || 'An unexpected error occurred.',
      details: error.stack ?? undefined
    };
  }

  if (error && typeof error === 'object') {
    const errObj = error as Record<string, unknown>;
    const message = String(errObj.error ?? errObj.message ?? JSON.stringify(errObj));
    const detailsParts: string[] = [];

    if (typeof errObj.stderr === 'string' && errObj.stderr.trim()) {
      detailsParts.push(`stderr: ${errObj.stderr.trim()}`);
    }
    if (typeof errObj.stdout === 'string' && errObj.stdout.trim()) {
      detailsParts.push(`stdout: ${errObj.stdout.trim()}`);
    }
    if (typeof errObj.code !== 'undefined') {
      detailsParts.push(`code: ${String(errObj.code)}`);
    }
    if (typeof errObj.cmd === 'string' && errObj.cmd.trim()) {
      detailsParts.push(`cmd: ${errObj.cmd.trim()}`);
    }

    return {
      error: message || 'An unexpected error occurred.',
      details: detailsParts.length > 0 ? detailsParts.join('\n') : undefined
    };
  }

  return { error: String(error) || 'An unexpected error occurred.' };
}

function sendError(res: Response, error: unknown, statusCode = 500) {
  res.status(statusCode).json(createErrorResponse(error));
}

const app = express();

app.use(cors());
app.use(express.json());

async function enrichRunner(runner: RunnerConfig) {
  const status = await getHostRunnerStatus(runner.hostContainerName, runner.runnerPath);
  const version = await getRunnerVersion(runner.hostContainerName, runner.runnerPath);
  return {
    ...runner,
    status: status.status,
    dockerRawStatus: status.raw,
    runnerVersion: version || undefined,
    usage: null
  };
}

app.get('/api/runners', async (_req: Request, res: Response) => {
  try {
    const runners = await loadRunners();
    const enriched = await Promise.all(runners.map(enrichRunner));
    res.json(enriched);
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/host-health', async (_req: Request, res: Response) => {
  try {
    const health = await getRunnerHostHealth(DEFAULT_HOST_CONTAINER_NAME);
    res.json(health);
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/extension-info', async (_req: Request, res: Response) => {
  try {
    const tokens = await loadGithubTokens();
    let githubApiConnection = {
      status: 'warning',
      message: 'No GitHub token configured.'
    };

    try {
      await logIfEnabled('githubApi', 'Checking GitHub API connectivity');
      const response = await fetch('https://api.github.com', {
        headers: {
          Accept: 'application/vnd.github+json'
        }
      });

      githubApiConnection = response.ok
        ? { status: 'up', message: 'GitHub API is reachable.' }
        : { status: 'down', message: `GitHub API returned ${response.status}.` };
      await logIfEnabled('githubApi', `GitHub API status: ${githubApiConnection.status}`);
    } catch (err) {
      githubApiConnection = { status: 'down', message: 'Unable to reach GitHub API.' };
      await logIfEnabled('githubApi', `GitHub API connectivity check failed: ${err}`);
    }

    const hostHealth = await getRunnerHostHealth(DEFAULT_HOST_CONTAINER_NAME);
    const serviceContainerUp = hostHealth.exists && hostHealth.status.status !== 'off';
    const runnerContainerUp = hostHealth.exists && hostHealth.runnerInstalled;
    const dataVolumeExists = await getVolumeExists('gh-runner-manager-data');
    const runnerVolumeExists = await getVolumeExists('gh-runner-manager-runners');
    const runnerConfigs = await loadRunners();
    const loggingSettings = await loadSettings();
    const runnerStatuses = await Promise.all(
      runnerConfigs.map(async (runner) => (await getHostRunnerStatus(runner.hostContainerName, runner.runnerPath)).status)
    );
    const activeRunnerCount = runnerStatuses.filter((status) => status === 'on').length;
    const runnerContainerStatus = runnerConfigs.length === 0 ? 'none' : activeRunnerCount > 0 ? 'active' : 'inactive';
    const runnerBaseVersion = await getHostRunnerBaseVersion(DEFAULT_HOST_CONTAINER_NAME);
    const runnerVersions = await Promise.all(
      runnerConfigs.map(async (runner) => ({
        id: runner.id,
        version: await getRunnerVersion(runner.hostContainerName, runner.runnerPath)
      }))
    );
    const runnerVersionsOutOfDate = runnerVersions.filter((runner) => runner.version && runner.version !== runnerBaseVersion).length;
    const runnerVersionMismatch = runnerVersionsOutOfDate > 0;

    res.json({
      extensionName: EXTENSION_INFO.name,
      extensionVersion: getExtensionVersion(),
      extensionAuthor: EXTENSION_INFO.author,
      documentationUrl: EXTENSION_INFO.documentationUrl,
      loggingSettings,
      githubApiConnection,
      serviceContainer: {
        name: DEFAULT_HOST_CONTAINER_NAME,
        exists: hostHealth.exists,
        status: serviceContainerUp ? 'up' : 'down',
        raw: hostHealth.status.raw
      },
      runnerContainer: {
        totalRunners: runnerConfigs.length,
        activeRunners: activeRunnerCount,
        status: runnerContainerUp ? 'up' : 'down'
      },
      runnerBaseVersion,
      runnerVersions,
      runnerVersionsOutOfDate,
      runnerVersionMismatch,
      dataVolumeExists,
      runnerVolumeExists,
      configuredGithubTokens: tokens.length
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/github-tokens', async (_req: Request, res: Response) => {
  try {
    const tokens = await loadGithubTokens();
    const responseTokens: GithubTokenResponse[] = tokens.map(({ token, ...rest }) => rest);
    res.json(responseTokens);
  } catch (error) {
    await logIfEnabled('ui', `Failed to load GitHub tokens: ${error}`);
    sendError(res, error);
  }
});

app.get('/api/settings', async (_req: Request, res: Response) => {
  try {
    const settings = await loadSettings();
    res.json(settings);
  } catch (error) {
    await logIfEnabled('ui', `Failed to load settings: ${error}`);
    sendError(res, error);
  }
});

app.post('/api/settings', async (req: Request, res: Response) => {
  try {
    const payload = req.body as LoggingSettings;
    const settings: LoggingSettings = {
      uiLoggingEnabled: Boolean(payload.uiLoggingEnabled),
      runnerLoggingEnabled: Boolean(payload.runnerLoggingEnabled),
      githubApiLoggingEnabled: Boolean(payload.githubApiLoggingEnabled),
      startRunnersOnStartup: Boolean(payload.startRunnersOnStartup)
    };
    await saveSettings(settings);
    await logIfEnabled('ui', `Saved extension settings: ${JSON.stringify(settings)}`);
    res.json({ success: true, settings });
  } catch (error) {
    await logIfEnabled('ui', `Failed to save settings: ${error}`);
    sendError(res, error);
  }
});

app.post('/api/github-tokens', async (req: Request, res: Response) => {
  try {
    const payload = req.body as Partial<GithubTokenConfig>;
    if (!payload.name || !payload.token) {
      return res.status(400).json({ error: 'Token name and token are required.' });
    }

    const response = await fetch('https://api.github.com/user', {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `token ${payload.token}`
      }
    });

    if (!response.ok) {
      return res.status(400).json({ error: 'Unable to validate token with GitHub. Please check permissions and token validity.' });
    }

    const user = await response.json() as { login: string; type: string };
    const tokenConfig: GithubTokenConfig = {
      id: payload.id || randomUUID(),
      name: payload.name,
      token: payload.token,
      login: user.login,
      type: user.type,
      createdAt: new Date().toISOString()
    };

    await saveGithubToken(tokenConfig);
    await logIfEnabled('githubApi', `Saved GitHub token ${tokenConfig.name} for ${tokenConfig.login}`);
    const responseToken: GithubTokenResponse = {
      id: tokenConfig.id,
      name: tokenConfig.name,
      login: tokenConfig.login,
      type: tokenConfig.type,
      createdAt: tokenConfig.createdAt
    };
    res.json({ success: true, token: responseToken });
  } catch (error) {
    await logIfEnabled('githubApi', `Failed to save GitHub token: ${error}`);
    sendError(res, error);
  }
});

app.delete('/api/github-tokens/:id', async (req: Request, res: Response) => {
  try {
    await deleteGithubToken(req.params.id);
    await logIfEnabled('ui', `Deleted GitHub token ${req.params.id}`);
    res.json({ success: true });
  } catch (error) {
    await appendLogEntry(`Failed to delete GitHub token ${req.params.id}: ${error}`);
    sendError(res, error);
  }
});

const fetchRegistrationToken = async (
  token: string,
  owner: string,
  repo: string | null,
  isOrg: boolean
): Promise<string> => {
  const url = isOrg
    ? `https://api.github.com/orgs/${encodeURIComponent(owner)}/actions/runners/registration-token`
    : `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo || '')}/actions/runners/registration-token`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `token ${token}`
    }
  });

  if (!response.ok) {
    throw new Error(`Unable to generate registration token (${response.status})`);
  }

  const json = await response.json() as GithubRegistrationTokenResponse;
  return json.token;
};

const fetchRunnerGroups = async (
  token: string,
  owner: string,
  repo: string | null,
  isOrg: boolean
): Promise<GithubRunnerGroup[]> => {
  const url = isOrg
    ? `https://api.github.com/orgs/${encodeURIComponent(owner)}/actions/runner-groups`
    : `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo || '')}/actions/runner-groups`;

  await logIfEnabled('githubApi', `Fetching runner groups for ${owner} ${repo || ''} org=${isOrg}`);
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `token ${token}`
    }
  });

  if (!response.ok) {
    await logIfEnabled('githubApi', `Failed to fetch runner groups for ${owner} ${repo || ''}: ${response.status}`);
    if (response.status === 404 || response.status === 403) {
      return [];
    }
    throw new Error(`Unable to fetch runner groups (${response.status})`);
  }

  const json = await response.json() as { runner_groups: Array<{ id: number; name: string }> };
  return json.runner_groups.map((group) => ({ id: group.id, name: group.name }));
};

app.get('/api/github-tokens/:id/repos', async (req: Request, res: Response) => {
  try {
    const token = await getGithubTokenById(req.params.id);
    if (!token) {
      return res.status(404).json({ error: 'Token not found.' });
    }

    await logIfEnabled('githubApi', `Fetching repos for token ${token.id}`);
    const response = await fetch('https://api.github.com/user/repos?per_page=100', {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `token ${token.token}`
      }
    });

    if (!response.ok) {
      await logIfEnabled('githubApi', `Failed to fetch repos for token ${token.id}: ${response.status}`);
      return res.status(response.status).json({ error: 'Unable to fetch repositories for this token.' });
    }

    const repos = await response.json() as Array<{
      id: number;
      name: string;
      full_name: string;
      private: boolean;
      owner: { login: string };
    }>;
    res.json(repos.map((repo) => ({
      id: repo.id,
      name: repo.name,
      full_name: repo.full_name,
      private: repo.private,
      owner: repo.owner.login
    })));
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/github-tokens/:id/repos/search', async (req: Request, res: Response) => {
  try {
    const token = await getGithubTokenById(req.params.id);
    if (!token) {
      return res.status(404).json({ error: 'Token not found.' });
    }

    const owner = String(req.query.owner || '');
    const q = String(req.query.q || '').trim();
    const isOrg = String(req.query.isOrg || 'false') === 'true';

    if (!owner) {
      return res.status(400).json({ error: 'Owner/org is required.' });
    }

    if (!q) {
      return res.json([]);
    }

    const searchGithubRepos = async (qualifier: string) => {
      const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(`${q} ${qualifier}`)}&per_page=50`;
      await logIfEnabled('githubApi', `Searching repos for ${owner}, q=${q}, qualifier=${qualifier}`);

      const response = await fetch(url, {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `token ${token.token}`
        }
      });

      if (!response.ok) {
        await logIfEnabled('githubApi', `Failed to search repos for token ${token.id}: ${response.status}`);
        return [] as Array<{ id: number; name: string; full_name: string; private: boolean; owner: { login: string } }>;
      }

      const json = await response.json() as {
        items: Array<{ id: number; name: string; full_name: string; private: boolean; owner: { login: string } }>;
      };

      return json.items;
    };

    let repos = [] as Array<{ id: number; name: string; full_name: string; private: boolean; owner: { login: string } }>;
    if (isOrg) {
      repos = await searchGithubRepos(`org:${owner}`);
      if (repos.length === 0) {
        repos = await searchGithubRepos(`user:${owner}`);
      }
    } else {
      repos = await searchGithubRepos(`user:${owner}`);
      if (repos.length === 0) {
        repos = await searchGithubRepos(`org:${owner}`);
      }
    }

    res.json(repos.map((repo) => ({
      id: repo.id,
      name: repo.name,
      full_name: repo.full_name,
      private: repo.private,
      owner: repo.owner.login
    })));
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/github-tokens/:id/runner-groups', async (req: Request, res: Response) => {
  try {
    const token = await getGithubTokenById(req.params.id);
    if (!token) {
      return res.status(404).json({ error: 'Token not found.' });
    }

    const owner = String(req.query.owner || '');
    const repo = req.query.repo ? String(req.query.repo) : null;
    const isOrg = String(req.query.isOrg || 'false') === 'true';

    if (!owner) {
      return res.status(400).json({ error: 'Owner/org is required.' });
    }

    try {
      const groups = await fetchRunnerGroups(token.token, owner, repo, isOrg);
      res.json(groups);
    } catch (err) {
      sendError(res, err);
    }
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/github-tokens/:id/registration-token', async (req: Request, res: Response) => {
  try {
    const token = await getGithubTokenById(req.params.id);
    if (!token) {
      return res.status(404).json({ error: 'Token not found.' });
    }

    const owner = String(req.body.owner || '');
    const repo = req.body.repo ? String(req.body.repo) : null;
    const isOrg = Boolean(req.body.isOrg);

    if (!owner) {
      return res.status(400).json({ error: 'Owner/org is required.' });
    }

    const registrationToken = await fetchRegistrationToken(token.token, owner, repo, isOrg);
    await logIfEnabled('githubApi', `Obtained GitHub runner registration token for ${owner} ${repo || ''}`);
    res.json({ token: registrationToken });
  } catch (error) {
    await logIfEnabled('githubApi', `Failed to obtain registration token for ${req.body?.owner || '(unknown)'} ${req.body?.repo || ''}: ${error}`);
    sendError(res, error);
  }
});

app.post('/api/runners', async (req: Request, res: Response) => {
  try {
    const payload = req.body as Partial<RunnerConfig> & { registrationToken?: string; selectedTokenId?: string };
    if (!payload.runnerName || !payload.githubUrl || !payload.owner || typeof payload.isOrg !== 'boolean' || !payload.labels) {
      return res.status(400).json({ error: 'Missing required runner fields.' });
    }

    if (!payload.isOrg && !payload.repo) {
      return res.status(400).json({ error: 'Repository is required when registering a repository-scoped runner.' });
    }

    if (!payload.registrationToken && !payload.selectedTokenId) {
      return res.status(400).json({ error: 'Registration token is required to create a runner, or select a saved GitHub token to generate one.' });
    }

    const id = randomUUID();
    const safeName = payload.runnerName.toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
    const runnerPath = `${DEFAULT_RUNNER_ROOT_PATH.replace(/\/$/, '')}/${safeName}`;

    const runner: RunnerConfig = {
      id,
      runnerName: payload.runnerName,
      githubUrl: payload.githubUrl,
      owner: payload.owner,
      repo: payload.repo || '',
      isOrg: payload.isOrg,
      tokenName: payload.tokenName || '',
      labels: Array.isArray(payload.labels)
        ? payload.labels
        : String(payload.labels).split(',').map((label) => label.trim()).filter(Boolean),
      startOnStartup: Boolean(payload.startOnStartup),
      hostContainerName: DEFAULT_HOST_CONTAINER_NAME,
      runnerRootPath: DEFAULT_RUNNER_ROOT_PATH,
      runnerPath,
      createdAt: new Date().toISOString()
    };

    let registrationToken = payload.registrationToken;
    if (!registrationToken) {
      if (!payload.selectedTokenId) {
        return res.status(400).json({ error: 'A saved GitHub API token must be selected to generate a registration token.' });
      }

      const githubToken = await getGithubTokenById(payload.selectedTokenId);
      if (!githubToken) {
        return res.status(400).json({ error: 'Selected GitHub token not found.' });
      }

      try {
        registrationToken = await fetchRegistrationToken(
          githubToken.token,
          runner.owner,
          runner.repo || null,
          runner.isOrg
        );
      } catch (err) {
        return sendError(res, err);
      }
    }

    try {
      await createRunnerInHostContainer(
        runner.hostContainerName,
        runner.runnerPath,
        runner.githubUrl,
        runner.owner,
        runner.repo,
        runner.isOrg,
        registrationToken,
        runner.runnerName,
        runner.labels,
        runner.runnerGroup
      );

      await saveRunner(runner);
      await logIfEnabled('runner', `Created runner ${runner.runnerName} at ${runner.runnerPath}`);
      res.json({ success: true, runner });
    } catch (error) {
      await logIfEnabled('runner', `Failed to create runner ${runner.runnerName}: ${error}`);
      console.error('Runner creation failed:', error);
      try {
        await removeHostRunner(runner.hostContainerName, runner.runnerPath);
      } catch (cleanupError) {
        console.error('Runner cleanup failed:', cleanupError);
      }
      sendError(res, error);
    }
  } catch (error) {
    sendError(res, error);
  }
});

app.put('/api/runners/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const payload = req.body as Partial<RunnerConfig>;
    const runners = await loadRunners();
    const existing = runners.find((r) => r.id === id);
    if (!existing) {
      return res.status(404).json({ error: 'Runner not found.' });
    }

    const updated: RunnerConfig = {
      ...existing,
      runnerName: payload.runnerName ?? existing.runnerName,
      githubUrl: payload.githubUrl ?? existing.githubUrl,
      owner: payload.owner ?? existing.owner,
      repo: payload.repo ?? existing.repo,
      isOrg: typeof payload.isOrg === 'boolean' ? payload.isOrg : existing.isOrg,
      tokenName: payload.tokenName ?? existing.tokenName,
      labels: Array.isArray(payload.labels)
        ? payload.labels
        : payload.labels
        ? String(payload.labels).split(',').map((label) => label.trim()).filter(Boolean)
        : existing.labels,
      startOnStartup: typeof payload.startOnStartup === 'boolean' ? payload.startOnStartup : existing.startOnStartup ?? false,
      hostContainerName: DEFAULT_HOST_CONTAINER_NAME,
      runnerRootPath: DEFAULT_RUNNER_ROOT_PATH,
      runnerPath: existing.runnerPath,
      createdAt: existing.createdAt
    };

    await saveRunner(updated);
    await logIfEnabled('ui', `Updated runner ${updated.runnerName} (${updated.id})`);
    res.json({ success: true, runner: updated });
  } catch (error) {
    await logIfEnabled('ui', `Failed to update runner ${req.params.id}: ${error}`);
    sendError(res, error);
  }
});

app.delete('/api/runners/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const runners = await loadRunners();
    const existing = runners.find((r) => r.id === id);
    if (!existing) {
      return res.status(404).json({ error: 'Runner not found.' });
    }

    try {
      await removeHostRunner(existing.hostContainerName, existing.runnerPath);
    } catch {
      // ignore cleanup errors
    }

    await deleteRunner(id);
    await logIfEnabled('ui', `Deleted runner ${existing.runnerName} (${existing.id})`);
    res.json({ success: true });
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/runners/all/:action', async (req: Request, res: Response) => {
  try {
    const action = req.params.action as 'start' | 'stop' | 'restart';
    const runners = await loadRunners();

    if (runners.length === 0) {
      return res.status(200).json({ success: true, results: [] });
    }

    await ensureRunnerHostContainer(DEFAULT_HOST_CONTAINER_NAME);

    const results = await Promise.all(
      runners.map(async (runner) => {
        try {
          switch (action) {
            case 'start':
              await startHostRunner(runner.hostContainerName, runner.runnerPath);
              await logIfEnabled('runner', `Started runner ${runner.runnerName} (${runner.id})`);
              break;
            case 'stop':
              await stopHostRunner(runner.hostContainerName, runner.runnerPath);
              await logIfEnabled('runner', `Stopped runner ${runner.runnerName} (${runner.id})`);
              break;
            case 'restart':
              await restartHostRunner(runner.hostContainerName, runner.runnerPath);
              await logIfEnabled('runner', `Restarted runner ${runner.runnerName} (${runner.id})`);
              break;
            default:
              throw new Error('Invalid action.');
          }

          return {
            id: runner.id,
            runnerName: runner.runnerName,
            success: true
          };
        } catch (error) {
          await logIfEnabled('runner', `Failed ${action} runner ${runner.runnerName} (${runner.id}): ${error}`);
          return {
            id: runner.id,
            runnerName: runner.runnerName,
            success: false,
            error: String(error)
          };
        }
      })
    );

    res.json({ success: true, results });
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/runners/:id/:action', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const action = req.params.action as 'start' | 'stop' | 'restart';
    const runners = await loadRunners();
    const runner = runners.find((r) => r.id === id);
    if (!runner) {
      return res.status(404).json({ error: 'Runner not found.' });
    }

    await ensureRunnerHostContainer(runner.hostContainerName);

    switch (action) {
      case 'start':
        await startHostRunner(runner.hostContainerName, runner.runnerPath);
        await logIfEnabled('runner', `Started runner ${runner.runnerName} (${runner.id})`);
        break;
      case 'stop':
        await stopHostRunner(runner.hostContainerName, runner.runnerPath);
        await logIfEnabled('runner', `Stopped runner ${runner.runnerName} (${runner.id})`);
        break;
      case 'restart':
        await restartHostRunner(runner.hostContainerName, runner.runnerPath);
        await logIfEnabled('runner', `Restarted runner ${runner.runnerName} (${runner.id})`);
        break;
      default:
        return res.status(400).json({ error: 'Invalid action.' });
    }

    res.json({ success: true, runnerName: runner.runnerName });
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/host-refresh', async (_req: Request, res: Response) => {
  try {
    await refreshRunnerHostContainer(DEFAULT_HOST_CONTAINER_NAME);
    await logIfEnabled('ui', 'Runner host container refreshed');
    res.json({ success: true });
  } catch (error) {
    await logIfEnabled('ui', `Failed to refresh runner host container: ${error}`);
    sendError(res, error);
  }
});

app.post('/api/clear-volume', async (req: Request, res: Response) => {
  try {
    const name = String(req.body.name || '');
    if (!name) {
      return res.status(400).json({ error: 'Volume name is required.' });
    }
    await removeVolume(name);
    await logIfEnabled('ui', `Cleared volume ${name}`);
    res.json({ success: true });
  } catch (error) {
    await logIfEnabled('ui', `Failed to clear volume ${String(req.body?.name)}: ${error}`);
    sendError(res, error);
  }
});

app.get('/api/logs', async (_req: Request, res: Response) => {
  try {
    const logs = await readLogEntries();
    res.json({ logs });
  } catch (error) {
    await appendLogEntry(`Failed to read logs: ${error}`);
    sendError(res, error);
  }
});

app.post('/api/logs/clear', async (_req: Request, res: Response) => {
  try {
    await clearLogEntries();
    await appendLogEntry('Extension logs cleared');
    res.json({ success: true });
  } catch (error) {
    await appendLogEntry(`Failed to clear logs: ${error}`);
    sendError(res, error);
  }
});

const publicPath = join(__dirname, '..', 'ui');

app.use(express.static(publicPath));

app.get('*', (_req: Request, res: Response) => {
  res.sendFile(join(publicPath, 'index.html'));
});

const socketPath = process.argv.includes('--socket')
  ? process.argv[process.argv.indexOf('--socket') + 1]
  : '/run/guest-services/backend.sock';

if (existsSync(socketPath)) {
  rmSync(socketPath);
}

async function startSavedRunnersOnStartup() {
  try {
    const settings = await loadSettings();
    if (!settings.startRunnersOnStartup) {
      return;
    }

    const runners = await loadRunners();
    if (runners.length === 0) {
      return;
    }

    await ensureRunnerHostContainer(DEFAULT_HOST_CONTAINER_NAME);

    await Promise.all(
      runners.filter((runner) => runner.startOnStartup).map(async (runner) => {
        try {
          const status = await getHostRunnerStatus(runner.hostContainerName, runner.runnerPath);
          if (status.status !== 'on') {
            await startHostRunner(runner.hostContainerName, runner.runnerPath);
            await logIfEnabled('runner', `Auto-started runner ${runner.runnerName} (${runner.id}) on startup`);
          }
        } catch (error) {
          await logIfEnabled('runner', `Failed to auto-start runner ${runner.runnerName} (${runner.id}): ${error}`);
        }
      })
    );
  } catch (error) {
    await logIfEnabled('runner', `Auto-start runner startup process failed: ${error}`);
  }
}

async function startServer() {
  app.listen(socketPath, () => {
    console.log(`GitHub Runner Manager listening on socket ${socketPath}`);
  });

  try {
    await ensureRunnerHostContainer(DEFAULT_HOST_CONTAINER_NAME);
    await startSavedRunnersOnStartup();
  } catch (error) {
    console.error('Runner host container initialization failed:', error);
  }
}

startServer().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
