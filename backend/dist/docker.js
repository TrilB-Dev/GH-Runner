"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runDocker = runDocker;
exports.getExtensionVersion = getExtensionVersion;
exports.containerExists = containerExists;
exports.getVolumeExists = getVolumeExists;
exports.ensureVolumeExists = ensureVolumeExists;
exports.clearVolumeContents = clearVolumeContents;
exports.getContainerStatus = getContainerStatus;
exports.startContainer = startContainer;
exports.ensureRunnerHostContainer = ensureRunnerHostContainer;
exports.getHostRunnerBaseVersion = getHostRunnerBaseVersion;
exports.getRunnerHostHealth = getRunnerHostHealth;
exports.dockerExec = dockerExec;
exports.getHostRunnerStatus = getHostRunnerStatus;
exports.getRunnerVersion = getRunnerVersion;
exports.createRunnerInHostContainer = createRunnerInHostContainer;
exports.startHostRunner = startHostRunner;
exports.stopHostRunner = stopHostRunner;
exports.restartHostRunner = restartHostRunner;
exports.removeHostRunner = removeHostRunner;
exports.refreshRunnerHostContainer = refreshRunnerHostContainer;
const child_process_1 = require("child_process");
const fs_1 = require("fs");
const path_1 = require("path");
const util_1 = require("util");
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
const HOST_RUNNER_VOLUME = 'gh-runner-manager-runners';
const HOST_RUNNER_USER = 'githubrunner';
const EXTENSION_VERSION = getExtensionVersion();
const EXTENSION_VERSION_FILE = '/opt/github/runners/.extension-version';
const ACTIONS_RUNNER_VERSION = '2.336.0';
const ACTIONS_RUNNER_URL = `https://github.com/actions/runner/releases/download/v${ACTIONS_RUNNER_VERSION}/actions-runner-linux-x64-${ACTIONS_RUNNER_VERSION}.tar.gz`;
const RUNNER_BASE_VERSION_FILE = '/opt/github/base/.actions-runner-version';
async function runDocker(args) {
    const { stdout } = await execFileAsync('docker', args, { windowsHide: true, timeout: 120000 });
    return String(stdout).trim();
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function quoteNestedShellArgument(value) {
    const escapedValue = value.replace(/'/g, `'"'"'`);
    return `'"'"'${escapedValue}'"'"'`;
}
function getExtensionVersion() {
    try {
        const metadataPath = (0, path_1.join)(__dirname, '..', '..', 'metadata.json');
        const raw = (0, fs_1.readFileSync)(metadataPath, 'utf8');
        const metadata = JSON.parse(raw);
        return metadata.version?.trim() || '0.0.1';
    }
    catch {
        return '0.0.1';
    }
}
async function containerExists(containerName) {
    const raw = await runDocker(['ps', '-a', '--filter', `name=^/${containerName}$`, '--format', '{{.Names}}']);
    return raw.trim() === containerName;
}
async function getVolumeExists(volumeName) {
    try {
        const raw = await runDocker(['volume', 'inspect', volumeName]);
        return Boolean(raw);
    }
    catch {
        return false;
    }
}
async function ensureVolumeExists(volumeName) {
    if (!(await getVolumeExists(volumeName))) {
        await runDocker(['volume', 'create', volumeName]);
    }
}
async function clearVolumeContents(volumeName) {
    await runDocker([
        'run',
        '--rm',
        '-v',
        `${volumeName}:/volume`,
        'debian:bookworm-slim',
        'sh',
        '-c',
        'find /volume -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +'
    ]);
}
async function getPersistedExtensionVersion(_containerName) {
    try {
        const raw = await runDocker([
            'run',
            '--rm',
            '-v',
            `${HOST_RUNNER_VOLUME}:/opt/github/runners`,
            'debian:bookworm-slim',
            'sh',
            '-c',
            `cat ${EXTENSION_VERSION_FILE} 2>/dev/null || true`
        ]);
        return raw.trim();
    }
    catch {
        return '';
    }
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
    await waitForContainerReady(containerName);
}
async function waitForContainerReady(containerName, timeoutMs = 180000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const status = await getContainerStatus(containerName);
        if (status.status === 'on') {
            const health = await isHostRunnerVolumeMounted(containerName);
            const bootstrapped = await isHostBootstrapReady(containerName);
            if (health && bootstrapped) {
                return;
            }
        }
        await sleep(1000);
    }
    throw new Error(`Timeout waiting for container ${containerName} to become ready`);
}
async function isHostBootstrapReady(containerName) {
    try {
        const result = await dockerExec(containerName, ['sh', '-c', `if [ -f /opt/github/base/config.sh ] && [ -f ${EXTENSION_VERSION_FILE} ]; then echo READY; fi`]);
        return result.trim() === 'READY';
    }
    catch {
        return false;
    }
}
async function bootstrapHostContainer(containerName) {
    const setupScript = [
        'apt-get update',
        'apt-get install -y curl jq build-essential libssl-dev libffi-dev python3 python3-venv python3-pip python3-dev git unzip php php-cli php-mbstring php-xml php-curl php-zip tar ca-certificates procps gnupg',
        'curl -fsSL https://deb.nodesource.com/setup_current.x | bash -',
        'apt-get install -y nodejs',
        'php -r "copy(\'https://getcomposer.org/installer\', \'composer-setup.php\');"',
        'php composer-setup.php --install-dir=/usr/local/bin --filename=composer',
        'php -r "unlink(\'composer-setup.php\');"',
        `groupadd -f ${HOST_RUNNER_USER}`,
        `id -u ${HOST_RUNNER_USER} >/dev/null 2>&1 || useradd -m -s /bin/sh -g ${HOST_RUNNER_USER} ${HOST_RUNNER_USER}`,
        'mkdir -p /opt/github/base',
        'mkdir -p /opt/github/runners',
        'cd /opt/github/base',
        `curl -L -o actions-runner-linux-x64-${ACTIONS_RUNNER_VERSION}.tar.gz ${ACTIONS_RUNNER_URL}`,
        `tar xzf actions-runner-linux-x64-${ACTIONS_RUNNER_VERSION}.tar.gz`,
        `rm -f actions-runner-linux-x64-${ACTIONS_RUNNER_VERSION}.tar.gz`,
        'chmod +x config.sh run.sh bin/installdependencies.sh',
        './bin/installdependencies.sh',
        `printf "%s" "${ACTIONS_RUNNER_VERSION}" > ${RUNNER_BASE_VERSION_FILE}`,
        `printf "%s" "${EXTENSION_VERSION}" > ${EXTENSION_VERSION_FILE}`,
        `chown -R ${HOST_RUNNER_USER}:${HOST_RUNNER_USER} /opt/github/base /opt/github/runners`
    ].join(' && ');
    await ensureVolumeExists(HOST_RUNNER_VOLUME);
    await runDocker([
        'run',
        '-d',
        '--name',
        containerName,
        '--hostname',
        containerName,
        '--label',
        'com.docker.compose.project=mrtrilb_gh-runner-desktop-extension',
        '--label',
        'com.docker.compose.service=gh-runner-host',
        '--label',
        'com.docker.compose.oneoff=False',
        '--label',
        'com.docker.desktop.extension=true',
        '--label',
        'com.docker.desktop.extension.name=GH Runner',
        '--label',
        'com.docker.desktop.extension.api.version=0.4.2',
        '--label',
        'org.opencontainers.image.title=GH Runner Host',
        '-v',
        `${HOST_RUNNER_VOLUME}:/opt/github/runners`,
        'debian:bookworm-slim',
        'bash',
        '-lc',
        `${setupScript} && tail -f /dev/null`
    ]);
}
async function isHostRunnerVolumeMounted(containerName) {
    try {
        const raw = await runDocker(['inspect', '-f', '{{json .Mounts}}', containerName]);
        const mounts = JSON.parse(raw);
        return mounts.some((mount) => mount.Destination === '/opt/github/runners' && mount.Name === HOST_RUNNER_VOLUME);
    }
    catch {
        return false;
    }
}
async function ensureRunnerHostContainer(containerName) {
    const needsBootstrap = !(await containerExists(containerName));
    const needsRecreate = await shouldRecreateHostContainer(containerName);
    if (needsBootstrap || needsRecreate) {
        if (!needsBootstrap) {
            console.warn(`Host container ${containerName} is stale or missing volume metadata. Recreating.`);
            await runDocker(['rm', '-f', containerName]);
        }
        await bootstrapHostContainer(containerName);
        await waitForContainerReady(containerName);
        return;
    }
    if (!(await isHostRunnerVolumeMounted(containerName))) {
        console.warn(`Host container ${containerName} exists without persistent runner volume. Recreating with ${HOST_RUNNER_VOLUME}.`);
        await runDocker(['rm', '-f', containerName]);
        await bootstrapHostContainer(containerName);
        await waitForContainerReady(containerName);
        return;
    }
    const status = await getContainerStatus(containerName);
    if (status.status === 'off') {
        await startContainer(containerName);
        await waitForContainerReady(containerName);
    }
    await dockerExec(containerName, ['sh', '-c', `groupadd -f ${HOST_RUNNER_USER} && id -u ${HOST_RUNNER_USER} >/dev/null 2>&1 || useradd -m -s /bin/sh -g ${HOST_RUNNER_USER} ${HOST_RUNNER_USER}`]);
    const runnerExists = await dockerExec(containerName, ['sh', '-c', 'test -f /opt/github/base/config.sh && echo OK || true']);
    const baseVersion = await getHostRunnerBaseVersion(containerName);
    if (!runnerExists.trim() || baseVersion !== ACTIONS_RUNNER_VERSION) {
        await ensureHostRunnerBase(containerName);
    }
}
async function shouldRecreateHostContainer(containerName) {
    if (!(await containerExists(containerName))) {
        return false;
    }
    const persistedVersion = await getPersistedExtensionVersion(containerName);
    if (!persistedVersion) {
        return true;
    }
    return persistedVersion !== EXTENSION_VERSION;
}
async function getHostRunnerBaseVersion(hostContainer) {
    try {
        const raw = await dockerExec(hostContainer, ['sh', '-c', `cat ${RUNNER_BASE_VERSION_FILE} 2>/dev/null || true`]);
        return raw.trim();
    }
    catch {
        return '';
    }
}
async function ensureHostRunnerBase(hostContainer) {
    await dockerExec(hostContainer, ['sh', '-c', 'apt-get update && apt-get install -y curl jq build-essential libssl-dev libffi-dev python3 python3-venv python3-pip python3-dev git unzip php php-cli php-mbstring php-xml php-curl php-zip tar ca-certificates procps gnupg']);
    await dockerExec(hostContainer, ['sh', '-c', 'curl -fsSL https://deb.nodesource.com/setup_current.x | bash -']);
    await dockerExec(hostContainer, ['sh', '-c', 'apt-get install -y nodejs']);
    await dockerExec(hostContainer, ['sh', '-c', 'php -r "copy(\'https://getcomposer.org/installer\', \'composer-setup.php\');"']);
    await dockerExec(hostContainer, ['sh', '-c', 'php composer-setup.php --install-dir=/usr/local/bin --filename=composer']);
    await dockerExec(hostContainer, ['sh', '-c', 'php -r "unlink(\'composer-setup.php\');"']);
    await dockerExec(hostContainer, ['sh', '-c', `groupadd -f ${HOST_RUNNER_USER} && id -u ${HOST_RUNNER_USER} >/dev/null 2>&1 || useradd -m -s /bin/sh -g ${HOST_RUNNER_USER} ${HOST_RUNNER_USER}`]);
    await dockerExec(hostContainer, ['sh', '-c', 'rm -rf /opt/github/base && mkdir -p /opt/github/base && mkdir -p /opt/github/runners']);
    await dockerExec(hostContainer, ['sh', '-c', `cd /opt/github/base && curl -L -o actions-runner-linux-x64-${ACTIONS_RUNNER_VERSION}.tar.gz ${ACTIONS_RUNNER_URL} && tar xzf actions-runner-linux-x64-${ACTIONS_RUNNER_VERSION}.tar.gz && rm -f actions-runner-linux-x64-${ACTIONS_RUNNER_VERSION}.tar.gz && chmod +x config.sh run.sh bin/installdependencies.sh && ./bin/installdependencies.sh && printf '%s' '${ACTIONS_RUNNER_VERSION}' > ${RUNNER_BASE_VERSION_FILE}`]);
    await dockerExec(hostContainer, ['sh', '-c', `chown -R ${HOST_RUNNER_USER}:${HOST_RUNNER_USER} /opt/github/base /opt/github/runners`]);
}
async function getRunnerHostHealth(containerName) {
    const exists = await containerExists(containerName);
    const status = exists ? await getContainerStatus(containerName) : { status: 'off', raw: '' };
    const hostBootstrapReady = exists
        ? Boolean((await dockerExec(containerName, ['sh', '-c', 'test -f /opt/github/base/config.sh && echo OK || true'])).trim())
        : false;
    return { exists, status, runnerInstalled: hostBootstrapReady };
}
async function dockerExec(containerName, args) {
    return await runDocker(['exec', containerName, ...args]);
}
async function findRunnerPids(hostContainer, runnerPath) {
    const escapedRunnerPath = runnerPath.replace(/'/g, "'\\''");
    const raw = await dockerExec(hostContainer, ['sh', '-c', `
    runner_path='${escapedRunnerPath}'
    pids=''

    # Detect run.sh processes in the runner directory
    for pid in $(ps -eo pid,comm | awk '$2 == "run.sh" {print $1}'); do
      if [ -d "/proc/$pid/cwd" ] && [ "$(readlink -f /proc/$pid/cwd)" = "$runner_path" ]; then
        pids="$pids $pid"
      elif [ -f "/proc/$pid/cmdline" ] && grep -q "$runner_path" "/proc/$pid/cmdline" 2>/dev/null; then
        pids="$pids $pid"
      fi
    done

    # Detect Runner.Listener processes in the runner directory
    for pid in $(ps -eo pid,cmd | grep '[R]unner.Listener run' | awk '{print $1}'); do
      if [ -d "/proc/$pid/cwd" ] && [ "$(readlink -f /proc/$pid/cwd)" = "$runner_path" ]; then
        pids="$pids $pid"
      elif [ -f "/proc/$pid/cmdline" ] && grep -q "$runner_path" "/proc/$pid/cmdline" 2>/dev/null; then
        pids="$pids $pid"
      fi
    done

    echo "$pids" | xargs -n1 | sort -u | tr '\n' ' '
  `]);
    return raw.trim();
}
async function getHostRunnerStatus(hostContainer, runnerPath) {
    try {
        const raw = await findRunnerPids(hostContainer, runnerPath);
        if (!raw) {
            return { status: 'off', raw: '' };
        }
        return { status: 'on', raw: raw.trim() };
    }
    catch (err) {
        console.warn(`Failed to determine runner status for ${runnerPath}:`, err);
        return { status: 'off', raw: '' };
    }
}
async function getRunnerVersion(hostContainer, runnerPath) {
    try {
        const raw = await dockerExec(hostContainer, ['sh', '-c', `cat '${runnerPath}/.actions-runner-version' 2>/dev/null || cat '${RUNNER_BASE_VERSION_FILE}' 2>/dev/null || true`]);
        return raw.trim();
    }
    catch {
        return '';
    }
}
async function createRunnerInHostContainer(hostContainer, runnerPath, githubUrl, owner, repo, isOrg, token, runnerName, labels, runnerGroup) {
    const repoUrl = isOrg
        ? `${githubUrl.replace(/\/$/, '')}/${owner}`
        : `${githubUrl.replace(/\/$/, '')}/${owner}/${repo}`;
    const workDir = `${runnerPath}/work`;
    const labelSet = labels.join(',');
    const groupArg = runnerGroup ? ` --runnergroup ${quoteNestedShellArgument(runnerGroup)}` : '';
    const setupCommand = [
        `mkdir -p '${runnerPath}'`,
        `mkdir -p '${workDir}'`,
        `cp -a /opt/github/base/. '${runnerPath}/'`,
        `cp /opt/github/base/.actions-runner-version '${runnerPath}/.actions-runner-version' 2>/dev/null || true`,
        `chown -R ${HOST_RUNNER_USER}:${HOST_RUNNER_USER} '${runnerPath}'`,
        `mkdir -p '${workDir}'`,
        `chown -R ${HOST_RUNNER_USER}:${HOST_RUNNER_USER} '${workDir}'`,
        `su ${HOST_RUNNER_USER} -s /bin/sh -c 'cd "${runnerPath}" && ./config.sh --url "${repoUrl}" --token "${token}" --name "${runnerName}" --work "${workDir}" --labels "${labelSet}" --unattended --replace${groupArg}'`
    ].join(' && ');
    await dockerExec(hostContainer, ['sh', '-c', setupCommand]);
}
async function startHostRunner(hostContainer, runnerPath) {
    await dockerExec(hostContainer, ['sh', '-c', `su ${HOST_RUNNER_USER} -s /bin/sh -c 'cd "${runnerPath}" && nohup ./run.sh >/dev/null 2>&1 &'`]);
}
async function waitForRunnerStopped(hostContainer, runnerPath, timeoutMs = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const status = await getHostRunnerStatus(hostContainer, runnerPath);
        if (status.status === 'off') {
            return;
        }
        await sleep(500);
    }
    throw new Error(`Timeout waiting for runner at ${runnerPath} to stop`);
}
async function stopHostRunner(hostContainer, runnerPath) {
    const pids = await findRunnerPids(hostContainer, runnerPath);
    if (!pids) {
        return;
    }
    await dockerExec(hostContainer, ['sh', '-c', `echo "${pids}" | xargs -r kill || true`]);
    await waitForRunnerStopped(hostContainer, runnerPath);
}
async function restartHostRunner(hostContainer, runnerPath) {
    await stopHostRunner(hostContainer, runnerPath);
    await startHostRunner(hostContainer, runnerPath);
}
async function removeHostRunner(hostContainer, runnerPath) {
    try {
        await stopHostRunner(hostContainer, runnerPath);
    }
    catch (error) {
        console.warn(`Failed to stop runner at ${runnerPath} before cleanup:`, error);
    }
    const escapedRunnerPath = runnerPath.replace(/'/g, "'\\''");
    await dockerExec(hostContainer, ['sh', '-c', `rm -rf -- '${escapedRunnerPath}'`]);
    const remaining = await dockerExec(hostContainer, ['sh', '-c', `test ! -e '${escapedRunnerPath}' && echo removed || echo present`]);
    if (remaining.trim() !== 'removed') {
        throw new Error(`Runner directory was not removed: ${runnerPath}`);
    }
}
async function refreshRunnerHostContainer(containerName) {
    if (await containerExists(containerName)) {
        await runDocker(['rm', '-f', containerName]);
    }
    await bootstrapHostContainer(containerName);
    await waitForContainerReady(containerName);
}
