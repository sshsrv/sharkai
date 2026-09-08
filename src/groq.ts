import { env, MODELS, DEFAULT_PROMPT_ES, DEFAULT_PROMPT_EN } from './config.js';
import { getModel, getPrompt, getLanguage } from './store.js';

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

/** Rate limits reales que Groq devuelve en los headers de cada respuesta. */
export interface RateLimits {
  remainingRequests: number | null;
  limitRequests: number | null;
  resetRequests: number | null;
  remainingTokens: number | null;
  limitTokens: number | null;
  resetTokens: number | null;
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
  return {
    remainingRequests: num('x-ratelimit-remaining-requests'),
    limitRequests: num('x-ratelimit-limit-requests'),
    resetRequests: num('x-ratelimit-reset-requests'),
    remainingTokens: num('x-ratelimit-remaining-tokens'),
    limitTokens: num('x-ratelimit-limit-tokens'),
    resetTokens: num('x-ratelimit-reset-tokens'),
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

/** Construye el system prompt a partir de idioma + prompt custom del usuario. */
function buildSystemPrompt(userId: string): string {
  const lang = getLanguage(userId);
  const custom = getPrompt(userId);
  const langLine = lang === 'en' ? 'Respond in English.' : 'Responde en español.';
  const base = custom || (lang === 'en' ? DEFAULT_PROMPT_EN : DEFAULT_PROMPT_ES);
  return `${langLine}\n\n${base}`;
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
    text: data.choices?.[0]?.message?.content?.trim() ?? '*(sin respuesta)*',
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