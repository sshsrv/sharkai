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
		h1ModelCurrent: 'Your current model',
		h1PromptUpdated: 'Custom prompt saved',
		h1PromptCleared: 'Prompt reset',
		h1PromptEmpty: 'No custom prompt',
		h1PromptCurrent: 'Your current prompt',
		h1LanguageSet: 'Language set',
		h1Reset: 'Settings reset',
		h1Status: 'Your SharkAI configuration',
		h1New: 'New conversation',
		// Uso (/sh usage) — compartido entre todos los modelos y providers
		usageTitle: 'Usage',
		usageShared: 'Shared across all models (same API quota)',
		usageLive: 'Live limits',
		usageRequestsTag: 'requests',
		usageTokensTag: 'TPM',
		usageReset: 'Reset in',
		usageError: (e: string) => `Could not fetch limits: ${e}`,
		statusContext: 'Context',
		statusContextMsgs: 'messages',
		statusModel: 'Model',
		statusLanguage: 'Language',
		statusPrompt: 'Prompt',
		noPrompt: '(default)',
		resetBody: (model: string) => `Model: ${model}\nPrompt: default\nLanguage: English`,
		promptHint: 'Use `/sh prompt text:...` to change it, `/sh prompt clear:true` to reset.',
		unknownSub: 'Unknown subcommand.',
		invalidModel: (m: string) => `Invalid model: \`${m}\``,
		invalidLanguage: 'Invalid language.',
		cooldown: (s: string) => `Wait ${s}s between questions.`,
		answerTruncated: '…',
		error: (e: string) => `Error: ${e}`,
	},
	es: {
		h1ModelUpdated: 'Modelo por defecto actualizado',
		h1ModelCurrent: 'Tu modelo por defecto',
		h1PromptUpdated: 'Prompt personalizado guardado',
		h1PromptCleared: 'Prompt restablecido',
		h1PromptEmpty: 'Sin prompt personalizado',
		h1PromptCurrent: 'Tu prompt actual',
		h1LanguageSet: 'Idioma configurado',
		h1Reset: 'Ajustes reiniciados',
		h1Status: 'Tu configuración de SharkAI',
		h1New: 'Nueva conversación',
		usageTitle: 'Uso',
		usageShared: 'Compartido entre todos los modelos (misma cuota de API)',
		usageLive: 'Límites en vivo',
		usageRequestsTag: 'peticiones',
		usageTokensTag: 'TPM',
		usageReset: 'Reset en',
		usageError: (e: string) => `No pude consultar los límites: ${e}`,
		statusContext: 'Contexto',
		statusContextMsgs: 'mensajes',
		statusModel: 'Modelo',
		statusLanguage: 'Idioma',
		statusPrompt: 'Prompt',
		noPrompt: '(por defecto)',
		resetBody: (model: string) => `Modelo: ${model}\nPrompt: por defecto\nIdioma: Español`,
		promptHint: 'Usa `/sh prompt text:...` para cambiarlo, `/sh prompt clear:true` para resetear.',
		unknownSub: 'Subcomando desconocido.',
		invalidModel: (m: string) => `Modelo no válido: \`${m}\``,
		invalidLanguage: 'Idioma no válido.',
		cooldown: (s: string) => `Espera ${s}s entre preguntas.`,
		answerTruncated: '…',
		error: (e: string) => `Error: ${e}`,
	},
};

/** Traduce una clave con args. */
export function t(lang: Language, key: string, ...args: string[]): string {
	const tpl = STRINGS[lang][key] ?? STRINGS.en[key] ?? key;
	return typeof tpl === 'function' ? tpl(...args) : tpl;
}