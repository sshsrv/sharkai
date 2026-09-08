import { Client, GatewayIntentBits, Events } from 'discord.js';
import { env } from './config.js';
import { aiCommand } from './commands/ai.js';

if (!env.discordToken) {
  console.error('❌ Falta DISCORD_TOKEN en el entorno');
  process.exit(1);
}
if (!env.groqApiKey) {
  console.error('❌ Falta GROQ_API_KEY en el entorno');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

client.once(Events.ClientReady, async (c) => {
  console.log(`✅ SharkAI logueado como ${c.user.tag}`);
  try {
    await c.application?.commands.set([aiCommand.data.toJSON()]);
    console.log('✅ Comando /ai registrado');
  } catch (err) {
    console.error('⚠️ No se pudieron registrar comandos:', err instanceof Error ? err.message : err);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === 'ai') {
    await aiCommand.execute(interaction);
  }
});

client.login(env.discordToken).catch((err: unknown) => {
  console.error('❌ Error al iniciar sesión:', err instanceof Error ? err.message : err);
  process.exit(1);
});