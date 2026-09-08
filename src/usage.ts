import fs from 'node:fs';
import path from 'node:path';
import type { Provider } from './config.js';

/**
 * Uso diario COMPARTIDO entre todos los modelos y providers.
 * Todos tiran de la misma cuota (misma cuenta/API), así que hay UN solo contador
 * que se muestra en /sh usage y en el footer de /sh ask.
 */

/** Límite diario compartido (env: SHARED_DAILY_LIMIT, default 1000). */
export const DAILY_LIMIT = Math.max(
	1,
	parseInt(process.env.SHARED_DAILY_LIMIT ?? '1000', 10) || 1000,
);

const DATA_DIR = process.env.DATA_DIR ?? './data';
const FILE = path.join(DATA_DIR, 'usage.json');

interface UsageState {
	/** Día UTC (YYYY-MM-DD) al que pertenece el contador. */
	date: string;
	requests: number;
	byProvider: Record<Provider, number>;
}

function today(): string {
	return new Date().toISOString().slice(0, 10);
}

function fresh(): UsageState {
	return { date: today(), requests: 0, byProvider: { groq: 0, google: 0 } };
}

function load(): UsageState {
	try {
		if (fs.existsSync(FILE)) {
			const raw = JSON.parse(fs.readFileSync(FILE, 'utf-8')) as Partial<UsageState>;
			if (raw.date === today()) {
				return {
					date: today(),
					requests: raw.requests ?? 0,
					byProvider: {
						groq: raw.byProvider?.groq ?? 0,
						google: raw.byProvider?.google ?? 0,
					},
				};
			}
		}
	} catch {
		// JSON corrupto -> arrancamos limpio.
	}
	return fresh();
}

function save(): void {
	try {
		fs.mkdirSync(DATA_DIR, { recursive: true });
		fs.writeFileSync(FILE, JSON.stringify(state));
	} catch {
		// El fallo de persistencia no debe tirar el bot.
	}
}

let state: UsageState = load();

/** Registra una petición de IA completada (compartida entre todos los usuarios y providers). */
export function recordRequest(provider: Provider): void {
	if (state.date !== today()) state = load();
	state.requests += 1;
	state.byProvider[provider] = (state.byProvider[provider] ?? 0) + 1;
	save();
}

export function getUsage(): UsageState {
	if (state.date !== today()) state = load();
	return state;
}