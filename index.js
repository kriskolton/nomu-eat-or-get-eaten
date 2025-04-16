require("dotenv").config();
const express = require("express");
const TelegramBot = require("node-telegram-bot-api");
const {
  initDB,
  updateScore,
  getHighScores,
  getUserScore,
} = require("./repositories/scoreRepository");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const port = process.env.PORT || 3000;

// Initialize bot only if we have both required environment variables
let bot = null;
let botInitialized = false;

function initializeBot() {
  // Only initialize if we have a proper HTTPS URL (not localhost)
  if (
    !process.env.TELEGRAM_BOT_TOKEN ||
    !process.env.GAME_URL ||
    process.env.GAME_URL.includes("localhost")
  ) {
    console.log(
      "Skipping Telegram bot initialization - missing proper HTTPS URL"
    );
    return false;
  }

  try {
    bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
      polling: {
        interval: 300,
        autoStart: true,
        params: {
          timeout: 10,
        },
      },
    });

    bot.on("polling_error", (error) => {
      console.error("Polling error:", error);
    });

    console.log("Bot initialized successfully");
    return true;
  } catch (error) {
    console.error("Failed to initialize bot:", error);
    return false;
  }
}

// Connect to MongoDB
initDB().catch((err) => console.error("MongoDB connection error:", err));

// Serve static files
app.use(express.static("public"));
app.use(express.json());

// Serve index.html with API password injected
app.get("/", (req, res) => {
  const indexPath = path.join(__dirname, "public", "index.html");
  fs.readFile(indexPath, "utf8", (err, data) => {
    if (err) {
      console.error("Error reading index.html:", err);
      return res.status(500).send("Error loading game");
    }
    const htmlWithPassword = data.replace(
      "{{API_PASSWORD}}",
      process.env.API_PASSWORD || ""
    );
    res.send(htmlWithPassword);
  });
});

// Password check middleware
const checkPassword = (req, res, next) => {
  const apiPassword = process.env.API_PASSWORD;
  if (!apiPassword) {
    console.error("API_PASSWORD not set in environment variables");
    return res.status(500).json({ error: "Server configuration error" });
  }

  const providedPassword = req.headers["x-api-password"];
  if (!providedPassword || providedPassword !== apiPassword) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
};

// Verify Telegram WebApp data
const verifyTelegramData = (req, res, next) => {
  const initData = req.headers["x-telegram-init-data"];
  if (!initData) {
    return res.status(401).json({ error: "Missing Telegram data" });
  }

  // Create a hash of the data using the bot token as the secret key
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    console.error("TELEGRAM_BOT_TOKEN not set in environment variables");
    return res.status(500).json({ error: "Server configuration error" });
  }

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();
  const hash = crypto
    .createHmac("sha256", secretKey)
    .update(initData)
    .digest("hex");

  // The hash should match the hash provided by Telegram
  const providedHash = new URLSearchParams(initData).get("hash");
  if (hash !== providedHash) {
    return res.status(401).json({ error: "Invalid Telegram data" });
  }

  next();
};

// API endpoint to submit scores
app.post("/api/scores", checkPassword, verifyTelegramData, async (req, res) => {
  try {
    console.log("Received score submission request:", req.body);
    const { userId, username, score } = req.body;

    if (!userId || !score) {
      console.error("Missing required fields:", { userId, score });
      return res.status(400).json({ error: "Missing required fields" });
    }

    console.log("Attempting to update score in database...");
    const updatedScore = await updateScore(userId, username, score);
    console.log("Score updated successfully:", updatedScore);
    res.json(updatedScore);
  } catch (error) {
    console.error("Error submitting score:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// API endpoint to get high scores
app.get("/api/scores", checkPassword, async (req, res) => {
  try {
    const highScores = await getHighScores();
    res.json(highScores);
  } catch (error) {
    console.error("Error getting high scores:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    bot: botInitialized ? "initialized" : "not initialized",
    gameUrl: process.env.GAME_URL || "not set",
    message:
      "Server is running. Set up ngrok and update GAME_URL in .env to enable Telegram integration",
  });
});

// Start the server first
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`Health check available at http://localhost:${port}/health`);

  // Only attempt to initialize bot if we have both required variables and a proper HTTPS URL
  if (
    process.env.TELEGRAM_BOT_TOKEN &&
    process.env.GAME_URL &&
    !process.env.GAME_URL.includes("localhost")
  ) {
    botInitialized = initializeBot();
    if (botInitialized) {
      setupBotCommands();
    }
  } else {
    console.log("\nTo enable Telegram integration:");
    console.log("1. Install ngrok: brew install ngrok");
    console.log("2. Start ngrok: ngrok http 3000");
    console.log(
      "3. Copy the HTTPS URL from ngrok (it should start with https://)"
    );
    console.log("4. Update GAME_URL in .env file with the ngrok URL");
    console.log("5. Restart the server");
  }
});

// Only set up bot commands if the bot was initialized successfully
function setupBotCommands() {
  if (!bot) return;

  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const username = msg.from.username || msg.from.first_name;

    const keyboard = {
      inline_keyboard: [
        // [{ text: "🎮 Play Game", url: process.env.GAME_URL }],
        [{ text: "🏆 View High Scores", callback_data: "highscores" }],
        [{ text: "📊 My Stats", callback_data: "mystats" }],
      ],
    };

    await bot.sendMessage(
      chatId,
      `Welcome to Eat or Get Eaten, ${username}! 🐟\n\n` +
        `Eat smaller fish to grow bigger, but watch out for the bigger ones!\n\n` +
        `Use the buttons below to:`,
      { reply_markup: keyboard }
    );
  });

  bot.onText(/\/play/, async (msg) => {
    const chatId = msg.chat.id;

    const keyboard = {
      inline_keyboard: [[{ text: "🎮 Play Now", url: process.env.GAME_URL }]],
    };

    await bot.sendMessage(
      chatId,
      "Ready to play Eat or Get Eaten? 🐟\n\n" +
        "Click the button below to start the game!",
      { reply_markup: keyboard }
    );
  });

  // Handle callback queries from inline keyboard
  bot.on("callback_query", async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.data;

    try {
      if (data === "highscores") {
        const highScores = await getHighScores(5);
        let message = "🏆 Top 5 High Scores 🏆\n\n";

        highScores.forEach((score, index) => {
          message += `${index + 1}. ${score.username || "Anonymous"}: ${
            score.highScore
          }\n`;
        });

        await bot.sendMessage(chatId, message);
      } else if (data === "mystats") {
        const userId = callbackQuery.from.id;
        const userScore = await getUserScore(userId);

        if (userScore) {
          await bot.sendMessage(
            chatId,
            `Your Eat or Get Eaten Stats:\n\n` +
              `High Score: ${userScore.highScore}\n` +
              `Last Score: ${userScore.lastScore}\n` +
              `Last Played: ${new Date(
                userScore.lastPlayed
              ).toLocaleDateString()}`
          );
        } else {
          await bot.sendMessage(
            chatId,
            "You haven't played the game yet! Click 'Play Game' to get started!"
          );
        }
      }
    } catch (error) {
      console.error("Error handling callback query:", error);
      await bot.sendMessage(
        chatId,
        "Sorry, there was an error processing your request."
      );
    }
  });
}
