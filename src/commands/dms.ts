import { Message, ChannelType, TextChannel } from 'discord.js';
import { ask } from '../providers.js';
import { recordRequest, getModelUsage } from '../usage.js';
import { getModel, getLanguage, appendHistory } from '../store.js';
import { WHITELIST_USER_IDS } from '../config.js';

export async function handleMessage(message: Message): Promise<void> {
  if (message.author.bot) return;
  if (WHITELIST_USER_IDS.length > 0 && !WHITELIST_USER_IDS.includes(message.author.id)) return;

  const isDM = message.channel.type === ChannelType.DM;
  const botId = message.client.user.id;
  const mentionedBot = message.mentions.has(botId);

  if (!isDM && !mentionedBot) return;

  const userId = message.author.id;
  const question = message.content
    .replace(new RegExp(`<@!?${botId}>`, 'g'), '')
    .trim();

  if (!question) return;

  try {
    if (!isDM && 'sendTyping' in message.channel) {
      await message.channel.sendTyping();
    }

    const result = await ask(question, null, userId);
    recordRequest(result.provider, result.model);
    appendHistory(userId, 'user', question);
    appendHistory(userId, 'assistant', result.text);

    if (isDM) {
      await message.channel.send(result.text);
    } else {
      await message.reply({ content: result.text, allowedMentions: { repliedUser: true } });
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    try {
      await message.reply(`Error: ${errorMsg}`);
    } catch {}
  }
}
