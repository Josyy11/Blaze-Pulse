import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { dirname, join } from "node:path";

loadEnvFile();

const API_BASE = process.env.BLAZE_API_BASE_URL || "https://api.blaze.stream";
const TOKEN_URL = process.env.BLAZE_TOKEN_URL || "https://blaze.stream/bapi/oauth2/token";
const STORE_PATH = process.env.BLAZE_PULSE_STORE || join(process.cwd(), "data", "pulse-store.json");
const SNAPSHOT_INTERVAL_MS = 60_000;
const HISTORY_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_STAT_REQUESTS = Number(process.env.BLAZE_PULSE_MAX_CHANNEL_STATS || 120);
const REQUEST_TIMEOUT_MS = Number(process.env.BLAZE_REQUEST_TIMEOUT_MS || 12_000);

let tokenCache = null;
let snapshotPromise = null;
let memoryPulse = null;

export async function handlePulseRequest(_request, response) {
  try {
    const pulse = await getPulse();
    sendJson(response, 200, pulse);
  } catch (error) {
    const store = await readStore();
    const latest = store.rollups.at(-1)?.pulse;

    if (latest) {
      sendJson(response, 200, {
        ...latest,
        lastUpdated: relativeTime(latest.capturedAt),
        status: "stale",
        stale: true,
      });
      return;
    }

    sendJson(response, 503, {
      status: "error",
      error: "Blaze Pulse is not configured yet.",
      detail: getConfigError(error),
    });
  }
}

export async function getPulse() {
  const store = await readStore();
  const latest = store.rollups.at(-1);
  const isFresh = latest && Date.now() - new Date(latest.capturedAt).getTime() < SNAPSHOT_INTERVAL_MS;

  if (isFresh) {
    return {
      ...latest.pulse,
      lastUpdated: relativeTime(latest.capturedAt),
      status: "ready",
    };
  }

  if (!snapshotPromise) {
    snapshotPromise = captureSnapshot().finally(() => {
      snapshotPromise = null;
    });
  }

  return snapshotPromise;
}

async function captureSnapshot() {
  assertConfig();

  const capturedAt = new Date().toISOString();
  const store = await readStore();
  const liveChannels = await fetchLiveChannels();
  const statTargets = liveChannels.slice(0, MAX_STAT_REQUESTS);
  const stats = await fetchChannelStats(statTargets);
  const snapshots = buildSnapshots(capturedAt, liveChannels, stats);
  const nextStore = pruneStore({
    ...store,
    channels: upsertChannels(store.channels, liveChannels),
    snapshots: [...store.snapshots, ...snapshots],
  });
  const pulse = buildPulse(capturedAt, nextStore.snapshots);
  const rollup = { capturedAt, pulse };
  const finalStore = pruneStore({
    ...nextStore,
    rollups: [...nextStore.rollups, rollup],
  });

  await writeStore(finalStore);
  memoryPulse = {
    ...pulse,
    lastUpdated: "just now",
    status: "ready",
  };

  return memoryPulse;
}

async function fetchLiveChannels() {
  const channels = [];
  let cursor = "";

  for (let page = 0; page < 5; page += 1) {
    const params = new URLSearchParams({ type: "live", limit: "200" });
    if (cursor) params.set("cursor", cursor);

    const body = await blazeFetch(`/v1/channels?${params.toString()}`);
    const items = extractItems(body);
    channels.push(...items);

    cursor = body?.nextCursor || body?.pagination?.cursor || body?.pagination?.nextCursor || body?.data?.pagination?.nextCursor || "";
    const hasMore = body?.data?.pagination?.hasMore ?? body?.pagination?.hasMore ?? Boolean(cursor);
    if (!hasMore || !cursor || items.length === 0) break;
  }

  return channels.filter((channel) => channel?.isLive !== false);
}

async function fetchChannelStats(channels) {
  const pairs = [];

  for (const channel of channels) {
    const channelId = channel?.id || channel?.channelId;
    if (!channelId) continue;

    try {
      pairs.push([channelId, await blazeFetch(`/v1/channels/live-stats?channelId=${encodeURIComponent(channelId)}`)]);
    } catch {
      try {
        pairs.push([channelId, await blazeFetch(`/v1/channels/stats?channelId=${encodeURIComponent(channelId)}`)]);
      } catch {
        pairs.push([channelId, null]);
      }
    }
  }

  return new Map(pairs);
}

async function blazeFetch(path) {
  const token = await getAppToken();
  const response = await fetchWithTimeout(`${API_BASE}${path}`, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
      "client-id": process.env.BLAZE_CLIENT_ID,
    },
  });

  if (!response.ok) {
    throw new Error(`Blaze API ${response.status} for ${path}`);
  }

  return response.json();
}

async function getAppToken() {
  if (tokenCache && Date.now() < tokenCache.expiresAt) {
    return tokenCache.accessToken;
  }

  const response = await fetchWithTimeout(TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      grantType: "client_credentials",
      clientId: process.env.BLAZE_CLIENT_ID,
      clientSecret: process.env.BLAZE_CLIENT_SECRET,
    }),
  });

  if (!response.ok) {
    throw new Error(`Blaze token request failed with ${response.status}`);
  }

  const body = await response.json();
  const accessToken = body.accessToken || body.access_token;
  const expiresIn = Number(body.expiresIn || body.expires_in || 3600);

  if (!accessToken) {
    throw new Error("Blaze token response did not include an access token");
  }

  tokenCache = {
    accessToken,
    expiresAt: Date.now() + Math.max(60, expiresIn - 60) * 1000,
  };

  return accessToken;
}

async function fetchWithTimeout(url, options = {}) {
  const target = new URL(url);
  const transport = target.protocol === "http:" ? http : https;
  const body = options.body || null;
  const headers = { ...(options.headers || {}) };

  if (body && !hasHeader(headers, "content-length")) {
    headers["content-length"] = Buffer.byteLength(body);
  }

  return new Promise((resolve, reject) => {
    const request = transport.request(
      target,
      {
        method: options.method || "GET",
        headers,
        timeout: REQUEST_TIMEOUT_MS,
      },
      (response) => {
        let text = "";

        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          text += chunk;
        });
        response.on("end", () => {
          resolve({
            ok: response.statusCode >= 200 && response.statusCode < 300,
            status: response.statusCode,
            headers: response.headers,
            json: async () => (text ? JSON.parse(text) : {}),
            text: async () => text,
          });
        });
      },
    );

    request.on("timeout", () => {
      request.destroy(new Error(`Blaze request timed out after ${REQUEST_TIMEOUT_MS}ms`));
    });
    request.on("error", reject);

    if (body) request.write(body);
    request.end();
  });
}

function hasHeader(headers, headerName) {
  const lowerName = headerName.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === lowerName);
}

function buildSnapshots(capturedAt, channels, stats) {
  return channels.map((channel) => {
    const channelId = channel?.id || channel?.channelId;
    const stat = normalizeObject(stats.get(channelId)?.data ?? stats.get(channelId));
    const category = normalizeObject(channel?.category);

    return {
      capturedAt,
      channelId,
      channelName: channel?.displayName || channel?.title || channel?.slug || "Unknown creator",
      categoryId: category?.id || channel?.categoryId || "uncategorized",
      categoryName: category?.name || channel?.categoryName || "Uncategorized",
      isLive: channel?.isLive !== false || stat?.isLive === true,
      viewerCount: numberFrom(stat?.viewerCount ?? channel?.viewerCount),
      startedAt: stat?.startedAt || channel?.startedAt || null,
      newFollowerCount: numberFrom(stat?.newFollowerCount),
      newSubscriberCount: numberFrom(stat?.newSubscriberCount),
    };
  });
}

function buildPulse(capturedAt, snapshots) {
  const current = latestSnapshotSet(snapshots);
  const previousHour = closestSnapshotSet(snapshots, Date.now() - 60 * 60 * 1000);
  const previous15m = closestSnapshotSet(snapshots, Date.now() - 15 * 60 * 1000);
  const liveViewers = sum(current.map((item) => item.viewerCount));
  const liveCreators = current.length;
  const viewersPerCreator = liveCreators > 0 ? Math.round(liveViewers / liveCreators) : 0;
  const previousViewers = sum(previousHour.map((item) => item.viewerCount));
  const previousCreators = previousHour.length;
  const viewerDelta = percentDelta(liveViewers, previousViewers);
  const creatorDelta = percentDelta(liveCreators, previousCreators);
  const newStreams15m = countNewStreams(current, previous15m, capturedAt);
  const categories = buildCategories(current, previousHour);
  const pressureIndex = calculatePressureIndex(viewersPerCreator, newStreams15m, liveCreators);
  const score = calculateOpportunityScore(viewerDelta, viewersPerCreator, newStreams15m, liveCreators, categories[0]?.trend);
  const state = stateFromScore(score);
  const recommendation = recommendationFor(state);
  const timeline = buildTimeline(snapshots, capturedAt, score);

  return {
    capturedAt,
    state,
    score,
    recommendation,
    recommendationDetail: detailFor(state, viewerDelta, creatorDelta),
    lastUpdated: "just now",
    pressure: {
      label: pressureLabel(pressureIndex),
      index: pressureIndex,
      creatorVelocity: signedPercent(creatorDelta),
      openWindow: `${openWindowMinutes(state, pressureIndex)}m`,
    },
    metrics: [
      { label: "Live viewers", value: compactNumber(liveViewers), delta: signedPercent(viewerDelta), tone: toneForDelta(viewerDelta) },
      { label: "Live creators", value: compactNumber(liveCreators), delta: signedPercent(creatorDelta), tone: toneForDelta(creatorDelta) },
      { label: "Viewers per creator", value: String(viewersPerCreator), delta: signedPercent(percentDelta(viewersPerCreator, ratio(previousViewers, previousCreators))), tone: viewersPerCreator >= 35 ? "positive" : "negative" },
      { label: "New streams / 15m", value: String(newStreams15m), delta: signedPercent(percentDelta(newStreams15m, countNewStreams(previous15m, [], capturedAt))), tone: newStreams15m <= Math.max(4, liveCreators * 0.15) ? "positive" : "negative" },
    ],
    signals: buildSignals(categories, viewerDelta, creatorDelta, pressureIndex),
    categories: categories.slice(0, 4),
    timeline,
  };
}

function buildCategories(current, previousHour) {
  const currentGroups = groupByCategory(current);
  const previousGroups = groupByCategory(previousHour);

  return [...currentGroups.entries()]
    .map(([categoryId, group]) => {
      const previous = previousGroups.get(categoryId) || { viewers: 0, creators: 0 };
      const viewerDelta = percentDelta(group.viewers, previous.viewers);
      const creatorDelta = percentDelta(group.creators, previous.creators);
      const momentum = clamp(50 + viewerDelta - Math.max(0, creatorDelta), 8, 100);

      return {
        name: group.name,
        momentum: Math.round(momentum),
        viewers: compactNumber(group.viewers),
        creators: group.creators,
        trend: viewerDelta > 0 ? "up" : viewerDelta < 0 ? "down" : "flat",
        viewerDelta,
      };
    })
    .sort((left, right) => right.momentum - left.momentum);
}

function buildSignals(categories, viewerDelta, creatorDelta, pressureIndex) {
  const top = categories[0];
  const cooling = categories.find((category) => category.trend === "down");
  const competitionTone = pressureIndex >= 70 ? "negative" : pressureIndex <= 45 ? "positive" : "neutral";

  return [
    {
      label: top ? `${top.name} activity` : "Ecosystem activity",
      value: top?.trend === "up" ? "Surging" : top?.trend === "down" ? "Cooling" : "Active",
      tone: top?.trend === "down" ? "negative" : top?.trend === "up" ? "positive" : "neutral",
      detail: top ? demandDetail(top.viewerDelta) : "Waiting for enough live category data.",
    },
    {
      label: cooling ? `${cooling.name} activity` : "Audience demand",
      value: cooling ? "Cooling" : viewerDelta > 0 ? "Rising" : viewerDelta < 0 ? "Declining" : "Holding",
      tone: cooling || viewerDelta < 0 ? "negative" : viewerDelta > 0 ? "positive" : "neutral",
      detail: cooling ? "Viewers are rotating into faster categories." : demandBaselineDetail(viewerDelta),
    },
    {
      label: "Viewer competition",
      value: pressureLabel(pressureIndex),
      tone: competitionTone,
      detail: creatorDelta <= viewerDelta ? "Creator growth is below viewer growth." : "Creator growth is moving faster than demand.",
    },
    {
      label: "Audience shift",
      value: categories.length > 1 ? "Active" : "Stable",
      tone: "neutral",
      detail: categories.length > 1 ? `Attention is consolidating around ${Math.min(3, categories.length)} categories.` : "Audience concentration is steady.",
    },
  ];
}

function demandBaselineDetail(viewerDelta) {
  if (viewerDelta > 0) return "Viewer demand is above the last-hour baseline.";
  if (viewerDelta < 0) return "Viewer demand is below the last-hour baseline.";
  return "Viewer demand is steady against the current baseline.";
}

function demandDetail(viewerDelta) {
  if (viewerDelta > 0) return `Demand up ${Math.abs(Math.round(viewerDelta))}% in the last hour.`;
  if (viewerDelta < 0) return `Demand down ${Math.abs(Math.round(viewerDelta))}% in the last hour.`;
  return "Demand is holding at the current live baseline.";
}

function buildTimeline(snapshots, capturedAt, currentScore) {
  const points = [];

  for (let index = 11; index >= 0; index -= 1) {
    const target = new Date(new Date(capturedAt).getTime() - index * 2 * 60 * 60 * 1000);
    const set = closestSnapshotSet(snapshots, target.getTime());
    const viewers = sum(set.map((item) => item.viewerCount));
    const creators = set.length;
    const viewersPerCreator = ratio(viewers, creators);
    const score = set.length > 0 ? clamp(Math.round(45 + Math.min(35, viewersPerCreator / 2)), 1, 100) : 50;

    points.push({
      hour: target.getHours().toString().padStart(2, "0"),
      score,
    });
  }

  if (points.length > 0) {
    points[points.length - 1].score = currentScore;
  }

  return points;
}

function latestSnapshotSet(snapshots) {
  const latestTime = snapshots.at(-1)?.capturedAt;
  if (!latestTime) return [];
  return snapshots.filter((item) => item.capturedAt === latestTime && item.isLive);
}

function closestSnapshotSet(snapshots, targetMs) {
  const times = [...new Set(snapshots.map((item) => item.capturedAt))];
  if (times.length === 0) return [];

  const closest = times.reduce((best, time) => {
    const distance = Math.abs(new Date(time).getTime() - targetMs);
    const bestDistance = Math.abs(new Date(best).getTime() - targetMs);
    return distance < bestDistance ? time : best;
  }, times[0]);

  return snapshots.filter((item) => item.capturedAt === closest && item.isLive);
}

function countNewStreams(current, previous, capturedAt) {
  const previousIds = new Set(previous.map((item) => item.channelId));
  const cutoff = new Date(capturedAt).getTime() - 15 * 60 * 1000;

  return current.filter((item) => {
    if (!previousIds.has(item.channelId)) return true;
    if (!item.startedAt) return false;
    return new Date(item.startedAt).getTime() >= cutoff;
  }).length;
}

function calculateOpportunityScore(viewerDelta, viewersPerCreator, newStreams15m, liveCreators, topTrend) {
  let score = 50;

  if (viewerDelta > 5) score += 15;
  else if (viewerDelta >= 0) score += 8;
  else score -= 10;

  if (viewersPerCreator >= 60) score += 15;
  else if (viewersPerCreator >= 35) score += 8;
  else if (viewersPerCreator < 20) score -= 10;

  if (newStreams15m <= Math.max(3, liveCreators * 0.1)) score += 10;
  else if (newStreams15m >= Math.max(6, liveCreators * 0.25)) score -= 10;

  if (topTrend === "up") score += 10;
  else if (topTrend === "down") score -= 5;

  return clamp(score, 1, 100);
}

function calculatePressureIndex(viewersPerCreator, newStreams15m, liveCreators) {
  let pressure = 50;

  if (viewersPerCreator >= 60) pressure -= 20;
  else if (viewersPerCreator >= 35) pressure -= 10;
  else pressure += 15;

  if (newStreams15m >= Math.max(6, liveCreators * 0.25)) pressure += 20;
  else if (newStreams15m <= Math.max(3, liveCreators * 0.1)) pressure -= 10;

  return clamp(pressure, 1, 100);
}

function stateFromScore(score) {
  if (score >= 75) return "Prime";
  if (score >= 60) return "Good";
  if (score >= 45) return "Busy";
  return "Oversaturated";
}

function recommendationFor(state) {
  if (state === "Prime") return "Go live now";
  if (state === "Good") return "Go live soon";
  if (state === "Busy") return "Wait 20 minutes";
  return "Hold for one hour";
}

function detailFor(state, viewerDelta, creatorDelta) {
  if (state === "Prime") return "Viewer demand is rising faster than creator competition. The ecosystem has room for fresh streams.";
  if (state === "Good") return "The window is favorable, but competition is starting to build.";
  if (state === "Busy") return `Demand is ${viewerDelta >= creatorDelta ? "holding" : "lagging"} while creator pressure increases.`;
  return "Creator pressure is outpacing viewer demand. Waiting should improve the launch window.";
}

function pressureLabel(index) {
  if (index >= 70) return "High";
  if (index >= 50) return "Busy";
  return "Manageable";
}

function openWindowMinutes(state, pressureIndex) {
  if (state === "Prime") return pressureIndex < 40 ? 45 : 30;
  if (state === "Good") return 20;
  if (state === "Busy") return 10;
  return 0;
}

function groupByCategory(items) {
  const groups = new Map();

  for (const item of items) {
    const existing = groups.get(item.categoryId) || {
      name: item.categoryName,
      viewers: 0,
      creators: 0,
    };
    existing.viewers += item.viewerCount;
    existing.creators += 1;
    groups.set(item.categoryId, existing);
  }

  return groups;
}

function upsertChannels(existing, channels) {
  const next = { ...existing };

  for (const channel of channels) {
    const id = channel?.id || channel?.channelId;
    if (!id) continue;
    const category = normalizeObject(channel?.category);
    next[id] = {
      id,
      displayName: channel?.displayName || channel?.title || channel?.slug || "Unknown creator",
      slug: channel?.slug || null,
      avatarUrl: channel?.avatarUrl || null,
      categoryId: category?.id || channel?.categoryId || "uncategorized",
      categoryName: category?.name || channel?.categoryName || "Uncategorized",
      lastSeenAt: new Date().toISOString(),
    };
  }

  return next;
}

async function readStore() {
  try {
    return normalizeStore(JSON.parse(await readFile(STORE_PATH, "utf8")));
  } catch {
    return normalizeStore({});
  }
}

async function writeStore(store) {
  await mkdir(dirname(STORE_PATH), { recursive: true });
  await writeFile(STORE_PATH, `${JSON.stringify(store, null, 2)}\n`);
}

function pruneStore(store) {
  const cutoff = Date.now() - HISTORY_WINDOW_MS;
  return {
    channels: store.channels,
    snapshots: store.snapshots.filter((item) => new Date(item.capturedAt).getTime() >= cutoff),
    rollups: store.rollups.filter((item) => new Date(item.capturedAt).getTime() >= cutoff),
  };
}

function normalizeStore(store) {
  return {
    channels: store.channels || {},
    snapshots: Array.isArray(store.snapshots) ? store.snapshots : [],
    rollups: Array.isArray(store.rollups) ? store.rollups : [],
  };
}

function extractItems(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.data?.rows)) return body.data.rows;
  if (Array.isArray(body?.data)) return body.data;
  if (Array.isArray(body?.rows)) return body.rows;
  if (Array.isArray(body?.items)) return body.items;
  if (Array.isArray(body?.channels)) return body.channels;
  return [];
}

function normalizeObject(value) {
  if (Array.isArray(value)) return value[0] || {};
  return value && typeof value === "object" ? value : {};
}

function numberFrom(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function percentDelta(current, previous) {
  if (!previous) return current > 0 ? 0 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

function signedPercent(value) {
  const rounded = Math.round(value);
  return `${rounded >= 0 ? "+" : ""}${rounded}%`;
}

function toneForDelta(value) {
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "neutral";
}

function compactNumber(value) {
  if (value >= 1_000_000) return `${trimDecimal(value / 1_000_000)}M`;
  if (value >= 1_000) return `${trimDecimal(value / 1_000)}K`;
  return String(Math.round(value));
}

function trimDecimal(value) {
  return value >= 10 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, "");
}

function relativeTime(iso) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds} seconds ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hours ago`;
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function ratio(total, count) {
  return count > 0 ? Math.round(total / count) : 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "cache-control": "no-store, max-age=0",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

function assertConfig() {
  if (!process.env.BLAZE_CLIENT_ID || !process.env.BLAZE_CLIENT_SECRET) {
    throw new Error("Missing BLAZE_CLIENT_ID or BLAZE_CLIENT_SECRET");
  }
}

function loadEnvFile() {
  const envPath = join(process.cwd(), ".env");
  if (!existsSync(envPath)) return;

  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    const value = rawValue.replace(/^["']|["']$/g, "");

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function getConfigError(error) {
  if (error instanceof Error) return error.message;
  return "Unknown configuration error";
}
