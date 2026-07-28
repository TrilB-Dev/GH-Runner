import express, { type Request, type Response } from 'express';
import cors from 'cors';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { loadRunners, saveRunner, deleteRunner } from './runnerStorage';
import type { RunnerConfig } from './runnerStorage';
import {
  createRunnerInHostContainer,
  ensureRunnerHostContainer,
  getRunnerHostHealth,
  getHostRunnerStatus,
  startHostRunner,
  stopHostRunner,
  restartHostRunner,
  removeHostRunner
} from './docker';

const DEFAULT_HOST_CONTAINER_NAME = 'gh-runner-host';
const DEFAULT_RUNNER_ROOT_PATH = '/opt/github';

const app = express();

app.use(cors());
app.use(express.json());

async function enrichRunner(runner: RunnerConfig) {
  const status = await getHostRunnerStatus(runner.hostContainerName, runner.runnerPath);
  return {
    ...runner,
    status: status.status,
    dockerRawStatus: status.raw,
    usage: null
  };
}

app.get('/api/runners', async (_req: Request, res: Response) => {
  try {
    const runners = await loadRunners();
    const enriched = await Promise.all(runners.map(enrichRunner));
    res.json(enriched);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.get('/api/host-health', async (_req: Request, res: Response) => {
  try {
    const health = await getRunnerHostHealth(DEFAULT_HOST_CONTAINER_NAME);
    res.json(health);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/runners', async (req: Request, res: Response) => {
  try {
    const payload = req.body as Partial<RunnerConfig> & { registrationToken?: string };
    if (!payload.runnerName || !payload.githubUrl || !payload.owner || typeof payload.isOrg !== 'boolean' || !payload.labels) {
      return res.status(400).json({ error: 'Missing required runner fields.' });
    }

    if (!payload.registrationToken) {
      return res.status(400).json({ error: 'Registration token is required to create a runner.' });
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
      hostContainerName: DEFAULT_HOST_CONTAINER_NAME,
      runnerRootPath: DEFAULT_RUNNER_ROOT_PATH,
      runnerPath,
      createdAt: new Date().toISOString()
    };

    await saveRunner(runner);
    await createRunnerInHostContainer(
      runner.hostContainerName,
      runner.runnerPath,
      runner.githubUrl,
      runner.owner,
      runner.repo,
      runner.isOrg,
      payload.registrationToken,
      runner.runnerName,
      runner.labels
    );

    res.json({ success: true, runner });
  } catch (error) {
    res.status(500).json({ error: String(error) });
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
      hostContainerName: DEFAULT_HOST_CONTAINER_NAME,
      runnerRootPath: DEFAULT_RUNNER_ROOT_PATH,
      runnerPath: existing.runnerPath,
      createdAt: existing.createdAt
    };

    await saveRunner(updated);
    res.json({ success: true, runner: updated });
  } catch (error) {
    res.status(500).json({ error: String(error) });
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
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/runners/:id/:action', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const action = req.params.action;
    const runners = await loadRunners();
    const runner = runners.find((r) => r.id === id);
    if (!runner) {
      return res.status(404).json({ error: 'Runner not found.' });
    }

    switch (action) {
      case 'start':
        await startHostRunner(runner.hostContainerName, runner.runnerPath);
        break;
      case 'stop':
        await stopHostRunner(runner.hostContainerName, runner.runnerPath);
        break;
      case 'restart':
        await restartHostRunner(runner.hostContainerName, runner.runnerPath);
        break;
      default:
        return res.status(400).json({ error: 'Invalid action.' });
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
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

async function startServer() {
  await ensureRunnerHostContainer(DEFAULT_HOST_CONTAINER_NAME);
  app.listen(socketPath, () => {
    console.log(`GitHub Runner Manager listening on socket ${socketPath}`);
  });
}

startServer().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
