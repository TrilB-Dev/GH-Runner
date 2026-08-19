# Changelog

## 1.0.1 - 2026-08-19

### Added

- Added environment-backed Crowdin configuration for the GH Runner Manager localization workflow.
- Added Crowdin project integration documentation and localization status visibility.

### Fixed

- Fixed the mismatched Docker Compose project label, changing it from `mrtrilb_gh-runner-desktop-extension` to `mrtrilb_gh-runner-manager-desktop-extension`.

### Notes

- Recreated the Crowdin project as a file-based project and validated source catalog synchronization with the pinned Crowdin CLI.
- Translation targets are configured for German, English (US), Spanish, French, Italian, and Dutch; translations remain at 0% until localization work is completed.
