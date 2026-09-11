import {
	AutocompleteInteraction,
	ChatInputCommandInteraction,
	SlashCommandBuilder,
	ApplicationIntegrationType,
	InteractionContextType,
} from 'discord.js';
import {
	MODELS,
	DEFAULT_MODEL,
	CHAT_MODEL_IDS,
	MODEL_EMOJI,
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
import { recordRequest, getModelUsage } from '../usage.js';
import { t } from '../strings.js';
import {
	V2Component,
	replyComponents,
	deferComponents,
	editComponents,
	text,
	separator,
	heading,
	box,
} from '../components.js';
import { genId, getPendingData, setPendingData } from '../pending.js';
import { renderComponents, cleanAnswer } from '../render.js';



export function modelEmoji(id: string): string {
	return MODEL_EMOJI[id] ?? '';
}

const MODEL_CHOICES = CHAT_MODEL_IDS
	.sort((a, b) => {
		const pa = MODELS[a].provider;
		const pb = MODELS[b].provider;
		if (pa !== pb) return pa.localeCompare(pb);
		return MODELS[a].name.localeCompare(MODELS[b].name);
	})
	.map((id) => ({
		name: `${PROVIDER_LABEL[MODELS[id].provider]} > ${MODELS[id].name}`,
		value: id,
	}));


const COOLDOWN_MS = Math.max(0, parseInt(process.env.COOLDOWN_SECONDS ?? '3', 10) || 0) * 1000;
const lastAsk = new Map<string, number>();


const CHARS_BUDGET = 4000;


function boxTitle(title: string): V2Component {
	return heading(title, 1);
}


function hint(content: string): V2Component {
	return text(`-# ${content}`);
}


function fmtK(n: number | null | undefined): string {
	if (n === null || n === undefined) return '?';
	if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`;
	return String(n);
}


export function footer(emoji: string | undefined, model: string, used: number, limit: number): string {
	const e = emoji ? `${emoji} ` : '';
	return `-# ${e}${model}・${used}/${limit} daily・Results are AI generated`;
}

export const shCommand = {
	data: new SlashCommandBuilder()
		.setName('sh')
		.setDescription('SharkAI: all-in-one AI assistant')
		
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
					.setAutocomplete(true),
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
					.setAutocomplete(true),
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
		.addSubcommand((s) => s.setName('clear').setDescription('Clear your conversation history (start fresh context)'))
		.addSubcommand((s) => s.setName('status').setDescription('Show your current configuration'))
		.addSubcommand((s) => s.setName('reset').setDescription('Reset all your settings to defaults')),

	async execute(interaction: ChatInputCommandInteraction | AutocompleteInteraction): Promise<void> {
		if (interaction.isAutocomplete()) {
			const query = interaction.options.getFocused().toLowerCase();
			const filtered = MODEL_CHOICES
				.filter(c =>
					c.name.toLowerCase().includes(query) ||
					c.value.toLowerCase().includes(query)
				)
				.slice(0, 25);
			await interaction.respond(
				filtered.map(c => ({ name: c.name, value: c.value }))
			);
			return;
		}
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
			case 'clear':
				await handleClear(interaction);
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

	
	const now = Date.now();
	const last = lastAsk.get(interaction.user.id);
	if (last && now - last < COOLDOWN_MS) {
		const s = Math.ceil((COOLDOWN_MS - (now - last)) / 1000);
		await replyComponents(interaction, [text(t(lang, 'cooldown', String(s)))], { ephemeral: true });
		return;
	}

	const thinkingModelId = overrideModel ?? getModel(interaction.user.id);
	const thinkingModelName = MODELS[thinkingModelId]?.name ?? 'AI';
	const thinkingEmoji = modelEmoji(thinkingModelId);
	await replyComponents(
		interaction,
		[box([text(t(lang, 'thinkingText', `${thinkingEmoji} ${thinkingModelName}`))])],
		{ ephemeral: !visible },
	);

	try {
		lastAsk.set(interaction.user.id, Date.now());
		const result = await ask(question, overrideModel, interaction.user.id);
		const model = result.model;
		const emoji = modelEmoji(model);

		appendHistory(interaction.user.id, 'user', question);
		appendHistory(interaction.user.id, 'assistant', result.text);

		recordRequest(result.provider, result.model);
		const mu = getModelUsage(model);

		const answerMax = CHARS_BUDGET - 200;
		const answerText =
			result.text.length > answerMax
				? `${result.text.slice(0, answerMax - 1)}${t(lang, 'answerTruncated')}`
				: result.text;

		const contentId = genId();
		setPendingData(contentId, {
			kind: 'ask',
			text: answerText,
			targetContent: question,
			modelId: model,
			emoji,
			used: mu.used,
			limit: mu.limit,
			targetMessageId: null,
			channelId: interaction.channelId,
			guildId: interaction.guildId,
			promptTemplateKey: 'ask',
			originalPrompt: question,
			lang,
			authorId: interaction.user.id,
			visible,
			createdAt: Date.now(),
			messageId: null,
		});

		const pending = getPendingData(contentId);
		if (pending) {
			await editComponents(interaction, renderComponents(pending, contentId, visible));
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		await editComponents(interaction, [text(t(lang, 'error', message))]);
	}
}


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
	} else if (m.provider === 'google') {
		info += '\nLimits from Google free-tier (published quota; captured live from API on 429).';
	} else {
		info += `\nLimits from ${PROVIDER_LABEL[m.provider] ?? m.provider} free tier.`;
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
		const grouped = new Map<string, Array<{ id: string; used: number; limit: number }>>();
		for (const id of CHAT_MODEL_IDS) {
			const mu = getModelUsage(id);
			if (mu.limit === 0) continue;
			const provider = MODELS[id].provider;
			const list = grouped.get(provider) ?? [];
			list.push({ id, used: mu.used, limit: mu.limit });
			grouped.set(provider, list);
		}

		const providerEmoji: Record<string, string> = {
			groq: '<:groq:1547015390939320320>',
			google: '<:google:1547015367174397952>',
			openrouter: '<:openrouter:1547913422551916606>',
			mistral: '<:mistral:1547911139063496775>',
		};

		const providerOrder: Array<{ key: string; label: string }> = [
			{ key: 'groq', label: PROVIDER_LABEL['groq'] ?? 'Groq' },
			{ key: 'google', label: PROVIDER_LABEL['google'] ?? 'Google' },
			{ key: 'openrouter', label: PROVIDER_LABEL['openrouter'] ?? 'OpenRouter' },
			{ key: 'mistral', label: PROVIDER_LABEL['mistral'] ?? 'Mistral' },
		];

		const inner: V2Component[] = [
			boxTitle(t(lang, 'usageTitle')),
			separator(),
			text(`## ${t(lang, 'usageShared')}`),
		];

		for (const { key, label } of providerOrder) {
			const models = grouped.get(key);
			if (!models || models.length === 0) continue;

			const pEmoji = providerEmoji[key] ?? '';
			const modelLines = models.map(m => {
				const e = modelEmoji(m.id);
				const pfx = e ? `${e} ` : '';
				return `- ${pfx}${MODELS[m.id].name}: \`${m.used}/${m.limit}\``;
			}).join('\n');

			inner.push(separator());
			inner.push(text(`### ${pEmoji} ${label}\n${modelLines}`));
		}

		const groqModel = MODELS[model]?.provider === 'groq' ? model : Object.values(MODELS).find(m => m.provider === 'groq')?.id ?? model;
		const rl = await fetchGroqUsage(groqModel);
		const resetRequests = rl.resetRequests ? `\`${rl.resetRequests}\`` : '?';
		const resetTokens = rl.resetTokens ? `\`${rl.resetTokens}\`` : '?';

		inner.push(separator());
		inner.push(text(
			`## ${t(lang, 'usageLive')} · ${MODELS[groqModel]?.name ?? groqModel} (${PROVIDER_LABEL[MODELS[groqModel]?.provider ?? 'groq']})\n` +
			`\`${rl.remainingRequests ?? '?'}/${rl.limitRequests ?? '?'}\` ${t(lang, 'usageRequestsTag')} · ` +
			`${t(lang, 'usageReset')} ${resetRequests}\n` +
			`\`${fmtK(rl.remainingTokens)}/${fmtK(rl.limitTokens)}\` ${t(lang, 'usageTokensTag')} · ` +
			`${t(lang, 'usageReset')} ${resetTokens}`,
		));

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

async function handleClear(interaction: ChatInputCommandInteraction): Promise<void> {
	const lang = getLanguage(interaction.user.id);
	clearHistory(interaction.user.id);
	await replyComponents(interaction, [box([boxTitle(t(lang, 'h1Clear'))])], { ephemeral: true });
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