import 'dotenv/config';

export type Provider = 'groq' | 'google';

export interface AIModel {
	id: string;
	name: string;
	provider: Provider;
	description: string;
	tpm: number;
	rpm: number;
	rpd: number;
	context: number;
	multimodal: boolean;
}

/**
 * Etiqueta visible de cada provider.
 * Solo se muestra en el selector de modelos, la info del modelo y /sh usage.
 */
export const PROVIDER_LABEL: Record<Provider, string> = {
	groq: 'Groq',
	google: 'Google',
};

/**
 * Modelos de chat disponibles (free tier, sep 2026).
 * Fuente: lista oficial de modelos free-tier (Groq) + Gemini API free tier (Google).
 */
export const MODELS: Record<string, AIModel> = {
	// --- Groq ---
	'openai/gpt-oss-120b': {
		id: 'openai/gpt-oss-120b',
		name: 'GPT-OSS 120B',
		provider: 'groq',
		description: 'OpenAI open-source model (120B). General purpose, high performance.',
		tpm: 8000,
		rpm: 1000,
		rpd: 1000,
		context: 131072,
		multimodal: false,
	},
	'openai/gpt-oss-20b': {
		id: 'openai/gpt-oss-20b',
		name: 'GPT-OSS 20B',
		provider: 'groq',
		description: 'GPT-OSS 20B. Faster and lighter than the 120B.',
		tpm: 8000,
		rpm: 1000,
		rpd: 1000,
		context: 131072,
		multimodal: false,
	},
	'openai/gpt-oss-safeguard-20b': {
		id: 'openai/gpt-oss-safeguard-20b',
		name: 'GPT-OSS Safeguard 20B',
		provider: 'groq',
		description: 'GPT-OSS 20B with safety guardrails (moderation).',
		tpm: 8000,
		rpm: 1000,
		rpd: 1000,
		context: 131072,
		multimodal: false,
	},
	'qwen/qwen3.6-27b': {
		id: 'qwen/qwen3.6-27b',
		name: 'Qwen 3.6 27B',
		provider: 'groq',
		description: 'Latest generation Qwen (27B). Great speed/quality balance.',
		tpm: 8000,
		rpm: 1000,
		rpd: 1000,
		context: 131072,
		multimodal: false,
	},
	'qwen/qwen3.8-27b': {
		id: 'qwen/qwen3.8-27b',
		name: 'Qwen 3.8 27B',
		provider: 'groq',
		description: 'Qwen 3.8 27B. Recent iteration of the Qwen series.',
		tpm: 8000,
		rpm: 1000,
		rpd: 1000,
		context: 131072,
		multimodal: false,
	},
	'groq/compound': {
		id: 'groq/compound',
		name: 'Groq Compound',
		provider: 'groq',
		description: 'Groq compound model, advanced multi-step reasoning.',
		tpm: 70000,
		rpm: 250,
		rpd: 250,
		context: 131072,
		multimodal: false,
	},
	'groq/compound-mini': {
		id: 'groq/compound-mini',
		name: 'Groq Compound Mini',
		provider: 'groq',
		description: 'Lighter, faster variant of Groq Compound.',
		tpm: 70000,
		rpm: 250,
		rpd: 250,
		context: 131072,
		multimodal: false,
	},
	// --- Google Gemini (API free tier, cuotas reales de AI Studio sep 2026) ---
	'gemini-2.5-flash': {
		id: 'gemini-2.5-flash',
		name: 'Gemini 2.5 Flash',
		provider: 'google',
		description: 'Google Gemini 2.5 Flash. Fast, efficient, strong reasoning for everyday tasks.',
		tpm: 250000,
		rpm: 5,
		rpd: 20,
		context: 1048576,
		multimodal: true,
	},
	'gemini-2.5-flash-lite': {
		id: 'gemini-2.5-flash-lite',
		name: 'Gemini 2.5 Flash-Lite',
		provider: 'google',
		description: 'Google Gemini 2.5 Flash-Lite. Cheapest and fastest Gemini model.',
		tpm: 250000,
		rpm: 10,
		rpd: 20,
		context: 1048576,
		multimodal: true,
	},
	'gemini-3-flash-preview': {
		id: 'gemini-3-flash-preview',
		name: 'Gemini 3 Flash',
		provider: 'google',
		description: 'Google Gemini 3 Flash. Latest compact model, great speed/quality balance.',
		tpm: 250000,
		rpm: 5,
		rpd: 20,
		context: 1048576,
		multimodal: true,
	},
	'gemini-3.1-flash-lite': {
		id: 'gemini-3.1-flash-lite',
		name: 'Gemini 3.1 Flash-Lite',
		provider: 'google',
		description: 'Google Gemini 3.1 Flash-Lite. Cheap and fast, generous free quota.',
		tpm: 250000,
		rpm: 15,
		rpd: 500,
		context: 1048576,
		multimodal: true,
	},
	'gemini-3.5-flash': {
		id: 'gemini-3.5-flash',
		name: 'Gemini 3.5 Flash',
		provider: 'google',
		description: 'Google Gemini 3.5 Flash. High-quality reasoning with fast responses.',
		tpm: 250000,
		rpm: 5,
		rpd: 20,
		context: 1048576,
		multimodal: true,
	},
	'gemini-3.5-flash-lite': {
		id: 'gemini-3.5-flash-lite',
		name: 'Gemini 3.5 Flash-Lite',
		provider: 'google',
		description: 'Google Gemini 3.5 Flash-Lite. Fastest and cheapest of the 3.5 line.',
		tpm: 250000,
		rpm: 15,
		rpd: 500,
		context: 1048576,
		multimodal: true,
	},
	'gemini-3.6-flash': {
		id: 'gemini-3.6-flash',
		name: 'Gemini 3.6 Flash',
		provider: 'google',
		description: 'Google Gemini 3.6 Flash. Newest compact iteration.',
		tpm: 250000,
		rpm: 5,
		rpd: 20,
		context: 1048576,
		multimodal: true,
	},
	'gemini-3.7-flash': {
		id: 'gemini-3.7-flash',
		name: 'Gemini 3.7 Flash',
		provider: 'google',
		description: 'Google Gemini 3.7 Flash. Newest compact iteration.',
		tpm: 250000,
		rpm: 5,
		rpd: 20,
		context: 1048576,
		multimodal: true,
	},
	'gemini-3.8-flash': {
		id: 'gemini-3.8-flash',
		name: 'Gemini 3.8 Flash',
		provider: 'google',
		description: 'Google Gemini 3.8 Flash. Latest and most capable compact model.',
		tpm: 250000,
		rpm: 5,
		rpd: 20,
		context: 1048576,
		multimodal: true,
	},
};

/** Modelos de chat (texto): todos los del catálogo. */
export const CHAT_MODEL_IDS = Object.keys(MODELS);

/** Modelo por defecto */
export const DEFAULT_MODEL = 'openai/gpt-oss-120b';

/** Idiomas soportados por /sh language */
export type Language = 'es' | 'en';

export const LANGUAGE_CHOICES: Array<{ name: string; value: Language }> = [
	{ name: 'Español', value: 'es' },
	{ name: 'English', value: 'en' },
];

/** Idioma por defecto del bot (todo el UI arranca en inglés). */
export const DEFAULT_LANG: Language = 'en';

/** Prompts base que ve la IA en el idioma configurado. */
export const DEFAULT_PROMPT_EN =
	'You are SharkAI, an intelligence assistant. Answer concisely, precisely and helpfully. No filler, no apologies.';

export const DEFAULT_PROMPT_ES =
	'Eres SharkAI, un asistente de inteligencia. Responde de forma concisa, precisa y útil. Sin relleno ni disculpas.';

export const env = {
	discordToken: process.env.DISCORD_TOKEN ?? '',
	groqApiKey: process.env.GROQ_API_KEY ?? '',
	googleApiKey: process.env.GOOGLE_API_KEY ?? '',
};

export function formatLimits(m: AIModel): string {
	return `${m.description}\nProvider: \`${PROVIDER_LABEL[m.provider]}\`\nContext: \`${m.context.toLocaleString()}\` tokens\nFree-plan limits: \`${m.tpm.toLocaleString()}\` TPM · \`${m.rpm}\` RPM · \`${m.rpd.toLocaleString()}\` RPD`;
}

export function languageLabel(lang: Language): string {
	return lang === 'es' ? 'Español' : 'English';
}