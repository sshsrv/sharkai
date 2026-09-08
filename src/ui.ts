import { Language } from './config.js';

/**
 * Traducción de la interfaz del bot.
 * EN por defecto. Todo se traduce al cambiar /sh language.
 */
type Tpl = string | ((...args: string[]) => string);

const STRINGS: Record<Language, Record<string, Tpl>> = {
  en: {
    modelUpdated: (m) => `**Default model updated**\n${m}`,
    modelCurrent: (m) => `**Your default model**\n${m}`,
    promptUpdated: (p) => `**Custom prompt saved**\n\`\`\`\n${p}\n\`\`\``,
    promptCleared: '**Prompt reset**\nBack to the default prompt.',
    promptEmpty: 'No custom prompt — using the default one.',
    promptCurrent: (p) => `**Your current prompt**\n\`\`\`\n${p}\n\`\`\``,
    promptHint: 'Use `/sh prompt text:...` to change it, `/sh prompt clear:true` to reset.',
    languageSet: (l) => `**Language set**\n${l}`,
    usageTitle: (m) => `**Groq limits right now**\nModel: ${m}`,
    usageRequests: 'Requests remaining',
    usageTokens: 'Tokens remaining',
    usageReset: 'Reset in',
    resetTitle: '**Settings reset**',
    resetBody: (model, lang) => `Model: ${model}\nPrompt: default\nLanguage: ${lang}`,
    statusTitle: '**Your SharkAI configuration**',
    statusModel: 'Model',
    statusLanguage: 'Language',
    statusPrompt: 'Prompt',
    noPrompt: '(default)',
    unknownSub: 'Unknown subcommand.',
    invalidModel: (m) => `Invalid model: \`${m}\``,
    invalidLanguage: 'Invalid language.',
    cooldown: (s) => `Wait ${s}s between questions.`,
    answerTruncated: '…',
    usageError: (e) => `Could not fetch limits: ${e}`,
    error: (e) => `Error: ${e}`,
  },
  es: {
    modelUpdated: (m) => `**Modelo por defecto actualizado**\n${m}`,
    modelCurrent: (m) => `**Tu modelo por defecto**\n${m}`,
    promptUpdated: (p) => `**Prompt personalizado guardado**\n\`\`\`\n${p}\n\`\`\``,
    promptCleared: '**Prompt restablecido**\nVuelve al prompt por defecto.',
    promptEmpty: 'No tienes prompt personalizado — se usa el por defecto.',
    promptCurrent: (p) => `**Tu prompt actual**\n\`\`\`\n${p}\n\`\`\``,
    promptHint: 'Usa `/sh prompt text:...` para cambiarlo, `/sh prompt clear:true` para resetear.',
    languageSet: (l) => `**Idioma configurado**\n${l}`,
    usageTitle: (m) => `**Límites de Groq ahora mismo**\nModelo: ${m}`,
    usageRequests: 'Peticiones restantes',
    usageTokens: 'Tokens restantes',
    usageReset: 'Reset en',
    resetTitle: '**Ajustes reiniciados**',
    resetBody: (model, lang) => `Modelo: ${model}\nPrompt: por defecto\nIdioma: ${lang}`,
    statusTitle: '**Tu configuración de SharkAI**',
    statusModel: 'Modelo',
    statusLanguage: 'Idioma',
    statusPrompt: 'Prompt',
    noPrompt: '(por defecto)',
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