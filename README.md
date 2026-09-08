# SharkAI 🦈

Bot de Discord en TypeScript (discord.js) que usa **Groq** (plan gratuito) para responder preguntas con modelos de IA. Hereda la metodología del antiguo `sshbot`.

## Comandos — todo bajo `/ai`

| Comando | Descripción |
|---|---|
| `/ai ask <message> [model] [visible]` | Pregunta a Groq. `model` = override one-time. `visible:false` = respuesta solo para ti (por defecto es visible). |
| `/ai model [model] [info]` | Ve o cambia tu modelo por defecto. `info:false` oculta los límites. |
| `/ai prompt [text] [clear]` | Ve o cambia tu system prompt personalizado. `clear:true` vuelve al por defecto. |
| `/ai language <language>` | Idioma de tus respuestas: `es` (Español) o `en` (English). |
| `/ai status` | Muestra tu config actual (modelo, idioma, prompt). |
| `/ai reset` | Reinicia todos tus ajustes a los valores por defecto. |

## Modelos gratuitos (Groq free tier)

| Modelo | TPM | RPM | RPD | Contexto |
|---|---|---|---|---|
| llama-3.3-70b-versatile | 6,000 | 30 | 1,000 | 128K |
| llama-3.1-8b-instant | 6,000 | 30 | 1,000 | 128K |
| qwen-2.5-coder-32b | 6,000 | 30 | 1,000 | 128K |
| gemma2-9b-it | 6,000 | 30 | 1,000 | 8K |
| llama-4-maverick-17b-128e-instruct (multimodal 🌄) | 6,000 | 30 | 1,000 | 128K |

Las preferencias (modelo, prompt, idioma) se guardan por usuario en `data/prefs.json` (persistente vía volumen Docker).

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