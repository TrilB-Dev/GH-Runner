"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.appendLogEntry = appendLogEntry;
exports.readLogEntries = readLogEntries;
exports.clearLogEntries = clearLogEntries;
const fs_1 = require("fs");
const path_1 = require("path");
const logStorageDir = (0, path_1.join)(__dirname, 'data');
const logFilePath = (0, path_1.join)(logStorageDir, 'extension.log');
async function appendLogEntry(entry) {
    await fs_1.promises.mkdir(logStorageDir, { recursive: true });
    const timestamp = new Date().toISOString();
    await fs_1.promises.appendFile(logFilePath, `[${timestamp}] ${entry}\n`, 'utf8');
}
async function readLogEntries() {
    try {
        return await fs_1.promises.readFile(logFilePath, 'utf8');
    }
    catch (err) {
        if (err.code === 'ENOENT') {
            return '';
        }
        throw err;
    }
}
async function clearLogEntries() {
    await fs_1.promises.mkdir(logStorageDir, { recursive: true });
    await fs_1.promises.writeFile(logFilePath, '', 'utf8');
}
