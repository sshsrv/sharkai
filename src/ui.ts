import { Language } from './config.js';

/**
 * Traducción de la interfaz del bot.
 * EN por defecto. Todo se traduce al cambiar /sh language.
 * Los TÍTULOS se renderizan como headings (#) en Components V2 — nunca ** **.
 */
type Tpl = string | ((...args: string[]) => string);

const STRINGS: Record<Language, Record<string, Tpl>> = {
  en: {
    // Títulos (heading #)
    h1ModelUpdated: 'Default model updated',
    h1ModelCurrent: 'Your default model',
    h1PromptUpdated: 'Custom prompt saved',
    h1PromptCleared: 'Prompt reset',
    h1PromptEmpty: 'No custom prompt',
    h1PromptCurrent: 'Your current prompt',
    h1LanguageSet: 'Language set',
    h1Usage: 'Groq limits right now',
    h1Reset: 'Settings reset',
    h1Status: 'Your SharkAI configuration',
    // Labels
    usageRequests: 'Requests remaining',
    usageTokens: 'Tokens remaining',
    usageReset: 'Reset in',
    statusModel: 'Model',
    statusLanguage: 'Language',
    statusPrompt: 'Prompt',
    noPrompt: '(default)',
    resetBody: (model) => `Model: ${model}\nPrompt: default\nLanguage: English`,
    promptHint: 'Use `/sh prompt text:...` to change it, `/sh prompt clear:true` to reset.',
    unknownSub: 'Unknown subcommand.',
    invalidModel: (m) => `Invalid model: \`${m}\``,
    invalidLanguage: 'Invalid language.',
    cooldown: (s) => `Wait ${s}s between questions.`,
    answerTruncated: '…',
    usageError: (e) => `Could not fetch limits: ${e}`,
    error: (e) => `Error: ${e}`,
  },
  es: {
    h1ModelUpdated: 'Modelo por defecto actualizado',
    h1ModelCurrent: 'Tu modelo por defecto',
    h1PromptUpdated: 'Prompt personalizado guardado',
    h1PromptCleared: 'Prompt restablecido',
    h1PromptEmpty: 'Sin prompt personalizado',
    h1PromptCurrent: 'Tu prompt actual',
    h1LanguageSet: 'Idioma configurado',
    h1Usage: 'Límites de Groq ahora mismo',
    h1Reset: 'Ajustes reiniciados',
    h1Status: 'Tu configuración de SharkAI',
    usageRequests: 'Peticiones restantes',
    usageTokens: 'Tokens restantes',
    usageReset: 'Reset en',
    statusModel: 'Modelo',
    statusLanguage: 'Idioma',
    statusPrompt: 'Prompt',
    noPrompt: '(por defecto)',
    resetBody: (model) => `Modelo: ${model}\nPrompt: por defecto\nIdioma: Español`,
    promptHint: 'Usa `/sh prompt text:...` para cambiarlo, `/sh prompt clear:true` para resetear.',
    unknownSub: 'Subcomando desconocido.',
    invalidModel: (m) => `Modelo no válido: \`${m}\``,
    invalidLanguage: 'Idioma no válido.',
    cooldown: (s) => `Espera ${s}s entre preguntas.`,
    answerTruncated: '…',
    usageError: (e) => `No pude consultar los límites: ${e}`,
    error: (e) => `Error: ${e}`,
  },
};

/** Traduce un string con args. */
export function t(lang: Language, key: string, ...args: string[]): string {
  const tpl = STRINGS[lang][key] ?? STRINGS.en[key] ?? key;
  return typeof tpl === 'function' ? tpl(...args) : tpl;
}