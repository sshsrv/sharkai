import fs from 'node:fs';
import path from 'node:path';
import { MODELS } from './config.js';

const DATA_DIR = process.env.DATA_DIR ?? './data';
const FILE = path.join(DATA_DIR, 'usage.json');

interface UsageState {
	date: string;
	byModel: Record<string, number>;
}

function today(): string {
	return new Date().toISOString().slice(0, 10);
}

function fresh(): UsageState {
	return { date: today(), byModel: {} };
}

function load(): UsageState {
	try {
		if (fs.existsSync(FILE)) {
			const raw = JSON.parse(fs.readFileSync(FILE, 'utf-8')) as Partial<UsageState>;
			if (raw.date === today()) {
				return {
					date: today(),
					byModel: raw.byModel ?? {},
				};
			}
		}
	} catch {
	}
	return fresh();
}

function save(): void {
	try {
		fs.mkdirSync(DATA_DIR, { recursive: true });
		fs.writeFileSync(FILE, JSON.stringify(state));
	} catch {
	}
}

let state: UsageState = load();

export function recordRequest(provider: string, model: string): void {
	if (state.date !== today()) state = load();
	state.byModel[model] = (state.byModel[model] ?? 0) + 1;
	save();
}

export function getModelUsage(model: string): { used: number; limit: number } {
	if (state.date !== today()) state = load();
	const used = state.byModel[model] ?? 0;
	const limit = MODELS[model]?.rpd ?? 0;
	return { used, limit };
}

export function getUsage(): UsageState {
	if (state.date !== today()) state = load();
	return state;
}
