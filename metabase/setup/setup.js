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

const BI_FILTERS = [
  { id: "start_date", name: "Start date", slug: "start_date", sectionId: "date", dashboardType: "date/single", cardType: "date/single", tagType: "date" },
  { id: "end_date", name: "End date", slug: "end_date", sectionId: "date", dashboardType: "date/single", cardType: "date/single", tagType: "date" },
  { id: "min_magnitude", name: "Min magnitude", slug: "min_magnitude", sectionId: "number", dashboardType: "number/>=", cardType: "number/=", tagType: "number" },
  { id: "max_magnitude", name: "Max magnitude", slug: "max_magnitude", sectionId: "number", dashboardType: "number/<=", cardType: "number/=", tagType: "number" },
  { id: "min_depth", name: "Min depth", slug: "min_depth", sectionId: "number", dashboardType: "number/>=", cardType: "number/=", tagType: "number" },
  { id: "max_depth", name: "Max depth", slug: "max_depth", sectionId: "number", dashboardType: "number/<=", cardType: "number/=", tagType: "number" },
  { id: "alert_level", name: "Alert level", slug: "alert_level", sectionId: "string", dashboardType: "category", cardType: "category", tagType: "text" },
  { id: "event_type", name: "Event type", slug: "event_type", sectionId: "string", dashboardType: "category", cardType: "category", tagType: "text" },
  { id: "tsunami_flag", name: "Tsunami flag", slug: "tsunami_flag", sectionId: "string", dashboardType: "category", cardType: "category", tagType: "text" }
];

const BI_DASHBOARD_PARAMETERS = BI_FILTERS.map(({ id, name, slug, sectionId, dashboardType }) => ({
  id,
  name,
  slug,
  sectionId,
  type: dashboardType
}));

const BI_CARD_PARAMETERS = BI_FILTERS.map(({ id, name, slug, cardType }) => ({
  id,
  name,
  slug,
  type: cardType,
  target: ["variable", ["template-tag", id]]
}));

const BI_TEMPLATE_TAGS = Object.fromEntries(BI_FILTERS.map(({ id, name, tagType }) => [
  id,
  {
    id,
    name: id,
    "display-name": name,
    type: tagType,
    required: false
  }
]));

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

function biFilterWhere(alias = "") {
  const column = (name) => `${alias ? `${alias}.` : ""}${name}`;
  return `
[[AND ${column("time")} >= {{start_date}}]]
[[AND ${column("time")} < ({{end_date}} + INTERVAL '1 day')]]
[[AND ${column("magnitude")} >= {{min_magnitude}}]]
[[AND ${column("magnitude")} <= {{max_magnitude}}]]
[[AND ${column("depth")} >= {{min_depth}}]]
[[AND ${column("depth")} <= {{max_depth}}]]
[[AND COALESCE(NULLIF(${column("alert")}, ''), 'none') = {{alert_level}}]]
[[AND COALESCE(NULLIF(${column("type")}, ''), 'unknown') = {{event_type}}]]
[[AND ${column("tsunami")}::text = {{tsunami_flag}}]]`;
}

function magnitudeCategoryExpression(alias = "") {
  const magnitude = `${alias ? `${alias}.` : ""}magnitude`;
  return `CASE
    WHEN ${magnitude} IS NULL THEN 'Unknown'
    WHEN ${magnitude} < 3 THEN 'Minor'
    WHEN ${magnitude} >= 3 AND ${magnitude} < 5 THEN 'Light'
    WHEN ${magnitude} >= 5 AND ${magnitude} < 7 THEN 'Moderate'
    ELSE 'Severe'
  END`;
}

function depthCategoryExpression(alias = "") {
  const depth = `${alias ? `${alias}.` : ""}depth`;
  return `CASE
    WHEN ${depth} IS NULL THEN 'Unknown'
    WHEN ${depth} < 70 THEN 'Shallow'
    WHEN ${depth} >= 70 AND ${depth} < 300 THEN 'Intermediate'
    ELSE 'Deep'
  END`;
}

function mapSettings(latitude = "latitude", longitude = "longitude", metric = "event_count") {
  return {
    "map.type": "pin",
    "map.latitude_column": latitude,
    "map.longitude_column": longitude,
    "map.metric_column": metric
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

async function ensureDashboards(sessionId, databaseId) {
  const dashboards = [
    {
      name: "Earthquake BI Overview",
      description: "Executive overview for the Big Data earthquake analytics prototype.",
      parameters: BI_DASHBOARD_PARAMETERS,
      cards: [
        await ensureCard(sessionId, databaseId, "Total events", "scalar", `
SELECT COUNT(*) AS total_events
FROM earthquakes e
WHERE 1=1
${biFilterWhere("e")};
`, { filters: true }),
        await ensureCard(sessionId, databaseId, "Strongest magnitude", "scalar", `
SELECT ROUND(MAX(magnitude)::numeric, 2) AS strongest_magnitude
FROM earthquakes e
WHERE 1=1
${biFilterWhere("e")};
`, { filters: true }),
        await ensureCard(sessionId, databaseId, "Significant events", "scalar", `
SELECT COUNT(*) AS significant_events
FROM earthquakes e
WHERE magnitude >= 5
${biFilterWhere("e")};
`, { filters: true }),
        await ensureCard(sessionId, databaseId, "Tsunami events", "scalar", `
SELECT COUNT(*) AS tsunami_events
FROM earthquakes e
WHERE tsunami = 1
${biFilterWhere("e")};
`, { filters: true }),
        await ensureCard(sessionId, databaseId, "Daily seismic activity", "line", `
SELECT eq_date, event_count, avg_magnitude, max_magnitude, tsunami_count
FROM (
  SELECT
    DATE(e.time) AS eq_date,
    COUNT(*) AS event_count,
    AVG(e.magnitude) AS avg_magnitude,
    MAX(e.magnitude) AS max_magnitude,
    COUNT(*) FILTER (WHERE e.tsunami = 1) AS tsunami_count
  FROM earthquakes e
  WHERE 1=1
  ${biFilterWhere("e")}
  GROUP BY DATE(e.time)
  ORDER BY eq_date DESC
  LIMIT 366
) latest_days
ORDER BY eq_date ASC;
`, { filters: true }),
        await ensureCard(sessionId, databaseId, "Magnitude distribution", "bar", `
SELECT
  ${magnitudeCategoryExpression("e")} AS magnitude_category,
  COUNT(*) AS event_count,
  AVG(e.depth) AS avg_depth,
  MAX(e.magnitude) AS max_magnitude
FROM earthquakes e
WHERE 1=1
${biFilterWhere("e")}
GROUP BY magnitude_category
ORDER BY event_count DESC;
`, { filters: true }),
        await ensureCard(sessionId, databaseId, "Depth distribution", "bar", `
SELECT
  ${depthCategoryExpression("e")} AS depth_category,
  COUNT(*) AS event_count,
  AVG(e.magnitude) AS avg_magnitude,
  MAX(e.depth) AS max_depth
FROM earthquakes e
WHERE 1=1
${biFilterWhere("e")}
GROUP BY depth_category
ORDER BY event_count DESC;
`, { filters: true }),
        await ensureCard(sessionId, databaseId, "Strongest earthquakes", "table", `
SELECT e.time, e.magnitude, e.depth, e.place, e.latitude, e.longitude, e.tsunami, e.alert
FROM earthquakes e
WHERE 1=1
${biFilterWhere("e")}
ORDER BY e.magnitude DESC NULLS LAST, e.time DESC
LIMIT 50;
`, { filters: true }),
        await ensureCard(sessionId, databaseId, "Top active places", "table", `
SELECT
  COALESCE(NULLIF(e.place, ''), 'Unknown') AS place,
  COUNT(*) AS event_count,
  AVG(e.magnitude) AS avg_magnitude,
  MAX(e.magnitude) AS max_magnitude,
  AVG(e.depth) AS avg_depth
FROM earthquakes e
WHERE 1=1
${biFilterWhere("e")}
GROUP BY COALESCE(NULLIF(e.place, ''), 'Unknown')
ORDER BY event_count DESC
LIMIT 50;
`, { filters: true })
      ],
      positions: [
        { row: 0, col: 0, size_x: 6, size_y: 4 },
        { row: 0, col: 6, size_x: 6, size_y: 4 },
        { row: 0, col: 12, size_x: 6, size_y: 4 },
        { row: 0, col: 18, size_x: 6, size_y: 4 },
        { row: 4, col: 0, size_x: 16, size_y: 8 },
        { row: 4, col: 16, size_x: 8, size_y: 8 },
        { row: 12, col: 0, size_x: 8, size_y: 8 },
        { row: 12, col: 8, size_x: 16, size_y: 8 },
        { row: 20, col: 0, size_x: 24, size_y: 8 }
      ]
    },
    {
      name: "Earthquake Temporal Trends",
      description: "Long-term activity trends by year, month, magnitude, and tsunami signal.",
      parameters: BI_DASHBOARD_PARAMETERS,
      cards: [
        await ensureCard(sessionId, databaseId, "Yearly seismic activity", "line", `
SELECT
  DATE_TRUNC('year', e.time)::date AS eq_year,
  COUNT(*) AS event_count,
  COUNT(*) FILTER (WHERE e.magnitude >= 5) AS significant_count,
  COUNT(*) FILTER (WHERE e.tsunami = 1) AS tsunami_count,
  AVG(e.magnitude) AS avg_magnitude,
  MAX(e.magnitude) AS max_magnitude
FROM earthquakes e
WHERE 1=1
${biFilterWhere("e")}
GROUP BY DATE_TRUNC('year', e.time)::date
ORDER BY eq_year ASC;
`, { filters: true }),
        await ensureCard(sessionId, databaseId, "Monthly seismic activity", "line", `
SELECT eq_month, event_count, significant_count, tsunami_count, avg_magnitude
FROM (
  SELECT
    DATE_TRUNC('month', e.time)::date AS eq_month,
    COUNT(*) AS event_count,
    COUNT(*) FILTER (WHERE e.magnitude >= 5) AS significant_count,
    COUNT(*) FILTER (WHERE e.tsunami = 1) AS tsunami_count,
    AVG(e.magnitude) AS avg_magnitude
  FROM earthquakes e
  WHERE 1=1
  ${biFilterWhere("e")}
  GROUP BY DATE_TRUNC('month', e.time)::date
  ORDER BY eq_month DESC
  LIMIT 120
) latest_months
ORDER BY eq_month ASC;
`, { filters: true }),
        await ensureCard(sessionId, databaseId, "Monthly significant earthquakes", "bar", `
SELECT eq_month, significant_count, max_magnitude
FROM (
  SELECT
    DATE_TRUNC('month', e.time)::date AS eq_month,
    COUNT(*) FILTER (WHERE e.magnitude >= 5) AS significant_count,
    MAX(e.magnitude) AS max_magnitude
  FROM earthquakes e
  WHERE 1=1
  ${biFilterWhere("e")}
  GROUP BY DATE_TRUNC('month', e.time)::date
  ORDER BY eq_month DESC
  LIMIT 120
) latest_months
ORDER BY eq_month ASC;
`, { filters: true }),
        await ensureCard(sessionId, databaseId, "Event type distribution", "bar", `
SELECT
  COALESCE(NULLIF(e.type, ''), 'unknown') AS event_type,
  COUNT(*) AS event_count,
  AVG(e.magnitude) AS avg_magnitude,
  MAX(e.magnitude) AS max_magnitude
FROM earthquakes e
WHERE 1=1
${biFilterWhere("e")}
GROUP BY COALESCE(NULLIF(e.type, ''), 'unknown')
ORDER BY event_count DESC
LIMIT 20;
`, { filters: true }),
        await ensureCard(sessionId, databaseId, "Data coverage by year", "table", `
SELECT
  DATE_TRUNC('year', e.time)::date AS eq_year,
  COUNT(*) AS event_count,
  COUNT(*) FILTER (WHERE e.magnitude >= 5) AS significant_count,
  COUNT(*) FILTER (WHERE e.tsunami = 1) AS tsunami_count,
  AVG(e.magnitude) AS avg_magnitude,
  MAX(e.magnitude) AS max_magnitude,
  AVG(e.depth) AS avg_depth
FROM earthquakes e
WHERE 1=1
${biFilterWhere("e")}
GROUP BY DATE_TRUNC('year', e.time)::date
ORDER BY eq_year DESC;
`, { filters: true })
      ],
      positions: [
        { row: 0, col: 0, size_x: 12, size_y: 8 },
        { row: 0, col: 12, size_x: 12, size_y: 8 },
        { row: 8, col: 0, size_x: 12, size_y: 8 },
        { row: 8, col: 12, size_x: 12, size_y: 8 },
        { row: 16, col: 0, size_x: 24, size_y: 8 }
      ]
    },
    {
      name: "Earthquake Risk Monitor",
      description: "Focused view for stronger earthquakes, alert levels, tsunami events, and depth/magnitude risk patterns.",
      parameters: BI_DASHBOARD_PARAMETERS,
      cards: [
        await ensureCard(sessionId, databaseId, "Alert distribution", "bar", `
SELECT
  COALESCE(NULLIF(e.alert, ''), 'none') AS alert_level,
  COUNT(*) AS event_count,
  AVG(e.magnitude) AS avg_magnitude,
  MAX(e.magnitude) AS max_magnitude,
  COUNT(*) FILTER (WHERE e.tsunami = 1) AS tsunami_count
FROM earthquakes e
WHERE 1=1
${biFilterWhere("e")}
GROUP BY COALESCE(NULLIF(e.alert, ''), 'none')
ORDER BY event_count DESC;
`, { filters: true }),
        await ensureCard(sessionId, databaseId, "Tsunami activity by month", "line", `
SELECT eq_month, tsunami_count, avg_magnitude, max_magnitude, avg_depth
FROM (
  SELECT
    DATE_TRUNC('month', e.time)::date AS eq_month,
    COUNT(*) AS tsunami_count,
    AVG(e.magnitude) AS avg_magnitude,
    MAX(e.magnitude) AS max_magnitude,
    AVG(e.depth) AS avg_depth
  FROM earthquakes e
  WHERE e.tsunami = 1
  ${biFilterWhere("e")}
  GROUP BY DATE_TRUNC('month', e.time)::date
  ORDER BY eq_month DESC
  LIMIT 120
) latest_months
ORDER BY eq_month ASC;
`, { filters: true }),
        await ensureCard(sessionId, databaseId, "Depth and magnitude matrix", "table", `
SELECT
  ${depthCategoryExpression("e")} AS depth_category,
  ${magnitudeCategoryExpression("e")} AS magnitude_category,
  COUNT(*) AS event_count,
  AVG(e.magnitude) AS avg_magnitude,
  AVG(e.depth) AS avg_depth
FROM earthquakes e
WHERE 1=1
${biFilterWhere("e")}
GROUP BY depth_category, magnitude_category
ORDER BY depth_category, magnitude_category;
`, { filters: true }),
        await ensureCard(sessionId, databaseId, "High-risk recent earthquakes", "table", `
SELECT
  e.time,
  e.magnitude,
  e.depth,
  e.place,
  e.latitude,
  e.longitude,
  e.tsunami,
  e.alert,
  CONCAT_WS(
    ', ',
    CASE WHEN e.magnitude >= 6 THEN 'magnitude >= 6' END,
    CASE WHEN e.tsunami = 1 THEN 'tsunami' END,
    CASE WHEN e.alert IN ('orange', 'red') THEN 'high alert' END
  ) AS risk_reason
FROM earthquakes e
WHERE (e.magnitude >= 6 OR e.tsunami = 1 OR e.alert IN ('orange', 'red'))
${biFilterWhere("e")}
ORDER BY e.time DESC
LIMIT 50;
`, { filters: true })
      ],
      positions: [
        { row: 0, col: 0, size_x: 12, size_y: 8 },
        { row: 0, col: 12, size_x: 12, size_y: 8 },
        { row: 8, col: 0, size_x: 10, size_y: 8 },
        { row: 8, col: 10, size_x: 14, size_y: 8 }
      ]
    },
    {
      name: "Earthquake Geographic Hotspots",
      description: "Regional activity hotspots and location tables for spatial exploration.",
      parameters: BI_DASHBOARD_PARAMETERS,
      cards: [
        await ensureCard(sessionId, databaseId, "Regional hotspot map", "map", `
WITH bucketed AS (
  SELECT
    FLOOR(e.latitude / 10) * 10 AS lat_min,
    FLOOR(e.longitude / 10) * 10 AS lon_min,
    e.magnitude,
    e.depth,
    e.tsunami
  FROM earthquakes e
  WHERE 1=1
  ${biFilterWhere("e")}
)
SELECT
  lat_min + 5 AS latitude,
  lon_min + 5 AS longitude,
  COUNT(*) AS event_count,
  AVG(magnitude) AS avg_magnitude,
  MAX(magnitude) AS max_magnitude,
  AVG(depth) AS avg_depth,
  COUNT(*) FILTER (WHERE tsunami = 1) AS tsunami_count
FROM bucketed
GROUP BY lat_min, lon_min
HAVING COUNT(*) >= 5
ORDER BY event_count DESC
LIMIT 1000;
`, { filters: true, visualizationSettings: mapSettings("latitude", "longitude", "event_count") }),
        await ensureCard(sessionId, databaseId, "High-risk event map", "map", `
SELECT
  e.latitude,
  e.longitude,
  e.magnitude,
  e.depth,
  e.place,
  e.time,
  e.tsunami,
  e.alert
FROM earthquakes e
WHERE (e.magnitude >= 6 OR e.tsunami = 1 OR e.alert IN ('orange', 'red'))
${biFilterWhere("e")}
ORDER BY e.time DESC
LIMIT 1000;
`, { filters: true, visualizationSettings: mapSettings("latitude", "longitude", "magnitude") }),
        await ensureCard(sessionId, databaseId, "Regional hotspot grid", "table", `
WITH bucketed AS (
  SELECT
    FLOOR(e.latitude / 10) * 10 AS lat_min,
    FLOOR(e.longitude / 10) * 10 AS lon_min,
    e.magnitude,
    e.depth,
    e.tsunami
  FROM earthquakes e
  WHERE 1=1
  ${biFilterWhere("e")}
)
SELECT
  lat_min,
  lon_min,
  lat_min + 5 AS latitude,
  lon_min + 5 AS longitude,
  COUNT(*) AS event_count,
  AVG(magnitude) AS avg_magnitude,
  MAX(magnitude) AS max_magnitude,
  AVG(depth) AS avg_depth,
  COUNT(*) FILTER (WHERE tsunami = 1) AS tsunami_count
FROM bucketed
GROUP BY lat_min, lon_min
HAVING COUNT(*) >= 5
ORDER BY event_count DESC
LIMIT 100;
`, { filters: true }),
        await ensureCard(sessionId, databaseId, "Top active places", "table", `
SELECT
  COALESCE(NULLIF(e.place, ''), 'Unknown') AS place,
  COUNT(*) AS event_count,
  AVG(e.magnitude) AS avg_magnitude,
  MAX(e.magnitude) AS max_magnitude,
  AVG(e.depth) AS avg_depth
FROM earthquakes e
WHERE 1=1
${biFilterWhere("e")}
GROUP BY COALESCE(NULLIF(e.place, ''), 'Unknown')
ORDER BY event_count DESC
LIMIT 50;
`, { filters: true }),
        await ensureCard(sessionId, databaseId, "Strongest earthquakes", "table", `
SELECT e.time, e.magnitude, e.depth, e.place, e.latitude, e.longitude, e.tsunami, e.alert
FROM earthquakes e
WHERE 1=1
${biFilterWhere("e")}
ORDER BY e.magnitude DESC NULLS LAST, e.time DESC
LIMIT 50;
`, { filters: true })
      ],
      positions: [
        { row: 0, col: 0, size_x: 12, size_y: 9 },
        { row: 0, col: 12, size_x: 12, size_y: 9 },
        { row: 9, col: 0, size_x: 24, size_y: 8 },
        { row: 17, col: 0, size_x: 12, size_y: 8 },
        { row: 17, col: 12, size_x: 12, size_y: 8 }
      ]
    },
    {
      name: "Earthquake Data Coverage & Quality",
      description: "Dataset coverage, missing fields, ingestion recency, magnitude thresholds, and import state.",
      parameters: BI_DASHBOARD_PARAMETERS,
      cards: [
        await ensureCard(sessionId, databaseId, "Quality: total events", "scalar", `
SELECT COUNT(*) AS total_events
FROM earthquakes e
WHERE 1=1
${biFilterWhere("e")};
`, { filters: true }),
        await ensureCard(sessionId, databaseId, "Quality: missing magnitude", "scalar", `
SELECT COUNT(*) AS missing_magnitude
FROM earthquakes e
WHERE e.magnitude IS NULL
${biFilterWhere("e")};
`, { filters: true }),
        await ensureCard(sessionId, databaseId, "Quality: missing depth", "scalar", `
SELECT COUNT(*) AS missing_depth
FROM earthquakes e
WHERE e.depth IS NULL
${biFilterWhere("e")};
`, { filters: true }),
        await ensureCard(sessionId, databaseId, "Quality: coverage by threshold", "bar", `
SELECT
  threshold.label,
  threshold.min_magnitude,
  COUNT(e.id) AS event_count
FROM (
  VALUES
    ('all', NULL::double precision),
    ('1.0+', 1.0),
    ('2.5+', 2.5),
    ('4.5+', 4.5),
    ('5.0+', 5.0),
    ('6.0+', 6.0),
    ('7.0+', 7.0)
) AS threshold(label, min_magnitude)
LEFT JOIN earthquakes e
  ON (threshold.min_magnitude IS NULL OR e.magnitude >= threshold.min_magnitude)
  ${biFilterWhere("e")}
GROUP BY threshold.label, threshold.min_magnitude
ORDER BY threshold.min_magnitude NULLS FIRST;
`, { filters: true }),
        await ensureCard(sessionId, databaseId, "Quality: recent ingestion", "line", `
SELECT ingest_date, event_count, oldest_event_time, newest_event_time
FROM (
  SELECT
    DATE(e.ingested_at) AS ingest_date,
    COUNT(*) AS event_count,
    MIN(e.time) AS oldest_event_time,
    MAX(e.time) AS newest_event_time
  FROM earthquakes e
  WHERE 1=1
  ${biFilterWhere("e")}
  GROUP BY DATE(e.ingested_at)
  ORDER BY ingest_date DESC
  LIMIT 90
) recent
ORDER BY ingest_date ASC;
`, { filters: true }),
        await ensureCard(sessionId, databaseId, "Quality: missing fields", "bar", `
WITH counts AS (
  SELECT
    COUNT(*)::numeric AS total_events,
    COUNT(*) FILTER (WHERE e.magnitude IS NULL) AS missing_magnitude,
    COUNT(*) FILTER (WHERE e.depth IS NULL) AS missing_depth,
    COUNT(*) FILTER (WHERE e.place IS NULL OR e.place = '') AS missing_place,
    COUNT(*) FILTER (WHERE e.alert IS NULL OR e.alert = '') AS missing_alert,
    COUNT(*) FILTER (WHERE e.type IS NULL OR e.type = '') AS missing_type
  FROM earthquakes e
  WHERE 1=1
  ${biFilterWhere("e")}
)
SELECT 'magnitude' AS field_name, missing_magnitude AS missing_count, ROUND((missing_magnitude::numeric / NULLIF(total_events, 0)) * 100, 2) AS missing_percent
FROM counts
UNION ALL
SELECT 'depth', missing_depth, ROUND((missing_depth::numeric / NULLIF(total_events, 0)) * 100, 2)
FROM counts
UNION ALL
SELECT 'place', missing_place, ROUND((missing_place::numeric / NULLIF(total_events, 0)) * 100, 2)
FROM counts
UNION ALL
SELECT 'alert', missing_alert, ROUND((missing_alert::numeric / NULLIF(total_events, 0)) * 100, 2)
FROM counts
UNION ALL
SELECT 'type', missing_type, ROUND((missing_type::numeric / NULLIF(total_events, 0)) * 100, 2)
FROM counts
ORDER BY missing_count DESC;
`, { filters: true }),
        await ensureCard(sessionId, databaseId, "Quality: data by year", "table", `
SELECT
  DATE_TRUNC('year', e.time)::date AS eq_year,
  COUNT(*) AS event_count,
  COUNT(*) FILTER (WHERE e.magnitude IS NULL) AS missing_magnitude,
  COUNT(*) FILTER (WHERE e.depth IS NULL) AS missing_depth,
  COUNT(*) FILTER (WHERE e.place IS NULL OR e.place = '') AS missing_place,
  COUNT(*) FILTER (WHERE e.alert IS NULL OR e.alert = '') AS missing_alert,
  COUNT(*) FILTER (WHERE e.magnitude >= 2.5) AS magnitude_2_5_plus,
  COUNT(*) FILTER (WHERE e.magnitude >= 5) AS magnitude_5_plus
FROM earthquakes e
WHERE 1=1
${biFilterWhere("e")}
GROUP BY DATE_TRUNC('year', e.time)::date
ORDER BY eq_year DESC;
`, { filters: true }),
        await ensureCard(sessionId, databaseId, "Quality: import state", "table", `
SELECT key, updated_at, job_id, job_kind, job_status, job_message, progress, raw_value
FROM vw_import_state_status
ORDER BY updated_at DESC;
`)
      ],
      positions: [
        { row: 0, col: 0, size_x: 6, size_y: 4 },
        { row: 0, col: 6, size_x: 6, size_y: 4 },
        { row: 0, col: 12, size_x: 6, size_y: 4 },
        { row: 0, col: 18, size_x: 6, size_y: 4 },
        { row: 4, col: 0, size_x: 12, size_y: 8 },
        { row: 4, col: 12, size_x: 12, size_y: 8 },
        { row: 12, col: 0, size_x: 16, size_y: 8 },
        { row: 12, col: 16, size_x: 8, size_y: 8 }
      ]
    }
  ];

  for (const dashboard of dashboards) {
    await ensureDashboard(sessionId, dashboard);
  }
}

async function ensureDashboard(sessionId, definition) {
  const dashboards = await api("/api/dashboard", { headers: authHeaders(sessionId) });
  const list = Array.isArray(dashboards) ? dashboards : dashboards.data || [];
  let dashboard = list.find((item) => item.name === definition.name);
  let created = false;

  if (dashboard) {
    console.log(`Dashboard already exists: ${definition.name} (#${dashboard.id})`);
  } else {
    dashboard = await api("/api/dashboard", {
      method: "POST",
      headers: authHeaders(sessionId),
      body: JSON.stringify({
        name: definition.name,
        description: definition.description
      })
    });
    created = true;
  }

  let fullDashboard = await api(`/api/dashboard/${dashboard.id}`, { headers: authHeaders(sessionId) });
  await api(`/api/dashboard/${dashboard.id}`, {
    method: "PUT",
    headers: authHeaders(sessionId),
    body: JSON.stringify({
      name: definition.name,
      description: definition.description,
      parameters: mergeDashboardParameters(fullDashboard.parameters || [], definition.parameters || []),
      width: "full"
    })
  });
  fullDashboard = await api(`/api/dashboard/${dashboard.id}`, { headers: authHeaders(sessionId) });

  const desiredCardsById = new Map(definition.cards.map((card) => [card.id, card]));
  const existingDashcards = fullDashboard.dashcards || [];
  const existingCardIds = new Set((fullDashboard.dashcards || []).map((dashcard) => dashcard.card_id).filter(Boolean));
  const missingCards = definition.cards.filter((card) => !existingCardIds.has(card.id));
  const needsMappingSync = dashboardCardsNeedMappingSync(existingDashcards, desiredCardsById);
  if (!created && missingCards.length === 0 && !needsMappingSync) {
    console.log(`Dashboard already populated: ${definition.name} (#${dashboard.id})`);
    return;
  }

  await updateDashboardCards(sessionId, dashboard.id, {
    existingDashcards: created ? [] : existingDashcards,
    desiredCardsById,
    tabs: fullDashboard.tabs || [],
    cards: created ? definition.cards : missingCards,
    positions: created ? definition.positions : definition.positions.filter((_, index) => !existingCardIds.has(definition.cards[index].id))
  });
  console.log(`Dashboard synced: ${definition.name} (#${dashboard.id})`);
}

async function ensureCard(sessionId, databaseId, name, display, query, options = {}) {
  const payload = cardPayload(databaseId, name, display, query, options);
  const search = await api(`/api/search?models=card&q=${encodeURIComponent(name)}`, {
    headers: authHeaders(sessionId)
  });
  const list = searchResults(search);
  const existing = list.find((card) => card.name === name && !card.archived);
  if (existing) {
    const current = await api(`/api/card/${existing.id}`, {
      headers: authHeaders(sessionId)
    });
    if (sameCardPayload(current, payload)) {
      return current;
    }

    console.log(`Updating card: ${name} (#${existing.id})`);
    return api(`/api/card/${existing.id}`, {
      method: "PUT",
      headers: authHeaders(sessionId),
      body: JSON.stringify({
        ...payload,
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

function sameCardPayload(existing, payload) {
  return existing.display === payload.display
    && existing.dataset_query?.database === payload.dataset_query.database
    && existing.dataset_query?.native?.query?.trim() === payload.dataset_query.native.query
    && stableStringify(existing.dataset_query?.native?.["template-tags"] || {}) === stableStringify(payload.dataset_query.native["template-tags"] || {})
    && stableStringify(existing.parameters || []) === stableStringify(payload.parameters || [])
    && stableStringify(existing.visualization_settings || {}) === stableStringify(payload.visualization_settings || {});
}

function mergeDashboardParameters(existing, desired) {
  const desiredById = new Map(desired.map((parameter) => [parameter.id, parameter]));
  const merged = desired.map((parameter) => ({
    ...(existing.find((current) => current.id === parameter.id) || {}),
    ...parameter
  }));
  for (const parameter of existing) {
    if (!desiredById.has(parameter.id)) {
      merged.push(parameter);
    }
  }
  return merged;
}

function dashboardCardsNeedMappingSync(dashcards, desiredCardsById) {
  return dashcards.some((dashcard) => {
    const desiredCard = desiredCardsById.get(dashcard.card_id);
    if (!desiredCard) {
      return false;
    }
    return stableStringify(dashcard.parameter_mappings || []) !== stableStringify(cardParameterMappings(desiredCard));
  });
}

function cardPayload(databaseId, name, display, query, options = {}) {
  const native = { query: query.trim() };
  if (options.filters) {
    native["template-tags"] = BI_TEMPLATE_TAGS;
  }

  return {
    name,
    display,
    dataset_query: {
      type: "native",
      database: databaseId,
      native
    },
    parameters: options.filters ? BI_CARD_PARAMETERS : [],
    visualization_settings: options.visualizationSettings || {}
  };
}

async function createCard(sessionId, payload) {
  return api("/api/card", {
    method: "POST",
    headers: authHeaders(sessionId),
    body: JSON.stringify(payload)
  });
}

async function updateDashboardCards(sessionId, dashboardId, { existingDashcards, desiredCardsById, tabs, cards, positions }) {
  const rowOffset = existingDashcards.reduce((maxRow, dashcard) => Math.max(maxRow, (dashcard.row || 0) + (dashcard.size_y || 0)), 0);
  const existingPayload = existingDashcards.map((dashcard) => dashboardCardPayload(dashcard, desiredCardsById));
  const newPayload = cards.map((card, index) => {
    const position = positions[index] || { row: 0, col: 0, size_x: 8, size_y: 6 };
    return {
      id: -index - 1,
      card_id: card.id,
      parameter_mappings: cardParameterMappings(card),
      series: [],
      visualization_settings: {},
      ...position,
      row: existingDashcards.length > 0 ? rowOffset + position.row : position.row
    };
  });
  await api(`/api/dashboard/${dashboardId}/cards`, {
    method: "PUT",
    headers: authHeaders(sessionId),
    body: JSON.stringify({
      cards: [...existingPayload, ...newPayload],
      tabs: tabs || []
    })
  });
}

function dashboardCardPayload(dashcard, desiredCardsById) {
  const desiredCard = desiredCardsById.get(dashcard.card_id);
  return {
    id: dashcard.id,
    card_id: dashcard.card_id,
    action_id: dashcard.action_id || null,
    dashboard_tab_id: dashcard.dashboard_tab_id || null,
    row: dashcard.row || 0,
    col: dashcard.col || 0,
    size_x: dashcard.size_x || 8,
    size_y: dashcard.size_y || 6,
    parameter_mappings: desiredCard ? cardParameterMappings(desiredCard) : dashcard.parameter_mappings || [],
    series: dashcard.series || [],
    visualization_settings: dashcard.visualization_settings || {}
  };
}

function cardParameterMappings(card) {
  return (card.parameters || []).map((parameter) => ({
    parameter_id: parameter.id,
    card_id: card.id,
    target: parameter.target
  }));
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
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
  await ensureDashboards(sessionId, databaseId);
  console.log("Metabase local setup complete");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
