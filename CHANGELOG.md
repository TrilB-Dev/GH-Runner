# Changelog

## 1.0.3 - 2026-08-29

### Fixed

- Added passwordless sudo configuration for the `githubrunner` user so GitHub Actions tools such as `shivammathur/setup-php` can install and configure dependencies.

## 1.0.2 - 2026-08-27

### Added

- Added PHP 8.3, 8.4, and 8.5 runtimes to runner host containers.
- Added Node.js 24 to runner host containers.
- Added PHP_CodeSniffer and WordPress Coding Standards through Composer.

### Fixed

- Existing runner host containers now detect and apply the updated development toolchain.

## 1.0.1 - 2026-08-19

### Added

- Added environment-backed Crowdin configuration for the GH Runner Manager localization workflow.
- Added Crowdin project integration documentation and localization status visibility.

### Fixed

- Fixed the mismatched Docker Compose project label, changing it from `mrtrilb_gh-runner-desktop-extension` to `mrtrilb_gh-runner-manager-desktop-extension`.

### Notes

- Recreated the Crowdin project as a file-based project and validated source catalog synchronization with the pinned Crowdin CLI.
- Translation targets are configured for German, English (US), Spanish, French, Italian, and Dutch; translations remain at 0% until localization work is completed.
