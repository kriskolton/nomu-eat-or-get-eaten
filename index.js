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
  setTeam,
} = require("./repositories/scoreRepository");

const {
  createSession,
  fetchSession,
  // verifyReplay,
} = require("./repositories/sessionRepository");
const verifyReplay = require("./helpers/verify-replay");

/* ────────── Cross-DB helpers (lazy singletons) ────────── */
const { MongoClient } = require("mongodb");

/* referral-bot.users */
let referralUsersColl;
async function getReferralUsersColl() {
  if (referralUsersColl) return referralUsersColl;

  const uri = process.env.REFERRAL_BOT_MONGODB_URI;
  if (!uri) throw new Error("REFERRAL_BOT_MONGODB_URI is not set");

  const client = new MongoClient(uri, { retryWrites: true });
  await client.connect();
  referralUsersColl = client
    .db(process.env.REFERRAL_BOT_DATABASE_NAME)
    .collection("users");
  return referralUsersColl;
}

/* main scores collection – for the upsert */
let scoresColl;
async function getScoresColl() {
  if (scoresColl) return scoresColl;

  const uri = process.env.MONGODB_URI; // already in prod
  const client = new MongoClient(uri, { retryWrites: true });
  await client.connect();
  // default DB is whatever you use in MONGODB_URI
  scoresColl = client.db(process.env.DATABASE_NAME).collection("scores");
  return scoresColl;
}

const app = express();
const port = process.env.PORT || 3000;

/* ───────────────────────── Security middleware ───────────────────────── */

app.use(
  helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "https://telegram.org",
        "https://cdnjs.cloudflare.com", // allow seedrandom CDN
        "'unsafe-inline'", // allow inline scripts
      ],
      styleSrc: [
        "'self'",
        "'unsafe-inline'", // allow inline styles / style attributes
        "https://fonts.googleapis.com",
      ],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https://telegram.org"],
      mediaSrc: ["'self'"], // serve your MP3s
      connectSrc: ["'self'"], // fetch() to your API
      frameAncestors: ["'self'", "https://t.me", "https://web.telegram.org"],
    },
  })
);

// app.use(
//   rateLimit({
//     windowMs: 5 * 60 * 1000, // 5 min
//     max: 100,
//     standardHeaders: true,
//     legacyHeaders: false,
//   })
// );

/* ───────────────────────── Telegram bot (optional) ───────────────────── */

let bot = null;
let botInitialized = false;

// Helper function to decode HTML entities
function decodeHtmlEntities(text) {
  if (!text) return text;

  const entities = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&#x27;": "'",
    "&#x2F;": "/",
    "&#x60;": "`",
    "&#x3D;": "=",
  };

  return text.replace(/&[#\w]+;/g, (entity) => {
    return entities[entity] || entity;
  });
}

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

function verifyTelegramData(req, res, next) {
  // ─── Development mode bypass ────────────────────────────────────
  if (process.env.ENVIRONMENT === "development") {
    // Inject a dummy Telegram user so the rest of the pipeline works.
    req.telegramUser = { id: "local-dev", username: "dev" };
    return next();
  }
  // ────────────────────────────────────────────────────────────────
  // We expect passing init data in the Authorization header in the following format:
  // <auth-type> <auth-data>
  // <auth-type> must be "tma", and <auth-data> is Telegram Mini Apps init data.
  const [authType, authData = ""] = (req.header("authorization") || "").split(
    " "
  );

  switch (authType) {
    case "tma":
      try {
        // Validate init data.
        validate(authData, process.env.TELEGRAM_BOT_TOKEN, {
          // We consider init data sign valid for 1 hour from their creation moment.
          // CHANGE THIS TO 24 HOURS
          expiresIn: 3600 * 24,
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
}

/* ───────────────────────── API password (obfuscated) ────────────────── */

function generateApiPassword() {
  /* Mirror the client-side obfuscation logic – seed stored as offset codes */
  const codes = [68, 111, 115, 107, 100, 82, 112, 104, 106, 100];
  const seed = codes.map((c) => String.fromCharCode(c - 3)).join("");
  return seed
    .split("")
    .map((ch) => ch.charCodeAt(0).toString(16))
    .join("");
}

function verifyApiPassword(req, res, next) {
  const provided = req.header("x-api-password") || "";
  if (provided === generateApiPassword()) return next();
  return res.status(401).json({ error: "Unauthorized" });
}

/* ───────────────────────── Express routes ────────────────────────────── */

app.use(express.static("public"));
// Increase JSON & URL-encoded body limits to 10 MB
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Serve index.html *as is* – no credentials leaked to the client
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/* ───────────────────────── Start-game session ──────────────────────── */

app.post(
  "/api/session",
  verifyTelegramData,
  verifyApiPassword,
  async (req, res) => {
    try {
      const { id: userId } = req.telegramUser;
      const { sessionId, seed } = await createSession(userId);
      res.json({ sessionId, seed });
    } catch (err) {
      console.error("Session creation error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

app.get(
  "/api/score",
  verifyTelegramData,
  verifyApiPassword,
  async (req, res) => {
    const { id: userId } = req.telegramUser;
    const score = await getUserScore(userId, activeEvent);
    res.json(score);
  }
);

app.post(
  "/api/score/team",
  verifyTelegramData,
  verifyApiPassword,
  async (req, res) => {
    const { id: userId, username } = req.telegramUser;
    const { team } = req.body;

    await setTeam(userId, username, team);

    const score = await getUserScore(userId, activeEvent);
    if (!score) {
      return res.status(404).json({ error: "Error setting team" });
    }

    res.json(score);
  }
);

// Submit a score (POST)
// Protected only by Telegram signature
app.post(
  "/api/scores",
  verifyTelegramData,
  verifyApiPassword,
  async (req, res) => {
    try {
      const currentTime = new Date();
      console.log("Received score submission request:", req.body);

      const {
        score,
        gameTime,
        event,
        sessionId,
        eaten,
        eatenBy,
        epochGameStartTime,
        epochGameEndTime,
      } = req.body;

      if (
        typeof score !== "number" ||
        typeof gameTime !== "number" ||
        typeof event !== "string" ||
        typeof sessionId !== "string" ||
        !Array.isArray(eaten) ||
        typeof eatenBy !== "number" ||
        typeof epochGameStartTime !== "number" ||
        typeof epochGameEndTime !== "number"
      ) {
        console.error("Invalid or missing required fields:", {
          score,
          gameTime,
          event,
          sessionId,
          eaten,
          eatenBy,
          epochGameStartTime,
          epochGameEndTime,
        });
        return res.status(400).json({ error: "Invalid or missing fields" });
      }

      const { id: userId, username } = req.telegramUser;

      let isFlagged = false;
      let flaggedFor = [];

      // 🔒 validate session & replay
      const sess = await fetchSession(sessionId, userId);
      if (!sess) {
        console.warn("Invalid or expired session", { userId, sessionId });
        isFlagged = true;
        flaggedFor.push("Invalid or expired session");
        return res.status(400).json({ error: "Invalid or expired session" });
      }

      /* ─────────── BASIC TIME SANITY CHECKS ─────────── */

      const SESSION_START_MS = new Date(sess.createdAt).getTime();
      const CLIENT_START_MS = Number(epochGameStartTime);
      const CLIENT_END_MS = Number(epochGameEndTime);
      const GAME_DURATION_MS = Number(gameTime);
      const MAX_CLIENT_DELTA_MS = 1000 * 60 * 1; // 5 minutes

      // 1️⃣  Client-reported [start, end] ordering
      if (CLIENT_START_MS > CLIENT_END_MS) {
        isFlagged = true;
        flaggedFor.push("epochGameStartTime after epochGameEndTime");
      }

      // 2️⃣  Internal duration consistency
      // if (CLIENT_START_MS + GAME_DURATION_MS > CLIENT_END_MS) {
      //   isFlagged = true;
      //   flaggedFor.push("start + gameTime exceeds end");
      // }

      // 3️⃣  Gameplay must have started no earlier than session creation
      if (CLIENT_START_MS < SESSION_START_MS - MAX_CLIENT_DELTA_MS) {
        isFlagged = true;
        flaggedFor.push("Game started before session existed");
      }

      // 4️⃣  Gameplay must have finished by the time the POST reached us
      if (CLIENT_END_MS > currentTime + MAX_CLIENT_DELTA_MS) {
        isFlagged = true;
        flaggedFor.push("Game ends in the future");
      }

      // 5️⃣  Session start + duration cannot exceed 'now'
      if (SESSION_START_MS + GAME_DURATION_MS > currentTime) {
        isFlagged = true;
        flaggedFor.push("Session start + gameTime exceeds now");
      }

      const { ok, failedDueTo } = verifyReplay({
        seed: sess.seed,
        eaten: eaten,
        finalScore: score,
        gameTime,
        eatenBy,
        startTime: epochGameStartTime,
        endTime: epochGameEndTime,
      });

      if (!ok) {
        console.warn("Replay verification failed", { userId, sessionId });
        // return res.status(400).json({ error: "Replay check failed" });
        isFlagged = true;
        flaggedFor.push(failedDueTo);
      }

      const updated = await updateScore(
        userId,
        username,
        score,
        gameTime,
        event,
        sessionId,
        isFlagged,
        flaggedFor
      );
      res.json(updated);
    } catch (err) {
      console.error("Error submitting score:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

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

  bot.onText(/\/play/, async (msg) => {
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
      `Welcome to Nomu: Eat or Get Eaten ${activeEvent} 🔥\n\n` +
        `Eat smaller fish to grow bigger, but watch out for bigger ones!\n\n` +
        `Use the buttons below to:`,
      messageThreadId,
      { reply_markup: keyboard }
    );
  });

  // bot.onText(/\/play/, async (msg) => {
  //   const chatId = msg.chat.id;
  //   const messageThreadId = msg.message_thread_id;

  //   await sendMessageWithErrorHandling(
  //     chatId,
  //     "Ready to play Eat or Get Eaten? 🐟\n\nClick the button below to start!",
  //     messageThreadId,
  //     {
  //       reply_markup: {
  //         inline_keyboard: [
  //           [{ text: "🎮 Play Now", url: process.env.GAME_URL }],
  //         ],
  //       },
  //     }
  //   );
  // });

  bot.on("callback_query", async (cbq) => {
    const chatId = cbq.message.chat.id;
    const messageThreadId = cbq.message.message_thread_id;

    try {
      if (cbq.data === "highscores") {
        /* 1️⃣  Pull the current event's top scores */
        const highScores = await getActiveEventHighScores(10);

        /* 2️⃣  Collect userIds missing a firstName */
        const missingIds = highScores
          .filter((s) => !s.firstName)
          .map((s) => s.userId);

        if (missingIds.length) {
          try {
            /* 3️⃣  Bulk-fetch first names from referral-bot.users */
            const referralColl = await getReferralUsersColl();
            const refs = await referralColl
              .find(
                { _id: { $in: missingIds } },
                { projection: { first_name: 1 } }
              )
              .toArray();

            const nameMap = Object.fromEntries(
              refs.map((u) => [u._id, u.first_name])
            );

            /* 4️⃣  Enrich the in-memory list (no DB write-back) */
            highScores.forEach((s) => {
              if (!s.firstName && nameMap[s.userId]) {
                s.firstName = nameMap[s.userId];
              }
            });
          } catch (e) {
            console.warn("first-name lookup failed:", e);
          }
        }

        /* 5️⃣  Craft and send the leaderboard message */
        let message = `🏆 Top 10 High Scores for ${activeEvent} 🏆\n\n`;
        highScores.forEach((s, i) => {
          const rawDisplayName = s.firstName || s.username || String(s.userId);
          const displayName = decodeHtmlEntities(rawDisplayName);

          message += `${i + 1}. ${displayName}: ${s.highScore}\n`;
        });

        await sendMessageWithErrorHandling(chatId, message, messageThreadId);
      } else if (cbq.data === "mystats") {
        const userScore = await getUserScore(cbq.from.id, activeEvent);

        if (userScore) {
          /* 🔍  Try to obtain firstName (don’t persist) */
          let firstName = userScore.firstName; // if it’s already in the doc
          if (!firstName) {
            try {
              const referralColl = await getReferralUsersColl();
              const ref = await referralColl.findOne(
                { _id: userScore.userId ?? cbq.from.id },
                { projection: { first_name: 1 } }
              );
              if (ref?.first_name) firstName = ref.first_name;
            } catch (e) {
              console.warn("first-name lookup for mystats failed:", e);
            }
          }

          /* 📝  Build and send the stats message */
          const userLabelRaw = firstName
            ? `${userScore.username} (${firstName})`
            : userScore.username;

          const userLabel = decodeHtmlEntities(userLabelRaw);

          await sendMessageWithErrorHandling(
            chatId,
            `${activeEvent} Stats for ${userLabel}:\n\n` +
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
