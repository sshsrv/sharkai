import fs from 'node:fs';
import path from 'node:path';
import { env, MODELS, DEFAULT_PROMPT_EN, DEFAULT_PROMPT_ES, type Provider } from './config.js';
import { getModel, getPrompt, getLanguage, getHistory } from './store.js';

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const GOOGLE_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';


export interface RateLimits {
	remainingRequests: number | null;
	limitRequests: number | null;
	
	resetRequests: string | null;
	remainingTokens: number | null;
	limitTokens: number | null;
	resetTokens: string | null;
}

export interface AskResult {
	text: string;
	model: string;
	provider: Provider;
	usage: {
		promptTokens: number;
		completionTokens: number;
		totalTokens: number;
	};
}

interface ChatMessage {
	role: string;
	content: string;
}


const DATA_DIR = process.env.DATA_DIR ?? './data';
const LIMITS_FILE = path.join(DATA_DIR, 'limits.json');

const OBSERVED_TTL_MS = 60_000;

const observedLimits = new Map<string, { rateLimits: RateLimits; at: number }>();

function saveObserved(): void {
	try {
		fs.mkdirSync(DATA_DIR, { recursive: true });
		fs.writeFileSync(LIMITS_FILE, JSON.stringify(Object.fromEntries(observedLimits.entries())));
	} catch {
	}
}

function loadObserved(): void {
	try {
		if (!fs.existsSync(LIMITS_FILE)) return;
		const raw = JSON.parse(fs.readFileSync(LIMITS_FILE, 'utf-8')) as Record<
			string,
			{ rateLimits?: RateLimits; at?: number }
		>;
		for (const [model, v] of Object.entries(raw)) {
			if (v?.rateLimits) {
				observedLimits.set(model, { rateLimits: v.rateLimits, at: typeof v.at === 'number' ? v.at : 0 });
			}
		}
	} catch {
	}
}

loadObserved();

function recordObserved(model: string, rateLimits: RateLimits): void {
	if (!rateLimits) return;
	observedLimits.set(model, { rateLimits, at: Date.now() });
	saveObserved();
}


export function getObservedLimits(model: string): RateLimits | null {
	return observedLimits.get(model)?.rateLimits ?? null;
}

function readRateLimits(headers: Headers): RateLimits {
	const num = (k: string): number | null => {
		const v = headers.get(k);
		return v !== null && v !== undefined && v !== '' ? Number(v) : null;
	};
	const str = (k: string): string | null => {
		const v = headers.get(k);
		return v !== null && v !== undefined && v !== '' ? v : null;
	};
	return {
		remainingRequests: num('x-ratelimit-remaining-requests'),
		limitRequests: num('x-ratelimit-limit-requests'),
		resetRequests: str('x-ratelimit-reset-requests'),
		remainingTokens: num('x-ratelimit-remaining-tokens'),
		limitTokens: num('x-ratelimit-limit-tokens'),
		resetTokens: str('x-ratelimit-reset-tokens'),
	};
}

interface GroqResponse {
	choices?: Array<{ message?: { content?: string | null } }>;
	usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
	error?: { message?: string };
}

async function groqComplete(
	model: string,
	messages: ChatMessage[],
	maxTokens: number,
): Promise<{ data: GroqResponse; headers: Headers }> {
	const res = await fetch(GROQ_ENDPOINT, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			authorization: `Bearer ${env.groqApiKey}`,
		},
		body: JSON.stringify({ model, messages, temperature: 0.7, max_tokens: maxTokens }),
	});

	const data = (await res.json()) as GroqResponse;

	if (!res.ok || data.error) {
		throw new Error(data.error?.message ?? `HTTP ${res.status}`);
	}

	recordObserved(model, readRateLimits(res.headers));

	return { data, headers: res.headers };
}

interface GoogleResponse {
	candidates?: Array<{
		content?: {
			parts?: Array<{ text?: string; thought?: boolean }>;
		};
	}>;
	usageMetadata?: {
		promptTokenCount?: number;
		candidatesTokenCount?: number;
		totalTokenCount?: number;
	};
	error?: {
		message?: string;
		
		rate_limit_metadata?: Array<{ name?: string; limit?: number; remaining?: number }>;
	};
}


function googleMetadataToLimits(meta: NonNullable<Pick<NonNullable<GoogleResponse['error']>, 'rate_limit_metadata'>['rate_limit_metadata']>): RateLimits {
	const limits: RateLimits = {
		remainingRequests: null,
		limitRequests: null,
		resetRequests: null,
		remainingTokens: null,
		limitTokens: null,
		resetTokens: null,
	};
	for (const m of meta ?? []) {
		if (!m || typeof m.name !== 'string') continue;
		if (m.name === 'requests-per-day' || m.name === 'requests-per-minute') {
			limits.remainingRequests = m.remaining ?? null;
			limits.limitRequests = m.limit ?? null;
		} else if (m.name === 'tokens-per-minute') {
			limits.remainingTokens = m.remaining ?? null;
			limits.limitTokens = m.limit ?? null;
		}
	}
	return limits;
}

async function googleComplete(
	model: string,
	messages: ChatMessage[],
	maxTokens: number,
): Promise<{ text: string; usage: AskResult['usage'] }> {
	const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
	const contents = messages
		.filter((m) => m.role !== 'system')
		.map((m) => ({
			role: m.role === 'assistant' ? 'model' : 'user',
			parts: [{ text: m.content }],
		}));

	const res = await fetch(`${GOOGLE_ENDPOINT}/${model}:generateContent`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'x-goog-api-key': env.googleApiKey,
		},
		body: JSON.stringify({
			system_instruction: system ? { parts: [{ text: system }] } : undefined,
			contents,
			generationConfig: { temperature: 0.7, maxOutputTokens: maxTokens },
		}),
	});

	const data = (await res.json()) as GoogleResponse;

	if (!res.ok || data.error) {
		if (res.status === 429 && data.error?.rate_limit_metadata) {
			recordObserved(model, googleMetadataToLimits(data.error.rate_limit_metadata));
		}
		throw new Error(data.error?.message ?? `HTTP ${res.status}`);
	}

	const parts = data.candidates?.[0]?.content?.parts ?? [];
	const text = parts
		.filter((p) => !p.thought && typeof p.text === 'string')
		.map((p) => p.text as string)
		.join('')
		.trim();

	const um = data.usageMetadata ?? {};
	return {
		text: text || '*(no response)*',
		usage: {
			promptTokens: um.promptTokenCount ?? 0,
			completionTokens: um.candidatesTokenCount ?? 0,
			totalTokens: um.totalTokenCount ?? 0,
		},
	};
}


function buildSystemPrompt(userId: string): string {
	const lang = getLanguage(userId);
	const custom = getPrompt(userId);
	const langRule =
		lang === 'en'
			? 'You MUST respond in English, no matter what language the user writes in. Never follow the language of the question.'
			: 'SIEMPRE debes responder en español, sin importar en qué idioma escriba el usuario. Nunca respondas en el idioma de la pregunta.';
	const base = custom || (lang === 'en' ? DEFAULT_PROMPT_EN : DEFAULT_PROMPT_ES);
	return `${langRule}\n\n${base}`;
}

function buildMessages(userId: string, question: string): ChatMessage[] {
	const messages: ChatMessage[] = [{ role: 'system', content: buildSystemPrompt(userId) }];

	for (const h of getHistory(userId)) {
		messages.push({
			role: h.role,
			content: h.content.length > 400 ? `${h.content.slice(0, 399)}…` : h.content,
		});
	}
	messages.push({ role: 'user', content: question });
	return messages;
}


export async function ask(question: string, overrideModel: string | null, userId: string): Promise<AskResult> {
	const model = overrideModel ?? getModel(userId);
	const m = MODELS[model];

	if (!m) {
		throw new Error(`Modelo no disponible: ${model}`);
	}
	if (m.provider === 'google' && !env.googleApiKey) {
		throw new Error('GOOGLE_API_KEY no configurada. Añádela al .env para usar modelos de Google.');
	}

	const messages = buildMessages(userId, question);

	if (m.provider === 'google') {
		const r = await googleComplete(model, messages, 2048);
		return { text: r.text, model, provider: 'google', usage: r.usage };
	}

	const { data } = await groqComplete(model, messages, 2048);
	return {
		text: data.choices?.[0]?.message?.content?.trim() ?? '*(no response)*',
		model,
		provider: 'groq',
		usage: {
			promptTokens: data.usage?.prompt_tokens ?? 0,
			completionTokens: data.usage?.completion_tokens ?? 0,
			totalTokens: data.usage?.total_tokens ?? 0,
		},
	};
}


export async function fetchGroqUsage(model: string): Promise<RateLimits> {
	if (!MODELS[model] || MODELS[model].provider !== 'groq') {
		throw new Error(`Modelo no disponible: ${model}`);
	}
	const { headers } = await groqComplete(model, [{ role: 'user', content: 'ping' }], 1);
	return readRateLimits(headers);
}


export async function refreshGroqLimits(model: string): Promise<RateLimits | null> {
	if (!MODELS[model] || MODELS[model].provider !== 'groq') return null;
	const cached = observedLimits.get(model);
	if (cached && Date.now() - cached.at < OBSERVED_TTL_MS) return cached.rateLimits;
	try {
		return await fetchGroqUsage(model);
	} catch {
		return cached?.rateLimits ?? null;
	}
}