# Blaze Pulse

Blaze Pulse is a creator tool built for the Blaze ecosystem.

Powered by the official Blaze API, it monitors live ecosystem activity, audience movement, category momentum, and competition to help creators understand what's happening across the platform before they go live.

Rather than focusing on historical analytics, Blaze Pulse answers one simple question:

**Is now the right time to go live?**

Powered by the official Blaze API, Blaze Pulse transforms live ecosystem data into actionable creator intelligence: current demand, creator pressure, category movement, and timing signals presented in one focused dashboard.

---

## Why Blaze Pulse?

Creators often rely on instinct when deciding when to stream.

That instinct matters, but timing is easier when the ecosystem is visible. Blaze Pulse removes the guesswork by analyzing the live Blaze ecosystem in real time and surfacing signals that help creators choose better streaming windows.

The goal is simple: give creators a clear read on the moment before they go live.

---

## Features

- **Opportunity Gauge**: a single ecosystem timing score that shows whether the current moment is Prime, Good, Busy, or Oversaturated.
- **Smart Recommendation Engine**: a clear next action, such as going live now or waiting for pressure to ease.
- **Live Ecosystem Metrics**: live viewers, live creators, average viewers, and new streams in the last 15 minutes.
- **Category Momentum**: current viewer distribution across active categories.
- **Competition Pressure**: a compact read on creator density and stream competition.
- **Ecosystem Signals**: plain-language signals that explain what is happening across the live ecosystem.
- **Average Viewers**: live viewers divided by active live creators.
- **New Streams (15 minute window)**: recently started streams detected from live stream timestamps.
- **24 Hour Pulse Timeline**: rolling opportunity history built from recorded snapshots.
- **Pulse Ledger**: continuous 60 second snapshot collection for the last 24 hours.
- **Last Updated indicator**: shows when the current ecosystem read was refreshed.
- **Responsive dashboard**: designed for desktop, tablet, and mobile.
- **Dark mode experience**: the V1 interface is dark mode only.

---

## Powered by the Blaze API

Blaze Pulse uses the official Blaze API from the server. The frontend never calls Blaze directly, and Blaze credentials remain server-side.

Integrated endpoints:

- `POST https://blaze.stream/bapi/oauth2/token`  
  Used to authenticate the application with the Blaze API using client credentials.

- `GET https://api.blaze.stream/v1/channels`  
  Used to retrieve live channel data, live status, category metadata, stream titles, start times, and creator activity.

- `GET https://api.blaze.stream/v1/channels/live-stats?channelId={channelId}`  
  Used to retrieve live channel statistics, including current viewer data where available.

- `GET https://api.blaze.stream/v1/channels/stats?channelId={channelId}`  
  Used as a fallback stats endpoint when live stats are unavailable for a channel.

Directly provided by Blaze:

- Live channel list
- Live status
- Stream metadata
- Category information
- Stream start times
- Channel statistics
- Viewer counts where exposed by the API

Derived by Blaze Pulse:

- Opportunity Score
- Recommendation State
- Competition Pressure
- Category Momentum
- Average Viewers
- New Streams in the last 15 minutes
- 24 hour momentum history
- Ecosystem signal labels

---

## Pulse Engine

The Blaze API provides live ecosystem data, but it does not directly expose product-level concepts such as:

- Opportunity Score
- Competition Pressure
- Best Time to Go Live
- Category Momentum
- Recommendation State

Blaze Pulse derives these values deterministically from verified API data.

The Pulse Engine uses live viewers, active creators, category distribution, stream start times, and rolling snapshots to produce the dashboard state. No metrics are fabricated. If the API does not provide a value directly, Blaze Pulse either derives it from available live data or does not present it as a direct API metric.

---

## Tech Stack

- **Frontend**: React, TypeScript, Vite
- **Styling**: CSS
- **Backend**: Node.js HTTP server
- **API layer**: Official Blaze API
- **Data collection**: server-side REST polling
- **Storage**: file-backed rolling Pulse Ledger
- **Deployment**: Render

---

## Running Locally

Install dependencies:

```bash
npm install
```

Create a `.env` file:

```env
BLAZE_CLIENT_ID=
BLAZE_CLIENT_SECRET=
```

Build the app:

```bash
npm run build
```

Start the production server:

```bash
npm run start
```

The app runs locally with the frontend and `GET /api/pulse` served from the same Node server.

---

## Project Structure

```text
.
├── scripts/
│   ├── pulse-service.mjs   # Blaze API integration, Pulse Engine, and ledger logic
│   └── serve-dist.mjs      # Production server for the app and /api/pulse
├── src/
│   ├── main.tsx            # React application and dashboard components
│   └── styles.css          # V1 dark mode interface
├── index.html              # Vite entry point
├── package.json            # Scripts and dependencies
└── .env.example            # Required environment variable template
```

---

## Screenshots

![Blaze Pulse landing page](screenshots/landing.png)

![Blaze Pulse dashboard](screenshots/dashboard.png)

---

## Future Ideas

- EventSub support
- Historical analytics
- Improved ecosystem forecasting

---

## About

Blaze Pulse was created as a submission for the Blaze Builder Challenge.

The project demonstrates how meaningful creator intelligence can be built from real ecosystem data using the official Blaze API. It stays focused on one job: helping creators understand whether now is the right time to go live.
