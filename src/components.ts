import {
  ChatInputCommandInteraction,
  InteractionResponseType,
  Routes,
} from 'discord.js';

/**
 * Soporte mínimo para Components V2 (embeds v2).
 * discord.js aún no expone builders, así que enviamos el payload RAW vía REST.
 *
 * API (docs.discord.com/developers/components):
 * - Flag IS_COMPONENTS_V2 = 1 << 15 (32768): desactiva content/embeds, todo va en `components`.
 * - Text Display (10): markdown. Separator (14): divider/spacing. Container (17): agrupa + accent_color.
 */
export const IS_COMPONENTS_V2 = 1 << 15;
export const EPHEMERAL = 1 << 6;

export type V2Component =
  | { type: 10; content: string } // Text Display
  | { type: 14; divider?: boolean; spacing?: 1 | 2 } // Separator
  | { type: 17; components: V2Component[]; accent_color?: number; spoiler?: boolean } // Container
  | { type: 9; components: V2Component[]; accessory?: unknown } // Section
  | { type: 1; components: unknown[] }; // Action Row

export const text = (content: string): V2Component => ({ type: 10, content });
export const separator = (divider = true, spacing: 1 | 2 = 1): V2Component => ({
  type: 14,
  divider,
  spacing,
});

/** Heading con tamaño de título (# = 1, ## = 2, ### = 3…). Compatible con Components V2. */
export const heading = (content: string, level = 1): V2Component =>
  ({ type: 10, content: `${'#'.repeat(Math.min(Math.max(level, 1), 6))} ${content}` }) as V2Component;

function flags(opts: { ephemeral?: boolean } = {}): number {
  return IS_COMPONENTS_V2 | (opts.ephemeral ? EPHEMERAL : 0);
}

/** Responde a la interacción directamente con components. */
export async function replyComponents(
  interaction: ChatInputCommandInteraction,
  components: V2Component[],
  opts: { ephemeral?: boolean } = {}
): Promise<void> {
  await interaction.client.rest.post(
    Routes.interactionCallback(interaction.id, interaction.token),
    {
      body: {
        type: InteractionResponseType.ChannelMessageWithSource,
        data: { flags: flags(opts), components },
      },
    }
  );
}

/** Diferir (necesario para /sh ask: Groq tarda). La flag IS_COMPONENTS_V2 debe ir YA en el defer. */
export async function deferComponents(
  interaction: ChatInputCommandInteraction,
  opts: { ephemeral?: boolean } = {}
): Promise<void> {
  await interaction.client.rest.post(
    Routes.interactionCallback(interaction.id, interaction.token),
    {
      body: {
        type: InteractionResponseType.DeferredChannelMessageWithSource,
        data: { flags: flags(opts) },
      },
    }
  );
}

/** Edita el mensaje original (@original) con components. La flag IS_COMPONENTS_V2 es obligatoria también aquí. */
export async function editComponents(
  interaction: ChatInputCommandInteraction,
  components: V2Component[]
): Promise<void> {
  await interaction.client.rest.patch(
    Routes.webhookMessage(interaction.client.user.id, interaction.token),
    { body: { flags: IS_COMPONENTS_V2, components } }
  );
}

/** Presupuesto de caracteres de todos los Text Displays (límite API: 4000). */
export function totalChars(components: V2Component[]): number {
  let n = 0;
  for (const c of components) {
    if (c.type === 10) n += c.content.length;
    else if (c.type === 17) n += totalChars(c.components);
    else if (c.type === 9) n += totalChars(c.components);
  }
  return n;
}