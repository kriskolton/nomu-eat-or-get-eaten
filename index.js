require("dotenv").config();
const config = require("./config");
const activeEvent = config.activeEvent;
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const TelegramBot = require("node-telegram-bot-api");
const {
  initDB,
  updateScore,
  getHighScores,
  getUserScore,
  getActiveEventHighScores,
} = require("./repositories/scoreRepository");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const port = process.env.PORT || 3000;

// Set up rate limiting: max of 100 requests per 15 minutes per IP
const limiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes (adjust as needed)
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
});

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

    // Handle polling errors
    bot.on("polling_error", async (error) => {
      console.error("Polling error:", error);
      if (error.code === 409) {
        console.log("Conflict detected, stopping bot...");
        try {
          await bot.stopPolling();
          console.log("Bot polling stopped");
          // Wait a bit before restarting
          setTimeout(() => {
            console.log("Restarting bot polling...");
            bot.startPolling();
          }, 5000);
        } catch (stopError) {
          console.error("Error stopping bot:", stopError);
        }
      }
    });

    console.log("Bot initialized successfully");
    return true;
  } catch (error) {
    console.error("Failed to initialize bot:", error);
    return false;
  }
}

// Connect to MongoDB with retry logic
async function initializeDatabase() {
  try {
    await initDB();
    console.log("Connected to MongoDB");
  } catch (err) {
    console.error("MongoDB connection error:", err);
    // Don't exit the process, just log the error
  }
}

// Initialize the application
async function initializeApp() {
  try {
    // Use Helmet for basic security headers
    app.use(helmet());
    // Apply the rate limiter to all requests
    app.use(limiter);
    // Initialize database
    await initializeDatabase();

    // Initialize bot if conditions are met
    if (
      process.env.TELEGRAM_BOT_TOKEN &&
      process.env.GAME_URL &&
      !process.env.GAME_URL.includes("localhost")
    ) {
      botInitialized = initializeBot();
      if (botInitialized) {
        setupBotCommands();
      }
    }

    // Start the server
    const server = app.listen(port, () => {
      console.log(`Server running on port ${port}`);
      console.log(`Health check available at http://localhost:${port}/health`);
    });

    // Handle server errors
    server.on("error", (error) => {
      console.error("Server error:", error);
      process.exit(1);
    });

    // Handle process termination
    process.on("SIGTERM", async () => {
      console.log("SIGTERM received. Shutting down gracefully...");
      await cleanup();
      process.exit(0);
    });

    // Handle process interruption
    process.on("SIGINT", async () => {
      console.log("SIGINT received. Shutting down gracefully...");
      await cleanup();
      process.exit(0);
    });
  } catch (error) {
    console.error("Failed to initialize application:", error);
    process.exit(1);
  }
}

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

    const apiPassword = process.env.API_PASSWORD;
    if (!apiPassword) {
      console.error("API_PASSWORD not set in environment variables");
      return res.status(500).send("Server configuration error");
    }

    // Inject the API password as a JavaScript variable
    const scriptInjection = `
      <script>
        window.API_PASSWORD = '${apiPassword}';
      </script>
    `;

    // Insert the script right after the opening head tag
    const htmlWithPassword = data.replace(
      "</head>",
      `</head>${scriptInjection}`
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
  console.log("Checking API password...", {
    provided: providedPassword ? "***" : "not provided",
    expected: apiPassword ? "***" : "not set",
  });

  if (!providedPassword || providedPassword !== apiPassword) {
    console.error("Invalid API password provided");
    return res.status(401).json({ error: "Unauthorized" });
  }
  console.log("API password verified");
  next();
};

// Verify Telegram WebApp data
const verifyTelegramData = (req, res, next) => {
  const initData = req.headers["x-telegram-init-data"];
  console.log("Verifying Telegram data...");
  console.log("Received initData:", initData);

  if (!initData) {
    console.error("Missing Telegram init data");
    return res.status(401).json({ error: "Missing Telegram data" });
  }

  try {
    // Parse the init data
    const params = new URLSearchParams(initData);
    const providedHash = params.get("hash");
    console.log("Provided hash:", providedHash);

    if (!providedHash) {
      console.error("No hash found in init data");
      return res.status(401).json({ error: "Invalid Telegram data format" });
    }

    // Create a hash of the data using the bot token as the secret key
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      console.error("TELEGRAM_BOT_TOKEN not set in environment variables");
      return res.status(500).json({ error: "Server configuration error" });
    }

    // Remove the hash parameter before calculating the hash
    params.delete("hash");

    // Sort the remaining parameters alphabetically
    const sortedParams = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");

    console.log("Sorted params for hash:", sortedParams);

    const secretKey = crypto
      .createHmac("sha256", "WebAppData")
      .update(botToken)
      .digest();

    const hash = crypto
      .createHmac("sha256", secretKey)
      .update(sortedParams)
      .digest("hex");

    console.log("Calculated hash:", hash);

    if (hash !== providedHash) {
      console.error("Invalid Telegram hash", {
        calculated: hash,
        provided: providedHash,
      });
      return res.status(401).json({ error: "Invalid Telegram data" });
    }

    console.log("Telegram data verified successfully");
    next();
  } catch (error) {
    console.error("Error verifying Telegram data:", error);
    return res.status(500).json({ error: "Error verifying Telegram data" });
  }
};

// API endpoint to submit scores
app.post("/api/scores", checkPassword, verifyTelegramData, async (req, res) => {
  try {
    console.log("Received score submission request:", req.body);
    const { userId, username, score, gameTime, event } = req.body;

    if (!userId || typeof score !== "number" || typeof gameTime !== "number") {
      console.error("Invalid or missing required fields:", {
        userId,
        score,
        gameTime,
      });
      return res
        .status(400)
        .json({ error: "Invalid or missing required fields" });
    }

    console.log("Attempting to update score in database...", {
      userId,
      username,
      score,
      gameTime,
      event,
    });

    try {
      const updatedScore = await updateScore(
        userId,
        username,
        score,
        gameTime,
        event
      );
      console.log("Score updated successfully in database:", updatedScore);
      res.json(updatedScore);
    } catch (dbError) {
      console.error("Database error:", {
        error: dbError.message,
        stack: dbError.stack,
      });
      throw dbError;
    }
  } catch (error) {
    console.error("Error submitting score:", {
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({ error: "Internal server error" });
  }
});

// API endpoint to get high scores
app.get("/api/scores", checkPassword, async (req, res) => {
  try {
    const highScores = await getActiveEventHighScores();
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

// Only set up bot commands if the bot was initialized successfully
function setupBotCommands() {
  if (!bot) return;

  /**
   * Helper function that tries to send a message to the same topic (if applicable).
   * - `chatId`: number or string (the chat or supergroup ID)
   * - `text`: message text
   * - `messageThreadId`: pass the `message_thread_id` if you're replying in a forum topic
   * - `options`: normal Telegram sendMessage options (reply_markup, parse_mode, etc.)
   */
  async function sendMessageWithErrorHandling(
    chatId,
    text,
    messageThreadId,
    options = {}
  ) {
    // If the chat is private or there's no message_thread_id, we omit it
    // If it's a supergroup with a valid topic, we include it
    if (messageThreadId) {
      options.message_thread_id = messageThreadId;
    }

    try {
      await bot.sendMessage(chatId, text, options);
    } catch (error) {
      // Handle the 'TOPIC_CLOSED' error or any other
      if (
        error.response &&
        error.response.statusCode === 400 &&
        error.response.body &&
        error.response.body.description === "TOPIC_CLOSED"
      ) {
        console.error("Failed to send message: Topic is closed");
        // If topic is closed, try sending without the topic
        if (options.message_thread_id) {
          const { message_thread_id, ...optionsWithoutTopic } = options;
          await bot.sendMessage(chatId, text, optionsWithoutTopic);
        }
      } else {
        console.error("Error sending message:", error);
        throw error;
      }
    }
  }

  // /start command
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const chatType = msg.chat.type; // 'private', 'group', 'supergroup'
    const messageThreadId = msg.message_thread_id; // defined if forum topic

    const username = msg.from.username || msg.from.first_name;
    const keyboard = {
      inline_keyboard: [
        [{ text: "🎮 Play Game", url: process.env.GAME_URL }],
        [{ text: "🏆 View High Scores", callback_data: "highscores" }],
        [{ text: "📊 My Stats", callback_data: "mystats" }],
      ],
    };

    await sendMessageWithErrorHandling(
      chatId,
      `Welcome to Nomu: Eat or Get Eaten 🐟\n\n` +
        `Eat smaller fish to grow bigger, but watch out for bigger ones!\n\n` +
        `Use the buttons below to:`,
      // Only pass message_thread_id if it's a supergroup with a forum topic
      chatType === "supergroup" ? messageThreadId : null,
      { reply_markup: keyboard }
    );
  });

  // /play command
  bot.onText(/\/play/, async (msg) => {
    const chatId = msg.chat.id;
    const chatType = msg.chat.type;
    const messageThreadId = msg.message_thread_id;

    const keyboard = {
      inline_keyboard: [[{ text: "🎮 Play Now", url: process.env.GAME_URL }]],
    };

    await sendMessageWithErrorHandling(
      chatId,
      "Ready to play Eat or Get Eaten? 🐟\n\nClick the button below to start!",
      chatType === "supergroup" ? messageThreadId : null,
      { reply_markup: keyboard }
    );
  });

  // Handle callback queries from inline keyboard
  bot.on("callback_query", async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const chatType = callbackQuery.message.chat.type;
    const messageThreadId = callbackQuery.message.message_thread_id; // if forum
    const data = callbackQuery.data;

    try {
      if (data === "highscores") {
        // Show top N high scores (10, or 5 in your text)
        const highScores = await getActiveEventHighScores(10);
        let message = `🏆 Top 10 High Scores for ${activeEvent} 🏆\n\n`;

        highScores.forEach((score, index) => {
          message += `${index + 1}. ${score.username || "Anonymous"}: ${
            score.highScore
          }\n`;
        });

        await sendMessageWithErrorHandling(
          chatId,
          message,
          chatType === "supergroup" ? messageThreadId : null
        );
      } else if (data === "mystats") {
        const userId = callbackQuery.from.id;
        const userScore = await getUserScore(userId, activeEvent);

        if (userScore) {
          await sendMessageWithErrorHandling(
            chatId,
            `${activeEvent} Stats for ${userScore.username}:\n\n` +
              `High Score: ${userScore.highScore}\n` +
              `Last Score: ${userScore.lastScore}\n` +
              `Last Played: ${new Date(
                userScore.lastPlayed
              ).toLocaleDateString()}`,
            chatType === "supergroup" ? messageThreadId : null
          );
        } else {
          await sendMessageWithErrorHandling(
            chatId,
            `You haven't participated in ${activeEvent} yet! Click 'Play Game' to get started!`,
            chatType === "supergroup" ? messageThreadId : null
          );
        }
      }
    } catch (error) {
      console.error("Error handling callback query:", error);
      try {
        await sendMessageWithErrorHandling(
          chatId,
          "Sorry, there was an error processing your request.",
          chatType === "supergroup" ? messageThreadId : null
        );
      } catch (sendError) {
        console.error("Failed to send error message:", sendError);
      }
    }
  });
}

// Cleanup function
async function cleanup() {
  if (bot) {
    try {
      console.log("Stopping bot polling...");
      await bot.stopPolling();
      console.log("Bot polling stopped successfully");
    } catch (error) {
      console.error("Error stopping bot:", error);
    }
  }
}

// Start the application
initializeApp().catch((error) => {
  console.error("Fatal error during initialization:", error);
  process.exit(1);
});
