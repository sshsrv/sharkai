import {
  ContextMenuCommandBuilder,
  ApplicationCommandType,
  ApplicationIntegrationType,
  InteractionContextType,
  ButtonInteraction,
  ModalSubmitInteraction,
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageContextMenuCommandInteraction,
  Routes,
} from 'discord.js';
import { randomBytes } from 'node:crypto';
import { MODELS, DEFAULT_MODEL, DEFAULT_PROMPT_EN, DEFAULT_PROMPT_ES } from '../config.js';
import { t } from '../strings.js';
import { getModel, getPrompt, getLanguage } from '../store.js';
import { ask } from '../providers.js';
import { recordRequest, getModelUsage } from '../usage.js';
import { modelEmoji } from './ai.js';
import {
  replyComponents,
  editComponents,
  text,
  separator,
  button,
  actionRow,
  box,
  IS_COMPONENTS_V2,
  type V2Component,
} from '../components.js';
import type { Language } from '../config.js';

interface PendingData {
  text: string;
  targetContent: string;
  modelId: string;
  emoji: string;
  used: number;
  limit: number;
  targetMessageId: string;
  channelId: string;
  guildId: string | null;
  promptTemplateKey: string;
  originalPrompt: string;
  lang: Language;
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

function defaultPrompt(lang: Language): string {
  return lang === 'es' ? DEFAULT_PROMPT_ES : DEFAULT_PROMPT_EN;
}

function thinkingComponents(lang: Language, emoji: string, name: string): V2Component[] {
  return [text(t(lang, 'contextThinking', `${emoji} ${name}`))];
}

function resultComponents(
  lang: Language,
  targetContent: string,
  answerText: string,
  contentId: string,
): V2Component[] {
  return [box([
    text(`# ${targetContent}`),
    separator(),
    text(answerText),
    separator(),
    actionRow(
      button(t(lang, 'addContext'), `add_context:${contentId}`, 2),
      button(t(lang, 'makeVisible'), `make_visible:${contentId}`, 2),
    ),
  ])];
}

function visibleComponents(
 targetContent: string,
 answerText: string,
 emoji: string | undefined,
 modelName: string,
 used: number,
 limit: number,
 messageUrl: string,
): V2Component[] {
 const e = emoji ? `${emoji} ` : '';
 return [box([
 text(`# [${targetContent}](${messageUrl})`),
 separator(),
 text(answerText),
 separator(),
 text(`-# ${e}${modelName}·${used}/${limit} daily·Results are AI generated`),
 ])];
}

async function runContextAction(
  interaction: MessageContextMenuCommandInteraction,
  promptTemplateKey: string,
): Promise<void> {
  const lang = getLanguage(interaction.user.id);
  const modelId = getModel(interaction.user.id);
  const customPrompt = getPrompt(interaction.user.id);
  const model = MODELS[modelId] ?? MODELS[DEFAULT_MODEL];
  const promptBase = customPrompt || defaultPrompt(lang);
  const targetContent = interaction.targetMessage.content || '(no text content)';
  const fullPrompt = `${promptBase}\n\n${t(lang, promptTemplateKey, targetContent)}`;

  const thinkingEmoji = modelEmoji(model.id);
  const thinkingName = model.name;

  await replyComponents(
    interaction,
    thinkingComponents(lang, thinkingEmoji, thinkingName),
    { ephemeral: true },
  );

  try {
    const result = await ask(fullPrompt, model.id, interaction.user.id);
    recordRequest(result.provider, result.model);

    const emoji = modelEmoji(result.model);
    const mu = getModelUsage(result.model);

    const CHARS_BUDGET = 1900;
    const answerText =
      result.text.length > CHARS_BUDGET
        ? `${result.text.slice(0, CHARS_BUDGET - 1)}\u2026`
        : result.text;

    const contentId = genId();
 pendingVisibility.set(contentId, {
 text: answerText,
 targetContent,
 modelId: result.model,
 emoji,
 used: mu.used,
 limit: mu.limit,
 targetMessageId: interaction.targetMessage.id,
 channelId: interaction.channelId,
 guildId: interaction.guildId,
 promptTemplateKey,
 originalPrompt: fullPrompt,
 lang,
 });

    await editComponents(
      interaction,
      resultComponents(lang, targetContent, answerText, contentId),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await editComponents(interaction, [text(t(lang, 'error', message))]);
  }
}

export async function handleMakeVisible(interaction: ButtonInteraction): Promise<void> {
  const contentId = interaction.customId.split(':')[1];
  const data = contentId ? getPendingData(contentId) : undefined;
  if (!data) {
    await interaction.reply({ content: 'Not available (expired).', ephemeral: true });
    return;
  }

  const resultModel = MODELS[data.modelId];
  const guildPart = data.guildId ?? '@me';
  const messageUrl = `https://discord.com/channels/${guildPart}/${data.channelId}/${data.targetMessageId}`;

  await interaction.deferReply({ ephemeral: true });

  try {
    const components = visibleComponents(
      data.targetContent,
      data.text,
      data.emoji,
      resultModel?.name ?? data.modelId,
      data.used,
      data.limit,
      messageUrl,
    );

    await interaction.client.rest.post(
      Routes.webhook(interaction.client.user.id, interaction.token),
      {
        body: {
          flags: IS_COMPONENTS_V2,
          components,
          message_reference: {
            message_id: data.targetMessageId,
            fail_if_not_exists: false,
          },
        },
      },
    );

    await interaction.editReply({ content: 'Message made visible.' });
  } catch {
    await interaction.editReply({ content: 'Could not send message (missing permissions?).' });
  }
}

export function showAddContextModal(interaction: ButtonInteraction): void {
  const contentId = interaction.customId.split(':')[1];
  const data = contentId ? getPendingData(contentId) : undefined;
  if (!data) {
    interaction.reply({ content: 'Context expired.', ephemeral: true });
    return;
  }

  pendingVisibility.set(contentId, data);

  const modal = new ModalBuilder()
    .setCustomId(`context_modal:${contentId}`)
    .setTitle(t(data.lang, 'contextModalTitle'))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('context_input')
          .setLabel(t(data.lang, 'contextModalLabel'))
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder(t(data.lang, 'contextModalPlaceholder'))
          .setRequired(true)
          .setMaxLength(2000),
      ),
    );

  interaction.showModal(modal);
}

export async function handleContextModal(interaction: ModalSubmitInteraction): Promise<void> {
  const contentId = interaction.customId.split(':')[1];
  const data = contentId ? getPendingData(contentId) : undefined;
  if (!data) {
    await interaction.reply({ content: 'Context expired.', ephemeral: true });
    return;
  }

  const additionalContext = interaction.fields.getTextInputValue('context_input');
  const lang = data.lang;
  const modelId = getModel(interaction.user.id);
  const model = MODELS[modelId] ?? MODELS[DEFAULT_MODEL];

  const newPrompt = `${data.originalPrompt}\n\nAdditional context from user:\n${additionalContext}`;

  await interaction.deferReply({ ephemeral: true });

  try {
    const result = await ask(newPrompt, model.id, interaction.user.id);
    recordRequest(result.provider, result.model);

    const emoji = modelEmoji(result.model);
    const mu = getModelUsage(result.model);

    const CHARS_BUDGET = 1900;
    const answerText =
      result.text.length > CHARS_BUDGET
        ? `${result.text.slice(0, CHARS_BUDGET - 1)}\u2026`
        : result.text;

    const newContentId = genId();
 pendingVisibility.set(newContentId, {
 text: answerText,
 targetContent: data.targetContent,
 modelId: result.model,
 emoji,
 used: mu.used,
 limit: mu.limit,
 targetMessageId: data.targetMessageId,
 channelId: data.channelId,
 guildId: data.guildId,
 promptTemplateKey: data.promptTemplateKey,
 originalPrompt: newPrompt,
 lang,
 });

    await interaction.editReply({
      flags: IS_COMPONENTS_V2,
      components: resultComponents(lang, data.targetContent, answerText, newContentId),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await interaction.editReply({
      flags: IS_COMPONENTS_V2,
      components: [text(t(lang, 'error', message))],
    });
  }
}

export const factCheckCommand = new ContextMenuCommandBuilder()
 .setName('Fact-Check')
 .setType(ApplicationCommandType.Message)
 .setIntegrationTypes([ApplicationIntegrationType.UserInstall])
 .setContexts([InteractionContextType.BotDM, InteractionContextType.PrivateChannel]);

export const replyMessageCommand = new ContextMenuCommandBuilder()
 .setName('Reply')
 .setType(ApplicationCommandType.Message)
 .setIntegrationTypes([ApplicationIntegrationType.UserInstall])
 .setContexts([InteractionContextType.BotDM, InteractionContextType.PrivateChannel]);

export async function handleFactCheck(interaction: MessageContextMenuCommandInteraction): Promise<void> {
  await runContextAction(interaction, 'factCheckPrompt');
}

export async function handleReplyMessage(interaction: MessageContextMenuCommandInteraction): Promise<void> {
  await runContextAction(interaction, 'replyPrompt');
}
