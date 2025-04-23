require("dotenv").config();
const config = require("./config");
const activeEvent = config.activeEvent;

const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const TelegramBot = require("node-telegram-bot-api");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const {
  initDB,
  updateScore,
  getHighScores,
  getUserScore,
  getActiveEventHighScores,
} = require("./repositories/scoreRepository");

const app = express();
const port = process.env.PORT || 3000;

/* ───────────────────────── Security middleware ───────────────────────── */

app.use(helmet());

app.use(
  rateLimit({
    windowMs: 5 * 60 * 1000, // 5 min
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

/* ───────────────────────── Telegram bot (optional) ───────────────────── */

let bot = null;
let botInitialized = false;

function initializeBot() {
  if (
    !process.env.TELEGRAM_BOT_TOKEN ||
    !process.env.GAME_URL ||
    process.env.GAME_URL.includes("localhost")
  ) {
    console.log("Skipping Telegram bot initialization.");
    return false;
  }

  try {
    bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
      polling: { interval: 300, autoStart: true, params: { timeout: 10 } },
    });

    bot.on("polling_error", async (error) => {
      console.error("Polling error:", error);
      if (error.code === 409) {
        // another instance polling
        await bot.stopPolling();
        setTimeout(() => bot.startPolling(), 5_000);
      }
    });

    console.log("Bot initialized.");
    return true;
  } catch (e) {
    console.error("Bot init failed:", e);
    return false;
  }
}

/* ───────────────────────── Database init ─────────────────────────────── */

async function initializeDatabase() {
  try {
    await initDB();
    console.log("Connected to MongoDB");
  } catch (err) {
    console.error("MongoDB connection error:", err);
  }
}

/* ───────────────────────── Telegram initData verifier ────────────────── */

const MAX_AGE_SECONDS = 60 * 5; // accept initData for 5 min

function verifyTelegramData(req, res, next) {
  const initData = req.headers["x-telegram-init-data"];
  if (!initData)
    return res.status(401).json({ error: "Missing Telegram data" });

  const params = new URLSearchParams(initData);
  const theirHash = params.get("hash");
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  // Telegram spec: secretKey = sha256(botToken)
  const secretKey = crypto
    .createHash("sha256")
    .update(process.env.TELEGRAM_BOT_TOKEN)
    .digest();

  const ourHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  if (ourHash !== theirHash)
    return res.status(401).json({ error: "Invalid Telegram hash" });

  const authDate = Number(params.get("auth_date")) || 0;
  if (Date.now() / 1000 - authDate > MAX_AGE_SECONDS)
    return res.status(401).json({ error: "initData expired" });

  req.telegramUser = Object.fromEntries(params);
  next();
}

/* ───────────────────────── Express routes ────────────────────────────── */

app.use(express.static("public"));
app.use(express.json());

// Serve index.html *as is* – no credentials leaked to the client
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Submit a score (POST)
// Protected only by Telegram signature
app.post("/api/scores", verifyTelegramData, async (req, res) => {
  try {
    const { userId, username, score, gameTime, event } = req.body;
    if (!userId || typeof score !== "number" || typeof gameTime !== "number") {
      return res.status(400).json({ error: "Invalid or missing fields" });
    }

    const updatedScore = await updateScore(
      userId,
      username,
      score,
      gameTime,
      event
    );
    res.json(updatedScore);
  } catch (err) {
    console.error("Error submitting score:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Public high-score board for the active event
app.get("/api/scores", async (_req, res) => {
  try {
    const highScores = await getActiveEventHighScores();
    res.json(highScores);
  } catch (err) {
    console.error("Error getting high scores:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Health check
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    bot: botInitialized ? "initialized" : "not initialized",
    gameUrl: process.env.GAME_URL || "not set",
    message:
      "Server is running. Set up ngrok and update GAME_URL in .env to enable Telegram integration",
  });
});

/* ───────────────────────── Bot commands (optional) ───────────────────── */

function setupBotCommands() {
  if (!bot) return;

  async function sendMessageWithErrorHandling(
    chatId,
    text,
    messageThreadId,
    options = {}
  ) {
    if (messageThreadId) options.message_thread_id = messageThreadId;
    try {
      await bot.sendMessage(chatId, text, options);
    } catch (error) {
      if (error.response?.body?.description === "TOPIC_CLOSED") {
        const { message_thread_id, ...opts } = options;
        await bot.sendMessage(chatId, text, opts);
      } else throw error;
    }
  }

  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const messageThreadId = msg.message_thread_id; // if forum
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
      `Welcome to Nomu: Eat or Get Eaten ${activeEvent} 🪸\n\n` +
        `Eat smaller fish to grow bigger, but watch out for bigger ones!\n\n` +
        `Use the buttons below to:`,
      messageThreadId,
      { reply_markup: keyboard }
    );
  });

  bot.onText(/\/play/, async (msg) => {
    const chatId = msg.chat.id;
    const messageThreadId = msg.message_thread_id;

    await sendMessageWithErrorHandling(
      chatId,
      "Ready to play Eat or Get Eaten? 🐟\n\nClick the button below to start!",
      messageThreadId,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🎮 Play Now", url: process.env.GAME_URL }],
          ],
        },
      }
    );
  });

  bot.on("callback_query", async (cbq) => {
    const chatId = cbq.message.chat.id;
    const messageThreadId = cbq.message.message_thread_id;

    try {
      if (cbq.data === "highscores") {
        const highScores = await getActiveEventHighScores(10);
        let message = `🏆 Top 10 High Scores for ${activeEvent} 🏆\n\n`;
        highScores.forEach((s, i) => {
          message += `${i + 1}. ${s.username || "Anonymous"}: ${s.highScore}\n`;
        });
        await sendMessageWithErrorHandling(chatId, message, messageThreadId);
      } else if (cbq.data === "mystats") {
        const userScore = await getUserScore(cbq.from.id, activeEvent);
        if (userScore) {
          await sendMessageWithErrorHandling(
            chatId,
            `${activeEvent} Stats for ${userScore.username}:\n\n` +
              `High Score: ${userScore.highScore}\n` +
              `Last Score: ${userScore.lastScore}\n` +
              `Last Played: ${new Date(
                userScore.lastPlayed
              ).toLocaleDateString()}`,
            messageThreadId
          );
        } else {
          await sendMessageWithErrorHandling(
            chatId,
            `You haven't participated in ${activeEvent} yet! Click 'Play Game' to get started!`,
            messageThreadId
          );
        }
      }
    } catch (err) {
      console.error("Callback error:", err);
      await sendMessageWithErrorHandling(
        chatId,
        "Sorry, something went wrong.",
        messageThreadId
      );
    }
  });
}

/* ───────────────────────── App startup & shutdown ────────────────────── */

async function initializeApp() {
  try {
    await initializeDatabase();

    if (
      process.env.TELEGRAM_BOT_TOKEN &&
      process.env.GAME_URL &&
      !process.env.GAME_URL.includes("localhost")
    ) {
      botInitialized = initializeBot();
      if (botInitialized) setupBotCommands();
    }

    const server = app.listen(port, () => {
      console.log(`Server running on port ${port}`);
    });

    server.on("error", (err) => {
      console.error("Server error:", err);
      process.exit(1);
    });

    process.on("SIGTERM", async () => {
      await cleanup();
      process.exit(0);
    });
    process.on("SIGINT", async () => {
      await cleanup();
      process.exit(0);
    });
  } catch (err) {
    console.error("Initialization failed:", err);
    process.exit(1);
  }
}

async function cleanup() {
  if (bot) {
    try {
      await bot.stopPolling();
    } catch (err) {
      console.error("Error stopping bot:", err);
    }
  }
}

initializeApp().catch((err) => {
  console.error("Fatal error during initialization:", err);
  process.exit(1);
});
