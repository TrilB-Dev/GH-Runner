"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runDocker = runDocker;
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
