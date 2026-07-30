"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadRunners = loadRunners;
exports.saveRunners = saveRunners;
exports.saveRunner = saveRunner;
exports.deleteRunner = deleteRunner;
const fs_1 = require("fs");
const path_1 = require("path");
const storagePath = (0, path_1.join)(__dirname, 'data', 'runners.json');
async function loadRunners() {
    try {
        const contents = await fs_1.promises.readFile(storagePath, 'utf8');
        return JSON.parse(contents);
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            await saveRunners([]);
            return [];
        }
        throw error;
    }
}
async function saveRunners(runners) {
    await fs_1.promises.mkdir((0, path_1.join)(__dirname, 'data'), { recursive: true });
    await fs_1.promises.writeFile(storagePath, JSON.stringify(runners, null, 2), 'utf8');
}
async function saveRunner(config) {
    const runners = await loadRunners();
    const existing = runners.find((item) => item.id === config.id);
    if (existing) {
        const updated = runners.map((item) => (item.id === config.id ? config : item));
        await saveRunners(updated);
        return;
    }
    runners.push(config);
    await saveRunners(runners);
}
async function deleteRunner(id) {
    const runners = await loadRunners();
    const updated = runners.filter((item) => item.id !== id);
    await saveRunners(updated);
}
