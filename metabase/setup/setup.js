const MB_URL = process.env.MB_URL || "http://metabase:3000";
const ADMIN_EMAIL = process.env.MB_ADMIN_EMAIL || "admin@example.com";
const ADMIN_PASSWORD = process.env.MB_ADMIN_PASSWORD || "admin12345";
const ADMIN_FIRST_NAME = process.env.MB_ADMIN_FIRST_NAME || "Demo";
const ADMIN_LAST_NAME = process.env.MB_ADMIN_LAST_NAME || "Admin";
const DB_NAME = process.env.MB_APP_DB_NAME || "Earthquakes";
const DB_HOST = process.env.POSTGRES_HOST || "postgres";
const DB_PORT = Number(process.env.POSTGRES_PORT || 5432);
const DB_DATABASE = process.env.POSTGRES_DB || "earthquakes";
const DB_USER = process.env.POSTGRES_USER || "postgres";
const DB_PASSWORD = process.env.POSTGRES_PASSWORD || "postgres";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function api(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  let response;
  try {
    response = await fetch(`${MB_URL}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });
  } finally {
    clearTimeout(timeout);
  }

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!response.ok) {
    throw new Error(`${options.method || "GET"} ${path} failed: ${response.status} ${text}`);
  }
  return data;
}

async function waitForMetabase() {
  for (let attempt = 1; attempt <= 90; attempt += 1) {
    try {
      const properties = await api("/api/session/properties");
      console.log("Metabase is ready");
      return properties;
    } catch (error) {
      if (attempt % 10 === 0) {
        console.log(`Waiting for Metabase (${attempt}/90): ${error.message}`);
      }
      await sleep(2000);
    }
  }
  throw new Error("Metabase did not become ready in time");
}

async function setupIfNeeded(properties) {
  const token = properties["setup-token"];
  if (!token) {
    console.log("Metabase setup already completed");
    return false;
  }

  console.log("Running first-time Metabase setup");
  try {
    await api("/api/setup", {
      method: "POST",
      body: JSON.stringify({
        token,
        user: {
          first_name: ADMIN_FIRST_NAME,
          last_name: ADMIN_LAST_NAME,
          email: ADMIN_EMAIL,
          password: ADMIN_PASSWORD,
          password_confirm: ADMIN_PASSWORD
        },
        prefs: {
          site_name: "Earthquake Analytics",
          site_locale: "en",
          allow_tracking: false
        },
        database: databasePayload()
      })
    });
    return true;
  } catch (error) {
    if (error.message.includes("a user currently exists")) {
      console.log("Metabase user already exists, continuing with login");
      return false;
    }
    throw error;
  }
}

async function login() {
  const session = await api("/api/session", {
    method: "POST",
    body: JSON.stringify({
      username: ADMIN_EMAIL,
      password: ADMIN_PASSWORD
    })
  });
  return session.id;
}

function isLoginAuthFailure(error) {
  return error instanceof Error && /POST \/api\/session failed: (400|401|403)/.test(error.message);
}

function authHeaders(sessionId) {
  return { "X-Metabase-Session": sessionId };
}

function databasePayload() {
  return {
    engine: "postgres",
    name: DB_NAME,
    details: {
      host: DB_HOST,
      port: DB_PORT,
      dbname: DB_DATABASE,
      user: DB_USER,
      password: DB_PASSWORD,
      ssl: false,
      "tunnel-enabled": false
    },
    is_full_sync: true,
    is_on_demand: false,
    schedules: {}
  };
}

async function ensureDatabase(sessionId) {
  const databases = await api("/api/database", { headers: authHeaders(sessionId) });
  const list = Array.isArray(databases.data) ? databases.data : [];
  const existing = list.find((database) => database.name === DB_NAME);
  if (existing) {
    console.log(`Database already exists: ${DB_NAME} (#${existing.id})`);
    return existing.id;
  }

  const database = await api("/api/database", {
    method: "POST",
    headers: authHeaders(sessionId),
    body: JSON.stringify(databasePayload())
  });
  console.log(`Database created: ${DB_NAME} (#${database.id})`);
  return database.id;
}

async function ensureDashboard(sessionId, databaseId) {
  const dashboards = await api("/api/dashboard", { headers: authHeaders(sessionId) });
  const list = Array.isArray(dashboards) ? dashboards : dashboards.data || [];
  let dashboard = list.find((item) => item.name === "Earthquake BI Overview");

  const cards = [
    await ensureCard(sessionId, databaseId, "Daily seismic activity", "line", `
SELECT eq_date, event_count, avg_magnitude, max_magnitude, tsunami_count
FROM (
  SELECT eq_date, event_count, avg_magnitude, max_magnitude, tsunami_count
  FROM vw_daily_activity
  ORDER BY eq_date DESC
  LIMIT 366
) latest_days
ORDER BY eq_date ASC;
`),
    await ensureCard(sessionId, databaseId, "Magnitude distribution", "bar", `
SELECT magnitude_category, event_count, avg_depth, max_magnitude
FROM vw_magnitude_distribution
ORDER BY event_count DESC;
`),
    await ensureCard(sessionId, databaseId, "Depth distribution", "bar", `
SELECT depth_category, event_count, avg_magnitude, max_depth
FROM vw_depth_distribution
ORDER BY event_count DESC;
`),
    await ensureCard(sessionId, databaseId, "Strongest earthquakes", "table", `
SELECT time, magnitude, depth, place, latitude, longitude, tsunami, alert
FROM vw_strongest_events
LIMIT 20;
`),
    await ensureCard(sessionId, databaseId, "Top active places", "table", `
SELECT place, event_count, avg_magnitude, max_magnitude, avg_depth
FROM vw_top_places
LIMIT 20;
`)
  ];

  if (dashboard) {
    console.log(`Dashboard already exists: Earthquake BI Overview (#${dashboard.id})`);
  } else {
    dashboard = await api("/api/dashboard", {
      method: "POST",
      headers: authHeaders(sessionId),
      body: JSON.stringify({
        name: "Earthquake BI Overview",
        description: "Auto-created local dashboard for the Big Data earthquake analytics prototype."
      })
    });
  }

  const positions = [
    { row: 0, col: 0, size_x: 12, size_y: 8 },
    { row: 0, col: 12, size_x: 6, size_y: 8 },
    { row: 8, col: 0, size_x: 6, size_y: 8 },
    { row: 8, col: 6, size_x: 12, size_y: 8 },
    { row: 16, col: 0, size_x: 18, size_y: 8 }
  ];

  const fullDashboard = await api(`/api/dashboard/${dashboard.id}`, { headers: authHeaders(sessionId) });
  const existingCardIds = new Set((fullDashboard.dashcards || []).map((dashcard) => dashcard.card_id).filter(Boolean));
  const desiredCardIds = cards.map((card) => card.id);
  const alreadyPopulated = desiredCardIds.every((cardId) => existingCardIds.has(cardId));
  if (alreadyPopulated) {
    console.log(`Dashboard already populated: Earthquake BI Overview (#${dashboard.id})`);
    return;
  }

  await updateDashboardCards(sessionId, dashboard.id, cards, positions);
  console.log(`Dashboard populated: Earthquake BI Overview (#${dashboard.id})`);
}

async function ensureCard(sessionId, databaseId, name, display, query) {
  const payload = cardPayload(databaseId, name, display, query);
  const search = await api(`/api/search?models=card&q=${encodeURIComponent(name)}`, {
    headers: authHeaders(sessionId)
  });
  const list = searchResults(search);
  const existing = list.find((card) => card.name === name && !card.archived);
  if (existing) {
    const existingQuery = existing.dataset_query?.native?.query?.trim();
    const existingDatabase = existing.dataset_query?.database;
    if (existing.display === display && existingDatabase === databaseId && existingQuery === payload.dataset_query.native.query) {
      return existing;
    }

    console.log(`Updating card: ${name} (#${existing.id})`);
    return api(`/api/card/${existing.id}`, {
      method: "PUT",
      headers: authHeaders(sessionId),
      body: JSON.stringify({
        ...payload,
        parameters: existing.parameters || [],
        type: existing.type || "question"
      })
    });
  }

  return createCard(sessionId, payload);
}

function searchResults(response) {
  if (Array.isArray(response)) {
    return response;
  }
  if (Array.isArray(response?.data)) {
    return response.data;
  }
  return [];
}

function cardPayload(databaseId, name, display, query) {
  return {
    name,
    display,
    dataset_query: {
      type: "native",
      database: databaseId,
      native: { query: query.trim() }
    },
    visualization_settings: {}
  };
}

async function createCard(sessionId, payload) {
  return api("/api/card", {
    method: "POST",
    headers: authHeaders(sessionId),
    body: JSON.stringify(payload)
  });
}

async function updateDashboardCards(sessionId, dashboardId, cards, positions) {
  await api(`/api/dashboard/${dashboardId}/cards`, {
    method: "PUT",
    headers: authHeaders(sessionId),
    body: JSON.stringify({
      cards: cards.map((card, index) => ({
        id: -index - 1,
        card_id: card.id,
        parameter_mappings: [],
        series: [],
        visualization_settings: {},
        ...positions[index]
      })),
      tabs: []
    })
  });
}

async function main() {
  const properties = await waitForMetabase();
  const setupWasNeeded = await setupIfNeeded(properties);
  let sessionId;
  try {
    sessionId = await login();
  } catch (error) {
    if (!setupWasNeeded && isLoginAuthFailure(error)) {
      console.log("Metabase is already configured with different credentials; skipping local dashboard bootstrap");
      console.log("Set MB_ADMIN_EMAIL and MB_ADMIN_PASSWORD to matching admin credentials if dashboard seeding is needed");
      return;
    }
    throw error;
  }

  const databaseId = await ensureDatabase(sessionId);
  await ensureDashboard(sessionId, databaseId);
  console.log("Metabase local setup complete");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
