"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runDocker = runDocker;
exports.containerExists = containerExists;
exports.getContainerStatus = getContainerStatus;
exports.startContainer = startContainer;
exports.ensureRunnerHostContainer = ensureRunnerHostContainer;
exports.getRunnerHostHealth = getRunnerHostHealth;
exports.dockerExec = dockerExec;
exports.getHostRunnerStatus = getHostRunnerStatus;
exports.createRunnerInHostContainer = createRunnerInHostContainer;
exports.startHostRunner = startHostRunner;
exports.stopHostRunner = stopHostRunner;
exports.restartHostRunner = restartHostRunner;
exports.removeHostRunner = removeHostRunner;
const child_process_1 = require("child_process");
const util_1 = require("util");
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
async function runDocker(args) {
    const { stdout } = await execFileAsync('docker', args, { windowsHide: true, timeout: 120000 });
    return String(stdout).trim();
}
async function containerExists(containerName) {
    const raw = await runDocker(['ps', '-a', '--filter', `name=^/${containerName}$`, '--format', '{{.Names}}']);
    return raw.trim() === containerName;
}
async function getContainerStatus(containerName) {
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
async function startContainer(containerName) {
    await runDocker(['start', containerName]);
}
async function bootstrapHostContainer(containerName) {
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
async function ensureRunnerHostContainer(containerName) {
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
async function getRunnerHostHealth(containerName) {
    const exists = await containerExists(containerName);
    const status = exists ? await getContainerStatus(containerName) : { status: 'off', raw: '' };
    const runnerInstalled = exists
        ? Boolean((await dockerExec(containerName, ['sh', '-c', 'test -f /opt/github/runner/config.sh && echo OK || true'])).trim())
        : false;
    return { exists, status, runnerInstalled };
}
async function dockerExec(containerName, args) {
    return await runDocker(['exec', containerName, ...args]);
}
async function getHostRunnerStatus(hostContainer, runnerPath) {
    try {
        const raw = await dockerExec(hostContainer, ['sh', '-c', `ps -ef | grep "[r]un.sh" | grep '${runnerPath}' || true`]);
        if (!raw) {
            return { status: 'off', raw: '' };
        }
        return { status: 'on', raw };
    }
    catch {
        return { status: 'off', raw: '' };
    }
}
async function createRunnerInHostContainer(hostContainer, runnerPath, githubUrl, owner, repo, isOrg, token, runnerName, labels) {
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
async function startHostRunner(hostContainer, runnerPath) {
    await dockerExec(hostContainer, ['sh', '-c', `cd '${runnerPath}' && nohup ./run.sh >/dev/null 2>&1 &`]);
}
async function stopHostRunner(hostContainer, runnerPath) {
    await dockerExec(hostContainer, ['sh', '-c', `ps -ef | grep "[r]un.sh" | grep '${runnerPath}' | awk '{print $2}' | xargs -r kill || true`]);
}
async function restartHostRunner(hostContainer, runnerPath) {
    await stopHostRunner(hostContainer, runnerPath);
    await startHostRunner(hostContainer, runnerPath);
}
async function removeHostRunner(hostContainer, runnerPath) {
    await stopHostRunner(hostContainer, runnerPath);
    await dockerExec(hostContainer, ['sh', '-c', `rm -rf '${runnerPath}' || true`]);
}
