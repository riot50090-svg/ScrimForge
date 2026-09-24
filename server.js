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

db.pragma("journal_mode = WAL");

/* =====================================================
   DATABASE
===================================================== */

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

CREATE TABLE IF NOT EXISTS lobbies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  time TEXT NOT NULL,
  fee TEXT NOT NULL,
  max_teams INTEGER NOT NULL DEFAULT 12,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL
);
`);

/* =====================================================
   AUTOMATIC DATABASE MIGRATION
===================================================== */

function columnExists(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`)
    .all()
    .some(c => c.name === column);
}

if (!columnExists("registrations", "lobby_id")) {
  db.exec(`
    ALTER TABLE registrations
    ADD COLUMN lobby_id INTEGER
  `);
}

/* =====================================================
   EXPRESS
===================================================== */

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  store: new SQLiteStore({
    db: "sessions.sqlite",
    dir: "."
  }),
  secret:
    process.env.SESSION_SECRET ||
    "CHANGE_THIS_TO_A_LONG_RANDOM_SECRET",

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

/* =====================================================
   HELPERS
===================================================== */

function auth(req, res, next) {
  if (!req.session.adminId) {
    return res.status(401).json({
      error: "Unauthorized"
    });
  }

  next();
}

function now() {
  return new Date().toISOString();
}

function lobbyDisplay(lobby) {
  return `${lobby.name} · ${lobby.time} · ₹${lobby.fee}`;
}

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

/* =====================================================
   ADMIN SETUP
===================================================== */

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
        error:
          "Name, email and a password of at least 6 characters are required"
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

    req.session.save(err => {
      if (err) {
        return res.status(500).json({
          error: "Admin created, but session could not be saved"
        });
      }

      res.json({
        ok: true,
        name: cleanName
      });
    });

  } catch (err) {
    console.error("SETUP ADMIN ERROR:", err);

    res.status(500).json({
      error: "Could not create admin"
    });
  }
});

/* =====================================================
   ADMIN LOGIN
===================================================== */

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const admin = db
      .prepare(
        "SELECT * FROM admins WHERE email=?"
      )
      .get(
        (email || "").trim().toLowerCase()
      );

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

    req.session.save(err => {
      if (err) {
        return res.status(500).json({
          error:
            "Login succeeded but session could not be saved"
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

/* =====================================================
   LOGOUT
===================================================== */

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

/* =====================================================
   CURRENT ADMIN
===================================================== */

app.get("/api/me", (req, res) => {
  res.json({
    loggedIn: !!req.session.adminId,
    name: req.session.adminName || null
  });
});

/* =====================================================
   ADMIN EXISTS
===================================================== */

app.get("/api/admin-exists", (req, res) => {
  res.json({
    exists: !!db
      .prepare("SELECT id FROM admins LIMIT 1")
      .get()
  });
});

/* =====================================================
   CREATE LOBBY
===================================================== */

app.post("/api/lobbies", auth, (req, res) => {
  try {
    const {
      name,
      time,
      fee,
      maxTeams
    } = req.body;

    const cleanName = String(name || "").trim();
    const cleanTime = String(time || "").trim();
    const cleanFee = String(fee || "").trim();
    const max = Number(maxTeams);

    if (
      !cleanName ||
      !cleanTime ||
      !cleanFee ||
      !Number.isInteger(max) ||
      max < 1 ||
      max > 100
    ) {
      return res.status(400).json({
        error:
          "Lobby name, time, entry fee and valid maximum teams are required"
      });
    }

    const result = db.prepare(`
      INSERT INTO lobbies(
        name,
        time,
        fee,
        max_teams,
        status,
        created_at
      )
      VALUES(?,?,?,?, 'open', ?)
    `).run(
      cleanName,
      cleanTime,
      cleanFee,
      max,
      now()
    );

    const lobby = db
      .prepare(
        "SELECT * FROM lobbies WHERE id=?"
      )
      .get(result.lastInsertRowid);

    res.json({
      ok: true,
      lobby
    });

  } catch (err) {
    console.error("CREATE LOBBY ERROR:", err);

    res.status(500).json({
      error: "Could not create lobby"
    });
  }
});

/* =====================================================
   GET LOBBIES
===================================================== */

app.get("/api/lobbies", (req, res) => {
  try {
    const lobbies = db.prepare(`
      SELECT
        l.*,
        (
          SELECT COUNT(*)
          FROM registrations r
          WHERE r.lobby_id = l.id
            AND r.status = 'confirmed'
        ) AS confirmed
      FROM lobbies l
      ORDER BY l.id DESC
    `).all();

    res.json(lobbies);

  } catch (err) {
    console.error("GET LOBBIES ERROR:", err);

    res.status(500).json({
      error: "Could not load lobbies"
    });
  }
});

/* =====================================================
   CLOSE LOBBY
===================================================== */

app.patch("/api/lobbies/:id/status", auth, (req, res) => {
  try {
    const status = req.body.status;

    if (!["open", "closed"].includes(status)) {
      return res.status(400).json({
        error: "Invalid lobby status"
      });
    }

    const result = db.prepare(`
      UPDATE lobbies
      SET status=?
      WHERE id=?
    `).run(
      status,
      req.params.id
    );

    if (!result.changes) {
      return res.status(404).json({
        error: "Lobby not found"
      });
    }

    res.json({
      ok: true
    });

  } catch (err) {
    console.error("LOBBY STATUS ERROR:", err);

    res.status(500).json({
      error: "Could not update lobby"
    });
  }
});

/* =====================================================
   REGISTRATION
===================================================== */

app.post("/api/registrations", (req, res) => {
  try {
    const {
      lobbyId,
      time,
      fee,
      team,
      captain,
      phone,
      uid
    } = req.body;

    const cleanTeam = String(team || "").trim();
    const cleanCaptain = String(captain || "").trim();
    const cleanPhone = String(phone || "").trim();
    const cleanUid = String(uid || "").trim();

    if (
      !lobbyId ||
      !cleanTeam ||
      !cleanCaptain ||
      !cleanPhone ||
      !cleanUid
    ) {
      return res.status(400).json({
        error: "All fields are required"
      });
    }

    const lobby = db
      .prepare(
        "SELECT * FROM lobbies WHERE id=?"
      )
      .get(Number(lobbyId));

    if (!lobby) {
      return res.status(404).json({
        error: "Lobby not found"
      });
    }

    if (lobby.status !== "open") {
      return res.status(400).json({
        error: "This lobby is closed"
      });
    }

    const confirmed = db
      .prepare(`
        SELECT COUNT(*) c
        FROM registrations
        WHERE lobby_id=?
          AND status='confirmed'
      `)
      .get(lobby.id).c;

    const pending = db
      .prepare(`
        SELECT COUNT(*) c
        FROM registrations
        WHERE lobby_id=?
          AND status='pending'
      `)
      .get(lobby.id).c;

    if (confirmed >= lobby.max_teams) {
      return res.status(400).json({
        error: "This lobby is full"
      });
    }

    if (confirmed + pending >= lobby.max_teams) {
      return res.status(400).json({
        error:
          "This lobby has reached its registration capacity"
      });
    }

    const duplicate = db.prepare(`
      SELECT id
      FROM registrations
      WHERE lobby_id=?
        AND uid=?
        AND status!='rejected'
      LIMIT 1
    `).get(
      lobby.id,
      cleanUid
    );

    if (duplicate) {
      return res.status(400).json({
        error:
          "This UID already has a registration in this lobby"
      });
    }

    const ref =
      `SF-${lobby.id}-${Date.now()}-${Math.floor(
        1000 + Math.random() * 9000
      )}`;

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
        created_at,
        lobby_id
      )
      VALUES(?,?,?,?,?,?,?,'pending',?,?)
    `).run(
      ref,
      lobby.time,
      lobby.fee,
      cleanTeam,
      cleanCaptain,
      cleanPhone,
      cleanUid,
      now(),
      lobby.id
    );

    res.json({
      ok: true,
      ref,
      lobby: {
        id: lobby.id,
        name: lobby.name,
        time: lobby.time,
        fee: lobby.fee
      },
      status: "pending"
    });

  } catch (err) {
    console.error("REGISTRATION ERROR:", err);

    res.status(500).json({
      error: "Could not save registration"
    });
  }
});

/* =====================================================
   USER REGISTRATION STATUS
===================================================== */

app.get("/api/registration-status/:ref", (req, res) => {
  try {
    const r = db.prepare(`
      SELECT
        r.ref,
        r.team,
        r.captain,
        r.status,
        r.created_at,
        r.lobby_id,
        l.name AS lobby_name,
        l.time AS lobby_time,
        l.fee AS lobby_fee,
        l.status AS lobby_status
      FROM registrations r
      LEFT JOIN lobbies l
        ON l.id = r.lobby_id
      WHERE r.ref=?
    `).get(req.params.ref);

    if (!r) {
      return res.status(404).json({
        error: "Registration not found"
      });
    }

    res.json({
      ref: r.ref,
      team: r.team,
      captain: r.captain,
      status: r.status,
      createdAt: r.created_at,
      lobbyId: r.lobby_id,
      lobbyName: r.lobby_name,
      lobbyTime: r.lobby_time,
      lobbyFee: r.lobby_fee,
      lobbyStatus: r.lobby_status
    });

  } catch (err) {
    console.error("REGISTRATION STATUS ERROR:", err);

    res.status(500).json({
      error: "Could not load registration"
    });
  }
});

/* =====================================================
   ADMIN REGISTRATIONS
===================================================== */

app.get("/api/registrations", auth, (req, res) => {
  res.json(
    db.prepare(`
      SELECT
        r.*,
        l.name AS lobby_name,
        l.max_teams,
        l.status AS lobby_status
      FROM registrations r
      LEFT JOIN lobbies l
        ON l.id = r.lobby_id
      ORDER BY r.id DESC
    `).all()
  );
});

/* =====================================================
   UPDATE REGISTRATION
===================================================== */

app.patch("/api/registrations/:id", auth, (req, res) => {
  try {
    const status = req.body.status;

    if (
      !["pending", "confirmed", "rejected"]
        .includes(status)
    ) {
      return res.status(400).json({
        error: "Invalid status"
      });
    }

    const registration = db.prepare(`
      SELECT *
      FROM registrations
      WHERE id=?
    `).get(req.params.id);

    if (!registration) {
      return res.status(404).json({
        error: "Registration not found"
      });
    }

    if (
      status === "confirmed" &&
      registration.lobby_id
    ) {
      const lobby = db.prepare(`
        SELECT *
        FROM lobbies
        WHERE id=?
      `).get(registration.lobby_id);

      if (!lobby) {
        return res.status(400).json({
          error: "The lobby connected to this registration no longer exists"
        });
      }

      if (lobby.status !== "open") {
        return res.status(400).json({
          error: "Cannot confirm a registration for a closed lobby"
        });
      }

      const confirmed = db.prepare(`
        SELECT COUNT(*) c
        FROM registrations
        WHERE lobby_id=?
          AND status='confirmed'
          AND id!=?
      `).get(
        lobby.id,
        registration.id
      ).c;

      if (confirmed >= lobby.max_teams) {
        return res.status(400).json({
          error: "Lobby capacity has already been reached"
        });
      }
    }

    db.prepare(`
      UPDATE registrations
      SET status=?
      WHERE id=?
    `).run(
      status,
      req.params.id
    );

    res.json({
      ok: true,
      status
    });

  } catch (err) {
    console.error("UPDATE REGISTRATION ERROR:", err);

    res.status(500).json({
      error: "Could not update registration"
    });
  }
});

/* =====================================================
   PUBLIC LOBBY COUNTS - LEGACY COMPATIBILITY
===================================================== */

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

/* =====================================================
   ADMIN STATS
===================================================== */

app.get("/api/stats", auth, (req, res) => {
  const pending = db
    .prepare(`
      SELECT COUNT(*) c
      FROM registrations
      WHERE status='pending'
    `)
    .get().c;

  const confirmed = db
    .prepare(`
      SELECT COUNT(*) c
      FROM registrations
      WHERE status='confirmed'
    `)
    .get().c;

  const activeLobbies = db
    .prepare(`
      SELECT COUNT(*) c
      FROM lobbies
      WHERE status='open'
    `)
    .get().c;

  res.json({
    pending,
    confirmed,
    activeLobbies
  });
});

/* =====================================================
   LEADERBOARD TEAMS
===================================================== */

app.get("/api/leaderboard/teams", auth, (req, res) => {
  try {
    const lobby = String(req.query.lobby || "").trim();

    if (!lobby) {
      return res.status(400).json({
        error: "Lobby is required"
      });
    }

    const lobbyId = Number(lobby);

    if (!Number.isInteger(lobbyId)) {
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
      WHERE lobby_id=?
        AND status='confirmed'
      ORDER BY id ASC
      LIMIT 12
    `).all(lobbyId);

    res.json(teams);

  } catch (err) {
    console.error("LEADERBOARD TEAMS ERROR:", err);

    res.status(500).json({
      error: "Could not load teams"
    });
  }
});

/* =====================================================
   SAVE ONE MATCH
===================================================== */

app.post("/api/leaderboard/match", auth, (req, res) => {
  try {
    const {
      lobby,
      matchNo,
      entries
    } = req.body;

    const match = Number(matchNo);
    const lobbyId = Number(lobby);

    if (
      !Number.isInteger(lobbyId) ||
      !Number.isInteger(match) ||
      match < 1 ||
      match > 6
    ) {
      return res.status(400).json({
        error:
          "Valid lobby and match number 1-6 are required"
      });
    }

    const lobbyRow = db.prepare(`
      SELECT *
      FROM lobbies
      WHERE id=?
    `).get(lobbyId);

    if (!lobbyRow) {
      return res.status(404).json({
        error: "Lobby not found"
      });
    }

    if (
      !Array.isArray(entries) ||
      entries.length !== 12
    ) {
      return res.status(400).json({
        error:
          "Exactly 12 team entries are required"
      });
    }

    const positions =
      entries.map(e => Number(e.position));

    const uniquePositions =
      new Set(positions);

    if (
      positions.some(
        p =>
          !Number.isInteger(p) ||
          p < 1 ||
          p > 12
      ) ||
      uniquePositions.size !== 12
    ) {
      return res.status(400).json({
        error:
          "Positions must contain every number from 1 to 12 exactly once"
      });
    }

    const teams =
      entries.map(
        e => String(e.team || "").trim()
      );

    if (teams.some(t => !t)) {
      return res.status(400).json({
        error:
          "Every team must have a name"
      });
    }

    const uniqueTeams =
      new Set(teams);

    if (uniqueTeams.size !== 12) {
      return res.status(400).json({
        error:
          "Each team must be unique"
      });
    }

    const confirmedTeams =
      db.prepare(`
        SELECT team
        FROM registrations
        WHERE lobby_id=?
          AND status='confirmed'
        ORDER BY id ASC
        LIMIT 12
      `).all(lobbyId)
        .map(x => x.team);

    const confirmedSet =
      new Set(confirmedTeams);

    if (
      confirmedTeams.length !== 12 ||
      teams.some(t => !confirmedSet.has(t))
    ) {
      return res.status(400).json({
        error:
          "Score entries must match the 12 confirmed teams in this lobby"
      });
    }

    const save =
      db.transaction(() => {

        db.prepare(`
          DELETE FROM match_results
          WHERE lobby=? AND match_no=?
        `).run(
          String(lobbyId),
          match
        );

        const insert =
          db.prepare(`
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

          const position =
            Number(entry.position);

          const kills =
            Math.max(
              0,
              Number(entry.kills) || 0
            );

          const placementPoints =
            PLACEMENT_POINTS[position] || 0;

          const booyahs =
            position === 1 ? 1 : 0;

          const killPoints =
            kills;

          const totalPoints =
            placementPoints +
            killPoints;

          insert.run(
            String(lobbyId),
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
      message:
        `Match ${match} saved successfully`
    });

  } catch (err) {
    console.error("SAVE MATCH ERROR:", err);

    res.status(500).json({
      error: "Could not save match"
    });
  }
});

/* =====================================================
   OVERALL LEADERBOARD
===================================================== */

app.get("/api/leaderboard", (req, res) => {
  try {
    const lobby =
      String(req.query.lobby || "").trim();

    if (!lobby) {
      return res.status(400).json({
        error: "Lobby is required"
      });
    }

    const rows =
      db.prepare(`
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
        ORDER BY
          total_points DESC,
          kill_points DESC,
          booyahs DESC,
          team ASC
      `).all(lobby);

    res.json(
      rows.map((r, index) => ({
        position: index + 1,
        team: r.team,
        booyahs:
          Number(r.booyahs || 0),
        placementPoints:
          Number(r.placement_points || 0),
        killPoints:
          Number(r.kill_points || 0),
        totalPoints:
          Number(r.total_points || 0),
        matchesPlayed:
          Number(r.matches_played || 0)
      }))
    );

  } catch (err) {
    console.error("LEADERBOARD ERROR:", err);

    res.status(500).json({
      error: "Could not load leaderboard"
    });
  }
});

/* =====================================================
   INDIVIDUAL MATCH
===================================================== */

app.get("/api/leaderboard/match", (req, res) => {
  try {
    const lobby =
      String(req.query.lobby || "").trim();

    const match =
      Number(req.query.match);

    if (
      !lobby ||
      !Number.isInteger(match) ||
      match < 1 ||
      match > 6
    ) {
      return res.status(400).json({
        error:
          "Valid lobby and match number are required"
      });
    }

    const rows =
      db.prepare(`
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
      `).all(
        lobby,
        match
      );

    res.json(rows);

  } catch (err) {
    console.error("MATCH LOAD ERROR:", err);

    res.status(500).json({
      error: "Could not load match"
    });
  }
});

/* =====================================================
   PUBLIC LEADERBOARD
===================================================== */

app.get("/api/public-leaderboard", (req, res) => {
  try {
    const lobby =
      String(req.query.lobby || "").trim();

    if (!lobby) {
      return res.status(400).json({
        error: "Lobby is required"
      });
    }

    const rows =
      db.prepare(`
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
        ORDER BY
          total_points DESC,
          kill_points DESC,
          booyahs DESC,
          team ASC
      `).all(lobby);

    res.json(
      rows.map((r, index) => ({
        position: index + 1,
        team: r.team,
        booyahs:
          Number(r.booyahs || 0),
        placementPoints:
          Number(r.placement_points || 0),
        killPoints:
          Number(r.kill_points || 0),
        totalPoints:
          Number(r.total_points || 0),
        matchesPlayed:
          Number(r.matches_played || 0)
      }))
    );

  } catch (err) {
    console.error(
      "PUBLIC LEADERBOARD ERROR:",
      err
    );

    res.status(500).json({
      error:
        "Could not load public leaderboard"
    });
  }
});

/* =====================================================
   OLD RESULTS - PRESERVED
===================================================== */

app.get("/api/results", (req, res) => {
  res.json(
    db
      .prepare(
        "SELECT * FROM results ORDER BY id DESC"
      )
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
      error:
        "All result fields are required"
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

/* =====================================================
   FRONTEND
===================================================== */

app.get("*", (req, res) => {
  res.sendFile(
    path.join(
      __dirname,
      "public",
      "index.html"
    )
  );
});

/* =====================================================
   START
===================================================== */

app.listen(PORT, () => {
  console.log(
    `ScrimForge V3 running on http://localhost:${PORT}`
  );
});
