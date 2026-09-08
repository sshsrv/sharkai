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
} from '../config.js';
import {
  getModel,
  setModel,
  getPrompt,
  setPrompt,
  getLanguage,
  setLanguage,
  resetUser,
} from '../store.js';
import { ask, fetchUsage, RateLimits } from '../groq.js';
import {
  V2Component,
  replyComponents,
  deferComponents,
  editComponents,
  text,
  separator,
  totalChars,
} from '../components.js';

const MODEL_CHOICES = CHAT_MODEL_IDS.map((id) => ({ name: MODELS[id].name, value: id }));

// Emoji de modelo (custom emojis — el usuario los provee). Solo en el footer del /sh ask.
const MODEL_EMOJI: Record<string, string> = {
  'openai/gpt-oss-120b': '<:gpt:1546977679461449839>',
  'openai/gpt-oss-20b': '<:gpt:1546977679461449839>',
  'openai/gpt-oss-safeguard-20b': '<:gpt:1546977679461449839>',
  'qwen/qwen3.6-27b': '<:qwen:1546977696792318022>',
  'qwen/qwen3.8-27b': '<:qwen:1546977696792318022>',
};

// Cooldown por usuario para no castigar el rate limit del free tier (30 RPM global).
const COOLDOWN_MS = Math.max(0, parseInt(process.env.COOLDOWN_SECONDS ?? '3', 10) || 0) * 1000;
const lastAsk = new Map<string, number>();

// Máximo de caracteres combinados de texto en components (límite API: 4000).
const CHARS_BUDGET = 4000;

export const shCommand = {
  data: new SlashCommandBuilder()
    .setName('sh')
    .setDescription('SharkAI: pregunta a Groq o configura tu bot')
    // App instalable por USUARIO (0=server install, 1=user install)
    .setIntegrationTypes([ApplicationIntegrationType.UserInstall])
    .setContexts([InteractionContextType.BotDM, InteractionContextType.PrivateChannel])
    .addSubcommand((s) =>
      s
        .setName('ask')
        .setDescription('Pregunta algo a Groq usando tu modelo por defecto')
        .addStringOption((o) =>
          o
            .setName('message')
            .setDescription('Lo que quieras preguntar')
            .setRequired(true)
        )
        .addStringOption((o) =>
          o
            .setName('model')
            .setDescription('Override one-time de modelo para esta pregunta')
            .addChoices(...MODEL_CHOICES)
        )
        .addBooleanOption((o) =>
          o
            .setName('visible')
            .setDescription('True = visible para todos (default). False = solo tú (ephemeral)')
        )
    )
    .addSubcommand((s) =>
      s
        .setName('model')
        .setDescription('Ver o cambiar tu modelo por defecto')
        .addStringOption((o) =>
          o
            .setName('model')
            .setDescription('Modelo (si no lo pones, muestra el actual)')
            .addChoices(...MODEL_CHOICES)
        )
        .addBooleanOption((o) =>
          o
            .setName('info')
            .setDescription('Mostrar límites del modelo (default: true)')
        )
    )
    .addSubcommand((s) =>
      s
        .setName('prompt')
        .setDescription('Ver o cambiar tu system prompt (contexto del bot)')
        .addStringOption((o) =>
          o
            .setName('text')
            .setDescription('Nuevo prompt personalizado (se usa en lugar del default)')
        )
        .addBooleanOption((o) =>
          o
            .setName('clear')
            .setDescription('Volver al prompt por defecto')
        )
    )
    .addSubcommand((s) =>
      s
        .setName('language')
        .setDescription('Idioma de tus respuestas')
        .addStringOption((o) =>
          o
            .setName('language')
            .setDescription('Idioma')
            .setRequired(true)
            .addChoices(...LANGUAGE_CHOICES)
        )
    )
    .addSubcommand((s) =>
      s
        .setName('usage')
        .setDescription('Muestra los límites de Groq que te quedan (TPM/RPM)')
    )
    .addSubcommand((s) =>
      s
        .setName('reset')
        .setDescription('Reinicia TODOS tus ajustes (modelo, prompt, idioma)')
    )
    .addSubcommand((s) =>
      s
        .setName('status')
        .setDescription('Muestra tu configuración actual')
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
      case 'reset':
        await handleReset(interaction);
        break;
      case 'status':
        await handleStatus(interaction);
        break;
      default:
        await replyComponents(interaction, [text('Subcomando desconocido')], { ephemeral: true });
    }
  },
};

/** Formatea TPM en notación compacta: 8100 -> 8.1K */
function fmtK(n: number | null | undefined): string {
  if (n === null || n === undefined) return '?';
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(n);
}

/** Segundos restantes hasta reset de un límite dado en epoch ms. */
function secsToReset(epochMs: number | null): string {
  if (epochMs === null || epochMs === undefined) return '?';
  const s = Math.ceil((epochMs - Date.now()) / 1000);
  return s > 0 ? `${s}s` : 'ahora';
}

/** Footer estilo heist.lol: emoji de modelo, límites reales, disclaimer. */
function footer(emoji: string | undefined, model: string, r: RateLimits): string {
  const emojiPart = emoji ? `${emoji} ` : '';
  const rpm = `${r.remainingRequests ?? '?'}/${r.limitRequests ?? '?'} RPM`;
  const tpm = `${fmtK(r.remainingTokens)}/${fmtK(r.limitTokens)} TPM`;
  return `-# ${emojiPart}${model} · ${rpm} · ${tpm} · Results are AI generated`;
}

async function handleAsk(interaction: ChatInputCommandInteraction): Promise<void> {
  const question = interaction.options.getString('message', true);
  const overrideModel = interaction.options.getString('model');
  const visible = interaction.options.getBoolean('visible') ?? true;

  // Cooldown por usuario
  const now = Date.now();
  const last = lastAsk.get(interaction.user.id) ?? 0;
  const waitMs = COOLDOWN_MS - (now - last);
  if (waitMs > 0) {
    await replyComponents(interaction, [text(`⏳ Espera ${Math.ceil(waitMs / 1000)}s entre preguntas.`)], {
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

    // Respuesta truncada para no romper el presupuesto de 4000 chars.
    const answerMax = CHARS_BUDGET - question.length - 260;
    const answerText =
      result.text.length > answerMax ? `${result.text.slice(0, answerMax - 1)}…` : result.text;

    const components: V2Component[] = [
      text(`**${question}**`),
      separator(),
      text(answerText),
      separator(),
      text(footer(emoji, model, result.rateLimits)),
    ];

    await editComponents(interaction, components);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await editComponents(interaction, [text(`❌ Error al consultar Groq: ${message}`)]);
  }
}

async function handleModel(interaction: ChatInputCommandInteraction): Promise<void> {
  const model = interaction.options.getString('model');
  const showInfo = interaction.options.getBoolean('info') ?? true;

  if (model) {
    if (!MODELS[model]) {
      await replyComponents(interaction, [text(`Modelo no válido: \`${model}\``)], { ephemeral: true });
      return;
    }
    setModel(interaction.user.id, model);

    const components: V2Component[] = [
      text(`**Modelo por defecto actualizado**\n${MODELS[model].name} (\`${model}\`)`),
    ];
    if (showInfo) {
      components.push(separator(), text(formatLimits(MODELS[model])));
    }
    await replyComponents(interaction, components, { ephemeral: true });
    return;
  }

  // Sin argumento: ver el actual
  const current = getModel(interaction.user.id);
  const components: V2Component[] = [
    text(`**Tu modelo por defecto**\n${MODELS[current]?.name ?? current} (\`${current}\`)`),
  ];
  if (showInfo) {
    components.push(separator(), text(formatLimits(MODELS[current])));
  }
  await replyComponents(interaction, components, { ephemeral: true });
}

function formatLimits(m: (typeof MODELS)[string]): string {
  return `${m.description}\nContexto: \`${m.context.toLocaleString()}\` tokens\nLímites (plan gratuito): \`${m.tpm.toLocaleString()}\` TPM · \`${m.rpm}\` RPM · \`${m.rpd.toLocaleString()}\` RPD`;
}

async function handlePrompt(interaction: ChatInputCommandInteraction): Promise<void> {
  const textArg = interaction.options.getString('text');
  const clear = interaction.options.getBoolean('clear') ?? false;

  if (clear) {
    setPrompt(interaction.user.id, '');
    await replyComponents(interaction, [text('**Prompt restablecido**\nVuelve al prompt por defecto.')], {
      ephemeral: true,
    });
    return;
  }

  if (textArg) {
    setPrompt(interaction.user.id, textArg);
    await replyComponents(interaction, [text(`**Prompt personalizado guardado**\n\`\`\`\n${textArg}\n\`\`\``)], {
      ephemeral: true,
    });
    return;
  }

  // Sin args: mostrar el actual
  const current = getPrompt(interaction.user.id);
  const content = current
    ? `**Tu prompt actual**\n\`\`\`\n${current.slice(0, 3500)}\n\`\`\`\n\nUsa \`/sh prompt text:...\` para cambiarlo o \`/sh prompt clear:true\` para resetear.`
    : 'No tienes prompt personalizado — se usa el por defecto.';
  await replyComponents(interaction, [text(content)], { ephemeral: true });
}

async function handleLanguage(interaction: ChatInputCommandInteraction): Promise<void> {
  const lang = interaction.options.getString('language', true) as Language;
  if (!LANGUAGE_CHOICES.some((c) => c.value === lang)) {
    await replyComponents(interaction, [text('Idioma no válido.')], { ephemeral: true });
    return;
  }
  setLanguage(interaction.user.id, lang);
  await replyComponents(interaction, [text(`**Idioma configurado**\n${languageLabel(lang)}`)], {
    ephemeral: true,
  });
}

async function handleUsage(interaction: ChatInputCommandInteraction): Promise<void> {
  const model = getModel(interaction.user.id);
  await deferComponents(interaction, { ephemeral: true });

  try {
    const rl = await fetchUsage(model);
    const components: V2Component[] = [
      text(`**Límites de Groq ahora mismo**\nModelo: ${MODELS[model]?.name ?? model} (\`${model}\`)`),
      separator(),
      text(
        `• Requests: \`${rl.remainingRequests ?? '?'}/${rl.limitRequests ?? '?'}\` RPM restantes\n` +
          `• Tokens: \`${fmtK(rl.remainingTokens)}/${fmtK(rl.limitTokens)}\` TPM restantes\n` +
          `• Reset de requests en \`${secsToReset(rl.resetRequests)}\`\n` +
          `• Reset de tokens en \`${secsToReset(rl.resetTokens)}\``
      ),
    ];
    await editComponents(interaction, components);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await editComponents(interaction, [text(`No pude consultar los límites: ${message}`)]);
  }
}

async function handleReset(interaction: ChatInputCommandInteraction): Promise<void> {
  resetUser(interaction.user.id);
  await replyComponents(
    interaction,
    [
      text(
        `**Ajustes reiniciados**\n• Modelo: ${MODELS[DEFAULT_MODEL].name}\n• Prompt: por defecto\n• Idioma: Español`
      ),
    ],
    { ephemeral: true }
  );
}

async function handleStatus(interaction: ChatInputCommandInteraction): Promise<void> {
  const model = getModel(interaction.user.id);
  const prompt = getPrompt(interaction.user.id);
  const lang = getLanguage(interaction.user.id);

  const components: V2Component[] = [
    text('**Tu configuración de SharkAI**'),
    separator(),
    text(
      `• Modelo: ${MODELS[model]?.name ?? model} (\`${model}\`)\n` +
        `• Idioma: ${languageLabel(lang)}\n` +
        `• Prompt: ${prompt ? `\`\`\`\n${prompt.slice(0, 1500)}\n\`\`\`` : '(por defecto)'}`
    ),
  ];

  await replyComponents(interaction, components, { ephemeral: true });
}