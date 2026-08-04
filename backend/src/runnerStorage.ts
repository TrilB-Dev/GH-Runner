import { promises as fs } from 'fs';
import { join } from 'path';

export interface RunnerConfig {
  id: string;
  runnerName: string;
  githubUrl: string;
  owner: string;
  repo: string;
  isOrg: boolean;
  tokenName?: string;
  runnerGroup?: string;
  labels: string[];
  startOnStartup: boolean;
  hostContainerName: string;
  runnerRootPath: string;
  runnerPath: string;
  createdAt: string;
}

const storagePath = join(__dirname, 'data', 'runners.json');

export async function loadRunners(): Promise<RunnerConfig[]> {
  try {
    const contents = await fs.readFile(storagePath, 'utf8');
    return JSON.parse(contents) as RunnerConfig[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      await saveRunners([]);
      return [];
    }
    throw error;
  }
}

export async function saveRunners(runners: RunnerConfig[]) {
  await fs.mkdir(join(__dirname, 'data'), { recursive: true });
  await fs.writeFile(storagePath, JSON.stringify(runners, null, 2), 'utf8');
}

export async function saveRunner(config: RunnerConfig) {
  const runners = await loadRunners();
  const existing = runners.find((item) => item.id === config.id);
  if (existing) {
    const updated = runners.map((item) => (item.id === config.id ? config : item));
    await saveRunners(updated);
    return;
  }

  runners.push(config);
  await saveRunners(runners);
}

export async function deleteRunner(id: string) {
  const runners = await loadRunners();
  const updated = runners.filter((item) => item.id !== id);
  await saveRunners(updated);
}
