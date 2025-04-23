const { MongoClient } = require("mongodb");
const config = require("../config");
const activeEvent = config.activeEvent;

let db;

// Initialize database connection
async function initDB() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  db = client.db(process.env.DATABASE_NAME);
  console.log("Connected to MongoDB");
}

// Helper function to get the start of the current week (Sunday)
function getStartOfWeek() {
  const date = new Date();
  const day = date.getDay();
  const diff = date.getDate() - day;
  const startOfWeek = new Date(date.setDate(diff));
  startOfWeek.setHours(0, 0, 0, 0);
  return startOfWeek;
}

// Update or create a score
async function updateScore(userId, username, score, gameTime) {
  try {
    console.log("Database operation - Updating score:", {
      userId,
      username,
      score,
      gameTime,
      event: activeEvent,
    });

    // Create a game document (non-critical)
    try {
      const gamesCollection = db.collection("games");
      await gamesCollection.insertOne({
        userId,
        username,
        score,
        gameTime,
        date: new Date(),
        event: activeEvent,
      });
      console.log("Successfully created game document");
    } catch (gameError) {
      console.error("Error creating game document:", gameError);
      // Continue even if game document creation fails
    }

    // Update weekly stats (non-critical)
    try {
      const statsCollection = db.collection("stats");
      const weekStart = getStartOfWeek();
      await statsCollection.updateOne(
        { weekStart },
        {
          $inc: {
            totalGamesPlayed: 1,
            totalGameTime: gameTime,
          },
          $set: {
            lastUpdatedAt: new Date(),
          },
          $setOnInsert: {
            weekStart,
          },
        },
        { upsert: true }
      );
      console.log("Successfully updated weekly stats");
    } catch (statsError) {
      console.error("Error updating weekly stats:", statsError);
      // Continue even if stats update fails
    }

    const eventName = activeEvent;

    // Update event stats (non-critical)
    try {
      const eventStatsCollection = db.collection("event-stats");
      await eventStatsCollection.updateOne(
        { event: eventName },
        {
          $inc: {
            totalGamesPlayed: 1,
            totalGameTime: gameTime,
          },
          $addToSet: {
            players: userId,
          },
          $set: {
            lastUpdatedAt: new Date(),
          },
          $setOnInsert: {
            event: eventName,
          },
        },
        { upsert: true }
      );
      console.log("Successfully updated event stats");
    } catch (eventStatsError) {
      console.error("Error updating event stats:", eventStatsError);
      // Continue even if event stats update fails
    }

    // Update or insert user score and high score
    const collection = db.collection("scores");
    const result = await collection.findOneAndUpdate(
      { userId, event: eventName },
      [
        {
          $set: {
            username,
            lastScore: score,
            lastPlayed: new Date(),
            lastGameTime: gameTime,
            highScore: {
              $max: [{ $ifNull: ["$highScore", score] }, score],
            },
            highScoreGameTime: {
              $cond: {
                if: { $gt: [{ $ifNull: ["$highScore", 0] }, score] },
                then: "$highScoreGameTime",
                else: gameTime,
              },
            },

            event: eventName,
          },
        },
      ],
      {
        upsert: true,
        returnDocument: "after",
      }
    );

    console.log("Database operation result:", result);
    return result.value;
  } catch (error) {
    console.error("Error updating score in database:", error);
    throw error;
  }
}

// Get high scores
async function getHighScores(limit = 10, eventName) {
  try {
    const collection = db.collection("scores");
    const query = eventName ? { event: eventName } : {};
    return await collection
      .find(query)
      .sort({ highScore: -1 })
      .limit(limit)
      .toArray();
  } catch (error) {
    console.error("Error getting high scores:", error);
    throw error;
  }
}

async function getActiveEventHighScores(limit = 10) {
  try {
    const eventName = activeEvent;
    return await getHighScores(limit, eventName);
  } catch (error) {
    console.error("Error getting high scores by event:", error);
    throw error;
  }
}

// Get user's score
async function getUserScore(userId, eventName) {
  try {
    const collection = db.collection("scores");
    const query = eventName ? { userId, event: eventName } : { userId };
    return await collection.findOne(query);
  } catch (error) {
    console.error("Error getting user score:", error);
    throw error;
  }
}

module.exports = {
  initDB,
  updateScore,
  getHighScores,
  getUserScore,
  getActiveEventHighScores,
};
