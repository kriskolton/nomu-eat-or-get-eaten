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
const SESSION_TTL_MINUTES = 1440;

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
 * Re‑simulate a finished “Nomu: Eat or Get Eaten” run and decide
 * whether the submitted score could be produced by an honest game
 * client.  Returns true ⇢ accept, false ⇢ reject.
 *
 * @param {Object}  param0
 * @param {string}  param0.seed       – RNG seed returned by /api/session
 * @param {Array}   param0.eatenEvents – chronological list of eaten prey
 * @param {number}  param0.finalScore – client‑reported score
 * @param {number}  param0.gameTime   – client‑reported total runtime (ms)
 */
function verifyReplay({ seed, eatenEvents, finalScore, gameTime }) {
  try {
    /* ──────────────────────────────────────────────────────────────────
     * 0 │ quick rejects & superficial sanity checks
     * ────────────────────────────────────────────────────────────────── */
    if (!Array.isArray(eatenEvents)) return false;
    if (
      typeof finalScore !== "number" ||
      !Number.isFinite(finalScore) ||
      finalScore < 0 ||
      typeof gameTime !== "number" ||
      !Number.isFinite(gameTime) ||
      gameTime < 0
    )
      return false;

    if (eatenEvents.length === 0) return finalScore === 0;

    /* ──────────────────────────────────────────────────────────────────
     * 1 │ structural Checks: ordering, uniqueness, monotonicity
     * ────────────────────────────────────────────────────────────────── */
    let prevIdx = -1,
      prevT = -1;
    const usedIdx = new Set();

    for (const ev of eatenEvents) {
      if (
        ev == null ||
        typeof ev !== "object" ||
        typeof ev.idx !== "number" ||
        typeof ev.t !== "number"
      )
        return false;

      const { idx, t } = ev;

      if (!Number.isInteger(idx) || idx <= prevIdx || usedIdx.has(idx))
        return false;
      if (t < prevT || t < 0) return false;

      prevIdx = idx;
      prevT = t;
      usedIdx.add(idx);
    }

    /* any run longer than an hour is suspicious */
    const MAX_EXPECTED_DURATION_MS = 60 * 60 * 1000;
    if (gameTime < prevT || gameTime > MAX_EXPECTED_DURATION_MS) return false;

    /* ──────────────────────────────────────────────────────────────────
     * 2 │ mirror constants from the front‑end
     * ────────────────────────────────────────────────────────────────── */
    const EATING_LEEWAY = 1.15;
    const POWER_UP_DURATION = 10; // seconds
    const JELLY_SHRINK = 0.6;
    const MIN_PLAYER_SIZE = 25;

    /** Allowed prey size ranges per spawn function */
    const SIZE_RULES = {
      fish: { min: 10, max: 500 },
      crab: { min: 50, max: 120 },
      jelly: { min: 30, max: 80 },
      elecJelly: { min: 40, max: 90 },
      sushi: { min: 30, max: 30 }, // fixed sprite
      puffer: { min: 30, max: 240 }, // may inflate ×3
    };

    /* ──────────────────────────────────────────────────────────────────
     * 3 │ re‑simulate the full run, event by event
     * ────────────────────────────────────────────────────────────────── */
    let score = 0;
    let size = 25; // starting side length (pixels)
    let poweredUpUntil = -1; // wall‑clock seconds

    for (const ev of eatenEvents) {
      const { type, size: preySize, t } = ev;
      const isUltra = !!ev.ultra;

      /* 3‑a │ basic per‑event validation */
      const rule = SIZE_RULES[type];
      if (
        !rule ||
        typeof preySize !== "number" ||
        preySize < rule.min - 0.1 ||
        preySize > rule.max + 0.1
      )
        return false;

      const nowSec = t / 1000;
      const powered = nowSec <= poweredUpUntil;

      /* 3‑b │ size comparison logic mirrors the client */
      const pRadius = size * 0.6 * 0.5; // player bounding ellipse x‑radius
      const preyRadius = preySize * 0.6 * 0.5;

      if (!powered && pRadius * EATING_LEEWAY < preyRadius) return false;

      /* 3‑c │ scoring & growth mirrors the front‑end exactly */
      switch (type) {
        case "sushi":
          score += 50;
          poweredUpUntil = nowSec + POWER_UP_DURATION;
          break;

        case "jelly":
          score += Math.floor(preySize);
          size = Math.max(size * JELLY_SHRINK, MIN_PLAYER_SIZE);
          break;

        case "elecJelly":
          score += Math.floor(preySize);
          /* Paralysis has no effect on the coarse simulation */
          break;

        default: // fish, crab, puffer, etc.
          score += Math.floor(preySize);
          size += Math.min(Math.sqrt(preySize) * 0.05, 1.5);
          break;
      }

      /* Ultra‑fast prey refreshes the 10 s power‑up timer */
      if (isUltra) poweredUpUntil = nowSec + POWER_UP_DURATION;
    }

    /* ──────────────────────────────────────────────────────────────────
     * 4 │ final comparison – allow tiny rounding drift (±3 pts)
     * ────────────────────────────────────────────────────────────────── */
    return Math.abs(score - finalScore) <= 3;
  } catch {
    /* Any runtime error ⇒ reject the replay */
    return false;
  }
}

/* -------------------------------------------------------------------- */
/* Optional helper kept around in case back‑end wants stricter checks   */
/* than the size‑range gate above.  Currently unused by verifyReplay.   */
/* -------------------------------------------------------------------- */
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
  const chosen = defs.find((d) => (r -= d.w) < 0) || defs.at(-1);
  return rng() * (chosen.max - chosen.min) + chosen.min;
}

module.exports = { createSession, fetchSession, verifyReplay };
