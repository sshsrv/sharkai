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
  editComponents,
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

// --- Rate limiting for regen ---
const regenLast = new Map<string, number>();
const REGEN_COOLDOWN_MS = 10_000; // 10 seconds between regens

function checkRegenRateLimit(userId: string): number | null {
  const now = Date.now();
  const last = regenLast.get(userId) ?? 0;
  const waitMs = REGEN_COOLDOWN_MS - (now - last);
  if (waitMs > 0) return Math.ceil(waitMs / 1000);
  regenLast.set(userId, now);
  return null;
}

// --- Context menu: Fact-Check / Reply ---

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

    const answerText = cleanAnswer(result.text, promptTemplateKey as PendingKind);

    const contentId = genId();
    setPendingData(contentId, {
      kind: promptTemplateKey as PendingKind,
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
    });

    const guildPart = interaction.guildId ?? '@me';
    const messageUrl = `https://discord.com/channels/${guildPart}/${interaction.channelId}/${interaction.targetMessage.id}`;

    const pending = getPendingData(contentId);
    if (pending) {
      await editComponents(interaction, renderComponents(pending, contentId, false));
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await editComponents(interaction, [text(t(lang, 'error', message))]);
  }
}

// --- Button: Make Visible ---

export async function handleMakeVisible(interaction: ButtonInteraction): Promise<void> {
  const contentId = interaction.customId.split(':')[1];
  const data = contentId ? getPendingData(contentId) : undefined;
  if (!data) {
    await replyComponents(interaction, [text('Not available (expired).')], { ephemeral: true });
    return;
  }

  // Author-only
  if (interaction.user.id !== data.authorId) {
    await replyComponents(interaction, [text(t(data.lang, 'notAuthor'))], { ephemeral: true });
    return;
  }

  try {
    // Re-store data (getPendingData deletes it) so buttons on the new message work
    const newId = genId();
    setPendingData(newId, { ...data, visible: true, authorId: data.authorId, createdAt: Date.now() });

    const components = renderComponents(data, newId, true);
    await replyComponents(interaction, components);
  } catch {
    await replyComponents(interaction, [text('Could not send message (missing permissions?).')], { ephemeral: true });
  }
}

// --- Button: Copy (ephemeral code block) ---

export async function handleCopy(interaction: ButtonInteraction): Promise<void> {
  const contentId = interaction.customId.split(':')[1];
  const data = contentId ? getPendingData(contentId) : undefined;
  if (!data) {
    await replyComponents(interaction, [text('Not available (expired).')], { ephemeral: true });
    return;
  }

  // Re-store so other buttons still work
  setPendingData(contentId, data);

  const codeBlock = `\`\`\`\n${data.text}\n\`\`\``;
  await replyComponents(interaction, [text(codeBlock)], { ephemeral: true });
}

// --- Button: Regenerate ---

export async function handleRegen(interaction: ButtonInteraction): Promise<void> {
  const contentId = interaction.customId.split(':')[1];
  const data = contentId ? getPendingData(contentId) : undefined;
  if (!data) {
    await replyComponents(interaction, [text('Not available (expired).')], { ephemeral: true });
    return;
  }

  // Author-only
  if (interaction.user.id !== data.authorId) {
    await replyComponents(interaction, [text(t(data.lang, 'notAuthor'))], { ephemeral: true });
    return;
  }

  // Rate limit
  const wait = checkRegenRateLimit(interaction.user.id);
  if (wait) {
    await replyComponents(interaction, [text(t(data.lang, 'cooldown', String(wait)))], { ephemeral: true });
    return;
  }

  // Re-run the original prompt
  const lang = data.lang;
  const modelId = getModel(interaction.user.id);
  const model = MODELS[modelId] ?? MODELS[DEFAULT_MODEL];

  // If this was a context action (fact-check/reply), re-run as context action
  if (data.kind === 'factCheckPrompt' || data.kind === 'replyPrompt') {
    // Build fresh prompt from original
    const promptBase = getPrompt(interaction.user.id) || defaultPrompt(lang);
    const fullPrompt = `${promptBase}\n\n${t(lang, data.promptTemplateKey!, data.targetContent)}`;

    const thinkingEmoji = modelEmoji(model.id);
    const thinkingName = model.name;

    await deferComponents(interaction, { ephemeral: true });

    try {
      const result = await ask(fullPrompt, model.id, interaction.user.id);
      recordRequest(result.provider, result.model);

      const emoji = modelEmoji(result.model);
      const mu = getModelUsage(result.model);
      const answerText = cleanAnswer(result.text, data.promptTemplateKey as PendingKind);

      const newId = genId();
      setPendingData(newId, {
        ...data,
        text: answerText,
        modelId: result.model,
        emoji,
        used: mu.used,
        limit: mu.limit,
        originalPrompt: fullPrompt,
        authorId: interaction.user.id,
        createdAt: Date.now(),
      });

      const pending = getPendingData(newId);
      if (pending) {
        await editComponents(interaction, renderComponents(pending, newId, false));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await editComponents(interaction, [text(t(lang, 'error', message))]);
    }
  } else {
    // /sh ask regen - re-ask with the original question from originalPrompt
    await deferComponents(interaction, { ephemeral: true });

    try {
      const result = await ask(data.originalPrompt, null, interaction.user.id);
      recordRequest(result.provider, result.model);

      const emoji = modelEmoji(result.model);
      const mu = getModelUsage(result.model);
      const answerText = cleanAnswer(result.text, data.kind);

      const newId = genId();
      setPendingData(newId, {
        ...data,
        text: answerText,
        modelId: result.model,
        emoji,
        used: mu.used,
        limit: mu.limit,
        authorId: interaction.user.id,
        createdAt: Date.now(),
      });

      const pending = getPendingData(newId);
      if (pending) {
        await editComponents(interaction, renderComponents(pending, newId, data.visible));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await editComponents(interaction, [text(t(lang, 'error', message))]);
    }
  }
}

// --- Button: Ask (modal → follow-up question) ---

export function showAskModal(interaction: ButtonInteraction): void {
  const contentId = interaction.customId.split(':')[1];
  const data = contentId ? getPendingData(contentId) : undefined;
  if (!data) {
    replyComponents(interaction, [text('Context expired.')], { ephemeral: true });
    return;
  }

  // Re-store so modal submit can access it
  setPendingData(contentId, data);

  const modal = new ModalBuilder()
    .setCustomId(`ask_modal:${contentId}`)
    .setTitle(t(data.lang, 'contextModalTitle'))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('ask_input')
          .setLabel(t(data.lang, 'contextModalLabel'))
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder(t(data.lang, 'contextModalPlaceholder'))
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

  // Build prompt: previous answer + follow-up question
  const newPrompt = `${data.originalPrompt}\n\nPrevious AI response:\n${data.text}\n\nUser follow-up: ${followUp}`;

  await deferComponents(interaction, { ephemeral: true });

  try {
    const result = await ask(newPrompt, model.id, interaction.user.id);
    recordRequest(result.provider, result.model);

    const emoji = modelEmoji(result.model);
    const mu = getModelUsage(result.model);
    const answerText = cleanAnswer(result.text, data.promptTemplateKey as PendingKind);

    const newId = genId();
    setPendingData(newId, {
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
      authorId: interaction.user.id,
      visible: data.visible,
      createdAt: Date.now(),
    });

    const pending = getPendingData(newId);
    if (pending) {
      await editComponents(interaction, renderComponents(pending, newId, data.visible));
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await editComponents(interaction, [text(t(lang, 'error', message))]);
  }
}

// --- Button: Add Context (existing) ---

export function showAddContextModal(interaction: ButtonInteraction): void {
  const contentId = interaction.customId.split(':')[1];
  const data = contentId ? getPendingData(contentId) : undefined;
  if (!data) {
    replyComponents(interaction, [text('Context expired.')], { ephemeral: true });
    return;
  }

  // Author-only
  if (interaction.user.id !== data.authorId) {
    replyComponents(interaction, [text(t(data.lang, 'notAuthor'))], { ephemeral: true });
    return;
  }

  setPendingData(contentId, data);

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

  await deferComponents(interaction, { ephemeral: true });

  try {
    const result = await ask(newPrompt, model.id, interaction.user.id);
    recordRequest(result.provider, result.model);

    const emoji = modelEmoji(result.model);
    const mu = getModelUsage(result.model);
    const answerText = cleanAnswer(result.text, data.promptTemplateKey as PendingKind);

    const newContentId = genId();
    setPendingData(newContentId, {
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
    });

    const pending = getPendingData(newContentId);
    if (pending) {
      await editComponents(interaction, renderComponents(pending, newContentId, data.visible));
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await editComponents(interaction, [text(t(lang, 'error', message))]);
  }
}

// --- Context menu command builders ---

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
