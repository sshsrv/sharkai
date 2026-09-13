import { Client, GatewayIntentBits, Events, ActivityType, type PresenceStatusData, type ActivitiesOptions } from 'discord.js';
import {
  env,
  PRESENCE_STATUS,
  PRESENCE_STREAMING_URL,
  PRESENCE_CUSTOM_STATUSES,
  PRESENCE_ROTATION_SECONDS,
  WHITELIST_USER_IDS,
} from './config.js';
import { shCommand, handleModelsPrev, handleModelsNext } from './commands/ai.js';
import {
  factCheckCommand,
  replyMessageCommand,
  summarizeCommand,
  explainCommand,
  handleFactCheck,
  handleReplyMessage,
  handleSummarize,
  handleExplain,
  handleMakeVisible,
  handleCopy,
  handleRegen,
  showAskModal,
  handleAskModal,
  showAddContextModal,
  handleContextModal,
} from './commands/apps.js';

if (!env.discordToken) {
  console.error('❌ Falta DISCORD_TOKEN en el entorno');
  process.exit(1);
}
if (!env.groqApiKey) {
  console.error('❌ Falta GROQ_API_KEY en el entorno');
  process.exit(1);
}
if (!env.googleApiKey) {
  console.warn('⚠️ GOOGLE_API_KEY no configurada — los modelos de Google fallarán hasta añadirla al .env');
}
if (!env.openrouterApiKey) {
  console.warn('⚠️ OPENROUTER_API_KEY no configurada — los modelos de OpenRouter no funcionarán');
}
if (!env.mistralApiKey) {
  console.warn('⚠️ MISTRAL_API_KEY no configurada — los modelos de Mistral no funcionarán');
}
if (!env.opencodeApiKey) {
  console.warn('⚠️ OPENCODE_API_KEY no configurada — los modelos de OpenCode no funcionarán');
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages],
});

client.once(Events.ClientReady, async (c) => {
  console.log(`✅ SharkAI logueado como ${c.user.tag}`);
  try {
    await c.application?.commands.set([
      shCommand.data.toJSON(),
      factCheckCommand.toJSON(),
      replyMessageCommand.toJSON(),
      summarizeCommand.toJSON(),
      explainCommand.toJSON(),
    ]);
    console.log('✅ Comandos registrados: /sh, Fact-Check, Ask, Summarize, Explain');
    const appId = c.user.id;
    console.log(
      `🔗 Instala la app: https://discord.com/oauth2/authorize?client_id=${appId}&integration_type=1&scope=applications.commands`,
    );
  } catch (err) {
    console.error('⚠️ No se pudieron registrar comandos:', err instanceof Error ? err.message : err);
  }

  const statusMap: Record<string, PresenceStatusData> = {
    online: 'online',
    idle: 'idle',
    dnd: 'dnd',
    invisible: 'invisible',
    streaming: 'online',
  };

  const baseStatus: PresenceStatusData = statusMap[PRESENCE_STATUS] ?? 'online';
  const statuses: ActivitiesOptions[] = PRESENCE_CUSTOM_STATUSES.length > 0
    ? PRESENCE_CUSTOM_STATUSES.map(s => ({ name: 'Custom Status', type: ActivityType.Custom, state: s }))
    : [{ name: 'Custom Status', type: ActivityType.Custom, state: 'SharkAI 🦈' }];

  if (PRESENCE_STATUS === 'streaming' && PRESENCE_STREAMING_URL) {
    statuses.unshift({ name: 'SharkAI', type: ActivityType.Streaming, url: PRESENCE_STREAMING_URL });
  }

  let statusIndex = 0;

  const applyPresence = () => {
    c.user.setPresence({
      activities: [statuses[statusIndex % statuses.length]],
      status: baseStatus,
    });
    statusIndex++;
  };

  applyPresence();

  if (statuses.length > 1 && PRESENCE_ROTATION_SECONDS > 0) {
    setInterval(applyPresence, PRESENCE_ROTATION_SECONDS * 1000).unref();
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (WHITELIST_USER_IDS.length > 0 && !WHITELIST_USER_IDS.includes(interaction.user.id)) {
    if (interaction.isAutocomplete()) {
      await interaction.respond([]);
    } else {
      await interaction.reply({ content: 'You are not authorized to use this bot.', ephemeral: true });
    }
    return;
  }

  if (interaction.isAutocomplete()) {
    if (interaction.commandName === 'sh') {
      await shCommand.execute(interaction);
    }
    return;
  }
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'sh') {
      await shCommand.execute(interaction);
    }
    return;
  }
  if (interaction.isMessageContextMenuCommand()) {
    if (interaction.commandName === 'Fact-Check') {
      await handleFactCheck(interaction);
    } else if (interaction.commandName === 'Ask') {
      await handleReplyMessage(interaction);
    } else if (interaction.commandName === 'Summarize') {
      await handleSummarize(interaction);
    } else if (interaction.commandName === 'Explain') {
      await handleExplain(interaction);
    }
    return;
  }
  if (interaction.isButton() && interaction.customId.startsWith('make_visible:')) {
    await handleMakeVisible(interaction);
    return;
  }
  if (interaction.isButton() && interaction.customId.startsWith('add_context:')) {
    await showAddContextModal(interaction);
    return;
  }
  if (interaction.isButton() && interaction.customId.startsWith('ask:')) {
    await showAskModal(interaction);
    return;
  }
  if (interaction.isButton() && interaction.customId.startsWith('copy:')) {
    await handleCopy(interaction);
    return;
  }
  if (interaction.isButton() && interaction.customId.startsWith('regen:')) {
    await handleRegen(interaction);
    return;
  }
  if (interaction.isButton() && interaction.customId.startsWith('models_prev:')) {
    await handleModelsPrev(interaction);
    return;
  }
  if (interaction.isButton() && interaction.customId.startsWith('models_next:')) {
    await handleModelsNext(interaction);
    return;
  }
  if (interaction.isButton() && interaction.customId === 'models_page_info') {
    await interaction.deferUpdate();
    return;
  }
  if (interaction.isModalSubmit() && interaction.customId.startsWith('context_modal:')) {
    await handleContextModal(interaction);
    return;
  }
  if (interaction.isModalSubmit() && interaction.customId.startsWith('ask_modal:')) {
    await handleAskModal(interaction);
    return;
  }
});

client.login(env.discordToken).catch((err: unknown) => {
  console.error('❌ Error al iniciar sesión:', err instanceof Error ? err.message : err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('⚠️ unhandledRejection:', reason instanceof Error ? reason.message : reason);
});
process.on('uncaughtException', (err) => {
  console.error('⚠️ uncaughtException:', err.message);
});

process.on('SIGINT', async () => {
  console.log('🛑 SIGINT received, shutting down...');
  client.destroy();
  process.exit(0);
});
process.on('SIGTERM', async () => {
  console.log('🛑 SIGTERM received, shutting down...');
  client.destroy();
  process.exit(0);
});
