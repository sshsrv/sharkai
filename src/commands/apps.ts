import {
  ContextMenuCommandBuilder,
  ApplicationCommandType,
  MessageContextMenuCommandInteraction,
  ButtonInteraction,
} from 'discord.js';
import { randomBytes } from 'node:crypto';
import { MODELS, DEFAULT_MODEL, DEFAULT_PROMPT_EN, DEFAULT_PROMPT_ES } from '../config.js';
import { getModel, getPrompt, getLanguage } from '../store.js';
import { ask } from '../providers.js';
import { recordRequest } from '../usage.js';
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

const pendingVisibility = new Map<string, string>();

function genId(): string {
  return randomBytes(8).toString('hex');
}

export function getPendingContent(id: string): string | undefined {
  const content = pendingVisibility.get(id);
  pendingVisibility.delete(id);
  return content;
}

function defaultPrompt(lang: string): string {
  return lang === 'es' ? DEFAULT_PROMPT_ES : DEFAULT_PROMPT_EN;
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
    [box([text(t(lang, 'contextThinking', `${thinkingEmoji} ${thinkingName}`))])],
    { ephemeral: true },
  );

  try {
    const result = await ask(fullPrompt, model.id, interaction.user.id);
    recordRequest(result.provider, result.model);

    const resultModel = MODELS[result.model] ?? model;
    const emoji = modelEmoji(result.model);

    const CHARS_BUDGET = 1900;
    const answerText =
      result.text.length > CHARS_BUDGET
        ? `${result.text.slice(0, CHARS_BUDGET - 1)}…`
        : result.text;

    const contentId = genId();
    pendingVisibility.set(contentId, answerText);

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
  const content = contentId ? getPendingContent(contentId) : undefined;
  if (!content) {
    await interaction.reply({ content: '❌ Not available (expired).', ephemeral: true });
    return;
  }
  await interaction.deferReply();
  await interaction.followUp({ content });
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
