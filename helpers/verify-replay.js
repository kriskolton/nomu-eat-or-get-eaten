/* verifyReplay.js — drop‑in validation helper for Nomu S3 replays */

const seedrandom =
  typeof require === "function" ? require("seedrandom") : self.seedrandom;

/* ------------------------------------------------------------------ */
/* Constant tables – MUST stay bit‑for‑bit identical to the client    */

/* ---------- fish‑type table --------------------------------------- */
const fishTypeDefinitions = [
  { minSize: 10, maxSize: 40, weight: 0.432 },
  { minSize: 20, maxSize: 60, weight: 0.252 },
  { minSize: 25, maxSize: 80, weight: 0.2 },
  { minSize: 35, maxSize: 100, weight: 0.1 },
  { minSize: 200, maxSize: 300, weight: 0.013 },
  { minSize: 400, maxSize: 500, weight: 0.003 },
];

const TOTAL_FISH_WEIGHT = fishTypeDefinitions.reduce(
  (sum, f) => sum + f.weight,
  0
);

function pickWeightedFishIndex(randFn) {
  let r = randFn() * TOTAL_FISH_WEIGHT;
  for (let i = 0; i < fishTypeDefinitions.length; i++) {
    if (r < fishTypeDefinitions[i].weight) return i;
    r -= fishTypeDefinitions[i].weight;
  }
  return fishTypeDefinitions.length - 1; // fallback (shouldn’t happen)
}

/* ---------- spawn‑kind weights (identical to client) -------------- */
const SPAWN_SPEC_WEIGHTS = [
  { kind: "fish", weight: 0.881 },
  { kind: "crab", weight: 0.00147 },
  { kind: "jelly", weight: 0.0294 },
  { kind: "electricJelly", weight: 0.0147 },
  { kind: "sushi", weight: 0.0147 },
  { kind: "puffer", weight: 0.0587 },
];
const TOTAL_SPEC_WEIGHT = SPAWN_SPEC_WEIGHTS.reduce((s, w) => s + w.weight, 0);

/* Bounds the client is allowed to report for each creature type */
const TYPE_SIZE_BOUNDS = {
  fish: (idx) => fishTypeDefinitions[idx],
  crab: () => ({ minSize: 50, maxSize: 120 }),
  jelly: () => ({ minSize: 30, maxSize: 80 }),
  electricJelly: () => ({ minSize: 40, maxSize: 90 }),
  sushi: () => ({ minSize: 30, maxSize: 30 }), // ← FIXED
  puffer: () => ({ minSize: 30, maxSize: 240 }) /* inflated */,
};

const calcFishScore = (sz) => Math.floor(sz);

/* ------------------------------------------------------------------ */
/* Main verifier                                                      */
function verifyReplay({
  seed,
  eaten,
  finalScore,
  gameTime,
  eatenBy,
  startTime,
  endTime,
}) {
  console.log("🔎 verifyReplay invoked", {
    seed,
    eatenEvents: eaten?.length,
    finalScore,
    gameTime,
    eatenBy,
    startTime,
    endTime,
  });

  /* quick sanity check --------------------------------------------- */
  if (
    typeof seed !== "string" ||
    !Array.isArray(eaten) ||
    typeof finalScore !== "number"
  ) {
    console.error("❌ verifyReplay received malformed arguments");
    return {
      ok: false,
      failedDueTo: "Verification failed: malformed arguments",
    };
  }

  /* Special case: empty array with zero score is valid */
  if (eaten.length === 0) {
    if (finalScore === 0) {
      console.log(
        "🎉 replay verified successfully (empty array with zero score)"
      );
      return { ok: true, failedDueTo: null };
    }
    console.error("❌ empty eaten array but non-zero score");
    return {
      ok: false,
      failedDueTo: "Verification failed: empty eaten array but non-zero score",
    };
  }

  /* 1️⃣ deterministic RNG streams ---------------------------------- */
  const spawnSpecRng = seedrandom(`${seed}:spec`);
  const spawnTimingRng = seedrandom(`${seed}:timing`);

  const specRand = () => spawnSpecRng();
  const getSpecRandom = (a, b) => specRand() * (b - a) + a;
  const nextDelay = () => {
    const u = spawnTimingRng(); // λ = 1.8 /s (client)
    return -Math.log(1 - u) / 1.8;
  };

  /* 2️⃣ build schedule up to needed index -------------------------- */
  // const maxIdx = eaten.reduce((m, e) => Math.max(m, e.idx), -1);
  /* longest index we must simulate (NEW ⧗) */
  const maxIdx = Math.max(
    eaten.reduce((m, e) => Math.max(m, e.idx), -1),
    typeof eatenBy === "number" ? eatenBy : -1
  );

  if (maxIdx < 0) {
    console.error("❌ eaten array empty or missing idx values");
    return {
      ok: false,
      failedDueTo:
        "Verification failed: eaten array empty or missing idx values",
    };
  }

  const schedule = new Array(maxIdx + 1); // { spawnTimeMs, spec }

  let cursorSec = 0;

  for (let idx = 0; idx <= maxIdx; idx++) {
    /* pick spawn kind (weighted) ----------------------------------- */
    let r = specRand() * TOTAL_SPEC_WEIGHT;
    let kind;
    for (const w of SPAWN_SPEC_WEIGHTS) {
      if (r < w.weight) {
        kind = w.kind;
        break;
      }
      r -= w.weight;
    }
    if (!kind) kind = "fish"; // shouldn’t happen

    /* deterministic spec ------------------------------------------- */
    let spec;
    switch (kind) {
      case "fish": {
        /* exact RNG call order must mirror client ------------------ */
        const tIdx = pickWeightedFishIndex(specRand); // 1) sprite
        const tDef = fishTypeDefinitions[tIdx];
        const size = getSpecRandom(tDef.minSize, tDef.maxSize); // 2) size
        const fromLeft = specRand() < 0.5; // 3) side
        const rand = specRand(); // 4) ultra/fast
        const ultra = rand < 0.01;
        const fast = !ultra && rand < 0.04;
        const sizeFactor = 1 - size / 500;
        const baseSpeed = getSpecRandom(
          // 5) speed
          0.3 + 0.5 * sizeFactor,
          1.5 + 0.3 * sizeFactor
        );
        spec = {
          kind,
          fishTypeIndex: tIdx,
          size,
          fromLeft,
          ultra,
          fast,
          baseSpeed,
        };
        break;
      }

      case "crab":
        spec = { kind, size: getSpecRandom(50, 120) };
        break;

      case "jelly":
        spec = { kind, size: getSpecRandom(30, 80) };
        break;

      case "electricJelly":
        spec = { kind, size: getSpecRandom(40, 90) };
        break;

      case "sushi":
        // Sushi has a fixed size (30 px).  ONE RNG draw is enough.
        spec = { kind, fromLeft: specRand() < 0.5 };
        break;

      case "puffer":
        spec = {
          kind,
          baseSize: getSpecRandom(30, 60),
          fromLeft: specRand() < 0.5,
        };
        break;
    }

    /* cumulative spawn time ---------------------------------------- */
    cursorSec += nextDelay();
    schedule[idx] = { spawnTimeMs: Math.round(cursorSec * 1000), spec };
  }

  /* 3️⃣ validate the eatenBy timing window (NEW ⧗) ------------------ */
  if (typeof eatenBy !== "number" || eatenBy < 0) {
    console.error("❌ missing or invalid eatenBy idx");
    return {
      ok: false,
      failedDueTo: "Verification failed: missing or invalid eatenBy idx",
    };
  }
  if (
    typeof startTime !== "number" ||
    typeof endTime !== "number" ||
    endTime <= startTime ||
    endTime - startTime > gameTime + 3_000
  ) {
    console.error("❌ missing/invalid startTime or endTime");
    return {
      ok: false,
      failedDueTo: "Verification failed: missing/invalid startTime or endTime",
    };
  }

  const killerEntry = schedule[eatenBy];
  if (!killerEntry) {
    console.error(`❌ eatenBy idx=${eatenBy} has no schedule entry`);
    return {
      ok: false,
      failedDueTo: "Verification failed: eatenBy idx has no schedule entry",
    };
  }

  const runDurationMs = endTime - startTime; // how long the round lasted
  const killerSpawnMs = killerEntry.spawnTimeMs; // when that enemy appeared

  if (killerSpawnMs > runDurationMs) {
    console.error(
      `❌ eatenBy idx=${eatenBy} spawned AFTER reported endTime (spawn ${killerSpawnMs} ms > end ${runDurationMs} ms)`
    );
    return {
      ok: false,
      failedDueTo:
        "Verification failed: eatenBy idx spawned AFTER reported endTime",
    };
  }
  if (runDurationMs - killerSpawnMs > 120_000) {
    console.error(
      `❌ eatenBy idx=${eatenBy} spawned more than 60 000 ms before endTime`
    );
    return {
      ok: false,
      failedDueTo:
        "Verification failed: eatenBy idx spawned more than 60 000 ms before endTime",
    };
  }

  /* 4️⃣ validate each eaten event ---------------------------------- */
  let computedScore = 0;

  for (const ev of eaten) {
    const { idx, t, type, size, ultra } = ev;

    const entry = schedule[idx];
    if (!entry) {
      console.error(`❌ No schedule entry for idx=${idx}`);
      return {
        ok: false,
        failedDueTo: "Verification failed: no schedule entry for idx",
      };
    }

    /* time window check ------------------------------------------- */
    const dt = t - entry.spawnTimeMs;
    if (dt < 0 || dt > 60000) {
      console.error(
        `❌ idx=${idx} eaten ${dt} ms outside allowed window (0–60 000)`
      );
      return {
        ok: false,
        failedDueTo: "Verification failed: eaten outside allowed window",
      };
    }

    /* type match --------------------------------------------------- */
    const expectedType =
      entry.spec.kind === "electricJelly" ? "elecJelly" : entry.spec.kind;
    if (type !== expectedType) {
      console.error(
        `❌ idx=${idx} type mismatch — expected ${expectedType}, got ${type}`
      );
      return {
        ok: false,
        failedDueTo: "Verification failed: type mismatch",
      };
    }

    /* size bounds -------------------------------------------------- */
    const bounds =
      type === "fish"
        ? TYPE_SIZE_BOUNDS.fish(entry.spec.fishTypeIndex)
        : TYPE_SIZE_BOUNDS[type === "elecJelly" ? "electricJelly" : type]();

    if (size < bounds.minSize - 0.001 || size > bounds.maxSize + 0.001) {
      console.error(
        `❌ idx=${idx} size ${size} outside [${bounds.minSize}..${bounds.maxSize}]`
      );
      return {
        ok: false,
        failedDueTo: "Verification failed: size outside bounds",
      };
    }

    /* ultra flag for fish ----------------------------------------- */
    if (type === "fish") {
      const expectedUltra = !!entry.spec.ultra;
      if (!!ultra !== expectedUltra) {
        console.error(
          `❌ idx=${idx} ultra flag mismatch — expected ${expectedUltra}, got ${ultra}`
        );
        return {
          ok: false,
          failedDueTo: "Verification failed: ultra flag mismatch",
        };
      }
    }

    /* score accumulation ------------------------------------------ */
    const pts = type === "sushi" ? 50 : calcFishScore(size);
    computedScore += pts;
  }

  /* 5️⃣ final score comparison ------------------------------------- */
  if (computedScore !== finalScore) {
    console.error(
      `❌ computed score ${computedScore} ≠ reported ${finalScore}`
    );
    return {
      ok: false,
      failedDueTo: "Verification failed: computed score mismatch",
    };
  }

  console.log("🎉 replay verified successfully (score matches)");
  return {
    ok: true,
    failedDueTo: null,
  };
}

/* export for Node / Jest / etc. */
if (typeof module !== "undefined") {
  module.exports = verifyReplay;
}
