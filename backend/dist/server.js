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
app.post('/api/runners', async (req, res) => {
    try {
        const payload = req.body;
        if (!payload.runnerName || !payload.githubUrl || !payload.owner || typeof payload.isOrg !== 'boolean' || !payload.labels || !payload.hostContainerName || !payload.runnerRootPath) {
            return res.status(400).json({ error: 'Missing required runner fields.' });
        }
        if (!payload.registrationToken) {
            return res.status(400).json({ error: 'Registration token is required to create a runner.' });
        }
        const id = (0, crypto_1.randomUUID)();
        const safeName = payload.runnerName.toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
        const runnerPath = `${payload.runnerRootPath.replace(/\/$/, '')}/${safeName}`;
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
            hostContainerName: payload.hostContainerName,
            runnerRootPath: payload.runnerRootPath,
            runnerPath,
            createdAt: new Date().toISOString()
        };
        await (0, runnerStorage_1.saveRunner)(runner);
        await (0, docker_1.createRunnerInHostContainer)(runner.hostContainerName, runner.runnerPath, runner.githubUrl, runner.owner, runner.repo, runner.isOrg, payload.registrationToken, runner.runnerName, runner.labels);
        res.json({ success: true, runner });
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
            hostContainerName: payload.hostContainerName ?? existing.hostContainerName,
            runnerRootPath: payload.runnerRootPath ?? existing.runnerRootPath,
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
app.post('/api/runners/:id/:action', async (req, res) => {
    try {
        const id = req.params.id;
        const action = req.params.action;
        const runners = await (0, runnerStorage_1.loadRunners)();
        const runner = runners.find((r) => r.id === id);
        if (!runner) {
            return res.status(404).json({ error: 'Runner not found.' });
        }
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
app.listen(socketPath, () => {
    console.log(`GitHub Runner Manager listening on socket ${socketPath}`);
});
