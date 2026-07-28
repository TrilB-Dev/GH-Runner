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
