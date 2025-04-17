const { MongoClient } = require("mongodb");

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

    // Update or insert user score and high score
    const collection = db.collection("scores");
    const result = await collection.findOneAndUpdate(
      { userId },
      [
        {
          $set: {
            username,
            lastScore: score,
            lastPlayed: new Date(),
            lastGameTime: gameTime,
            highScore: { $max: ["$highScore", score] },
            highScoreGameTime: {
              $cond: {
                if: { $gt: ["$highScore", score] },
                then: "$highScoreGameTime",
                else: gameTime,
              },
            },
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
async function getHighScores(limit = 10) {
  try {
    const collection = db.collection("scores");
    return await collection
      .find()
      .sort({ highScore: -1 })
      .limit(limit)
      .toArray();
  } catch (error) {
    console.error("Error getting high scores:", error);
    throw error;
  }
}

// Get user's score
async function getUserScore(userId) {
  try {
    const collection = db.collection("scores");
    return await collection.findOne({ userId });
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
};
