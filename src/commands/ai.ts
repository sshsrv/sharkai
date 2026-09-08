import {
	ChatInputCommandInteraction,
	SlashCommandBuilder,
	ApplicationIntegrationType,
	InteractionContextType,
} from 'discord.js';
import {
	MODELS,
	CHAT_MODEL_IDS,
	type Language,
	LANGUAGE_CHOICES,
	languageLabel,
	formatLimits,
	PROVIDER_LABEL,
	type AIModel,
} from '../config.js';
import {
	getModel,
	setModel,
	getPrompt,
	setPrompt,
	getLanguage,
	setLanguage,
	getHistory,
	appendHistory,
	clearHistory,
	resetUser,
} from '../store.js';
import { ask, fetchGroqUsage, refreshGroqLimits, getObservedLimits } from '../providers.js';
import { recordRequest, getUsage, DAILY_LIMIT } from '../usage.js';
import { t } from '../ui.js';
import {
	V2Component,
	replyComponents,
	deferComponents,
	editComponents,
	text,
	separator,
	heading,
} from '../components.js';

/**
 * Emoji de modelo/provider (custom emojis del usuario).
 * Se muestra en el footer del /sh ask y en el selector de modelos.
 */
const MODEL_EMOJI: Record<string, string> = {
	// OpenAI (gpt-oss)
	'openai/gpt-oss-120b': '<:openai:1547015408110800967>',
	'openai/gpt-oss-20b': '<:openai:1547015408110800967>',
	'openai/gpt-oss-safeguard-20b': '<:openai:1547015408110800967>',
	// Qwen
	'qwen/qwen3.6-27b': '<:qwen:1547015425496195073>',
	'qwen/qwen3.8-27b': '<:qwen:1547015425496195073>',
	// Groq nativos
	'groq/compound': '<:groq:1547015390939320320>',
	'groq/compound-mini': '<:groq:1547015390939320320>',
	// Google
	'gemini-2.5-flash': '<:google:1547015367174397952>',
	'gemini-2.5-flash-lite': '<:google:1547015367174397952>',
	'gemini-3-flash-preview': '<:google:1547015367174397952>',
	'gemini-3.1-flash-lite': '<:google:1547015367174397952>',
	'gemini-3.5-flash': '<:google:1547015367174397952>',
	'gemini-3.5-flash-lite': '<:google:1547015367174397952>',
	'gemini-3.6-flash': '<:google:1547015367174397952>',
	'gemini-3.7-flash': '<:google:1547015367174397952>',
	'gemini-3.8-flash': '<:google:1547015367174397952>',
};

function modelEmoji(id: string): string {
	return MODEL_EMOJI[id] ?? '';
}

/**
 * Selector de modelos: aquí (y solo aquí, más la info del modelo y /sh usage)
 * se muestra el provider de cada modelo. El emoji va delante del nombre.
 */
const MODEL_CHOICES = CHAT_MODEL_IDS.map((id) => ({
	name: `${modelEmoji(id)} ${MODELS[id].name} (${PROVIDER_LABEL[MODELS[id].provider]})`,
	value: id,
}));

// Cooldown por usuario para no castigar el rate limit del free tier.
const COOLDOWN_MS = Math.max(0, parseInt(process.env.COOLDOWN_SECONDS ?? '3', 10) || 0) * 1000;
const lastAsk = new Map<string, number>();

// Presupuesto de texto en components (límite API: 4000 chars combinados).
const CHARS_BUDGET = 4000;

/** Fondo neutro (gris oscuro de Discord) para los contenedores. */
const BOX_BG = 0xff5faf;

/** Caja con "fondo": container(17) con un accent_color neutro. */
function box(inner: V2Component[]): V2Component {
	return { type: 17, components: inner, accent_color: BOX_BG };
}

/** Título como heading (nivel 1) dentro de una caja. */
function boxTitle(title: string): V2Component {
	return heading(title, 1);
}

/** Línea pequeña/tenue para hints. */
function hint(content: string): V2Component {
	return text(`-# ${content}`);
}

/** Formatea TPM en notación compacta: 8100 -> 7.9K */
function fmtK(n: number | null | undefined): string {
	if (n === null || n === undefined) return '?';
	if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`;
	return String(n);
}

/**
 * Footer estilo heist.lol: emoji de modelo + uso diario COMPARTIDO entre todos
 * los modelos/providers (todos tiran de la misma cuota). Sin nombres de provider.
 */
function footer(emoji: string | undefined, model: string, used: number, limit: number): string {
	const e = emoji ? `${emoji} ` : '';
	return `-# ${e}${model}・${used}/${limit} daily・Results are AI generated`;
}

export const shCommand = {
	data: new SlashCommandBuilder()
		.setName('sh')
		.setDescription('SharkAI: all-in-one AI assistant')
		// App instalable por USUARIO (0=server install, 1=user install)
		.setIntegrationTypes([ApplicationIntegrationType.UserInstall])
		.setContexts([InteractionContextType.BotDM, InteractionContextType.PrivateChannel])
		.addSubcommand((s) =>
			s
				.setName('ask')
				.setDescription('Ask something using your default model')
				.addStringOption((o) =>
					o
						.setName('message')
						.setDescription('What you want to ask')
						.setRequired(true),
				)
				.addStringOption((o) =>
					o
						.setName('model')
						.setDescription('One-time model override for this question')
						.addChoices(...MODEL_CHOICES),
				)
				.addBooleanOption((o) =>
					o
						.setName('visible')
						.setDescription('True = visible for everyone (default). False = only you (ephemeral)'),
				),
		)
		.addSubcommand((s) =>
			s
				.setName('model')
				.setDescription('View or change your default model')
				.addStringOption((o) =>
					o
						.setName('model')
						.setDescription('Model (omitting shows the current one)')
						.addChoices(...MODEL_CHOICES),
				)
				.addBooleanOption((o) =>
					o
						.setName('info')
						.setDescription('Show model limits (default: true)'),
				),
		)
		.addSubcommand((s) =>
			s
				.setName('prompt')
				.setDescription('View or change your custom system prompt')
				.addStringOption((o) =>
					o
						.setName('text')
						.setDescription('New custom prompt (used instead of the default)'),
				)
				.addBooleanOption((o) =>
					o
						.setName('clear')
						.setDescription('Go back to the default prompt'),
				),
		)
		.addSubcommand((s) =>
			s
				.setName('language')
				.setDescription('Language of bot UI and AI answers')
				.addStringOption((o) =>
					o
						.setName('language')
						.setDescription('Language')
						.setRequired(true)
						.addChoices(...LANGUAGE_CHOICES),
				),
		)
		.addSubcommand((s) => s.setName('usage').setDescription('Show your shared usage and live limits'))
		.addSubcommand((s) => s.setName('new').setDescription('Start a new conversation (clears context)'))
		.addSubcommand((s) => s.setName('status').setDescription('Show your current configuration'))
		.addSubcommand((s) => s.setName('reset').setDescription('Reset all your settings to defaults')),

	async execute(interaction: ChatInputCommandInteraction): Promise<void> {
		const sub = interaction.options.getSubcommand();
		switch (sub) {
			case 'ask':
				await handleAsk(interaction);
				break;
			case 'model':
				await handleModel(interaction);
				break;
			case 'prompt':
				await handlePrompt(interaction);
				break;
			case 'language':
				await handleLanguage(interaction);
				break;
			case 'usage':
				await handleUsage(interaction);
				break;
			case 'new':
				await handleNew(interaction);
				break;
			case 'status':
				await handleStatus(interaction);
				break;
			case 'reset':
				await handleReset(interaction);
				break;
			default:
				await replyComponents(
					interaction,
					[text(t(getLanguage(interaction.user.id), 'unknownSub'))],
					{ ephemeral: true },
				);
		}
	},
};

async function handleAsk(interaction: ChatInputCommandInteraction): Promise<void> {
	const lang = getLanguage(interaction.user.id);
	const question = interaction.options.getString('message', true);
	const overrideModel = interaction.options.getString('model');
	const visible = interaction.options.getBoolean('visible') ?? true;

	// Cooldown por usuario.
	const now = Date.now();
	const last = lastAsk.get(interaction.user.id);
	if (last && now - last < COOLDOWN_MS) {
		const s = Math.ceil((COOLDOWN_MS - (now - last)) / 1000);
		await replyComponents(interaction, [text(t(lang, 'cooldown', String(s)))], { ephemeral: true });
		return;
	}

	await deferComponents(interaction, { ephemeral: !visible });

	try {
		lastAsk.set(interaction.user.id, Date.now());
		const result = await ask(question, overrideModel, interaction.user.id);
		const model = result.model;
		const emoji = modelEmoji(model);

		// Guardar en la ventana de contexto (se poda a HISTORY_LIMIT automáticamente).
		appendHistory(interaction.user.id, 'user', question);
		appendHistory(interaction.user.id, 'assistant', result.text);

		// Uso compartido entre todos los modelos/providers (misma cuota).
		recordRequest(result.provider);
		const usage = getUsage();

		// Respuesta truncada para no romper el presupuesto de 4000 chars.
		const answerMax = CHARS_BUDGET - 200;
		const answerText =
			result.text.length > answerMax
				? `${result.text.slice(0, answerMax - 1)}${t(lang, 'answerTruncated')}`
				: result.text;

		// Respuesta -> separador -> footer pequeño. Sin título.
		const components: V2Component[] = [
			text(answerText),
			separator(),
			text(footer(emoji, model, usage.requests, DAILY_LIMIT)),
		];

		await editComponents(interaction, components);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		await editComponents(interaction, [text(t(lang, 'error', message))]);
	}
}

/**
 * Info de un modelo: catálogo (config) + límites EN VIVO por modelo sacados de la API.
 * - Groq: ping mínimo (1 token) a ese modelo, los headers x-ratelimit-* traen sus límites reales.
 * - Google: su API no expone límites en resoluciones normales; los capturamos de los 429
 *   (rate_limit_metadata) cuando pasan, o usamos la cuota publicada del free tier.
 */
async function modelInfoText(m: AIModel): Promise<string> {
	let info = formatLimits(m);
	if (m.provider === 'groq') {
		const live = await refreshGroqLimits(m.id);
		if (live?.limitRequests) {
			info +=
				`\nLive now: \`${live.remainingRequests ?? '?'}/${live.limitRequests}\` RPM · ` +
				`\`${fmtK(live.remainingTokens)}/${fmtK(live.limitTokens)}\` TPM` +
				(live.resetRequests ? ` · reset ${live.resetRequests}` : '');
		}
	} else {
		info += '\nLimits from Google free-tier (published quota; captured live from API on 429).';
	}
	return info;
}

async function handleModel(interaction: ChatInputCommandInteraction): Promise<void> {
	const lang = getLanguage(interaction.user.id);
	const override = interaction.options.getString('model');
	const showInfo = interaction.options.getBoolean('info') ?? true;

	if (override) {
		const m = MODELS[override];
		if (!m) {
			await replyComponents(interaction, [text(t(lang, 'invalidModel', override))], {
				ephemeral: true,
			});
			return;
		}
		setModel(interaction.user.id, override);

		const components: V2Component[] = [
			box([
				boxTitle(t(lang, 'h1ModelUpdated', `${m.name} (\`${override}\`)`)),
				...(showInfo ? [separator(), text(await modelInfoText(m))] : []),
			]),
		];
		await replyComponents(interaction, components, { ephemeral: true });
		return;
	}

	// Sin argumento: ver el actual
	const current = getModel(interaction.user.id);
	const m = MODELS[current];
	const components: V2Component[] = [
		box([
			boxTitle(t(lang, 'h1ModelCurrent', `${m.name} (\`${current}\`)`)),
			...(showInfo ? [separator(), text(await modelInfoText(m))] : []),
		]),
	];
	await replyComponents(interaction, components, { ephemeral: true });
}

async function handlePrompt(interaction: ChatInputCommandInteraction): Promise<void> {
	const lang = getLanguage(interaction.user.id);
	const textArg = interaction.options.getString('text');
	const clear = interaction.options.getBoolean('clear') ?? false;

	if (clear) {
		setPrompt(interaction.user.id, '');
		await replyComponents(interaction, [box([boxTitle(t(lang, 'h1PromptCleared'))])], {
			ephemeral: true,
		});
		return;
	}

	if (textArg) {
		setPrompt(interaction.user.id, textArg.trim());
		await replyComponents(
			interaction,
			[box([boxTitle(t(lang, 'h1PromptUpdated')), separator(), hint(t(lang, 'promptHint'))])],
			{ ephemeral: true },
		);
		return;
	}

	// Sin args: mostrar el actual
	const current = getPrompt(interaction.user.id);
	if (current) {
		await replyComponents(
			interaction,
			[
				box([boxTitle(t(lang, 'h1PromptCurrent', current))]),
				separator(),
				hint(t(lang, 'promptHint'))],
			{ ephemeral: true },
		);
	} else {
		await replyComponents(interaction, [box([boxTitle(t(lang, 'h1PromptEmpty'))])], {
			ephemeral: true,
		});
	}
}

async function handleLanguage(interaction: ChatInputCommandInteraction): Promise<void> {
	const lang = interaction.options.getString('language', true) as Language;
	if (!LANGUAGE_CHOICES.some((c) => c.value === lang)) {
		await replyComponents(interaction, [text(t(getLanguage(interaction.user.id), 'invalidLanguage'))], {
			ephemeral: true,
		});
		return;
	}
	setLanguage(interaction.user.id, lang);
	await replyComponents(interaction, [box([boxTitle(t(lang, 'h1LanguageSet', languageLabel(lang)))])], {
		ephemeral: true,
	});
}

async function handleUsage(interaction: ChatInputCommandInteraction): Promise<void> {
	const lang = getLanguage(interaction.user.id);
	const model = getModel(interaction.user.id);
	await deferComponents(interaction, { ephemeral: true });

	try {
		// Uso diario COMPARTIDO entre todos los modelos/providers.
		const usage = getUsage();

		// Límites en vivo: Groq los devuelve en los headers de cada respuesta.
		// Si el modelo del usuario es de Google, consultamos el modelo Groq por defecto.
		const groqModel = MODELS[model]?.provider === 'groq' ? model : 'openai/gpt-oss-120b';
		const rl = await fetchGroqUsage(groqModel);
		const resetRequests = rl.resetRequests ? `\`${rl.resetRequests}\`` : '?';
		const resetTokens = rl.resetTokens ? `\`${rl.resetTokens}\`` : '?';

		const inner: V2Component[] = [
			boxTitle(t(lang, 'usageTitle')),
			separator(),
			text(
				`## ${t(lang, 'usageShared')}\n` +
					`\`${usage.requests}/${DAILY_LIMIT}\` daily · ` +
					`Groq: \`${usage.byProvider.groq}\` · Google: \`${usage.byProvider.google}\``,
			),
			separator(),
			text(
				`## ${t(lang, 'usageLive')} · ${MODELS[groqModel]?.name ?? groqModel} (${PROVIDER_LABEL[MODELS[groqModel]?.provider ?? 'groq']})\n` +
					`\`${rl.remainingRequests ?? '?'}/${rl.limitRequests ?? '?'}\` ${t(lang, 'usageRequestsTag')} · ` +
					`${t(lang, 'usageReset')} ${resetRequests}\n` +
					`\`${fmtK(rl.remainingTokens)}/${fmtK(rl.limitTokens)}\` ${t(lang, 'usageTokensTag')} · ` +
					`${t(lang, 'usageReset')} ${resetTokens}`,
			),
		];

		// Google no expone límites en headers: usamos lo capturado en 429 (rate_limit_metadata).
		if (MODELS[model]?.provider === 'google') {
			const goog = getObservedLimits(model);
			if (goog?.limitRequests || goog?.limitTokens) {
				inner.push(
					separator(),
					text(
						`## ${t(lang, 'usageLive')} · ${MODELS[model]?.name ?? model} (${PROVIDER_LABEL[MODELS[model]?.provider ?? 'google']})\n` +
							(goog.limitRequests !== null
								? `\`${goog.remainingRequests ?? '?'}/${goog.limitRequests}\` ${t(lang, 'usageRequestsTag')}\n`
								: '') +
							`\`${fmtK(goog.remainingTokens)}/${fmtK(goog.limitTokens)}\` ${t(lang, 'usageTokensTag')}`,
					),
				);
			}
		}

		await editComponents(interaction, [box(inner)]);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		await editComponents(interaction, [text(t(lang, 'usageError', message))]);
	}
}

async function handleNew(interaction: ChatInputCommandInteraction): Promise<void> {
	const lang = getLanguage(interaction.user.id);
	clearHistory(interaction.user.id);
	await replyComponents(interaction, [box([boxTitle(t(lang, 'h1New'))])], { ephemeral: true });
}

async function handleStatus(interaction: ChatInputCommandInteraction): Promise<void> {
	const lang = getLanguage(interaction.user.id);
	const model = getModel(interaction.user.id);
	const prompt = getPrompt(interaction.user.id);
	const language = getLanguage(interaction.user.id);

	const components: V2Component[] = [
		box([
			boxTitle(t(lang, 'h1Status')),
			separator(),
			text(
				`## ${t(lang, 'statusModel')} ${MODELS[model]?.name ?? model} (\`${model}\`)\n` +
					`## ${t(lang, 'statusLanguage')} ${languageLabel(language)}\n` +
					`## ${t(lang, 'statusPrompt')} ${prompt ? `${prompt.slice(0, 500)}` : t(lang, 'noPrompt')}\n` +
					`## ${t(lang, 'statusContext')} ${getHistory(interaction.user.id).length} ${t(lang, 'statusContextMsgs')}`,
			),
		]),
	];
	await replyComponents(interaction, components, { ephemeral: true });
}

async function handleReset(interaction: ChatInputCommandInteraction): Promise<void> {
	const lang = getLanguage(interaction.user.id);
	resetUser(interaction.user.id);
	const model = getModel(interaction.user.id);
	await replyComponents(
		interaction,
		[box([boxTitle(t(lang, 'h1Reset')), separator(), text(t(lang, 'resetBody', model))])],
		{ ephemeral: true },
	);
}