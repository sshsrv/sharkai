import { loadStrings } from './config-loader.js';
import type { Language } from './config.js';

const STRINGS = loadStrings();

export function t(lang: Language, key: string, ...args: string[]): string {
    const raw = STRINGS?.responses?.[lang]?.[key] ?? STRINGS?.responses?.en?.[key] ?? key;

    if (typeof raw !== 'string') return key;
    if (args.length === 0) return raw;

    return raw.replace(/\{\{(\d+)\}\}/g, (_, idx: string) => args[Number(idx)] ?? `{{${idx}}}`);
}
