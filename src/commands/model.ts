import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
} from 'discord.js';
import { MODELS, CHAT_MODEL_IDS, formatLimits, DEFAULT_MODEL } from '../config.js';
import { getModel, setModel } from '../store.js';

export const modelCommand = {
  data: new SlashCommandBuilder()
    .setName('model')
    .setDescription('Selecciona el modelo de Groq por defecto (para tus preguntas)')
    .addStringOption((opt) =>
      opt
        .setName('modelo')
        .setDescription('Modelo a usar por defecto')
        .setRequired(true)
        .addChoices(...CHAT_MODEL_IDS.map((id) => ({ name: MODELS[id].name, value: id })))
    )
    .addBooleanOption((opt) =>
      opt
        .setName('info')
        .setDescription('Mostrar detalles de límites del modelo (por defecto: true)')
        .setRequired(false)
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const model = interaction.options.getString('modelo', true);
    const showInfo = interaction.options.getBoolean('info') ?? true;

    if (!MODELS[model]) {
      await interaction.reply({ content: `❌ Modelo no válido: \`${model}\``, ephemeral: true });
      return;
    }

    setModel(interaction.user.id, model);

    const embed = new EmbedBuilder()
      .setColor(0x00d4ff)
      .setTitle('✅ Modelo por defecto actualizado')
      .setDescription(`Tu modelo por defecto ahora es **${MODELS[model].name}** (${model})`)
      .setFooter({ text: 'Usa /ask para preguntar, /model para cambiar aquí' });

    if (showInfo) {
      embed.addFields({ name: 'Información', value: formatLimits(MODELS[model]) });
    }

    await interaction.reply({
      embeds: [embed],
      ephemeral: interaction.options.getBoolean('info') === false ? false : true,
    });
  },
};

export const modelDefaultInfo = { DEFAULT_MODEL };