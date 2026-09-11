import 'dotenv/config';
import { loadConfig, type AppConfig, type AIModel, type Provider, type Language, type ModelEmojiMap } from './config-loader.js';

export type { Provider, AIModel, Language };

const raw: AppConfig | null = loadConfig();

const fallbackModels: Record<string, AIModel> = {};
const fallbackProviders: Record<Provider, string> = {
  groq: 'Groq',
  google: 'Google',
  openrouter: 'OpenRouter',
  mistral: 'Mistral',
  opencode: 'OpenCode',
};

export const PROVIDER_LABEL: Record<Provider, string> = raw
  ? (Object.fromEntries(
      Object.entries(raw.providers).map(([k, v]) => [k, v.label])
    ) as Record<Provider, string>)
  : fallbackProviders;

export const MODELS: Record<string, AIModel> = raw
  ? Object.fromEntries(
      Object.entries(raw.models).map(([id, m]) => [
        id,
        {
          id,
          name: m.name,
          provider: m.provider as Provider,
          description: m.description,
          tpm: m.tpm,
          rpm: m.rpm,
          rpd: m.rpd,
          context: m.context,
          multimodal: m.multimodal,
        } satisfies AIModel,
      ])
    )
  : fallbackModels;

export const CHAT_MODEL_IDS = Object.keys(MODELS);

export const MODEL_EMOJI: ModelEmojiMap = (raw?.model_emojis as ModelEmojiMap) ?? {} as ModelEmojiMap;

export const DEFAULT_MODEL: string = raw?.bot?.default_model ?? 'openai/gpt-oss-120b';

export const HISTORY_LIMIT: number = raw?.bot?.history_limit ?? 6;

export const LANGUAGE_CHOICES: Array<{ name: string; value: Language }> = [
  { name: 'Español', value: 'es' },
  { name: 'English', value: 'en' },
];

export const DEFAULT_LANG: Language = (raw?.bot?.default_lang as Language) ?? 'en';

export const DEFAULT_PROMPT_EN: string =
  raw?.ai?.default_prompt_en ?? 'You are SharkAI, an intelligence assistant. Answer concisely, precisely and helpfully. No filler, no apologies.';

export const DEFAULT_PROMPT_ES: string =
 raw?.ai?.default_prompt_es ?? 'Eres SharkAI, un asistente de inteligencia. Responde de forma concisa, precisa y útil. Sin relleno ni disculpas.';

export const AI_TEMPERATURE: number = raw?.ai?.temperature ?? 0.7;
export const AI_MAX_TOKENS: number = raw?.ai?.max_tokens ?? 4096;
export const ACCENT_COLOR: number | undefined = raw?.bot?.accent_color_enabled ? (raw?.bot?.accent_color ?? 0x5865F2) : undefined;

export const env = {
  discordToken: process.env.DISCORD_TOKEN ?? '',
  groqApiKey: process.env.GROQ_API_KEY ?? '',
  googleApiKey: process.env.GOOGLE_API_KEY ?? '',
  openrouterApiKey: process.env.OPENROUTER_API_KEY ?? '',
  mistralApiKey: process.env.MISTRAL_API_KEY ?? '',
  opencodeApiKey: process.env.OPENCODE_API_KEY ?? '',
};

export function formatLimits(m: AIModel): string {
  return `${m.description}\nProvider: \`${PROVIDER_LABEL[m.provider]}\`\nContext: \`${m.context.toLocaleString()}\` tokens\nFree-plan limits: \`${m.tpm.toLocaleString()}\` TPM · \`${m.rpm}\` RPM · \`${m.rpd.toLocaleString()}\` RPD`;
}

export function languageLabel(lang: Language): string {
  return lang === 'es' ? 'Español' : 'English';
}
