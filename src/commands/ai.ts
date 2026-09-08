import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
} from 'discord.js';
import {
  MODELS,
  CHAT_MODEL_IDS,
  formatLimits,
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
import { ask } from '../groq.js';

const MODEL_CHOICES = CHAT_MODEL_IDS.map((id) => ({ name: MODELS[id].name, value: id }));

// Cooldown por usuario para no castigar el rate limit del free tier (30 RPM global).
const COOLDOWN_MS = Math.max(0, parseInt(process.env.COOLDOWN_SECONDS ?? '3', 10) || 0) * 1000;
const lastAsk = new Map<string, number>();

export const aiCommand = {
  data: new SlashCommandBuilder()
    .setName('ai')
    .setDescription('SharkAI: pregunta a Groq o configura tu bot')
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
      case 'reset':
        await handleReset(interaction);
        break;
      case 'status':
        await handleStatus(interaction);
        break;
      default:
        await interaction.reply({ content: 'Subcomando desconocido', ephemeral: true });
    }
  },
};

async function handleAsk(interaction: ChatInputCommandInteraction): Promise<void> {
  const question = interaction.options.getString('message', true);
  const overrideModel = interaction.options.getString('model');
  const visible = interaction.options.getBoolean('visible') ?? true;

  // Cooldown por usuario
  const now = Date.now();
  const last = lastAsk.get(interaction.user.id) ?? 0;
  const waitMs = COOLDOWN_MS - (now - last);
  if (waitMs > 0) {
    await interaction.reply({
      content: `⏳ Espera ${Math.ceil(waitMs / 1000)}s entre preguntas.`,
      ephemeral: true,
    });
    return;
  }
  lastAsk.set(interaction.user.id, now);

  await interaction.deferReply({ ephemeral: !visible });

  try {
    const result = await ask(question, overrideModel, interaction.user.id);

    const embed = new EmbedBuilder()
      .setColor(0x00d4ff)
      .setTitle('🤖 SharkAI')
      .setDescription(result.text)
      .setFooter({ text: `Modelo: ${result.model} · ${result.usage.totalTokens} tokens` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await interaction.editReply({ content: `❌ Error al consultar Groq: ${message}` });
  }
}

async function handleModel(interaction: ChatInputCommandInteraction): Promise<void> {
  const model = interaction.options.getString('model');
  const showInfo = interaction.options.getBoolean('info') ?? true;

  if (model) {
    if (!MODELS[model]) {
      await interaction.reply({ content: `❌ Modelo no válido: \`${model}\``, ephemeral: true });
      return;
    }
    setModel(interaction.user.id, model);

    const embed = new EmbedBuilder()
      .setColor(0x00d4ff)
      .setTitle('✅ Modelo por defecto actualizado')
      .setDescription(`Tu modelo ahora es **${MODELS[model].name}** (\`${model}\`)`)
      .setFooter({ text: 'Usa /ai ask para preguntar' });

    if (showInfo) embed.addFields({ name: 'Información', value: formatLimits(MODELS[model]) });
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  // Sin argumento: ver el actual
  const current = getModel(interaction.user.id);
  const embed = new EmbedBuilder()
    .setColor(0x00d4ff)
    .setTitle('📌 Tu modelo por defecto')
    .setDescription(`**${MODELS[current]?.name ?? current}** (\`${current}\`)`);

  if (showInfo) embed.addFields({ name: 'Información', value: formatLimits(MODELS[current]) });
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handlePrompt(interaction: ChatInputCommandInteraction): Promise<void> {
  const text = interaction.options.getString('text');
  const clear = interaction.options.getBoolean('clear') ?? false;

  if (clear) {
    setPrompt(interaction.user.id, '');
    await interaction.reply({
      content: '🔄 Prompt restablecido al por defecto.',
      ephemeral: true,
    });
    return;
  }

  if (text) {
    setPrompt(interaction.user.id, text);
    await interaction.reply({
      content: '✅ Prompt personalizado guardado.\n\n```\n' + text + '\n```',
      ephemeral: true,
    });
    return;
  }

  // Sin args: mostrar el actual
  const current = getPrompt(interaction.user.id);
  await interaction.reply({
    content: current
      ? `📝 Tu prompt actual:\n\n\`\`\`\n${current}\n\`\`\`\n\nUsa \`/ai prompt text:...\` para cambiarlo o \`/ai prompt clear:true\` para resetear.`
      : '📝 No tienes prompt personalizado — se usa el por defecto.',
    ephemeral: true,
  });
}

async function handleLanguage(interaction: ChatInputCommandInteraction): Promise<void> {
  const lang = interaction.options.getString('language', true) as Language;
  if (!LANGUAGE_CHOICES.some((c) => c.value === lang)) {
    await interaction.reply({ content: '❌ Idioma no válido.', ephemeral: true });
    return;
  }
  setLanguage(interaction.user.id, lang);
  await interaction.reply({
    content: `✅ Idioma configurado: **${languageLabel(lang)}**${
      lang === 'es' ? ' 🇪🇸' : ' 🇬🇧'
    }`,
    ephemeral: true,
  });
}

async function handleReset(interaction: ChatInputCommandInteraction): Promise<void> {
  resetUser(interaction.user.id);
  await interaction.reply({
    content: `♻️ Tus ajustes se reiniciaron:\n• Modelo: **${MODELS[DEFAULT_MODEL].name}**\n• Prompt: por defecto\n• Idioma: **Español**`,
    ephemeral: true,
  });
}

async function handleStatus(interaction: ChatInputCommandInteraction): Promise<void> {
  const model = getModel(interaction.user.id);
  const prompt = getPrompt(interaction.user.id);
  const lang = getLanguage(interaction.user.id);

  const embed = new EmbedBuilder()
    .setColor(0x00d4ff)
    .setTitle('🦈 Tu configuración de SharkAI')
    .addFields(
      { name: '🤖 Modelo', value: `**${MODELS[model]?.name ?? model}** (\`${model}\`)`, inline: true },
      { name: '🌐 Idioma', value: languageLabel(lang), inline: true },
      { name: '📝 Prompt', value: prompt ? `\`\`\`${prompt.slice(0, 300)}${prompt.length > 300 ? '…' : ''}\`\`\`` : '*(por defecto)*' }
    )
    .setFooter({ text: 'Usa /ai model, /ai prompt, /ai language, /ai reset' })
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}