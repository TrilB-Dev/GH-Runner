"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.t = t;
function interpolate(message, args) {
    if (!args) {
        return message;
    }
    return message.replace(/\{(\w+)\}/g, (match, key) => Object.prototype.hasOwnProperty.call(args, key) ? String(args[key]) : match);
}
/**
 * Backend translation boundary. The backend currently serves the selected
 * catalog to the UI; until backend locale state is shared per request, the
 * English message ID is the safe fallback for backend diagnostics.
 */
function t(message, args) {
    return interpolate(message, args);
}
