import { Client, GatewayIntentBits, Events, ActivityType, type PresenceStatusData, type ActivitiesOptions } from 'discord.js';
import {
  env,
  PRESENCE_STATUS,
  PRESENCE_STREAMING_URL,
  PRESENCE_CUSTOM_STATUSES,
  PRESENCE_ROTATION_SECONDS,
  WHITELIST_USER_IDS,
} from './config.js';
import { aiCommand, handleModelsPrev, handleModelsNext } from './commands/ai.js';
import { shCommand } from './commands/sh.js';
import {
  factCheckCommand,
  replyMessageCommand,
  summarizeCommand,
  explainCommand,
  toLatexCommand,
  toLatinCommand,
  handleFactCheck,
  handleReplyMessage,
  handleSummarize,
  handleExplain,
  handleToLatex,
  handleToLatin,
  handleMakeVisible,
  handleCopy,
  handleRegen,
  showAskModal,
  handleAskModal,
  showAddContextModal,
  handleContextModal,
} from './commands/apps.js';
import { handleCopyTranslation, handleMakeVisibleTranslation } from './commands/latin.js';
import { handleMessage } from './commands/dms.js';

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
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent],
});

client.once(Events.ClientReady, async (c) => {
  console.log(`✅ SharkAI logueado como ${c.user.tag}`);
  if (WHITELIST_USER_IDS.length > 0) {
    for (const uid of WHITELIST_USER_IDS) {
      try {
        const user = await c.users.fetch(uid);
        await user.createDM();
      } catch {}
    }
  }
  try {
    await c.application?.commands.set([
      aiCommand.data.toJSON(),
      shCommand.data.toJSON(),
      factCheckCommand.toJSON(),
      replyMessageCommand.toJSON(),
      summarizeCommand.toJSON(),
      explainCommand.toJSON(),
      toLatexCommand.toJSON(),
      toLatinCommand.toJSON(),
    ]);
    console.log('✅ Comandos registrados: /ai, /sh, Fact-Check, Ask, Summarize, Explain, To Latex, To Latin');
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

  function getTimeOfDayStatuses(): string[] {
    const hour = new Date().getHours();
    if (hour >= 2 && hour < 6) {
      return ['zzz... coding in my sleep', 'nocturnal shark hours', '3am thoughts :3', 'whitelist only. 🦈'];
    }
    if (hour >= 6 && hour < 12) {
      return ['good morning :3', 'just woke up', 'morning coding session', 'whitelist only. 🦈'];
    }
    if (hour >= 12 && hour < 18) {
      return ['i bite. 🦈', 'active and bitey', 'afternoon mrrp :3', 'whitelist only. 🦈'];
    }
    if (hour >= 18 && hour < 22) {
      return ['evening vibes :3', 'chilling in dms', 'slava ssh. 🦈', 'whitelist only. 🦈'];
    }
    return ['zzz... late night coding', 'still here :3', 'nocturnal mode activated', 'whitelist only. 🦈'];
  }

  const statuses: ActivitiesOptions[] = PRESENCE_CUSTOM_STATUSES.length > 0
    ? PRESENCE_CUSTOM_STATUSES.map(s => ({ name: 'Custom Status', type: ActivityType.Custom, state: s }))
    : getTimeOfDayStatuses().map(s => ({ name: 'Custom Status', type: ActivityType.Custom, state: s }));

  if (PRESENCE_STATUS === 'streaming' && PRESENCE_STREAMING_URL) {
    statuses.unshift({ name: 'SharkAI', type: ActivityType.Streaming, url: PRESENCE_STREAMING_URL });
  }

  let statusIndex = 0;

  const applyPresence = () => {
    if (PRESENCE_CUSTOM_STATUSES.length === 0) {
      statuses.length = 0;
      statuses.push(...getTimeOfDayStatuses().map(s => ({ name: 'Custom Status', type: ActivityType.Custom, state: s })));
      if (PRESENCE_STATUS === 'streaming' && PRESENCE_STREAMING_URL) {
        statuses.unshift({ name: 'SharkAI', type: ActivityType.Streaming, url: PRESENCE_STREAMING_URL });
      }
    }
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
    if (interaction.commandName === 'ai') {
      await aiCommand.execute(interaction);
    }
    return;
  }
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'ai') {
      await aiCommand.execute(interaction);
    } else if (interaction.commandName === 'sh') {
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
    } else if (interaction.commandName === 'To Latex') {
      await handleToLatex(interaction);
    } else if (interaction.commandName === 'To Latin') {
      await handleToLatin(interaction);
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
  if (interaction.isButton() && interaction.customId.startsWith('copy_translation:')) {
    await handleCopyTranslation(interaction);
    return;
  }
  if (interaction.isButton() && interaction.customId.startsWith('make_visible_translation:')) {
    await handleMakeVisibleTranslation(interaction);
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

client.on(Events.MessageCreate, async (message) => {
  try {
    await handleMessage(message);
  } catch (err) {
    console.error('⚠️ handleMessage error:', err instanceof Error ? err.message : err);
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
