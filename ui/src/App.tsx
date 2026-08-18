import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Tooltip from 'bootstrap/js/dist/tooltip';
import Collapse from 'bootstrap/js/dist/collapse';
import Selectpicker from '@crestapps/bootstrap-select/dist/js/bootstrap-select.esm.mjs';
import { createDockerDesktopClient } from '@docker/extension-api-client';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import './App.css';
import {
  faGear,
  faPlay,
  faStop,
  faRotateRight,
  faPlus,
  faPen,
  faTrash,
  faSync,
  faChevronUp,
  faChevronDown,
} from '@fortawesome/free-solid-svg-icons';
import { faGithub } from '@fortawesome/free-brands-svg-icons';

const client = createDockerDesktopClient();

interface RunnerConfig {
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
  const [settingsTab, setSettingsTab] = useState<'general' | 'tools' | 'auth' | 'info'>('general');
  const tokenSelectRef = useRef<HTMLSelectElement | null>(null);
  const ownerSelectRef = useRef<HTMLSelectElement | null>(null);
  const repoSelectRef = useRef<HTMLSelectElement | null>(null);
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
  const [language, setLanguage] = useState<string>(() => {
    if (typeof window === 'undefined') return 'en_GB';
    return window.localStorage.getItem('language') || 'en_GB';
  });
  const [languages, setLanguages] = useState<Array<{ code: string; name: string }>>([]);
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [languageLoading, setLanguageLoading] = useState(false);
  const [languageError, setLanguageError] = useState<string | null>(null);
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
  const [editingGithubTokenId, setEditingGithubTokenId] = useState<string | null>(null);
  const [tokenFormError, setTokenFormError] = useState<string | null>(null);
  const [tokenActionMessage, setTokenActionMessage] = useState<string | null>(null);
  const [showTokenForm, setShowTokenForm] = useState(false);
  const [githubTokens, setGithubTokens] = useState<GithubTokenResponse[]>([]);
  const [repoOptions, setRepoOptions] = useState<RepoOption[]>([]);
  const [selectedRepoOption, setSelectedRepoOption] = useState<RepoOption | null>(null);
  const [orgRunnerSelected, setOrgRunnerSelected] = useState(false);
  const [saving, setSaving] = useState(false);
  const [repoLoading, setRepoLoading] = useState(false);
  const [repoDropdownOpen, setRepoDropdownOpen] = useState(false);
  const [runnerGroups, setRunnerGroups] = useState<Array<{id:number;name:string}>>([]);
  const [runnerGroupLoading, setRunnerGroupLoading] = useState(false);
  const [runnerGroupError, setRunnerGroupError] = useState<string | null>(null);

  const service = ddClient.extension.vm?.service;

  const collapseStateStorageKey = 'github-runner-manager-collapse-state';

  const toggleCollapse = useCallback((event: { currentTarget: HTMLButtonElement }) => {
    const targetSelector = event.currentTarget.getAttribute('data-bs-target');
    if (!targetSelector) return;

    const target = document.querySelector(targetSelector);
    if (!(target instanceof HTMLElement)) return;

    const collapse = Collapse.getOrCreateInstance(target, { toggle: false });
    const targetId = target.getAttribute('id');
    let openCollapseIds: string[] = [];
    if (targetId && typeof window !== 'undefined') {
      try {
        const storedState = JSON.parse(window.localStorage.getItem(collapseStateStorageKey) || '[]');
        openCollapseIds = Array.isArray(storedState) ? storedState.filter((id): id is string => typeof id === 'string') : [];
      } catch {
        openCollapseIds = [];
      }
    }

    if (target.classList.contains('show')) {
      collapse.hide();
      event.currentTarget.setAttribute('aria-expanded', 'false');
      event.currentTarget.classList.add('collapsed');
      if (targetId) {
        openCollapseIds = openCollapseIds.filter((id) => id !== targetId);
      }
    } else {
      collapse.show();
      event.currentTarget.setAttribute('aria-expanded', 'true');
      event.currentTarget.classList.remove('collapsed');
      if (targetId && !openCollapseIds.includes(targetId)) {
        openCollapseIds.push(targetId);
      }
    }

    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(collapseStateStorageKey, JSON.stringify(openCollapseIds));
      } catch {
      }
    }
  }, []);

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
    const timeoutMessage = t('The backend did not respond in time. The extension backend may still be starting. Please wait a moment and try again.');

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
          return t('An unknown error occurred.');
        }
      }

      return t('An unknown error occurred.');
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

    return t('An unknown error occurred.');
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

  const reportError = useCallback((err: unknown, context?: string) => {
    const message = formatError(err);
    const details = getErrorDetails(err);

    setError(message);
    setErrorDetails(details);
    setErrorDetailsOpen(true);
    setBackendMessage(null);

    if (typeof console !== 'undefined') {
      console.error(t('App error'), context || 'unknown', err);
    }
  }, [formatError, getErrorDetails]);

  const handleError = useCallback((err: unknown) => {
    reportError(err);
  }, [reportError]);

  const delay = useCallback((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)), []);

  const isBackendStartupError = useCallback((err: unknown) => {
    if (err instanceof Error) {
      return err.name === 'HeadersTimeoutError' || err.message.includes(t('Headers Timeout'));
    }
    if (typeof err === 'string') {
      return err.includes(t('Headers Timeout'));
    }
    if (typeof err === 'object' && err !== null) {
      const anyErr = err as Record<string, unknown>;
      const name = String(anyErr.name || '');
      const message = String(anyErr.message || '');
      return name === 'HeadersTimeoutError' || message.includes(t('Headers Timeout'));
    }
    return false;
  }, []);

  const serviceGet = useCallback(async <T,>(path: string, timeoutMs = 30000): Promise<T> => {
    if (!service) {
      throw new Error('Unable to access the Docker VM service.');
    }

    const timeoutPromise = new Promise<T>((_, reject) => {
      const err = new Error(t('Headers Timeout Error'));
      err.name = 'HeadersTimeoutError';
      setTimeout(() => reject(err), timeoutMs);
    });

    return await Promise.race([service.get(path) as Promise<T>, timeoutPromise]);
  }, [service]);

  const servicePost = useCallback(async <T,>(path: string, body: unknown): Promise<T> => {
    if (!service) {
      throw new Error(t('Unable to access the Docker VM service.'));
    }

    return await service.post(path, body) as Promise<T>;
  }, [service]);

  const selectedToken = useMemo(
    () => githubTokens.find((token) => token.id === formState.selectedTokenId) ?? null,
    [githubTokens, formState.selectedTokenId]
  );

  const owners = useMemo(() => {
    const ownerSet = new Set<string>();
    if (editing?.owner) {
      ownerSet.add(editing.owner);
    }
    if (selectedToken?.login) {
      ownerSet.add(selectedToken.login);
    }
    repoOptions.forEach((repo) => ownerSet.add(repo.owner));
    return Array.from(ownerSet);
  }, [selectedToken, repoOptions]);

  const filteredRepoOptions = useMemo(() => {
    if (!formState.owner) {
      return repoOptions;
    }
    return repoOptions.filter((repo) => repo.owner === formState.owner);
  }, [repoOptions, formState.owner]);

  const showOrgRunnerOption = Boolean(formState.owner && formState.repo === '');
  const formEnabled = editing || Boolean(formState.selectedTokenId);
  const hasSelectedToken = Boolean(selectedToken);
  const ownerSelected = Boolean(formState.owner);
  const repositorySelected = Boolean(formState.repo) && !orgRunnerSelected;
  const runnerNameFilled = Boolean(formState.runnerName.trim());
  const isOrgRunnerSelected = orgRunnerSelected;
  const runnerGroupEnabled = formEnabled && isOrgRunnerSelected;
  const showOwnerField = editing || hasSelectedToken;
  const showRepositoryField = editing || ownerSelected;
  const showRunnerGroupField = isOrgRunnerSelected;
  const showRunnerNameField = editing || repositorySelected || isOrgRunnerSelected;
  const showRunnerTagsField = editing || runnerNameFilled;
  const runnerGroupOptions = useMemo(() => {
    if (!formState.runnerGroup || runnerGroups.some((group) => group.name === formState.runnerGroup)) {
      return runnerGroups;
    }

    return [{ id: -1, name: formState.runnerGroup }, ...runnerGroups];
  }, [runnerGroups, formState.runnerGroup]);
  const runnerGroupsByToken = useMemo(() => {
    const tokenMap = new Map<string, Map<string, Runner[]>>();

    runners.forEach((runner) => {
      const tokenName = runner.tokenName || 'Unknown token';
      const ownerMap = tokenMap.get(tokenName) || new Map<string, Runner[]>();
      const ownerRunners = ownerMap.get(runner.owner) || [];
      ownerRunners.push(runner);
      ownerMap.set(runner.owner, ownerRunners);
      tokenMap.set(tokenName, ownerMap);
    });

    return Array.from(tokenMap.entries()).map(([tokenName, ownerMap]) => ({
      tokenName,
      owners: Array.from(ownerMap.entries()).map(([owner, ownerRunners]) => {
        const repositoryMap = new Map<string, Runner[]>();
        ownerRunners.forEach((runner) => {
          const repository = runner.repo || '';
          const repositoryRunners = repositoryMap.get(repository) || [];
          repositoryRunners.push(runner);
          repositoryMap.set(repository, repositoryRunners);
        });

        return {
          owner,
          repositories: Array.from(repositoryMap.entries()).map(([repository, repositoryRunners]) => {
            const runnerGroupMap = new Map<string, Runner[]>();
            repositoryRunners.forEach((runner) => {
              const runnerGroup = runner.runnerGroup || 'No runner group';
              const groupRunners = runnerGroupMap.get(runnerGroup) || [];
              groupRunners.push(runner);
              runnerGroupMap.set(runnerGroup, groupRunners);
            });

            return {
              repository,
              runnerGroups: Array.from(runnerGroupMap.entries()).map(([runnerGroup, groupRunners]) => ({
                runnerGroup,
                runners: groupRunners
              }))
            };
          })
        };
      })
    }));
  }, [runners]);

  useEffect(() => {
    if (typeof window === 'undefined' || !runners.length) {
      return;
    }

    let openCollapseIds: string[];
    try {
      const storedState = JSON.parse(window.localStorage.getItem(collapseStateStorageKey) || '[]');
      openCollapseIds = Array.isArray(storedState) ? storedState.filter((id): id is string => typeof id === 'string') : [];
    } catch {
      openCollapseIds = [];
    }

    openCollapseIds.forEach((targetId) => {
      const target = document.getElementById(targetId);
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const collapse = Collapse.getOrCreateInstance(target, { toggle: false });
      collapse.show();
      const button = document.querySelector(`[data-bs-target="#${targetId}"]`);
      if (button instanceof HTMLElement) {
        button.setAttribute('aria-expanded', 'true');
        button.classList.remove('collapsed');
      }
    });
  }, [runners, runnerGroupsByToken]);

  const repoSelectValue = selectedRepoOption
    ? `${selectedRepoOption.owner}/${selectedRepoOption.name}`
    : formState.repo
      ? `${formState.owner}/${formState.repo}`
      : orgRunnerSelected
        ? '__org__'
        : '';

  const refreshSelectPickers = useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const SelectpickerConstructor = (Selectpicker as any)?.getOrCreateInstance
      ? Selectpicker
      : (window as any).Selectpicker;

    if (!SelectpickerConstructor) {
      console.warn(t('bootstrap-select: Selectpicker constructor unavailable'));
      return;
    }

    const pickerElements = document.querySelectorAll<HTMLSelectElement>('select.selectpicker');
    if (!pickerElements.length) {
      console.warn(t('bootstrap-select: no selectpicker elements found'));
    }

    pickerElements.forEach((element) => {
      try {
        let instance = typeof SelectpickerConstructor.getOrCreateInstance === 'function'
          ? SelectpickerConstructor.getOrCreateInstance(element)
          : null;

        if (!instance) {
          instance = new SelectpickerConstructor(element);
        }

        if (instance) {
          if (typeof instance.refresh === 'function') {
            instance.refresh();
          }
          if (typeof instance.render === 'function') {
            instance.render();
          }
        }
      } catch (err) {
        reportError(err, 'refreshSelectPickers');
      }
    });
  }, [reportError]);

  useLayoutEffect(() => {
    if (!showDialog && !settingsOpen) {
      return;
    }

    refreshSelectPickers();

    const timeoutId = window.setTimeout(() => {
      refreshSelectPickers();
    }, 50);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [showDialog, settingsOpen, refreshSelectPickers]);

  const openSelectpicker = useCallback((select: HTMLSelectElement | null) => {
    if (typeof window === 'undefined') {
      return;
    }

    if (!select) {
      return;
    }

    try {
      const SelectpickerConstructor = (Selectpicker as any)?.getOrCreateInstance
        ? Selectpicker
        : (window as any).Selectpicker;

      if (!SelectpickerConstructor) {
        throw new Error(t('Selectpicker constructor unavailable'));
      }

      const instance = typeof SelectpickerConstructor.getOrCreateInstance === 'function'
        ? SelectpickerConstructor.getOrCreateInstance(select)
        : null;

      if (!instance) {
        return;
      }

      const dropdown = instance.dropdown;

      if (dropdown && typeof dropdown.toggle === 'function') {
        dropdown.toggle();
      } else if (dropdown && typeof dropdown.show === 'function') {
        dropdown.show();
      } else if (typeof instance.open === 'function') {
        instance.open();
      } else if (typeof instance.toggle === 'function') {
        instance.toggle();
      } else if (typeof instance.show === 'function') {
        instance.show();
      }
    } catch (err) {
      reportError(err, 'openSelectpicker');
    }
  }, [reportError]);

  useEffect(() => {
    if (!showDialog && !settingsOpen) {
      return;
    }

    const clickHandler = (event: MouseEvent) => {
      const button = event.currentTarget as HTMLElement;
      const wrapper = button.closest('.bootstrap-select');
      const select = wrapper?.querySelector<HTMLSelectElement>('select.selectpicker')
        || (ownerSelectRef.current && wrapper?.contains(ownerSelectRef.current) ? ownerSelectRef.current : null)
        || (repoSelectRef.current && wrapper?.contains(repoSelectRef.current) ? repoSelectRef.current : null)
        || (tokenSelectRef.current && wrapper?.contains(tokenSelectRef.current) ? tokenSelectRef.current : null);
      openSelectpicker(select);
    };

    const attachListeners = () => {
      const modal = document.querySelector('.modal.show');
      const buttons = modal
        ? Array.from(modal.querySelectorAll<HTMLButtonElement>('.bootstrap-select .dropdown-toggle'))
        : Array.from(document.querySelectorAll<HTMLButtonElement>('.bootstrap-select .dropdown-toggle'));

      buttons.forEach((button) => {
        button.addEventListener('click', clickHandler);
      });

      return buttons;
    };

    refreshSelectPickers();

    const attachedButtons = attachListeners();
    let timeoutId: number | undefined;
    if (!attachedButtons.length) {
      timeoutId = window.setTimeout(() => {
        refreshSelectPickers();
        attachListeners();
      }, 100);
    }

    return () => {
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
      attachedButtons.forEach((button) => {
        button.removeEventListener('click', clickHandler);
      });
    };
  }, [showDialog, settingsOpen, showOwnerField, showRepositoryField, showRunnerGroupField, showRunnerTagsField, refreshSelectPickers, openSelectpicker]);

  useEffect(() => {
    if (showDialog || settingsOpen) {
      refreshSelectPickers();
    }
  }, [refreshSelectPickers, githubTokens, owners, repoOptions, filteredRepoOptions, runnerGroups, formState.labels, formState.owner, formState.repo, formState.runnerGroup, formEnabled, showDialog, settingsOpen, editing, languages, language, languageLoading]);

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
      const settings = await serviceGet<{ uiLoggingEnabled: boolean; runnerLoggingEnabled: boolean; githubApiLoggingEnabled: boolean; startRunnersOnStartup: boolean; language?: string }>('/api/settings', 30000);
      setUiLoggingEnabled(settings.uiLoggingEnabled);
      setRunnerLoggingEnabled(settings.runnerLoggingEnabled);
      setGithubApiLoggingEnabled(settings.githubApiLoggingEnabled);
      setStartRunnersOnStartup(settings.startRunnersOnStartup);
      setLanguage(settings.language || 'en_GB');
    } catch (err) {
      handleError(err);
    }
  }, [service, serviceGet, formatError]);

  const saveLoggingSettings = useCallback(async (settings: {
    uiLoggingEnabled?: boolean;
    runnerLoggingEnabled?: boolean;
    githubApiLoggingEnabled?: boolean;
    startRunnersOnStartup?: boolean;
    language?: string;
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

  const loadLanguages = useCallback(async () => {
    if (!service) {
      return;
    }

    try {
      const response = await serviceGet<{ languages: Array<{ code: string; name: string }> }>('/api/languages', 30000);
      setLanguages(response.languages || []);
    } catch (err) {
      handleError(err);
    }
  }, [service, serviceGet, formatError]);

  const loadTranslationStrings = useCallback(async (lang: string) => {
    if (!service) {
      return;
    }

    setLanguageLoading(true);
    setLanguageError(null);

    try {
      const response = await serviceGet<Record<string, string>>(`/api/translations/${encodeURIComponent(lang)}`, 30000);
      setTranslations(response || {});
    } catch (err) {
      const message = formatError(err);
      setTranslations({});
      setLanguageError(message);
    } finally {
      setLanguageLoading(false);
    }
  }, [service, serviceGet, formatError]);

  const t = useCallback((text: string, args?: Record<string, unknown>) => {
    const translated = translations[text] ?? text;
    if (!args || Object.keys(args).length === 0) {
      return translated;
    }

    return translated.replace(/{([^}]+)}/g, (match, key) => {
      const value = args[key];
      return value === null || value === undefined ? '' : String(value);
    });
  }, [translations]);

  const clearVolume = async (volumeName: string, label: string) => {
    if (!service) {
      setError(t('Unable to access the Docker VM service.'));
      return;
    }

    openConfirmDialog(
      t('Clear {label} volume', { label }),
      t('WARNING: This will remove all data from the {label} persistent volume. Continue?', { label }),
      async () => {
        setError(null);
        setBackendMessage(t('Clearing {label} data...', { label }));
        try {
          await service.post('/api/clear-volume', { name: volumeName });
          if (volumeName === 'gh-runner-manager-runners') {
            await loadRunners();
          }
          await loadExtensionInfo();
          setBackendMessage(t('{label} volume cleared successfully.', { label }));
        } catch (err) {
          handleError(err);
          setBackendMessage(null);
        }
      },
      t('Clear volume'),
      'btn-danger'
    );
  };

  const updateRunners = async () => {
    if (!service) {
      setError(t('Unable to access the Docker VM service.'));
      return;
    }

    openConfirmDialog(
      t('Update runners'),
      t('Refresh the Runner Host to update runner binaries for existing runners.'),
      async () => {
        setError(null);
        setBackendMessage(t('Updating runners...'));
        try {
          await service.post('/api/host-refresh', {});
          await loadExtensionInfo();
          setBackendMessage(t('Runner update completed.'));
        } catch (err) {
          handleError(err);
          setBackendMessage(null);
        }
      },
      t('Update runners'),
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
      setError(t('Unable to copy logs to clipboard.'));
    }
  };

  const clearLogs = async () => {
    if (!service) {
      setError(t('Unable to access the Docker VM service.'));
      return;
    }

    openConfirmDialog(
      t('Clear logs'),
      t('This will clear the extension log file. Continue?'),
      async () => {
        setError(null);
        setBackendMessage(t('Clearing logs...'));
        try {
          await service.post('/api/logs/clear', {});
          setLogsContent('');
          setBackendMessage(t('Logs cleared.'));
        } catch (err) {
          handleError(err);
          setBackendMessage(null);
        }
      },
      t('Clear logs'),
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
      setRunnerGroupError(t('Unable to access the Docker VM service.'));
      return;
    }

    setRunnerGroupError(null);
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
      const response = await serviceGet<{
        groups?: Array<{ id: number; name: string }>;
        error?: string;
      }>(
        `/api/github-tokens/${encodeURIComponent(tokenId)}/runner-groups?${query.toString()}`,
        30000
      );
      if (response.error) {
        setRunnerGroups([]);
        const permissionHint = response.error.includes('org admin') || response.error.includes('fine-grained permission')
          ? t(' The token needs organization-level Self-hosted runners and runner groups permission, or the authenticated user must be an organization owner.')
          : '';
        setRunnerGroupError(t('Unable to load runner groups: {message}{permissionHint}', {
          message: response.error,
          permissionHint
        }));
        return;
      }
      setRunnerGroups(response.groups || []);
      setRunnerGroupError(null);
    } catch (err) {
      const message = formatError(err);
      setRunnerGroups([]);
      setRunnerGroupError(t('Unable to load runner groups: {message}', { message }));
    } finally {
      setRunnerGroupLoading(false);
    }
  }, [service, serviceGet, formatError, t]);



  const createGithubToken = async () => {
    if (!service) {
      setError(t('Unable to access the Docker VM service.'));
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
      setTokenActionMessage('GitHub PAT saved successfully.');
      setTokenFormName('');
      setTokenFormValue('');
      setShowTokenForm(false);
      await loadGithubTokensList();
    } catch (err) {
      setTokenFormError(formatError(err));
    }
  };

  const editGithubTokenById = (id: string) => {
    const token = githubTokens.find((item) => item.id === id);
    if (!token) {
      return;
    }

    setEditingGithubTokenId(id);
    setTokenFormName(token.name);
    setTokenFormValue('');
    setTokenFormError(null);
    setTokenActionMessage(null);
    setShowTokenForm(true);
  };

  const updateGithubToken = async () => {
    if (!service) {
      setTokenFormError(t('Unable to access the Docker VM service.'));
      return;
    }

    setTokenFormError(null);
    setTokenActionMessage(null);

    if (!editingGithubTokenId || !tokenFormValue.trim()) {
      setTokenFormError(t('A replacement token is required.'));
      return;
    }

    try {
      await service.put(`/api/github-tokens/${encodeURIComponent(editingGithubTokenId)}`, {
        token: tokenFormValue.trim()
      });
      setTokenActionMessage(t('GitHub token updated successfully.'));
      setTokenFormValue('');
      setEditingGithubTokenId(null);
      setShowTokenForm(false);
      await loadGithubTokensList();
    } catch (err) {
      setTokenFormError(formatError(err));
    }
  };

  const cancelGithubTokenForm = () => {
    setEditingGithubTokenId(null);
    setShowTokenForm(false);
    setTokenFormName('');
    setTokenFormValue('');
    setTokenFormError(null);
    setTokenActionMessage(null);
  };

  const deleteGithubTokenById = async (id: string) => {
    if (!service) {
      setError(t('Unable to access the Docker VM service.'));
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
      setError(t('Unable to access the Docker VM service. Make sure Docker Desktop is running and the VM service is available.'));
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
          setBackendMessage(t('Extension backend is still starting, retrying ({attempt}/4)...', { attempt }));
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
    if (settingsOpen) {
      void loadGithubTokensList();
      void loadExtensionInfo();
      void loadLoggingSettings();
      void loadLanguages();
      const interval = setInterval(() => {
        void loadGithubTokensList();
        void loadExtensionInfo();
      }, 30000);
      return () => clearInterval(interval);
    }
    return undefined;
  }, [settingsOpen, loadGithubTokensList, loadExtensionInfo, loadLoggingSettings, loadLanguages]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem('startRunnersOnStartup', JSON.stringify(startRunnersOnStartup));
    window.localStorage.setItem('uiStyle', uiStyle);
    window.localStorage.setItem('uiLoggingEnabled', JSON.stringify(uiLoggingEnabled));
    window.localStorage.setItem('runnerLoggingEnabled', JSON.stringify(runnerLoggingEnabled));
    window.localStorage.setItem('githubApiLoggingEnabled', JSON.stringify(githubApiLoggingEnabled));
    window.localStorage.setItem('language', language);
  }, [startRunnersOnStartup, uiStyle, uiLoggingEnabled, runnerLoggingEnabled, githubApiLoggingEnabled, language]);

  useEffect(() => {
    if (language) {
      void loadTranslationStrings(language);
    }
  }, [language, loadTranslationStrings]);

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
          repo: '',
          runnerGroup: undefined
        }));
        setSelectedRepoOption(null);
        setOrgRunnerSelected(false);
        setRunnerGroups([]);
        setRunnerGroupError(null);
        void loadReposForToken(selectedToken.id);
      } else {
        setRepoOptions([]);
        setSelectedRepoOption(null);
        setRunnerGroups([]);
        setRunnerGroupError(null);
      }
    }
  }, [selectedToken, loadReposForToken, editing]);

  useEffect(() => {
    if (!showDialog || !editing || formState.selectedTokenId || !editing.tokenName) {
      return;
    }

    const savedToken = githubTokens.find((token) => token.name === editing.tokenName);
    if (savedToken) {
      setFormState((prev) => ({ ...prev, selectedTokenId: savedToken.id }));
    }
  }, [showDialog, editing, githubTokens, formState.selectedTokenId]);

  useEffect(() => {
    if (!showDialog || !editing || !selectedToken || !formState.owner) {
      return;
    }

    void loadReposForToken(selectedToken.id);
    void loadRunnerGroups(selectedToken.id, formState.owner, formState.repo, !formState.repo.trim());
  }, [showDialog, editing, selectedToken, formState.owner, formState.repo, loadReposForToken, loadRunnerGroups]);

  useEffect(() => {
    if (!showDialog || editing) {
      return;
    }

    if (!formState.selectedTokenId) {
      setRepoDropdownOpen(false);
    }
  }, [showDialog, editing, formState.selectedTokenId]);

  useEffect(() => {
    if (!editing && selectedToken && orgRunnerSelected && formState.owner) {
      void loadRunnerGroups(selectedToken.id, formState.owner, '', true);
    }
  }, [editing, selectedToken, formState.owner, orgRunnerSelected, loadRunnerGroups]);

  useEffect(() => {
    if (!showDialog) {
      setRepoDropdownOpen(false);
    }
  }, [showDialog]);

  const openDialog = (runner?: Runner) => {
    if (!runner && githubTokens.length === 0) {
      setSettingsTab('auth');
      setSettingsOpen(true);
      void loadGithubTokensList();
      return;
    }

    if (runner) {
      setEditing(runner);
      setFormState({
        runnerName: runner.runnerName,
        selectedTokenId: githubTokens.find((token) => token.name === runner.tokenName)?.id || '',
        owner: runner.owner,
        repo: runner.repo,
        runnerGroup: runner.runnerGroup,
        registrationToken: '',
        labels: runner.labels,
        startOnStartup: runner.startOnStartup
      });
      setSelectedRepoOption(null);
      setOrgRunnerSelected(!runner.repo);
    } else {
      setEditing(null);
      setFormState(defaultFormState);
      setSelectedRepoOption(null);
      setOrgRunnerSelected(false);
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
      setError(t('Unable to access the Docker VM service.'));
      return;
    }

    if (!editing && !selectedToken) {
      setError(t('Select a GitHub API token before creating a new runner.'));
      return;
    }

    if (!formState.runnerName.trim()) {
      setError(t('Runner name is required.'));
      return;
    }

    if (!formState.owner.trim()) {
      setError(t('Owner/organization is required.'));
      return;
    }

    setError(null);
    setBackendMessage('Saving runner...');
    setSaving(true);

    try {
      const isOrgRunner = !formState.repo.trim();
      const runnerGroupSelect = document.getElementById('runnerGroupSelect') as HTMLSelectElement | null;
      const selectedRunnerGroup = isOrgRunner
        ? runnerGroupSelect?.value.trim() || formState.runnerGroup?.trim() || undefined
        : undefined;
      const payload: RunnerSavePayload = {
        runnerName: formState.runnerName,
        githubUrl: GITHUB_BASE_URL,
        owner: formState.owner,
        repo: formState.repo,
        isOrg: isOrgRunner,
        registrationToken: formState.registrationToken,
        labels: formState.labels,
        tokenName: selectedToken?.name || '',
        selectedTokenId: selectedToken?.id || '',
        runnerGroup: selectedRunnerGroup,
        hostContainerName: DEFAULT_HOST_CONTAINER_NAME,
        runnerRootPath: DEFAULT_RUNNER_ROOT_PATH,
        startOnStartup: formState.startOnStartup
      };

      if (editing) {
        await service.put(`/api/runners/${editing.id}`, payload);
        setBackendMessage(t('{runnerName} Updated Successfully', { runnerName: formState.runnerName }));
      } else {
        await service.post('/api/runners', payload);
        setBackendMessage(t('{runnerName} Started Successfully', { runnerName: formState.runnerName }));
      }

      closeDialog();
      await loadRunners();
    } catch (err) {
      const message = formatError(err);
      if (editing) {
        setError(t('{runnerName} Failed to Update with error: {message}', { runnerName: formState.runnerName, message }));
      } else {
        setError(t('{runnerName} Failed to start with error: {message}', { runnerName: formState.runnerName, message }));
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
      setError(t('Unable to access the Docker VM service.'));
      return;
    }

    const runner = runners.find((run) => run.id === id);
    const runnerName = runner?.runnerName ?? 'Runner';
    const actionLabel = action === 'start' ? 'Start' : action === 'stop' ? 'Stop' : 'Restart';
    setError(null);
    setBackendMessage(t('{actionLabel}ing {runnerName}...', { actionLabel, runnerName }));

    try {
      const response = (await service.post(`/api/runners/${id}/${action}`, {})) as { success: true; runnerName: string };
      await delay(1000);
      await loadRunners();
      const name = response.runnerName || runnerName;
      const statusMessage = action === 'start' ? 'Started Successfully' : action === 'stop' ? 'Stopped Successfully' : 'Restarted Successfully';
      setBackendMessage(t('{name} {statusMessage}', { name, statusMessage }));
    } catch (err) {
      const message = formatError(err);
      setError(t('{runnerName} failed to {action} with error: {message}', { runnerName, action, message }));
      setBackendMessage(null);
    }
  };

  const runAllAction = async (action: 'start' | 'stop' | 'restart') => {
    if (!service) {
      setError(t('Unable to access the Docker VM service.'));
      return;
    }

    const actionLabel = action === 'start' ? 'starting' : action === 'stop' ? 'stopping' : 'restarting';
    const perform = async () => {
      setError(null);
      setBackendMessage(t('Performing {actionLabel} on all runners...', { actionLabel }));

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
          const successMessage = action === 'start' ? 'started' : action === 'stop' ? 'stopped' : 'restarted';
          const runnerPlural = successCount === 1 ? 'runner' : 'runners';
          setBackendMessage(t('{successCount} {runnerPlural} {successMessage} successfully.', { successCount, runnerPlural, successMessage }));
        } else {
          setBackendMessage(null);
        }

        if (failureResults.length > 0) {
          const firstError = failureResults[0].error || 'unknown error';
          const runnerPlural = failureResults.length === 1 ? 'runner' : 'runners';
          setError(t('{failureCount} {runnerPlural} failed to {action} with error: {firstError}', {
            failureCount: failureResults.length,
            runnerPlural,
            action,
            firstError
          }));
        }
      } catch (err) {
        handleError(err);
        setBackendMessage(null);
      }
    };

    if (action === 'stop' || action === 'restart') {
      const prompt =
        action === 'stop'
          ? t('Stop all runners now? Existing jobs may be interrupted.')
          : t('Restart all runners now? This will stop and then start every runner.');
      openConfirmDialog(
        action === 'stop' ? t('Stop all runners') : t('Restart all runners'),
        prompt,
        perform,
        action === 'stop' ? t('Stop all') : t('Restart all'),
        action === 'stop' ? 'btn-danger' : 'btn-warning'
      );
      return;
    }

    await perform();
  };

  const refreshHostContainer = async () => {
    if (!service) {
      setError(t('Unable to access the Docker VM service.'));
      return;
    }

    openConfirmDialog(
      t('Refresh host container'),
      t('This will recreate the host container and preserve existing runner data. Continue?'),
      async () => {
        setError(null);
        setBackendMessage(t('Refreshing host container...'));

        try {
          await service.post('/api/host-refresh', {});
          await loadRunners();
          setBackendMessage(t('Runner Host Container was successfully updated'));
        } catch (err) {
          const message = formatError(err);
          setError(t('Runner Host Container failed to update with error: {message}', { message }));
          setBackendMessage(null);
        }
      },
      'Refresh host',
      'btn-warning'
    );
  };

  const refreshDashboard = async () => {
    setError(null);
    setBackendMessage(t('Refreshing dashboard...'));
    await Promise.all([loadRunners(), loadExtensionInfo()]);
    setBackendMessage(t('Dashboard refreshed.'));
  };

  const deleteRunner = async (id: string) => {
    if (!service) {
      setError(t('Unable to access the Docker VM service.'));
      return;
    }

    openConfirmDialog(
      t('Delete runner'),
      t('Delete this runner and remove its directory from the host container?'),
      async () => {
        setError(null);

        try {
          await service.delete(`/api/runners/${id}`);
          await loadRunners();
        } catch (err) {
          handleError(err);
        }
      },
      t('Delete runner'),
      'btn-danger'
    );
  };

  return (
    <div className="container py-4">
      <div className="d-flex flex-column">
        <div className="d-flex justify-content-between align-items-center mb-4">
        <div className="d-flex align-items-center gap-3">
          <img src="./GH-Runner-Logo.svg" alt={t('GitHub Runner Manager')} style={{ height: 128 }} />
          <div>
            {/* <h1 className="h4 mb-1">GitHub Runner Manager</h1> */}
            <p className="text-muted mb-0">{t('Manage all of your GitHub self-hosted runners inside Docker Desktop.')}</p>
          </div>
        </div>
        <div className="btn-group btn-group-sm">
          <button 
            type="button" 
            className="btn btn-info" 
            onClick={() => { void refreshDashboard(); }}
            aria-label={t('Refresh Dashboard')}
            data-bs-toggle="tooltip"
            title={t('Refresh Dashboard')}
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
            aria-label={t('Settings')}
            data-bs-toggle="tooltip"
            title={t('Settings')}
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
            aria-label={t('Toggle logs panel')}
            data-bs-toggle="tooltip"
            title={t('Toggle log panel')}
          >
            {t('Logs')}
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
            {errorDetailsOpen ? t('Hide error details') : t('Show error details')}
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
          <div>{t('Loading runners, please wait...')}</div>
        </div>
      ) : loading ? (
        <div className="alert alert-info d-flex align-items-center" role="status">
          <div className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></div>
          <div>{t('Refreshing runner status...')}</div>
        </div>
      ) : null}
      {logsOpen ? (
        <div className="card mb-3">
          <div className="card-header d-flex justify-content-between align-items-center">
            <span>{t('Extension Log Panel')}</span>
            <div className="btn-group btn-group-sm">
              <button
                type="button"
                className="btn btn-outline-secondary"
                onClick={() => {
                  void loadLogs();
                }}
              >
                {t('Refresh')}
              </button>
              <button
                type="button"
                className="btn btn-outline-secondary"
                onClick={copyLogs}
                disabled={!logsContent}
              >
                {logsCopied ? t('Copied') : t('Copy')}
              </button>
              <button
                type="button"
                className="btn btn-outline-danger"
                onClick={clearLogs}
              >
                {t('Clear')}
              </button>
            </div>
          </div>
          <div className="card-body p-3 bg-dark text-white" style={{ minHeight: '220px', whiteSpace: 'pre-wrap', fontFamily: 'monospace', overflowY: 'auto' }}>
            {logsLoading ? t('Loading logs...') : logsContent || t('No logs available.')}
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
        <h2 className="h5 mb-0">{t('Runners')}</h2>
        <div className="btn-group btn-group-sm">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!anyRunnerStopped}
            onClick={() => {
              void runAllAction('start');
            }}
            aria-label={t('Start all runners')}
            data-bs-toggle="tooltip"
            title={t('Start all')}
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
            aria-label={t('Stop all runners')}
            data-bs-toggle="tooltip"
            title={t('Stop all')}
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
            aria-label={t('Restart all runners')}
            data-bs-toggle="tooltip"
            title={t('Restart all')}
          >
            <FontAwesomeIcon icon={faRotateRight} fixedWidth />
          </button>
          <button
            type="button"
            className="btn btn-success"
            onClick={() => openDialog()}
            aria-label={t('Add runner')}
            data-bs-toggle="tooltip"
            title={t('Add runner')}
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
                  <h5 className="modal-title">{t('Settings')}</h5>
                  <button type="button" className="btn-close" aria-label={t('Close')} onClick={() => setSettingsOpen(false)} />
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
                        {t('General')}
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
                        {t('Tools')}
                      </button>
                    </li>
                    <li className="nav-item" role="presentation">
                      <button
                        type="button"
                        className={`nav-link ${settingsTab === 'auth' ? 'active' : ''}`}
                        onClick={() => setSettingsTab('auth')}
                        role="tab"
                        aria-selected={settingsTab === 'auth'}
                      >
                        {t('GitHub Auth')}
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
                        {t('Info')}
                      </button>
                    </li>
                  </ul>

                  <div className="tab-content">
                    <div className={`tab-pane fade ${settingsTab === 'general' ? 'show active' : ''}`} role="tabpanel">
                      <h6>{t('General settings')}</h6>
                      <p className="text-muted">{t('Configure startup behavior and UI preferences.')}</p>
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
                                {t('Start runners on Docker startup')}
                              </label>
                            </div>
                            <p className="mb-0 text-muted">{t('Start runners when Docker Desktop starts-up. You will be able to disable this per runner.')}</p>
                          </div>
                        </div>
                        <div className="col-12 col-md-6">
                          <div className="card p-3">
                            <h6 className="mb-2">{t('UI Style')}</h6>
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
                              <label className="form-check-label" htmlFor="uiStyleLight">{t('Light')}</label>
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
                              <label className="form-check-label" htmlFor="uiStyleDark">{t('Dark')}</label>
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
                              <label className="form-check-label" htmlFor="uiStyleSystem">{t('System')}</label>
                            </div>
                            <p className="mb-0 text-muted">{t('Choose your UI appearance preference.')}</p>
                          </div>
                        </div>
                        <div className="col-12 col-md-6">
                          <div className="card p-3">
                            <h6 className="mb-2">{t('Language')}</h6>
                            <div className="mb-3">
                              <label className="form-label" htmlFor="languageSelect">{t('Select language')}</label>
                              <select
                                id="languageSelect"
                                className="selectpicker show-tick"
                                data-live-search="true"
                                data-live-search-placeholder={t('Search languages')}
                                title={t('Select language')}
                                disabled={!languages.length || languageLoading}
                                value={language}
                                onChange={async (event) => {
                                  const nextLanguage = event.target.value;
                                  setLanguage(nextLanguage);
                                  await saveLoggingSettings({
                                    uiLoggingEnabled,
                                    runnerLoggingEnabled,
                                    githubApiLoggingEnabled,
                                    startRunnersOnStartup,
                                    language: nextLanguage
                                  });
                                }}
                              >
                                {languages.map((lang) => (
                                  <option key={lang.code} value={lang.code}>
                                    {lang.name}
                                  </option>
                                ))}
                              </select>
                              {languageLoading ? (
                                <div className="form-text text-muted">{t('Loading languages…')}</div>
                              ) : languageError ? (
                                <div className="form-text text-danger">{languageError}</div>
                              ) : (
                                <div className="form-text">{t('Choose a language for the extension UI.')}</div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className={`tab-pane fade ${settingsTab === 'tools' ? 'show active' : ''}`} role="tabpanel">
                      <h6>{t('Tools')}</h6>
                      <p className="text-muted">{t('Manage runner host updates, persistent volume data, and logging.')}</p>
                      <div className="mb-3">
                        <button type="button" className="btn btn-warning me-2" onClick={refreshHostContainer}>
                          {t('Refresh Runner Host Container')}
                        </button>
                        <p className="mb-1 text-muted small">{t('Refresh the Runner Host to apply any updates to the container.')}</p>
                      </div>
                      <div className="mb-3">
                        <button
                          type="button"
                          className={`btn ${extensionInfo?.runnerVersionMismatch ? 'btn-primary' : 'btn-secondary'}`}
                          disabled={!extensionInfo?.runnerVersionMismatch}
                          onClick={updateRunners}
                        >
                          {extensionInfo?.runnerVersionMismatch ? t('Update Runners') : t('Up to Date')}
                        </button>
                        <p className="mb-1 text-muted small">
                          {extensionInfo ? t('Runner base version:') + ` ${extensionInfo.runnerBaseVersion || t('unknown')}` : t('Loading runner version info...')}
                        </p>
                        {extensionInfo ? (
                          <p className="mb-0 text-muted small">
                            {extensionInfo.runnerVersionMismatch ? `${extensionInfo.runnerVersionsOutOfDate} ${t('runner(s) need update.')}` : t('All runners up to date.')}
                          </p>
                        ) : null}
                      </div>
                      <div className="mb-3">
                        <button type="button" className="btn btn-danger me-2" onClick={() => clearVolume('gh-runner-manager-runners', 'Runners')}>
                          {t('Clear all data from Runners Volume')}
                        </button>
                        <p className="mb-1 text-muted small">{t('WARNING: This will remove all runner data from the persistent volume.')}</p>
                      </div>
                      <div className="mb-3">
                        <button type="button" className="btn btn-danger me-2" onClick={() => clearVolume('gh-runner-manager-data', 'Data')}>
                          {t('Clear all data from Data Volume')}
                        </button>
                        <p className="mb-1 text-muted small">{t('WARNING: This will remove all extension data from the persistent volume.')}</p>
                      </div>
                      <div className="card p-3">
                        <h6 className="mb-2">{t('Logging')}</h6>
                        <p className="mb-3 text-muted">{t('All logs will be saved here.')}</p>
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
                          <label className="form-check-label" htmlFor="uiLoggingEnabled">{t('Enable UI Logging')}</label>
                        </div>
                        <p className="mb-2 text-muted">{t('Enable UI logging to help with troubleshooting.')}</p>
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
                          <label className="form-check-label" htmlFor="runnerLoggingEnabled">{t('Enable Runner Logging')}</label>
                        </div>
                        <p className="mb-2 text-muted">{t('Enable Runner logging for troubleshooting.')}</p>
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
                          <label className="form-check-label" htmlFor="githubApiLoggingEnabled">{t('Enable GitHub API Logging')}</label>
                        </div>
                        <p className="mb-0 text-muted">{t('Enable GitHub API logging for troubleshooting.')}</p>
                        <div className="mt-3">
                          <button type="button" className="btn btn-outline-secondary btn-sm me-2" onClick={() => { setLogsOpen(!logsOpen); if (!logsOpen) { void loadLogs(); } }}>
                            {logsOpen ? t('Hide logs') : t('View logs')}
                          </button>
                          <button type="button" className="btn btn-outline-danger btn-sm" onClick={clearLogs}>
                            Clear logs
                          </button>
                        </div>
                        {logsOpen ? (
                          <div className="mt-3">
                            <div className="card bg-dark text-white" style={{ minHeight: '200px', whiteSpace: 'pre-wrap', fontFamily: 'monospace', overflowY: 'auto', padding: '1rem' }}>
                              {logsLoading ? t('Loading logs...') : logsContent || t('No logs available.')}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div className={`tab-pane fade ${settingsTab === 'auth' ? 'show active' : ''}`} role="tabpanel">
                      <div className="mb-4">
                        <h6>{t('Saved GitHub Authentication Methods')}</h6>
                        {githubTokens.length === 0 ? (
                          <div className="alert alert-info mb-0">{t('No saved GitHub authentication methods yet. Add one below to access repository lists in the runner form.')}</div>
                        ) : (
                          githubTokens.map((token) => (
                            <div className="card mb-3" key={token.id}>
                              <div className="card-body p-3">
                                <div className="d-flex justify-content-between align-items-center gap-3">
                                  <div>
                                    <h6 className="mb-1">{token.name}</h6>
                                    <p className="mb-0 text-muted">{token.type} · {token.login} · {t('saved')} {new Date(token.createdAt).toLocaleDateString()}</p>
                                  </div>
                                  <div className="btn-group" role="group" aria-label="Token actions">
                                    <button type="button" className="btn btn-outline-warning btn-sm" onClick={() => editGithubTokenById(token.id)}>
                                      {t('Edit')}
                                    </button>
                                    <button type="button" className="btn btn-outline-danger btn-sm" onClick={() => deleteGithubTokenById(token.id)}>
                                      {t('Delete')}
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))
                        )}
                      </div>

                      {!showTokenForm ? (
                        <div>
                          <button type="button" className="btn btn-primary" onClick={() => setShowTokenForm(true)}>
                            {t('Add GitHub PAT')}
                          </button>
                        </div>
                      ) : (
                        <div>
                          <h6>{editingGithubTokenId ? t('Edit GitHub PAT') : t('Add a new GitHub PAT')}</h6>
                          <div className="mb-3">
                            <label className="form-label">{t('Token name')}</label>
                            <input
                              type="text"
                              className="form-control"
                              value={tokenFormName}
                              disabled={Boolean(editingGithubTokenId)}
                              onChange={(event) => {
                                setTokenFormName(event.target.value);
                                setTokenFormError(null);
                                setTokenActionMessage(null);
                              }}
                              placeholder={t('Friendly name for this token')}
                            />
                            <div className="form-text">
                              {editingGithubTokenId
                                ? t('The token name stays the same so existing runners continue using this token.')
                                : t('A friendly name to identify this token in the runner creation form.')}
                            </div>
                          </div>
                          <div className="mb-3">
                            <label className="form-label">{t('Personal access token')}</label>
                            <input
                              type="password"
                              className="form-control"
                              value={tokenFormValue}
                              onChange={(event) => {
                                setTokenFormValue(event.target.value);
                                setTokenFormError(null);
                                setTokenActionMessage(null);
                              }}
                              placeholder={editingGithubTokenId ? t('Enter replacement GitHub PAT') : t('GitHub PAT')}
                            />
                            <div className="form-text">{t('GitHub personal access token used to enumerate repositories and validate access.')}</div>
                          </div>
                          {tokenFormError ? <div className="alert alert-danger">{tokenFormError}</div> : null}
                          {tokenActionMessage ? <div className="alert alert-success">{tokenActionMessage}</div> : null}
                          <div className="d-flex gap-2">
                            <button type="button" className="btn btn-primary" onClick={editingGithubTokenId ? updateGithubToken : createGithubToken} data-bs-toggle="tooltip" title={editingGithubTokenId ? t('Update token') : t('Save token')}>
                              {editingGithubTokenId ? t('Update token') : t('Save token')}
                            </button>
                            <button type="button" className="btn btn-secondary" onClick={cancelGithubTokenForm}>
                              {t('Cancel')}
                            </button>
                          </div>
                          <div className="mt-3 text-muted small">
                            <p className="mb-1">{t('Recommended permissions:')}</p>
                            <p className="mb-0">{t('• repo (full repository access for private repos)')}</p>
                            <p className="mb-0">{t('• read:org (if using organization-owned runners)')}</p>
                            <p className="mb-0">{t('• workflow (optional, for workflow-related access if needed)')}</p>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className={`tab-pane fade ${settingsTab === 'info' ? 'show active' : ''}`} role="tabpanel">
                      <h6>{t('Extension information')}</h6>
                      <p className="text-muted">{t('Core metadata and health status for the extension environment.')}</p>

                      <div className="row gy-3">
                        <div className="col-12 col-md-6">
                          <div className="card p-3">
                            <h6 className="mb-2">{t('Extension details')}</h6>
                            <p className="mb-1"><strong>{t('Name:')}</strong> {extensionInfo?.extensionName || t('GH Runner')}</p>
                            <p className="mb-1"><strong>{t('Version:')}</strong> {extensionInfo?.extensionVersion || '1.0.0'}</p>
                            <p className="mb-1"><strong>{t('Author:')}</strong> {extensionInfo?.extensionAuthor || 'MrTrilB'}</p>
                            <p className="mb-0"><strong>{t('Documentation:')}</strong>{' '}
                              {extensionInfo?.documentationUrl ? (
                                <a
                                  href={extensionInfo.documentationUrl}
                                  onClick={(event) => {
                                    event.preventDefault();
                                    void ddClient.host.openExternal(event.currentTarget.href);
                                  }}
                                >
                                  {t('View docs')}
                                </a>
                              ) : t('Not available')}
                            </p>
                          </div>
                        </div>

                        <div className="col-12 col-md-6">
                          <div className="card p-3">
                            <h5 className="mb-2">{t('Health summary')}</h5>
                            <div className="mb-4">
                              <div className="d-flex align-items-center gap-2 mb-2">
                                <h6 className="h6 mb-0">{t('Github API')}</h6>
                                <span className={`badge ${extensionInfo?.githubApiConnection.status === 'up' ? 'bg-success' : 'bg-danger'}`}>
                                  {extensionInfo?.githubApiConnection.status === 'up' ? t('Up') : t('Down')}
                                </span>
                              </div>
                              <p className="mb-0 text-muted">{t('Checks that GitHub’s public API is reachable from the extension environment.')}</p>
                            </div>
                            <div className="mb-4">
                              <div className="d-flex align-items-center gap-2 mb-2">
                                <h6 className="h6 mb-0">{t('Service Container')}</h6>
                                <span className={`badge ${extensionInfo?.serviceContainer.status === 'up' ? 'bg-success' : 'bg-danger'}`}>
                                  {extensionInfo?.serviceContainer.status === 'up' ? t('Up') : t('Down')}
                                </span>
                              </div>
                              <p className="mb-0 text-muted">{t('Verifies the Docker host container for the extension is running and available.')}</p>
                            </div>
                            <div className="mb-4">
                              <div className="d-flex align-items-center gap-2 mb-2">
                                <h6 className="h6 mb-0">{t('GitHub Runners Container')}</h6>
                                <span className={`badge ${extensionInfo?.runnerContainer.status === 'up' ? 'bg-success' : 'bg-danger'}`}>
                                  {extensionInfo?.runnerContainer.status === 'up' ? t('Up') : t('Down')}
                                </span>
                              </div>
                              <p className="mb-0 text-muted">{t('Checks whether the GitHub Runners container is installed and ready.')}</p>
                            </div>
                            <div className="mb-4">
                              <div className="d-flex align-items-center gap-2 mb-2">
                                <h6 className="h6 mb-0">{t('Data Volume')}</h6>
                                <span className={`badge ${extensionInfo?.dataVolumeExists ? 'bg-success' : 'bg-danger'}`}>
                                  {extensionInfo?.dataVolumeExists ? t('Up') : t('Down')}
                                </span>
                              </div>
                              <p className="mb-0 text-muted">{t('Confirms the extension data volume is present for persistent backend state.')}</p>
                            </div>
                            <div>
                              <div className="d-flex align-items-center gap-2 mb-2">
                                <h6 className="h6 mb-0">{t('Runner Volume')}</h6>
                                <span className={`badge ${extensionInfo?.runnerVolumeExists ? 'bg-success' : 'bg-danger'}`}>
                                  {extensionInfo?.runnerVolumeExists ? t('Up') : t('Down')}
                                </span>
                              </div>
                              <p className="mb-0 text-muted">{t('Ensures the runner volume is available for storing GitHub Actions runner state.')}</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setSettingsOpen(false)} data-bs-toggle="tooltip" title={t('Close')}>
                    {t('Close')}
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div className="modal-backdrop fade show" />
        </>
      )}

      {loading ? (
        <div>{t('Loading runners …')}</div>
      ) : runners.length === 0 ? (
        <div className="card">
          <div className="card-body">
            <h5 className="card-title">{t("You don't have any runners configured yet.")}</h5>
            <p className="card-text text-muted">{t('Get started by creating your first GitHub self-hosted runner.')}</p>
            <button type="button" className="btn btn-primary" onClick={() => openDialog()}>
              {t('Create new runner')}
            </button>
          </div>
        </div>
      ) : (
        <div id="runnerGroupsHome">
          {runnerGroupsByToken.map((tokenGroup, tokenIndex) => (
            <div className="runner-hierarchy-section runner-hierarchy-token-section" key={tokenGroup.tokenName}>
              <h2 className="mb-0 runner-hierarchy-token">
                <button
                  className="btn d-flex align-items-center gap-2"
                  type="button"
                  role="button"
                  data-bs-target={`#collapse-token-${tokenIndex}`}
                  aria-expanded="false"
                  aria-controls={`collapse-token-${tokenIndex}`}
                  onClick={toggleCollapse}
                >
                  <strong>{t('Token:')}</strong>{' '}{tokenGroup.tokenName}
                  <span className="collapse-chevron" aria-hidden="true">
                    <FontAwesomeIcon icon={faChevronDown} className="chevron-down" />
                    <FontAwesomeIcon icon={faChevronUp} className="chevron-up" />
                  </span>
                </button>
              </h2>
              <div
                id={`collapse-token-${tokenIndex}`}
                className="collapse"
              >
                    <div className="runner-hierarchy-content">
                  {tokenGroup.owners.map((ownerGroup, ownerIndex) => (
                      <div className="runner-hierarchy-section runner-hierarchy-owner-section" key={`${tokenGroup.tokenName}-${ownerGroup.owner}`}>
                        <h2 className="mb-0 runner-hierarchy-owner">
                          <button
                            className="btn d-flex align-items-center gap-2"
                            type="button"
                            role="button"
                            data-bs-target={`#collapse-owner-${tokenIndex}-${ownerIndex}`}
                            aria-expanded="false"
                            aria-controls={`collapse-owner-${tokenIndex}-${ownerIndex}`}
                            onClick={toggleCollapse}
                          >
                            <strong>{t('Owner:')}</strong>{' '}{ownerGroup.owner}
                            <span className="collapse-chevron" aria-hidden="true">
                              <FontAwesomeIcon icon={faChevronDown} className="chevron-down" />
                              <FontAwesomeIcon icon={faChevronUp} className="chevron-up" />
                            </span>
                          </button>
                        </h2>
                        <div
                          id={`collapse-owner-${tokenIndex}-${ownerIndex}`}
                          className="collapse"
                        >
                          <div className="runner-hierarchy-content">
                          {ownerGroup.repositories.map((repositoryGroup, repositoryIndex) => (
                            <div className="runner-hierarchy-section runner-hierarchy-repository-section" key={`${tokenGroup.tokenName}-${ownerGroup.owner}-${repositoryGroup.repository || 'org'}`}>
                              {repositoryGroup.repository && (
                                <h2 className="mb-0 runner-hierarchy-repository">
                                  <button
                                    className="btn d-flex align-items-center gap-2"
                                    type="button"
                                    role="button"
                                    data-bs-target={`#collapse-repository-${tokenIndex}-${ownerIndex}-${repositoryIndex}`}
                                    aria-expanded="false"
                                    aria-controls={`collapse-repository-${tokenIndex}-${ownerIndex}-${repositoryIndex}`}
                                    onClick={toggleCollapse}
                                  >
                                    <strong>{t('Repository:')}</strong>{' '}{repositoryGroup.repository}
                                    <span className="collapse-chevron" aria-hidden="true">
                                      <FontAwesomeIcon icon={faChevronDown} className="chevron-down" />
                                      <FontAwesomeIcon icon={faChevronUp} className="chevron-up" />
                                    </span>
                                  </button>
                                </h2>
                              )}
                              <div
                                id={repositoryGroup.repository ? `collapse-repository-${tokenIndex}-${ownerIndex}-${repositoryIndex}` : undefined}
                                className={repositoryGroup.repository ? 'collapse' : undefined}
                              >
                          {repositoryGroup.runnerGroups.map((runnerGroup, runnerGroupIndex) => (
                              <div className={`runner-hierarchy-section runner-hierarchy-group-section ${runnerGroup.runnerGroup === 'No runner group' ? 'runner-hierarchy-ungrouped' : ''}`} key={`${tokenGroup.tokenName}-${ownerGroup.owner}-${repositoryGroup.repository}-${runnerGroup.runnerGroup}`}>
                                {runnerGroup.runnerGroup !== 'No runner group' && (
                                  <h2 className="mb-0 runner-hierarchy-group">
                                    <button
                                      className="btn d-flex align-items-center gap-2"
                                      type="button"
                                      role="button"
                                      data-bs-target={`#collapse-runner-group-${tokenIndex}-${ownerIndex}-${repositoryIndex}-${runnerGroupIndex}`}
                                      aria-expanded="false"
                                      aria-controls={`collapse-runner-group-${tokenIndex}-${ownerIndex}-${repositoryIndex}-${runnerGroupIndex}`}
                                      onClick={toggleCollapse}
                                    >
                                      <strong>{t('Runner Group:')}</strong>{' '}{runnerGroup.runnerGroup}
                                      <span className="collapse-chevron" aria-hidden="true">
                                        <FontAwesomeIcon icon={faChevronDown} className="chevron-down" />
                                        <FontAwesomeIcon icon={faChevronUp} className="chevron-up" />
                                      </span>
                                    </button>
                                  </h2>
                                )}
                                <div
                                  id={runnerGroup.runnerGroup !== 'No runner group' ? `collapse-runner-group-${tokenIndex}-${ownerIndex}-${repositoryIndex}-${runnerGroupIndex}` : undefined}
                                  className={runnerGroup.runnerGroup !== 'No runner group' ? 'collapse' : undefined}
                                >
                                  <div className="accordion runner-hierarchy-runners" id={`runnerAccordion-${tokenIndex}-${ownerIndex}-${repositoryIndex}-${runnerGroupIndex}`}>
                                  {runnerGroup.runners.map((runner) => (
                                    <div className="accordion-item" key={runner.id}>
                                      <h2 className="accordion-header" id={`heading-${runner.id}`}>
                                        <div className="d-flex align-items-center gap-2">
                                          <button
                                            className="accordion-button collapsed flex-grow-1"
                                            type="button"
                                            data-bs-target={`#collapse-${runner.id}`}
                                            aria-expanded="false"
                                            aria-controls={`collapse-${runner.id}`}
                                            onClick={toggleCollapse}
                                          >
                                            <div className="d-flex justify-content-between align-items-center w-100">
                                              <div>
                                                <strong>{runner.runnerName}</strong>
                                                <div className="text-muted small">
                                                  {runner.owner}/{runner.repo || '(org)'}
                                                </div>
                                              </div>
                                              <span className={`badge justify-content-end ${runner.status === 'on' ? 'bg-success' : 'bg-danger'}`}>
                                                {runner.status === 'on' ? t('Running') : t('Stopped')}
                                              </span>
                                            </div>
                                          </button>
                                        </div>
                                      </h2>
                                      <div
                                        id={`collapse-${runner.id}`}
                                        className="accordion-collapse collapse"
                                        aria-labelledby={`heading-${runner.id}`}
                                        data-bs-parent={`#runnerAccordion-${tokenIndex}-${ownerIndex}-${runnerGroupIndex}`}
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
                                                  {t('Start on startup')}
                                                </label>
                                              </div>
                                            </div>
                                            <div className="col-12 col-md-6 d-flex justify-content-md-end mt-3 mt-md-0">
                                              <div className="btn-group btn-group-sm" style={{ paddingRight: '10px' }}>
                                                <button type="button" className="btn btn-primary" disabled={runner.status === 'on'} onClick={() => runAction(runner.id, 'start')} data-bs-toggle="tooltip" title={t('Start')}>
                                                  <FontAwesomeIcon icon={faPlay} fixedWidth />
                                                </button>
                                                <button type="button" className="btn btn-danger" disabled={runner.status !== 'on'} onClick={() => runAction(runner.id, 'stop')} data-bs-toggle="tooltip" title={t('Stop')}>
                                                  <FontAwesomeIcon icon={faStop} fixedWidth />
                                                </button>
                                                <button type="button" className="btn btn-warning" disabled={runner.status !== 'on'} onClick={() => runAction(runner.id, 'restart')} data-bs-toggle="tooltip" title={t('Restart')}>
                                                  <FontAwesomeIcon icon={faRotateRight} fixedWidth />
                                                </button>
                                                <button type="button" className="btn btn-success" onClick={() => openDialog(runner)} data-bs-toggle="tooltip" title={t('Edit')}>
                                                  <FontAwesomeIcon icon={faPen} fixedWidth />
                                                </button>
                                                <button type="button" className="btn btn-danger" onClick={() => deleteRunner(runner.id)} data-bs-toggle="tooltip" title={t('Delete')}>
                                                  <FontAwesomeIcon icon={faTrash} fixedWidth />
                                                </button>
                                              </div>
                                            </div>
                                          </div>
                                          <div className="row gy-3 mt-2">
                                            <div className="col-12 col-md-6">
                                              <p className="mb-0"><strong></strong></p>
                                              <p className="mb-1"><strong>{t('Created:')}</strong> {new Date(runner.createdAt).toLocaleString()}</p>
                                              <p className="mb-1"><strong>{t('Runner path:')}</strong> {runner.runnerPath}</p>
                                              <p className="mb-0"><strong>{t('Runner Version:')}</strong> {runner.runnerVersion || t('unknown')}</p>
                                              <p className="mb-1"><strong>{t('Labels:')}</strong> {runner.labels.join(', ')}</p>
                                            </div>
                                            <div className="col-12 col-md-6">
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                  </div>
                                </div>
                              </div>
                              ))}
                              </div>
                            </div>
                          ))}
                    </div>
                  </div>
                </div>
                  ))}
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
                  <h5 className="modal-title">{editing ? t('Edit runner') : t('Add runner')}</h5>
                  <button type="button" className="btn-close" aria-label={t('Close')} onClick={closeDialog} />
                </div>
                <div className="modal-body py-4">
                  {!editing && (
                    <>
                      <div className="mb-3">
                        <label className="form-label">{t('GitHub API token')}</label>
                        <select
                          ref={tokenSelectRef}
                          className="selectpicker"
                          value={formState.selectedTokenId}
                          onChange={(event) => {
                            const token = githubTokens.find((item) => item.id === event.target.value) || null;
                            setSelectedRepoOption(null);
                            setFormState({
                              ...formState,
                              selectedTokenId: token?.id || '',
                              owner: token?.login || '',
                              repo: '',
                              runnerGroup: undefined
                            });
                          }}
                        >
                          <option value="">{t('Select a saved token')}</option>
                          {githubTokens.map((token) => (
                            <option key={token.id} value={token.id}>{token.name} ({token.login})</option>
                          ))}
                        </select>
                        <div className="form-text">{t('Select a saved token to load repositories and derive the owner.')}</div>
                      </div>
                    </>
                  )}
                  {showOwnerField && (
                  <div className="mb-3">
                    <label className="form-label" htmlFor="runnerOwner">{t('Owner / organization')}</label>
                    <select
                      id="runnerOwner"
                      ref={ownerSelectRef}
                      className="selectpicker show-tick"
                      data-open-options="true"
                      title={t('Select an owner')}
                      value={formState.owner}
                      onChange={(event) => {
                        const owner = event.target.value;
                        setFormState({ ...formState, owner, repo: '', runnerGroup: undefined });
                        setSelectedRepoOption(null);
                        setOrgRunnerSelected(false);
                        setRunnerGroups([]);
                      }}
                      disabled={!formEnabled}
                    >
                      <option value="">{t('Select an owner')}</option>
                      {owners.map((owner) => (
                        <option key={owner} value={owner}>{owner}</option>
                      ))}
                    </select>
                    <div className="form-text">
                      {editing
                        ? t('Owner set for this runner and cannot be changed from this edit view.')
                        : selectedToken
                          ? t('Owner is fixed to the selected GitHub token.')
                          : t('Derived from the selected token or selected repository. Edit for org or alternate owner.')}
                    </div>
                  </div>
                  )}

                  {showRepositoryField && (
                  <div className="mb-3">
                    <label className="form-label" htmlFor="repoSelect">{t('Repository')}</label>
                    <select
                      id="repoSelect"
                      ref={repoSelectRef}
                      className="selectpicker show-tick"
                      data-live-search="true"
                      data-live-search-placeholder={t('Search repositories')}
                      data-open-options="true"
                      title={t('Select a repository')}
                      disabled={!formEnabled || (filteredRepoOptions.length === 0 && !showOrgRunnerOption)}
                      value={repoSelectValue}
                      onChange={(event) => {
                        const value = event.target.value;
                        if (!value) {
                          setFormState((prev) => ({
                            ...prev,
                            repo: '',
                            runnerGroup: undefined
                          }));
                          setSelectedRepoOption(null);
                          setOrgRunnerSelected(false);
                          setRunnerGroups([]);
                          return;
                        }

                        if (value === '__org__') {
                          setFormState((prev) => ({
                            ...prev,
                            repo: '',
                            runnerGroup: undefined
                          }));
                          setSelectedRepoOption(null);
                          setOrgRunnerSelected(true);
                          setRunnerGroups([]);
                          return;
                        }

                        const [owner, repoName] = value.split('/');
                        const repo = filteredRepoOptions.find((item) => item.owner === owner && item.name === repoName) ?? null;
                        setFormState((prev) => ({
                          ...prev,
                          owner,
                          repo: repoName,
                          runnerGroup: undefined,
                          runnerName: (!prev.runnerName || prev.runnerName === prev.repo) ? repoName : prev.runnerName
                        }));
                        setSelectedRepoOption(repo);
                        setOrgRunnerSelected(false);
                        setRunnerGroups([]);
                      }}
                    >
                      <option value="">{t('Select a repository')}</option>
                      {showOrgRunnerOption && (
                        <option value="__org__">{t('Organisation-level runner')}</option>
                      )}
                      {filteredRepoOptions.map((repo) => (
                        <option key={repo.id} value={`${repo.owner}/${repo.name}`}>
                          {repo.full_name}
                        </option>
                      ))}
                    </select>
                    <div className="form-text">{t('Search repositories for the selected owner using GitHub. Leave blank for an organization-level runner.')}</div>
                  </div>
                  )}

                  {showRunnerGroupField && (
                  <div className="mb-3">
                      <label className="form-label" htmlFor="runnerGroupSelect">{t('Runner group')}</label>
                      <select
                        id="runnerGroupSelect"
                        className="selectpicker show-tick"
                        data-open-options="true"
                        title={t('No runner group')}
                        disabled={(!runnerGroupEnabled && !editing) || runnerGroupLoading}
                        value={formState.runnerGroup || ''}
                        onChange={(event) => setFormState({ ...formState, runnerGroup: event.target.value })}
                      >
                        <option value="">{t('No runner group')}</option>
                        {runnerGroupOptions.map((group) => (
                          <option key={group.id} value={group.name}>
                            {group.name}
                          </option>
                        ))}
                      </select>
                      {runnerGroupLoading ? (
                        <div className="form-text text-muted">{t('Loading runner groups…')}</div>
                      ) : runnerGroupError ? (
                        <div className="form-text text-danger">{runnerGroupError}</div>
                      ) : (
                        <div className="form-text">{t('Optional runner group for organization or repository runners.')}</div>
                      )}
                      {formState.owner && (
                        <div className="form-text">
                          {t('Create a new ')}
                          <a
                            href={`https://github.com/organizations/${encodeURIComponent(formState.owner)}/settings/actions/runner-groups`}
                            onClick={(event) => {
                              event.preventDefault();
                              void ddClient.host.openExternal(event.currentTarget.href);
                            }}
                          >
                            {t('Runner Group')}
                          </a>
                          {t(' on GitHub')}
                        </div>
                      )}
                  </div>
                  )}

                  {showRunnerNameField && (
                  <div className="mb-3">
                    <label className="form-label">{t('Runner name')}</label>
                    <input
                      type="text"
                      className="form-control"
                      value={formState.runnerName}
                      disabled={!formEnabled}
                      onChange={(event) => setFormState({ ...formState, runnerName: event.target.value })}
                      placeholder={t('Runner name')}
                    />
                    <div className="form-text">{t('A local identifier for this runner. It becomes the runner directory name inside the host container.')}</div>
                  </div>
                  )}

                  {showRunnerNameField && (
                  <div className="mb-3 form-check form-switch">
                    <input
                      className="form-check-input"
                      type="checkbox"
                      id="runnerStartOnStartup"
                      checked={Boolean(formState.startOnStartup)}
                      onChange={(event) => setFormState({ ...formState, startOnStartup: event.target.checked })}
                    />
                    <label className="form-check-label" htmlFor="runnerStartOnStartup">
                      {t('Start this runner on Docker startup')}
                    </label>
                    <div className="form-text">{t('If enabled, this runner will be started automatically when the Docker backend starts and the global startup setting is enabled.')}</div>
                  </div>
                  )}

                  {showRunnerTagsField && (
                  <div className="mb-3">
                    <label className="form-label">{t('Runner labels')}</label>
                    <select
                      className="selectpicker show-tick"
                      multiple
                      data-live-search="true"
                      data-show-selected-tags="true"
                      data-open-options="true"
                      data-live-search-placeholder={t('Search or create tags')}
                      title={t('Search or create tags')}
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
                    <div className="form-text">{t('Select one or more labels used by GitHub workflows to target this runner.')}</div>
                  </div>
                  )}
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={closeDialog} disabled={saving} data-bs-toggle="tooltip" title={t('Cancel')}>
                    {t('Cancel')}
                  </button>
                  <button type="button" className="btn btn-primary" onClick={() => { void saveRunner(); }} disabled={saving} data-bs-toggle="tooltip" title={t('Save runner')}>
                    {saving ? t('Saving…') : t('Save runner')}
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
                  <h5 className="modal-title">{t(confirmState.title)}</h5>
                  <button type="button" className="btn-close" aria-label={t('Close')} onClick={closeConfirmDialog} />
                </div>
                <div className="modal-body">
                  <p>{t(confirmState.body)}</p>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={closeConfirmDialog}>
                    {t('Cancel')}
                  </button>
                  <button type="button" className={`btn ${confirmState.confirmVariant}`} onClick={handleConfirm}>
                    {t(confirmState.confirmLabel)}
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
