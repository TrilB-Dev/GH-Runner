"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const fs_1 = require("fs");
const path_1 = require("path");
const crypto_1 = require("crypto");
const runnerStorage_1 = require("./runnerStorage");
const docker_1 = require("./docker");
const githubTokenStorage_1 = require("./githubTokenStorage");
const logStorage_1 = require("./logStorage");
const settingsStorage_1 = require("./settingsStorage");
const logger_1 = require("./logger");
const DEFAULT_HOST_CONTAINER_NAME = 'gh-runner-host';
const DEFAULT_RUNNER_ROOT_PATH = '/opt/github/runners';
const EXTENSION_INFO = {
    name: 'GH Runner',
    author: 'MrTrilB',
    documentationUrl: 'https://github.com/MrTrilB/GH-Runner'
};
function createErrorResponse(error) {
    if (error instanceof Error) {
        return {
            error: error.message || 'An unexpected error occurred.',
            details: error.stack ?? undefined
        };
    }
    if (error && typeof error === 'object') {
        const errObj = error;
        const message = String(errObj.error ?? errObj.message ?? JSON.stringify(errObj));
        const detailsParts = [];
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
function sendError(res, error, statusCode = 500) {
    res.status(statusCode).json(createErrorResponse(error));
}
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
async function enrichRunner(runner) {
    const status = await (0, docker_1.getHostRunnerStatus)(runner.hostContainerName, runner.runnerPath);
    const version = await (0, docker_1.getRunnerVersion)(runner.hostContainerName, runner.runnerPath);
    return {
        ...runner,
        status: status.status,
        dockerRawStatus: status.raw,
        runnerVersion: version || undefined,
        usage: null
    };
}
app.get('/api/runners', async (_req, res) => {
    try {
        const runners = await (0, runnerStorage_1.loadRunners)();
        const enriched = await Promise.all(runners.map(enrichRunner));
        res.json(enriched);
    }
    catch (error) {
        sendError(res, error);
    }
});
app.get('/api/host-health', async (_req, res) => {
    try {
        const health = await (0, docker_1.getRunnerHostHealth)(DEFAULT_HOST_CONTAINER_NAME);
        res.json(health);
    }
    catch (error) {
        sendError(res, error);
    }
});
app.get('/api/extension-info', async (_req, res) => {
    try {
        const tokens = await (0, githubTokenStorage_1.loadGithubTokens)();
        let githubApiConnection = {
            status: 'warning',
            message: 'No GitHub token configured.'
        };
        try {
            await (0, logger_1.logIfEnabled)('githubApi', 'Checking GitHub API connectivity');
            const response = await fetch('https://api.github.com', {
                headers: {
                    Accept: 'application/vnd.github+json'
                }
            });
            githubApiConnection = response.ok
                ? { status: 'up', message: 'GitHub API is reachable.' }
                : { status: 'down', message: `GitHub API returned ${response.status}.` };
            await (0, logger_1.logIfEnabled)('githubApi', `GitHub API status: ${githubApiConnection.status}`);
        }
        catch (err) {
            githubApiConnection = { status: 'down', message: 'Unable to reach GitHub API.' };
            await (0, logger_1.logIfEnabled)('githubApi', `GitHub API connectivity check failed: ${err}`);
        }
        const hostHealth = await (0, docker_1.getRunnerHostHealth)(DEFAULT_HOST_CONTAINER_NAME);
        const serviceContainerUp = hostHealth.exists && hostHealth.status.status !== 'off';
        const runnerContainerUp = hostHealth.exists && hostHealth.runnerInstalled;
        const dataVolumeExists = await (0, docker_1.getVolumeExists)('gh-runner-manager-data');
        const runnerVolumeExists = await (0, docker_1.getVolumeExists)('gh-runner-manager-runners');
        const runnerConfigs = await (0, runnerStorage_1.loadRunners)();
        const loggingSettings = await (0, settingsStorage_1.loadSettings)();
        const runnerStatuses = await Promise.all(runnerConfigs.map(async (runner) => (await (0, docker_1.getHostRunnerStatus)(runner.hostContainerName, runner.runnerPath)).status));
        const activeRunnerCount = runnerStatuses.filter((status) => status === 'on').length;
        const runnerContainerStatus = runnerConfigs.length === 0 ? 'none' : activeRunnerCount > 0 ? 'active' : 'inactive';
        const runnerBaseVersion = await (0, docker_1.getHostRunnerBaseVersion)(DEFAULT_HOST_CONTAINER_NAME);
        const runnerVersions = await Promise.all(runnerConfigs.map(async (runner) => ({
            id: runner.id,
            version: await (0, docker_1.getRunnerVersion)(runner.hostContainerName, runner.runnerPath)
        })));
        const runnerVersionsOutOfDate = runnerVersions.filter((runner) => runner.version && runner.version !== runnerBaseVersion).length;
        const runnerVersionMismatch = runnerVersionsOutOfDate > 0;
        res.json({
            extensionName: EXTENSION_INFO.name,
            extensionVersion: (0, docker_1.getExtensionVersion)(),
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
    }
    catch (error) {
        sendError(res, error);
    }
});
app.get('/api/github-tokens', async (_req, res) => {
    try {
        const tokens = await (0, githubTokenStorage_1.loadGithubTokens)();
        const responseTokens = tokens.map(({ token, ...rest }) => rest);
        res.json(responseTokens);
    }
    catch (error) {
        await (0, logger_1.logIfEnabled)('ui', `Failed to load GitHub tokens: ${error}`);
        sendError(res, error);
    }
});
app.get('/api/settings', async (_req, res) => {
    try {
        const settings = await (0, settingsStorage_1.loadSettings)();
        res.json(settings);
    }
    catch (error) {
        await (0, logger_1.logIfEnabled)('ui', `Failed to load settings: ${error}`);
        sendError(res, error);
    }
});
app.post('/api/settings', async (req, res) => {
    try {
        const payload = req.body;
        const settings = {
            uiLoggingEnabled: Boolean(payload.uiLoggingEnabled),
            runnerLoggingEnabled: Boolean(payload.runnerLoggingEnabled),
            githubApiLoggingEnabled: Boolean(payload.githubApiLoggingEnabled),
            startRunnersOnStartup: Boolean(payload.startRunnersOnStartup)
        };
        await (0, settingsStorage_1.saveSettings)(settings);
        await (0, logger_1.logIfEnabled)('ui', `Saved extension settings: ${JSON.stringify(settings)}`);
        res.json({ success: true, settings });
    }
    catch (error) {
        await (0, logger_1.logIfEnabled)('ui', `Failed to save settings: ${error}`);
        sendError(res, error);
    }
});
app.post('/api/github-tokens', async (req, res) => {
    try {
        const payload = req.body;
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
        const user = await response.json();
        const tokenConfig = {
            id: payload.id || (0, crypto_1.randomUUID)(),
            name: payload.name,
            token: payload.token,
            login: user.login,
            type: user.type,
            createdAt: new Date().toISOString()
        };
        await (0, githubTokenStorage_1.saveGithubToken)(tokenConfig);
        await (0, logger_1.logIfEnabled)('githubApi', `Saved GitHub token ${tokenConfig.name} for ${tokenConfig.login}`);
        const responseToken = {
            id: tokenConfig.id,
            name: tokenConfig.name,
            login: tokenConfig.login,
            type: tokenConfig.type,
            createdAt: tokenConfig.createdAt
        };
        res.json({ success: true, token: responseToken });
    }
    catch (error) {
        await (0, logger_1.logIfEnabled)('githubApi', `Failed to save GitHub token: ${error}`);
        sendError(res, error);
    }
});
app.delete('/api/github-tokens/:id', async (req, res) => {
    try {
        await (0, githubTokenStorage_1.deleteGithubToken)(req.params.id);
        await (0, logger_1.logIfEnabled)('ui', `Deleted GitHub token ${req.params.id}`);
        res.json({ success: true });
    }
    catch (error) {
        await (0, logStorage_1.appendLogEntry)(`Failed to delete GitHub token ${req.params.id}: ${error}`);
        sendError(res, error);
    }
});
const fetchRegistrationToken = async (token, owner, repo, isOrg) => {
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
    const json = await response.json();
    return json.token;
};
const fetchRunnerGroups = async (token, owner, repo, isOrg) => {
    const url = isOrg
        ? `https://api.github.com/orgs/${encodeURIComponent(owner)}/actions/runner-groups`
        : `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo || '')}/actions/runner-groups`;
    await (0, logger_1.logIfEnabled)('githubApi', `Fetching runner groups for ${owner} ${repo || ''} org=${isOrg}`);
    const response = await fetch(url, {
        headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `token ${token}`
        }
    });
    if (!response.ok) {
        await (0, logger_1.logIfEnabled)('githubApi', `Failed to fetch runner groups for ${owner} ${repo || ''}: ${response.status}`);
        if (response.status === 404 || response.status === 403) {
            return [];
        }
        throw new Error(`Unable to fetch runner groups (${response.status})`);
    }
    const json = await response.json();
    return json.runner_groups.map((group) => ({ id: group.id, name: group.name }));
};
app.get('/api/github-tokens/:id/repos', async (req, res) => {
    try {
        const token = await (0, githubTokenStorage_1.getGithubTokenById)(req.params.id);
        if (!token) {
            return res.status(404).json({ error: 'Token not found.' });
        }
        await (0, logger_1.logIfEnabled)('githubApi', `Fetching repos for token ${token.id}`);
        const response = await fetch('https://api.github.com/user/repos?per_page=100', {
            headers: {
                Accept: 'application/vnd.github+json',
                Authorization: `token ${token.token}`
            }
        });
        if (!response.ok) {
            await (0, logger_1.logIfEnabled)('githubApi', `Failed to fetch repos for token ${token.id}: ${response.status}`);
            return res.status(response.status).json({ error: 'Unable to fetch repositories for this token.' });
        }
        const repos = await response.json();
        res.json(repos.map((repo) => ({
            id: repo.id,
            name: repo.name,
            full_name: repo.full_name,
            private: repo.private,
            owner: repo.owner.login
        })));
    }
    catch (error) {
        sendError(res, error);
    }
});
app.get('/api/github-tokens/:id/repos/search', async (req, res) => {
    try {
        const token = await (0, githubTokenStorage_1.getGithubTokenById)(req.params.id);
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
        const searchGithubRepos = async (qualifier) => {
            const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(`${q} ${qualifier}`)}&per_page=50`;
            await (0, logger_1.logIfEnabled)('githubApi', `Searching repos for ${owner}, q=${q}, qualifier=${qualifier}`);
            const response = await fetch(url, {
                headers: {
                    Accept: 'application/vnd.github+json',
                    Authorization: `token ${token.token}`
                }
            });
            if (!response.ok) {
                await (0, logger_1.logIfEnabled)('githubApi', `Failed to search repos for token ${token.id}: ${response.status}`);
                return [];
            }
            const json = await response.json();
            return json.items;
        };
        let repos = [];
        if (isOrg) {
            repos = await searchGithubRepos(`org:${owner}`);
            if (repos.length === 0) {
                repos = await searchGithubRepos(`user:${owner}`);
            }
        }
        else {
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
    }
    catch (error) {
        sendError(res, error);
    }
});
app.get('/api/github-tokens/:id/runner-groups', async (req, res) => {
    try {
        const token = await (0, githubTokenStorage_1.getGithubTokenById)(req.params.id);
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
        }
        catch (err) {
            sendError(res, err);
        }
    }
    catch (error) {
        sendError(res, error);
    }
});
app.post('/api/github-tokens/:id/registration-token', async (req, res) => {
    try {
        const token = await (0, githubTokenStorage_1.getGithubTokenById)(req.params.id);
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
        await (0, logger_1.logIfEnabled)('githubApi', `Obtained GitHub runner registration token for ${owner} ${repo || ''}`);
        res.json({ token: registrationToken });
    }
    catch (error) {
        await (0, logger_1.logIfEnabled)('githubApi', `Failed to obtain registration token for ${req.body?.owner || '(unknown)'} ${req.body?.repo || ''}: ${error}`);
        sendError(res, error);
    }
});
app.post('/api/runners', async (req, res) => {
    try {
        const payload = req.body;
        if (!payload.runnerName || !payload.githubUrl || !payload.owner || typeof payload.isOrg !== 'boolean' || !payload.labels) {
            return res.status(400).json({ error: 'Missing required runner fields.' });
        }
        if (!payload.isOrg && !payload.repo) {
            return res.status(400).json({ error: 'Repository is required when registering a repository-scoped runner.' });
        }
        if (!payload.registrationToken && !payload.selectedTokenId) {
            return res.status(400).json({ error: 'Registration token is required to create a runner, or select a saved GitHub token to generate one.' });
        }
        const id = (0, crypto_1.randomUUID)();
        const safeName = payload.runnerName.toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
        const runnerPath = `${DEFAULT_RUNNER_ROOT_PATH.replace(/\/$/, '')}/${safeName}`;
        const runner = {
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
            const githubToken = await (0, githubTokenStorage_1.getGithubTokenById)(payload.selectedTokenId);
            if (!githubToken) {
                return res.status(400).json({ error: 'Selected GitHub token not found.' });
            }
            try {
                registrationToken = await fetchRegistrationToken(githubToken.token, runner.owner, runner.repo || null, runner.isOrg);
            }
            catch (err) {
                return sendError(res, err);
            }
        }
        try {
            await (0, docker_1.createRunnerInHostContainer)(runner.hostContainerName, runner.runnerPath, runner.githubUrl, runner.owner, runner.repo, runner.isOrg, registrationToken, runner.runnerName, runner.labels, runner.runnerGroup);
            await (0, runnerStorage_1.saveRunner)(runner);
            await (0, logger_1.logIfEnabled)('runner', `Created runner ${runner.runnerName} at ${runner.runnerPath}`);
            res.json({ success: true, runner });
        }
        catch (error) {
            await (0, logger_1.logIfEnabled)('runner', `Failed to create runner ${runner.runnerName}: ${error}`);
            console.error('Runner creation failed:', error);
            try {
                await (0, docker_1.removeHostRunner)(runner.hostContainerName, runner.runnerPath);
            }
            catch (cleanupError) {
                console.error('Runner cleanup failed:', cleanupError);
            }
            sendError(res, error);
        }
    }
    catch (error) {
        sendError(res, error);
    }
});
app.put('/api/runners/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const payload = req.body;
        const runners = await (0, runnerStorage_1.loadRunners)();
        const existing = runners.find((r) => r.id === id);
        if (!existing) {
            return res.status(404).json({ error: 'Runner not found.' });
        }
        const updated = {
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
        await (0, runnerStorage_1.saveRunner)(updated);
        await (0, logger_1.logIfEnabled)('ui', `Updated runner ${updated.runnerName} (${updated.id})`);
        res.json({ success: true, runner: updated });
    }
    catch (error) {
        await (0, logger_1.logIfEnabled)('ui', `Failed to update runner ${req.params.id}: ${error}`);
        sendError(res, error);
    }
});
app.delete('/api/runners/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const runners = await (0, runnerStorage_1.loadRunners)();
        const existing = runners.find((r) => r.id === id);
        if (!existing) {
            return res.status(404).json({ error: 'Runner not found.' });
        }
        try {
            await (0, docker_1.removeHostRunner)(existing.hostContainerName, existing.runnerPath);
        }
        catch {
            // ignore cleanup errors
        }
        await (0, runnerStorage_1.deleteRunner)(id);
        await (0, logger_1.logIfEnabled)('ui', `Deleted runner ${existing.runnerName} (${existing.id})`);
        res.json({ success: true });
    }
    catch (error) {
        sendError(res, error);
    }
});
app.post('/api/runners/all/:action', async (req, res) => {
    try {
        const action = req.params.action;
        const runners = await (0, runnerStorage_1.loadRunners)();
        if (runners.length === 0) {
            return res.status(200).json({ success: true, results: [] });
        }
        await (0, docker_1.ensureRunnerHostContainer)(DEFAULT_HOST_CONTAINER_NAME);
        const results = await Promise.all(runners.map(async (runner) => {
            try {
                switch (action) {
                    case 'start':
                        await (0, docker_1.startHostRunner)(runner.hostContainerName, runner.runnerPath);
                        await (0, logger_1.logIfEnabled)('runner', `Started runner ${runner.runnerName} (${runner.id})`);
                        break;
                    case 'stop':
                        await (0, docker_1.stopHostRunner)(runner.hostContainerName, runner.runnerPath);
                        await (0, logger_1.logIfEnabled)('runner', `Stopped runner ${runner.runnerName} (${runner.id})`);
                        break;
                    case 'restart':
                        await (0, docker_1.restartHostRunner)(runner.hostContainerName, runner.runnerPath);
                        await (0, logger_1.logIfEnabled)('runner', `Restarted runner ${runner.runnerName} (${runner.id})`);
                        break;
                    default:
                        throw new Error('Invalid action.');
                }
                return {
                    id: runner.id,
                    runnerName: runner.runnerName,
                    success: true
                };
            }
            catch (error) {
                await (0, logger_1.logIfEnabled)('runner', `Failed ${action} runner ${runner.runnerName} (${runner.id}): ${error}`);
                return {
                    id: runner.id,
                    runnerName: runner.runnerName,
                    success: false,
                    error: String(error)
                };
            }
        }));
        res.json({ success: true, results });
    }
    catch (error) {
        sendError(res, error);
    }
});
app.post('/api/runners/:id/:action', async (req, res) => {
    try {
        const id = req.params.id;
        const action = req.params.action;
        const runners = await (0, runnerStorage_1.loadRunners)();
        const runner = runners.find((r) => r.id === id);
        if (!runner) {
            return res.status(404).json({ error: 'Runner not found.' });
        }
        await (0, docker_1.ensureRunnerHostContainer)(runner.hostContainerName);
        switch (action) {
            case 'start':
                await (0, docker_1.startHostRunner)(runner.hostContainerName, runner.runnerPath);
                await (0, logger_1.logIfEnabled)('runner', `Started runner ${runner.runnerName} (${runner.id})`);
                break;
            case 'stop':
                await (0, docker_1.stopHostRunner)(runner.hostContainerName, runner.runnerPath);
                await (0, logger_1.logIfEnabled)('runner', `Stopped runner ${runner.runnerName} (${runner.id})`);
                break;
            case 'restart':
                await (0, docker_1.restartHostRunner)(runner.hostContainerName, runner.runnerPath);
                await (0, logger_1.logIfEnabled)('runner', `Restarted runner ${runner.runnerName} (${runner.id})`);
                break;
            default:
                return res.status(400).json({ error: 'Invalid action.' });
        }
        res.json({ success: true, runnerName: runner.runnerName });
    }
    catch (error) {
        sendError(res, error);
    }
});
app.post('/api/host-refresh', async (_req, res) => {
    try {
        await (0, docker_1.refreshRunnerHostContainer)(DEFAULT_HOST_CONTAINER_NAME);
        await (0, logger_1.logIfEnabled)('ui', 'Runner host container refreshed');
        res.json({ success: true });
    }
    catch (error) {
        await (0, logger_1.logIfEnabled)('ui', `Failed to refresh runner host container: ${error}`);
        sendError(res, error);
    }
});
app.post('/api/clear-volume', async (req, res) => {
    try {
        const name = String(req.body.name || '');
        if (!name) {
            return res.status(400).json({ error: 'Volume name is required.' });
        }
        await (0, docker_1.removeVolume)(name);
        await (0, logger_1.logIfEnabled)('ui', `Cleared volume ${name}`);
        res.json({ success: true });
    }
    catch (error) {
        await (0, logger_1.logIfEnabled)('ui', `Failed to clear volume ${String(req.body?.name)}: ${error}`);
        sendError(res, error);
    }
});
app.get('/api/logs', async (_req, res) => {
    try {
        const logs = await (0, logStorage_1.readLogEntries)();
        res.json({ logs });
    }
    catch (error) {
        await (0, logStorage_1.appendLogEntry)(`Failed to read logs: ${error}`);
        sendError(res, error);
    }
});
app.post('/api/logs/clear', async (_req, res) => {
    try {
        await (0, logStorage_1.clearLogEntries)();
        await (0, logStorage_1.appendLogEntry)('Extension logs cleared');
        res.json({ success: true });
    }
    catch (error) {
        await (0, logStorage_1.appendLogEntry)(`Failed to clear logs: ${error}`);
        sendError(res, error);
    }
});
const publicPath = (0, path_1.join)(__dirname, '..', 'ui');
app.use(express_1.default.static(publicPath));
app.get('*', (_req, res) => {
    res.sendFile((0, path_1.join)(publicPath, 'index.html'));
});
const socketPath = process.argv.includes('--socket')
    ? process.argv[process.argv.indexOf('--socket') + 1]
    : '/run/guest-services/backend.sock';
if ((0, fs_1.existsSync)(socketPath)) {
    (0, fs_1.rmSync)(socketPath);
}
async function startSavedRunnersOnStartup() {
    try {
        const settings = await (0, settingsStorage_1.loadSettings)();
        if (!settings.startRunnersOnStartup) {
            return;
        }
        const runners = await (0, runnerStorage_1.loadRunners)();
        if (runners.length === 0) {
            return;
        }
        await (0, docker_1.ensureRunnerHostContainer)(DEFAULT_HOST_CONTAINER_NAME);
        await Promise.all(runners.filter((runner) => runner.startOnStartup).map(async (runner) => {
            try {
                const status = await (0, docker_1.getHostRunnerStatus)(runner.hostContainerName, runner.runnerPath);
                if (status.status !== 'on') {
                    await (0, docker_1.startHostRunner)(runner.hostContainerName, runner.runnerPath);
                    await (0, logger_1.logIfEnabled)('runner', `Auto-started runner ${runner.runnerName} (${runner.id}) on startup`);
                }
            }
            catch (error) {
                await (0, logger_1.logIfEnabled)('runner', `Failed to auto-start runner ${runner.runnerName} (${runner.id}): ${error}`);
            }
        }));
    }
    catch (error) {
        await (0, logger_1.logIfEnabled)('runner', `Auto-start runner startup process failed: ${error}`);
    }
}
async function startServer() {
    app.listen(socketPath, () => {
        console.log(`GitHub Runner Manager listening on socket ${socketPath}`);
    });
    try {
        await (0, docker_1.ensureRunnerHostContainer)(DEFAULT_HOST_CONTAINER_NAME);
        await startSavedRunnersOnStartup();
    }
    catch (error) {
        console.error('Runner host container initialization failed:', error);
    }
}
startServer().catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
});
