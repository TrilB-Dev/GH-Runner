"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadSettings = loadSettings;
exports.saveSettings = saveSettings;
const fs_1 = require("fs");
const path_1 = require("path");
const settingsDir = (0, path_1.join)(__dirname, 'data');
const settingsPath = (0, path_1.join)(settingsDir, 'settings.json');
const defaultSettings = {
    uiLoggingEnabled: false,
    runnerLoggingEnabled: false,
    githubApiLoggingEnabled: false,
    startRunnersOnStartup: false,
    language: 'en_GB'
};
async function loadSettings() {
    try {
        const raw = await fs_1.promises.readFile(settingsPath, 'utf8');
        const parsed = JSON.parse(raw);
        return {
            ...defaultSettings,
            uiLoggingEnabled: parsed.uiLoggingEnabled ?? defaultSettings.uiLoggingEnabled,
            runnerLoggingEnabled: parsed.runnerLoggingEnabled ?? defaultSettings.runnerLoggingEnabled,
            githubApiLoggingEnabled: parsed.githubApiLoggingEnabled ?? defaultSettings.githubApiLoggingEnabled,
            startRunnersOnStartup: parsed.startRunnersOnStartup ?? defaultSettings.startRunnersOnStartup,
            language: parsed.language ?? defaultSettings.language
        };
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return defaultSettings;
        }
        throw error;
    }
}
async function saveSettings(settings) {
    await fs_1.promises.mkdir(settingsDir, { recursive: true });
    await fs_1.promises.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
}
