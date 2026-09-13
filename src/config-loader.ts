import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';
import { z } from 'zod';

export type Provider = 'groq' | 'google' | 'openrouter' | 'mistral' | 'opencode';

export type Privacy = 'safe' | 'warn' | 'unsafe';

export interface AIModel {
  id: string;
  name: string;
  provider: Provider;
  description: string;
  privacy: Privacy;
  tpm: number;
  rpm: number;
  rpd: number;
  context: number;
  multimodal: boolean;
}

export type Language = 'en' | 'es';

export interface BotConfig {
  default_model: string;
  default_lang: string;
  cooldown_seconds: number;
  shared_daily_limit: number;
  history_limit: number;
  data_dir: string;
  accent_color: number;
  accent_color_enabled: boolean;
  chars_budget: number;
  regen_cooldown_ms: number;
  history_message_limit: number;
  prompt_display_max: number;
  pending_ttl_ms: number;
  last_ask_ttl_ms: number;
  observed_limits_ttl_ms: number;
  whitelist_user_ids: string[];
}

export interface AIConfig {
  default_prompt_en: string;
  default_prompt_es: string;
  temperature: number;
  max_tokens: number;
}

export interface ProviderConfig {
  label: string;
  endpoint: string;
  api_key_env: string;
}

export interface ModelConfig {
  name: string;
  provider: Provider;
  description: string;
  privacy: Privacy;
  tpm: number;
  rpm: number;
  rpd: number;
  context: number;
  multimodal: boolean;
}

export type ModelEmojiMap = Record<string, string>;

export interface PrivacyConfig {
  shield: string;
  label: string;
}

export interface PresenceConfig {
  status: string;
  show_as_mobile: boolean;
  streaming_url: string;
  custom_statuses: string[];
  rotation_interval_seconds: number;
}

export interface AppConfig {
  bot: BotConfig;
  ai: AIConfig;
  providers: Record<Provider, ProviderConfig>;
  models: Record<string, ModelConfig>;
  model_emojis: ModelEmojiMap;
  privacy: Record<Privacy, PrivacyConfig>;
  presence: PresenceConfig;
}

export interface CommandOption {
  description: string;
  type: number;
  required: boolean;
  choices?: Record<string, string>;
}

export interface SubCommand {
  description: string;
  options: Record<string, CommandOption>;
}

export interface CommandConfig {
  name: string;
  description: string;
  integration_types: number[];
  contexts: number[];
  subcommands: Record<string, SubCommand>;
}

export interface StringTemplates {
  [key: string]: string;
}

export interface AppStrings {
  commands: {
    sh: CommandConfig;
  };
  responses: {
    en: StringTemplates;
    es: StringTemplates;
  };
}

const ProviderSchema = z.enum(['groq', 'google', 'openrouter', 'mistral', 'opencode']);
const PrivacySchema = z.enum(['safe', 'warn', 'unsafe']);

const BotConfigSchema = z.object({
  default_model: z.string(),
  default_lang: z.string(),
  cooldown_seconds: z.number(),
  shared_daily_limit: z.number(),
  history_limit: z.number(),
  data_dir: z.string(),
  accent_color: z.number().optional().default(0),
  accent_color_enabled: z.boolean().optional().default(false),
  chars_budget: z.number().optional().default(4000),
  regen_cooldown_ms: z.number().optional().default(10000),
  history_message_limit: z.number().optional().default(400),
  prompt_display_max: z.number().optional().default(200),
  pending_ttl_ms: z.number().optional().default(7200000),
  last_ask_ttl_ms: z.number().optional().default(3600000),
  observed_limits_ttl_ms: z.number().optional().default(60000),
  whitelist_user_ids: z.array(z.string()).optional().default([]),
});

const AIConfigSchema = z.object({
  default_prompt_en: z.string(),
  default_prompt_es: z.string(),
  temperature: z.number(),
  max_tokens: z.number(),
});

const ProviderConfigSchema = z.object({
  label: z.string(),
  endpoint: z.string(),
  api_key_env: z.string(),
});

const ModelConfigSchema = z.object({
  name: z.string(),
  provider: ProviderSchema,
  description: z.string(),
  privacy: PrivacySchema.optional().default('warn'),
  tpm: z.number(),
  rpm: z.number(),
  rpd: z.number(),
  context: z.number(),
  multimodal: z.boolean(),
});

const PrivacyConfigSchema = z.object({
  shield: z.string(),
  label: z.string(),
});

const PresenceConfigSchema = z.object({
  status: z.enum(['online', 'idle', 'dnd', 'invisible', 'streaming']).optional().default('online'),
  show_as_mobile: z.boolean().optional().default(false),
  streaming_url: z.string().optional().default(''),
  custom_statuses: z.array(z.string()).optional().default([]),
  rotation_interval_seconds: z.number().min(5).optional().default(30),
});

const AppConfigSchema = z.object({
  bot: BotConfigSchema,
  ai: AIConfigSchema,
  providers: z.record(ProviderSchema, ProviderConfigSchema),
  models: z.record(z.string(), ModelConfigSchema),
  model_emojis: z.record(z.string(), z.string()).optional().default({}),
  privacy: z.record(PrivacySchema, PrivacyConfigSchema).optional(),
  presence: PresenceConfigSchema.optional(),
});

const CommandOptionSchema = z.object({
  description: z.string(),
  type: z.number(),
  required: z.boolean(),
  choices: z.record(z.string(), z.string()).nullish(),
});

const SubCommandSchema = z.object({
  description: z.string(),
  options: z.record(z.string(), CommandOptionSchema),
});

const CommandConfigSchema = z.object({
  name: z.string(),
  description: z.string(),
  integration_types: z.array(z.number()),
  contexts: z.array(z.number()),
  subcommands: z.record(z.string(), SubCommandSchema),
});

const AppStringsSchema = z.object({
  commands: z.object({
    sh: CommandConfigSchema,
  }),
  responses: z.object({
    en: z.record(z.string(), z.string()),
    es: z.record(z.string(), z.string()),
  }),
});

function loadYamlFile(filePath: string): Record<string, unknown> | null {
  try {
    const fullPath = path.resolve(process.cwd(), filePath);
    if (!fs.existsSync(fullPath)) {
      console.warn(`Config file not found: ${fullPath}`);
      return null;
    }
    const content = fs.readFileSync(fullPath, 'utf-8');
    return yaml.parse(content) || null;
  } catch (error) {
    console.error(`Failed to load ${filePath}:`, error);
    return null;
  }
}

export function loadConfig(): AppConfig | null {
  const raw = loadYamlFile('config.yaml');
  if (!raw) return null;
  const result = AppConfigSchema.safeParse(raw);
  if (!result.success) {
    console.warn('config.yaml validation failed:', result.error.format());
    return null;
  }
  return result.data as AppConfig;
}

export function loadStrings(): AppStrings | null {
  const raw = loadYamlFile('strings.yaml');
  if (!raw) return null;
  const result = AppStringsSchema.safeParse(raw);
  if (!result.success) {
    console.warn('strings.yaml validation failed:', result.error.format());
    return null;
  }
  return result.data as AppStrings;
}


