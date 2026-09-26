"use strict";

const path = require("path");
const fs = require("fs");

const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");

const app = express();

/* =========================================================
   CONFIG
========================================================= */

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

if (!fs.existsSync(PUBLIC_DIR)) {
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
}

/*
  IMPORTANT FOR DEPLOYMENTS USING HTTPS / REVERSE PROXY
*/
app.set("trust proxy", 1);

/* =========================================================
   DATABASE
========================================================= */

const dbPath = path.join(DATA_DIR, "scrimforge.db");
const db = new Database(dbPath);

db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS lobbies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  time TEXT NOT NULL,
  fee TEXT NOT NULL,
  max_teams INTEGER NOT NULL DEFAULT 12,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,
  lobby_id INTEGER,
  team TEXT NOT NULL,
  captain TEXT NOT NULL,
  phone TEXT NOT NULL,
  uid TEXT NOT NULL,
  time TEXT NOT NULL,
  fee TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (lobby_id)
    REFERENCES lobbies(id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS match_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lobby_id INTEGER NOT NULL,
  match_no INTEGER NOT NULL,
  team TEXT NOT NULL,
  position INTEGER NOT NULL,
  kills INTEGER NOT NULL DEFAULT 0,
  booyah INTEGER NOT NULL DEFAULT 0,
  placement_points INTEGER NOT NULL DEFAULT 0,
  kill_points INTEGER NOT NULL DEFAULT 0,
  total_points INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (lobby_id)
    REFERENCES lobbies(id)
    ON DELETE CASCADE,
  UNIQUE(lobby_id, match_no, team)
);
`);

/* =========================================================
   MIDDLEWARE
========================================================= */

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

/* =========================================================
   SESSION
========================================================= */

app.use(
  session({
    store: new SQLiteStore({
      db: "sessions.db",
      dir: DATA_DIR
    }),

    secret:
      process.env.SESSION_SECRET ||
      "scrimforge-v4-change-this-secret",

    resave: false,

    saveUninitialized: false,

    rolling: true,

    cookie: {
      httpOnly: true,
      sameSite: "lax",

      /*
        auto = HTTP locally, HTTPS when deployed.
        This is safer for Render/Railway/etc.
      */
      secure: "auto",

      maxAge: 7 * 24 * 60 * 60 * 1000
    }
  })
);

/* =========================================================
   STATIC FILES
========================================================= */

app.use(express.static(PUBLIC_DIR));

/* =========================================================
   HELPERS
========================================================= */

function clean(value) {
  return String(value ?? "").trim();
}

function email(value) {
  return clean(value).toLowerCase();
}

function adminFromSession(req) {
  if (!req.session || !req.session.adminId) {
    return null;
  }

  return (
    db
      .prepare(`
        SELECT id, name, email
        FROM admins
        WHERE id = ?
        LIMIT 1
      `)
      .get(req.session.adminId) || null
  );
}

function requireAdmin(req, res, next) {
  const admin = adminFromSession(req);

  if (!admin) {
    return res.status(401).json({
      error: "Admin login required."
    });
  }

  req.admin = admin;
  next();
}

function reference() {
  return (
    "SF-" +
    Date.now().toString(36).toUpperCase() +
    "-" +
    Math.random()
      .toString(36)
      .substring(2, 8)
      .toUpperCase()
  );
}

function placementPoints(position) {
  const points = {
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

  return points[Number(position)] ?? 0;
}

/* =========================================================
   HEALTH
========================================================= */

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    name: "ScrimForge V4",
    time: new Date().toISOString()
  });
});

/* =========================================================
   ADMIN EXISTS
========================================================= */

app.get("/api/admin-exists", (req, res) => {
  const row = db
    .prepare("SELECT COUNT(*) AS count FROM admins")
    .get();

  res.json({
    exists: Number(row.count) > 0
  });
});

/* =========================================================
   CURRENT ADMIN
========================================================= */

app.get("/api/me", (req, res) => {
  const admin = adminFromSession(req);

  if (!admin) {
    return res.json({
      loggedIn: false
    });
  }

  res.json({
    loggedIn: true,
    id: admin.id,
    name: admin.name,
    email: admin.email
  });
});

/* =========================================================
   CREATE FIRST ADMIN
========================================================= */

app.post("/api/setup-admin", async (req, res) => {
  try {
    const existing = db
      .prepare("SELECT id FROM admins LIMIT 1")
      .get();

    if (existing) {
      return res.status(400).json({
        error: "Admin account already exists."
      });
    }

    const name = clean(req.body.name);
    const userEmail = email(req.body.email);
    const password = String(req.body.password || "");

    if (!name || !userEmail || !password) {
      return res.status(400).json({
        error: "Name, email and password are required."
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        error: "Password must contain at least 6 characters."
      });
    }

    const hash = await bcrypt.hash(password, 12);

    const result = db
      .prepare(`
        INSERT INTO admins
        (name, email, password_hash)
        VALUES (?, ?, ?)
      `)
      .run(name, userEmail, hash);

    req.session.regenerate(err => {
      if (err) {
        console.error("Session regenerate:", err);
        return res.status(500).json({
          error: "Admin created but session failed."
        });
      }

      req.session.adminId = Number(result.lastInsertRowid);

      req.session.save(saveErr => {
        if (saveErr) {
          console.error("Session save:", saveErr);

          return res.status(500).json({
            error: "Admin created but session could not be saved."
          });
        }

        res.json({
          success: true,
          name,
          email: userEmail
        });
      });
    });
  } catch (err) {
    console.error("SETUP ADMIN ERROR:", err);

    res.status(500).json({
      error: "Unable to create admin account."
    });
  }
});

/* =========================================================
   LOGIN
========================================================= */

app.post("/api/login", async (req, res) => {
  try {
    const userEmail = email(req.body.email);
    const password = String(req.body.password || "");

    if (!userEmail || !password) {
      return res.status(400).json({
        error: "Email and password are required."
      });
    }

    const admin = db
      .prepare(`
        SELECT id, name, email, password_hash
        FROM admins
        WHERE email = ?
        LIMIT 1
      `)
      .get(userEmail);

    if (!admin) {
      return res.status(401).json({
        error: "Invalid email or password."
      });
    }

    const valid = await bcrypt.compare(
      password,
      admin.password_hash
    );

    if (!valid) {
      return res.status(401).json({
        error: "Invalid email or password."
      });
    }

    /*
      Destroy old session and create a completely new one.
    */

    req.session.regenerate(err => {
      if (err) {
        console.error("LOGIN SESSION ERROR:", err);

        return res.status(500).json({
          error: "Unable to create login session."
        });
      }

      req.session.adminId = Number(admin.id);

      req.session.save(saveErr => {
        if (saveErr) {
          console.error("LOGIN SESSION SAVE ERROR:", saveErr);

          return res.status(500).json({
            error: "Unable to save login session."
          });
        }

        return res.json({
          success: true,
          name: admin.name,
          email: admin.email
        });
      });
    });
  } catch (err) {
    console.error("LOGIN ERROR:", err);

    res.status(500).json({
      error: "Login failed. Please try again."
    });
  }
});

/* =========================================================
   LOGOUT
========================================================= */

app.post("/api/logout", (req, res) => {
  if (!req.session) {
    return res.json({ success: true });
  }

  req.session.destroy(err => {
    if (err) {
      console.error("LOGOUT ERROR:", err);

      return res.status(500).json({
        error: "Unable to logout."
      });
    }

    res.clearCookie("connect.sid");

    res.json({
      success: true
    });
  });
});

/* =========================================================
   PUBLIC LOBBIES
========================================================= */

app.get("/api/public/lobbies", (req, res) => {
  try {
    const rows = db
      .prepare(`
        SELECT
          l.id,
          l.name,
          l.time,
          l.fee,
          l.max_teams,
          l.status,
          COUNT(
            CASE
              WHEN r.status = 'confirmed'
              THEN 1
            END
          ) AS confirmed
        FROM lobbies l
        LEFT JOIN registrations r
          ON r.lobby_id = l.id
        GROUP BY l.id
        ORDER BY l.id DESC
      `)
      .all();

    res.json(rows);
  } catch (err) {
    console.error("PUBLIC LOBBIES ERROR:", err);

    res.status(500).json({
      error: "Unable to load lobbies."
    });
  }
});

/* =========================================================
   ADMIN LOBBIES
========================================================= */

app.get("/api/lobbies", requireAdmin, (req, res) => {
  try {
    const rows = db
      .prepare(`
        SELECT
          l.id,
          l.name,
          l.time,
          l.fee,
          l.max_teams,
          l.status,
          COUNT(
            CASE
              WHEN r.status = 'confirmed'
              THEN 1
            END
          ) AS confirmed
        FROM lobbies l
        LEFT JOIN registrations r
          ON r.lobby_id = l.id
        GROUP BY l.id
        ORDER BY l.id DESC
      `)
      .all();

    res.json(rows);
  } catch (err) {
    console.error("ADMIN LOBBIES ERROR:", err);

    res.status(500).json({
      error: "Unable to load lobbies."
    });
  }
});

/* =========================================================
   CREATE SCRIM
========================================================= */

app.post("/api/lobbies", requireAdmin, (req, res) => {
  try {
    const name = clean(req.body.name);
    const time = clean(req.body.time);
    const fee = clean(req.body.fee);

    const maxTeams =
      req.body.maxTeams === undefined ||
      req.body.maxTeams === ""
        ? 12
        : Number(req.body.maxTeams);

    if (!name || !time || !fee) {
      return res.status(400).json({
        error: "Scrim name, time and entry fee are required."
      });
    }

    if (
      !Number.isInteger(maxTeams) ||
      maxTeams < 1 ||
      maxTeams > 100
    ) {
      return res.status(400).json({
        error: "Maximum teams must be between 1 and 100."
      });
    }

    const result = db
      .prepare(`
        INSERT INTO lobbies
        (name, time, fee, max_teams, status)
        VALUES (?, ?, ?, ?, 'open')
      `)
      .run(
        name,
        time,
        fee,
        maxTeams
      );

    res.json({
      success: true,
      id: Number(result.lastInsertRowid)
    });
  } catch (err) {
    console.error("CREATE SCRIM ERROR:", err);

    res.status(500).json({
      error: "Unable to create scrim."
    });
  }
});

/* =========================================================
   UPDATE SCRIM
========================================================= */

app.patch("/api/lobbies/:id", requireAdmin, (req, res) => {
  try {
    const id = Number(req.params.id);
    const status = clean(req.body.status).toLowerCase();

    if (
      !Number.isInteger(id) ||
      !["open", "closed"].includes(status)
    ) {
      return res.status(400).json({
        error: "Invalid lobby update."
      });
    }

    const result = db
      .prepare(`
        UPDATE lobbies
        SET status = ?
        WHERE id = ?
      `)
      .run(status, id);

    if (!result.changes) {
      return res.status(404).json({
        error: "Lobby not found."
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("UPDATE SCRIM ERROR:", err);

    res.status(500).json({
      error: "Unable to update scrim."
    });
  }
});

/* =========================================================
   DELETE SCRIM
========================================================= */

app.delete("/api/lobbies/:id", requireAdmin, (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id)) {
      return res.status(400).json({
        error: "Invalid lobby ID."
      });
    }

    const result = db
      .prepare(`
        DELETE FROM lobbies
        WHERE id = ?
      `)
      .run(id);

    if (!result.changes) {
      return res.status(404).json({
        error: "Lobby not found."
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("DELETE SCRIM ERROR:", err);

    res.status(500).json({
      error: "Unable to delete scrim."
    });
  }
});

/* =========================================================
   REGISTRATION
========================================================= */

app.post("/api/registrations", (req, res) => {
  try {
    const lobbyId = Number(req.body.lobbyId);

    const team = clean(req.body.team);
    const captain = clean(req.body.captain);
    const phone = clean(req.body.phone);
    const uid = clean(req.body.uid);

    if (
      !Number.isInteger(lobbyId) ||
      !team ||
      !captain ||
      !phone ||
      !uid
    ) {
      return res.status(400).json({
        error: "Please complete all registration fields."
      });
    }

    const lobby = db
      .prepare(`
        SELECT *
        FROM lobbies
        WHERE id = ?
      `)
      .get(lobbyId);

    if (!lobby) {
      return res.status(404).json({
        error: "Selected lobby not found."
      });
    }

    if (lobby.status !== "open") {
      return res.status(400).json({
        error: "This lobby is currently closed."
      });
    }

    const confirmed = db
      .prepare(`
        SELECT COUNT(*) AS count
        FROM registrations
        WHERE lobby_id = ?
        AND status = 'confirmed'
      `)
      .get(lobbyId);

    if (Number(confirmed.count) >= Number(lobby.max_teams)) {
      return res.status(400).json({
        error: "This lobby is full."
      });
    }

    let ref = reference();

    while (
      db
        .prepare(`
          SELECT id
          FROM registrations
          WHERE ref = ?
        `)
        .get(ref)
    ) {
      ref = reference();
    }

    const result = db
      .prepare(`
        INSERT INTO registrations
        (
          ref,
          lobby_id,
          team,
          captain,
          phone,
          uid,
          time,
          fee,
          status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
      `)
      .run(
        ref,
        lobby.id,
        team,
        captain,
        phone,
        uid,
        lobby.time,
        lobby.fee
      );

    res.json({
      success: true,
      id: Number(result.lastInsertRowid),
      ref
    });
  } catch (err) {
    console.error("REGISTRATION ERROR:", err);

    res.status(500).json({
      error: "Unable to submit registration."
    });
  }
});

/* =========================================================
   REGISTRATION STATUS
========================================================= */

app.get(
  "/api/registration-status/:ref",
  (req, res) => {
    try {
      const ref = clean(req.params.ref);

      const row = db
        .prepare(`
          SELECT
            r.id,
            r.ref,
            r.team,
            r.captain,
            r.phone,
            r.uid,
            r.time,
            r.fee,
            r.status,
            r.lobby_id,
            l.name AS lobby_name
          FROM registrations r
          LEFT JOIN lobbies l
            ON l.id = r.lobby_id
          WHERE r.ref = ?
          LIMIT 1
        `)
        .get(ref);

      if (!row) {
        return res.status(404).json({
          error: "Registration reference not found."
        });
      }

      res.json(row);
    } catch (err) {
      console.error("REGISTRATION STATUS ERROR:", err);

      res.status(500).json({
        error: "Unable to check registration."
      });
    }
  }
);

/* =========================================================
   ADMIN REGISTRATIONS
========================================================= */

app.get(
  "/api/registrations",
  requireAdmin,
  (req, res) => {
    try {
      const rows = db
        .prepare(`
          SELECT
            id,
            ref,
            lobby_id,
            team,
            captain,
            phone,
            uid,
            time,
            fee,
            status,
            created_at
          FROM registrations
          ORDER BY id DESC
        `)
        .all();

      res.json(rows);
    } catch (err) {
      console.error("REGISTRATIONS ERROR:", err);

      res.status(500).json({
        error: "Unable to load registrations."
      });
    }
  }
);

/* =========================================================
   UPDATE REGISTRATION
========================================================= */

app.patch(
  "/api/registrations/:id",
  requireAdmin,
  (req, res) => {
    try {
      const id = Number(req.params.id);
      const status = clean(req.body.status).toLowerCase();

      if (!Number.isInteger(id)) {
        return res.status(400).json({
          error: "Invalid registration ID."
        });
      }

      if (
        ![
          "pending",
          "confirmed",
          "rejected"
        ].includes(status)
      ) {
        return res.status(400).json({
          error: "Invalid registration status."
        });
      }

      const registration = db
        .prepare(`
          SELECT id, lobby_id
          FROM registrations
          WHERE id = ?
        `)
        .get(id);

      if (!registration) {
        return res.status(404).json({
          error: "Registration not found."
        });
      }

      if (
        status === "confirmed" &&
        registration.lobby_id
      ) {
        const lobby = db
          .prepare(`
            SELECT id, max_teams
            FROM lobbies
            WHERE id = ?
          `)
          .get(registration.lobby_id);

        if (lobby) {
          const count = db
            .prepare(`
              SELECT COUNT(*) AS count
              FROM registrations
              WHERE lobby_id = ?
              AND status = 'confirmed'
              AND id != ?
            `)
            .get(
              lobby.id,
              id
            );

          if (
            Number(count.count) >=
            Number(lobby.max_teams)
          ) {
            return res.status(400).json({
              error: "This lobby is already full."
            });
          }
        }
      }

      db.prepare(`
        UPDATE registrations
        SET status = ?
        WHERE id = ?
      `).run(status, id);

      res.json({
        success: true
      });
    } catch (err) {
      console.error("UPDATE REGISTRATION ERROR:", err);

      res.status(500).json({
        error: "Unable to update registration."
      });
    }
  }
);

/* =========================================================
   ASSIGN LOBBY
========================================================= */

app.patch(
  "/api/registrations/:id/lobby",
  requireAdmin,
  (req, res) => {
    try {
      const registrationId = Number(req.params.id);
      const lobbyId = Number(req.body.lobbyId);

      if (
        !Number.isInteger(registrationId) ||
        !Number.isInteger(lobbyId)
      ) {
        return res.status(400).json({
          error: "Invalid registration or lobby."
        });
      }

      const registration = db
        .prepare(`
          SELECT id, status
          FROM registrations
          WHERE id = ?
        `)
        .get(registrationId);

      if (!registration) {
        return res.status(404).json({
          error: "Registration not found."
        });
      }

      if (registration.status !== "confirmed") {
        return res.status(400).json({
          error:
            "Confirm the registration before assigning a lobby."
        });
      }

      const lobby = db
        .prepare(`
          SELECT id, time, fee, max_teams
          FROM lobbies
          WHERE id = ?
        `)
        .get(lobbyId);

      if (!lobby) {
        return res.status(404).json({
          error: "Lobby not found."
        });
      }

      const count = db
        .prepare(`
          SELECT COUNT(*) AS count
          FROM registrations
          WHERE lobby_id = ?
          AND status = 'confirmed'
          AND id != ?
        `)
        .get(
          lobbyId,
          registrationId
        );

      if (
        Number(count.count) >=
        Number(lobby.max_teams)
      ) {
        return res.status(400).json({
          error: "Selected lobby is full."
        });
      }

      db.prepare(`
        UPDATE registrations
        SET
          lobby_id = ?,
          time = ?,
          fee = ?
        WHERE id = ?
      `).run(
        lobby.id,
        lobby.time,
        lobby.fee,
        registrationId
      );

      res.json({
        success: true
      });
    } catch (err) {
      console.error("ASSIGN LOBBY ERROR:", err);

      res.status(500).json({
        error: "Unable to assign lobby."
      });
    }
  }
);

/* =========================================================
   ADMIN STATS
========================================================= */

app.get("/api/stats", requireAdmin, (req, res) => {
  try {
    const pending = db
      .prepare(`
        SELECT COUNT(*) AS count
        FROM registrations
        WHERE status = 'pending'
      `)
      .get();

    const confirmed = db
      .prepare(`
        SELECT COUNT(*) AS count
        FROM registrations
        WHERE status = 'confirmed'
      `)
      .get();

    const active = db
      .prepare(`
        SELECT COUNT(*) AS count
        FROM lobbies
        WHERE status = 'open'
      `)
      .get();

    res.json({
      pending: Number(pending.count),
      confirmed: Number(confirmed.count),
      activeLobbies: Number(active.count)
    });
  } catch (err) {
    console.error("STATS ERROR:", err);

    res.status(500).json({
      error: "Unable to load statistics."
    });
  }
});

/* =========================================================
   LEADERBOARD TEAMS
========================================================= */

app.get(
  "/api/leaderboard/teams",
  requireAdmin,
  (req, res) => {
    try {
      const lobbyName = clean(req.query.lobby);

      if (!lobbyName) {
        return res.status(400).json({
          error: "Lobby is required."
        });
      }

      const lobby = db
        .prepare(`
          SELECT id, name
          FROM lobbies
          WHERE name = ?
          LIMIT 1
        `)
        .get(lobbyName);

      if (!lobby) {
        return res.status(404).json({
          error: "Lobby not found."
        });
      }

      const teams = db
        .prepare(`
          SELECT id, team, captain
          FROM registrations
          WHERE lobby_id = ?
          AND status = 'confirmed'
          ORDER BY team COLLATE NOCASE ASC
        `)
        .all(lobby.id);

      res.json(teams);
    } catch (err) {
      console.error("LEADERBOARD TEAMS ERROR:", err);

      res.status(500).json({
        error: "Unable to load lobby teams."
      });
    }
  }
);

/* =========================================================
   MATCH RESULTS
========================================================= */

app.get(
  "/api/leaderboard/match",
  (req, res) => {
    try {
      const lobbyName = clean(req.query.lobby);
      const matchNo = Number(req.query.match);

      if (
        !lobbyName ||
        !Number.isInteger(matchNo) ||
        matchNo < 1 ||
        matchNo > 6
      ) {
        return res.status(400).json({
          error: "Invalid lobby or match."
        });
      }

      const lobby = db
        .prepare(`
          SELECT id
          FROM lobbies
          WHERE name = ?
          LIMIT 1
        `)
        .get(lobbyName);

      if (!lobby) {
        return res.status(404).json({
          error: "Lobby not found."
        });
      }

      const rows = db
        .prepare(`
          SELECT
            id,
            team,
            position,
            kills,
            booyah,
            placement_points,
            kill_points,
            total_points
          FROM match_scores
          WHERE lobby_id = ?
          AND match_no = ?
          ORDER BY position ASC
        `)
        .all(
          lobby.id,
          matchNo
        );

      res.json(rows);
    } catch (err) {
      console.error("MATCH RESULTS ERROR:", err);

      res.status(500).json({
        error: "Unable to load match results."
      });
    }
  }
);

/* =========================================================
   SAVE MATCH
========================================================= */

app.post(
  "/api/leaderboard/match",
  requireAdmin,
  (req, res) => {
    try {
      const lobbyName = clean(req.body.lobby);
      const matchNo = Number(req.body.matchNo);
      const entries = Array.isArray(req.body.entries)
        ? req.body.entries
        : [];

      if (!lobbyName) {
        return res.status(400).json({
          error: "Lobby is required."
        });
      }

      if (
        !Number.isInteger(matchNo) ||
        matchNo < 1 ||
        matchNo > 6
      ) {
        return res.status(400).json({
          error: "Match number must be between 1 and 6."
        });
      }

      if (entries.length !== 12) {
        return res.status(400).json({
          error: "Exactly 12 teams are required."
        });
      }

      const lobby = db
        .prepare(`
          SELECT id
          FROM lobbies
          WHERE name = ?
          LIMIT 1
        `)
        .get(lobbyName);

      if (!lobby) {
        return res.status(404).json({
          error: "Lobby not found."
        });
      }

      const teams = db
        .prepare(`
          SELECT team
          FROM registrations
          WHERE lobby_id = ?
          AND status = 'confirmed'
        `)
        .all(lobby.id);

      if (teams.length !== 12) {
        return res.status(400).json({
          error:
            `This lobby has ${teams.length}/12 confirmed teams. Exactly 12 teams are required.`
        });
      }

      const confirmed = new Set(
        teams.map(x => String(x.team))
      );

      const submitted = entries.map(
        x => clean(x.team)
      );

      if (new Set(submitted).size !== 12) {
        return res.status(400).json({
          error: "Each team must appear exactly once."
        });
      }

      for (const team of submitted) {
        if (!confirmed.has(team)) {
          return res.status(400).json({
            error:
              `Team "${team}" is not confirmed in this lobby.`
          });
        }
      }

      const positions = entries.map(
        x => Number(x.position)
      );

      if (
        positions.some(
          x =>
            !Number.isInteger(x) ||
            x < 1 ||
            x > 12
        ) ||
        new Set(positions).size !== 12
      ) {
        return res.status(400).json({
          error:
            "Positions must contain 1 to 12 exactly once."
        });
      }

      const normalized = entries.map(entry => {
        const position = Number(entry.position);

        const kills = Number(entry.kills);
        const safeKills =
          Number.isInteger(kills) && kills >= 0
            ? kills
            : 0;

        const placement =
          placementPoints(position);

        const booyah =
          position === 1 ? 1 : 0;

        return {
          team: clean(entry.team),
          position,
          kills: safeKills,
          booyah,
          placement,
          killPoints: safeKills,
          total: placement + safeKills
        };
      });

      const transaction = db.transaction(() => {
        db.prepare(`
          DELETE FROM match_scores
          WHERE lobby_id = ?
          AND match_no = ?
        `).run(
          lobby.id,
          matchNo
        );

        const insert = db.prepare(`
          INSERT INTO match_scores
          (
            lobby_id,
            match_no,
            team,
            position,
            kills,
            booyah,
            placement_points,
            kill_points,
            total_points
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const row of normalized) {
          insert.run(
            lobby.id,
            matchNo,
            row.team,
            row.position,
            row.kills,
            row.booyah,
            row.placement,
            row.killPoints,
            row.total
          );
        }
      });

      transaction();

      res.json({
        success: true,
        match: matchNo,
        count: normalized.length
      });
    } catch (err) {
      console.error("SAVE MATCH ERROR:", err);

      res.status(500).json({
        error: "Unable to save match results."
      });
    }
  }
);

/* =========================================================
   PUBLIC OVERALL LEADERBOARD
========================================================= */

app.get(
  "/api/public-leaderboard",
  (req, res) => {
    try {
      const lobbyName = clean(req.query.lobby);

      if (!lobbyName) {
        return res.status(400).json({
          error: "Lobby is required."
        });
      }

      const lobby = db
        .prepare(`
          SELECT id
          FROM lobbies
          WHERE name = ?
          LIMIT 1
        `)
        .get(lobbyName);

      if (!lobby) {
        return res.status(404).json({
          error: "Lobby not found."
        });
      }

      const rows = db
        .prepare(`
          SELECT
            team,
            SUM(booyah) AS booyahs,
            SUM(kills) AS killPoints,
            SUM(placement_points) AS placementPoints,
            SUM(total_points) AS totalPoints
          FROM match_scores
          WHERE lobby_id = ?
          GROUP BY team
          ORDER BY
            totalPoints DESC,
            killPoints DESC,
            booyahs DESC,
            team COLLATE NOCASE ASC
        `)
        .all(lobby.id);

      res.json(
        rows.map((row, index) => ({
          position: index + 1,
          team: row.team,
          booyahs: Number(row.booyahs || 0),
          killPoints: Number(row.killPoints || 0),
          placementPoints:
            Number(row.placementPoints || 0),
          totalPoints:
            Number(row.totalPoints || 0)
        }))
      );
    } catch (err) {
      console.error("PUBLIC LEADERBOARD ERROR:", err);

      res.status(500).json({
        error: "Unable to load leaderboard."
      });
    }
  }
);

/* =========================================================
   API 404
========================================================= */

app.use("/api", (req, res) => {
  res.status(404).json({
    error: "API endpoint not found."
  });
});

/* =========================================================
   SPA FALLBACK
   IMPORTANT:
   DO NOT USE app.get("*") HERE.
========================================================= */

app.use((req, res, next) => {
  if (req.method !== "GET") {
    return next();
  }

  const indexFile =
    path.join(PUBLIC_DIR, "index.html");

  if (!fs.existsSync(indexFile)) {
    return res.status(404).send(
      "ScrimForge V4: public/index.html not found."
    );
  }

  res.sendFile(indexFile);
});

/* =========================================================
   FINAL ERROR HANDLER
========================================================= */

app.use((err, req, res, next) => {
  console.error("UNHANDLED SERVER ERROR:", err);

  if (res.headersSent) {
    return next(err);
  }

  res.status(500).json({
    error: "Internal server error."
  });
});

/* =========================================================
   START
========================================================= */

const server = app.listen(PORT, () => {
  console.log("==========================================");
  console.log("        SCRIMFORGE V4 SERVER");
  console.log("==========================================");
  console.log(`Server running on port ${PORT}`);
  console.log(`Public directory: ${PUBLIC_DIR}`);
  console.log(`Database: ${dbPath}`);
  console.log("==========================================");
});

/* =========================================================
   SHUTDOWN
========================================================= */

function shutdown() {
  console.log("Shutting down ScrimForge...");

  try {
    db.close();
  } catch (err) {
    console.error("Database close error:", err);
  }

  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
