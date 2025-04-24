require("dotenv").config();
const config = require("./config");
const activeEvent = config.activeEvent;

const { validate, parse } = require("@telegram-apps/init-data-node");

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

// app.use(
//   helmet.contentSecurityPolicy({
//     directives: {
//       defaultSrc: ["'self'"],
//       scriptSrc: [
//         "'self'",
//         "https://telegram.org",
//         "'unsafe-inline'", // allow inline scripts
//       ],
//       styleSrc: [
//         "'self'",
//         "'unsafe-inline'", // allow inline styles / style attributes
//         "https://fonts.googleapis.com",
//       ],
//       fontSrc: ["'self'", "https://fonts.gstatic.com"],
//       imgSrc: ["'self'", "data:", "https://telegram.org"],
//       mediaSrc: ["'self'"], // serve your MP3s
//       connectSrc: ["'self'"], // fetch() to your API
//       frameAncestors: ["'self'", "https://t.me", "https://web.telegram.org"],
//     },
//   })
// );

app.use(
  rateLimit({
    windowMs: 5 * 60 * 1000, // 5 min
    max: 100,
    // standardHeaders: true,
    // legacyHeaders: false,
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

const MAX_AGE_SECONDS = 60 * 60 * 24; // 24 h

function verifyTelegramData(req, res, next) {
  // We expect passing init data in the Authorization header in the following format:
  // <auth-type> <auth-data>
  // <auth-type> must be "tma", and <auth-data> is Telegram Mini Apps init data.
  const [authType, authData = ""] = (req.header("authorization") || "").split(
    " "
  );

  console.log("authType", authType);
  console.log("authData", authData);
  switch (authType) {
    case "tma":
      try {
        // Validate init data.
        validate(authData, process.env.TELEGRAM_BOT_TOKEN, {
          // We consider init data sign valid for 1 hour from their creation moment.
          // CHANGE THIS TO 24 HOURS
          expiresIn: 3600,
        });

        // Parse init data. We will surely need it in the future.
        req.telegramUser = parse(authData).user;
        console.log("✅ Telegram data verified", { user: req.telegramUser.id });
        console.log("req.telegramUser", req.telegramUser);
        console.log("req.telegramUser.username", req.telegramUser.username);
        return next();
      } catch (e) {
        return next(e);
      }
    // ... other authorization methods.
    default:
      return next(new Error("Unauthorized"));
  }

  /* ───── 1️⃣  Header present? ─────────────────────────────────────── */
  if (!initData) {
    console.warn("401 – Missing Telegram data");
    return res.status(401).json({ error: "Missing Telegram data" });
  }

  /* ───── 2️⃣  Build data_check_string (values DECODED) ─────────────── */
  const urlParams = new URLSearchParams(initData); // this decodes %xx

  const pairs = [];
  urlParams.forEach((value, key) => {
    if (key !== "hash") pairs.push(`${key}=${value}`); // plain key=value
  });
  pairs.sort(); // sort by key
  const dataCheckString = pairs.join("\n"); // newline-joined

  /* ───── 3️⃣  Derive Web-App secret key ────────────────────────────── */
  const secretKey = crypto
    .createHmac("sha256", process.env.TELEGRAM_BOT_TOKEN.trim()) // key = bot token
    .update("WebAppData") // msg = literal
    .digest(); // raw bytes

  /* ───── 4️⃣  Compare HMACs ────────────────────────────────────────── */
  const ourHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");
  const theirHash = urlParams.get("hash");

  if (ourHash !== theirHash) {
    console.warn("401 – Invalid Telegram hash", {
      theirHash,
      ourHash,
      botTokenPresent: !!process.env.TELEGRAM_BOT_TOKEN,
    });
    return res.status(401).json({ error: "Invalid Telegram hash" });
  }

  /* ───── 5️⃣  Expiry check ─────────────────────────────────────────── */
  const authDate = Number(urlParams.get("auth_date")) || 0;
  const age = Math.floor(Date.now() / 1000 - authDate);

  if (age > MAX_AGE_SECONDS) {
    console.warn("401 – initData expired", { age, MAX_AGE_SECONDS });
    return res.status(401).json({ error: "initData expired" });
  }

  /* ───── 6️⃣  Success ──────────────────────────────────────────────── */
  req.telegramUser = Object.fromEntries(urlParams); // already decoded
  delete req.telegramUser.hash;
  console.log("✅ Telegram data verified", { user: req.telegramUser.id, age });
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
    const { score, gameTime, event } = req.body;

    if (typeof score !== "number" || typeof gameTime !== "number") {
      return res.status(400).json({ error: "Invalid or missing fields" });
    }

    const {
      id: userId,
      username = req.telegramUser.first_name || "Anonymous",
    } = req.telegramUser;

    const updated = await updateScore(userId, username, score, gameTime, event);
    res.json(updated);
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
