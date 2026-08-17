import { promises as fs } from 'fs';
import { join } from 'path';

export interface LoggingSettings {
  uiLoggingEnabled: boolean;
  runnerLoggingEnabled: boolean;
  githubApiLoggingEnabled: boolean;
  startRunnersOnStartup: boolean;
  language: string;
}

const settingsDir = join(__dirname, 'data');
const settingsPath = join(settingsDir, 'settings.json');

const defaultSettings: LoggingSettings = {
  uiLoggingEnabled: false,
  runnerLoggingEnabled: false,
  githubApiLoggingEnabled: false,
  startRunnersOnStartup: false,
  language: 'en_GB'
};

export async function loadSettings(): Promise<LoggingSettings> {
  try {
    const raw = await fs.readFile(settingsPath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<LoggingSettings>;
    return {
      ...defaultSettings,
      uiLoggingEnabled: parsed.uiLoggingEnabled ?? defaultSettings.uiLoggingEnabled,
      runnerLoggingEnabled: parsed.runnerLoggingEnabled ?? defaultSettings.runnerLoggingEnabled,
      githubApiLoggingEnabled: parsed.githubApiLoggingEnabled ?? defaultSettings.githubApiLoggingEnabled,
      startRunnersOnStartup: parsed.startRunnersOnStartup ?? defaultSettings.startRunnersOnStartup,
      language: parsed.language ?? defaultSettings.language
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return defaultSettings;
    }
    throw error;
  }
}

export async function saveSettings(settings: LoggingSettings): Promise<void> {
  await fs.mkdir(settingsDir, { recursive: true });
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
}
