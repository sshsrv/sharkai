import fs from 'node:fs';
import path from 'node:path';
import { env, MODELS, DEFAULT_MODEL, DEFAULT_PROMPT_EN, DEFAULT_PROMPT_ES, AI_TEMPERATURE, AI_MAX_TOKENS, type Provider } from './config.js';
import { getModel, getPrompt, getLanguage, getHistory } from './store.js';

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const GOOGLE_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const MISTRAL_ENDPOINT = 'https://api.mistral.ai/v1/chat/completions';
const OPENCODE_ENDPOINT = 'https://opencode.ai/zen/v1/chat/completions';


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

interface OpenAIResponse {
	choices?: Array<{ message?: { content?: string | null } }>;
	usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
	error?: { message?: string };
}

async function openAIComplete(
	endpoint: string,
	apiKey: string,
	model: string,
	messages: ChatMessage[],
	maxTokens: number,
): Promise<{ data: OpenAIResponse; headers: Headers }> {
	const res = await fetch(endpoint, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify({ model, messages, temperature: AI_TEMPERATURE, max_tokens: maxTokens }),
	});

	const data = (await res.json()) as OpenAIResponse;

	if (!res.ok || data.error) {
		throw new Error(data.error?.message ?? `HTTP ${res.status}`);
	}

	return { data, headers: res.headers };
}

async function groqComplete(
	model: string,
	messages: ChatMessage[],
	maxTokens: number,
): Promise<{ data: OpenAIResponse; headers: Headers }> {
	const r = await openAIComplete(GROQ_ENDPOINT, env.groqApiKey, model, messages, maxTokens);
	recordObserved(model, readRateLimits(r.headers));
	return r;
}

async function openrouterComplete(
	model: string,
	messages: ChatMessage[],
	maxTokens: number,
): Promise<{ data: OpenAIResponse; headers: Headers }> {
	return openAIComplete(OPENROUTER_ENDPOINT, env.openrouterApiKey, model, messages, maxTokens);
}

async function mistralComplete(
	model: string,
	messages: ChatMessage[],
	maxTokens: number,
): Promise<{ data: OpenAIResponse; headers: Headers }> {
	return openAIComplete(MISTRAL_ENDPOINT, env.mistralApiKey, model, messages, maxTokens);
}

async function opencodeComplete(
	model: string,
	messages: ChatMessage[],
	maxTokens: number,
): Promise<{ data: OpenAIResponse; headers: Headers }> {
	const sessionId = `ses_${crypto.randomUUID().slice(0, 12)}`;
	const requestId = `msg_${crypto.randomUUID().slice(0, 12)}`;

	const res = await fetch(OPENCODE_ENDPOINT, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'authorization': `Bearer ${env.opencodeApiKey || 'public'}`,
			'user-agent': 'opencode/1.18.18 ai-sdk/provider-utils/4.0.38 runtime/node/20.11.0',
			'x-opencode-client': 'cli',
			'x-opencode-project': 'global',
			'x-opencode-session': sessionId,
			'x-opencode-request': requestId,
		},
		body: JSON.stringify({ model, messages, temperature: AI_TEMPERATURE, max_tokens: maxTokens }),
	});

	const data = (await res.json()) as OpenAIResponse;

	if (!res.ok || data.error) {
		throw new Error(data.error?.message ?? `HTTP ${res.status}`);
	}

	return { data, headers: res.headers };
}

function extractOpenAIResult(data: OpenAIResponse, provider: Provider): { text: string; usage: AskResult['usage'] } {
	return {
		text: data.choices?.[0]?.message?.content?.trim() ?? '*(no response)*',
		usage: {
			promptTokens: data.usage?.prompt_tokens ?? 0,
			completionTokens: data.usage?.completion_tokens ?? 0,
			totalTokens: data.usage?.total_tokens ?? 0,
		},
	};
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
			generationConfig: { temperature: AI_TEMPERATURE, maxOutputTokens: maxTokens },
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
	const custom = getPrompt(userId);
	const lang = getLanguage(userId);
	return custom || (lang === 'en' ? DEFAULT_PROMPT_EN : DEFAULT_PROMPT_ES);
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


function requireApiKey(provider: Provider, envKey: string): void {
	const keyMap: Record<Provider, string> = {
		groq: env.groqApiKey,
		google: env.googleApiKey,
		openrouter: env.openrouterApiKey,
		mistral: env.mistralApiKey,
		opencode: env.opencodeApiKey,
	};
	if (!keyMap[provider]) {
		throw new Error(`${envKey} no configurada. Añádela al .env para usar modelos de ${provider}.`);
	}
}


export async function ask(question: string, overrideModel: string | null, userId: string): Promise<AskResult> {
	const model = overrideModel ?? getModel(userId);
	const m = MODELS[model];

	if (!m) {
		throw new Error(`Modelo no disponible: ${model}`);
	}

	const messages = buildMessages(userId, question);

	if (m.provider === 'google') {
		requireApiKey('google', 'GOOGLE_API_KEY');
		const r = await googleComplete(model, messages, AI_MAX_TOKENS);
		return { text: r.text, model, provider: 'google', usage: r.usage };
	}

	if (m.provider === 'openrouter') {
		requireApiKey('openrouter', 'OPENROUTER_API_KEY');
		const { data } = await openrouterComplete(model, messages, AI_MAX_TOKENS);
		const r = extractOpenAIResult(data, 'openrouter');
		return { text: r.text, model, provider: 'openrouter', usage: r.usage };
	}

	if (m.provider === 'mistral') {
		requireApiKey('mistral', 'MISTRAL_API_KEY');
		const { data } = await mistralComplete(model, messages, AI_MAX_TOKENS);
		const r = extractOpenAIResult(data, 'mistral');
		return { text: r.text, model, provider: 'mistral', usage: r.usage };
	}

	if (m.provider === 'opencode') {
		requireApiKey('opencode', 'OPENCODE_API_KEY');
		const { data } = await opencodeComplete(model, messages, AI_MAX_TOKENS);
		const r = extractOpenAIResult(data, 'opencode');
		return { text: r.text, model, provider: 'opencode', usage: r.usage };
	}

	const { data } = await groqComplete(model, messages, AI_MAX_TOKENS);
	const r = extractOpenAIResult(data, 'groq');
	return { text: r.text, model, provider: 'groq', usage: r.usage };
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
