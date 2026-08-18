export type TranslationArgs = Record<string, string | number>;

function interpolate(message: string, args?: TranslationArgs): string {
  if (!args) {
    return message;
  }

  return message.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(args, key) ? String(args[key]) : match
  );
}

/**
 * Backend translation boundary. The backend currently serves the selected
 * catalog to the UI; until backend locale state is shared per request, the
 * English message ID is the safe fallback for backend diagnostics.
 */
export function t(message: string, args?: TranslationArgs): string {
  return interpolate(message, args);
}
