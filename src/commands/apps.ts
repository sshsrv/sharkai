import {
  ContextMenuCommandBuilder,
  ApplicationCommandType,
  MessageContextMenuCommandInteraction,
  ButtonInteraction,
  InteractionResponseType,
  Routes,
} from 'discord.js';
import { randomBytes } from 'node:crypto';
import { MODELS, DEFAULT_MODEL, DEFAULT_PROMPT_EN, DEFAULT_PROMPT_ES } from '../config.js';
import { getModel, getPrompt, getLanguage } from '../store.js';
import { ask } from '../providers.js';
import { recordRequest, getModelUsage } from '../usage.js';
import { t } from '../strings.js';
import {
  replyComponents,
  editComponents,
  text,
  separator,
  box,
  button,
  actionRow,
  type V2Component} from '../components.js';
import { modelEmoji } from './ai.js';

interface PendingData {
  text: string;
  modelId: string;
  emoji: string;
  used: number;
  limit: number;
  targetMessageId: string;
  messageUrl: string;
}

const pendingVisibility = new Map<string, PendingData>();

function genId(): string {
  return randomBytes(8).toString('hex');
}

export function getPendingData(id: string): PendingData | undefined {
  const data = pendingVisibility.get(id);
  pendingVisibility.delete(id);
  return data;
}

function defaultPrompt(lang: string): string {
  return lang === 'es' ? DEFAULT_PROMPT_ES : DEFAULT_PROMPT_EN;
}

function footer(emoji: string | undefined, model: string, used: number, limit: number): string {
  const e = emoji ? `${emoji} ` : '';
  return `-# ${e}${model}・${used}/${limit} daily・Results are AI generated`;
}

async function runContextAction(
  interaction: MessageContextMenuCommandInteraction,
  promptTemplateKey: string,
): Promise<void> {
const lang = getLanguage(interaction.user.id);
 const modelId = getModel(interaction.user.id);
 const customPrompt = getPrompt(interaction.user.id);
 const model = MODELS[modelId] ?? MODELS[DEFAULT_MODEL];
 const promptBase = customPrompt||defaultPrompt(lang);
 const targetContent = interaction.targetMessage.content||'(no text content)';
 const guildId = interaction.guildId ?? '@me';
 const targetMsgId = interaction.targetMessage.id;
 const messageUrl = `https://discord.com/channels/${guildId}/${interaction.channelId}/${targetMsgId}`;
 const fullPrompt = `${promptBase}\n\n${t(lang, promptTemplateKey, targetContent, messageUrl)}`;

  const thinkingEmoji = modelEmoji(model.id);
  const thinkingName = model.name;

  await replyComponents(
    interaction,
    [box([text(t(lang, 'contextThinking', `${thinkingEmoji} ${thinkingName}`))])],
    { ephemeral: true },
  );

  try {
    const result = await ask(fullPrompt, model.id, interaction.user.id);
    recordRequest(result.provider, result.model);

    const resultModel = MODELS[result.model] ?? model;
    const emoji = modelEmoji(result.model);
    const mu = getModelUsage(result.model);

    const CHARS_BUDGET = 1900;
    const answerText =
      result.text.length > CHARS_BUDGET
        ? `${result.text.slice(0, CHARS_BUDGET - 1)}…`
        : result.text;

    const contentId = genId();
    pendingVisibility.set(contentId, {
      text: answerText,
      modelId: result.model,
      emoji,
      used: mu.used,
      limit: mu.limit,
      targetMessageId: interaction.targetMessage.id,
      messageUrl,
    });

    const components: V2Component[] = [
      box([
        text(`### ${t(lang, 'contextResult', `${emoji} ${resultModel.name}`)}\n\n${answerText}`),
        separator(),
        actionRow(button(t(lang, 'makeVisible'), `make_visible:${contentId}`, 2))
      ])];

    await editComponents(interaction, components);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await editComponents(interaction, [box([text(t(lang, 'error', message))])]);
  }
}

export async function handleMakeVisible(interaction: ButtonInteraction): Promise<void> {
	const contentId = interaction.customId.split(':')[1];
	const data = contentId ? getPendingData(contentId) : undefined;
	if (!data) {
		await interaction.reply({ content: '❌ Not available (expired).', ephemeral: true });
		return;
	}

 const content = `${data.text}\n\n---\n${footer(data.emoji, data.modelId, data.used, data.limit)}`;

	await interaction.client.rest.post(
		Routes.interactionCallback(interaction.id, interaction.token),
		{
			body: {
				type: InteractionResponseType.ChannelMessageWithSource,
				data: {
					content,
					message_reference: { message_id: data.targetMessageId, fail_if_not_exists: false },
				},
			},
		}
	);
}
export const factCheckCommand = {
  data: new ContextMenuCommandBuilder()
    .setName('Fact-Check')
    .setType(ApplicationCommandType.Message)
    .setIntegrationTypes([0, 1])
    .setContexts([0, 1, 2]),
  async execute(interaction: MessageContextMenuCommandInteraction): Promise<void> {
    await runContextAction(interaction, 'factCheckPrompt');
  }};

export const replyMessageCommand = {
  data: new ContextMenuCommandBuilder()
    .setName('Reply')
    .setType(ApplicationCommandType.Message)
    .setIntegrationTypes([0, 1])
    .setContexts([0, 1, 2]),
  async execute(interaction: MessageContextMenuCommandInteraction): Promise<void> {
    await runContextAction(interaction, 'replyPrompt');
  }};
