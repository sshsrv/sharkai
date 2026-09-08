import 'dotenv/config';

/**
 * Modelos de Groq disponibles en el plan gratuito.
 * Datos de límites: konsultados de la documentación pública de Groq.
 */
export interface GroqModel {
  /** id usado en la API (ruta /openai/v1/chat/completions) */
  id: string;
  /** Nombre corto para mostrar */
  name: string;
  /** Descripción / uso recomendado */
  description: string;
  /** Tokens por minuto (TPM) en plan gratuito */
  tpm: number;
  /** Peticiones por minuto (RPM) en plan gratuito */
  rpm: number;
  /** Peticiones por día (RPD) en plan gratuito */
  rpd: number;
  /** Tamaño del contexto soportado */
  context: number;
  /** ¿Soporta contexto multimodal (imagen)? */
  multimodal: boolean;
  /** ¿Es un modelo de chat? (los de speech/no van por chat completions) */
  chat: boolean;
}

export const MODELS: Record<string, GroqModel> = {
  'llama-3.3-70b-versatile': {
    id: 'llama-3.3-70b-versatile',
    name: 'Llama 3.3 70B Versatile',
    description: 'Modelo general de alto rendimiento, bueno para razonamiento y conversación.',
    tpm: 6000,
    rpm: 30,
    rpd: 1000,
    context: 131072,
    multimodal: false,
    chat: true,
  },
  'llama-3.1-8b-instant': {
    id: 'llama-3.1-8b-instant',
    name: 'Llama 3.1 8B Instant',
    description: 'Rápido y ligero, ideal para respuestas de baja latencia y alta frecuencia.',
    tpm: 6000,
    rpm: 30,
    rpd: 1000,
    context: 131072,
    multimodal: false,
    chat: true,
  },
  'qwen-2.5-coder-32b': {
    id: 'qwen-2.5-coder-32b',
    name: 'Qwen 2.5 Coder 32B',
    description: 'Especializado en generación de código y tareas de ingeniería de software.',
    tpm: 6000,
    rpm: 30,
    rpd: 1000,
    context: 131072,
    multimodal: false,
    chat: true,
  },
  'gemma2-9b-it': {
    id: 'gemma2-9b-it',
    name: 'Gemma 2 9B IT',
    description: 'Modelo ligero de Google, eficiente para tareas de texto.',
    tpm: 6000,
    rpm: 30,
    rpd: 1000,
    context: 8192,
    multimodal: false,
    chat: true,
  },
  'llama-4-maverick-17b-128e-instruct': {
    id: 'llama-4-maverick-17b-128e-instruct',
    name: 'Llama 4 Maverick 17B',
    description: 'Modelo multimodal de Meta, soporta imágenes y razonamiento.',
    tpm: 6000,
    rpm: 30,
    rpd: 1000,
    context: 131072,
    multimodal: true,
    chat: true,
  },
};

/** Lista de ids de modelos de chat, ordenados para el menú */
export const CHAT_MODEL_IDS = Object.keys(MODELS).filter((id) => MODELS[id].chat);

/** Modelo por defecto */
export const DEFAULT_MODEL = 'llama-3.3-70b-versatile';

/** Prompt por defecto usada como system message */
export const DEFAULT_PROMPT =
  'Eres SharkAI, un asistente de inteligencia. Responde de forma concisa, precisa y útil.';

export const env = {
  discordToken: process.env.DISCORD_TOKEN ?? '',
  groqApiKey: process.env.GROQ_API_KEY ?? '',
};

export function formatLimits(m: GroqModel): string {
  return `**${m.name}**\n${m.description}\n` +
    `• Contexto: \`${m.context.toLocaleString()}\` tokens\n` +
    `• Límites (plan gratuito): \`${m.tpm.toLocaleString()}\` TPM · \`${m.rpm}\` RPM · \`${m.rpd.toLocaleString()}\` RPD\n` +
    (m.multimodal ? '• 🌄 Multimodal (imágenes)\n' : '');
}
