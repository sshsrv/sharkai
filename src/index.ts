import { Client, GatewayIntentBits, Events } from 'discord.js';
import { env } from './config.js';
import { shCommand } from './commands/ai.js';

if (!env.discordToken) {
  console.error('❌ Falta DISCORD_TOKEN en el entorno');
  process.exit(1);
}
if (!env.groqApiKey) {
  console.error('❌ Falta GROQ_API_KEY en el entorno');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages],
});

client.once(Events.ClientReady, async (c) => {
  console.log(`✅ SharkAI logueado como ${c.user.tag}`);
  try {
    await c.application?.commands.set([shCommand.data.toJSON()]);
    console.log('✅ Comando /sh registrado (user-install)');
    // Link de instalación para el usuario (sin necesidad de servidor)
    const appId = c.user.id;
    console.log(
      `🔗 Instala la app: https://discord.com/oauth2/authorize?client_id=${appId}&integration_type=1&scope=applications.commands`
    );
  } catch (err) {
    console.error('⚠️ No se pudieron registrar comandos:', err instanceof Error ? err.message : err);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === 'sh') {
    await shCommand.execute(interaction);
  }
});

client.login(env.discordToken).catch((err: unknown) => {
  console.error('❌ Error al iniciar sesión:', err instanceof Error ? err.message : err);
  process.exit(1);
});