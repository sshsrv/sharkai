import { Client, GatewayIntentBits, Events } from 'discord.js';
import { env, DEFAULT_MODEL } from './config.js';
import { modelCommand } from './commands/model.js';
import { askCommand } from './commands/ask.js';

if (!env.discordToken) {
  console.error('❌ Falta DISCORD_TOKEN en el entorno');
  process.exit(1);
}
if (!env.groqApiKey) {
  console.error('❌ Falta GROQ_API_KEY en el entorno');
  process.exit(1);
}

const commands = [modelCommand.data.toJSON(), askCommand.data.toJSON()];

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

client.once(Events.ClientReady, async (c) => {
  console.log(`✅ SharkAI logueado como ${c.user.tag} (modelo por defecto: ${DEFAULT_MODEL})`);
  try {
    await c.application?.commands.set(commands);
    console.log(`✅ ${commands.length} comandos slash registrados`);
  } catch (err) {
    console.error('⚠️ No se pudieron registrar comandos:', err instanceof Error ? err.message : err);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  switch (interaction.commandName) {
    case 'model':
      await modelCommand.execute(interaction);
      break;
    case 'ask':
      await askCommand.execute(interaction);
      break;
    default:
      await interaction.reply({ content: 'Comando desconocido', ephemeral: true });
  }
});

client.login(env.discordToken).catch((err: unknown) => {
  console.error('❌ Error al iniciar sesión:', err instanceof Error ? err.message : err);
  process.exit(1);
});