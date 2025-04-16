const { MongoClient } = require("mongodb");

let db;

// Initialize database connection
async function initDB() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  db = client.db("eat-or-get-eaten");
  console.log("Connected to MongoDB");
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

    const collection = db.collection("scores");

    // Use a pipeline update to leverage $cond and other aggregation expressions
    const result = await collection.findOneAndUpdate(
      { userId },
      [
        {
          $set: {
            username,
            lastScore: score,
            lastPlayed: new Date(),
            lastGameTime: gameTime,
            // Update highScore with the maximum of the current highScore or the new score
            highScore: {
              $max: ["$highScore", score],
            },
            // Conditionally set highScoreGameTime
            // If the old highScore is greater than the new score, keep the old highScoreGameTime;
            // otherwise, set it to the current gameTime.
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
