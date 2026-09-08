import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
} from 'discord.js';
import { MODELS, CHAT_MODEL_IDS } from '../config.js';
import { ask } from '../groq.js';

export const askCommand = {
  data: new SlashCommandBuilder()
    .setName('ask')
    .setDescription('Pregunta algo a Groq usando tu modelo por defecto')
    .addStringOption((opt) =>
      opt
        .setName('pregunta')
        .setDescription('Lo que quieras preguntar')
        .setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName('modelo')
        .setDescription('Modelo one-time (override) para esta pregunta')
        .setRequired(false)
        .addChoices(...CHAT_MODEL_IDS.map((id) => ({ name: MODELS[id].name, value: id })))
    )
    .addBooleanOption((opt) =>
      opt
        .setName('visible')
        .setDescription('Si false, la respuesta será solo visible para ti (ephemeral). Por defecto: true')
        .setRequired(false)
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const question = interaction.options.getString('pregunta', true);
    const overrideModel = interaction.options.getString('modelo');
    const visible = interaction.options.getBoolean('visible') ?? true;

    await interaction.deferReply({ ephemeral: !visible });

    try {
      const result = await ask(question, overrideModel, interaction.user.id);

      const embed = new EmbedBuilder()
        .setColor(0x00d4ff)
        .setTitle('🤖 SharkAI')
        .setDescription(result.text)
        .setFooter({
          text: `Modelo: ${result.model} · ${result.usage.totalTokens} tokens`,
        })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await interaction.editReply({
        content: `❌ Error al consultar Groq: ${message}`,
      });
    }
  },
};