"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logIfEnabled = logIfEnabled;
const logStorage_1 = require("./logStorage");
const settingsStorage_1 = require("./settingsStorage");
async function logIfEnabled(category, entry) {
    try {
        const settings = await (0, settingsStorage_1.loadSettings)();
        const shouldLog = category === 'general' ||
            (category === 'ui' && settings.uiLoggingEnabled) ||
            (category === 'runner' && settings.runnerLoggingEnabled) ||
            (category === 'githubApi' && settings.githubApiLoggingEnabled);
        if (!shouldLog) {
            return;
        }
    }
    catch {
        // If settings cannot be read, fallback to logging the entry so diagnostics are still available.
    }
    await (0, logStorage_1.appendLogEntry)(`[${category}] ${entry}`);
}
