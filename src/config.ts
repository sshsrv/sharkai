import 'dotenv/config';

/**
 * Modelos de chat de Groq disponibles en el plan gratuito.
 * Fuente: lista oficial de modelos free-tier (sep 2026).
 */
export interface GroqModel {
  id: string;
  name: string;
  description: string;
  tpm: number;
  rpm: number;
  rpd: number;
  context: number;
  multimodal: boolean;
  chat: boolean;
}

export const MODELS: Record<string, GroqModel> = {
  'openai/gpt-oss-120b': {
    id: 'openai/gpt-oss-120b',
    name: 'GPT-OSS 120B',
    description: 'OpenAI open-source model (120B). General purpose, high performance.',
    tpm: 8000,
    rpm: 1000,
    rpd: 1000,
    context: 131072,
    multimodal: false,
    chat: true,
  },
  'openai/gpt-oss-20b': {
    id: 'openai/gpt-oss-20b',
    name: 'GPT-OSS 20B',
    description: 'GPT-OSS 20B. Faster and lighter than the 120B.',
    tpm: 8000,
    rpm: 1000,
    rpd: 1000,
    context: 131072,
    multimodal: false,
    chat: true,
  },
  'openai/gpt-oss-safeguard-20b': {
    id: 'openai/gpt-oss-safeguard-20b',
    name: 'GPT-OSS Safeguard 20B',
    description: 'GPT-OSS 20B with safety guardrails (moderation).',
    tpm: 8000,
    rpm: 1000,
    rpd: 1000,
    context: 131072,
    multimodal: false,
    chat: true,
  },
  'qwen/qwen3.6-27b': {
    id: 'qwen/qwen3.6-27b',
    name: 'Qwen 3.6 27B',
    description: 'Latest generation Qwen (27B). Great speed/quality balance.',
    tpm: 8000,
    rpm: 1000,
    rpd: 1000,
    context: 131072,
    multimodal: false,
    chat: true,
  },
  'qwen/qwen3.8-27b': {
    id: 'qwen/qwen3.8-27b',
    name: 'Qwen 3.8 27B',
    description: 'Qwen 3.8 27B. Recent iteration of the Qwen series.',
    tpm: 8000,
    rpm: 1000,
    rpd: 1000,
    context: 131072,
    multimodal: false,
    chat: true,
  },
  'groq/compound': {
    id: 'groq/compound',
    name: 'Groq Compound',
    description: 'Groq compound model, advanced multi-step reasoning.',
    tpm: 70000,
    rpm: 250,
    rpd: 250,
    context: 131072,
    multimodal: false,
    chat: true,
  },
  'groq/compound-mini': {
    id: 'groq/compound-mini',
    name: 'Groq Compound Mini',
    description: 'Lighter, faster variant of Groq Compound.',
    tpm: 70000,
    rpm: 250,
    rpd: 250,
    context: 131072,
    multimodal: false,
    chat: true,
  },
};

/** Chat models (texto) */
export const CHAT_MODEL_IDS = Object.keys(MODELS).filter((id) => MODELS[id].chat);

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
};

export function formatLimits(m: GroqModel): string {
  return `${m.description}\nContext: \`${m.context.toLocaleString()}\` tokens\nFree-plan limits: \`${m.tpm.toLocaleString()}\` TPM · \`${m.rpm}\` RPM · \`${m.rpd.toLocaleString()}\` RPD`;
}

export function languageLabel(lang: Language): string {
  return lang === 'es' ? 'Español' : 'English';
}