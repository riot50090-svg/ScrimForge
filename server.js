/* =========================================================
   SCRIMFORGE V4
   SERVER.JS
   ========================================================= */

"use strict";

const express = require("express");
const session = require("express-session");
const SQLiteStoreFactory = require("connect-sqlite3");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

/* =========================================================
   APP
========================================================= */

const app = express();

const PORT =
  Number(process.env.PORT) || 3000;

const ROOT =
  __dirname;

const PUBLIC_DIR =
  path.join(ROOT, "public");

const DATA_DIR =
  path.join(ROOT, "data");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, {
    recursive: true
  });
}

/* =========================================================
   DATABASE
========================================================= */

const dbPath =
  path.join(
    DATA_DIR,
    "scrimforge.sqlite"
  );

const db =
  new Database(dbPath);

db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");

/* =========================================================
   DATABASE TABLES
========================================================= */

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
    fee TEXT NOT NULL DEFAULT '',
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
    fee TEXT NOT NULL DEFAULT '',
    time TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY(lobby_id)
      REFERENCES lobbies(id)
      ON DELETE SET NULL
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

    UNIQUE(lobby_id, match_no, team),

    FOREIGN KEY(lobby_id)
      REFERENCES lobbies(id)
      ON DELETE CASCADE
  );
`);

/* =========================================================
   SESSION STORE
========================================================= */

const SQLiteStore =
  SQLiteStoreFactory(
    session
  );

const sessionStore =
  new SQLiteStore({
    db: "sessions.sqlite",
    dir: DATA_DIR
  });

/* =========================================================
   MIDDLEWARE
========================================================= */

app.disable("x-powered-by");

app.use(
  express.json({
    limit: "1mb"
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: "1mb"
  })
);

/*
  IMPORTANT:

  The website and API are served by the SAME
  Express server and SAME origin.

  This makes the admin session cookie available
  to /api/lobbies after /api/login.
*/

app.use(
  session({
    name: "scrimforge.sid",

    secret:
      process.env.SESSION_SECRET ||
      "scrimforge-v4-development-secret-change-this",

    store: sessionStore,

    resave: false,

    saveUninitialized: false,

    rolling: true,

    cookie: {
      httpOnly: true,

      sameSite: "lax",

      secure:
        process.env.NODE_ENV === "production",

      maxAge:
        1000 * 60 * 60 * 12
    }
  })
);

/* =========================================================
   STATIC WEBSITE
========================================================= */

app.use(
  express.static(
    PUBLIC_DIR
  )
);

/* =========================================================
   HELPERS
========================================================= */

function normalizeEmail(value) {
  return String(
    value || ""
  )
    .trim()
    .toLowerCase();
}


function cleanString(value) {
  return String(
    value ?? ""
  ).trim();
}


function generateReference() {

  return (
    "SF-" +
    Date.now()
      .toString(36)
      .toUpperCase() +
    "-" +
    crypto
      .randomBytes(3)
      .toString("hex")
      .toUpperCase()
  );
}


function adminExists() {

  const row =
    db.prepare(
      "SELECT id FROM admins LIMIT 1"
    ).get();

  return !!row;
}


function requireAdmin(
  req,
  res,
  next
) {

  if (
    req.session &&
    req.session.adminId
  ) {

    return next();

  }

  return res.status(401).json({
    error:
      "Admin login required."
  });
}


function getAdminFromRequest(req) {

  if (
    !req.session ||
    !req.session.adminId
  ) {
    return null;
  }

  return db.prepare(`
    SELECT
      id,
      name,
      email
    FROM admins
    WHERE id = ?
  `).get(
    req.session.adminId
  );
}


function calculatePlacement(position) {

  const table = {
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

  return (
    table[
      Number(position)
    ] || 0
  );
}


function lobbyByName(name) {

  return db.prepare(`
    SELECT *
    FROM lobbies
    WHERE name = ?
    LIMIT 1
  `).get(name);
}


function confirmedTeamsForLobby(
  lobbyId
) {

  return db.prepare(`
    SELECT
      id,
      team,
      captain,
      uid
    FROM registrations
    WHERE lobby_id = ?
      AND status = 'confirmed'
    ORDER BY id ASC
  `).all(lobbyId);
}


function publicLobbyRows() {

  return db.prepare(`
    SELECT
      l.id,
      l.name,
      l.time,
      l.fee,
      l.max_teams,
      l.status,
      l.created_at,

      (
        SELECT COUNT(*)
        FROM registrations r
        WHERE r.lobby_id = l.id
          AND r.status = 'confirmed'
      ) AS confirmed

    FROM lobbies l

    ORDER BY l.id DESC
  `).all();
}


/* =========================================================
   HEALTH
========================================================= */

app.get(
  "/api/health",
  (req, res) => {

    res.json({
      ok: true,
      version: "4.0.0"
    });

  }
);


/* =========================================================
   ADMIN EXISTS
========================================================= */

app.get(
  "/api/admin-exists",
  (req, res) => {

    res.json({
      exists:
        adminExists()
    });

  }
);


/* =========================================================
   CURRENT USER
========================================================= */

app.get(
  "/api/me",
  (req, res) => {

    const admin =
      getAdminFromRequest(req);

    if (!admin) {

      return res.json({
        loggedIn: false
      });

    }

    return res.json({
      loggedIn: true,
      id: admin.id,
      name: admin.name,
      email: admin.email
    });

  }
);


/* =========================================================
   SETUP ADMIN
========================================================= */

app.post(
  "/api/setup-admin",
  (req, res) => {

    try {

      if (adminExists()) {

        return res.status(409).json({
          error:
            "Admin account already exists."
        });

      }

      const name =
        cleanString(req.body.name);

      const email =
        normalizeEmail(
          req.body.email
        );

      const password =
        String(
          req.body.password || ""
        );

      if (!name) {

        return res.status(400).json({
          error:
            "Admin name is required."
        });

      }

      if (!email) {

        return res.status(400).json({
          error:
            "Admin email is required."
        });

      }

      if (password.length < 6) {

        return res.status(400).json({
          error:
            "Password must be at least 6 characters."
        });

      }

      const hash =
        bcrypt.hashSync(
          password,
          12
        );

      const result =
        db.prepare(`
          INSERT INTO admins
          (
            name,
            email,
            password_hash
          )
          VALUES
          (?, ?, ?)
        `).run(
          name,
          email,
          hash
        );

      /*
        Immediately create the authenticated
        session after setup.
      */

      req.session.adminId =
        Number(result.lastInsertRowid);

      req.session.adminName =
        name;

      req.session.save(
        error => {

          if (error) {

            console.error(
              "Session save error:",
              error
            );

            return res.status(500).json({
              error:
                "Admin created but session could not be saved."
            });

          }

          return res.json({
            success: true,
            name
          });

        }
      );

    } catch (error) {

      console.error(
        "Setup admin error:",
        error
      );

      return res.status(500).json({
        error:
          "Unable to create admin."
      });

    }

  }
);


/* =========================================================
   LOGIN
========================================================= */

app.post(
  "/api/login",
  (req, res) => {

    try {

      const email =
        normalizeEmail(
          req.body.email
        );

      const password =
        String(
          req.body.password || ""
        );

      if (!email || !password) {

        return res.status(400).json({
          error:
            "Email and password are required."
        });

      }

      const admin =
        db.prepare(`
          SELECT
            id,
            name,
            email,
            password_hash
          FROM admins
          WHERE email = ?
          LIMIT 1
        `).get(email);

      if (!admin) {

        return res.status(401).json({
          error:
            "Invalid email or password."
        });

      }

      const valid =
        bcrypt.compareSync(
          password,
          admin.password_hash
        );

      if (!valid) {

        return res.status(401).json({
          error:
            "Invalid email or password."
        });

      }

      /*
        Regenerate the session after login.

        This prevents old session IDs from being
        reused and guarantees the new authenticated
        session is properly established.
      */

      req.session.regenerate(
        error => {

          if (error) {

            console.error(
              "Session regeneration error:",
              error
            );

            return res.status(500).json({
              error:
                "Login session could not be created."
            });

          }

          req.session.adminId =
            Number(admin.id);

          req.session.adminName =
            admin.name;

          req.session.save(
            saveError => {

              if (saveError) {

                console.error(
                  "Session save error:",
                  saveError
                );

                return res.status(500).json({
                  error:
                    "Login succeeded but session could not be saved."
                });

              }

              return res.json({
                success: true,
                name: admin.name,
                email: admin.email
              });

            }
          );

        }
      );

    } catch (error) {

      console.error(
        "Login error:",
        error
      );

      return res.status(500).json({
        error:
          "Unable to login."
      });

    }

  }
);


/* =========================================================
   LOGOUT
========================================================= */

app.post(
  "/api/logout",
  (req, res) => {

    if (!req.session) {

      return res.json({
        success: true
      });

    }

    req.session.destroy(
      error => {

        if (error) {

          console.error(
            "Logout error:",
            error
          );

          return res.status(500).json({
            error:
              "Unable to logout."
          });

        }

        res.clearCookie(
          "scrimforge.sid",
          {
            httpOnly: true,
            sameSite: "lax",
            secure:
              process.env.NODE_ENV ===
              "production"
          }
        );

        return res.json({
          success: true
        });

      }
    );

  }
);


/* =========================================================
   PUBLIC LOBBIES
========================================================= */

app.get(
  "/api/public/lobbies",
  (req, res) => {

    try {

      return res.json(
        publicLobbyRows()
      );

    } catch (error) {

      console.error(
        "Public lobby error:",
        error
      );

      return res.status(500).json({
        error:
          "Unable to load lobbies."
      });

    }

  }
);


/* =========================================================
   ADMIN LOBBIES
========================================================= */

app.get(
  "/api/lobbies",
  requireAdmin,
  (req, res) => {

    try {

      return res.json(
        publicLobbyRows()
      );

    } catch (error) {

      console.error(
        "Admin lobby error:",
        error
      );

      return res.status(500).json({
        error:
          "Unable to load lobbies."
      });

    }

  }
);


/* =========================================================
   CREATE LOBBY
========================================================= */

app.post(
  "/api/lobbies",
  requireAdmin,
  (req, res) => {

    try {

      const name =
        cleanString(
          req.body.name
        );

      const time =
        cleanString(
          req.body.time
        );

      const fee =
        cleanString(
          req.body.fee
        );

      const maxTeams =
        Number(
          req.body.maxTeams
        );

      if (!name) {

        return res.status(400).json({
          error:
            "Scrim name is required."
        });

      }

      if (!time) {

        return res.status(400).json({
          error:
            "Scrim time is required."
        });

      }

      if (!Number.isInteger(maxTeams) ||
          maxTeams < 1 ||
          maxTeams > 100) {

        return res.status(400).json({
          error:
            "Maximum teams must be between 1 and 100."
        });

      }

      const duplicate =
        db.prepare(`
          SELECT id
          FROM lobbies
          WHERE name = ?
          LIMIT 1
        `).get(name);

      if (duplicate) {

        return res.status(409).json({
          error:
            "A scrim with this name already exists."
        });

      }

      const result =
        db.prepare(`
          INSERT INTO lobbies
          (
            name,
            time,
            fee,
            max_teams,
            status
          )
          VALUES
          (?, ?, ?, ?, 'open')
        `).run(
          name,
          time,
          fee,
          maxTeams
        );

      return res.status(201).json({
        success: true,
        id:
          Number(
            result.lastInsertRowid
          )
      });

    } catch (error) {

      console.error(
        "Create lobby error:",
        error
      );

      return res.status(500).json({
        error:
          "Unable to create scrim."
      });

    }

  }
);


/* =========================================================
   UPDATE LOBBY
========================================================= */

app.patch(
  "/api/lobbies/:id",
  requireAdmin,
  (req, res) => {

    try {

      const id =
        Number(
          req.params.id
        );

      if (!Number.isInteger(id)) {

        return res.status(400).json({
          error:
            "Invalid lobby ID."
        });

      }

      const lobby =
        db.prepare(`
          SELECT *
          FROM lobbies
          WHERE id = ?
        `).get(id);

      if (!lobby) {

        return res.status(404).json({
          error:
            "Lobby not found."
        });

      }

      const status =
        cleanString(
          req.body.status
        ).toLowerCase();

      if (
        status !== "open" &&
        status !== "closed"
      ) {

        return res.status(400).json({
          error:
            "Invalid lobby status."
        });

      }

      db.prepare(`
        UPDATE lobbies
        SET status = ?
        WHERE id = ?
      `).run(
        status,
        id
      );

      return res.json({
        success: true
      });

    } catch (error) {

      console.error(
        "Update lobby error:",
        error
      );

      return res.status(500).json({
        error:
          "Unable to update lobby."
      });

    }

  }
);


/* =========================================================
   DELETE LOBBY
========================================================= */

app.delete(
  "/api/lobbies/:id",
  requireAdmin,
  (req, res) => {

    try {

      const id =
        Number(
          req.params.id
        );

      if (!Number.isInteger(id)) {

        return res.status(400).json({
          error:
            "Invalid lobby ID."
        });

      }

      const lobby =
        db.prepare(`
          SELECT id
          FROM lobbies
          WHERE id = ?
        `).get(id);

      if (!lobby) {

        return res.status(404).json({
          error:
            "Lobby not found."
        });

      }

      const transaction =
        db.transaction(() => {

          db.prepare(`
            DELETE FROM match_scores
            WHERE lobby_id = ?
          `).run(id);

          db.prepare(`
            DELETE FROM registrations
            WHERE lobby_id = ?
          `).run(id);

          db.prepare(`
            DELETE FROM lobbies
            WHERE id = ?
          `).run(id);

        });

      transaction();

      return res.json({
        success: true
      });

    } catch (error) {

      console.error(
        "Delete lobby error:",
        error
      );

      return res.status(500).json({
        error:
          "Unable to delete scrim."
      });

    }

  }
);


/* =========================================================
   CREATE REGISTRATION
========================================================= */

app.post(
  "/api/registrations",
  (req, res) => {

    try {

      const lobbyId =
        Number(
          req.body.lobbyId
        );

      const team =
        cleanString(
          req.body.team
        );

      const captain =
        cleanString(
          req.body.captain
        );

      const phone =
        cleanString(
          req.body.phone
        );

      const uid =
        cleanString(
          req.body.uid
        );

      if (!Number.isInteger(lobbyId)) {

        return res.status(400).json({
          error:
            "Please select a valid lobby."
        });

      }

      if (!team) {

        return res.status(400).json({
          error:
            "Team name is required."
        });

      }

      if (!captain) {

        return res.status(400).json({
          error:
            "Captain name is required."
        });

      }

      if (!phone) {

        return res.status(400).json({
          error:
            "Phone number is required."
        });

      }

      if (!uid) {

        return res.status(400).json({
          error:
            "Free Fire UID is required."
        });

      }

      const lobby =
        db.prepare(`
          SELECT *
          FROM lobbies
          WHERE id = ?
        `).get(lobbyId);

      if (!lobby) {

        return res.status(404).json({
          error:
            "Lobby not found."
        });

      }

      if (
        String(lobby.status)
          .toLowerCase() !==
        "open"
      ) {

        return res.status(400).json({
          error:
            "This lobby is currently closed."
        });

      }

      const confirmed =
        db.prepare(`
          SELECT COUNT(*) AS count
          FROM registrations
          WHERE lobby_id = ?
            AND status = 'confirmed'
        `).get(lobbyId).count;

      if (
        Number(confirmed) >=
        Number(lobby.max_teams)
      ) {

        return res.status(400).json({
          error:
            "This lobby is full."
        });

      }

      const ref =
        generateReference();

      db.prepare(`
        INSERT INTO registrations
        (
          ref,
          lobby_id,
          team,
          captain,
          phone,
          uid,
          fee,
          time,
          status
        )
        VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
      `).run(
        ref,
        lobby.id,
        team,
        captain,
        phone,
        uid,
        lobby.fee,
        lobby.time
      );

      return res.status(201).json({
        success: true,
        ref
      });

    } catch (error) {

      console.error(
        "Registration error:",
        error
      );

      return res.status(500).json({
        error:
          "Unable to submit registration."
      });

    }

  }
);


/* =========================================================
   PUBLIC REGISTRATION STATUS
========================================================= */

app.get(
  "/api/registration-status/:ref",
  (req, res) => {

    try {

      const ref =
        cleanString(
          req.params.ref
        );

      const row =
        db.prepare(`
          SELECT
            r.ref,
            r.team,
            r.captain,
            r.fee,
            r.time,
            r.status,
            l.name AS lobby_name
          FROM registrations r
          LEFT JOIN lobbies l
            ON l.id = r.lobby_id
          WHERE r.ref = ?
          LIMIT 1
        `).get(ref);

      if (!row) {

        return res.status(404).json({
          error:
            "Registration reference not found."
        });

      }

      return res.json(row);

    } catch (error) {

      console.error(
        "Registration status error:",
        error
      );

      return res.status(500).json({
        error:
          "Unable to check registration."
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

      const rows =
        db.prepare(`
          SELECT
            r.id,
            r.ref,
            r.lobby_id,
            r.team,
            r.captain,
            r.phone,
            r.uid,
            r.fee,
            r.time,
            r.status,
            r.created_at
          FROM registrations r
          ORDER BY r.id DESC
        `).all();

      return res.json(rows);

    } catch (error) {

      console.error(
        "Admin registrations error:",
        error
      );

      return res.status(500).json({
        error:
          "Unable to load registrations."
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

      const id =
        Number(
          req.params.id
        );

      const status =
        cleanString(
          req.body.status
        ).toLowerCase();

      if (!Number.isInteger(id)) {

        return res.status(400).json({
          error:
            "Invalid registration ID."
        });

      }

      if (
        status !== "confirmed" &&
        status !== "rejected" &&
        status !== "pending"
      ) {

        return res.status(400).json({
          error:
            "Invalid registration status."
        });

      }

      const registration =
        db.prepare(`
          SELECT *
          FROM registrations
          WHERE id = ?
        `).get(id);

      if (!registration) {

        return res.status(404).json({
          error:
            "Registration not found."
        });

      }

      if (
        status === "confirmed" &&
        registration.lobby_id
      ) {

        const lobby =
          db.prepare(`
            SELECT *
            FROM lobbies
            WHERE id = ?
          `).get(
            registration.lobby_id
          );

        if (lobby) {

          const count =
            db.prepare(`
              SELECT COUNT(*) AS count
              FROM registrations
              WHERE lobby_id = ?
                AND status = 'confirmed'
                AND id != ?
            `).get(
              lobby.id,
              id
            ).count;

          if (
            Number(count) >=
            Number(lobby.max_teams)
          ) {

            return res.status(400).json({
              error:
                "This lobby is already full."
            });

          }

        }

      }

      db.prepare(`
        UPDATE registrations
        SET status = ?
        WHERE id = ?
      `).run(
        status,
        id
      );

      return res.json({
        success: true
      });

    } catch (error) {

      console.error(
        "Update registration error:",
        error
      );

      return res.status(500).json({
        error:
          "Unable to update registration."
      });

    }

  }
);


/* =========================================================
   ASSIGN REGISTRATION TO LOBBY
========================================================= */

app.patch(
  "/api/registrations/:id/lobby",
  requireAdmin,
  (req, res) => {

    try {

      const registrationId =
        Number(
          req.params.id
        );

      const lobbyId =
        Number(
          req.body.lobbyId
        );

      if (
        !Number.isInteger(
          registrationId
        ) ||
        !Number.isInteger(
          lobbyId
        )
      ) {

        return res.status(400).json({
          error:
            "Invalid registration or lobby."
        });

      }

      const registration =
        db.prepare(`
          SELECT *
          FROM registrations
          WHERE id = ?
        `).get(
          registrationId
        );

      if (!registration) {

        return res.status(404).json({
          error:
            "Registration not found."
        });

      }

      if (
        registration.status !==
        "confirmed"
      ) {

        return res.status(400).json({
          error:
            "Confirm the registration first."
        });

      }

      const lobby =
        db.prepare(`
          SELECT *
          FROM lobbies
          WHERE id = ?
        `).get(
          lobbyId
        );

      if (!lobby) {

        return res.status(404).json({
          error:
            "Lobby not found."
        });

      }

      const count =
        db.prepare(`
          SELECT COUNT(*) AS count
          FROM registrations
          WHERE lobby_id = ?
            AND status = 'confirmed'
            AND id != ?
        `).get(
          lobbyId,
          registrationId
        ).count;

      if (
        Number(count) >=
        Number(lobby.max_teams)
      ) {

        return res.status(400).json({
          error:
            "The selected lobby is full."
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
        lobbyId,
        lobby.time,
        lobby.fee,
        registrationId
      );

      return res.json({
        success: true
      });

    } catch (error) {

      console.error(
        "Assign lobby error:",
        error
      );

      return res.status(500).json({
        error:
          "Unable to assign lobby."
      });

    }

  }
);


/* =========================================================
   STATS
========================================================= */

app.get(
  "/api/stats",
  requireAdmin,
  (req, res) => {

    try {

      const pending =
        db.prepare(`
          SELECT COUNT(*) AS count
          FROM registrations
          WHERE status = 'pending'
        `).get().count;

      const confirmed =
        db.prepare(`
          SELECT COUNT(*) AS count
          FROM registrations
          WHERE status = 'confirmed'
        `).get().count;

      const activeLobbies =
        db.prepare(`
          SELECT COUNT(*) AS count
          FROM lobbies
          WHERE status = 'open'
        `).get().count;

      return res.json({
        pending:
          Number(pending),

        confirmed:
          Number(confirmed),

        activeLobbies:
          Number(activeLobbies)
      });

    } catch (error) {

      console.error(
        "Stats error:",
        error
      );

      return res.status(500).json({
        error:
          "Unable to load statistics."
      });

    }

  }
);


/* =========================================================
   LEADERBOARD TEAMS
========================================================= */

app.get(
  "/api/leaderboard/teams",
  requireAdmin,
  (req, res) => {

    try {

      const lobbyName =
        cleanString(
          req.query.lobby
        );

      if (!lobbyName) {

        return res.status(400).json({
          error:
            "Lobby is required."
        });

      }

      const lobby =
        lobbyByName(
          lobbyName
        );

      if (!lobby) {

        return res.status(404).json({
          error:
            "Lobby not found."
        });

      }

      const teams =
        confirmedTeamsForLobby(
          lobby.id
        );

      return res.json(
        teams
      );

    } catch (error) {

      console.error(
        "Leaderboard teams error:",
        error
      );

      return res.status(500).json({
        error:
          "Unable to load leaderboard teams."
      });

    }

  }
);


/* =========================================================
   GET MATCH SCORES - ADMIN/PUBLIC
========================================================= */

app.get(
  "/api/leaderboard/match",
  (req, res) => {

    try {

      const lobbyName =
        cleanString(
          req.query.lobby
        );

      const matchNo =
        Number(
          req.query.match
        );

      if (!lobbyName) {

        return res.status(400).json({
          error:
            "Lobby is required."
        });

      }

      if (
        !Number.isInteger(matchNo) ||
        matchNo < 1 ||
        matchNo > 6
      ) {

        return res.status(400).json({
          error:
            "Match must be between 1 and 6."
        });

      }

      const lobby =
        lobbyByName(
          lobbyName
        );

      if (!lobby) {

        return res.status(404).json({
          error:
            "Lobby not found."
        });

      }

      const rows =
        db.prepare(`
          SELECT
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
        `).all(
          lobby.id,
          matchNo
        );

      return res.json(rows);

    } catch (error) {

      console.error(
        "Match leaderboard error:",
        error
      );

      return res.status(500).json({
        error:
          "Unable to load match leaderboard."
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

      const lobbyName =
        cleanString(
          req.body.lobby
        );

      const matchNo =
        Number(
          req.body.matchNo
        );

      const entries =
        Array.isArray(
          req.body.entries
        )
          ? req.body.entries
          : [];

      if (!lobbyName) {

        return res.status(400).json({
          error:
            "Lobby is required."
        });

      }

      if (
        !Number.isInteger(matchNo) ||
        matchNo < 1 ||
        matchNo > 6
      ) {

        return res.status(400).json({
          error:
            "Match number must be between 1 and 6."
        });

      }

      if (!entries.length) {

        return res.status(400).json({
          error:
            "No score entries were submitted."
        });

      }

      const lobby =
        lobbyByName(
          lobbyName
        );

      if (!lobby) {

        return res.status(404).json({
          error:
            "Lobby not found."
        });

      }

      const confirmedTeams =
        confirmedTeamsForLobby(
          lobby.id
        );

      if (
        confirmedTeams.length !== 12
      ) {

        return res.status(400).json({
          error:
            `Exactly 12 confirmed teams are required. This lobby currently has ${confirmedTeams.length}.`
        });

      }

      if (
        entries.length !==
        confirmedTeams.length
      ) {

        return res.status(400).json({
          error:
            "Score must be entered for all 12 teams."
        });

      }

      const validTeams =
        new Set(
          confirmedTeams.map(
            row => row.team
          )
        );

      const submittedTeams =
        new Set();

      for (const entry of entries) {

        const team =
          cleanString(
            entry.team
          );

        const position =
          Number(
            entry.position
          );

        const kills =
          Number(
            entry.kills
          );

        if (!validTeams.has(team)) {

          return res.status(400).json({
            error:
              `Invalid team in score entry: ${team}`
          });

        }

        if (
          submittedTeams.has(team)
        ) {

          return res.status(400).json({
            error:
              `Duplicate team: ${team}`
          });

        }

        submittedTeams.add(team);

        if (
          !Number.isInteger(position) ||
          position < 1 ||
          position > 12
        ) {

          return res.status(400).json({
            error:
              `Invalid position for ${team}.`
          });

        }

        if (
          !Number.isInteger(kills) ||
          kills < 0
        ) {

          return res.status(400).json({
            error:
              `Invalid kills for ${team}.`
          });

        }

      }

      if (
        submittedTeams.size !==
        validTeams.size
      ) {

        return res.status(400).json({
          error:
            "Every confirmed team must have a score."
        });

      }

      const positions =
        entries.map(
          entry =>
            Number(entry.position)
        );

      const uniquePositions =
        new Set(
          positions
        );

      if (
        uniquePositions.size !== 12
      ) {

        return res.status(400).json({
          error:
            "Each position from 1 to 12 must be used exactly once."
        });

      }

      for (
        let position = 1;
        position <= 12;
        position++
      ) {

        if (
          !uniquePositions.has(
            position
          )
        ) {

          return res.status(400).json({
            error:
              "Positions must contain every rank from 1 to 12."
          });

        }

      }

      const transaction =
        db.transaction(() => {

          db.prepare(`
            DELETE FROM match_scores
            WHERE lobby_id = ?
              AND match_no = ?
          `).run(
            lobby.id,
            matchNo
          );

          const insert =
            db.prepare(`
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
              VALUES
              (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

          for (const entry of entries) {

            const position =
              Number(
                entry.position
              );

            const kills =
              Number(
                entry.kills
              ) || 0;

            const booyah =
              position === 1
                ? 1
                : 0;

            const placement =
              calculatePlacement(
                position
              );

            const killPoints =
              kills;

            const total =
              placement +
              killPoints;

            insert.run(
              lobby.id,
              matchNo,
              cleanString(
                entry.team
              ),
              position,
              kills,
              booyah,
              placement,
              killPoints,
              total
            );

          }

        });

      transaction();

      return res.json({
        success: true,
        match:
          matchNo
      });

    } catch (error) {

      console.error(
        "Save match error:",
        error
      );

      return res.status(500).json({
        error:
          "Unable to save match scores."
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

      const lobbyName =
        cleanString(
          req.query.lobby
        );

      if (!lobbyName) {

        return res.status(400).json({
          error:
            "Lobby is required."
        });

      }

      const lobby =
        lobbyByName(
          lobbyName
        );

      if (!lobby) {

        return res.status(404).json({
          error:
            "Lobby not found."
        });

      }

      const teams =
        confirmedTeamsForLobby(
          lobby.id
        );

      if (!teams.length) {

        return res.json([]);

      }

      const rows =
        db.prepare(`
          SELECT
            team,

            SUM(
              booyah
            ) AS booyahs,

            SUM(
              kill_points
            ) AS killPoints,

            SUM(
              placement_points
            ) AS placementPoints,

            SUM(
              total_points
            ) AS totalPoints

          FROM match_scores

          WHERE lobby_id = ?

          GROUP BY team

          ORDER BY
            totalPoints DESC,
            killPoints DESC,
            placementPoints DESC,
            team ASC
        `).all(
          lobby.id
        );

      const result =
        rows.map(
          (row, index) => ({

            position:
              index + 1,

            team:
              row.team,

            booyahs:
              Number(
                row.booyahs || 0
              ),

            killPoints:
              Number(
                row.killPoints || 0
              ),

            placementPoints:
              Number(
                row.placementPoints || 0
              ),

            totalPoints:
              Number(
                row.totalPoints || 0
              )

          })
        );

      return res.json(
        result
      );

    } catch (error) {

      console.error(
        "Public leaderboard error:",
        error
      );

      return res.status(500).json({
        error:
          "Unable to load leaderboard."
      });

    }

  }
);


/* =========================================================
   FALLBACK INDEX
========================================================= */

app.get(
  "*",
  (req, res, next) => {

    /*
      Do not intercept API errors/routes.
    */

    if (
      req.path.startsWith(
        "/api/"
      )
    ) {

      return next();

    }

    return res.sendFile(
      path.join(
        PUBLIC_DIR,
        "index.html"
      )
    );

  }
);


/* =========================================================
   404 API
========================================================= */

app.use(
  "/api",
  (req, res) => {

    return res.status(404).json({
      error:
        "API endpoint not found."
    });

  }
);


/* =========================================================
   ERROR HANDLER
========================================================= */

app.use(
  (error, req, res, next) => {

    console.error(
      "Unhandled server error:",
      error
    );

    if (
      res.headersSent
    ) {

      return next(error);

    }

    return res.status(500).json({
      error:
        "Internal server error."
    });

  }
);


/* =========================================================
   START SERVER
========================================================= */

app.listen(
  PORT,
  () => {

    console.log("");
    console.log(
      "======================================"
    );
    console.log(
      "       SCRIMFORGE V4 SERVER"
    );
    console.log(
      "======================================"
    );
    console.log(
      `Server running on port ${PORT}`
    );
    console.log(
      `Website: http://localhost:${PORT}`
    );
    console.log(
      `Database: ${dbPath}`
    );
    console.log(
      "======================================"
    );
    console.log("");

  }
);


/* =========================================================
   CLEAN SHUTDOWN
========================================================= */

function shutdown() {

  console.log(
    "Shutting down ScrimForge..."
  );

  try {
    db.close();
  } catch (error) {
    console.error(error);
  }

  process.exit(0);
}


process.on(
  "SIGINT",
  shutdown
);

process.on(
  "SIGTERM",
  shutdown
);
