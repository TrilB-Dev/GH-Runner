import express, { type Request, type Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { existsSync, readFileSync, rmSync, promises as fsPromises } from 'fs';
import { join } from 'path';
import { createSign, randomUUID } from 'crypto';
import { loadRunners, saveRunner, saveRunners, deleteRunner } from './runnerStorage';
import type { RunnerConfig } from './runnerStorage';
import {
  createRunnerInHostContainer,
  ensureRunnerHostContainer,
  getExtensionVersion,
  getRunnerHostHealth,
  getHostRunnerStatus,
  getRunnerVersion,
  getVolumeExists,
  getHostRunnerBaseVersion,
  refreshRunnerHostContainer,
  clearVolumeContents,
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

interface GithubRunner {
  id: number;
  name: string;
  runner_group_id?: number | null;
  runner_group_name?: string | null;
}

interface GithubAppInstallation {
  id: number;
  app_id: number;
  account: {
    login: string;
    type: string;
    id: number;
  };
  target_id: number;
  repository_selection: string;
}

interface GithubInstallationTokenResponse {
  token: string;
  expires_at: string;
  permissions?: Record<string, string>;
  repository_selection?: string;
}

const DEFAULT_HOST_CONTAINER_NAME = 'gh-runner-host';
const DEFAULT_RUNNER_ROOT_PATH = '/opt/github/runners';
const LANGUAGE_DIR_CANDIDATES = [
  join(__dirname, '..', '..', 'Language'),
  join(__dirname, '..', 'Language'),
  join(process.cwd(), '..', 'Language'),
  join(process.cwd(), 'Language')
];

const DEFAULT_LANGUAGE_LIST = [
  { code: 'en_GB', name: 'English (UK)' }
];

const EXTENSION_INFO = {
  name: 'GH Runner',
  author: 'MrTrilB',
  documentationUrl: 'https://github.com/MrTrilB/GH-Runner'
};

interface ErrorResponse {
  error: string;
  details?: string;
}

dotenv.config({ path: join(process.cwd(), '.env') });
dotenv.config({ path: '/config/.env' });

function getLanguageDir(): string {
  for (const candidate of LANGUAGE_DIR_CANDIDATES) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error('Language folder not found. Expected a Language directory in the extension root.');
}

async function loadLanguageDefinitions(): Promise<Array<{ code: string; name: string }>> {
  const languageDir = getLanguageDir();
  const languageFile = join(languageDir, 'Languages.json');

  try {
    const raw = await fsPromises.readFile(languageFile, 'utf8');
    const parsed = JSON.parse(raw) as { languages?: Array<{ code: string; name: string }> };
    if (Array.isArray(parsed.languages) && parsed.languages.length > 0) {
      return parsed.languages;
    }
  } catch {
    // fall back to default list
  }

  return DEFAULT_LANGUAGE_LIST;
}

function unquotePoString(value: string): string {
  return value
    .replace(/^"|"$/g, '')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"');
}

function parsePoContent(content: string): Record<string, string> {
  const lines = content.split(/\r?\n/);
  const translations: Record<string, string> = {};
  let msgid = '';
  let msgstr = '';
  let currentKey: 'msgid' | 'msgstr' | null = null;

  const finalize = () => {
    if (msgid !== '') {
      translations[msgid] = msgstr || msgid;
    }
    msgid = '';
    msgstr = '';
    currentKey = null;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    if (trimmed.startsWith('msgid')) {
      if (currentKey === 'msgstr') {
        finalize();
      } else if (msgid || msgstr) {
        finalize();
      }
      currentKey = 'msgid';
      msgid = unquotePoString(trimmed.slice(5).trim());
      continue;
    }

    if (trimmed.startsWith('msgstr')) {
      currentKey = 'msgstr';
      msgstr = unquotePoString(trimmed.slice(6).trim());
      continue;
    }

    if (trimmed.startsWith('"') && currentKey) {
      const appended = unquotePoString(trimmed);
      if (currentKey === 'msgid') {
        msgid += appended;
      } else if (currentKey === 'msgstr') {
        msgstr += appended;
      }
    }
  }

  if (currentKey !== null) {
    finalize();
  }

  return translations;
}

async function loadTranslations(language: string): Promise<Record<string, string>> {
  const languageDir = getLanguageDir();
  const potFile = join(languageDir, `GHRunner-${language}.pot`);
  const moFile = join(languageDir, `GHRunner-${language}.mo`);

  if (existsSync(moFile)) {
    const buffer = await fsPromises.readFile(moFile);
    const parsed = parseMo(buffer);
    return parsed;
  }

  if (existsSync(potFile)) {
    const content = await fsPromises.readFile(potFile, 'utf8');
    return parsePoContent(content);
  }

  throw new Error(`Translation file not found for language ${language}`);
}

function parseMo(buffer: Buffer): Record<string, string> {
  const header = buffer.readUInt32LE(0);
  const littleEndian = header === 0x950412de;
  const readUInt32 = littleEndian ? buffer.readUInt32LE.bind(buffer) : buffer.readUInt32BE.bind(buffer);
  const n = readUInt32(8);
  const origTableOffset = readUInt32(12);
  const transTableOffset = readUInt32(16);
  const translations: Record<string, string> = {};

  for (let i = 0; i < n; i += 1) {
    const origLength = readUInt32(origTableOffset + i * 8);
    const origOffset = readUInt32(origTableOffset + i * 8 + 4);
    const transLength = readUInt32(transTableOffset + i * 8);
    const transOffset = readUInt32(transTableOffset + i * 8 + 4);

    const orig = buffer.slice(origOffset, origOffset + origLength).toString('utf8');
    const trans = buffer.slice(transOffset, transOffset + transLength).toString('utf8');
    translations[orig] = trans || orig;
  }

  return translations;
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

const DEFAULT_GITHUB_APP_ID = process.env.GITHUB_APP_ID || process.env.AppID || '4592586';
const DEFAULT_GITHUB_APP_SLUG = process.env.GITHUB_APP_SLUG || 'docker-gh-runner-manager';
const DEFAULT_GITHUB_APP_INSTALL_URL = process.env.GITHUB_APP_INSTALL_URL || `https://github.com/apps/${DEFAULT_GITHUB_APP_SLUG}/installations/new`;
const DEFAULT_GITHUB_APP_PRIVATE_KEY_FILE = join(__dirname, 'docker-gh-runner-manager.2026-08-14.private-key.pem');

function getGithubAppPrivateKey(): string | null {
  const rawKey = process.env.GITHUB_APP_PRIVATE_KEY;
  const encodedKey = process.env.GITHUB_APP_PRIVATE_KEY_B64;
  const privateKeyPath = process.env.GITHUB_APP_PRIVATE_KEY_PATH;
  const clientKey = process.env.ClientKey || process.env.GITHUB_APP_CLIENT_KEY;

  if (rawKey?.trim()) {
    return rawKey.replace(/\\n/g, '\n');
  }

  if (encodedKey?.trim()) {
    return Buffer.from(encodedKey, 'base64').toString('utf8');
  }

  const candidateKeys = [privateKeyPath, clientKey].filter(Boolean) as string[];
  const candidatePaths = [
    ...candidateKeys,
    DEFAULT_GITHUB_APP_PRIVATE_KEY_FILE,
    join(process.cwd(), clientKey || ''),
    join(process.cwd(), privateKeyPath || ''),
    join('/config', clientKey || ''),
    join('/config', privateKeyPath || '')
  ].filter((value) => Boolean(value));

  for (const candidatePath of candidatePaths) {
    try {
      if (existsSync(candidatePath)) {
        const contents = readFileSync(candidatePath, 'utf8');
        if (contents.trim()) {
          return contents.replace(/\\n/g, '\n');
        }
      }
    } catch {
      // ignore missing/invalid paths
    }
  }

  if (clientKey?.trim() && clientKey.includes('-----BEGIN')) {
    return clientKey.replace(/\\n/g, '\n');
  }

  return null;
}

function createGithubAppJwt(): string {
  const appId = process.env.GITHUB_APP_ID || process.env.AppID || DEFAULT_GITHUB_APP_ID;
  const privateKey = getGithubAppPrivateKey();

  if (!appId || !privateKey) {
    throw new Error('GitHub App is not configured. Set GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY or GITHUB_APP_PRIVATE_KEY_B64, or include the default built-in app key.');
  }

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iat: now - 60,
    exp: now + 540,
    iss: Number(appId)
  };

  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const signingInput = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode(payload)}`;

  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(privateKey);

  return `${signingInput}.${signature.toString('base64url')}`;
}

async function fetchGithubAppInstallations(): Promise<GithubAppInstallation[]> {
  const jwt = createGithubAppJwt();
  const response = await fetch('https://api.github.com/app/installations', {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${jwt}`
    }
  });

  if (!response.ok) {
    throw new Error(`Unable to list GitHub App installations (${response.status})`);
  }

  const installations = await response.json() as GithubAppInstallation[];
  return installations;
}

function getGithubAppInstallUrl(): string {
  return process.env.GITHUB_APP_INSTALL_URL?.trim() || DEFAULT_GITHUB_APP_INSTALL_URL;
}

async function createGithubAppInstallationToken(installationId: number): Promise<GithubInstallationTokenResponse> {
  const jwt = createGithubAppJwt();
  const response = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${jwt}`
    },
    body: JSON.stringify({})
  });

  if (!response.ok) {
    throw new Error(`Unable to create GitHub App installation token (${response.status})`);
  }

  return await response.json() as GithubInstallationTokenResponse;
}

const isGithubAppInstallationToken = (token: GithubTokenConfig): boolean =>
  typeof token.type === 'string' && token.type.toLowerCase().includes('github app');

async function fetchInstallationRepositories(
  token: string
): Promise<Array<{ id: number; name: string; full_name: string; private: boolean; owner: { login: string } }>> {
  const response = await fetch('https://api.github.com/installation/repositories?per_page=100', {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `token ${token}`
    }
  });

  if (!response.ok) {
    throw new Error(`Unable to fetch installation repositories (${response.status})`);
  }

  const json = await response.json() as { repositories: Array<{ id: number; name: string; full_name: string; private: boolean; owner: { login: string } }> };
  return json.repositories;
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

async function synchronizeRunnerGroups(runners: RunnerConfig[]): Promise<RunnerConfig[]> {
  const tokens = await loadGithubTokens();
  const groupCache = new Map<string, Promise<GithubRunnerGroup[]>>();
  let changed = false;

  const synchronized = await Promise.all(runners.map(async (runner) => {
    const token = tokens.find((item) => item.name === runner.tokenName);
    if (!token) {
      return runner;
    }

    const scopePath = runner.isOrg
      ? `orgs/${encodeURIComponent(runner.owner)}`
      : `repos/${encodeURIComponent(runner.owner)}/${encodeURIComponent(runner.repo)}`;

    try {
      const response = await fetch(`https://api.github.com/${scopePath}/actions/runners?per_page=100`, {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token.token}`
        }
      });

      if (!response.ok) {
        await logIfEnabled('githubApi', `Unable to synchronize runner group for ${runner.runnerName} (${response.status})`);
        return runner;
      }

      const json = await response.json() as { runners?: GithubRunner[] };
      const githubRunner = (json.runners || []).find((item) => item.name === runner.runnerName);
      if (!githubRunner) {
        return runner;
      }

      let githubGroup = typeof githubRunner.runner_group_name === 'string'
        ? githubRunner.runner_group_name.trim() || undefined
        : undefined;

      if (!githubGroup && typeof githubRunner.runner_group_id === 'number') {
        const groupCacheKey = `${token.id}:${scopePath}`;
        let groupsPromise = groupCache.get(groupCacheKey);
        if (!groupsPromise) {
          groupsPromise = fetchRunnerGroups(token.token, runner.owner, runner.repo || null, runner.isOrg);
          groupCache.set(groupCacheKey, groupsPromise);
        }

        const groups = await groupsPromise;
        githubGroup = groups.find((group) => group.id === githubRunner.runner_group_id)?.name;
      }

      // Do not erase a known local group when GitHub omits group metadata.
      if (!githubGroup) {
        return runner;
      }

      if (githubGroup === runner.runnerGroup) {
        return runner;
      }

      changed = true;
      await logIfEnabled('githubApi', `Synchronizing runner group for ${runner.runnerName}: ${runner.runnerGroup || '(none)'} -> ${githubGroup || '(none)'}`);
      return { ...runner, runnerGroup: githubGroup };
    } catch (error) {
      await logIfEnabled('githubApi', `Runner group synchronization failed for ${runner.runnerName}: ${error}`);
      return runner;
    }
  }));

  if (changed) {
    await saveRunners(synchronized);
  }

  return synchronized;
}

app.get('/api/runners', async (_req: Request, res: Response) => {
  try {
    const runners = await synchronizeRunnerGroups(await loadRunners());
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
    const payload = req.body as Partial<LoggingSettings>;
    const settings: LoggingSettings = {
      uiLoggingEnabled: Boolean(payload.uiLoggingEnabled),
      runnerLoggingEnabled: Boolean(payload.runnerLoggingEnabled),
      githubApiLoggingEnabled: Boolean(payload.githubApiLoggingEnabled),
      startRunnersOnStartup: Boolean(payload.startRunnersOnStartup),
      language: typeof payload.language === 'string' && payload.language.trim() ? payload.language : 'en_GB'
    };
    await saveSettings(settings);
    await logIfEnabled('ui', `Saved extension settings: ${JSON.stringify(settings)}`);
    res.json({ success: true, settings });
  } catch (error) {
    await logIfEnabled('ui', `Failed to save settings: ${error}`);
    sendError(res, error);
  }
});

app.get('/api/languages', async (_req: Request, res: Response) => {
  try {
    const languages = await loadLanguageDefinitions();
    res.json({ languages });
  } catch (error) {
    await logIfEnabled('ui', `Failed to load languages: ${error}`);
    sendError(res, error);
  }
});

app.get('/api/translations/:language', async (req: Request, res: Response) => {
  try {
    const language = req.params.language;
    const translations = await loadTranslations(language);
    res.json(translations);
  } catch (error) {
    await logIfEnabled('ui', `Failed to load translations: ${error}`);
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

app.get('/api/github-app/auth-url', async (_req: Request, res: Response) => {
  try {
    const installUrl = getGithubAppInstallUrl();
    if (!installUrl) {
      return res.json({
        url: '',
        message: 'GitHub App installation URL is not configured. Set GITHUB_APP_INSTALL_URL or GITHUB_APP_SLUG in the backend environment.'
      });
    }

    res.json({
      url: installUrl,
      message: 'Open this URL to install the GitHub App on your organization or repository.'
    });
  } catch (error) {
    await logIfEnabled('githubApi', `Failed to get GitHub App install URL: ${error}`);
    sendError(res, error);
  }
});

app.get('/api/github-app/installations', async (_req: Request, res: Response) => {
  try {
    const installations = await fetchGithubAppInstallations();
    res.json(installations.map((installation) => ({
      id: installation.id,
      account: installation.account,
      targetId: installation.target_id,
      repositorySelection: installation.repository_selection
    })));
  } catch (error) {
    await logIfEnabled('githubApi', `Failed to list GitHub App installations: ${error}`);
    sendError(res, error);
  }
});

app.post('/api/github-app/installation-token', async (req: Request, res: Response) => {
  try {
    const requestedInstallationId = req.body?.installationId ? Number(req.body.installationId) : undefined;
    const requestedOwner = String(req.body?.owner || '').trim().toLowerCase();
    const name = String(req.body?.name || '').trim();

    const installUrl = getGithubAppInstallUrl();
    const installations = await fetchGithubAppInstallations();
    if (installations.length === 0) {
      return res.json({
        success: false,
        message: 'No GitHub App installations found. Install the app in the target organization or repository.',
        installUrl: installUrl || undefined
      });
    }

    let installation: GithubAppInstallation | undefined;

    if (requestedInstallationId) {
      installation = installations.find((item) => item.id === requestedInstallationId);
      if (!installation) {
        return res.status(400).json({ success: false, message: 'Requested GitHub App installation ID was not found.' });
      }
    }

    if (!installation && requestedOwner) {
      installation = installations.find((item) => item.account.login.toLowerCase() === requestedOwner);
      if (!installation) {
        return res.status(400).json({ success: false, message: `No GitHub App installation was found for owner ${requestedOwner}.` });
      }
    }

    if (!installation && installations.length === 1) {
      installation = installations[0];
    }

    if (!installation) {
      return res.status(400).json({
        success: false,
        message: 'Multiple GitHub App installations exist. Select the installation in the app settings or supply the installation ID.',
        installations: installations.map((item) => ({ id: item.id, owner: item.account.login })),
        installUrl: installUrl || undefined
      });
    }

    const tokenResponse = await createGithubAppInstallationToken(installation.id);
    const tokenConfig: GithubTokenConfig = {
      id: randomUUID(),
      name: name || `GitHub App installation ${installation.account.login}`,
      token: tokenResponse.token,
      login: installation.account.login,
      type: 'GitHub App Installation',
      createdAt: new Date().toISOString()
    };

    await saveGithubToken(tokenConfig);
    await logIfEnabled('githubApi', `Saved GitHub App installation token for ${installation.account.login}`);

    const responseToken: GithubTokenResponse = {
      id: tokenConfig.id,
      name: tokenConfig.name,
      login: tokenConfig.login,
      type: tokenConfig.type,
      createdAt: tokenConfig.createdAt
    };

    res.json({
      success: true,
      message: `GitHub App installation token created for ${installation.account.login}.`,
      token: responseToken
    });
  } catch (error) {
    await logIfEnabled('githubApi', `Failed to create GitHub App installation token: ${error}`);
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
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    await logIfEnabled('githubApi', `Failed to fetch runner groups for ${owner} ${repo || ''}: ${response.status}`);
    let githubMessage = '';
    try {
      const errorBody = await response.json() as { message?: string };
      githubMessage = typeof errorBody.message === 'string' ? errorBody.message : '';
    } catch {
      // The API may return an empty or non-JSON error response.
    }
    const reason = githubMessage || response.statusText || 'GitHub rejected the request.';
    throw new Error(`Unable to fetch runner groups (${response.status}): ${reason}`);
  }

  const json = await response.json() as { runner_groups: Array<{ id: number; name: string }> };
  return json.runner_groups.map((group) => ({ id: group.id, name: group.name }));
};

const removeGithubRunner = async (token: string, owner: string, repo: string, isOrg: boolean, runnerName: string) => {
  const scopePath = isOrg
    ? `orgs/${encodeURIComponent(owner)}`
    : `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const baseUrl = `https://api.github.com/${scopePath}/actions/runners`;
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`
  };

  const listResponse = await fetch(`${baseUrl}?per_page=100`, { headers });
  if (!listResponse.ok) {
    throw new Error(`Unable to list GitHub runners (${listResponse.status})`);
  }

  const json = await listResponse.json() as { runners?: GithubRunner[] };
  const githubRunner = (json.runners || []).find((runner) => runner.name === runnerName);
  if (!githubRunner) {
    return;
  }

  const deleteResponse = await fetch(`${baseUrl}/${githubRunner.id}`, {
    method: 'DELETE',
    headers
  });
  if (!deleteResponse.ok && deleteResponse.status !== 404) {
    throw new Error(`Unable to delete GitHub runner (${deleteResponse.status})`);
  }
};

app.get('/api/github-tokens/:id/repos', async (req: Request, res: Response) => {
  try {
    const token = await getGithubTokenById(req.params.id);
    if (!token) {
      return res.status(404).json({ error: 'Token not found.' });
    }

    await logIfEnabled('githubApi', `Fetching repos for token ${token.id}`);

    let repos: Array<{ id: number; name: string; full_name: string; private: boolean; owner: { login: string } }>;
    if (isGithubAppInstallationToken(token)) {
      repos = await fetchInstallationRepositories(token.token);
    } else {
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

      repos = await response.json() as Array<{
        id: number;
        name: string;
        full_name: string;
        private: boolean;
        owner: { login: string };
      }>;
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

    if (isGithubAppInstallationToken(token)) {
      const allRepos = await fetchInstallationRepositories(token.token);
      const normalizedQuery = q.toLowerCase();
      let filtered = allRepos.filter((repo) =>
        repo.full_name.toLowerCase().includes(normalizedQuery) ||
        repo.name.toLowerCase().includes(normalizedQuery) ||
        repo.owner.login.toLowerCase().includes(normalizedQuery)
      );

      if (owner) {
        filtered = filtered.filter((repo) => repo.owner.login.toLowerCase() === owner.toLowerCase());
      }

      return res.json(filtered.slice(0, 50).map((repo) => ({
        id: repo.id,
        name: repo.name,
        full_name: repo.full_name,
        private: repo.private,
        owner: repo.owner.login
      })));
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
      return res.json({ groups: [], error: 'Token not found.' });
    }

    const owner = String(req.query.owner || '');
    const repo = req.query.repo ? String(req.query.repo) : null;
    const isOrg = String(req.query.isOrg || 'false') === 'true';

    if (!owner) {
      return res.json({ groups: [], error: 'Owner/org is required.' });
    }

    try {
      const groups = await fetchRunnerGroups(token.token, owner, repo, isOrg);
      res.json({ groups });
    } catch (err) {
      const errorResponse = createErrorResponse(err);
      await logIfEnabled('githubApi', `Runner group request failed for ${owner} ${repo || ''}: ${errorResponse.error}`);
      res.json({ groups: [], error: errorResponse.error, details: errorResponse.details });
    }
  } catch (error) {
    const errorResponse = createErrorResponse(error);
    await logIfEnabled('githubApi', `Runner group request failed before GitHub call: ${errorResponse.error}`);
    res.json({ groups: [], error: errorResponse.error, details: errorResponse.details });
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
      runnerGroup: payload.isOrg && typeof payload.runnerGroup === 'string'
        ? payload.runnerGroup.trim() || undefined
        : undefined,
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
      runnerGroup: (typeof payload.isOrg === 'boolean' ? payload.isOrg : existing.isOrg) && typeof payload.runnerGroup === 'string'
        ? payload.runnerGroup.trim() || undefined
        : (typeof payload.isOrg === 'boolean' ? payload.isOrg : existing.isOrg) ? existing.runnerGroup : undefined,
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

    const runnerGroupChanged = updated.runnerGroup !== existing.runnerGroup;
    if (runnerGroupChanged) {
      if (!updated.tokenName) {
        return res.status(400).json({ error: 'A saved GitHub token is required to change the runner group.' });
      }

      const githubToken = (await loadGithubTokens()).find((item) => item.name === updated.tokenName);
      if (!githubToken) {
        return res.status(400).json({ error: `The saved GitHub token "${updated.tokenName}" was not found.` });
      }

      const registrationToken = await fetchRegistrationToken(
        githubToken.token,
        updated.owner,
        updated.repo || null,
        updated.isOrg
      );
      const wasRunning = (await getHostRunnerStatus(existing.hostContainerName, existing.runnerPath)).status === 'on';

      await stopHostRunner(existing.hostContainerName, existing.runnerPath);
      try {
        await createRunnerInHostContainer(
          updated.hostContainerName,
          updated.runnerPath,
          updated.githubUrl,
          updated.owner,
          updated.repo,
          updated.isOrg,
          registrationToken,
          updated.runnerName,
          updated.labels,
          updated.runnerGroup
        );
      } catch (error) {
        if (wasRunning) {
          await startHostRunner(existing.hostContainerName, existing.runnerPath).catch(() => undefined);
        }
        throw error;
      }

      if (wasRunning) {
        await startHostRunner(updated.hostContainerName, updated.runnerPath);
      }
    }

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

    if (!existing.tokenName) {
      return res.status(400).json({ error: 'The saved GitHub token for this runner was not found.' });
    }

    const githubToken = (await loadGithubTokens()).find((item) => item.name === existing.tokenName);
    if (!githubToken) {
      return res.status(400).json({ error: `The saved GitHub token "${existing.tokenName}" was not found.` });
    }

    await removeGithubRunner(
      githubToken.token,
      existing.owner,
      existing.repo,
      existing.isOrg,
      existing.runnerName
    );

    try {
      await removeHostRunner(existing.hostContainerName, existing.runnerPath);
    } catch (error) {
      await logIfEnabled('runner', `Failed to remove runner directory ${existing.runnerPath}: ${error}`);
      throw error;
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
    if (name === 'gh-runner-manager-runners') {
      const runners = await loadRunners();
      await Promise.all(runners.map(async (runner) => {
        try {
          await stopHostRunner(runner.hostContainerName, runner.runnerPath);
        } catch (error) {
          await logIfEnabled('ui', `Unable to stop runner ${runner.runnerName} before clearing volume: ${error}`);
        }
      }));
    }

    await clearVolumeContents(name);
    if (name === 'gh-runner-manager-runners') {
      await saveRunners([]);
    }
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

  console.log(
    `GitHub App private key source: ${existsSync(DEFAULT_GITHUB_APP_PRIVATE_KEY_FILE) ? 'built-in default key file' : 'runtime env/config path'}`
  );

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
