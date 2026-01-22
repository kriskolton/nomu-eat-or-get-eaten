// scoreRepository.js
// Handles all score-related persistence for the game.
// Fixed and refactored on 2025-04-23

const { MongoClient } = require("mongodb");
const config = require("../config");

// The event that is currently active (e.g. "Season 1")
const { activeEvent } = config;

let db; // Cached reference to the database instance so we reuse the same connection
let client; // Keep a reference to the MongoClient so we can start sessions if needed

/**
 * Initialise the MongoDB connection (singleton).
 * Call this at the start of any public function that needs the DB.
 */
async function initDB() {
  if (db) return db; // Already connected

  const uri = process.env.MONGODB_URI;
  const dbName = process.env.DATABASE_NAME;

  if (!uri || !dbName) {
    throw new Error(
      "Environment variables MONGODB_URI and DATABASE_NAME must be set"
    );
  }

  client = new MongoClient(uri, {
    // useUnifiedTopology is default since driver 4.x
    retryWrites: true,
  });

  await client.connect();
  db = client.db(dbName);
  console.log("Connected to MongoDB");
  return db;
}

/**
 * Get the beginning of the current week (Sunday 00:00 UTC).
 *
 * @param {Date=} date – reference date (defaults to `new Date()`)
 * @returns {Date} Sunday at 00:00 UTC for the week containing `date`
 */
function getStartOfWeek(date = new Date()) {
  const d = new Date(date); // Copy so we do not mutate caller's date
  const day = d.getUTCDay(); // 0 = Sunday
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - day);
  return d; // Sunday at 00:00 UTC
}

/**
 * Upsert a user's score and update all related statistics.
 *
 * @param {string}  userId    – unique player ID
 * @param {string}  username  – display name (for leaderboards)
 * @param {number}  score     – score achieved in the game
 * @param {number}  gameTime  – game duration in milliseconds
 * @param {string=} event     – name of the event / season (defaults to the active event)
 *
 * @returns {Promise<object>} – the updated score document
 */
async function updateScore(
  userId,
  username,
  score,
  gameTimeMs,
  event = activeEvent,
  sessionId,
  isFlagged = false,
  flaggedFor = []
) {
  await initDB();
  const gameTime = gameTimeMs / 1000;

  if (event !== activeEvent) {
    console.warn(
      `Event does not match active event: ${event} (active: ${activeEvent})`
    );
  }

  const now = new Date();
  const resolvedEvent = event || "Season 1";

  // 1️⃣ Record the single game – best-effort (do not abort on failure)
  try {
    await db.collection("games").insertOne({
      userId,
      username,
      score,
      gameTime,
      date: now,
      event: resolvedEvent,
      sessionId,
      isFlagged,
      flaggedFor,
    });
  } catch (e) {
    console.error("Error creating game document:", e);
  }

  // 2️⃣ Update weekly stats – best-effort
  try {
    const weekStart = getStartOfWeek(now);
    await db.collection("stats").updateOne(
      { weekStart },
      {
        $inc: {
          totalGamesPlayed: 1,
          totalGameTime: gameTime,
        },
        $set: {
          lastUpdatedAt: now,
        },
        $setOnInsert: {
          weekStart,
        },
      },
      { upsert: true }
    );
  } catch (e) {
    console.error("Error updating weekly stats:", e);
  }

  // 3️⃣ Update event-level stats – best-effort
  try {
    await db.collection("event-stats").updateOne(
      { event: resolvedEvent },
      {
        $inc: {
          totalGamesPlayed: 1,
          totalGameTime: gameTime,
        },
        $addToSet: {
          players: userId,
        },
        $set: {
          lastUpdatedAt: now,
        },
        $setOnInsert: {
          event: resolvedEvent,
        },
      },
      { upsert: true }
    );
  } catch (e) {
    console.error("Error updating event stats:", e);
  }

  // 4️⃣ Upsert *player* score (this is the critical bit – if this fails we throw)
  try {
    const scores = db.collection("scores");

    const { value } = await scores.findOneAndUpdate(
      { userId, event: resolvedEvent },
      [
        {
          $set: {
            // Always (re)set identifiers on upsert – without this a new document created by upsert
            // would *not* contain userId / event, because aggregation-style updates do **not**
            // copy the query filter fields automatically.
            userId,
            event: resolvedEvent,
            username,
            lastScore: score,
            lastGameTime: gameTime,
            lastPlayed: now,
            highScore: {
              $cond: [{ $gt: ["$highScore", score] }, "$highScore", score],
            },
            highScoreGameTime: {
              $cond: [
                { $gt: ["$highScore", score] },
                "$highScoreGameTime",
                gameTime,
              ],
            },
          },
        },
      ],
      {
        upsert: true,
        returnDocument: "after", // return the document *after* the update / upsert
      }
    );

    return value;
  } catch (error) {
    console.error("Error upserting score:", error);
    throw error; // Propagate so the caller knows the critical step failed
  }
}

/**
 * Get a list of high-scores, optionally filtered by event.
 *
 * @param {number}  limit     – number of entries to return (default 10)
 * @param {string=} eventName – filter by event (undefined = all-time leaderboard)
 */
async function getHighScores(limit = 10, eventName) {
  await initDB();
  const query = eventName ? { event: eventName } : {};
  return db
    .collection("scores")
    .find(query, { projection: { _id: 0 } })
    .sort({ highScore: -1, lastPlayed: 1 })
    .limit(limit)
    .toArray();
}

/**
 * Convenience helper that returns the leaderboard for the currently active event.
 */
function getActiveEventHighScores(limit = 10) {
  return getHighScores(limit, activeEvent);
}

/**
 * Fetch a single user's score document (optionally for a specific event).
 */
async function getUserScore(userId, eventName) {
  await initDB();
  const query = eventName ? { userId, event: eventName } : { userId };
  return db.collection("scores").findOne(query, { projection: { _id: 0 } });
}

/**
 * Set a user's team affiliation.
 *
 * @param {string} userId – unique player ID
 * @param {string} username – display name (required for new documents)
 * @param {string} team – team name (must be "MonkeDAO" or "Nomu")
 * @returns {Promise<object>} – the updated score document
 */
async function setTeam(userId, username, team) {
  await initDB();

  // Validate team parameter
  const validTeams = ["MonkeDAO", "Nomu"];
  if (!validTeams.includes(team)) {
    throw new Error(`Invalid team. Must be one of: ${validTeams.join(", ")}`);
  }

  const now = new Date();
  const resolvedEvent = activeEvent || "Season 1";

  try {
    const scores = db.collection("scores");

    const { value } = await scores.findOneAndUpdate(
      { userId, event: resolvedEvent },
      [
        {
          $set: {
            // Always (re)set identifiers on upsert – without this a new document created by upsert
            // would *not* contain userId / event, because aggregation-style updates do **not**
            // copy the query filter fields automatically.
            userId,
            event: resolvedEvent,
            username,
            team,
            lastScore: { $ifNull: ["$lastScore", 0] },
            lastGameTime: { $ifNull: ["$lastGameTime", 0] },
            lastPlayed: { $ifNull: ["$lastPlayed", now] },
            highScore: { $ifNull: ["$highScore", 0] },
            highScoreGameTime: { $ifNull: ["$highScoreGameTime", 0] },
          },
        },
      ],
      {
        upsert: true,
        returnDocument: "after",
      }
    );

    return value;
  } catch (error) {
    console.error("Error setting team:", error);
    throw error;
  }
}

module.exports = {
  initDB,
  updateScore,
  getHighScores,
  getUserScore,
  getActiveEventHighScores,
  setTeam,
};
