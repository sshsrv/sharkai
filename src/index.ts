import { Client, GatewayIntentBits, Events } from 'discord.js';
import { env } from './config.js';
import { shCommand } from './commands/ai.js';
import {
  factCheckCommand,
  replyMessageCommand,
  handleFactCheck,
  handleReplyMessage,
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
]);
console.log('✅ Comandos registrados: /sh, Fact-Check, Reply (user-install)');
    const appId = c.user.id;
    console.log(
      `🔗 Instala la app: https://discord.com/oauth2/authorize?client_id=${appId}&integration_type=1&scope=applications.commands`,
    );
  } catch (err) {
    console.error('⚠️ No se pudieron registrar comandos:', err instanceof Error ? err.message : err);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
 if (interaction.isChatInputCommand()) {
 if (interaction.commandName === 'sh') {
 await shCommand.execute(interaction);
 }
 return;
 }
 if (interaction.isMessageContextMenuCommand()) {
 if (interaction.commandName === 'Fact-Check') {
 await handleFactCheck(interaction);
 } else if (interaction.commandName === 'Reply') {
 await handleReplyMessage(interaction);
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
