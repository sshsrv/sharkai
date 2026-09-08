import { env, MODELS, DEFAULT_PROMPT_ES, DEFAULT_PROMPT_EN } from './config.js';
import { getModel, getPrompt, getLanguage } from './store.js';

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

/** Rate limits reales que Groq devuelve en los headers de cada respuesta. */
export interface RateLimits {
  remainingRequests: number | null;
  limitRequests: number | null;
  /** Duración hasta reset (string humano: "1m26.4s", "547ms") */
  resetRequests: string | null;
  remainingTokens: number | null;
  limitTokens: number | null;
  resetTokens: string | null;
}

export interface AskResult {
  text: string;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  rateLimits: RateLimits;
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

interface ChatResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  error?: { message?: string };
}

async function chatComplete(model: string, messages: Array<{ role: string; content: string }>, maxTokens: number): Promise<{ data: ChatResponse; headers: Headers }> {
  const res = await fetch(GROQ_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${env.groqApiKey}`,
    },
    body: JSON.stringify({ model, messages, temperature: 0.7, max_tokens: maxTokens }),
  });

  const data = (await res.json()) as ChatResponse;

  if (!res.ok || data.error) {
    throw new Error(data.error?.message ?? `HTTP ${res.status}`);
  }
  return { data, headers: res.headers };
}

/**
 * Construye el system prompt a partir del idioma configurado + prompt custom.
 * IMPORTANTE: la IA SIEMPRE responde en el idioma configurado, nunca en el de la pregunta.
 */
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

/**
 * Envía una pregunta a Groq.
 * @param question texto del usuario
 * @param overrideModel modelo opcional one-time; si no viene usa el modelo por defecto del usuario
 * @param userId para recuperar su modelo/prompt/idioma
 */
export async function ask(question: string, overrideModel: string | null, userId: string): Promise<AskResult> {
  const model = overrideModel ?? getModel(userId);

  if (!MODELS[model]) {
    throw new Error(`Modelo no disponible: ${model}`);
  }

  const messages = [
    { role: 'system', content: buildSystemPrompt(userId) },
    { role: 'user', content: question },
  ];

  const { data, headers } = await chatComplete(model, messages, 2048);

  return {
    text: data.choices?.[0]?.message?.content?.trim() ?? '*(no response)*',
    model,
    usage: {
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
      totalTokens: data.usage?.total_tokens ?? 0,
    },
    rateLimits: readRateLimits(headers),
  };
}

/**
 * Consulta los límites actuales con una llamada mínima (1 token).
 * Groq no tiene endpoint de uso; los headers de rate limit vienen en cada respuesta.
 */
export async function fetchUsage(model: string): Promise<RateLimits> {
  if (!MODELS[model]) throw new Error(`Modelo no disponible: ${model}`);
  const { headers } = await chatComplete(model, [{ role: 'user', content: 'ping' }], 1);
  return readRateLimits(headers);
}