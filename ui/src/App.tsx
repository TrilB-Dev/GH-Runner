import { useCallback, useEffect, useMemo, useState } from 'react';
import { createDockerDesktopClient } from '@docker/extension-api-client';
import {
  Alert,
  Autocomplete,
  Badge,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  InputAdornment,
  Stack,
  TextField,
  Typography
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';

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

interface RunnerForm {
  runnerName: string;
  owner: string;
  repo: string;
  registrationToken: string;
  labels: string[];
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

const defaultFormState: RunnerForm = {
  runnerName: '',
  owner: '',
  repo: '',
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
  const [ownerValid, setOwnerValid] = useState<boolean | null>(null);
  const [repoValid, setRepoValid] = useState<boolean | null>(null);
  const [ownerValidationMessage, setOwnerValidationMessage] = useState<string>('');
  const [repoValidationMessage, setRepoValidationMessage] = useState<string>('');
  const [ownerChecking, setOwnerChecking] = useState(false);
  const [repoChecking, setRepoChecking] = useState(false);

  const service = ddClient.extension.vm?.service;

  const verifyOwner = async (owner: string) => {
    const trimmedOwner = owner.trim();
    if (!trimmedOwner) {
      setOwnerValid(null);
      setOwnerValidationMessage('GitHub username or organization is required.');
      return false;
    }

    setOwnerChecking(true);
    try {
      const response = await fetch(`https://api.github.com/users/${encodeURIComponent(trimmedOwner)}`);
      if (response.ok) {
        setOwnerValid(true);
        setOwnerValidationMessage('Owner/org exists on GitHub.');
        return true;
      }

      setOwnerValid(false);
      setOwnerValidationMessage('GitHub username or organization not found.');
      return false;
    } catch {
      setOwnerValid(false);
      setOwnerValidationMessage('Unable to verify owner/org on GitHub.');
      return false;
    } finally {
      setOwnerChecking(false);
    }
  };

  const verifyRepo = async (owner: string, repo: string) => {
    const trimmedRepo = repo.trim();
    if (!trimmedRepo) {
      setRepoValid(null);
      setRepoValidationMessage('');
      return true;
    }

    const trimmedOwner = owner.trim();
    if (!trimmedOwner) {
      setRepoValid(false);
      setRepoValidationMessage('Owner/org must be provided before verifying the repository.');
      return false;
    }

    setRepoChecking(true);
    try {
      const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(trimmedOwner)}/${encodeURIComponent(trimmedRepo)}`);
      if (response.ok) {
        setRepoValid(true);
        setRepoValidationMessage('Repository exists on GitHub.');
        return true;
      }

      setRepoValid(false);
      setRepoValidationMessage('GitHub repository not found for this owner.');
      return false;
    } catch {
      setRepoValid(false);
      setRepoValidationMessage('Unable to verify repository on GitHub.');
      return false;
    } finally {
      setRepoChecking(false);
    }
  };

  const renderValidationAdornment = (valid: boolean | null, checking: boolean) => {
    if (checking) {
      return (
        <InputAdornment position="end">
          <CircularProgress size={18} />
        </InputAdornment>
      );
    }

    if (valid === true) {
      return (
        <InputAdornment position="end">
          <CheckCircleIcon color="success" />
        </InputAdornment>
      );
    }

    if (valid === false) {
      return (
        <InputAdornment position="end">
          <ErrorOutlineIcon color="error" />
        </InputAdornment>
      );
    }

    return null;
  };

  const loadRunners = useCallback(async () => {
    if (!service) {
      setError('Unable to access the Docker VM service.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await service.get('/api/runners');
      setRunners((response as Runner[]) || []);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [service]);

  useEffect(() => {
    loadRunners();
  }, [loadRunners]);

  const openDialog = (runner?: Runner) => {
    if (runner) {
      setEditing(runner);
      setFormState({
        runnerName: runner.runnerName,
        owner: runner.owner,
        repo: runner.repo,
        registrationToken: '',
        labels: runner.labels
      });
    } else {
      setEditing(null);
      setFormState(defaultFormState);
    }
    setShowDialog(true);
  };

  const closeDialog = () => {
    setShowDialog(false);
    setEditing(null);
    setFormState(defaultFormState);
  };

  const saveRunner = async () => {
    if (!service) {
      setError('Unable to access the Docker VM service.');
      return;
    }

    const ownerOk = await verifyOwner(formState.owner);
    const repoOk = await verifyRepo(formState.owner, formState.repo);
    if (!ownerOk || !repoOk) {
      setError('Please fix the GitHub owner/org and repository validation errors before saving.');
      return;
    }

    setError(null);

    try {
      const payload = {
        runnerName: formState.runnerName,
        githubUrl: GITHUB_BASE_URL,
        owner: formState.owner,
        repo: formState.repo,
        isOrg: !formState.repo.trim(),
        registrationToken: formState.registrationToken,
        labels: formState.labels,
        hostContainerName: DEFAULT_HOST_CONTAINER_NAME,
        runnerRootPath: DEFAULT_RUNNER_ROOT_PATH
      };

      if (editing) {
        await service.put(`/api/runners/${editing.id}`, payload);
      } else {
        await service.post('/api/runners', payload);
      }

      closeDialog();
      loadRunners();
    } catch (err) {
      setError(String(err));
    }
  };

  const runAction = async (id: string, action: 'start' | 'stop' | 'restart') => {
    if (!service) {
      setError('Unable to access the Docker VM service.');
      return;
    }

    setError(null);

    try {
      await service.post(`/api/runners/${id}/${action}`, {});
      loadRunners();
    } catch (err) {
      setError(String(err));
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
      setError(String(err));
    }
  };

  return (
    <Box sx={{ p: 3 }}>
      <Stack spacing={3}>
        <Box>
          <Typography variant="h4" component="h1" gutterBottom>
            GitHub Runner Manager
          </Typography>
          <Typography color="text.secondary">
            Manage GitHub self-hosted runners inside Docker Desktop.
          </Typography>
        </Box>

        {error ? (
          <Box sx={{ p: 2, border: '1px solid', borderColor: 'error.main', borderRadius: 1, bgcolor: 'error.light', color: 'error.contrastText' }}>
            <Typography>{error}</Typography>
          </Box>
        ) : null}

        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Typography variant="h6">Runners</Typography>
          <Button variant="contained" onClick={() => openDialog()}>
            + Add runner
          </Button>
        </Stack>

        {loading ? (
          <Typography>Loading runners …</Typography>
        ) : runners.length === 0 ? (
          <Card>
            <CardContent>
              <Typography>No runners have been added yet.</Typography>
              <Button sx={{ mt: 2 }} variant="contained" onClick={() => openDialog()}>
                Add runner
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Stack spacing={2}>
            {runners.map((runner) => (
              <Card key={runner.id} sx={{ p: 2 }}>
                <Grid container spacing={2} alignItems="center">
                  <Grid item xs={12} md={9}>
                    <Typography variant="h6">{runner.runnerName}</Typography>
                    <Typography color="text.secondary" variant="body2">
                      {runner.hostContainerName} · {runner.runnerPath}
                    </Typography>
                  </Grid>
                  <Grid item xs={12} md={3}>
                    <Badge
                      badgeContent={runner.status.toUpperCase()}
                      color={runner.status === 'on' ? 'success' : runner.status === 'paused' ? 'warning' : 'default'}
                    />
                  </Grid>
                </Grid>

                <Grid container spacing={2} sx={{ mt: 2 }}>
                  <Grid item xs={12} md={6}>
                    <Typography><strong>GitHub URL:</strong> {runner.githubUrl}</Typography>
                    <Typography><strong>Owner:</strong> {runner.owner}</Typography>
                    <Typography><strong>Repo:</strong> {runner.repo || '(org)'}</Typography>
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Typography><strong>Labels:</strong> {runner.labels.join(', ')}</Typography>
                    <Typography><strong>Created:</strong> {new Date(runner.createdAt).toLocaleString()}</Typography>
                    <Typography><strong>Raw status:</strong> {runner.dockerRawStatus || 'unknown'}</Typography>
                  </Grid>
                </Grid>

                <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mt: 2 }}>
                  <Button variant="outlined" onClick={() => runAction(runner.id, 'start')}>
                    ▶️ Start
                  </Button>
                  <Button variant="outlined" color="error" onClick={() => runAction(runner.id, 'stop')}>
                    ⏹️ Stop
                  </Button>
                  <Button variant="outlined" onClick={() => runAction(runner.id, 'restart')}>
                    🔄 Restart
                  </Button>
                  <Button variant="outlined" color="secondary" onClick={() => openDialog(runner)}>
                    ✏️ Edit
                  </Button>
                  <Button variant="outlined" color="inherit" onClick={() => deleteRunner(runner.id)}>
                    🗑️ Delete
                  </Button>
                </Stack>
              </Card>
            ))}
          </Stack>
        )}
      </Stack>

      <Dialog open={showDialog} onClose={closeDialog} fullWidth maxWidth="md">
        <DialogTitle>{editing ? 'Edit runner' : 'Add runner'}</DialogTitle>
        <DialogContent>
          <Box sx={{ mb: 2, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1, bgcolor: 'background.paper' }}>
            <Typography variant="subtitle2" gutterBottom>
              Hidden configuration
            </Typography>
            <Typography variant="body2" color="text.secondary">
              GitHub Base URL, Host container name, and Runner root path are managed by the extension and are not editable here.
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Default values used:
            </Typography>
            <Typography variant="body2" component="div" color="text.secondary">
              • GitHub Base URL: {GITHUB_BASE_URL}
            </Typography>
            <Typography variant="body2" component="div" color="text.secondary">
              • Host container name: {DEFAULT_HOST_CONTAINER_NAME}
            </Typography>
            <Typography variant="body2" component="div" color="text.secondary">
              • Runner root path: {DEFAULT_RUNNER_ROOT_PATH}
            </Typography>
          </Box>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label="Runner name"
              value={formState.runnerName}
              onChange={(event) => setFormState({ ...formState, runnerName: event.target.value })}
              helperText="A local identifier for this runner. It becomes the runner directory name inside the host container."
              fullWidth
            />
            <TextField
              label="User or org name"
              value={formState.owner}
              onChange={(event) => {
                const owner = event.target.value;
                setFormState({ ...formState, owner });
                setOwnerValid(null);
                setRepoValid(null);
                setOwnerValidationMessage('');
                setRepoValidationMessage('');
              }}
              onBlur={() => verifyOwner(formState.owner)}
              helperText=" "
              FormHelperTextProps={{ sx: { visibility: 'hidden' } }}
              error={ownerValid === false}
              fullWidth
              InputProps={{
                endAdornment: renderValidationAdornment(ownerValid, ownerChecking)
              }}
            />
            {ownerValid === false && ownerValidationMessage ? (
              <Alert severity="error" sx={{ mt: 1 }}>
                {ownerValidationMessage}
              </Alert>
            ) : null}
            <TextField
              label="Repository name"
              value={formState.repo}
              onChange={(event) => {
                const repo = event.target.value;
                setFormState({ ...formState, repo });
                setRepoValid(null);
                setRepoValidationMessage('');
              }}
              onBlur={() => verifyRepo(formState.owner, formState.repo)}
              helperText=" "
              FormHelperTextProps={{ sx: { visibility: 'hidden' } }}
              error={repoValid === false}
              fullWidth
              InputProps={{
                endAdornment: renderValidationAdornment(repoValid, repoChecking)
              }}
            />
            {repoValid === false && repoValidationMessage ? (
              <Alert severity="error" sx={{ mt: 1 }}>
                {repoValidationMessage}
              </Alert>
            ) : null}
            {!editing && (
              <TextField
                label="GitHub registration token"
                type="password"
                value={formState.registrationToken}
                onChange={(event) => setFormState({ ...formState, registrationToken: event.target.value })}
                helperText="A runner registration token from GitHub Actions settings. Create one in your repo or org settings."
                fullWidth
              />
            )}
            <Autocomplete
              multiple
              freeSolo
              options={labelOptions}
              value={formState.labels}
              onChange={(_, value) => setFormState({ ...formState, labels: value as string[] })}
              renderTags={(value, getTagProps) =>
                value.map((option, index) => <Chip label={option} {...getTagProps({ index })} key={option} />)
              }
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Runner labels"
                  placeholder="Add runner labels"
                  helperText="Optional labels used by GitHub workflows to target this runner."
                />
              )}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog}>Cancel</Button>
          <Button variant="contained" onClick={saveRunner}>
            Save runner
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
