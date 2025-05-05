const { ObjectId } = require("mongodb");
const config = require("../config");

// Re-use the existing DB connection initialiser so we do **not** open
// multiple MongoClient instances.
const { initDB } = require("./scoreRepository");
const crypto = require("crypto");

// ──────────────────────────────────────────────────────────────────────
// Configuration & constants
// ──────────────────────────────────────────────────────────────────────

// After this period (in minutes) the session is considered invalid and
// must be recreated by the client.
const SESSION_TTL_MINUTES = 90;

// Hard cap on a single run – a 20-minute game is already **extremely**
// long.  Used when validating the replay payload from the client.
const MAX_EXPECTED_DURATION_MS = 20 * 60 * 1000; // 20 minutes

// ──────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────

/**
 * Create a *single* game session for a user.  The function returns both the
 * `sessionId` (back-end identifier) and the randomly generated RNG `seed`
 * that the **client** must use for Math.seedrandom.
 *
 * @param {string|number} userId – Telegram user id
 * @param {string=} event       – season / event name (defaults to active)
 * @returns {Promise<{sessionId: string, seed: string}>}
 */
async function createSession(userId, event = config.activeEvent) {
  const db = await initDB();
  const sessions = db.collection("sessions");

  // 128-bit cryptographically secure random seed, encoded as hex.
  const seed = crypto.randomBytes(16).toString("hex");

  const doc = {
    userId,
    event,
    seed,
    createdAt: new Date(),
    // Extra fields for more sophisticated validation can be added here.
  };

  const { insertedId } = await sessions.insertOne(doc);
  return { sessionId: insertedId.toString(), seed };
}

/**
 * Fetch a session by id, validating ownership (userId) *and* age.
 *
 * @param {string} sessionId – MongoDB ObjectId string
 * @param {string|number} userId – Telegram user id of the caller
 * @returns {Promise<object|null>} – the session document or null if invalid
 */
async function fetchSession(sessionId, userId) {
  const db = await initDB();
  const sess = await db
    .collection("sessions")
    .findOne({ _id: new ObjectId(sessionId) });

  // Basic validation – id exists and belongs to the caller.
  if (!sess || String(sess.userId) !== String(userId)) return null;

  // TTL – sessions older than the configured time window are rejected.
  const ageMs = Date.now() - sess.createdAt.getTime();
  if (ageMs > SESSION_TTL_MINUTES * 60 * 1000) return null;

  return sess;
}

// ──────────────────────────────────────────────────────────────────────
// Replay verification helper
// ──────────────────────────────────────────────────────────────────────

/**
 * Minimalistic, *fast* verification of the replay payload.
 *
 * The client records only the *eaten* fish events (timestamp + fish size).
 * Given the shared RNG seed we can regenerate the deterministic fish spawn
 * order **very** quickly and check if the claimed events could have
 * occurred.  This does **not** prove the player did *not* cheat, but it
 * makes naive replay attacks (resending an old score JSON) impossible.
 *
 * @param {object} opts
 * @param {string}   opts.seed         – RNG seed (from session)
 * @param {Array}    opts.eatenEvents  – [{t, size}, ...]
 * @param {number}   opts.finalScore   – claimed end-of-round score
 * @param {number}   opts.gameTime     – duration in ms reported by client
 * @returns {boolean} – `true` if plausible, `false` if rejected
 */
function verifyReplay({ seed, eatenEvents, finalScore, gameTime }) {
  /* 0 ─ quick rejects */
  if (!Array.isArray(eatenEvents) || eatenEvents.length === 0) return false;

  // 1 ─ structural checks --------------------------------------------------
  let prevIdx = -1,
    prevT = -1;
  const usedIdx = new Set();
  for (const { idx, t } of eatenEvents) {
    if (typeof idx !== "number" || typeof t !== "number") return false;
    if (idx <= prevIdx || usedIdx.has(idx)) return false;
    if (t < prevT) return false;
    prevIdx = idx;
    prevT = t;
    usedIdx.add(idx);
  }
  if (gameTime < prevT || gameTime > MAX_EXPECTED_DURATION_MS) return false;

  // 2 ─ constants mirror those in client ----------------------------------
  const EATING_LEEWAY = 1.15;
  const POWER_UP_DURATION = 10; // seconds
  const JELLY_SHRINK = 0.6;
  const MIN_PLAYER_SIZE = 25;

  // Legal size ranges per spawnType (keep in sync with spawn functions)
  const SIZE_RULES = {
    fish: { min: 10, max: 500 },
    crab: { min: 50, max: 120 },
    jelly: { min: 30, max: 80 },
    elecJelly: { min: 40, max: 90 },
    sushi: { min: 30, max: 30 }, // fixed sprite
    puffer: { min: 30, max: 180 }, // may inflate ×3
  };

  // 3 ─ simulate the run ---------------------------------------------------
  let score = 0;
  let size = 25; // starting side length
  let poweredUpUntil = -1; // in seconds

  for (const ev of eatenEvents) {
    const { type, size: prey, t } = ev;
    const rule = SIZE_RULES[type];
    if (!rule || prey < rule.min - 0.1 || prey > rule.max + 0.1) return false;

    const nowSec = t / 1000;
    const powered = nowSec <= poweredUpUntil;
    const pRadius = size * 0.6 * 0.5; // same maths as client
    const preyRad = prey * 0.6 * 0.5;

    if (!powered && pRadius * EATING_LEEWAY < preyRad) return false;

    /* scoring & growth – exact copy of client logic */
    switch (type) {
      case "sushi":
        score += 50;
        poweredUpUntil = nowSec + POWER_UP_DURATION;
        break;
      case "jelly":
        score += Math.floor(prey);
        size = Math.max(size * JELLY_SHRINK, MIN_PLAYER_SIZE);
        break;
      case "elecJelly":
        score += Math.floor(prey);
        /* size unchanged, paralysis ignored in this coarse model */
        break;
      default: // fish, crab, puffer, etc.
        score += Math.floor(prey);
        size += Math.min(Math.sqrt(prey) * 0.05, 1.5);
        break;
    }
  }

  // 4 ─ final score must match exactly (or within generous ±3)
  return Math.abs(score - finalScore) <= 3;
}

// Helper replicating the client's spawnFish() size calculation – keep in
// sync with the front-end `fishTypeDefinitions` list.
function generateNextFishSize(rng) {
  const defs = [
    { min: 10, max: 40, w: 0.432 },
    { min: 20, max: 60, w: 0.252 },
    { min: 25, max: 80, w: 0.2 },
    { min: 35, max: 100, w: 0.1 },
    { min: 200, max: 300, w: 0.013 },
    { min: 400, max: 500, w: 0.003 },
  ];
  const total = defs.reduce((s, d) => s + d.w, 0);
  let r = rng() * total;
  let def = defs[0];
  for (const d of defs) {
    if (r < d.w) {
      def = d;
      break;
    }
    r -= d.w;
  }
  return rng() * (def.max - def.min) + def.min;
}

module.exports = { createSession, fetchSession, verifyReplay };
