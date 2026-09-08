import Groq from 'groq-sdk';
import { env, MODELS } from './config.js';
import { getModel, getPrompt } from './store.js';

const client = new Groq({ apiKey: env.groqApiKey });

export interface AskResult {
  text: string;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/**
 * Envía una pregunta a Groq.
 * @param question texto del usuario
 * @param overrideModel modelo opcional one-time; si no viene usa el modelo por defecto del usuario
 * @param userId para recuperar su modelo por defecto y su prompt
 */
export async function ask(question: string, overrideModel: string | null, userId: string): Promise<AskResult> {
  const model = overrideModel ?? getModel(userId);
  const systemPrompt = getPrompt(userId);

  if (!MODELS[model]) {
    throw new Error(`Modelo no disponible: ${model}`);
  }

  const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: question });

  const completion = await client.chat.completions.create({
    model,
    messages,
    temperature: 0.7,
    max_tokens: 2048,
  });

  return {
    text: completion.choices[0]?.message?.content?.trim() ?? '*(sin respuesta)*',
    model,
    usage: {
      promptTokens: completion.usage?.prompt_tokens ?? 0,
      completionTokens: completion.usage?.completion_tokens ?? 0,
      totalTokens: completion.usage?.total_tokens ?? 0,
    },
  };
}
