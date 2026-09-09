import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_MODEL, HISTORY_LIMIT, Language } from './config.js';

interface HistoryEntry {
role: 'user' | 'assistant';
content: string;
}

interface UserPrefs {
model: string;
prompt: string;
language: Language;
history: HistoryEntry[];
}

const DATA_DIR = process.env.DATA_DIR ?? './data';
const DATA_FILE = path.join(DATA_DIR, 'prefs.json');

const prefs = new Map<string, UserPrefs>();

function load(): void {
try {
if (!fs.existsSync(DATA_FILE)) return;
const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')) as Record<string, Partial<UserPrefs>>;
for (const [k, v] of Object.entries(raw)) {
if (v && typeof v === 'object') {
prefs.set(k, {
model: v.model ?? DEFAULT_MODEL,
prompt: v.prompt ?? '',
language: v.language === 'en' ? 'en' : 'es',
history: Array.isArray(v.history) ? v.history.slice(-HISTORY_LIMIT) : [],
});
}
}
} catch {
}
}

function writeDisk(): void {
try {
fs.mkdirSync(DATA_DIR, { recursive: true });
const obj = Object.fromEntries(prefs.entries());
fs.writeFileSync(DATA_FILE, JSON.stringify(obj, null, 2));
} catch {
}
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSave(): void {
if (debounceTimer !== null) clearTimeout(debounceTimer);
debounceTimer = setTimeout(() => {
debounceTimer = null;
writeDisk();
}, 500);
}

load();

function upsert(userId: string): UserPrefs {
const cur = prefs.get(userId) ?? {
model: DEFAULT_MODEL,
prompt: '',
language: 'en' as Language,
history: [],
};
prefs.set(userId, cur);
return cur;
}

export { HISTORY_LIMIT };

export function getModel(userId: string): string {
return prefs.get(userId)?.model ?? DEFAULT_MODEL;
}

export function setModel(userId: string, model: string): void {
upsert(userId).model = model;
scheduleSave();
}

export function getPrompt(userId: string): string {
return prefs.get(userId)?.prompt ?? '';
}

export function setPrompt(userId: string, prompt: string): void {
upsert(userId).prompt = prompt;
scheduleSave();
}

export function getLanguage(userId: string): Language {
return prefs.get(userId)?.language ?? 'en';
}

export function setLanguage(userId: string, language: Language): void {
upsert(userId).language = language;
scheduleSave();
}

export function getHistory(userId: string): HistoryEntry[] {
return prefs.get(userId)?.history ?? [];
}

export function appendHistory(userId: string, role: HistoryEntry['role'], content: string): void {
const p = upsert(userId);
p.history.push({ role, content });
if (p.history.length > HISTORY_LIMIT) {
p.history = p.history.slice(-HISTORY_LIMIT);
}
scheduleSave();
}

export function clearHistory(userId: string): void {
const p = upsert(userId);
p.history = [];
scheduleSave();
}

export function resetUser(userId: string): void {
prefs.delete(userId);
scheduleSave();
}
