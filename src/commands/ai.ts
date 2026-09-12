import {
	AutocompleteInteraction,
	ChatInputCommandInteraction,
	SlashCommandBuilder,
	ApplicationIntegrationType,
	InteractionContextType,
} from 'discord.js';
import {
	MODELS,
	CHAT_MODEL_IDS,
	MODEL_EMOJI,
	PROVIDER_LABEL,
	PRIVACY_SHIELD,
	type Language,
	LANGUAGE_CHOICES,
	languageLabel,
} from '../config.js';
import {
	getModel,
	setModel,
	getPrompt,
	setPrompt,
	getLanguage,
	setLanguage,
	appendHistory,
	clearHistory,
	resetUser,
} from '../store.js';
import { ask, fetchGroqUsage, getObservedLimits } from '../providers.js';
import { recordRequest, getModelUsage } from '../usage.js';
import { t } from '../strings.js';
import {
	V2Component,
	replyComponents,
	deferComponents,
	editComponents,
	followUpComponents,
	text,
	separator,
	heading,
	box,
	totalChars,
} from '../components.js';
import { genId, getPendingData, setPendingData } from '../pending.js';
import { renderComponents } from '../render.js';



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


function fmtK(n: number | null | undefined): string {
	if (n === null || n === undefined) return '?';
	if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`;
	return String(n);
}


export function footer(emoji: string | undefined, model: string, used: number, limit: number): string {
	const e = emoji ? `${emoji} ` : '';
	const usage = limit === 0 ? '∞/∞' : `${used}/${limit}`;
	return `-# ${e}${model}・${usage} daily・Results are AI generated`;
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
				.setName('set')
				.setDescription('Set your model, prompt, or both')
			.addStringOption((o) =>
				o
					.setName('model')
					.setDescription('Default model (autocomplete)')
					.setAutocomplete(true),
			)
				.addStringOption((o) =>
					o
						.setName('prompt')
						.setDescription('Custom system prompt (empty string to reset)'),
				),
		)
		.addSubcommand((s) =>
			s
				.setName('language')
				.setDescription('UI language (AI always answers in your language)')
				.addStringOption((o) =>
					o
						.setName('language')
						.setDescription('Language')
						.setRequired(true)
						.addChoices(...LANGUAGE_CHOICES),
				),
		)
		.addSubcommand((s) => s.setName('models').setDescription('List all models with usage and privacy info'))
		.addSubcommand((s) => s.setName('usage').setDescription('Show detailed usage of your current model'))
		.addSubcommand((s) => s.setName('clear').setDescription('Clear your conversation history (start fresh context)'))
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
			case 'set':
				await handleSet(interaction);
				break;
			case 'language':
				await handleLanguage(interaction);
				break;
			case 'models':
				await handleModels(interaction);
				break;
			case 'usage':
				await handleUsage(interaction);
				break;
			case 'clear':
				await handleClear(interaction);
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


async function handleSet(interaction: ChatInputCommandInteraction): Promise<void> {
	const lang = getLanguage(interaction.user.id);
	const modelArg = interaction.options.getString('model');
	const promptArg = interaction.options.getString('prompt');

	if (!modelArg && promptArg === null) {
		const currentModel = getModel(interaction.user.id);
		const currentPrompt = getPrompt(interaction.user.id);
		const m = MODELS[currentModel];
		const promptDisplay = currentPrompt ? currentPrompt.slice(0, 200) : t(lang, 'noPrompt');
		const components: V2Component[] = [
			box([
				boxTitle(t(lang, 'h1SetShow')),
				separator(),
				text(
					`**Model:** ${m?.name ?? currentModel} (\`${currentModel}\`)\n` +
					`**Prompt:** ${promptDisplay}`
				),
			]),
		];
		await replyComponents(interaction, components, { ephemeral: true });
		return;
	}

	const updates: string[] = [];

	if (modelArg) {
		const m = MODELS[modelArg];
		if (!m) {
			await replyComponents(interaction, [text(t(lang, 'invalidModel', modelArg))], {
				ephemeral: true,
			});
			return;
		}
		setModel(interaction.user.id, modelArg);
		updates.push('model');
	}

	if (promptArg !== null) {
		setPrompt(interaction.user.id, promptArg.trim());
		updates.push('prompt');
	}

	const model = getModel(interaction.user.id);
	const m = MODELS[model];

	let key: string;
	if (updates.length === 2) {
		key = 'h1SetBoth';
	} else if (updates.includes('model')) {
		key = 'h1SetModel';
	} else {
		key = 'h1SetPrompt';
	}

	const components: V2Component[] = [
		box([boxTitle(t(lang, key, m?.name ?? model))]),
	];
	await replyComponents(interaction, components, { ephemeral: true });
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

async function handleModels(interaction: ChatInputCommandInteraction): Promise<void> {
	const lang = getLanguage(interaction.user.id);
	await deferComponents(interaction, { ephemeral: true });

	try {
		const grouped = new Map<string, Array<{ id: string; used: number; limit: number }>>();
		for (const id of CHAT_MODEL_IDS) {
			const mu = getModelUsage(id);
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
			opencode: '<:opencode:1547987872844484618>',
		};

		const providerOrder: Array<{ key: string; label: string }> = [
			{ key: 'groq', label: PROVIDER_LABEL['groq'] ?? 'Groq' },
			{ key: 'google', label: PROVIDER_LABEL['google'] ?? 'Google' },
			{ key: 'openrouter', label: PROVIDER_LABEL['openrouter'] ?? 'OpenRouter' },
			{ key: 'mistral', label: PROVIDER_LABEL['mistral'] ?? 'Mistral' },
			{ key: 'opencode', label: PROVIDER_LABEL['opencode'] ?? 'OpenCode' },
		];

		const legendText = `\n---\n**${t(lang, 'modelsLegendTitle')}**\n` +
			`${PRIVACY_SHIELD.safe} ${t(lang, 'privacySafe')} · ` +
			`${PRIVACY_SHIELD.warn} ${t(lang, 'privacyWarn')} · ` +
			`${PRIVACY_SHIELD.unsafe} ${t(lang, 'privacyUnsafe')}`;

		const providerBlocks: Array<{ header: string; models: string }> = [];
		for (const { key, label } of providerOrder) {
			const models = grouped.get(key);
			if (!models || models.length === 0) continue;

			const sorted = [...models].sort((a, b) => {
				if (a.limit === 0 && b.limit === 0) return 0;
				if (a.limit === 0) return 1;
				if (b.limit === 0) return -1;
				return b.used - a.used;
			});

			const pEmoji = providerEmoji[key] ?? '';
			const modelLines = sorted.map(m => {
				const e = modelEmoji(m.id);
				const shield = PRIVACY_SHIELD[MODELS[m.id].privacy];
				const usage = m.limit === 0 ? '∞/∞' : `${m.used}/${m.limit}`;
				return `- ${shield}・${e} ${MODELS[m.id].name} \`${usage}\``;
			}).join('\n');

			providerBlocks.push({
				header: `### ${pEmoji} ${label}`,
				models: modelLines,
			});
		}

		const BOX_BUDGET = 3800;
		const pages: V2Component[][] = [];
		let currentPage: V2Component[] = [];
		let currentChars = 0;

		const titleText = t(lang, 'modelsTitle');
		const subtitleText = t(lang, 'modelsShared');

		for (const block of providerBlocks) {
			const blockText = `${block.header}\n${block.models}`;
			const blockChars = blockText.length + 4;

			if (currentPage.length === 0) {
				currentPage.push(boxTitle(titleText), separator(), text(`## ${subtitleText}`));
				currentChars = titleText.length + subtitleText.length + 10;
			}

			if (currentChars + blockChars > BOX_BUDGET && currentPage.length > 3) {
				pages.push(currentPage);
				currentPage = [boxTitle(titleText), separator(), text(`## ${subtitleText}`)];
				currentChars = titleText.length + subtitleText.length + 10;
			}

			currentPage.push(separator(), text(blockText));
			currentChars += blockChars;
		}

		if (currentPage.length > 0) {
			if (pages.length === 0) {
				currentPage.push(separator(), text(legendText));
			}
			pages.push(currentPage);
		}

		if (pages.length > 1) {
			const lastPage = pages[pages.length - 1];
			const legendBlock = separator();
			const legendTextBlock = text(legendText);
			lastPage.push(legendBlock, legendTextBlock);
		}

		if (pages.length === 0) {
			await editComponents(interaction, [text('No models available.')]);
			return;
		}

		await editComponents(interaction, [box(pages[0])]);

		for (let i = 1; i < pages.length; i++) {
			await followUpComponents(interaction, [box(pages[i])], { ephemeral: true });
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		await editComponents(interaction, [text(t(lang, 'usageError', message))]);
	}
}

async function handleUsage(interaction: ChatInputCommandInteraction): Promise<void> {
	const lang = getLanguage(interaction.user.id);
	const model = getModel(interaction.user.id);
	await deferComponents(interaction, { ephemeral: true });

	try {
		const m = MODELS[model];
		const mu = getModelUsage(model);
		const usage = mu.limit === 0 ? '∞/∞' : `${mu.used}/${mu.limit}`;

		const inner: V2Component[] = [
			boxTitle(t(lang, 'usageTitle')),
			separator(),
			text(`**${m?.name ?? model}** (\`${model}\`)`),
			text(`Usage: \`${usage}\` daily`),
		];

		if (m?.provider === 'groq') {
			const rl = await fetchGroqUsage(model);
			const resetRequests = rl.resetRequests ? `\`${rl.resetRequests}\`` : '?';
			const resetTokens = rl.resetTokens ? `\`${rl.resetTokens}\`` : '?';

			inner.push(separator());
			inner.push(text(
				`## ${t(lang, 'usageLive')} · ${m.name}\n` +
				`\`${rl.remainingRequests ?? '?'}/${rl.limitRequests ?? '?'}\` ${t(lang, 'usageRequestsTag')} · ` +
				`${t(lang, 'usageReset')} ${resetRequests}\n` +
				`\`${fmtK(rl.remainingTokens)}/${fmtK(rl.limitTokens)}\` ${t(lang, 'usageTokensTag')} · ` +
				`${t(lang, 'usageReset')} ${resetTokens}`,
			));
		} else if (m?.provider === 'google') {
			const goog = getObservedLimits(model);
			if (goog?.limitRequests || goog?.limitTokens) {
				inner.push(
					separator(),
					text(
						`## ${t(lang, 'usageLive')} · ${m.name}\n` +
						(goog.limitRequests !== null
							? `\`${goog.remainingRequests ?? '?'}/${goog.limitRequests}\` ${t(lang, 'usageRequestsTag')}\n`
							: '') +
						`\`${fmtK(goog.remainingTokens)}/${fmtK(goog.limitTokens)}\` ${t(lang, 'usageTokensTag')}`,
					),
				);
			}
		} else {
			inner.push(separator());
			inner.push(text(`Limits from ${PROVIDER_LABEL[m?.provider ?? 'opencode'] ?? m?.provider} free tier.`));
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

async function handleReset(interaction: ChatInputCommandInteraction): Promise<void> {
	const lang = getLanguage(interaction.user.id);
	const language = getLanguage(interaction.user.id);
	resetUser(interaction.user.id);
	const model = getModel(interaction.user.id);
	const prompt = getPrompt(interaction.user.id);
	const promptDisplay = prompt || t(lang, 'noPrompt');
	await replyComponents(
		interaction,
		[box([boxTitle(t(lang, 'h1Reset')), separator(), text(t(lang, 'resetBody', model, promptDisplay, languageLabel(language)))])],
		{ ephemeral: true },
	);
}