# SharkAI 🦈

Bot de Discord en TypeScript (discord.js) que usa IA gratuita (**Groq** y **Google Gemini**) para responder preguntas. Hereda la metodología del antiguo `sshbot`.

## Comandos — todo bajo `/sh`

|Comando|Descripción|
|---|---|
|`/sh ask <message> [model] [visible]`|Pregunta a la IA. `model` = override one-time. `visible:false` = respuesta solo para ti (por defecto es visible). Footer estilo heist.lol con modelo + uso diario compartido.|
|`/sh model [model] [info]`|Ve o cambia tu modelo por defecto. El selector agrupa por provider (Groq / Google). `info:false` oculta los límites.|
|`/sh prompt [text] [clear]`|Ve o cambia tu system prompt personalizado. `clear:true` vuelve al por defecto.|
|`/sh language <language>`|Idioma de tus respuestas: `es` (Español) o `en` (English).|
|`/sh usage`|Uso diario **compartido** entre todos los modelos/providers (misma cuota) + límites en vivo de Groq.|
|`/sh new`|Empieza una conversación nueva (borra el contexto del chat).|
|`/sh status`|Muestra tu config actual (modelo, idioma, prompt, contexto).|
|`/sh reset`|Reinicia todos tus ajustes a los valores por defecto.|

Todas las respuestas usan **Components V2** de Discord (nuevo sistema de mensajes estructurados — sin embeds, sin color).

## Modelos gratuitos (chat, sep 2026)

|Modelo|Model ID|Provider|TPM|RPM|RPD|
|---|---|---|---|---|---|
|GPT-OSS 120B|`openai/gpt-oss-120b`|Groq|8,000|1,000|1,000|
|GPT-OSS 20B|`openai/gpt-oss-20b`|Groq|8,000|1,000|1,000|
|GPT-OSS Safeguard 20B|`openai/gpt-oss-safeguard-20b`|Groq|8,000|1,000|1,000|
|Qwen 3.6 27B|`qwen/qwen3.6-27b`|Groq|8,000|1,000|1,000|
|Qwen 3.8 27B|`qwen/qwen3.8-27b`|Groq|8,000|1,000|1,000|
|Groq Compound|`groq/compound`|Groq|70,000|250|250|
|Groq Compound Mini|`groq/compound-mini`|Groq|70,000|250|250|
|Gemini 2.5 Flash|`gemini-2.5-flash`|Google|250,000|5|20|
|Gemini 2.5 Flash-Lite|`gemini-2.5-flash-lite`|Google|250,000|10|20|
|Gemini 3 Flash|`gemini-3-flash-preview`|Google|250,000|5|20|
|Gemini 3.1 Flash-Lite|`gemini-3.1-flash-lite`|Google|250,000|15|500|
|Gemini 3.5 Flash|`gemini-3.5-flash`|Google|250,000|5|20|
|Gemini 3.5 Flash-Lite|`gemini-3.5-flash-lite`|Google|250,000|15|500|
|Gemini 3.6 Flash|`gemini-3.6-flash`|Google|250,000|5|20|
|Gemini 3.7 Flash|`gemini-3.7-flash`|Google|250,000|5|20|
|Gemini 3.8 Flash|`gemini-3.8-flash`|Google|250,000|5|20|

Las preferencias (modelo, prompt, idioma) se guardan por usuario en `data/prefs.json` (persistente vía volumen Docker).

Cada modelo lleva su emoji de provider en el footer y el selector: <:openai:1547015408110800967> (GPT-OSS), <:qwen:1547015425496195073> (Qwen), <:groq:1547015390939320320> (Compound) y <:google:1547015367174397952> (Gemini).

## Uso compartido

Todos los modelos tiran de la **misma cuota** (la misma cuenta/API), así que hay un único contador de uso diario: se muestra en el footer de `/sh ask` (`X/1000 daily`) y en `/sh usage`. Límite configurable con `SHARED_DAILY_LIMIT` (default `1000`).

Los **límites son específicos por modelo y se sacan de la propia API**:
- **Groq**: cada respuesta trae en sus headers `x-ratelimit-*` los límites reales de ese modelo con tu key. Se cachean en `data/limits.json` (persisten entre reinicios) y `/sh model` + `/sh usage` los refrescan con un ping mínimo de 1 token cuando llevan más de 60s.
- **Google**: su API no expone límites en resoluciones normales; se capturan los reales del `rate_limit_metadata` de los errores 429 (cuota superada) y se cachean igual, usando como base la cuota publicada del free tier.

## Contexto entre mensajes

El bot guarda una **ventana de contexto** por usuario (las últimas 3 preguntas + respuestas, con cada mensaje recortado a 400 chars para acotar el input). Es persistente entre reinicios. `/sh new` borra la conversación. Así el bot recuerda de qué iba el chat sin quemar una burrada de tokens.

## Desarrollo

```bash
npm install
npm run dev # tsx watch
```

## Producción (Docker con auto-update desde GitHub)

1. Crea tu bot en https://discord.com/developers/applications.
2. Consigue una key en https://console.groq.com/keys (plan free).
3. Opcional: consigue una key en https://aistudio.google.com/apikey para los modelos de Gemini.
4. En el servidor:

```bash
mkdir sharkai && cd sharkai
cp .env.example .env # rellena DISCORD_TOKEN y GROQ_API_KEY (y GOOGLE_API_KEY si quieres Gemini)
docker compose up -d --build
```

El contenedor:
- clona el repo en el volumen `sharkai-code`,
- hace `git pull` cada `POLL_SECONDS` (60s) y si hay cambios nuevos: recompila y reinicia el bot automáticamente.

Push a `main` = bot actualizado en ≤1 minuto.

## Env vars

|Variable|Descripción|
|---|---|
|`DISCORD_TOKEN`|Token del bot (obligatorio)|
|`GROQ_API_KEY`|API key de Groq (obligatorio)|
|`GOOGLE_API_KEY`|API key de Google AI Studio (opcional, para modelos Gemini)|
|`GIT_REPO`|Repo para auto-update (default: este repo)|
|`GIT_BRANCH`|Rama a seguir (default: `main`)|
|`POLL_SECONDS`|Intervalo de chequeo de updates (default: `60`)|
|`DATA_DIR`|Carpeta de persistencia (default: `/app/data`)|
|`COOLDOWN_SECONDS`|Cooldown entre /sh ask por usuario (default: `3`)|
|`SHARED_DAILY_LIMIT`|Límite diario compartido entre todos los modelos (default: `1000`)|

## Seguridad

- Los tokens van solo en `.env` (nunca en el repo).
- El contenedor solo necesita salida HTTPS a `api.groq.com`, `generativelanguage.googleapis.com` y `discord.com` + acceso al repo `git` — no expone puertos.