import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface DockerStatus {
  status: 'on' | 'off' | 'paused';
  raw: string;
}

export async function runDocker(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('docker', args, { windowsHide: true, timeout: 120000 });
  return String(stdout).trim();
}

export async function containerExists(containerName: string): Promise<boolean> {
  const raw = await runDocker(['ps', '-a', '--filter', `name=^/${containerName}$`, '--format', '{{.Names}}']);
  return raw.trim() === containerName;
}

export async function getContainerStatus(containerName: string): Promise<DockerStatus> {
  const raw = await runDocker(['ps', '-a', '--filter', `name=^/${containerName}$`, '--format', '{{.Status}}']);
  if (!raw) {
    return { status: 'off', raw: '' };
  }

  const normalized = raw.toLowerCase();
  if (normalized.includes('paused')) {
    return { status: 'paused', raw };
  }

  if (normalized.startsWith('up')) {
    return { status: 'on', raw };
  }

  return { status: 'off', raw };
}

export async function startContainer(containerName: string) {
  await runDocker(['start', containerName]);
}

async function bootstrapHostContainer(containerName: string) {
  const setupScript = [
    'apt-get update',
    'apt-get install -y curl tar ca-certificates',
    'mkdir -p /opt/github/runner',
    'cd /opt/github/runner',
    'curl -L -o actions-runner-linux-x64-2.336.0.tar.gz https://github.com/actions/runner/releases/download/v2.336.0/actions-runner-linux-x64-2.336.0.tar.gz',
    'tar xzf actions-runner-linux-x64-2.336.0.tar.gz',
    'rm -f actions-runner-linux-x64-2.336.0.tar.gz',
    'chmod +x config.sh run.sh bin/installdependencies.sh',
    './bin/installdependencies.sh'
  ].join(' && ');

  await runDocker([
    'run',
    '-d',
    '--name',
    containerName,
    '--hostname',
    containerName,
    'ubuntu:24.04',
    'bash',
    '-lc',
    `${setupScript} && tail -f /dev/null`
  ]);
}

export async function ensureRunnerHostContainer(containerName: string) {
  if (!(await containerExists(containerName))) {
    await bootstrapHostContainer(containerName);
    return;
  }

  const status = await getContainerStatus(containerName);
  if (status.status === 'off') {
    await startContainer(containerName);
  }

  const runnerExists = await dockerExec(containerName, ['sh', '-c', 'test -f /opt/github/runner/config.sh && echo OK || true']);
  if (!runnerExists.trim()) {
    await dockerExec(containerName, ['sh', '-c', 'apt-get update && apt-get install -y curl tar ca-certificates']);
    await dockerExec(containerName, ['sh', '-c', 'mkdir -p /opt/github/runner']);
    await dockerExec(containerName, ['sh', '-c', 'cd /opt/github/runner && curl -L -o actions-runner-linux-x64-2.336.0.tar.gz https://github.com/actions/runner/releases/download/v2.336.0/actions-runner-linux-x64-2.336.0.tar.gz && tar xzf actions-runner-linux-x64-2.336.0.tar.gz && rm -f actions-runner-linux-x64-2.336.0.tar.gz && chmod +x config.sh run.sh bin/installdependencies.sh && ./bin/installdependencies.sh']);
  }
}

export async function getRunnerHostHealth(containerName: string) {
  const exists = await containerExists(containerName);
  const status = exists ? await getContainerStatus(containerName) : { status: 'off' as const, raw: '' };
  const runnerInstalled = exists
    ? Boolean((await dockerExec(containerName, ['sh', '-c', 'test -f /opt/github/runner/config.sh && echo OK || true'])).trim())
    : false;
  return { exists, status, runnerInstalled };
}

export async function dockerExec(containerName: string, args: string[]): Promise<string> {
  return await runDocker(['exec', containerName, ...args]);
}

export async function getHostRunnerStatus(hostContainer: string, runnerPath: string): Promise<DockerStatus> {
  try {
    const raw = await dockerExec(hostContainer, ['sh', '-c', `ps -ef | grep "[r]un.sh" | grep '${runnerPath}' || true`]);
    if (!raw) {
      return { status: 'off', raw: '' };
    }
    return { status: 'on', raw };
  } catch {
    return { status: 'off', raw: '' };
  }
}

export async function createRunnerInHostContainer(
  hostContainer: string,
  runnerPath: string,
  githubUrl: string,
  owner: string,
  repo: string | null,
  isOrg: boolean,
  token: string,
  runnerName: string,
  labels: string[]
) {
  const repoUrl = isOrg
    ? `${githubUrl.replace(/\/$/, '')}/orgs/${owner}`
    : `${githubUrl.replace(/\/$/, '')}/${owner}/${repo}`;
  const workDir = `${runnerPath}/work`;
  const labelSet = labels.join(',');

  const setupCommand = [
    `mkdir -p '${runnerPath}'`,
    `mkdir -p '${workDir}'`,
    `cp -a /opt/github/runner/. '${runnerPath}/'`,
    `cd '${runnerPath}'`,
    `./config.sh --url '${repoUrl}' --token '${token}' --name '${runnerName}' --workdir '${workDir}' --labels '${labelSet}' --unattended --replace`
  ].join(' && ');

  await dockerExec(hostContainer, ['sh', '-c', setupCommand]);
}

export async function startHostRunner(hostContainer: string, runnerPath: string) {
  await dockerExec(hostContainer, ['sh', '-c', `cd '${runnerPath}' && nohup ./run.sh >/dev/null 2>&1 &`]);
}

export async function stopHostRunner(hostContainer: string, runnerPath: string) {
  await dockerExec(hostContainer, ['sh', '-c', `ps -ef | grep "[r]un.sh" | grep '${runnerPath}' | awk '{print $2}' | xargs -r kill || true`]);
}

export async function restartHostRunner(hostContainer: string, runnerPath: string) {
  await stopHostRunner(hostContainer, runnerPath);
  await startHostRunner(hostContainer, runnerPath);
}

export async function removeHostRunner(hostContainer: string, runnerPath: string) {
  await stopHostRunner(hostContainer, runnerPath);
  await dockerExec(hostContainer, ['sh', '-c', `rm -rf '${runnerPath}' || true`]);
}
