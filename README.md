<p align="left">
  <img src="https://raw.githubusercontent.com/TrilB-Dev/GH-Runner/Master/Assets/Logo/GH-Runner-Logo.svg" alt="GH Runner Manager logo" width="400">
</p>

GH Runner Manager is a Docker Desktop extension for creating and managing GitHub self-hosted Actions runners inside a persistent Docker host container.

## Features

- Repository-level and organization-level self-hosted runners.
- Organization runner groups.
- Persistent runner configuration, labels, and startup preferences.
- Saved GitHub authentication methods with token replacement and deletion.
- Automatic runner startup after the extension backend and Docker host are ready.
- Runner status, start, stop, restart, host refresh, version information, and diagnostic logs.

## Requirements

- Docker Desktop with Docker Extensions enabled.
- A GitHub classic personal access token with:
  - `repo` for private repository runners.
  - `public_repo` for public repository-only access.
  - `admin:org` for organization runners and runner groups.

## Build and Install

The release version is defined in [metadata.json](metadata.json). Build the extension image with:

```powershell
docker build --tag=mrtrilb/gh-runner-manager:latest .
```

Install it in Docker Desktop with:

```powershell
docker extension install mrtrilb/gh-runner-manager:latest
```

For an existing installation, use:

```powershell
docker extension update mrtrilb/gh-runner-manager:latest
```

The equivalent Makefile targets are `build-extension`, `install-extension`, and `update-extension`.

## Runner Startup

Automatic startup requires both settings to be enabled:

1. Enable **Start runners on Docker startup** in Settings.
2. Enable **Start on startup** for each runner that should launch automatically.

The backend waits for the host container to be ready and retries startup during cold Docker Desktop initialization. Runner definitions are stored separately from the host container, so recreating the host container does not remove configured runners.

## Persistent Data

The extension uses these Docker volumes:

- `gh-runner-manager-data` stores backend settings, saved GitHub authentication methods, and logs.
- `gh-runner-manager-runners` stores runner installations and registration state.

Do not remove these volumes unless you intend to delete the associated data. The Tools settings provide explicit volume-clear actions.

## Development

Build the backend locally:

```powershell
Set-Location backend
npm install
npm run build
```

Build the UI locally:

```powershell
Set-Location ui
npm ci
npm run build
```

Build the complete extension image from the repository root:

```powershell
docker build --tag=mrtrilb/gh-runner-manager:latest .
```

## Release Checks

Before publishing a release:

1. Confirm the version in `metadata.json`.
2. Run the backend and UI builds.
3. Build the Docker image from a clean checkout.
4. Install or update the extension and verify the UI opens.
5. Restart the extension service or Docker Desktop and confirm runners marked for startup become active.
6. Confirm runner data and settings survive the restart.

## Security Note

Saved GitHub tokens are stored in the extension data volume and are not returned to the UI after saving. Access to the Docker Desktop extension data and Docker socket should be restricted to trusted users. Encryption at rest and key management are planned for a future security-focused release.

## License and Support

See the repository license and project documentation for licensing, support, and contribution information.
