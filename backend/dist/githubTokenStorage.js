"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadGithubTokens = loadGithubTokens;
exports.saveGithubTokens = saveGithubTokens;
exports.saveGithubToken = saveGithubToken;
exports.deleteGithubToken = deleteGithubToken;
exports.getGithubTokenById = getGithubTokenById;
const fs_1 = require("fs");
const path_1 = require("path");
const storagePath = (0, path_1.join)(__dirname, 'data', 'github-tokens.json');
async function loadGithubTokens() {
    try {
        const contents = await fs_1.promises.readFile(storagePath, 'utf8');
        return JSON.parse(contents);
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            await saveGithubTokens([]);
            return [];
        }
        throw error;
    }
}
async function saveGithubTokens(tokens) {
    await fs_1.promises.mkdir((0, path_1.join)(__dirname, 'data'), { recursive: true });
    await fs_1.promises.writeFile(storagePath, JSON.stringify(tokens, null, 2), 'utf8');
}
async function saveGithubToken(tokenConfig) {
    const tokens = await loadGithubTokens();
    const existingIndex = tokens.findIndex((item) => item.id === tokenConfig.id);
    if (existingIndex >= 0) {
        tokens[existingIndex] = tokenConfig;
    }
    else {
        tokens.push(tokenConfig);
    }
    await saveGithubTokens(tokens);
}
async function deleteGithubToken(id) {
    const tokens = await loadGithubTokens();
    const updated = tokens.filter((item) => item.id !== id);
    await saveGithubTokens(updated);
}
async function getGithubTokenById(id) {
    const tokens = await loadGithubTokens();
    return tokens.find((item) => item.id === id);
}
