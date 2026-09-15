import {
  AutocompleteInteraction,
  ButtonInteraction,
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  ApplicationIntegrationType,
  InteractionContextType,
} from 'discord.js';
import {
  MODELS,
  CHAT_MODEL_IDS,
  PROVIDER_LABEL,
  PRIVACY_SHIELD,
  LAST_ASK_TTL_MS,
  PROMPT_DISPLAY_MAX,
  CHARS_BUDGET,
  type Language,
  languageLabel,
} from '../config.js';
import {
  getModel,
  setModel,
  getPrompt,
  setPrompt,
  getLanguage,
  appendHistory,
  clearHistory,
  resetUser,
} from '../store.js';
import { ask, fetchGroqUsage, getObservedLimits } from '../providers.js';
import { recordRequest, getModelUsage } from '../usage.js';
import { t } from '../strings.js';
import { extractMemory, getMemoryInfo } from '../memory.js';
import {
  V2Component,
  replyComponents,
  deferComponents,
  editComponents,
  updateComponents,
  text,
  separator,
  heading,
  box,
  button,
  actionRow,
} from '../components.js';
import { genId, getPendingData, setPendingData } from '../pending.js';
import { renderComponents, renderThinkingComponents } from '../render.js';
import { modelEmoji } from '../display.js';

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
setInterval(() => {
  const cutoff = Date.now() - LAST_ASK_TTL_MS;
  for (const [id, ts] of lastAsk) {
    if (ts < cutoff) lastAsk.delete(id);
  }
}, 10 * 60 * 1000).unref();

interface ModelsPagination {
  pages: V2Component[][];
  current: number;
  userId: string;
  lang: Language;
  createdAt: number;
}

const modelsPagination = new Map<string, ModelsPagination>();
const MODELS_PAGINATION_TTL_MS = 10 * 60 * 1000;

setInterval(() => {
  const cutoff = Date.now() - MODELS_PAGINATION_TTL_MS;
  for (const [id, data] of modelsPagination) {
    if (data.createdAt < cutoff) modelsPagination.delete(id);
  }
}, 60_000).unref();

function boxTitle(title: string): V2Component {
  return heading(title, 1);
}

function fmtK(n: number | null | undefined): string {
  if (n === null || n === undefined) return '?';
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(n);
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return '?';
  const diff = Date.parse(iso) - Date.now();
  if (diff <= 0) return 'now';
  const mins = Math.ceil(diff / 60_000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs}h${rem}m` : `${hrs}h`;
}

export const aiCommand = {
  data: new SlashCommandBuilder()
    .setName('ai')
    .setDescription('SharkAI: AI assistant commands')
    .setIntegrationTypes([ApplicationIntegrationType.UserInstall, ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel])
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
            .setDescription('Custom system prompt'),
        )
        .addBooleanOption((o) =>
          o
            .setName('reset_prompt')
            .setDescription('Reset prompt to default (clears custom prompt)'),
        ),
    )
    .addSubcommand((s) => s.setName('models').setDescription('List all models with usage and privacy info'))
    .addSubcommand((s) => s.setName('usage').setDescription('Show detailed usage of your current model'))
    .addSubcommand((s) => s.setName('clear').setDescription('Clear your conversation history (start fresh context)'))
    .addSubcommand((s) => s.setName('reset').setDescription('Reset all your settings to defaults'))
    .addSubcommand((s) => s.setName('memory').setDescription('See what SharkAI remembers about you')),

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
      case 'memory':
        await handleMemory(interaction);
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
  const thinkingEmoji = modelEmoji(thinkingModelId);
  await replyComponents(
    interaction,
    renderThinkingComponents({
      kind: 'ask',
      targetContent: question,
      modelId: thinkingModelId,
      emoji: thinkingEmoji,
      lang,
      targetMessageId: null,
      channelId: interaction.channelId,
      guildId: interaction.guildId,
    }),
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
    extractMemory(interaction.user.id, question, result.text, ask).catch(() => {});

    const contentId = genId();
    setPendingData(contentId, {
      kind: 'ask',
      text: result.text,
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
  const resetPrompt = interaction.options.getBoolean('reset_prompt') ?? false;

  if (!modelArg && promptArg === null && !resetPrompt) {
    const currentModel = getModel(interaction.user.id);
    const currentPrompt = getPrompt(interaction.user.id);
    const m = MODELS[currentModel];
    const promptDisplay = currentPrompt
      ? (currentPrompt.length > PROMPT_DISPLAY_MAX ? currentPrompt.slice(0, PROMPT_DISPLAY_MAX - 3).replace(/\s+\S*$/, '') + '…' : currentPrompt)
      : t(lang, 'noPrompt');
    const components: V2Component[] = [
      box([
        boxTitle(t(lang, 'h1SetShow')),
        separator(),
        text(
          `**Model:** ${m?.name ?? currentModel}\n` +
          `\`${currentModel}\`\n` +
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

  if (resetPrompt) {
    setPrompt(interaction.user.id, '');
    updates.push('prompt');
  } else if (promptArg !== null) {
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

    const legendText = `-# ${PRIVACY_SHIELD.safe} Private ・ ${PRIVACY_SHIELD.warn} Data-retention ・ ${PRIVACY_SHIELD.unsafe} Training`;

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
        const usage = m.limit === 0 ? '∞' : `${Math.max(0, m.limit - m.used)}/${m.limit}`;
        return `${shield}・${e} ${MODELS[m.id].name} \`${usage}\``;
      }).join('\n');

      providerBlocks.push({
        header: `${pEmoji} **${label}**`,
        models: modelLines,
      });
    }

    const BOX_BUDGET = CHARS_BUDGET - 200;
    const pages: V2Component[][] = [];
    let currentPage: V2Component[] = [];
    let currentChars = 0;

    const titleText = t(lang, 'modelsTitle');

    for (const block of providerBlocks) {
      const blockText = `${block.header}\n${block.models}`;
      const blockChars = blockText.length + 4;

      if (currentPage.length === 0) {
        currentPage.push(boxTitle(titleText));
        currentChars = titleText.length;
      }

      if (currentChars + blockChars > BOX_BUDGET && currentPage.length > 1) {
        currentPage.push(separator(), text(legendText));
        pages.push(currentPage);
        currentPage = [boxTitle(titleText)];
        currentChars = titleText.length;
      }

      currentPage.push(separator(), text(blockText));
      currentChars += blockChars;
    }

    if (currentPage.length > 0) {
      currentPage.push(separator(), text(legendText));
      pages.push(currentPage);
    }

    if (pages.length === 0) {
      await editComponents(interaction, [text('No models available.')]);
      return;
    }

    const paginationId = genId();
    modelsPagination.set(paginationId, {
      pages,
      current: 0,
      userId: interaction.user.id,
      lang,
      createdAt: Date.now(),
    });

    const firstPage = [...pages[0]];
    if (pages.length > 1) {
      firstPage.push(actionRow(
        button(`${t(lang, 'modelsPage')} 1/${pages.length}`, 'models_page_info', 2),
        button(t(lang, 'modelsNext'), `models_next:${paginationId}`, 2),
      ));
    }

    await editComponents(interaction, [box(firstPage)]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await editComponents(interaction, [text(t(lang, 'usageError', message))]);
  }
}

export async function handleModelsPrev(interaction: ButtonInteraction): Promise<void> {
  const parts = interaction.customId.split(':');
  const paginationId = parts[1];
  const data = modelsPagination.get(paginationId);
  if (!data || interaction.user.id !== data.userId) {
    await replyComponents(interaction, [text('Not available.')], { ephemeral: true });
    return;
  }

  if (data.current <= 0) {
    await replyComponents(interaction, [], { ephemeral: true });
    return;
  }

  data.current--;
  await updateModelsPage(interaction, data, paginationId);
}

export async function handleModelsNext(interaction: ButtonInteraction): Promise<void> {
  const parts = interaction.customId.split(':');
  const paginationId = parts[1];
  const data = modelsPagination.get(paginationId);
  if (!data || interaction.user.id !== data.userId) {
    await replyComponents(interaction, [text('Not available.')], { ephemeral: true });
    return;
  }

  if (data.current >= data.pages.length - 1) {
    await replyComponents(interaction, [], { ephemeral: true });
    return;
  }

  data.current++;
  await updateModelsPage(interaction, data, paginationId);
}

async function updateModelsPage(
  interaction: ButtonInteraction,
  data: ModelsPagination,
  paginationId: string,
): Promise<void> {
  const page = [...data.pages[data.current]];
  if (data.pages.length > 1) {
    const navButtons: V2Component[] = [];
    if (data.current > 0) {
      navButtons.push(button(t(data.lang, 'modelsPrev'), `models_prev:${paginationId}`, 2));
    }
    navButtons.push(
      button(`${t(data.lang, 'modelsPage')} ${data.current + 1}/${data.pages.length}`, 'models_page_info', 2),
    );
    if (data.current < data.pages.length - 1) {
      navButtons.push(button(t(data.lang, 'modelsNext'), `models_next:${paginationId}`, 2));
    }
    page.push(actionRow(...navButtons));
  }

  await updateComponents(interaction, [box(page)]);
}

async function handleUsage(interaction: ChatInputCommandInteraction): Promise<void> {
  const lang = getLanguage(interaction.user.id);
  const model = getModel(interaction.user.id);
  await deferComponents(interaction, { ephemeral: true });

  try {
    const m = MODELS[model];
    const mu = getModelUsage(model);
    const remaining = mu.limit === 0 ? '∞' : String(Math.max(0, mu.limit - mu.used));
    const usage = mu.limit === 0 ? '∞' : `${Math.max(0, mu.limit - mu.used)}/${mu.limit}`;

    const inner: V2Component[] = [
      boxTitle(t(lang, 'usageTitle')),
      separator(),
      text(`**${m?.name ?? model}**\n\`${model}\``),
      separator(),
      text(`**Daily** \`${usage}\` ・ **${remaining}** ${t(lang, 'usageRemaining')}`),
    ];

    if (m?.provider === 'groq') {
      try {
        const rl = await fetchGroqUsage(model);

        inner.push(separator());
        inner.push(text(
          `## ${t(lang, 'usageLive')} ・ ${m.name}\n` +
          `**${t(lang, 'usageRequestsTag')}** \`${rl.remainingRequests ?? '?'}/${rl.limitRequests ?? '?'}\` ・ ${t(lang, 'usageReset')} ${formatRelativeTime(rl.resetRequests)}\n` +
          `**${t(lang, 'usageTokensTag')}** \`${fmtK(rl.remainingTokens)}/${fmtK(rl.limitTokens)}\` TPM ・ ${t(lang, 'usageReset')} ${formatRelativeTime(rl.resetTokens)}`,
        ));
      } catch {
        inner.push(separator());
        inner.push(text(t(lang, 'usageProviderLimits', PROVIDER_LABEL['groq'] ?? 'Groq')));
      }
    } else if (m?.provider === 'google') {
      const goog = getObservedLimits(model);
      if (goog?.limitRequests || goog?.limitTokens) {
        inner.push(
          separator(),
          text(
            `## ${t(lang, 'usageLive')} ・ ${m.name}\n` +
            (goog.limitRequests !== null
              ? `**${t(lang, 'usageRequestsTag')}** \`${goog.remainingRequests ?? '?'}/${goog.limitRequests}\`\n`
              : '') +
            `**${t(lang, 'usageTokensTag')}** \`${fmtK(goog.remainingTokens)}/${fmtK(goog.limitTokens)}\` TPM`,
          ),
        );
      }
    } else {
      inner.push(separator());
      inner.push(text(t(lang, 'usageProviderLimits', PROVIDER_LABEL[m?.provider ?? 'opencode'] ?? m?.provider ?? 'Unknown')));
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
  await replyComponents(
    interaction,
    [box([boxTitle(t(lang, 'h1Clear')), separator(), text(t(lang, 'clearBody'))])],
    { ephemeral: true },
  );
}

async function handleReset(interaction: ChatInputCommandInteraction): Promise<void> {
  const lang = getLanguage(interaction.user.id);
  resetUser(interaction.user.id);
  const model = getModel(interaction.user.id);
  const prompt = getPrompt(interaction.user.id);
  const promptDisplay = prompt || t(lang, 'noPrompt');
  await replyComponents(
    interaction,
    [box([boxTitle(t(lang, 'h1Reset')), separator(), text(t(lang, 'resetBody', model, promptDisplay, languageLabel(lang)))])],
    { ephemeral: true },
  );
}

async function handleMemory(interaction: ChatInputCommandInteraction): Promise<void> {
  const lang = getLanguage(interaction.user.id);
  const info = getMemoryInfo(interaction.user.id);
  const components: V2Component[] = [boxTitle(t(lang, 'memoryTitle'))];

  if (info.facts.length === 0 && info.summaries.length === 0) {
    components.push(separator(), text(t(lang, 'memoryEmpty')));
  } else {
    if (info.facts.length > 0) {
      components.push(separator(), text(`**${t(lang, 'memoryFacts')}**\n${info.facts.map(f => `- ${f}`).join('\n')}`));
    }
    if (info.summaries.length > 0) {
      components.push(separator(), text(`**${t(lang, 'memorySummaries')}**\n${info.summaries.map(s => `- ${s}`).join('\n')}`));
    }
  }

  await replyComponents(interaction, [box(components)], { ephemeral: true });
}
