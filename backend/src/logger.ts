import { appendLogEntry } from './logStorage';
import { loadSettings } from './settingsStorage';

export type LogCategory = 'ui' | 'runner' | 'githubApi' | 'general';

export async function logIfEnabled(category: LogCategory, entry: string) {
  try {
    const settings = await loadSettings();
    const shouldLog =
      category === 'general' ||
      (category === 'ui' && settings.uiLoggingEnabled) ||
      (category === 'runner' && settings.runnerLoggingEnabled) ||
      (category === 'githubApi' && settings.githubApiLoggingEnabled);

    if (!shouldLog) {
      return;
    }
  } catch {
    // If settings cannot be read, fallback to logging the entry so diagnostics are still available.
  }

  await appendLogEntry(`[${category}] ${entry}`);
}
