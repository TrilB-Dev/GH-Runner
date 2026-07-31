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
const DEFAULT_HOST_CONTAINER_NAME = 'gh-runner-host';
const DEFAULT_RUNNER_ROOT_PATH = '/opt/github/runners';
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
async function enrichRunner(runner) {
    const status = await (0, docker_1.getHostRunnerStatus)(runner.hostContainerName, runner.runnerPath);
    return {
        ...runner,
        status: status.status,
        dockerRawStatus: status.raw,
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
        res.status(500).json({ error: String(error) });
    }
});
app.get('/api/host-health', async (_req, res) => {
    try {
        const health = await (0, docker_1.getRunnerHostHealth)(DEFAULT_HOST_CONTAINER_NAME);
        res.json(health);
    }
    catch (error) {
        res.status(500).json({ error: String(error) });
    }
});
app.get('/api/github-tokens', async (_req, res) => {
    try {
        const tokens = await (0, githubTokenStorage_1.loadGithubTokens)();
        const responseTokens = tokens.map(({ token, ...rest }) => rest);
        res.json(responseTokens);
    }
    catch (error) {
        res.status(500).json({ error: String(error) });
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
        res.status(500).json({ error: String(error) });
    }
});
app.delete('/api/github-tokens/:id', async (req, res) => {
    try {
        await (0, githubTokenStorage_1.deleteGithubToken)(req.params.id);
        res.json({ success: true });
    }
    catch (error) {
        res.status(500).json({ error: String(error) });
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
    const response = await fetch(url, {
        headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `token ${token}`
        }
    });
    if (!response.ok) {
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
        const response = await fetch('https://api.github.com/user/repos?per_page=100', {
            headers: {
                Accept: 'application/vnd.github+json',
                Authorization: `token ${token.token}`
            }
        });
        if (!response.ok) {
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
        res.status(500).json({ error: String(error) });
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
            res.status(500).json({ error: String(err) });
        }
    }
    catch (error) {
        res.status(500).json({ error: String(error) });
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
        res.json({ token: registrationToken });
    }
    catch (error) {
        res.status(500).json({ error: String(error) });
    }
});
app.post('/api/runners', async (req, res) => {
    try {
        const payload = req.body;
        if (!payload.runnerName || !payload.githubUrl || !payload.owner || typeof payload.isOrg !== 'boolean' || !payload.labels) {
            return res.status(400).json({ error: 'Missing required runner fields.' });
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
                return res.status(500).json({ error: String(err) });
            }
        }
        try {
            await (0, docker_1.createRunnerInHostContainer)(runner.hostContainerName, runner.runnerPath, runner.githubUrl, runner.owner, runner.repo, runner.isOrg, registrationToken, runner.runnerName, runner.labels, runner.runnerGroup);
            await (0, runnerStorage_1.saveRunner)(runner);
            res.json({ success: true, runner });
        }
        catch (error) {
            console.error('Runner creation failed:', error);
            try {
                await (0, docker_1.removeHostRunner)(runner.hostContainerName, runner.runnerPath);
            }
            catch (cleanupError) {
                console.error('Runner cleanup failed:', cleanupError);
            }
            res.status(500).json({ error: String(error) });
        }
    }
    catch (error) {
        res.status(500).json({ error: String(error) });
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
            hostContainerName: DEFAULT_HOST_CONTAINER_NAME,
            runnerRootPath: DEFAULT_RUNNER_ROOT_PATH,
            runnerPath: existing.runnerPath,
            createdAt: existing.createdAt
        };
        await (0, runnerStorage_1.saveRunner)(updated);
        res.json({ success: true, runner: updated });
    }
    catch (error) {
        res.status(500).json({ error: String(error) });
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
        res.json({ success: true });
    }
    catch (error) {
        res.status(500).json({ error: String(error) });
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
                        break;
                    case 'stop':
                        await (0, docker_1.stopHostRunner)(runner.hostContainerName, runner.runnerPath);
                        break;
                    case 'restart':
                        await (0, docker_1.restartHostRunner)(runner.hostContainerName, runner.runnerPath);
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
        res.status(500).json({ error: String(error) });
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
                break;
            case 'stop':
                await (0, docker_1.stopHostRunner)(runner.hostContainerName, runner.runnerPath);
                break;
            case 'restart':
                await (0, docker_1.restartHostRunner)(runner.hostContainerName, runner.runnerPath);
                break;
            default:
                return res.status(400).json({ error: 'Invalid action.' });
        }
        res.json({ success: true, runnerName: runner.runnerName });
    }
    catch (error) {
        res.status(500).json({ error: String(error) });
    }
});
app.post('/api/host-refresh', async (_req, res) => {
    try {
        await (0, docker_1.refreshRunnerHostContainer)(DEFAULT_HOST_CONTAINER_NAME);
        res.json({ success: true });
    }
    catch (error) {
        res.status(500).json({ error: String(error) });
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
async function startServer() {
    app.listen(socketPath, () => {
        console.log(`GitHub Runner Manager listening on socket ${socketPath}`);
    });
    try {
        await (0, docker_1.ensureRunnerHostContainer)(DEFAULT_HOST_CONTAINER_NAME);
    }
    catch (error) {
        console.error('Runner host container initialization failed:', error);
    }
}
startServer().catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
});
