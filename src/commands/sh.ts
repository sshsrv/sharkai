import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  ApplicationIntegrationType,
  InteractionContextType,
} from 'discord.js';
import {
  LANGUAGE_CHOICES,
  type Language,
  languageLabel,
} from '../config.js';
import { getLanguage, setLanguage } from '../store.js';
import { t } from '../strings.js';
import { replyComponents, text, box, separator } from '../components.js';
import { toLatex, toLatin, renderTranslation } from './latin.js';

function boxTitle(title: string) {
  return { type: 10, content: `# ${title}` } as import('../components.js').V2Component;
}

export const shCommand = {
  data: new SlashCommandBuilder()
    .setName('sh')
    .setDescription('SharkAI: tools and config')
    .setIntegrationTypes([ApplicationIntegrationType.UserInstall, ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel])
    .addSubcommand((s) =>
      s
        .setName('language')
        .setDescription('UI language (AI always answers in your language)')
        .addStringOption((o) =>
          o
            .setName('language')
            .setDescription('Language')
            .setRequired(true)
            .addChoices(...LANGUAGE_CHOICES),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('latex')
        .setDescription('Convert Latin text to Changed Latex alphabet')
        .addStringOption((o) =>
          o
            .setName('text')
            .setDescription('Text to convert')
            .setRequired(true),
        )
        .addBooleanOption((o) =>
          o
            .setName('visible')
            .setDescription('True = visible for everyone (default). False = only you (ephemeral)'),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('latin')
        .setDescription('Convert Changed Latex alphabet back to Latin text')
        .addStringOption((o) =>
          o
            .setName('text')
            .setDescription('Latex text to convert')
            .setRequired(true),
        )
        .addBooleanOption((o) =>
          o
            .setName('visible')
            .setDescription('True = visible for everyone (default). False = only you (ephemeral)'),
        ),
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const sub = interaction.options.getSubcommand();
    switch (sub) {
      case 'language':
        await handleLanguage(interaction);
        break;
      case 'latex':
        await handleLatex(interaction);
        break;
      case 'latin':
        await handleLatin(interaction);
        break;
      default:
        await replyComponents(
          interaction,
          [text(t(getLanguage(interaction.user.id), 'unknownSub'))],
          { ephemeral: true },
        );
    }
  },
};

async function handleLanguage(interaction: ChatInputCommandInteraction): Promise<void> {
  const lang = interaction.options.getString('language', true) as Language;
  if (!LANGUAGE_CHOICES.some((c) => c.value === lang)) {
    await replyComponents(interaction, [text(t(getLanguage(interaction.user.id), 'invalidLanguage'))], {
      ephemeral: true,
    });
    return;
  }
  const oldLang = getLanguage(interaction.user.id);
  setLanguage(interaction.user.id, lang);
  await replyComponents(
    interaction,
    [box([boxTitle(t(lang, 'h1LanguageSet', languageLabel(lang))), separator(), text(t(lang, 'languageChanged', languageLabel(oldLang), languageLabel(lang)))])],
    { ephemeral: true },
  );
}

async function handleLatex(interaction: ChatInputCommandInteraction): Promise<void> {
  const lang = getLanguage(interaction.user.id);
  const input = interaction.options.getString('text', true);
  const visible = interaction.options.getBoolean('visible') ?? true;
  const result = toLatex(input);
  await replyComponents(
    interaction,
    renderTranslation(input, result, 'latex', lang, interaction.guildId, interaction.channelId, null, interaction.user.id, visible),
    { ephemeral: !visible },
  );
}

async function handleLatin(interaction: ChatInputCommandInteraction): Promise<void> {
  const lang = getLanguage(interaction.user.id);
  const input = interaction.options.getString('text', true);
  const visible = interaction.options.getBoolean('visible') ?? true;
  const result = toLatin(input);
  await replyComponents(
    interaction,
    renderTranslation(input, result, 'latin', lang, interaction.guildId, interaction.channelId, null, interaction.user.id, visible),
    { ephemeral: !visible },
  );
}
