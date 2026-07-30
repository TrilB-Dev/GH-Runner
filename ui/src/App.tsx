import { useCallback, useEffect, useMemo, useState } from 'react';
import Tooltip from 'bootstrap/js/dist/tooltip';
import { createDockerDesktopClient } from '@docker/extension-api-client';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faGear,
  faPlay,
  faStop,
  faRotateRight,
  faPlus,
  faPen,
  faTrash,
  faSync
} from '@fortawesome/free-solid-svg-icons';

const client = createDockerDesktopClient();

interface RunnerConfig {
  id: string;
  runnerName: string;
  githubUrl: string;
  owner: string;
  repo: string;
  isOrg: boolean;
  tokenName?: string;
  labels: string[];
  hostContainerName: string;
  runnerRootPath: string;
  runnerPath: string;
  createdAt: string;
}

interface Runner extends RunnerConfig {
  status: 'on' | 'off' | 'paused';
  dockerRawStatus?: string;
}

interface RepoOption {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  owner: string;
}

interface RunnerForm {
  runnerName: string;
  selectedTokenId: string;
  owner: string;
  repo: string;
  runnerGroup?: string;
  registrationToken: string;
  labels: string[];
}

interface GithubTokenResponse {
  id: string;
  name: string;
  login: string;
  type: string;
  createdAt: string;
}

const GITHUB_BASE_URL = 'https://github.com';
const DEFAULT_HOST_CONTAINER_NAME = 'gh-runner-host';
const DEFAULT_RUNNER_ROOT_PATH = '/opt/github';

const labelOptions = [
  'self-hosted',
  'docker',
  'linux',
  'windows',
  'x64',
  'arm64'
];

type RunnerSavePayload = {
  runnerName: string;
  githubUrl: string;
  owner: string;
  repo: string;
  isOrg: boolean;
  registrationToken: string;
  labels: string[];
  tokenName: string;
  selectedTokenId: string;
  runnerGroup?: string;
  hostContainerName: string;
  runnerRootPath: string;
};

const defaultFormState: RunnerForm = {
  runnerName: '',
  selectedTokenId: '',
  owner: '',
  repo: '',
  runnerGroup: undefined,
  registrationToken: '',
  labels: []
};

export function App() {
  const ddClient = useMemo(() => client, []);
  const [runners, setRunners] = useState<Runner[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDialog, setShowDialog] = useState(false);
  const [editing, setEditing] = useState<Runner | null>(null);
  const [formState, setFormState] = useState<RunnerForm>(defaultFormState);
  const [error, setError] = useState<string | null>(null);
  const [backendMessage, setBackendMessage] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tokenFormName, setTokenFormName] = useState('');
  const [tokenFormValue, setTokenFormValue] = useState('');
  const [tokenFormError, setTokenFormError] = useState<string | null>(null);
  const [tokenActionMessage, setTokenActionMessage] = useState<string | null>(null);
  const [githubTokens, setGithubTokens] = useState<GithubTokenResponse[]>([]);
  const [repoOptions, setRepoOptions] = useState<RepoOption[]>([]);
  const [selectedRepoOption, setSelectedRepoOption] = useState<RepoOption | null>(null);
  const [saving, setSaving] = useState(false);
  const [repoLoading, setRepoLoading] = useState(false);
  const [runnerGroups, setRunnerGroups] = useState<Array<{id:number;name:string}>>([]);
  const [runnerGroupLoading, setRunnerGroupLoading] = useState(false);

  const service = ddClient.extension.vm?.service;

  const formatError = useCallback((err: unknown) => {
    const timeoutMessage = 'The backend did not respond in time. The extension backend may still be starting. Please wait a moment and try again.';
    if (err instanceof Error) {
      if (err.name === 'HeadersTimeoutError' || err.message.includes('Headers Timeout')) {
        return timeoutMessage;
      }
      return err.message;
    }
    if (typeof err === 'string') {
      if (err.includes('Headers Timeout')) {
        return timeoutMessage;
      }
      return err;
    }
    if (typeof err === 'object' && err !== null) {
      const anyErr = err as Record<string, unknown>;
      const name = String(anyErr.name || '');
      const message = String(anyErr.message || '');
      if (name === 'HeadersTimeoutError' || message.includes('Headers Timeout')) {
        return timeoutMessage;
      }
      try {
        return JSON.stringify(err, Object.getOwnPropertyNames(err));
      } catch {
        return 'An unknown error occurred.';
      }
    }
    return 'An unknown error occurred.';
  }, []);

  const delay = useCallback((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)), []);

  const isBackendStartupError = useCallback((err: unknown) => {
    if (err instanceof Error) {
      return err.name === 'HeadersTimeoutError' || err.message.includes('Headers Timeout');
    }
    if (typeof err === 'string') {
      return err.includes('Headers Timeout');
    }
    if (typeof err === 'object' && err !== null) {
      const anyErr = err as Record<string, unknown>;
      const name = String(anyErr.name || '');
      const message = String(anyErr.message || '');
      return name === 'HeadersTimeoutError' || message.includes('Headers Timeout');
    }
    return false;
  }, []);

  const serviceGet = useCallback(async <T,>(path: string, timeoutMs = 30000): Promise<T> => {
    if (!service) {
      throw new Error('Unable to access the Docker VM service.');
    }

    const timeoutPromise = new Promise<T>((_, reject) => {
      const err = new Error('Headers Timeout Error');
      err.name = 'HeadersTimeoutError';
      setTimeout(() => reject(err), timeoutMs);
    });

    return await Promise.race([service.get(path) as Promise<T>, timeoutPromise]);
  }, [service]);

  const selectedToken = useMemo(
    () => githubTokens.find((token) => token.id === formState.selectedTokenId) ?? null,
    [githubTokens, formState.selectedTokenId]
  );

  const loadGithubTokensList = useCallback(async () => {
    if (!service) {
      return;
    }

    try {
      const tokens = await serviceGet<GithubTokenResponse[]>('/api/github-tokens', 30000);
      setGithubTokens(tokens || []);
    } catch (err) {
      setError(formatError(err));
    }
  }, [service, serviceGet, formatError]);

  const loadReposForToken = useCallback(async (tokenId: string) => {
    if (!service) {
      return;
    }

    setRepoLoading(true);
    try {
      const repos = await serviceGet<RepoOption[]>(`/api/github-tokens/${encodeURIComponent(tokenId)}/repos`, 30000);
      setRepoOptions(repos || []);
    } catch (err) {
      setError(formatError(err));
      setRepoOptions([]);
    } finally {
      setRepoLoading(false);
    }
  }, [service, serviceGet, formatError]);

  const loadRunnerGroups = useCallback(async (tokenId: string, owner: string, repo: string, isOrg: boolean) => {
    if (!service) {
      return;
    }

    if (!owner) {
      setRunnerGroups([]);
      return;
    }

    setRunnerGroupLoading(true);
    try {
      const query = new URLSearchParams({
        owner,
        isOrg: String(isOrg)
      });
      if (!isOrg) {
        query.set('repo', repo);
      }
      const groups = await serviceGet<Array<{ id:number; name:string }>>(
        `/api/github-tokens/${encodeURIComponent(tokenId)}/runner-groups?${query.toString()}`,
        30000
      );
      setRunnerGroups(groups || []);
    } catch (err) {
      setError(formatError(err));
      setRunnerGroups([]);
    } finally {
      setRunnerGroupLoading(false);
    }
  }, [service, serviceGet, formatError]);

  const createGithubToken = async () => {
    if (!service) {
      setError('Unable to access the Docker VM service.');
      return;
    }

    setTokenFormError(null);
    setTokenActionMessage(null);

    if (!tokenFormName.trim() || !tokenFormValue.trim()) {
      setTokenFormError('Token name and token are required.');
      return;
    }

    try {
      await service.post('/api/github-tokens', {
        name: tokenFormName.trim(),
        token: tokenFormValue.trim()
      });
      setTokenActionMessage('GitHub token saved successfully.');
      setTokenFormName('');
      setTokenFormValue('');
      await loadGithubTokensList();
    } catch (err) {
      setTokenFormError(formatError(err));
    }
  };

  const deleteGithubTokenById = async (id: string) => {
    if (!service) {
      setError('Unable to access the Docker VM service.');
      return;
    }

    try {
      await service.delete(`/api/github-tokens/${encodeURIComponent(id)}`);
      if (formState.selectedTokenId === id) {
        setFormState({ ...formState, selectedTokenId: '', owner: '', repo: '' });
        setSelectedRepoOption(null);
      }
      await loadGithubTokensList();
    } catch (err) {
      setError(formatError(err));
    }
  };

  const loadRunners = useCallback(async () => {
    if (!service) {
      setLoading(false);
      setError('Unable to access the Docker VM service. Make sure Docker Desktop is running and the VM service is available.');
      return;
    }

    setLoading(true);
    setError(null);
    setBackendMessage(null);

    let lastError: unknown = null;
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      try {
        const response = await serviceGet<Runner[]>('/api/runners', 30000);
        setRunners(response || []);
        lastError = null;
        break;
      } catch (err) {
        lastError = err;
        if (isBackendStartupError(err) && attempt < 4) {
          setBackendMessage(`Extension backend is still starting, retrying (${attempt}/4)...`);
          await delay(2000);
          continue;
        }
        setError(formatError(err));
        break;
      }
    }

    if (!lastError) {
      setBackendMessage(null);
    }
    setLoading(false);
  }, [serviceGet, delay, isBackendStartupError, formatError]);

  useEffect(() => {
    void loadRunners();
    void loadGithubTokensList();
  }, [loadRunners, loadGithubTokensList]);

  useEffect(() => {
    if (settingsOpen) {
      void loadGithubTokensList();
      const interval = setInterval(() => {
        void loadGithubTokensList();
      }, 30000);
      return () => clearInterval(interval);
    }
    return undefined;
  }, [settingsOpen, loadGithubTokensList]);

  useEffect(() => {
    const tooltipTriggerList = Array.from(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
    const tooltipList = tooltipTriggerList.map((tooltipTriggerEl) => new Tooltip(tooltipTriggerEl));
    return () => {
      tooltipList.forEach((tooltip) => tooltip.dispose());
    };
  }, [runners, settingsOpen, showDialog]);

  useEffect(() => {
    if (!editing) {
      if (selectedToken) {
        setFormState((prev) => ({
          ...prev,
          owner: selectedToken.login,
          repo: ''
        }));
        setSelectedRepoOption(null);
        void loadReposForToken(selectedToken.id);
        void loadRunnerGroups(selectedToken.id, selectedToken.login, '', true);
      } else {
        setRepoOptions([]);
        setSelectedRepoOption(null);
      }
    }
  }, [selectedToken, loadReposForToken, loadRunnerGroups, editing]);

  useEffect(() => {
    if (!editing && selectedToken) {
      void loadRunnerGroups(selectedToken.id, formState.owner, formState.repo, !formState.repo.trim());
    }
  }, [editing, selectedToken, formState.owner, formState.repo, loadRunnerGroups]);

  const openDialog = (runner?: Runner) => {
    if (runner) {
      setEditing(runner);
      setFormState({
        runnerName: runner.runnerName,
        selectedTokenId: '',
        owner: runner.owner,
        repo: runner.repo,
        registrationToken: '',
        labels: runner.labels
      });
      setSelectedRepoOption(null);
    } else {
      setEditing(null);
      setFormState(defaultFormState);
      setSelectedRepoOption(null);
    }
    setShowDialog(true);
  };

  const closeDialog = () => {
    setShowDialog(false);
    setEditing(null);
    setFormState(defaultFormState);
  };

  const saveRunner = async () => {
    if (saving) {
      return;
    }

    if (!service) {
      setError('Unable to access the Docker VM service.');
      return;
    }

    if (!editing && !selectedToken) {
      setError('Select a GitHub API token before creating a new runner.');
      return;
    }

    if (!formState.runnerName.trim()) {
      setError('Runner name is required.');
      return;
    }

    if (!formState.owner.trim()) {
      setError('Owner/organization is required.');
      return;
    }

    setError(null);
    setBackendMessage('Saving runner...');
    setSaving(true);

    try {
      const payload: RunnerSavePayload = {
        runnerName: formState.runnerName,
        githubUrl: GITHUB_BASE_URL,
        owner: formState.owner,
        repo: formState.repo,
        isOrg: !formState.repo.trim(),
        registrationToken: formState.registrationToken,
        labels: formState.labels,
        tokenName: selectedToken?.name || '',
        selectedTokenId: selectedToken?.id || '',
        runnerGroup: formState.runnerGroup,
        hostContainerName: DEFAULT_HOST_CONTAINER_NAME,
        runnerRootPath: DEFAULT_RUNNER_ROOT_PATH
      };

      if (editing) {
        await service.put(`/api/runners/${editing.id}`, payload);
      } else {
        await service.post('/api/runners', payload);
      }

      closeDialog();
      await loadRunners();
      setBackendMessage('Runner saved successfully.');
    } catch (err) {
      setError(formatError(err));
      setBackendMessage(null);
    } finally {
      setSaving(false);
    }
  };

  const anyRunnerRunning = useMemo(
    () => runners.some((runner) => runner.status === 'on'),
    [runners]
  );

  const anyRunnerStopped = useMemo(
    () => runners.some((runner) => runner.status !== 'on'),
    [runners]
  );

  const runAction = async (id: string, action: 'start' | 'stop' | 'restart') => {
    if (!service) {
      setError('Unable to access the Docker VM service.');
      return;
    }

    setError(null);

    try {
      await service.post(`/api/runners/${id}/${action}`, {});
      await loadRunners();
    } catch (err) {
      setError(formatError(err));
    }
  };

  const runAllAction = async (action: 'start' | 'stop' | 'restart') => {
    if (!service) {
      setError('Unable to access the Docker VM service.');
      return;
    }

    if (action === 'stop' || action === 'restart') {
      const prompt =
        action === 'stop'
          ? 'Stop all runners now? Existing jobs may be interrupted.'
          : 'Restart all runners now? This will stop and then start every runner.';
      if (!window.confirm(prompt)) {
        return;
      }
    }

    setError(null);
    setBackendMessage(
      action === 'start'
        ? 'Starting all runners...'
        : action === 'stop'
        ? 'Stopping all runners...'
        : 'Restarting all runners...'
    );

    try {
      await service.post(`/api/runners/all/${action}`, {});
      await loadRunners();
      setBackendMessage('All runners updated successfully.');
    } catch (err) {
      setError(formatError(err));
      setBackendMessage(null);
    }
  };

  const refreshHostContainer = async () => {
    if (!service) {
      setError('Unable to access the Docker VM service.');
      return;
    }

    if (!window.confirm('This will recreate the host container and preserve existing runner data. Continue?')) {
      return;
    }

    setError(null);
    setBackendMessage('Refreshing host container...');

    try {
      await service.post('/api/host-refresh', {});
      await loadRunners();
      setBackendMessage('Host container refresh completed successfully.');
    } catch (err) {
      setError(formatError(err));
      setBackendMessage(null);
    }
  };

  const deleteRunner = async (id: string) => {
    if (!service) {
      setError('Unable to access the Docker VM service.');
      return;
    }

    if (!window.confirm('Delete this runner and remove its directory from the host container?')) {
      return;
    }

    setError(null);

    try {
      await service.delete(`/api/runners/${id}`);
      loadRunners();
    } catch (err) {
      setError(formatError(err));
    }
  };

  return (
    <div className="container py-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <div className="d-flex align-items-center gap-3">
          <img src="./GH-Runner-Logo.svg" alt="GitHub Runner Manager" style={{ height: 128 }} />
          <div>
            {/* <h1 className="h4 mb-1">GitHub Runner Manager</h1> */}
            <p className="text-muted mb-0">Manage all of your GitHub self-hosted runners inside Docker Desktop.</p>
          </div>
        </div>
        <div className="btn-group btn-group-sm">
          <button 
            type="button" 
            className="btn btn-primary" 
            onClick={refreshHostContainer}
            aria-label="Refresh host container"
            data-bs-toggle="tooltip"
            title="Refresh host"
          >
              <FontAwesomeIcon icon={faSync} fixedWidth />
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              void loadGithubTokensList();
              setSettingsOpen(true);
            }}
            aria-label="Settings"
            data-bs-toggle="tooltip"
            title="Settings"
          >
            <FontAwesomeIcon icon={faGear} fixedWidth />
          </button>
        </div>
      </div>

      {error ? <div className="alert alert-danger">{error}</div> : null}
      {backendMessage && !error ? <div className="alert alert-info">{backendMessage}</div> : null}

      <div className="d-flex flex-column flex-md-row justify-content-between align-items-start align-items-md-center mb-4 gap-2">
        <h2 className="h5 mb-0">Runners</h2>
        <div className="btn-group btn-group-sm">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!anyRunnerStopped}
            onClick={() => {
              void runAllAction('start');
            }}
            aria-label="Start all runners"
            data-bs-toggle="tooltip"
            title="Start all"
          >
            <FontAwesomeIcon icon={faPlay} fixedWidth />
          </button>
          <button
            type="button"
            className="btn btn-danger"
            disabled={!anyRunnerRunning}
            onClick={() => {
              void runAllAction('stop');
            }}
            aria-label="Stop all runners"
            data-bs-toggle="tooltip"
            title="Stop all"
          >
            <FontAwesomeIcon icon={faStop} fixedWidth />
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={runners.length === 0}
            onClick={() => {
              void runAllAction('restart');
            }}
            aria-label="Restart all runners"
            data-bs-toggle="tooltip"
            title="Restart all"
          >
            <FontAwesomeIcon icon={faRotateRight} fixedWidth />
          </button>
          <button
            type="button"
            className="btn btn-success"
            onClick={() => openDialog()}
            aria-label="Add runner"
            data-bs-toggle="tooltip"
            title="Add runner"
          >
            <FontAwesomeIcon icon={faPlus} fixedWidth />
          </button>
        </div>
      </div>

      {settingsOpen && (
        <>
          <div className="modal fade show" style={{ display: 'block' }} tabIndex={-1} aria-modal="true" role="dialog">
            <div className="modal-dialog modal-dialog-centered modal-lg">
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">Settings</h5>
                  <button type="button" className="btn-close" aria-label="Close" onClick={() => setSettingsOpen(false)} />
                </div>
                <div className="modal-body py-4">
                  <div className="mb-4">
                    <h6>Saved GitHub API tokens</h6>
                    {githubTokens.length === 0 ? (
                      <div className="alert alert-info mb-0">No saved GitHub API tokens yet. Add one below to access repository lists in the runner form.</div>
                    ) : (
                      githubTokens.map((token) => (
                        <div className="card mb-3" key={token.id}>
                          <div className="card-body p-3">
                            <div className="d-flex justify-content-between align-items-center gap-3">
                              <div>
                                <h6 className="mb-1">{token.name}</h6>
                                <p className="mb-0 text-muted">{token.login} · {token.type} · saved {new Date(token.createdAt).toLocaleDateString()}</p>
                              </div>
                              <button type="button" className="btn btn-outline-danger btn-sm" onClick={() => deleteGithubTokenById(token.id)}>
                                Delete
                              </button>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  <div>
                    <h6>Add a new GitHub API token</h6>
                    <div className="mb-3">
                      <label className="form-label">Token name</label>
                      <input
                        type="text"
                        className="form-control"
                        value={tokenFormName}
                        onChange={(event) => {
                          setTokenFormName(event.target.value);
                          setTokenFormError(null);
                          setTokenActionMessage(null);
                        }}
                        placeholder="Friendly name for this token"
                      />
                      <div className="form-text">A friendly name to identify this token in the runner creation form.</div>
                    </div>
                    <div className="mb-3">
                      <label className="form-label">Personal access token</label>
                      <input
                        type="password"
                        className="form-control"
                        value={tokenFormValue}
                        onChange={(event) => {
                          setTokenFormValue(event.target.value);
                          setTokenFormError(null);
                          setTokenActionMessage(null);
                        }}
                        placeholder="GitHub PAT"
                      />
                      <div className="form-text">GitHub personal access token used to enumerate repositories and validate access.</div>
                    </div>
                    {tokenFormError ? <div className="alert alert-danger">{tokenFormError}</div> : null}
                    {tokenActionMessage ? <div className="alert alert-success">{tokenActionMessage}</div> : null}
                    <button type="button" className="btn btn-primary" onClick={createGithubToken} data-bs-toggle="tooltip" title="Save token">
                      Save token
                    </button>
                    <div className="mt-3 text-muted small">
                      <p className="mb-1">Recommended permissions:</p>
                      <p className="mb-0">• repo (full repository access for private repos)</p>
                      <p className="mb-0">• read:org (if using organization-owned runners)</p>
                      <p className="mb-0">• workflow (optional, for workflow-related access if needed)</p>
                    </div>
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setSettingsOpen(false)} data-bs-toggle="tooltip" title="Close">
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div className="modal-backdrop fade show" />
        </>
      )}

      {loading ? (
        <div>Loading runners …</div>
      ) : runners.length === 0 ? (
        <div className="card">
          <div className="card-body">
            <h5 className="card-title">You don't have any runners configured yet.</h5>
            <p className="card-text text-muted">Get started by creating your first GitHub self-hosted runner.</p>
            <button type="button" className="btn btn-primary" onClick={() => openDialog()}>
              Create new runner
            </button>
          </div>
        </div>
      ) : (
        <div className="accordion" id="runnerAccordion">
          {runners.map((runner, index) => (
            <div className="accordion-item" key={runner.id}>
              <h2 className="accordion-header" id={`heading-${runner.id}`}>
                <div className="d-flex align-items-center gap-2">
                  <button
                    className="accordion-button collapsed flex-grow-1"
                    type="button"
                    data-bs-toggle="collapse"
                    data-bs-target={`#collapse-${runner.id}`}
                    aria-expanded="false"
                    aria-controls={`collapse-${runner.id}`}
                  >
                    <div className="d-flex justify-content-between align-items-center w-100">
                      <div>
                        <strong>{runner.runnerName}</strong>
                        <div className="text-muted small">{runner.hostContainerName} · {runner.runnerPath}</div>
                      </div>
                    </div>
                  </button>
                </div>
              </h2>
              <div
                id={`collapse-${runner.id}`}
                className="accordion-collapse collapse"
                aria-labelledby={`heading-${runner.id}`}
                data-bs-parent="#runnerAccordion"
              >
                <div className="accordion-body">
                  <div className="row">
                    <div className="col align-right d-flex justify-content-end">
                      <div className="btn-group btn-group-sm" style={{ paddingRight: '10px' }}>
                        <button type="button" className="btn btn-success" disabled={runner.status === 'on'} onClick={() => runAction(runner.id, 'start')} data-bs-toggle="tooltip" title="Start">
                          <FontAwesomeIcon icon={faPlay} fixedWidth />
                        </button>
                        <button type="button" className="btn btn-danger" disabled={runner.status !== 'on'} onClick={() => runAction(runner.id, 'stop')} data-bs-toggle="tooltip" title="Stop">
                          <FontAwesomeIcon icon={faStop} fixedWidth />
                        </button>
                        <button type="button" className="btn btn-primary" disabled={runner.status !== 'on'} onClick={() => runAction(runner.id, 'restart')} data-bs-toggle="tooltip" title="Restart">
                          <FontAwesomeIcon icon={faRotateRight} fixedWidth />
                        </button>
                        <button type="button" className="btn btn-success" onClick={() => openDialog(runner)} data-bs-toggle="tooltip" title="Edit">
                          <FontAwesomeIcon icon={faPen} fixedWidth />
                        </button>
                        <button type="button" className="btn btn-danger" onClick={() => deleteRunner(runner.id)} data-bs-toggle="tooltip" title="Delete">
                          <FontAwesomeIcon icon={faTrash} fixedWidth />
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="row gy-3 mt-2">
                    <div className="col-12 col-md-6">
                      <p className="mb-1"><strong>GitHub URL:</strong> {runner.githubUrl}</p>
                      <p className="mb-1"><strong>Owner:</strong> {runner.owner}</p>
                      <p className="mb-0"><strong>Repo:</strong> {runner.repo || '(org)'}</p>
                    </div>
                    <div className="col-12 col-md-6">
                      <p className="mb-1"><strong>Labels:</strong> {runner.labels.join(', ')}</p>
                      <p className="mb-1"><strong>Created:</strong> {new Date(runner.createdAt).toLocaleString()}</p>
                      <p className="mb-0"><strong>Raw status:</strong> {runner.dockerRawStatus || 'unknown'}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showDialog && (
        <>
          <div className="modal fade show" style={{ display: 'block' }} tabIndex={-1} aria-modal="true" role="dialog">
            <div className="modal-dialog modal-dialog-centered modal-lg">
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">{editing ? 'Edit runner' : 'Add runner'}</h5>
                  <button type="button" className="btn-close" aria-label="Close" onClick={closeDialog} />
                </div>
                <div className="modal-body py-4">
                  <div className="mb-3">
                    <label className="form-label">Runner name</label>
                    <input
                      type="text"
                      className="form-control"
                      value={formState.runnerName}
                      onChange={(event) => setFormState({ ...formState, runnerName: event.target.value })}
                      placeholder="Runner name"
                    />
                    <div className="form-text">A local identifier for this runner. It becomes the runner directory name inside the host container.</div>
                  </div>

                  {!editing && (
                    <div className="mb-3">
                      <label className="form-label">GitHub API token</label>
                      <select
                        className="form-select"
                        value={formState.selectedTokenId}
                        onChange={(event) => {
                          const token = githubTokens.find((item) => item.id === event.target.value) || null;
                          setSelectedRepoOption(null);
                          setFormState({
                            ...formState,
                            selectedTokenId: token?.id || '',
                            owner: token?.login || '',
                            repo: ''
                          });
                        }}
                      >
                        <option value="">Select a saved token</option>
                        {githubTokens.map((token) => (
                          <option key={token.id} value={token.id}>{token.name} ({token.login})</option>
                        ))}
                      </select>
                      <div className="form-text">Select a saved token to load repositories and derive the owner.</div>
                    </div>
                  )}

                  <div className="mb-3">
                    <label className="form-label">Owner / organization</label>
                    <input
                      type="text"
                      className="form-control"
                      value={formState.owner}
                      onChange={(event) => {
                        setFormState({ ...formState, owner: event.target.value });
                        setSelectedRepoOption(null);
                      }}
                      disabled={Boolean(editing)}
                    />
                    <div className="form-text">
                      {editing
                        ? 'Owner set for this runner and cannot be changed from this edit view.'
                        : 'Derived from the selected token or selected repository. Edit for org or alternate owner.'}
                    </div>
                  </div>

                  {!editing ? (
                    <div className="row gx-2 gy-3 align-items-end mb-3">
                      <div className="col-12 col-md-9">
                        <label className="form-label">Repository</label>
                        <input
                          type="text"
                          className="form-control"
                          list="reposList"
                          value={formState.repo}
                          onChange={(event) => setFormState({ ...formState, repo: event.target.value })}
                          disabled={!formState.selectedTokenId}
                          placeholder="Pick or type a repository"
                        />
                        <datalist id="reposList">
                          {repoOptions.map((repo) => (
                            <option key={repo.id} value={repo.full_name} />
                          ))}
                        </datalist>
                        <div className="form-text">Pick a repository from the selected token. Leave blank for an organization-level runner.</div>
                      </div>
                      <div className="col-12 col-md-3">
                        <button
                          type="button"
                          className="btn btn-outline-secondary w-100"
                          disabled={!formState.selectedTokenId || repoLoading}
                          onClick={() => {
                            if (formState.selectedTokenId) {
                              void loadReposForToken(formState.selectedTokenId);
                            }
                          }}
                        >
                          {repoLoading ? 'Refreshing…' : 'Refresh repos'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mb-3">
                      <label className="form-label">Repository name</label>
                      <input
                        type="text"
                        className="form-control"
                        value={formState.repo}
                        onChange={(event) => setFormState({ ...formState, repo: event.target.value })}
                        placeholder="Repository name"
                      />
                      <div className="form-text">Target repository name. Leave blank for an organization-level runner.</div>
                    </div>
                  )}

                  {!editing && (
                    <div className="mb-3">
                      <label className="form-label">Runner group</label>
                      <input
                        type="text"
                        className="form-control"
                        list="runnerGroupsList"
                        value={formState.runnerGroup || ''}
                        onChange={(event) => setFormState({ ...formState, runnerGroup: event.target.value })}
                        disabled={runnerGroups.length === 0}
                        placeholder="Select or type a runner group"
                      />
                      <datalist id="runnerGroupsList">
                        {runnerGroups.map((group) => (
                          <option key={group.id} value={group.name} />
                        ))}
                      </datalist>
                      <div className="form-text">Optional runner group for organization or repo runners.</div>
                    </div>
                  )}

                  <div className="mb-3">
                    <label className="form-label">Runner labels</label>
                    <input
                      type="text"
                      className="form-control"
                      value={formState.labels.join(', ')}
                      onChange={(event) => setFormState({
                        ...formState,
                        labels: event.target.value.split(',').map((label) => label.trim()).filter(Boolean)
                      })}
                      placeholder="e.g. self-hosted,docker,linux"
                    />
                    <div className="form-text">Comma-separated labels used by GitHub workflows to target this runner.</div>
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={closeDialog} disabled={saving} data-bs-toggle="tooltip" title="Cancel">
                    Cancel
                  </button>
                  <button type="button" className="btn btn-primary" onClick={() => { void saveRunner(); }} disabled={saving} data-bs-toggle="tooltip" title="Save runner">
                    {saving ? 'Saving…' : 'Save runner'}
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div className="modal-backdrop fade show" />
        </>
      )}
    </div>
  );
}
