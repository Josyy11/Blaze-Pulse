# Blaze Pulse

Blaze Pulse is a premium ecosystem timing dashboard for Blaze creators. It answers one question:

> Is now the right time to go live?

The V1 product is intentionally small: one landing page, one dashboard, no user authentication, and one backend endpoint that serves the complete dashboard payload.

## Architecture

- React + Vite frontend
- Node production server in `scripts/serve-dist.mjs`
- Single public API endpoint: `GET /api/pulse`
- Server-side Blaze REST API polling only
- 60 second snapshot cadence
- File-backed local store at `data/pulse-store.json`
- Deterministic Pulse Engine with explainable calculations

The frontend never calls Blaze directly. Blaze API credentials stay server-side.

## Blaze API Integration

The backend uses the official Blaze API through an app access token and these environment variables:

```env
BLAZE_CLIENT_ID=
BLAZE_CLIENT_SECRET=
```

Optional overrides:

```env
BLAZE_API_BASE_URL=https://api.blaze.stream
BLAZE_TOKEN_URL=https://blaze.stream/bapi/oauth2/token
BLAZE_PULSE_MAX_CHANNEL_STATS=120
```

Use `.env.example` as the template. Do not commit `.env`.

## Development

Install dependencies:

```bash
npm install
```

Run the frontend dev server:

```bash
npm run dev
```

Typecheck:

```bash
npm run typecheck
```

Build:

```bash
npm run build
```

Run the production frontend and API server:

```bash
npm run start
```

The production server serves the built app from `dist/` and exposes `GET /api/pulse`.

## Data Behavior

When Blaze credentials are configured, `/api/pulse` polls the Blaze REST API, stores a rolling 24 hour local history, and returns the dashboard-ready Pulse payload.

When credentials are missing and no cached snapshot exists, `/api/pulse` returns a JSON `503` response explaining the missing configuration.

## Scope

V1 intentionally excludes:

- User login
- User profiles
- Settings
- Notifications
- EventSub/WebSocket support
- AI recommendations
- Extra pages or expanded analytics

Every calculation exists to support the core product question: is now the right time to go live?
