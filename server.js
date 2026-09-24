const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const bcrypt = require("bcryptjs");
const path = require("path");
const Database = require("better-sqlite3");

const app = express();
app.set("trust proxy", 1);

const PORT = process.env.PORT || 3000;
const db = new Database(process.env.DB_PATH || "scrimforge.db");

db.exec(`
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,
  time TEXT NOT NULL,
  fee TEXT NOT NULL,
  team TEXT NOT NULL,
  captain TEXT NOT NULL,
  phone TEXT NOT NULL,
  uid TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lobby TEXT NOT NULL,
  winner TEXT NOT NULL,
  kills INTEGER NOT NULL,
  points INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS match_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lobby TEXT NOT NULL,
  match_no INTEGER NOT NULL,
  team TEXT NOT NULL,
  position INTEGER NOT NULL,
  kills INTEGER NOT NULL DEFAULT 0,
  booyahs INTEGER NOT NULL DEFAULT 0,
  placement_points INTEGER NOT NULL DEFAULT 0,
  kill_points INTEGER NOT NULL DEFAULT 0,
  total_points INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE(lobby, match_no, team)
);
`);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  store: new SQLiteStore({
    db: "sessions.sqlite",
    dir: "."
  }),
  secret: process.env.SESSION_SECRET || "CHANGE_THIS_TO_A_LONG_RANDOM_SECRET",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 12
  }
}));

app.use(express.static(path.join(__dirname, "public")));

function auth(req, res, next) {
  if (!req.session.adminId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

function now() {
  return new Date().toISOString();
}


/* =========================
   PLACEMENT SCORING
========================= */

const PLACEMENT_POINTS = {
  1: 12,
  2: 9,
  3: 8,
  4: 7,
  5: 6,
  6: 5,
  7: 4,
  8: 3,
  9: 2,
  10: 1,
  11: 0,
  12: 0
};


/* =========================
   ADMIN SETUP
========================= */

app.post("/api/setup-admin", async (req, res) => {
  try {
    const count = db
      .prepare("SELECT COUNT(*) c FROM admins")
      .get().c;

    if (count) {
      return res.status(403).json({
        error: "Admin already exists"
      });
    }

    const { name, email, password } = req.body;

    if (!name || !email || !password || password.length < 6) {
      return res.status(400).json({
        error: "Name, email and a password of at least 6 characters are required"
      });
    }

    const cleanName = name.trim();
    const cleanEmail = email.trim().toLowerCase();

    const hash = await bcrypt.hash(password, 12);

    const info = db.prepare(`
      INSERT INTO admins(
        name,
        email,
        password_hash,
        created_at
      )
      VALUES(?,?,?,?)
    `).run(
      cleanName,
      cleanEmail,
      hash,
      now()
    );

    req.session.adminId = info.lastInsertRowid;
    req.session.adminName = cleanName;

    req.session.save((err) => {
      if (err) {
        console.error("SESSION SAVE ERROR:", err);

        return res.status(500).json({
          error: "Admin created, but session could not be saved"
        });
      }

      console.log("ADMIN CREATED:", cleanEmail);

      res.json({
        ok: true,
        name: cleanName
      });
    });

  } catch (err) {
    console.error("SETUP ADMIN ERROR:", err);

    res.status(500).json({
      error: "Could not create admin. Check the Render logs for SETUP ADMIN ERROR."
    });
  }
});


/* =========================
   ADMIN LOGIN
========================= */

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const admin = db
      .prepare("SELECT * FROM admins WHERE email=?")
      .get((email || "").trim().toLowerCase());

    if (
      !admin ||
      !(await bcrypt.compare(
        password || "",
        admin.password_hash
      ))
    ) {
      return res.status(401).json({
        error: "Incorrect email or password"
      });
    }

    req.session.adminId = admin.id;
    req.session.adminName = admin.name;

    req.session.save((err) => {
      if (err) {
        console.error("LOGIN SESSION ERROR:", err);

        return res.status(500).json({
          error: "Login succeeded but session could not be saved"
        });
      }

      res.json({
        ok: true,
        name: admin.name
      });
    });

  } catch (err) {
    console.error("LOGIN ERROR:", err);

    res.status(500).json({
      error: "Could not log in"
    });
  }
});


/* =========================
   LOGOUT
========================= */

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});


/* =========================
   CURRENT ADMIN
========================= */

app.get("/api/me", (req, res) => {
  res.json({
    loggedIn: !!req.session.adminId,
    name: req.session.adminName || null
  });
});


/* =========================
   REGISTRATIONS
========================= */

app.post("/api/registrations", (req, res) => {
  const {
    time,
    fee,
    team,
    captain,
    phone,
    uid
  } = req.body;

  if (
    !time ||
    !fee ||
    !team ||
    !captain ||
    !phone ||
    !uid
  ) {
    return res.status(400).json({
      error: "All fields are required"
    });
  }

  const ref =
    `SF-${time.replace(/\s/g, "").replace(":", "")}-${fee}-${Math.floor(1000 + Math.random() * 9000)}`;

  try {
    db.prepare(`
      INSERT INTO registrations(
        ref,
        time,
        fee,
        team,
        captain,
        phone,
        uid,
        status,
        created_at
      )
      VALUES(?,?,?,?,?,?,?,'pending',?)
    `).run(
      ref,
      time,
      fee,
      team,
      captain,
      phone,
      uid,
      now()
    );

    res.json({
      ok: true,
      ref
    });

  } catch (e) {
    console.error("REGISTRATION ERROR:", e);

    res.status(500).json({
      error: "Could not save registration"
    });
  }
});


app.get("/api/registrations", auth, (req, res) => {
  res.json(
    db
      .prepare("SELECT * FROM registrations ORDER BY id DESC")
      .all()
  );
});


/* =========================
   PUBLIC LOBBY COUNTS
========================= */

app.get("/api/public/lobbies", (req, res) => {
  res.json(
    db.prepare(`
      SELECT
        time,
        fee,
        COUNT(*) AS confirmed
      FROM registrations
      WHERE status='confirmed'
      GROUP BY time, fee
    `).all()
  );
});


/* =========================
   ADMIN EXISTS
========================= */

app.get("/api/admin-exists", (req, res) => {
  res.json({
    exists: !!db
      .prepare("SELECT id FROM admins LIMIT 1")
      .get()
  });
});


/* =========================
   UPDATE REGISTRATION
========================= */

app.patch("/api/registrations/:id", auth, (req, res) => {
  const status = req.body.status;

  if (
    !["pending", "confirmed", "rejected"]
      .includes(status)
  ) {
    return res.status(400).json({
      error: "Invalid status"
    });
  }

  const r = db
    .prepare(
      "UPDATE registrations SET status=? WHERE id=?"
    )
    .run(status, req.params.id);

  if (!r.changes) {
    return res.status(404).json({
      error: "Registration not found"
    });
  }

  res.json({
    ok: true
  });
});


/* =========================
   OLD RESULTS
========================= */

app.get("/api/results", (req, res) => {
  res.json(
    db
      .prepare("SELECT * FROM results ORDER BY id DESC")
      .all()
  );
});


app.post("/api/results", auth, (req, res) => {
  const {
    lobby,
    winner,
    kills,
    points
  } = req.body;

  if (
    !lobby ||
    !winner ||
    kills === undefined ||
    points === undefined
  ) {
    return res.status(400).json({
      error: "All result fields are required"
    });
  }

  db.prepare(`
    INSERT INTO results(
      lobby,
      winner,
      kills,
      points,
      created_at
    )
    VALUES(?,?,?,?,?)
  `).run(
    lobby,
    winner,
    Number(kills),
    Number(points),
    now()
  );

  res.json({
    ok: true
  });
});


/* =========================
   ADMIN STATS
========================= */

app.get("/api/stats", auth, (req, res) => {
  const pending = db
    .prepare(
      "SELECT COUNT(*) c FROM registrations WHERE status='pending'"
    )
    .get().c;

  const confirmed = db
    .prepare(
      "SELECT COUNT(*) c FROM registrations WHERE status='confirmed'"
    )
    .get().c;

  res.json({
    pending,
    confirmed,
    activeLobbies: 30
  });
});


/* =========================
   LEADERBOARD:
   GET CONFIRMED TEAMS
========================= */

app.get("/api/leaderboard/teams", auth, (req, res) => {
  const { lobby } = req.query;

  if (!lobby) {
    return res.status(400).json({
      error: "Lobby is required"
    });
  }

  const parts = lobby.split(" · ");
  const time = parts[0];
  const fee = parts.slice(1).join(" · ").replace(/^₹/, "");

  if (!time || !fee) {
    return res.status(400).json({
      error: "Invalid lobby"
    });
  }

  const teams = db.prepare(`
    SELECT
      id,
      team,
      captain,
      uid
    FROM registrations
    WHERE time=?
      AND fee=?
      AND status='confirmed'
    ORDER BY id ASC
    LIMIT 12
  `).all(time, fee);

  res.json(teams);
});


/* =========================
   SAVE ONE MATCH
========================= */

app.post("/api/leaderboard/match", auth, (req, res) => {
  try {
    const { lobby, matchNo, entries } = req.body;

    const match = Number(matchNo);

    if (!lobby || !Number.isInteger(match) || match < 1 || match > 6) {
      return res.status(400).json({
        error: "Valid lobby and match number 1-6 are required"
      });
    }

    if (!Array.isArray(entries) || entries.length !== 12) {
      return res.status(400).json({
        error: "Exactly 12 team entries are required"
      });
    }

    const positions = entries.map(e => Number(e.position));

    const uniquePositions = new Set(positions);

    if (
      positions.some(p => !Number.isInteger(p) || p < 1 || p > 12) ||
      uniquePositions.size !== 12
    ) {
      return res.status(400).json({
        error: "Positions must contain every number from 1 to 12 exactly once"
      });
    }

    const teams = entries.map(e => String(e.team || "").trim());

    if (teams.some(t => !t)) {
      return res.status(400).json({
        error: "Every team must have a name"
      });
    }

    const uniqueTeams = new Set(teams);

    if (uniqueTeams.size !== 12) {
      return res.status(400).json({
        error: "Each team must be unique"
      });
    }

    const save = db.transaction(() => {

      const deleteOld = db.prepare(`
        DELETE FROM match_results
        WHERE lobby=? AND match_no=?
      `);

      deleteOld.run(lobby, match);

      const insert = db.prepare(`
        INSERT INTO match_results(
          lobby,
          match_no,
          team,
          position,
          kills,
          booyahs,
          placement_points,
          kill_points,
          total_points,
          created_at
        )
        VALUES(?,?,?,?,?,?,?,?,?,?)
      `);

      for (const entry of entries) {
        const position = Number(entry.position);
        const kills = Math.max(0, Number(entry.kills) || 0);

        const placementPoints =
          PLACEMENT_POINTS[position] || 0;

        const booyahs =
          position === 1 ? 1 : 0;

        const killPoints = kills;

        const totalPoints =
          placementPoints + killPoints;

        insert.run(
          lobby,
          match,
          String(entry.team).trim(),
          position,
          kills,
          booyahs,
          placementPoints,
          killPoints,
          totalPoints,
          now()
        );
      }
    });

    save();

    res.json({
      ok: true,
      message: `Match ${match} saved successfully`
    });

  } catch (err) {
    console.error("SAVE MATCH ERROR:", err);

    res.status(500).json({
      error: "Could not save match"
    });
  }
});


/* =========================
   GET OVERALL LEADERBOARD
========================= */

app.get("/api/leaderboard", (req, res) => {
  try {
    const lobby = String(req.query.lobby || "").trim();

    if (!lobby) {
      return res.status(400).json({
        error: "Lobby is required"
      });
    }

    const rows = db.prepare(`
      SELECT
        team,
        SUM(booyahs) AS booyahs,
        SUM(placement_points) AS placement_points,
        SUM(kill_points) AS kill_points,
        SUM(total_points) AS total_points,
        COUNT(*) AS matches_played
      FROM match_results
      WHERE lobby=?
      GROUP BY team
      ORDER BY total_points DESC, kill_points DESC, booyahs DESC, team ASC
    `).all(lobby);

    const leaderboard = rows.map((r, index) => ({
      position: index + 1,
      team: r.team,
      booyahs: Number(r.booyahs || 0),
      placementPoints: Number(r.placement_points || 0),
      killPoints: Number(r.kill_points || 0),
      totalPoints: Number(r.total_points || 0),
      matchesPlayed: Number(r.matches_played || 0)
    }));

    res.json(leaderboard);

  } catch (err) {
    console.error("LEADERBOARD ERROR:", err);

    res.status(500).json({
      error: "Could not load leaderboard"
    });
  }
});


/* =========================
   GET INDIVIDUAL MATCH
========================= */

app.get("/api/leaderboard/match", (req, res) => {
  try {
    const lobby = String(req.query.lobby || "").trim();
    const match = Number(req.query.match);

    if (!lobby || !Number.isInteger(match) || match < 1 || match > 6) {
      return res.status(400).json({
        error: "Valid lobby and match number are required"
      });
    }

    const rows = db.prepare(`
      SELECT
        team,
        position,
        kills,
        booyahs,
        placement_points,
        kill_points,
        total_points
      FROM match_results
      WHERE lobby=? AND match_no=?
      ORDER BY position ASC
    `).all(lobby, match);

    res.json(rows);

  } catch (err) {
    console.error("MATCH LOAD ERROR:", err);

    res.status(500).json({
      error: "Could not load match"
    });
  }
});


/* =========================
   PUBLIC LEADERBOARD
========================= */

app.get("/api/public-leaderboard", (req, res) => {
  try {
    const lobby = String(req.query.lobby || "").trim();

    if (!lobby) {
      return res.status(400).json({
        error: "Lobby is required"
      });
    }

    const rows = db.prepare(`
      SELECT
        team,
        SUM(booyahs) AS booyahs,
        SUM(placement_points) AS placement_points,
        SUM(kill_points) AS kill_points,
        SUM(total_points) AS total_points,
        COUNT(*) AS matches_played
      FROM match_results
      WHERE lobby=?
      GROUP BY team
      ORDER BY total_points DESC, kill_points DESC, booyahs DESC, team ASC
    `).all(lobby);

    res.json(rows.map((r, index) => ({
      position: index + 1,
      team: r.team,
      booyahs: Number(r.booyahs || 0),
      placementPoints: Number(r.placement_points || 0),
      killPoints: Number(r.kill_points || 0),
      totalPoints: Number(r.total_points || 0),
      matchesPlayed: Number(r.matches_played || 0)
    })));

  } catch (err) {
    console.error("PUBLIC LEADERBOARD ERROR:", err);

    res.status(500).json({
      error: "Could not load public leaderboard"
    });
  }
});


/* =========================
   FRONTEND
========================= */

app.get("*", (req, res) => {
  res.sendFile(
    path.join(
      __dirname,
      "public",
      "index.html"
    )
  );
});


/* =========================
   START SERVER
========================= */

app.listen(PORT, () => {
  console.log(
    `ScrimForge V2 running on http://localhost:${PORT}`
  );
});
