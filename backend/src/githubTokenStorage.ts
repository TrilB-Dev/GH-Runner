import { promises as fs } from 'fs';
import { join } from 'path';

export interface GithubTokenConfig {
  id: string;
  name: string;
  token: string;
  login: string;
  type: string;
  createdAt: string;
}

const storagePath = join(__dirname, 'data', 'github-tokens.json');

export async function loadGithubTokens(): Promise<GithubTokenConfig[]> {
  try {
    const contents = await fs.readFile(storagePath, 'utf8');
    return JSON.parse(contents) as GithubTokenConfig[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      await saveGithubTokens([]);
      return [];
    }
    throw error;
  }
}

export async function saveGithubTokens(tokens: GithubTokenConfig[]) {
  await fs.mkdir(join(__dirname, 'data'), { recursive: true });
  await fs.writeFile(storagePath, JSON.stringify(tokens, null, 2), 'utf8');
}

export async function saveGithubToken(tokenConfig: GithubTokenConfig) {
  const tokens = await loadGithubTokens();
  const existingIndex = tokens.findIndex((item) => item.id === tokenConfig.id);
  if (existingIndex >= 0) {
    tokens[existingIndex] = tokenConfig;
  } else {
    tokens.push(tokenConfig);
  }
  await saveGithubTokens(tokens);
}

export async function deleteGithubToken(id: string) {
  const tokens = await loadGithubTokens();
  const updated = tokens.filter((item) => item.id !== id);
  await saveGithubTokens(updated);
}

export async function getGithubTokenById(id: string): Promise<GithubTokenConfig | undefined> {
  const tokens = await loadGithubTokens();
  return tokens.find((item) => item.id === id);
}
