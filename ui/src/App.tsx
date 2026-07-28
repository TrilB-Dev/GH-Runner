import { useCallback, useEffect, useMemo, useState } from 'react';
import { createDockerDesktopClient } from '@docker/extension-api-client';
import {
  Autocomplete,
  Badge,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  Stack,
  TextField,
  Typography
} from '@mui/material';

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
  githubUrl: string;
  owner: string;
  repo: string;
  registrationToken: string;
  labels: string[];
  hostContainerName: string;
  runnerRootPath: string;
}

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
  githubUrl: 'https://github.com',
  owner: '',
  repo: '',
  registrationToken: '',
  labels: [],
  hostContainerName: '',
  runnerRootPath: '/opt/github'
};

export function App() {
  const ddClient = useMemo(() => client, []);
  const [runners, setRunners] = useState<Runner[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDialog, setShowDialog] = useState(false);
  const [editing, setEditing] = useState<Runner | null>(null);
  const [formState, setFormState] = useState<RunnerForm>(defaultFormState);
  const [error, setError] = useState<string | null>(null);

  const service = ddClient.extension.vm?.service;

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
        githubUrl: runner.githubUrl,
        owner: runner.owner,
        repo: runner.repo,
        registrationToken: '',
        labels: runner.labels,
        hostContainerName: runner.hostContainerName,
        runnerRootPath: runner.runnerRootPath
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

    setError(null);

    try {
      const payload = {
        runnerName: formState.runnerName,
        githubUrl: formState.githubUrl,
        owner: formState.owner,
        repo: formState.repo,
        isOrg: !formState.repo.trim(),
        registrationToken: formState.registrationToken,
        labels: formState.labels,
        hostContainerName: formState.hostContainerName,
        runnerRootPath: formState.runnerRootPath
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
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label="Runner name"
              value={formState.runnerName}
              onChange={(event) => setFormState({ ...formState, runnerName: event.target.value })}
              fullWidth
            />
            <TextField
              label="GitHub base URL"
              value={formState.githubUrl}
              onChange={(event) => setFormState({ ...formState, githubUrl: event.target.value })}
              fullWidth
            />
            <TextField
              label="User or org name"
              value={formState.owner}
              onChange={(event) => setFormState({ ...formState, owner: event.target.value })}
              fullWidth
            />
            <TextField
              label="Repository name"
              value={formState.repo}
              onChange={(event) => setFormState({ ...formState, repo: event.target.value })}
              helperText="Leave blank for organization-level runners"
              fullWidth
            />
            {!editing && (
              <TextField
                label="GitHub registration token"
                type="password"
                value={formState.registrationToken}
                onChange={(event) => setFormState({ ...formState, registrationToken: event.target.value })}
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
              renderInput={(params) => <TextField {...params} label="Runner labels" placeholder="Add runner labels" />}
            />
            <TextField
              label="Host container name"
              value={formState.hostContainerName}
              onChange={(event) => setFormState({ ...formState, hostContainerName: event.target.value })}
              fullWidth
            />
            <TextField
              label="Runner root path"
              value={formState.runnerRootPath}
              onChange={(event) => setFormState({ ...formState, runnerRootPath: event.target.value })}
              fullWidth
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
