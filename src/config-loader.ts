import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';

export type Provider = 'groq' | 'google' | 'openrouter' | 'mistral';

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
  tpm: number;
  rpm: number;
  rpd: number;
  context: number;
  multimodal: boolean;
}

export type ModelEmojiMap = Record<string, string>;

export interface AppConfig {
  bot: BotConfig;
  ai: AIConfig;
  providers: Record<Provider, ProviderConfig>;
  models: Record<string, ModelConfig>;
  model_emojis: ModelEmojiMap;
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
  return raw as unknown as AppConfig;
}

export function loadStrings(): AppStrings | null {
  const raw = loadYamlFile('strings.yaml');
  if (!raw) return null;
  return raw as unknown as AppStrings;
}


