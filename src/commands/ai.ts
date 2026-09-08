import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  ApplicationIntegrationType,
  InteractionContextType,
} from 'discord.js';
import {
  MODELS,
  CHAT_MODEL_IDS,
  DEFAULT_MODEL,
  Language,
  LANGUAGE_CHOICES,
  languageLabel,
  formatLimits,
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
import { ask, fetchUsage, RateLimits } from '../groq.js';
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

const MODEL_CHOICES = CHAT_MODEL_IDS.map((id) => ({ name: MODELS[id].name, value: id }));

// Emoji de modelo (custom emojis del usuario). Solo en el footer del /sh ask.
const MODEL_EMOJI: Record<string, string> = {
  'openai/gpt-oss-120b': '<:gpt:1546977679461449839>',
  'openai/gpt-oss-20b': '<:gpt:1546977679461449839>',
  'openai/gpt-oss-safeguard-20b': '<:gpt:1546977679461449839>',
  'qwen/qwen3.6-27b': '<:qwen:1546977696792318022>',
  'qwen/qwen3.8-27b': '<:qwen:1546977696792318022>',
};

// Cooldown por usuario para no castigar el rate limit del free tier.
const COOLDOWN_MS = Math.max(0, parseInt(process.env.COOLDOWN_SECONDS ?? '3', 10) || 0) * 1000;
const lastAsk = new Map<string, number>();

// Presupuesto de texto en components (límite API: 4000 chars combinados).
const CHARS_BUDGET = 4000;

/** Fondo neutro (gris oscuro de Discord) para los contenedores. Sin colores llamativos. */
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

/** Formatea TPM en notación compacta: 8100 -> 7.8K */
function fmtK(n: number | null | undefined): string {
  if (n === null || n === undefined) return '?';
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(n);
}

/** Footer estilo heist.lol: emoji de modelo + límite diario restante. */
function footer(emoji: string | undefined, model: string, r: RateLimits): string {
  const e = emoji ? `${emoji} ` : '';
  const daily = `${r.remainingRequests ?? '?'}/${r.limitRequests ?? '?'} daily`;
  return `-# ${e}${model}・${daily}・Results are AI generated`;
}

export const shCommand = {
  data: new SlashCommandBuilder()
    .setName('sh')
    .setDescription('SharkAI: ask Groq or configure your bot')
    // App instalable por USUARIO (0=server install, 1=user install)
    .setIntegrationTypes([ApplicationIntegrationType.UserInstall])
    .setContexts([InteractionContextType.BotDM, InteractionContextType.PrivateChannel])
    .addSubcommand((s) =>
      s
        .setName('ask')
        .setDescription('Ask something to Groq using your default model')
        .addStringOption((o) =>
          o
            .setName('message')
            .setDescription('What you want to ask')
            .setRequired(true)
        )
        .addStringOption((o) =>
          o
            .setName('model')
            .setDescription('One-time model override for this question')
            .addChoices(...MODEL_CHOICES)
        )
        .addBooleanOption((o) =>
          o
            .setName('visible')
            .setDescription('True = visible for everyone (default). False = only you (ephemeral)')
        )
    )
    .addSubcommand((s) =>
      s
        .setName('model')
        .setDescription('View or change your default model')
        .addStringOption((o) =>
          o
            .setName('model')
            .setDescription('Model (omitting shows the current one)')
            .addChoices(...MODEL_CHOICES)
        )
        .addBooleanOption((o) =>
          o
            .setName('info')
            .setDescription('Show model limits (default: true)')
        )
    )
    .addSubcommand((s) =>
      s
        .setName('prompt')
        .setDescription('View or change your custom system prompt')
        .addStringOption((o) =>
          o
            .setName('text')
            .setDescription('New custom prompt (used instead of the default)')
        )
        .addBooleanOption((o) =>
          o
            .setName('clear')
            .setDescription('Go back to the default prompt')
        )
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
            .addChoices(...LANGUAGE_CHOICES)
        )
    )
    .addSubcommand((s) =>
      s
        .setName('usage')
        .setDescription('Show your current Groq limits (TPM/RPM)')
    )
    .addSubcommand((s) =>
      s
        .setName('new')
        .setDescription('Start a new conversation (clear chat context)')
    )
    .addSubcommand((s) =>
      s
        .setName('reset')
        .setDescription('Reset all your settings (model, prompt, language)')
    )
    .addSubcommand((s) =>
      s
        .setName('status')
        .setDescription('Show your current configuration')
    ),

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
      case 'reset':
        await handleReset(interaction);
        break;
      case 'status':
        await handleStatus(interaction);
        break;
      default:
        await replyComponents(interaction, [text(t(getLanguage(interaction.user.id), 'unknownSub'))], {
          ephemeral: true,
        });
    }
  },
};

async function handleAsk(interaction: ChatInputCommandInteraction): Promise<void> {
  const lang = getLanguage(interaction.user.id);
  const question = interaction.options.getString('message', true);
  const overrideModel = interaction.options.getString('model');
  const visible = interaction.options.getBoolean('visible') ?? true;

  // Cooldown por usuario
  const now = Date.now();
  const last = lastAsk.get(interaction.user.id) ?? 0;
  const waitMs = COOLDOWN_MS - (now - last);
  if (waitMs > 0) {
    await replyComponents(interaction, [text(t(lang, 'cooldown', String(Math.ceil(waitMs / 1000))))], {
      ephemeral: true,
    });
    return;
  }
  lastAsk.set(interaction.user.id, now);

  await deferComponents(interaction, { ephemeral: !visible });

  try {
    const result = await ask(question, overrideModel, interaction.user.id);
    const model = result.model;
    const emoji = MODEL_EMOJI[model];

    // Guardar en la ventana de contexto (se poda a HISTORY_LIMIT automáticamente).
    appendHistory(interaction.user.id, 'user', question);
    appendHistory(interaction.user.id, 'assistant', result.text);

    // Respuesta truncada para no romper el presupuesto de 4000 chars.
    const answerMax = CHARS_BUDGET - 200;
    const answerText =
      result.text.length > answerMax ? result.text.slice(0, answerMax - 1) + t(lang, 'answerTruncated') : result.text;

    // Respuesta -> separador -> footer pequeño. Sin título.
    const components: V2Component[] = [
      text(answerText),
      separator(),
      text(footer(emoji, model, result.rateLimits)),
    ];

    try {
      await editComponents(interaction, components);
    } catch {
      // Si el footer con emojis custom falla (no disponibles), reintentar sin él.
      await editComponents(interaction, [text(answerText)]);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await editComponents(interaction, [text(t(lang, 'error', message))]);
    } catch {
      console.error('editComponents de error falló', message);
    }
  }
}

async function handleModel(interaction: ChatInputCommandInteraction): Promise<void> {
  const lang = getLanguage(interaction.user.id);
  const model = interaction.options.getString('model');
  const showInfo = interaction.options.getBoolean('info') ?? true;

  if (model) {
    if (!MODELS[model]) {
      await replyComponents(interaction, [text(t(lang, 'invalidModel', model))], { ephemeral: true });
      return;
    }
    setModel(interaction.user.id, model);

    const components: V2Component[] = [
      box([
        boxTitle(t(lang, 'modelUpdated', `${MODELS[model].name} (\`${model}\`)`)),
        ...(showInfo ? [separator(), text(formatLimits(MODELS[model]))] : []),
      ]),
    ];
    await replyComponents(interaction, components, { ephemeral: true });
    return;
  }

  // Sin argumento: ver el actual
  const current = getModel(interaction.user.id);
  const components: V2Component[] = [
    box([
      boxTitle(t(lang, 'modelCurrent', `${MODELS[current]?.name ?? current} (\`${current}\`)`)),
      ...(showInfo ? [separator(), text(formatLimits(MODELS[current]))] : []),
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
    await replyComponents(
      interaction,
      [box([boxTitle(t(lang, 'promptCleared'))])],
      { ephemeral: true }
    );
    return;
  }

  if (textArg) {
    setPrompt(interaction.user.id, textArg);
    await replyComponents(
      interaction,
      [box([boxTitle(t(lang, 'promptUpdated', textArg))])],
      { ephemeral: true }
    );
    return;
  }

  // Sin args: mostrar el actual
  const current = getPrompt(interaction.user.id);
  if (current) {
    await replyComponents(
      interaction,
      [
        box([boxTitle(t(lang, 'promptCurrent', current))]),
        separator(),
        hint(t(lang, 'promptHint')),
      ],
      { ephemeral: true }
    );
  } else {
    await replyComponents(
      interaction,
      [box([boxTitle(t(lang, 'promptEmpty'))])],
      { ephemeral: true }
    );
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
  await replyComponents(interaction, [box([boxTitle(t(lang, 'languageSet', languageLabel(lang)))])], {
    ephemeral: true,
  });
}

async function handleUsage(interaction: ChatInputCommandInteraction): Promise<void> {
  const lang = getLanguage(interaction.user.id);
  const model = getModel(interaction.user.id);
  await deferComponents(interaction, { ephemeral: true });

  try {
    const rl = await fetchUsage(model);
    const resetRequests = rl.resetRequests ? `\`${rl.resetRequests}\`` : '?';
    const resetTokens = rl.resetTokens ? `\`${rl.resetTokens}\`` : '?';
    const components: V2Component[] = [
      box([
        boxTitle(t(lang, 'usageTitle', `${MODELS[model]?.name ?? model} (\`${model}\`)`)),
        separator(),
        text(
          `## ${t(lang, 'usageRequests')}\n\`${rl.remainingRequests ?? '?'}/${rl.limitRequests ?? '?'}\` · ${t(lang, 'usageReset')} ${resetRequests}`
        ),
        separator(),
        text(
          `## ${t(lang, 'usageTokens')}\n\`${fmtK(rl.remainingTokens)}/${fmtK(rl.limitTokens)}\` TPM · ${t(lang, 'usageReset')} ${resetTokens}`
        ),
      ]),
    ];
    await editComponents(interaction, components);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await editComponents(interaction, [text(t(lang, 'usageError', message))]);
  }
}

async function handleReset(interaction: ChatInputCommandInteraction): Promise<void> {
  const lang = getLanguage(interaction.user.id);
  resetUser(interaction.user.id);
  await replyComponents(
    interaction,
    [
      box([
        boxTitle(t(lang, 'resetTitle')),
        separator(),
        text(t(lang, 'resetBody', MODELS[DEFAULT_MODEL].name, languageLabel(lang))),
      ]),
    ],
    { ephemeral: true }
  );
}

async function handleNew(interaction: ChatInputCommandInteraction): Promise<void> {
  const lang = getLanguage(interaction.user.id);
  clearHistory(interaction.user.id);
  await replyComponents(
    interaction,
    [box([boxTitle(t(lang, 'h1New'))])],
    { ephemeral: true }
  );
}

async function handleStatus(interaction: ChatInputCommandInteraction): Promise<void> {
  const lang = getLanguage(interaction.user.id);
  const model = getModel(interaction.user.id);
  const prompt = getPrompt(interaction.user.id);
  const language = getLanguage(interaction.user.id);

  const components: V2Component[] = [
    box([
      boxTitle(t(lang, 'statusTitle')),
      separator(),
      text(
        `## ${t(lang, 'statusModel')} · ${MODELS[model]?.name ?? model} (\`${model}\`)\n` +
          `## ${t(lang, 'statusLanguage')} · ${languageLabel(language)}\n` +
          `## ${t(lang, 'statusPrompt')} · ${prompt ? `${prompt.slice(0, 500)}` : t(lang, 'noPrompt')}\n` +
          `## ${t(lang, 'statusContext')} · ${getHistory(interaction.user.id).length} ${t(lang, 'statusContextMsgs')}`
      )
    ]),
  ];
}