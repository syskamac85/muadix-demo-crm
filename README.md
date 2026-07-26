# SUN CRM – środowisko developerskie

Poniżej znajdują się aktualne instrukcje uruchamiania całego stosu (backend Django + Celery + frontend Next.js) w środowisku lokalnym.

## Wymagania wstępne

- Python 3.12 + virtualenv (repo korzysta z `.venv` w katalogu głównym)
- Node.js 18+ oraz npm (frontend w `apps/web`)
- Redis (broker dla Celery i Channels) uruchomiony lokalnie na `redis://localhost:6379/0`
- PostgreSQL działający lokalnie; backend używa DSN `postgres:///ms` (peer auth na koncie użytkownika systemowego `ms`)

## Backend (Django + Channels)

1. Aktywuj środowisko:
   ```bash
   source .venv/bin/activate
   ```
2. Upewnij się, że w `apps/api/.env` znajdują się przynajmniej:
   ```env
   DEBUG=True
   DATABASE_URL=postgres:///ms
   CELERY_BROKER_URL=redis://localhost:6379/0
   CELERY_RESULT_BACKEND=redis://localhost:6379/0
   ```
3. W razie zmian w schemacie bazy:
   ```bash
   python apps/api/manage.py migrate
   ```
4. Uruchom serwer ASGI (Channels potrzebuje ASGI, dlatego używamy `runserver`):
   ```bash
   python apps/api/manage.py runserver 0.0.0.0:8000
   ```
   Backend udostępnia API pod `http://localhost:8000`, WebSockety pod `ws://localhost:8000/ws/import/<job_id>/`.

## Celery worker

W osobnym terminalu (z aktywnym `.venv`):
```bash
source .venv/bin/activate
cd apps/api
PYTHONPATH=. celery -A api worker -l info
```
Worker używa Redis jako brokera/result backendu oraz współpracuje z zadaniem `core.tasks.process_import_job` obsługującym importy.

## Frontend (Next.js)

1. Przejdź do katalogu `apps/web`:
   ```bash
   cd apps/web
   ```
2. Upewnij się, że `.env.local` wskazuje na lokalny backend:
   ```env
   NEXT_PUBLIC_API_URL=http://localhost:8000
   NEXT_PUBLIC_WS_URL=ws://localhost:8000
   ```
3. Zainstaluj zależności (jeśli jeszcze nie):
   ```bash
   npm install
   ```
4. Uruchom dev server:
   ```bash
   npm run dev -- -p 3000
   ```
   Frontend działa pod `http://localhost:3000` i łączy się z backendem przez REST oraz WebSockety.

## Kolejność startu

1. Redis + PostgreSQL (usługi systemowe).
2. Backend (`python manage.py runserver`).
3. Celery worker (`celery -A api worker`).
4. Frontend (`npm run dev`).

Po tej kolejności importy działają w pełni (WS + fallback polling). Jeśli trzeba zatrzymać środowisko, przerwij każdy proces w terminalu (`Ctrl+C`).

## Wysyłanie zmian do GitHuba

### Podstawowe komendy git

1. Sprawdź status zmian:
   ```bash
   git status
   ```

2. Dodaj zmienione pliki:
   ```bash
   git add <pliki>
   # lub wszystkie zmienione pliki:
   git add .
   ```

3. Commituj zmiany:
   ```bash
   git commit -m "Opis zmian"
   ```

4. Wypchnij zmiany do GitHuba:
   ```bash
   git push
   ```

### Konfiguracja tokena GitHub

Jeśli masz problem z uwierzytelnianiem, użyj Personal Access Token:

1. Wygeneruj token na GitHub (Settings → Developer settings → Personal access tokens → Classic)
2. Zaznacz uprawnienia `repo`
3. Zaktualizuj remote URL z tokenem:
   ```bash
   git remote set-url origin https://<username>:<token>@github.com/<username>/<repo>.git
   ```

Przykład:
```bash
git remote set-url origin https://<username>:<token>@github.com/<username>/<repo>.git
```

### Alternatywne metody

**SSH:**
```bash
git remote set-url origin git@github.com:syskamac85/4-SUN-CRM.git
git push
```

Wymaga skonfigurowanych kluczy SSH na GitHub.
