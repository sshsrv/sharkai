# SharkAI 🦈

Bot de Discord en TypeScript (discord.js) que usa **Groq** (plan gratuito) para responder preguntas con modelos de IA. Hereda la metodología del antiguo `sshbot`.

## Comandos — todo bajo `/sh`

| Comando | Descripción |
|---|---|
| `/sh ask <message> [model] [visible]` | Pregunta a Groq. `model` = override one-time. `visible:false` = respuesta solo para ti (por defecto es visible). Footer estilo heist.lol con modelo + límites reales. |
| `/sh model [model] [info]` | Ve o cambia tu modelo por defecto. `info:false` oculta los límites. |
| `/sh prompt [text] [clear]` | Ve o cambia tu system prompt personalizado. `clear:true` vuelve al por defecto. |
| `/sh language <language>` | Idioma de tus respuestas: `es` (Español) o `en` (English). |
| `/sh usage` | Muestra los límites de Groq que te quedan ahora mismo (RPM/TPM y resets). |
| `/sh new` | Empieza una conversación nueva (borra el contexto del chat). |
| `/sh status` | Muestra tu config actual (modelo, idioma, prompt, contexto). |
| `/sh reset` | Reinicia todos tus ajustes a los valores por defecto. |

Todas las respuestas usan **Components V2** de Discord (nuevo sistema de mensajes estructurados — sin embeds, sin color).

## Modelos gratuitos (Groq free tier — chat, sep 2026)

| Modelo | Model ID | TPM | RPM | RPD |
|---|---|---|---|---|
| GPT-OSS 120B | `openai/gpt-oss-120b` | 8,000 | 30 | 1,000 |
| GPT-OSS 20B | `openai/gpt-oss-20b` | 8,000 | 30 | 1,000 |
| GPT-OSS Safeguard 20B | `openai/gpt-oss-safeguard-20b` | 8,000 | 30 | 1,000 |
| Qwen 3.6 27B | `qwen/qwen3.6-27b` | 8,000 | 30 | 1,000 |
| Qwen 3.8 27B | `qwen/qwen3.8-27b` | 8,000 | 30 | 1,000 |
| Groq Compound | `groq/compound` | 70,000 | 30 | 250 |
| Groq Compound Mini | `groq/compound-mini` | 70,000 | 30 | 250 |

Nota: Groq free tier también expone `whisper-large-v3` (audio→texto), `whisper-large-v3-turbo`, `canopylabs/orpheus-*` (TTS) y `meta-llama/llama-prompt-guard-*` (moderación). No son modelos de chat de texto, así que no salen en el menú `/ai model`.

Las preferencias (modelo, prompt, idioma) se guardan por usuario en `data/prefs.json` (persistente vía volumen Docker).

## Contexto entre mensajes

El bot guarda una **ventana de contexto** por usuario (las últimas 3 preguntas + respuestas, con cada mensaje recortado a 400 chars para acotar el input). Es persistente entre reinicios. `/sh new` borra la conversación. Así el bot recuerda de qué iba el chat sin quemar una burrada de tokens.

## Desarrollo

```bash
npm install
npm run dev        # tsx watch
```

## Producción (Docker con auto-update desde GitHub)

1. Crea tu bot en https://discord.com/developers/applications.
2. Consigue una key en https://console.groq.com/keys (plan free).
3. En el servidor:

```bash
mkdir sharkai && cd sharkai
cp .env.example .env   # rellena DISCORD_TOKEN y GROQ_API_KEY
docker compose up -d --build
```

El contenedor:
- clona el repo en el volumen `sharkai-code`,
- hace `git pull` cada `POLL_SECONDS` (60s) y si hay cambios nuevos: recompila y reinicia el bot automáticamente.

Push a `main` = bot actualizado en ≤1 minuto.

## Env vars

| Variable | Descripción |
|---|---|
| `DISCORD_TOKEN` | Token del bot (obligatorio) |
| `GROQ_API_KEY` | API key de Groq (obligatorio) |
| `GIT_REPO` | Repo para auto-update (default: este repo) |
| `GIT_BRANCH` | Rama a seguir (default: `main`) |
| `POLL_SECONDS` | Intervalo de chequeo de updates (default: `60`) |
| `DATA_DIR` | Carpeta de persistencia (default: `/app/data`) |
| `COOLDOWN_SECONDS` | Cooldown entre /ai ask por usuario (default: `3`) |

## Seguridad

- Los tokens van solo en `.env` (nunca en el repo).
- El contenedor solo necesita salida HTTPS a `api.groq.com` y `discord.com` + acceso al repo `git` — no expone puertos.