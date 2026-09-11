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
} from 'discord.js';
import { MODELS, DEFAULT_MODEL, DEFAULT_PROMPT_EN, DEFAULT_PROMPT_ES } from '../config.js';
import { t } from '../strings.js';
import { getModel, getPrompt, getLanguage } from '../store.js';
import { ask } from '../providers.js';
import { recordRequest, getModelUsage } from '../usage.js';
import { footer, modelEmoji } from './ai.js';
import {
  replyComponents,
  deferComponents,
  deferUpdate,
  editComponents,
  updateComponents,
  text,
  separator,
  type V2Component,
} from '../components.js';
import type { Language } from '../config.js';
import {
  genId,
  getPendingData,
  setPendingData,
  type PendingData,
  type PendingKind,
} from '../pending.js';
import { renderComponents, cleanAnswer } from '../render.js';

function defaultPrompt(lang: Language): string {
  return lang === 'es' ? DEFAULT_PROMPT_ES : DEFAULT_PROMPT_EN;
}

function thinkingComponents(lang: Language, emoji: string, name: string): V2Component[] {
  return [text(t(lang, 'contextThinking', `${emoji} ${name}`))];
}

const regenLast = new Map<string, number>();
const REGEN_COOLDOWN_MS = 10_000;

function checkRegenRateLimit(userId: string): number | null {
  const now = Date.now();
  const last = regenLast.get(userId) ?? 0;
  const waitMs = REGEN_COOLDOWN_MS - (now - last);
  if (waitMs > 0) return Math.ceil(waitMs / 1000);
  regenLast.set(userId, now);
  return null;
}

async function runContextAction(
  interaction: MessageContextMenuCommandInteraction,
  promptTemplateKey: PendingKind,
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
    const answerText = cleanAnswer(result.text, promptTemplateKey);

    const contentId = genId();
    const pendingData: PendingData = {
      kind: promptTemplateKey,
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
      authorId: interaction.user.id,
      visible: false,
      createdAt: Date.now(),
      messageId: null,
    };
    setPendingData(contentId, pendingData);

    await editComponents(interaction, renderComponents(pendingData, contentId, false));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await editComponents(interaction, [text(t(lang, 'error', message))]);
  }
}

export async function handleMakeVisible(interaction: ButtonInteraction): Promise<void> {
  const contentId = interaction.customId.split(':')[1];
  const data = contentId ? getPendingData(contentId) : undefined;
  if (!data) {
    await replyComponents(interaction, [text('Not available (expired).')], { ephemeral: true });
    return;
  }

  if (interaction.user.id !== data.authorId) {
    await replyComponents(interaction, [text(t(data.lang, 'notAuthor'))], { ephemeral: true });
    return;
  }

  try {
    const newId = genId();
    const newData: PendingData = { ...data, visible: true, messageId: null, createdAt: Date.now() };
    setPendingData(newId, newData);
    await replyComponents(interaction, renderComponents(newData, newId, true));
  } catch {
    await replyComponents(interaction, [text('Could not send message (missing permissions?).')], { ephemeral: true });
  }
}

export async function handleCopy(interaction: ButtonInteraction): Promise<void> {
  const contentId = interaction.customId.split(':')[1];
  const data = contentId ? getPendingData(contentId) : undefined;
  if (!data) {
    await replyComponents(interaction, [text('Not available (expired).')], { ephemeral: true });
    return;
  }

  setPendingData(contentId, data);
  const codeBlock = `\`\`\`\n${data.text}\n\`\`\``;
  await replyComponents(interaction, [text(codeBlock)], { ephemeral: true });
}

export async function handleRegen(interaction: ButtonInteraction): Promise<void> {
  const contentId = interaction.customId.split(':')[1];
  const data = contentId ? getPendingData(contentId) : undefined;
  if (!data) {
    await replyComponents(interaction, [text('Not available (expired).')], { ephemeral: true });
    return;
  }

  if (interaction.user.id !== data.authorId) {
    await replyComponents(interaction, [text(t(data.lang, 'notAuthor'))], { ephemeral: true });
    return;
  }

  const wait = checkRegenRateLimit(interaction.user.id);
  if (wait) {
    await replyComponents(interaction, [text(t(data.lang, 'cooldown', String(wait)))], { ephemeral: true });
    return;
  }

  const lang = data.lang;
  const modelId = getModel(interaction.user.id);
  const model = MODELS[modelId] ?? MODELS[DEFAULT_MODEL];

  await deferUpdate(interaction);

  try {
    let fullPrompt: string;
    if (data.kind === 'factCheckPrompt' || data.kind === 'replyPrompt') {
      const promptBase = getPrompt(interaction.user.id) || defaultPrompt(lang);
      fullPrompt = `${promptBase}\n\n${t(lang, data.promptTemplateKey!, data.targetContent)}`;
    } else {
      fullPrompt = data.originalPrompt;
    }

    const result = await ask(fullPrompt, model.id, interaction.user.id);
    recordRequest(result.provider, result.model);

    const emoji = modelEmoji(result.model);
    const mu = getModelUsage(result.model);
    const answerText = cleanAnswer(result.text, data.promptTemplateKey as PendingKind);

    const newId = genId();
    const newData: PendingData = {
      ...data,
      text: answerText,
      modelId: result.model,
      emoji,
      used: mu.used,
      limit: mu.limit,
      originalPrompt: fullPrompt,
      authorId: interaction.user.id,
      createdAt: Date.now(),
    };
    setPendingData(newId, newData);

    await editComponents(interaction, renderComponents(newData, newId, data.visible));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await editComponents(interaction, [text(t(lang, 'error', message))]);
  }
}

export function showAskModal(interaction: ButtonInteraction): void {
  const contentId = interaction.customId.split(':')[1];
  const data = contentId ? getPendingData(contentId) : undefined;
  if (!data) {
    replyComponents(interaction, [text('Context expired.')], { ephemeral: true });
    return;
  }

  const storedData: PendingData = { ...data, messageId: interaction.message.id };
  setPendingData(contentId, storedData);

  const modal = new ModalBuilder()
    .setCustomId(`ask_modal:${contentId}`)
    .setTitle(t(data.lang, 'askModalTitle'))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('ask_input')
          .setLabel(t(data.lang, 'askModalLabel'))
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder(t(data.lang, 'askModalPlaceholder'))
          .setRequired(true)
          .setMaxLength(2000),
      ),
    );

  interaction.showModal(modal);
}

export async function handleAskModal(interaction: ModalSubmitInteraction): Promise<void> {
  const contentId = interaction.customId.split(':')[1];
  const data = contentId ? getPendingData(contentId) : undefined;
  if (!data) {
    await replyComponents(interaction, [text('Context expired.')], { ephemeral: true });
    return;
  }

  const followUp = interaction.fields.getTextInputValue('ask_input');
  const lang = data.lang;
  const modelId = getModel(interaction.user.id);
  const model = MODELS[modelId] ?? MODELS[DEFAULT_MODEL];

  const newPrompt =
    `The user is asking about the following conversation:\n\n` +
    `Original message: "${data.targetContent}"\n\n` +
    `AI response:\n${data.text}\n\n` +
    `User follow-up question: ${followUp}\n\n` +
    `Answer the user's follow-up question directly and concisely. Use the conversation above as context, but respond naturally as if answering a new question.`;

  await deferComponents(interaction, { ephemeral: !data.visible });

  try {
    const result = await ask(newPrompt, model.id, interaction.user.id);
    recordRequest(result.provider, result.model);

    const emoji = modelEmoji(result.model);
    const mu = getModelUsage(result.model);
    const answerText = cleanAnswer(result.text, null);

    const newId = genId();
    const newData: PendingData = {
      kind: 'ask',
      text: answerText,
      targetContent: '',
      modelId: result.model,
      emoji,
      used: mu.used,
      limit: mu.limit,
      targetMessageId: null,
      channelId: data.channelId,
      guildId: data.guildId,
      promptTemplateKey: 'ask',
      originalPrompt: newPrompt,
      lang,
      authorId: interaction.user.id,
      visible: data.visible,
      createdAt: Date.now(),
      messageId: null,
    };
    setPendingData(newId, newData);

    await editComponents(interaction, renderComponents(newData, newId, data.visible));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await editComponents(interaction, [text(t(lang, 'error', message))]);
  }
}

export function showAddContextModal(interaction: ButtonInteraction): void {
  const contentId = interaction.customId.split(':')[1];
  const data = contentId ? getPendingData(contentId) : undefined;
  if (!data) {
    replyComponents(interaction, [text('Context expired.')], { ephemeral: true });
    return;
  }

  if (interaction.user.id !== data.authorId) {
    replyComponents(interaction, [text(t(data.lang, 'notAuthor'))], { ephemeral: true });
    return;
  }

  const storedData: PendingData = { ...data, messageId: interaction.message.id };
  setPendingData(contentId, storedData);

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
    await replyComponents(interaction, [text('Context expired.')], { ephemeral: true });
    return;
  }

  const additionalContext = interaction.fields.getTextInputValue('context_input');
  const lang = data.lang;
  const modelId = getModel(interaction.user.id);
  const model = MODELS[modelId] ?? MODELS[DEFAULT_MODEL];

  const newPrompt = `${data.originalPrompt}\n\nAdditional context from user:\n${additionalContext}`;

  await deferUpdate(interaction);

  try {
    const result = await ask(newPrompt, model.id, interaction.user.id);
    recordRequest(result.provider, result.model);

    const emoji = modelEmoji(result.model);
    const mu = getModelUsage(result.model);
    const answerText = cleanAnswer(result.text, data.promptTemplateKey as PendingKind);

    const newContentId = genId();
    const newData: PendingData = {
      kind: data.kind,
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
      authorId: data.authorId,
      visible: data.visible,
      createdAt: Date.now(),
      messageId: data.messageId,
    };
    setPendingData(newContentId, newData);

    await editComponents(interaction, renderComponents(newData, newContentId, data.visible));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await editComponents(interaction, [text(t(lang, 'error', message))]);
  }
}

export const factCheckCommand = new ContextMenuCommandBuilder()
  .setName('Fact-Check')
  .setType(ApplicationCommandType.Message)
  .setIntegrationTypes([ApplicationIntegrationType.UserInstall])
  .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]);

export const replyMessageCommand = new ContextMenuCommandBuilder()
  .setName('Reply')
  .setType(ApplicationCommandType.Message)
  .setIntegrationTypes([ApplicationIntegrationType.UserInstall])
  .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]);

export async function handleFactCheck(interaction: MessageContextMenuCommandInteraction): Promise<void> {
  await runContextAction(interaction, 'factCheckPrompt');
}

export async function handleReplyMessage(interaction: MessageContextMenuCommandInteraction): Promise<void> {
  await runContextAction(interaction, 'replyPrompt');
}
