import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_MODEL } from './config.js';

interface UserPrefs {
  model: string;
  prompt: string;
}

const DATA_DIR = process.env.DATA_DIR ?? './data';
const DATA_FILE = path.join(DATA_DIR, 'prefs.json');

// Mapa userId -> preferencias. En memoria + persistido a disco.
const prefs = new Map<string, UserPrefs>();

function load(): void {
  try {
    if (!fs.existsSync(DATA_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')) as Record<string, UserPrefs>;
    for (const [k, v] of Object.entries(raw)) {
      if (v && typeof v === 'object') {
        prefs.set(k, {
          model: v.model ?? DEFAULT_MODEL,
          prompt: v.prompt ?? '',
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

export function getModel(userId: string): string {
  return prefs.get(userId)?.model ?? DEFAULT_MODEL;
}

export function setModel(userId: string, model: string): void {
  const cur = prefs.get(userId) ?? { model: DEFAULT_MODEL, prompt: '' };
  cur.model = model;
  prefs.set(userId, cur);
  save();
}

export function getPrompt(userId: string): string {
  return prefs.get(userId)?.prompt ?? '';
}

export function setPrompt(userId: string, prompt: string): void {
  const cur = prefs.get(userId) ?? { model: DEFAULT_MODEL, prompt: '' };
  cur.prompt = prompt;
  prefs.set(userId, cur);
  save();
}

export function resetUser(userId: string): void {
  prefs.delete(userId);
  save();
}
