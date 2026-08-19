# Changelog

## 1.0.1 - 2026-08-19

### Added

- Added environment-backed Crowdin configuration for the GH Runner Manager localization workflow.
- Added Crowdin project integration documentation and localization status visibility.

### Fixed

- Fixed the mismatched Docker Compose project label, changing it from `mrtrilb_gh-runner-desktop-extension` to `mrtrilb_gh-runner-manager-desktop-extension`.

### Notes

- Crowdin authentication and project integration are configured. The current Crowdin project is string-based, so complete file-based catalog synchronization remains unavailable through the existing CLI configuration.
