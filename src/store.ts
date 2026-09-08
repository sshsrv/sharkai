import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_MODEL, Language } from './config.js';

interface UserPrefs {
  model: string;
  prompt: string;
  language: Language;
}

const DATA_DIR = process.env.DATA_DIR ?? './data';
const DATA_FILE = path.join(DATA_DIR, 'prefs.json');

// Mapa userId -> preferencias. En memoria + persistido a disco.
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
        });
      }
    }
  } catch {
    // Si el JSON está corrupto, arrancamos limpio.
  }
}

function save(): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const obj = Object.fromEntries(prefs.entries());
    fs.writeFileSync(DATA_FILE, JSON.stringify(obj, null, 2));
  } catch {
    // El fallo de persistencia no debe tirar el bot.
  }
}

load();

function upsert(userId: string): UserPrefs {
  const cur = prefs.get(userId) ?? { model: DEFAULT_MODEL, prompt: '', language: 'es' as Language };
  prefs.set(userId, cur);
  return cur;
}

export function getModel(userId: string): string {
  return prefs.get(userId)?.model ?? DEFAULT_MODEL;
}

export function setModel(userId: string, model: string): void {
  upsert(userId).model = model;
  save();
}

export function getPrompt(userId: string): string {
  return prefs.get(userId)?.prompt ?? '';
}

export function setPrompt(userId: string, prompt: string): void {
  upsert(userId).prompt = prompt;
  save();
}

export function getLanguage(userId: string): Language {
  return prefs.get(userId)?.language ?? 'es';
}

export function setLanguage(userId: string, language: Language): void {
  upsert(userId).language = language;
  save();
}

export function resetUser(userId: string): void {
  prefs.delete(userId);
  save();
}