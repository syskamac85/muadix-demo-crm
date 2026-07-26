# Deploying the SUN CRM backend on Render (Supabase + Upstash)

This guide describes how to run the Django/Channels API plus Celery worker on [Render](https://render.com) while using [Supabase](https://supabase.com) for PostgreSQL and [Upstash](https://upstash.com) for Redis (broker + Channels layer).

## 1. Overview

| Component | Purpose | Notes |
| --- | --- | --- |
| Render Web Service | Hosts `api.asgi` via Daphne (ASGI) and serves static files with WhiteNoise | Automatically builds from repo; exposes HTTPS endpoint. |
| Render Worker | Runs `celery -A api worker` for async jobs/imports | Shares the same code + env as web service. |
| Supabase Postgres | Primary database for Django | Provides managed Postgres + SSL. |
| Upstash Redis | Celery broker/result backend + Channels layer | Use the TLS URL (`rediss://`). |

Keep all three resources in the same geographic region (e.g. `eu-central`) to avoid latency.

## 2. Provision Supabase Postgres

1. Create a new Supabase project (choose the same region you plan to use on Render).
2. In **Project Settings → Database**, set a strong database password.
3. Copy the **Connection string** (URI format). It looks like:
   ```
   postgresql://postgres:<PASSWORD>@db.<ref>.supabase.co:5432/postgres?sslmode=require
   ```
4. From your local machine, run the migrations against Supabase once:
   ```bash
   export DATABASE_URL="postgresql://postgres:<PASSWORD>@db.<ref>.supabase.co:5432/postgres?sslmode=require"
   cd /path/to/4_SUN_CRM\ (web)
   source .venv/bin/activate
   python apps/api/manage.py migrate
   ```
5. (Optional) create a dedicated database user for the app and grant it privileges, then update the connection string accordingly.

## 3. Provision Upstash Redis

1. Create a new Upstash Redis database (choose the same region as above).
2. Enable TLS and copy the **`rediss://`** URL with password, e.g.:
   ```
   rediss://default:<PASSWORD>@global-round-red-12345.upstash.io:6379
   ```
3. This single URL will be reused for:
   - `CELERY_BROKER_URL`
   - `CELERY_RESULT_BACKEND`
   - `CHANNEL_REDIS_URL`

## 4. Required environment variables

Prepare the following secrets before creating Render services:

| Key | Description | Example |
| --- | --- | --- |
| `DJANGO_SETTINGS_MODULE` | Django settings module | `api.settings` |
| `SECRET_KEY` | Django secret key | Use `python -c "import secrets; print(secrets.token_urlsafe(50))"` |
| `DEBUG` | Disable in production | `False` |
| `ALLOWED_HOSTS` | Comma-separated hosts for Django | `sun-crm-api.onrender.com` |
| `CORS_ALLOWED_ORIGINS` | Frontend origins allowed | `https://4-sun-crm.vercel.app` |
| `CSRF_TRUSTED_ORIGINS` | Must include HTTPS frontend(s) | `https://4-sun-crm.vercel.app` |
| `DATABASE_URL` | Supabase Postgres URI (with `sslmode=require`) | `postgresql://…` |
| `CELERY_BROKER_URL` | Upstash Redis URL (TLS) | `rediss://default:…@…:6379` |
| `CELERY_RESULT_BACKEND` | Same as broker | `rediss://default:…` |
| `CHANNEL_REDIS_URL` | Same as broker | `rediss://default:…` |
| `PYTHON_VERSION` | Render build runtime | `3.12.2` |
| `REGON_API_KEY` | (Optional) Only if REGON integration is used | `...` |
| `REGON_API_URL` | (Optional override) | `https://wyszukiwarkaregon…` |

> **Tip:** Store these as Render secrets once and reference them from multiple services.

## 5. Render services (via `render.yaml`)

This repo ships with a `render.yaml` blueprint describing two services:

- **`sun-crm-api`** – Web service running Daphne (`api.asgi`).
- **`sun-crm-celery`** – Worker service running `celery -A api worker -l info`.

To deploy:

1. Push the latest code to GitHub/GitLab.
2. In Render, choose **Blueprint → New Blueprint Instance** and select your repository.
3. When prompted, supply the environment variables listed above. (Render will ask once and share between services if you select “Use existing secret”.)
4. Launch the blueprint. Render will:
   - Run `pip install -r apps/api/requirements.txt`.
   - Collect static files (`python manage.py collectstatic --noinput`).
   - Start Daphne on the web service and Celery worker on the worker service.

If you prefer manual setup, create two services:

| Service | Type | Build Command | Start Command |
| --- | --- | --- | --- |
| Web | `web` | `pip install -r apps/api/requirements.txt && cd apps/api && python manage.py collectstatic --noinput` | `cd apps/api && daphne -b 0.0.0.0 -p $PORT api.asgi:application` |
| Worker | `worker` | same as above | `cd apps/api && celery -A api worker -l info` |

## 6. Post-deploy checklist

1. **Run migrations (if not already):**
   ```bash
   render ssh <service-name>
   cd apps/api
   python manage.py migrate
   ```
2. **Create admin user (optional):**
   ```bash
   python manage.py createsuperuser
   ```
3. **Verify WebSocket endpoints:** ensure `/ws/import/<job_id>/` connects (Render’s web services support WebSockets out of the box).
4. **Update frontend envs** (`NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WS_URL`) to use the new Render domain.
5. **Monitor Celery logs** under the worker service for import tasks.

## 7. Future additions

- Add a third worker (`celery beat`) if you introduce scheduled tasks.
- Configure Render’s cron jobs or use Supabase Edge Functions if you need scheduled triggers without Celery beat.
- Consider enabling Render autoscaling (Pro plan) once traffic increases.
