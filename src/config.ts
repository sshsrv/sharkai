import 'dotenv/config';
import { loadConfig, type AppConfig, type AIModel, type Provider, type Language, type ModelEmojiMap, type Privacy } from './config-loader.js';

export type { Provider, AIModel, Language, Privacy };

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
          privacy: m.privacy ?? 'warn',
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

export const PRIVACY_SHIELD: Record<Privacy, string> = raw?.privacy
  ? { safe: raw.privacy.safe.shield, warn: raw.privacy.warn.shield, unsafe: raw.privacy.unsafe.shield }
  : { safe: '<:safe:1548014824355537007>', warn: '<:warn:1548014838213775542>', unsafe: '<:unsafe:1548014850364407919>' };

export const PRIVACY_LABEL: Record<Privacy, string> = raw?.privacy
  ? { safe: raw.privacy.safe.label, warn: raw.privacy.warn.label, unsafe: raw.privacy.unsafe.label }
  : { safe: 'Private', warn: 'Data-retention', unsafe: 'Data used for training' };

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

export const CHARS_BUDGET: number = raw?.bot?.chars_budget ?? 4000;
export const REGEN_COOLDOWN_MS: number = raw?.bot?.regen_cooldown_ms ?? 10000;
export const HISTORY_MESSAGE_LIMIT: number = raw?.bot?.history_message_limit ?? 400;
export const PROMPT_DISPLAY_MAX: number = raw?.bot?.prompt_display_max ?? 200;
export const PENDING_TTL_MS: number = raw?.bot?.pending_ttl_ms ?? 7200000;
export const LAST_ASK_TTL_MS: number = raw?.bot?.last_ask_ttl_ms ?? 3600000;
export const OBSERVED_LIMITS_TTL_MS: number = raw?.bot?.observed_limits_ttl_ms ?? 60000;
export const WHITELIST_USER_IDS: string[] = raw?.bot?.whitelist_user_ids ?? [];

export const PRESENCE_STATUS: string = raw?.presence?.status ?? 'online';
export const PRESENCE_SHOW_AS_MOBILE: boolean = raw?.presence?.show_as_mobile ?? false;
export const PRESENCE_STREAMING_URL: string = raw?.presence?.streaming_url ?? '';
export const PRESENCE_CUSTOM_STATUSES: string[] = raw?.presence?.custom_statuses ?? [];
export const PRESENCE_ROTATION_SECONDS: number = raw?.presence?.rotation_interval_seconds ?? 30;

export const env = {
  discordToken: process.env.DISCORD_TOKEN ?? '',
  groqApiKey: process.env.GROQ_API_KEY ?? '',
  googleApiKey: process.env.GOOGLE_API_KEY ?? '',
  openrouterApiKey: process.env.OPENROUTER_API_KEY ?? '',
  mistralApiKey: process.env.MISTRAL_API_KEY ?? '',
  opencodeApiKey: process.env.OPENCODE_API_KEY ?? '',
};

export function formatLimits(m: AIModel): string {
  return `${m.description}\nProvider: \`${PROVIDER_LABEL[m.provider]}\`\nContext: \`${m.context.toLocaleString()}\` tokens\nFree-plan limits: \`${m.tpm.toLocaleString()}\` TPM ・ \`${m.rpm}\` RPM ・ \`${m.rpd.toLocaleString()}\` RPD`;
}

export function languageLabel(lang: Language): string {
  return lang === 'es' ? 'Español' : 'English';
}
