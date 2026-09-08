import 'dotenv/config';

/**
 * Modelos de chat de Groq disponibles en el plan gratuito.
 * Fuente: lista oficial de modelos free-tier (sep 2026).
 * Los modelos de speech/audio (whisper, orpheus) y prompt-guard no son de chat por texto
 * y no se incluyen en el menú, pero se documentan en el README.
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
    description: 'Modelo open-source de OpenAI (120B). General, alto rendimiento.',
    tpm: 8000,
    rpm: 30,
    rpd: 1000,
    context: 131072,
    multimodal: false,
    chat: true,
  },
  'openai/gpt-oss-20b': {
    id: 'openai/gpt-oss-20b',
    name: 'GPT-OSS 20B',
    description: 'GPT-OSS 20B. Más rápido y ligero que el 120B.',
    tpm: 8000,
    rpm: 30,
    rpd: 1000,
    context: 131072,
    multimodal: false,
    chat: true,
  },
  'openai/gpt-oss-safeguard-20b': {
    id: 'openai/gpt-oss-safeguard-20b',
    name: 'GPT-OSS Safeguard 20B',
    description: 'GPT-OSS 20B con guardrails de seguridad (moderación).',
    tpm: 8000,
    rpm: 30,
    rpd: 1000,
    context: 131072,
    multimodal: false,
    chat: true,
  },
  'qwen/qwen3.6-27b': {
    id: 'qwen/qwen3.6-27b',
    name: 'Qwen 3.6 27B',
    description: 'Última generación de Qwen (27B). Buen equilibrio velocidad/calidad.',
    tpm: 8000,
    rpm: 30,
    rpd: 1000,
    context: 131072,
    multimodal: false,
    chat: true,
  },
  'qwen/qwen3.8-27b': {
    id: 'qwen/qwen3.8-27b',
    name: 'Qwen 3.8 27B',
    description: 'Qwen 3.8 27B. Iteración reciente de la serie Qwen.',
    tpm: 8000,
    rpm: 30,
    rpd: 1000,
    context: 131072,
    multimodal: false,
    chat: true,
  },
  'groq/compound': {
    id: 'groq/compound',
    name: 'Groq Compound',
    description: 'Modelo compuesto de Groq, razonamiento avanzado multi-paso.',
    tpm: 70000,
    rpm: 30,
    rpd: 250,
    context: 131072,
    multimodal: false,
    chat: true,
  },
  'groq/compound-mini': {
    id: 'groq/compound-mini',
    name: 'Groq Compound Mini',
    description: 'Variante ligera del Compound, más rápida.',
    tpm: 70000,
    rpm: 30,
    rpd: 250,
    context: 131072,
    multimodal: false,
    chat: true,
  },
};

/** Son chat models de texto (excluye whisper/orpheus/prompt-guard) */
export const CHAT_MODEL_IDS = Object.keys(MODELS).filter((id) => MODELS[id].chat);

/** Modelo por defecto */
export const DEFAULT_MODEL = 'openai/gpt-oss-120b';

/** Idiomas soportados por /ai language */
export type Language = 'es' | 'en';

export const LANGUAGE_CHOICES: Array<{ name: string; value: Language }> = [
  { name: 'Español', value: 'es' },
  { name: 'English', value: 'en' },
];

/** Prompt base por defecto */
export const DEFAULT_PROMPT_ES =
  'Eres SharkAI, un asistente de inteligencia. Responde de forma concisa, precisa y útil. Sin relleno ni disculpas.';

export const DEFAULT_PROMPT_EN =
  'You are SharkAI, an intelligence assistant. Answer concisely, precisely and helpfully. No filler, no apologies.';

export const env = {
  discordToken: process.env.DISCORD_TOKEN ?? '',
  groqApiKey: process.env.GROQ_API_KEY ?? '',
};

export function formatLimits(m: GroqModel): string {
  return `**${m.name}**\n${m.description}\n` +
    `• Contexto: \`${m.context.toLocaleString()}\` tokens\n` +
    `• Límites (plan gratuito): \`${m.tpm.toLocaleString()}\` TPM · \`${m.rpm}\` RPM · \`${m.rpd.toLocaleString()}\` RPD\n`;
}

export function languageLabel(lang: Language): string {
  return lang === 'es' ? 'Español' : 'English';
}