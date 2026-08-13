import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Tooltip from 'bootstrap/js/dist/tooltip';
import { createDockerDesktopClient } from '@docker/extension-api-client';
import Selectpicker from '@crestapps/bootstrap-select';
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
  startOnStartup: boolean;
  hostContainerName: string;
  runnerRootPath: string;
  runnerPath: string;
  createdAt: string;
}

interface Runner extends RunnerConfig {
  status: 'on' | 'off' | 'paused';
  dockerRawStatus?: string;
  runnerVersion?: string;
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
  startOnStartup?: boolean;
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
  startOnStartup?: boolean;
};

const defaultFormState: RunnerForm = {
  runnerName: '',
  selectedTokenId: '',
  owner: '',
  repo: '',
  runnerGroup: undefined,
  registrationToken: '',
  labels: [],
  startOnStartup: false
};

export function App() {
  const ddClient = useMemo(() => client, []);
  const [runners, setRunners] = useState<Runner[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDialog, setShowDialog] = useState(false);
  const [editing, setEditing] = useState<Runner | null>(null);
  const [formState, setFormState] = useState<RunnerForm>(defaultFormState);
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const [errorDetailsOpen, setErrorDetailsOpen] = useState(false);
  const [backendMessage, setBackendMessage] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'general' | 'tools' | 'tokens' | 'info'>('general');
  const [extensionInfo, setExtensionInfo] = useState<{
    extensionName: string;
    extensionVersion: string;
    extensionAuthor: string;
    documentationUrl: string;
    githubApiConnection: { status: string; message: string };
    serviceContainer: { name: string; exists: boolean; status: string; raw: string };
    runnerContainer: { totalRunners: number; activeRunners: number; status: string };
    runnerBaseVersion: string;
    runnerVersions: Array<{ id: string; version: string }>;
    runnerVersionsOutOfDate: number;
    runnerVersionMismatch: boolean;
    dataVolumeExists: boolean;
    runnerVolumeExists: boolean;
    configuredGithubTokens: number;
  } | null>(null);
  const [startRunnersOnStartup, setStartRunnersOnStartup] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return window.localStorage.getItem('startRunnersOnStartup') !== 'false';
  });
  const [uiStyle, setUiStyle] = useState<'light' | 'dark' | 'system'>(() => {
    if (typeof window === 'undefined') return 'system';
    return (window.localStorage.getItem('uiStyle') as 'light' | 'dark' | 'system') || 'system';
  });
  const [uiLoggingEnabled, setUiLoggingEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('uiLoggingEnabled') === 'true';
  });
  const [runnerLoggingEnabled, setRunnerLoggingEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('runnerLoggingEnabled') === 'true';
  });
  const [githubApiLoggingEnabled, setGithubApiLoggingEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('githubApiLoggingEnabled') === 'true';
  });
  const [logsOpen, setLogsOpen] = useState(false);
  const [logsContent, setLogsContent] = useState('');
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsCopied, setLogsCopied] = useState(false);
  const confirmActionRef = useRef<(() => Promise<void>) | null>(null);
  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    title: string;
    body: string;
    confirmLabel: string;
    confirmVariant: string;
  } | null>(null);
  const [tokenFormName, setTokenFormName] = useState('');
  const [tokenFormValue, setTokenFormValue] = useState('');
  const [tokenFormError, setTokenFormError] = useState<string | null>(null);
  const [tokenActionMessage, setTokenActionMessage] = useState<string | null>(null);
  const [showTokenForm, setShowTokenForm] = useState(false);
  const [githubTokens, setGithubTokens] = useState<GithubTokenResponse[]>([]);
  const [repoOptions, setRepoOptions] = useState<RepoOption[]>([]);
  const [selectedRepoOption, setSelectedRepoOption] = useState<RepoOption | null>(null);
  const [saving, setSaving] = useState(false);
  const [repoLoading, setRepoLoading] = useState(false);
  const [repoDropdownOpen, setRepoDropdownOpen] = useState(false);
  const [runnerGroups, setRunnerGroups] = useState<Array<{id:number;name:string}>>([]);
  const [runnerGroupLoading, setRunnerGroupLoading] = useState(false);

  const service = ddClient.extension.vm?.service;

  const closeConfirmDialog = useCallback(() => {
    confirmActionRef.current = null;
    setConfirmState(null);
  }, []);

  const handleConfirm = useCallback(async () => {
    const action = confirmActionRef.current;
    closeConfirmDialog();
    if (action) {
      await action();
    }
  }, [closeConfirmDialog]);

  const openConfirmDialog = useCallback(
    (
      title: string,
      body: string,
      confirmAction: () => Promise<void>,
      confirmLabel = 'Confirm',
      confirmVariant = 'btn-primary'
    ) => {
      confirmActionRef.current = confirmAction;
      setConfirmState({
        open: true,
        title,
        body,
        confirmLabel,
        confirmVariant
      });
    },
    []
  );

  const formatError = useCallback((err: unknown) => {
    const timeoutMessage = 'The backend did not respond in time. The extension backend may still be starting. Please wait a moment and try again.';

    const tryParseJson = (value: string): unknown => {
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    };

    const getErrorObjectMessage = (obj: Record<string, unknown>): string => {
      const errorText = String(obj.error ?? obj.message ?? obj.statusText ?? 'An unknown error occurred.');
      const detailsCandidates: string[] = [];

      const addDetail = (value: unknown) => {
        if (typeof value === 'string' && value.trim()) {
          detailsCandidates.push(value.trim());
          return;
        }
        if (typeof value === 'object' && value !== null) {
          try {
            const jsonString = JSON.stringify(value, Object.getOwnPropertyNames(value));
            detailsCandidates.push(jsonString);
          } catch {
            // ignore
          }
        }
      };

      const anyObj = obj as Record<string, any>;
      addDetail(anyObj.details ?? anyObj.stderr ?? anyObj.stdout ?? anyObj.body ?? anyObj.response?.body ?? anyObj.response?.message ?? anyObj.response?.error ?? anyObj.data);
      addDetail(anyObj.code ?? anyObj.status);
      addDetail(anyObj.cmd ?? anyObj.command);

      const details = detailsCandidates.filter(Boolean).join(' | ');
      if (details) {
        return `${errorText}${errorText.endsWith('.') ? '' : '.'} ${details}`;
      }
      return errorText;
    };

    const normalizeObject = (source: unknown): string => {
      if (typeof source === 'string') {
        const parsed = tryParseJson(source);
        if (parsed) {
          return normalizeObject(parsed);
        }
        return source;
      }

      if (source && typeof source === 'object') {
        const anyErr = source as Record<string, unknown>;
        if (anyErr.error || anyErr.message || anyErr.statusText) {
          return getErrorObjectMessage(anyErr);
        }
        if (anyErr.response) {
          return normalizeObject(anyErr.response);
        }
        if (anyErr.body) {
          return normalizeObject(anyErr.body);
        }
        if (anyErr.data) {
          return normalizeObject(anyErr.data);
        }
        if (anyErr.message) {
          return String(anyErr.message);
        }
        try {
          return JSON.stringify(anyErr, Object.getOwnPropertyNames(anyErr));
        } catch {
          return 'An unknown error occurred.';
        }
      }

      return 'An unknown error occurred.';
    };

    if (err instanceof Error) {
      if (err.name === 'HeadersTimeoutError' || err.message.includes('Headers Timeout')) {
        return timeoutMessage;
      }
      const anyErr = err as unknown as Record<string, unknown>;
      if (anyErr.response || anyErr.body || anyErr.data || anyErr.message) {
        return normalizeObject(anyErr);
      }
      return err.message;
    }

    if (typeof err === 'string') {
      if (err.includes('Headers Timeout')) {
        return timeoutMessage;
      }
      const parsed = tryParseJson(err);
      return parsed ? normalizeObject(parsed) : err;
    }

    if (typeof err === 'object' && err !== null) {
      const anyErr = err as Record<string, unknown>;
      const name = String(anyErr.name || '');
      const message = String(anyErr.message || '');
      if (name === 'HeadersTimeoutError' || message.includes('Headers Timeout')) {
        return timeoutMessage;
      }
      return normalizeObject(anyErr);
    }

    return 'An unknown error occurred.';
  }, []);

  const getErrorDetails = useCallback((err: unknown): string | null => {
    const tryParseJson = (value: string): unknown => {
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    };

    const getDetailsFromObject = (obj: Record<string, any>): string | null => {
      const parts: string[] = [];
      const add = (value: unknown) => {
        if (typeof value === 'string' && value.trim()) {
          parts.push(value.trim());
        } else if (typeof value === 'object' && value !== null) {
          try {
            parts.push(JSON.stringify(value, null, 2));
          } catch {
            // ignore
          }
        }
      };

      add(obj.details);
      add(obj.stderr);
      add(obj.stdout);
      add(obj.body);
      add(obj.response?.body);
      add(obj.response?.message);
      add(obj.response?.error);
      add(obj.data);
      add(obj.stack);
      add(obj.cmd);
      add(obj.command);
      add(obj.code ?? obj.status);
      return parts.length ? parts.join('\n') : null;
    };

    if (err instanceof Error) {
      return getDetailsFromObject(err as Record<string, any>);
    }

    if (typeof err === 'string') {
      const parsed = tryParseJson(err);
      if (parsed) {
        return getErrorDetails(parsed);
      }
      return null;
    }

    if (typeof err === 'object' && err !== null) {
      return getDetailsFromObject(err as Record<string, any>);
    }

    return null;
  }, []);

  const handleError = useCallback((err: unknown) => {
    handleError(err);
    setErrorDetails(getErrorDetails(err));
    setErrorDetailsOpen(false);
  }, [formatError, getErrorDetails]);

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

  const owners = useMemo(() => {
    const ownerSet = new Set<string>();
    if (selectedToken?.login) {
      ownerSet.add(selectedToken.login);
    }
    repoOptions.forEach((repo) => ownerSet.add(repo.owner));
    return Array.from(ownerSet);
  }, [selectedToken, repoOptions]);

  const formEnabled = editing || Boolean(formState.selectedTokenId);

  const refreshSelectPickers = useCallback(() => {
    if (typeof window === 'undefined' || !Selectpicker) {
      return;
    }

    document.querySelectorAll<HTMLSelectElement>('select.selectpicker').forEach((element) => {
      try {
        const instance = (Selectpicker as any).getOrCreateInstance
          ? (Selectpicker as any).getOrCreateInstance(element)
          : new (Selectpicker as any)(element);

        if (instance && typeof instance.refresh === 'function') {
          instance.refresh();
        }
      } catch {
        // ignore refresh errors for now
      }
    });
  }, []);

  useEffect(() => {
    refreshSelectPickers();
  }, [
    refreshSelectPickers,
    githubTokens,
    owners,
    repoOptions,
    runnerGroups,
    formState.labels,
    formState.owner,
    formState.repo,
    formState.runnerGroup,
    formEnabled,
    showDialog,
    editing
  ]);

  const loadGithubTokensList = useCallback(async () => {
    if (!service) {
      return;
    }

    try {
      const tokens = await serviceGet<GithubTokenResponse[]>('/api/github-tokens', 30000);
      setGithubTokens(tokens || []);
    } catch (err) {
      handleError(err);
    }
  }, [service, serviceGet, formatError]);

  const loadExtensionInfo = useCallback(async () => {
    if (!service) {
      return;
    }

    try {
      const info = await serviceGet<NonNullable<typeof extensionInfo>>('/api/extension-info', 30000);
      setExtensionInfo(info);
    } catch (err) {
      handleError(err);
      setExtensionInfo(null);
    }
  }, [service, serviceGet, formatError]);

  const loadLoggingSettings = useCallback(async () => {
    if (!service) {
      return;
    }

    try {
      const settings = await serviceGet<{ uiLoggingEnabled: boolean; runnerLoggingEnabled: boolean; githubApiLoggingEnabled: boolean; startRunnersOnStartup: boolean }>('/api/settings', 30000);
      setUiLoggingEnabled(settings.uiLoggingEnabled);
      setRunnerLoggingEnabled(settings.runnerLoggingEnabled);
      setGithubApiLoggingEnabled(settings.githubApiLoggingEnabled);
      setStartRunnersOnStartup(settings.startRunnersOnStartup);
    } catch (err) {
      handleError(err);
    }
  }, [service, serviceGet, formatError]);

  const saveLoggingSettings = useCallback(async (settings: {
    uiLoggingEnabled: boolean;
    runnerLoggingEnabled: boolean;
    githubApiLoggingEnabled: boolean;
    startRunnersOnStartup?: boolean;
  }) => {
    if (!service) {
      return;
    }

    try {
      await service.post('/api/settings', settings);
    } catch (err) {
      handleError(err);
    }
  }, [service, formatError]);

  const clearVolume = async (volumeName: string, label: string) => {
    if (!service) {
      setError('Unable to access the Docker VM service.');
      return;
    }

    openConfirmDialog(
      `Clear ${label} volume`,
      `WARNING: This will remove all data from the ${label} persistent volume. Continue?`,
      async () => {
        setError(null);
        setBackendMessage(`Clearing ${label} data...`);
        try {
          await service.post('/api/clear-volume', { name: volumeName });
          await loadExtensionInfo();
          setBackendMessage(`${label} volume cleared successfully.`);
        } catch (err) {
          handleError(err);
          setBackendMessage(null);
        }
      },
      'Clear volume',
      'btn-danger'
    );
  };

  const updateRunners = async () => {
    if (!service) {
      setError('Unable to access the Docker VM service.');
      return;
    }

    openConfirmDialog(
      'Update runners',
      'Refresh the Runner Host to update runner binaries for existing runners.',
      async () => {
        setError(null);
        setBackendMessage('Updating runners...');
        try {
          await service.post('/api/host-refresh', {});
          await loadExtensionInfo();
          setBackendMessage('Runner update completed.');
        } catch (err) {
          handleError(err);
          setBackendMessage(null);
        }
      },
      'Update runners',
      'btn-primary'
    );
  };

  const loadLogs = useCallback(async () => {
    if (!service) {
      return;
    }

    setLogsLoading(true);
    try {
      const response = await serviceGet<{ logs: string }>('/api/logs', 30000);
      setLogsContent(response.logs || '');
    } catch (err) {
      handleError(err);
      setLogsContent('Unable to load logs.');
    } finally {
      setLogsLoading(false);
    }
  }, [service, serviceGet, formatError]);

  const copyLogs = async () => {
    try {
      await navigator.clipboard.writeText(logsContent || '');
      setLogsCopied(true);
      setTimeout(() => setLogsCopied(false), 2000);
    } catch (err) {
      setError('Unable to copy logs to clipboard.');
    }
  };

  const clearLogs = async () => {
    if (!service) {
      setError('Unable to access the Docker VM service.');
      return;
    }

    openConfirmDialog(
      'Clear logs',
      'This will clear the extension log file. Continue?',
      async () => {
        setError(null);
        setBackendMessage('Clearing logs...');
        try {
          await service.post('/api/logs/clear', {});
          setLogsContent('');
          setBackendMessage('Logs cleared.');
        } catch (err) {
          handleError(err);
          setBackendMessage(null);
        }
      },
      'Clear logs',
      'btn-danger'
    );
  };

  const loadReposForToken = useCallback(async (tokenId: string) => {
    if (!service) {
      return;
    }

    setRepoLoading(true);
    try {
      const repos = await serviceGet<RepoOption[]>(`/api/github-tokens/${encodeURIComponent(tokenId)}/repos`, 30000);
      const repoList = repos || [];
      setRepoOptions(repoList);
      if (repoList.length > 0) {
        setRepoDropdownOpen(true);
      }
    } catch (err) {
      handleError(err);
      setRepoOptions([]);
      setRepoDropdownOpen(false);
    } finally {
      setRepoLoading(false);
    }
  }, [service, serviceGet, formatError]);

  const loadRunnerGroups = useCallback(async (tokenId: string, owner: string, repo: string, isOrg: boolean) => {
    if (!service) {
      return;
    }

    if (!owner || (!isOrg && !repo.trim())) {
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
      handleError(err);
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
      setShowTokenForm(false);
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
      handleError(err);
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
        handleError(err);
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
    const refreshRunners = () => {
      if (document.visibilityState === 'visible') {
        void loadRunners();
      }
    };

    if (typeof window !== 'undefined') {
      document.addEventListener('visibilitychange', refreshRunners);
      window.addEventListener('focus', refreshRunners);
    }

    return () => {
      if (typeof window !== 'undefined') {
        document.removeEventListener('visibilitychange', refreshRunners);
        window.removeEventListener('focus', refreshRunners);
      }
    };
  }, [loadRunners]);

  useEffect(() => {
    if (settingsOpen) {
      void loadGithubTokensList();
      void loadExtensionInfo();
      void loadLoggingSettings();
      const interval = setInterval(() => {
        void loadGithubTokensList();
        void loadExtensionInfo();
      }, 30000);
      return () => clearInterval(interval);
    }
    return undefined;
  }, [settingsOpen, loadGithubTokensList, loadExtensionInfo, loadLoggingSettings]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem('startRunnersOnStartup', JSON.stringify(startRunnersOnStartup));
    window.localStorage.setItem('uiStyle', uiStyle);
    window.localStorage.setItem('uiLoggingEnabled', JSON.stringify(uiLoggingEnabled));
    window.localStorage.setItem('runnerLoggingEnabled', JSON.stringify(runnerLoggingEnabled));
    window.localStorage.setItem('githubApiLoggingEnabled', JSON.stringify(githubApiLoggingEnabled));
  }, [startRunnersOnStartup, uiStyle, uiLoggingEnabled, runnerLoggingEnabled, githubApiLoggingEnabled]);

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
      } else {
        setRepoOptions([]);
        setSelectedRepoOption(null);
      }
    }
  }, [selectedToken, loadReposForToken, editing]);

  useEffect(() => {
    if (!showDialog || editing) {
      return;
    }

    if (!formState.selectedTokenId) {
      setRepoDropdownOpen(false);
    }
  }, [showDialog, editing, formState.selectedTokenId]);

  useEffect(() => {
    if (!editing && selectedToken) {
      void loadRunnerGroups(selectedToken.id, formState.owner, formState.repo, !formState.repo.trim());
    }
  }, [editing, selectedToken, formState.owner, formState.repo, loadRunnerGroups]);

  useEffect(() => {
    if (!showDialog) {
      setRepoDropdownOpen(false);
    }
  }, [showDialog]);

  const openDialog = (runner?: Runner) => {
    if (runner) {
      setEditing(runner);
      setFormState({
        runnerName: runner.runnerName,
        selectedTokenId: '',
        owner: runner.owner,
        repo: runner.repo,
        registrationToken: '',
        labels: runner.labels,
        startOnStartup: runner.startOnStartup
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

  useEffect(() => {
    if (!editing && selectedToken && !formState.runnerName && formState.repo) {
      setFormState((prev) => ({
        ...prev,
        runnerName: prev.runnerName || prev.repo
      }));
    }
  }, [editing, selectedToken, formState.repo, formState.runnerName]);

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
        runnerRootPath: DEFAULT_RUNNER_ROOT_PATH,
        startOnStartup: editing ? formState.startOnStartup : false
      };

      if (editing) {
        await service.put(`/api/runners/${editing.id}`, payload);
        setBackendMessage(`${formState.runnerName} Updated Successfully`);
      } else {
        await service.post('/api/runners', payload);
        setBackendMessage(`${formState.runnerName} Started Successfully`);
      }

      closeDialog();
      await loadRunners();
    } catch (err) {
      const message = formatError(err);
      if (editing) {
        setError(`${formState.runnerName} Failed to Update with error: ${message}`);
      } else {
        setError(`${formState.runnerName} Failed to start with error: ${message}`);
      }
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

  const autoStartRunnerCount = useMemo(
    () => runners.filter((runner) => runner.startOnStartup).length,
    [runners]
  );

  const runAction = async (id: string, action: 'start' | 'stop' | 'restart') => {
    if (!service) {
      setError('Unable to access the Docker VM service.');
      return;
    }

    const runner = runners.find((run) => run.id === id);
    const runnerName = runner?.runnerName ?? 'Runner';
    const actionLabel = action === 'start' ? 'Start' : action === 'stop' ? 'Stop' : 'Restart';
    setError(null);
    setBackendMessage(`${actionLabel}ing ${runnerName}...`);

    try {
      const response = (await service.post(`/api/runners/${id}/${action}`, {})) as { success: true; runnerName: string };
      await delay(1000);
      await loadRunners();
      const name = response.runnerName || runnerName;
      setBackendMessage(`${name} ${action === 'start' ? 'Started Successfully' : action === 'stop' ? 'Stopped Successfully' : 'Restarted Successfully'}`);
    } catch (err) {
      const message = formatError(err);
      setError(`${runnerName} failed to ${action} with error: ${message}`);
      setBackendMessage(null);
    }
  };

  const runAllAction = async (action: 'start' | 'stop' | 'restart') => {
    if (!service) {
      setError('Unable to access the Docker VM service.');
      return;
    }

    const actionLabel = action === 'start' ? 'starting' : action === 'stop' ? 'stopping' : 'restarting';
    const perform = async () => {
      setError(null);
      setBackendMessage(`Performing ${actionLabel} on all runners...`);

      try {
        const response = (await service.post(`/api/runners/all/${action}`, {})) as {
          success: true;
          results: Array<{ id: string; runnerName: string; success: boolean; error?: string }>;
        };
        await delay(1000);
        await loadRunners();
        const results = response.results || [] as Array<{ id: string; runnerName: string; success: boolean; error?: string }>;
        const successCount = results.filter((result) => result.success).length;
        const failureResults = results.filter((result) => !result.success);

        if (successCount > 0) {
          setBackendMessage(`${successCount} runner${successCount === 1 ? '' : 's'} ${action === 'start' ? 'started' : action === 'stop' ? 'stopped' : 'restarted'} successfully.`);
        } else {
          setBackendMessage(null);
        }

        if (failureResults.length > 0) {
          const firstError = failureResults[0].error || 'unknown error';
          setError(`${failureResults.length} runner${failureResults.length === 1 ? '' : 's'} failed to ${action} with error: ${firstError}`);
        }
      } catch (err) {
        handleError(err);
        setBackendMessage(null);
      }
    };

    if (action === 'stop' || action === 'restart') {
      const prompt =
        action === 'stop'
          ? 'Stop all runners now? Existing jobs may be interrupted.'
          : 'Restart all runners now? This will stop and then start every runner.';
      openConfirmDialog(
        action === 'stop' ? 'Stop all runners' : 'Restart all runners',
        prompt,
        perform,
        action === 'stop' ? 'Stop all' : 'Restart all',
        action === 'stop' ? 'btn-danger' : 'btn-warning'
      );
      return;
    }

    await perform();
  };

  const refreshHostContainer = async () => {
    if (!service) {
      setError('Unable to access the Docker VM service.');
      return;
    }

    openConfirmDialog(
      'Refresh host container',
      'This will recreate the host container and preserve existing runner data. Continue?',
      async () => {
        setError(null);
        setBackendMessage('Refreshing host container...');

        try {
          await service.post('/api/host-refresh', {});
          await loadRunners();
          setBackendMessage('Runner Host Container was successfully updated');
        } catch (err) {
          const message = formatError(err);
          setError(`Runner Host Container failed to update with error: ${message}`);
          setBackendMessage(null);
        }
      },
      'Refresh host',
      'btn-warning'
    );
  };

  const deleteRunner = async (id: string) => {
    if (!service) {
      setError('Unable to access the Docker VM service.');
      return;
    }

    openConfirmDialog(
      'Delete runner',
      'Delete this runner and remove its directory from the host container?',
      async () => {
        setError(null);

        try {
          await service.delete(`/api/runners/${id}`);
          await loadRunners();
        } catch (err) {
          handleError(err);
        }
      },
      'Delete runner',
      'btn-danger'
    );
  };

  return (
    <div className="container py-4 h-100">
      <div className="d-flex flex-column">
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
            className="btn btn-info" 
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
              setSettingsTab('general');
              setSettingsOpen(true);
            }}
            aria-label="Settings"
            data-bs-toggle="tooltip"
            title="Settings"
          >
            <FontAwesomeIcon icon={faGear} fixedWidth />
          </button>
          <button
            type="button"
            className={`btn btn-${logsOpen ? 'secondary' : 'outline-secondary'}`}
            onClick={() => {
              const nextValue = !logsOpen;
              setLogsOpen(nextValue);
              if (nextValue) {
                void loadLogs();
              }
            }}
            aria-label="Toggle logs panel"
            data-bs-toggle="tooltip"
            title="Toggle log panel"
          >
            Logs
          </button>
        </div>
      </div>

      {error ? <div className="alert alert-danger">{error}</div> : null}
      {errorDetails ? (
        <div className="mb-3">
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary"
            onClick={() => setErrorDetailsOpen((current) => !current)}
          >
            {errorDetailsOpen ? 'Hide error details' : 'Show error details'}
          </button>
          {errorDetailsOpen ? (
            <pre className="mt-2 p-3 bg-light text-dark rounded" style={{ whiteSpace: 'pre-wrap', fontSize: '0.9rem' }}>
              {errorDetails}
            </pre>
          ) : null}
        </div>
      ) : null}
      {backendMessage && !error ? <div className="alert alert-info">{backendMessage}</div> : null}
      {loading && !runners.length ? (
        <div className="alert alert-info d-flex align-items-center" role="status">
          <div className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></div>
          <div>Loading runners, please wait...</div>
        </div>
      ) : loading ? (
        <div className="alert alert-info d-flex align-items-center" role="status">
          <div className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></div>
          <div>Refreshing runner status...</div>
        </div>
      ) : null}
      {logsOpen ? (
        <div className="card mb-3">
          <div className="card-header d-flex justify-content-between align-items-center">
            <span>Extension Log Panel</span>
            <div className="btn-group btn-group-sm">
              <button
                type="button"
                className="btn btn-outline-secondary"
                onClick={() => {
                  void loadLogs();
                }}
              >
                Refresh
              </button>
              <button
                type="button"
                className="btn btn-outline-secondary"
                onClick={copyLogs}
                disabled={!logsContent}
              >
                {logsCopied ? 'Copied' : 'Copy'}
              </button>
              <button
                type="button"
                className="btn btn-outline-danger"
                onClick={clearLogs}
              >
                Clear
              </button>
            </div>
          </div>
          <div className="card-body p-3 bg-dark text-white" style={{ minHeight: '220px', whiteSpace: 'pre-wrap', fontFamily: 'monospace', overflowY: 'auto' }}>
            {logsLoading ? 'Loading logs...' : logsContent || 'No logs available.'}
          </div>
        </div>
      ) : null}
      {autoStartRunnerCount > 0 ? (
        <div className="mb-3">
          <span className="badge bg-info text-dark">
            {autoStartRunnerCount} runner{autoStartRunnerCount === 1 ? '' : 's'} configured to auto-start
          </span>
        </div>
      ) : null}

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
            className="btn btn-warning"
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
                  <ul className="nav nav-tabs mb-4" role="tablist">
                    <li className="nav-item" role="presentation">
                      <button
                        type="button"
                        className={`nav-link ${settingsTab === 'general' ? 'active' : ''}`}
                        onClick={() => setSettingsTab('general')}
                        role="tab"
                        aria-selected={settingsTab === 'general'}
                      >
                        General
                      </button>
                    </li>
                    <li className="nav-item" role="presentation">
                      <button
                        type="button"
                        className={`nav-link ${settingsTab === 'tools' ? 'active' : ''}`}
                        onClick={() => setSettingsTab('tools')}
                        role="tab"
                        aria-selected={settingsTab === 'tools'}
                      >
                        Tools
                      </button>
                    </li>
                    <li className="nav-item" role="presentation">
                      <button
                        type="button"
                        className={`nav-link ${settingsTab === 'tokens' ? 'active' : ''}`}
                        onClick={() => setSettingsTab('tokens')}
                        role="tab"
                        aria-selected={settingsTab === 'tokens'}
                      >
                        GitHub Tokens
                      </button>
                    </li>
                    <li className="nav-item" role="presentation">
                      <button
                        type="button"
                        className={`nav-link ${settingsTab === 'info' ? 'active' : ''}`}
                        onClick={() => setSettingsTab('info')}
                        role="tab"
                        aria-selected={settingsTab === 'info'}
                      >
                        Info
                      </button>
                    </li>
                  </ul>

                  <div className="tab-content">
                    <div className={`tab-pane fade ${settingsTab === 'general' ? 'show active' : ''}`} role="tabpanel">
                      <h6>General settings</h6>
                      <p className="text-muted">Configure startup behavior and UI preferences.</p>
                      <div className="row gy-3">
                        <div className="col-12 col-md-6">
                          <div className="card p-3">
                            <div className="form-check form-switch mb-3">
                              <input
                                className="form-check-input"
                                type="checkbox"
                                id="startRunnersOnStartup"
                                checked={startRunnersOnStartup}
                                onChange={async (event) => {
                                  const nextValue = event.target.checked;
                                  setStartRunnersOnStartup(nextValue);
                                  await saveLoggingSettings({
                                    uiLoggingEnabled,
                                    runnerLoggingEnabled,
                                    githubApiLoggingEnabled,
                                    startRunnersOnStartup: nextValue
                                  });
                                }}
                              />
                              <label className="form-check-label" htmlFor="startRunnersOnStartup">
                                Start runners on Docker startup
                              </label>
                            </div>
                            <p className="mb-0 text-muted">Start runners when Docker Desktop starts-up. You will be able to disable this per runner.</p>
                          </div>
                        </div>
                        <div className="col-12 col-md-6">
                          <div className="card p-3">
                            <h6 className="mb-2">UI Style</h6>
                            <div className="form-check">
                              <input
                                className="form-check-input"
                                type="radio"
                                name="uiStyle"
                                id="uiStyleLight"
                                value="light"
                                checked={uiStyle === 'light'}
                                onChange={() => setUiStyle('light')}
                              />
                              <label className="form-check-label" htmlFor="uiStyleLight">Light</label>
                            </div>
                            <div className="form-check">
                              <input
                                className="form-check-input"
                                type="radio"
                                name="uiStyle"
                                id="uiStyleDark"
                                value="dark"
                                checked={uiStyle === 'dark'}
                                onChange={() => setUiStyle('dark')}
                              />
                              <label className="form-check-label" htmlFor="uiStyleDark">Dark</label>
                            </div>
                            <div className="form-check">
                              <input
                                className="form-check-input"
                                type="radio"
                                name="uiStyle"
                                id="uiStyleSystem"
                                value="system"
                                checked={uiStyle === 'system'}
                                onChange={() => setUiStyle('system')}
                              />
                              <label className="form-check-label" htmlFor="uiStyleSystem">System</label>
                            </div>
                            <p className="mb-0 text-muted">Choose your UI appearance preference.</p>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className={`tab-pane fade ${settingsTab === 'tools' ? 'show active' : ''}`} role="tabpanel">
                      <h6>Tools</h6>
                      <p className="text-muted">Manage runner host updates, persistent volume data, and logging.</p>
                      <div className="mb-3">
                        <button type="button" className="btn btn-warning me-2" onClick={refreshHostContainer}>
                          Refresh Runner Host Container
                        </button>
                        <p className="mb-1 text-muted small">Refresh the Runner Host to apply any updates to the container.</p>
                      </div>
                      <div className="mb-3">
                        <button
                          type="button"
                          className={`btn ${extensionInfo?.runnerVersionMismatch ? 'btn-primary' : 'btn-secondary'}`}
                          disabled={!extensionInfo?.runnerVersionMismatch}
                          onClick={updateRunners}
                        >
                          {extensionInfo?.runnerVersionMismatch ? 'Update Runners' : 'Up to Date'}
                        </button>
                        <p className="mb-1 text-muted small">
                          {extensionInfo ? `Runner base version: ${extensionInfo.runnerBaseVersion || 'unknown'}` : 'Loading runner version info...'}
                        </p>
                        {extensionInfo ? (
                          <p className="mb-0 text-muted small">
                            {extensionInfo.runnerVersionMismatch ? `${extensionInfo.runnerVersionsOutOfDate} runner(s) need update.` : 'All runners up to date.'}
                          </p>
                        ) : null}
                      </div>
                      <div className="mb-3">
                        <button type="button" className="btn btn-danger me-2" onClick={() => clearVolume('gh-runner-manager-runners', 'Runners')}>
                          Clear all data from Runners Volume
                        </button>
                        <p className="mb-1 text-muted small">WARNING: This will remove all runner data from the persistent volume.</p>
                      </div>
                      <div className="mb-3">
                        <button type="button" className="btn btn-danger me-2" onClick={() => clearVolume('gh-runner-manager-data', 'Data')}>
                          Clear all data from Data Volume
                        </button>
                        <p className="mb-1 text-muted small">WARNING: This will remove all extension data from the persistent volume.</p>
                      </div>
                      <div className="card p-3">
                        <h6 className="mb-2">Logging</h6>
                        <p className="mb-3 text-muted">All logs will be saved here.</p>
                        <div className="form-check form-switch mb-2">
                          <input
                            className="form-check-input"
                            type="checkbox"
                            id="uiLoggingEnabled"
                            checked={uiLoggingEnabled}
                            onChange={async (event) => {
                              const nextValue = event.target.checked;
                              setUiLoggingEnabled(nextValue);
                              await saveLoggingSettings({
                                uiLoggingEnabled: nextValue,
                                runnerLoggingEnabled,
                                githubApiLoggingEnabled,
                                startRunnersOnStartup
                              });
                            }}
                          />
                          <label className="form-check-label" htmlFor="uiLoggingEnabled">Enable UI Logging</label>
                        </div>
                        <p className="mb-2 text-muted">Enable UI logging to help with trouble shooting.</p>
                        <div className="form-check form-switch mb-2">
                          <input
                            className="form-check-input"
                            type="checkbox"
                            id="runnerLoggingEnabled"
                            checked={runnerLoggingEnabled}
                            onChange={async (event) => {
                              const nextValue = event.target.checked;
                              setRunnerLoggingEnabled(nextValue);
                              await saveLoggingSettings({
                                uiLoggingEnabled,
                                runnerLoggingEnabled: nextValue,
                                githubApiLoggingEnabled,
                                startRunnersOnStartup
                              });
                            }}
                          />
                          <label className="form-check-label" htmlFor="runnerLoggingEnabled">Enable Runner Logging</label>
                        </div>
                        <p className="mb-2 text-muted">Enable Runner logging for trouble shooting.</p>
                        <div className="form-check form-switch">
                          <input
                            className="form-check-input"
                            type="checkbox"
                            id="githubApiLoggingEnabled"
                            checked={githubApiLoggingEnabled}
                            onChange={async (event) => {
                              const nextValue = event.target.checked;
                              setGithubApiLoggingEnabled(nextValue);
                              await saveLoggingSettings({
                                uiLoggingEnabled,
                                runnerLoggingEnabled,
                                githubApiLoggingEnabled: nextValue,
                                startRunnersOnStartup
                              });
                            }}
                          />
                          <label className="form-check-label" htmlFor="githubApiLoggingEnabled">Enable GitHub API Logging</label>
                        </div>
                        <p className="mb-0 text-muted">Enable GitHub API logging for trouble shooting.</p>
                        <div className="mt-3">
                          <button type="button" className="btn btn-outline-secondary btn-sm me-2" onClick={() => { setLogsOpen(!logsOpen); if (!logsOpen) { void loadLogs(); } }}>
                            {logsOpen ? 'Hide logs' : 'View logs'}
                          </button>
                          <button type="button" className="btn btn-outline-danger btn-sm" onClick={clearLogs}>
                            Clear logs
                          </button>
                        </div>
                        {logsOpen ? (
                          <div className="mt-3">
                            <div className="card bg-dark text-white" style={{ minHeight: '200px', whiteSpace: 'pre-wrap', fontFamily: 'monospace', overflowY: 'auto', padding: '1rem' }}>
                              {logsLoading ? 'Loading logs...' : logsContent || 'No logs available.'}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div className={`tab-pane fade ${settingsTab === 'tokens' ? 'show active' : ''}`} role="tabpanel">
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

                      {!showTokenForm ? (
                        <div>
                          <button type="button" className="btn btn-primary" onClick={() => setShowTokenForm(true)}>
                            Add new token
                          </button>
                        </div>
                      ) : (
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
                          <div className="d-flex gap-2">
                            <button type="button" className="btn btn-primary" onClick={createGithubToken} data-bs-toggle="tooltip" title="Save token">
                              Save token
                            </button>
                            <button type="button" className="btn btn-secondary" onClick={() => {
                              setShowTokenForm(false);
                              setTokenFormName('');
                              setTokenFormValue('');
                              setTokenFormError(null);
                              setTokenActionMessage(null);
                            }}>
                              Cancel
                            </button>
                          </div>
                          <div className="mt-3 text-muted small">
                            <p className="mb-1">Recommended permissions:</p>
                            <p className="mb-0">• repo (full repository access for private repos)</p>
                            <p className="mb-0">• read:org (if using organization-owned runners)</p>
                            <p className="mb-0">• workflow (optional, for workflow-related access if needed)</p>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className={`tab-pane fade ${settingsTab === 'info' ? 'show active' : ''}`} role="tabpanel">
                      <h6>Extension information</h6>
                      <p className="text-muted">Core metadata and health status for the extension environment.</p>

                      <div className="row gy-3">
                        <div className="col-12 col-md-6">
                          <div className="card p-3">
                            <h6 className="mb-2">Extension details</h6>
                            <p className="mb-1"><strong>Name:</strong> {extensionInfo?.extensionName || 'GH Runner'}</p>
                            <p className="mb-1"><strong>Version:</strong> {extensionInfo?.extensionVersion || process.env.npm_package_version || '1.0.0'}</p>
                            <p className="mb-1"><strong>Author:</strong> {extensionInfo?.extensionAuthor || 'MrTrilB'}</p>
                            <p className="mb-0"><strong>Documentation:</strong>{' '}
                              {extensionInfo?.documentationUrl ? (
                                <a href={extensionInfo.documentationUrl} target="_blank" rel="noreferrer">View docs</a>
                              ) : 'Not available'}
                            </p>
                          </div>
                        </div>

                        <div className="col-12 col-md-6">
                          <div className="card p-3">
                            <h5 className="mb-2">Health summary</h5>
                            <div className="mb-4">
                              <div className="d-flex align-items-center gap-2 mb-2">
                                <h6 className="h6 mb-0">Github API</h6>
                                <span className={`badge ${extensionInfo?.githubApiConnection.status === 'up' ? 'bg-success' : 'bg-danger'}`}>
                                  {extensionInfo?.githubApiConnection.status === 'up' ? 'Up' : 'Down'}
                                </span>
                              </div>
                              <p className="mb-0 text-muted">Checks that GitHub’s public API is reachable from the extension environment.</p>
                            </div>
                            <div className="mb-4">
                              <div className="d-flex align-items-center gap-2 mb-2">
                                <h6 className="h6 mb-0">Service Container</h6>
                                <span className={`badge ${extensionInfo?.serviceContainer.status === 'up' ? 'bg-success' : 'bg-danger'}`}>
                                  {extensionInfo?.serviceContainer.status === 'up' ? 'Up' : 'Down'}
                                </span>
                              </div>
                              <p className="mb-0 text-muted">Verifies the Docker host container for the extension is running and available.</p>
                            </div>
                            <div className="mb-4">
                              <div className="d-flex align-items-center gap-2 mb-2">
                                <h6 className="h6 mb-0">GitHub Runners Container</h6>
                                <span className={`badge ${extensionInfo?.runnerContainer.status === 'up' ? 'bg-success' : 'bg-danger'}`}>
                                  {extensionInfo?.runnerContainer.status === 'up' ? 'Up' : 'Down'}
                                </span>
                              </div>
                              <p className="mb-0 text-muted">Checks whether the GitHub Runners container is installed and ready.</p>
                            </div>
                            <div className="mb-4">
                              <div className="d-flex align-items-center gap-2 mb-2">
                                <h6 className="h6 mb-0">Data Volume</h6>
                                <span className={`badge ${extensionInfo?.dataVolumeExists ? 'bg-success' : 'bg-danger'}`}>
                                  {extensionInfo?.dataVolumeExists ? 'Up' : 'Down'}
                                </span>
                              </div>
                              <p className="mb-0 text-muted">Confirms the extension data volume is present for persistent backend state.</p>
                            </div>
                            <div>
                              <div className="d-flex align-items-center gap-2 mb-2">
                                <h6 className="h6 mb-0">Runner Volume</h6>
                                <span className={`badge ${extensionInfo?.runnerVolumeExists ? 'bg-success' : 'bg-danger'}`}>
                                  {extensionInfo?.runnerVolumeExists ? 'Up' : 'Down'}
                                </span>
                              </div>
                              <p className="mb-0 text-muted">Ensures the runner volume is available for storing GitHub Actions runner state.</p>
                            </div>
                          </div>
                        </div>
                      </div>
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
                        <div className="text-muted small">
                          {runner.owner}/{runner.repo || '(org)'}
                        </div>
                      </div>
                      <span className={`badge justify-content-end ${runner.status === 'on' ? 'bg-success' : 'bg-danger'}`}>
                        {runner.status === 'on' ? 'Running' : 'Stopped'}
                      </span>
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
                  <div className="row align-items-center mb-3">
                    <div className="col-12 col-md-6 d-flex align-items-center">
                      <div className="form-check form-switch mb-0">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          disabled={!startRunnersOnStartup}
                          id={`startOnStartup-${runner.id}`}
                          checked={Boolean(runner.startOnStartup)}
                          onChange={async (event) => {
                            const nextValue = event.target.checked;
                            try {
                              await service?.put(`/api/runners/${encodeURIComponent(runner.id)}`, { startOnStartup: nextValue });
                              setRunners((prev) => prev.map((item) => item.id === runner.id ? { ...item, startOnStartup: nextValue } : item));
                            } catch (err) {
                              handleError(err);
                            }
                          }}
                        />
                        <label className="form-check-label small mb-0" htmlFor={`startOnStartup-${runner.id}`}>
                          Start on startup
                        </label>
                      </div>
                    </div>
                    <div className="col-12 col-md-6 d-flex justify-content-md-end mt-3 mt-md-0">
                      <div className="btn-group btn-group-sm" style={{ paddingRight: '10px' }}>
                        <button type="button" className="btn btn-primary" disabled={runner.status === 'on'} onClick={() => runAction(runner.id, 'start')} data-bs-toggle="tooltip" title="Start">
                          <FontAwesomeIcon icon={faPlay} fixedWidth />
                        </button>
                        <button type="button" className="btn btn-danger" disabled={runner.status !== 'on'} onClick={() => runAction(runner.id, 'stop')} data-bs-toggle="tooltip" title="Stop">
                          <FontAwesomeIcon icon={faStop} fixedWidth />
                        </button>
                        <button type="button" className="btn btn-warning" disabled={runner.status !== 'on'} onClick={() => runAction(runner.id, 'restart')} data-bs-toggle="tooltip" title="Restart">
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
                      <p className="mb-0"><strong></strong></p>
                      <p className="mb-1"><strong>Created:</strong> {new Date(runner.createdAt).toLocaleString()}</p>
                      <p className="mb-1"><strong>Runner path:</strong> {runner.runnerPath}</p>
                      <p className="mb-0"><strong>Runner Version:</strong> {runner.runnerVersion || 'unknown'}</p>
                      <p className="mb-1"><strong>Labels:</strong> {runner.labels.join(', ')}</p>
                    </div>
                    <div className="col-12 col-md-6">
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
                  {!editing && (
                    <div className="mb-3">
                      <label className="form-label" htmlFor="GithubAPITokenSelect">GitHub API token</label>
                      <select
                        className="selectpicker show-tick"
                        data-live-search="true"
                        id="GithubAPITokenSelect"
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
                    <label className="form-label" htmlFor="runnerOwner">Owner / organization</label>
                    <select
                      className="selectpicker show-tick"
                      data-live-search="true"
                      id="runnerOwner"
                      value={formState.owner}
                      onChange={(event) => {
                        setFormState({ ...formState, owner: event.target.value, repo: '' });
                        setSelectedRepoOption(null);
                      }}
                      disabled={!formEnabled}
                    >
                      <option value="">Select an owner</option>
                      {owners.map((owner) => (
                        <option key={owner} value={owner}>{owner}</option>
                      ))}
                    </select>
                    <div className="form-text">
                      {editing
                        ? 'Owner set for this runner and cannot be changed from this edit view.'
                        : 'Derived from the selected token or selected repository. Edit for org or alternate owner.'}
                    </div>
                  </div>

                  <div className="mb-3">
                    <label className="form-label" htmlFor="repoSelect">Repository</label>
                    <select
                      id="repoSelect"
                      className="selectpicker show-tick"
                      data-live-search="true"
                      data-live-search-placeholder="Search repositories"
                      title="Select a repository"
                      disabled={!formEnabled || repoOptions.length === 0}
                      value={selectedRepoOption ? `${selectedRepoOption.owner}/${selectedRepoOption.name}` : formState.repo ? `${formState.owner}/${formState.repo}` : ''}
                      onChange={(event) => {
                        const value = event.target.value;
                        if (!value) {
                          setFormState((prev) => ({
                            ...prev,
                            repo: '',
                            runnerGroup: undefined
                          }));
                          setSelectedRepoOption(null);
                          return;
                        }
                        const [owner, repoName] = value.split('/');
                        const repo = repoOptions.find((item) => item.owner === owner && item.name === repoName) ?? null;
                        setFormState((prev) => ({
                          ...prev,
                          owner,
                          repo: repoName,
                          runnerGroup: prev.runnerGroup,
                          runnerName: (!prev.runnerName || prev.runnerName === prev.repo) ? repoName : prev.runnerName
                        }));
                        setSelectedRepoOption(repo);
                      }}
                    >
                      <option value="">Organization-level runner</option>
                      {repoOptions.map((repo) => (
                        <option key={repo.id} value={`${repo.owner}/${repo.name}`}>
                          {repo.full_name}
                        </option>
                      ))}
                    </select>
                    <div className="form-text">Search repositories for the selected owner using GitHub. Leave blank for an organization-level runner.</div>
                  </div>

                  <div className="mb-3">
                    <label className="form-label" htmlFor="runnerGroupSelect">Runner group</label>
                    <select
                      id="runnerGroupSelect"
                      className="selectpicker show-tick"
                      data-live-search="true"
                      disabled={!formEnabled || runnerGroups.length === 0}
                      value={formState.runnerGroup || ''}
                      onChange={(event) => setFormState({ ...formState, runnerGroup: event.target.value })}
                    >
                      <option value="">No runner group</option>
                      {runnerGroups.map((group) => (
                        <option key={group.id} value={group.name}>
                          {group.name}
                        </option>
                      ))}
                    </select>
                    <div className="form-text">Optional runner group for organization or repository runners.</div>
                  </div>

                  <div className="mb-3">
                    <label className="form-label">Runner name</label>
                    <input
                      type="text"
                      className="form-control"
                      value={formState.runnerName}
                      disabled={!formEnabled}
                      onChange={(event) => setFormState({ ...formState, runnerName: event.target.value })}
                      placeholder="Runner name"
                    />
                    <div className="form-text">A local identifier for this runner. It becomes the runner directory name inside the host container.</div>
                  </div>

                  <div className="mb-3 form-check form-switch">
                    <input
                      className="form-check-input"
                      type="checkbox"
                      id="runnerStartOnStartup"
                      checked={Boolean(formState.startOnStartup)}
                      onChange={(event) => setFormState({ ...formState, startOnStartup: event.target.checked })}
                    />
                    <label className="form-check-label" htmlFor="runnerStartOnStartup">
                      Start this runner on Docker startup
                    </label>
                    <div className="form-text">If enabled, this runner will be started automatically when the Docker backend starts and the global startup setting is enabled.</div>
                  </div>

                  <div className="mb-3">
                    <label className="form-label">Runner labels</label>
                    <select
                      className="selectpicker show-tick"
                      multiple
                      data-live-search="true"
                      data-show-selected-tags="true"
                      data-open-options="true"
                      data-live-search-placeholder="Search or create tags"
                      title="Search or create tags"
                      disabled={!formEnabled}
                      value={formState.labels}
                      onChange={(event) => {
                        const selected = Array.from(event.target.selectedOptions).map((option) => option.value);
                        setFormState({ ...formState, labels: selected });
                      }}
                    >
                      {labelOptions.map((label) => (
                        <option key={label} value={label}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <div className="form-text">Select one or more labels used by GitHub workflows to target this runner.</div>
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
      {confirmState?.open && (
        <>
          <div className="modal fade show" style={{ display: 'block' }} tabIndex={-1} aria-modal="true" role="dialog">
            <div className="modal-dialog modal-dialog-centered">
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">{confirmState.title}</h5>
                  <button type="button" className="btn-close" aria-label="Close" onClick={closeConfirmDialog} />
                </div>
                <div className="modal-body">
                  <p>{confirmState.body}</p>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={closeConfirmDialog}>
                    Cancel
                  </button>
                  <button type="button" className={`btn ${confirmState.confirmVariant}`} onClick={handleConfirm}>
                    {confirmState.confirmLabel}
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div className="modal-backdrop fade show" />
        </>
      )}
    </div>
  </div>
  );
}
