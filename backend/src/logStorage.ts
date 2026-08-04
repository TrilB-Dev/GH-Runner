import { promises as fs } from 'fs';
import { join } from 'path';

const logStorageDir = join(__dirname, 'data');
const logFilePath = join(logStorageDir, 'extension.log');

export async function appendLogEntry(entry: string) {
  await fs.mkdir(logStorageDir, { recursive: true });
  const timestamp = new Date().toISOString();
  await fs.appendFile(logFilePath, `[${timestamp}] ${entry}\n`, 'utf8');
}

export async function readLogEntries(): Promise<string> {
  try {
    return await fs.readFile(logFilePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return '';
    }
    throw err;
  }
}

export async function clearLogEntries(): Promise<void> {
  await fs.mkdir(logStorageDir, { recursive: true });
  await fs.writeFile(logFilePath, '', 'utf8');
}
