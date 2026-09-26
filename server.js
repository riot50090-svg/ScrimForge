/* =========================================================
   SCRIMFORGE V4
   SERVER.JS
   FIXED / STABLE VERSION
========================================================= */

"use strict";

const path = require("path");
const fs = require("fs");

const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");


/* =========================================================
   APP CONFIG
========================================================= */

const app = express();

const PORT = Number(process.env.PORT) || 3000;

const ROOT = __dirname;

const PUBLIC_DIR =
  path.join(ROOT, "public");

const DATA_DIR =
  path.join(ROOT, "data");


/* =========================================================
   DIRECTORIES
========================================================= */

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, {
    recursive: true
  });
}


/* =========================================================
   DATABASE
========================================================= */

const DB_PATH =
  path.join(
    DATA_DIR,
    "scrimforge.db"
  );

const db =
  new Database(DB_PATH);

db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");


/* =========================================================
   DATABASE SCHEMA
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

    UNIQUE (
      lobby_id,
      match_no,
      team
    )
  );
`);


/* =========================================================
   MIDDLEWARE
========================================================= */

app.use(
  express.json({
    limit: "1mb"
  })
);

app.use(
  express.urlencoded({
    extended: true
  })
);


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
      "scrimforge-v4-session-secret-change-this",

    resave: false,

    saveUninitialized: false,

    rolling: false,

    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge:
        1000 *
        60 *
        60 *
        24 *
        7
    }
  })
);


/* =========================================================
   STATIC FILES
========================================================= */

app.use(
  express.static(
    PUBLIC_DIR
  )
);


/* =========================================================
   HELPERS
========================================================= */

function cleanString(value) {
  return String(
    value ?? ""
  ).trim();
}


function normalizeEmail(value) {
  return cleanString(
    value
  ).toLowerCase();
}


function generateReference() {

  const part =
    Math.random()
      .toString(36)
      .substring(2, 8)
      .toUpperCase();

  return (
    "SF-" +
    Date.now()
      .toString(36)
      .toUpperCase() +
    "-" +
    part
  );
}


function getAdminFromSession(req) {

  if (
    !req.session ||
    !req.session.adminId
  ) {
    return null;
  }

  const admin =
    db.prepare(`
      SELECT
        id,
        name,
        email
      FROM admins
      WHERE id = ?
      LIMIT 1
    `).get(
      req.session.adminId
    );

  return admin || null;
}


function requireAdmin(
  req,
  res,
  next
) {

  const admin =
    getAdminFromSession(req);

  if (!admin) {

    return res
      .status(401)
      .json({
        error:
          "Admin login required."
      });
  }

  req.admin = admin;

  next();
}


/* =========================================================
   PLACEMENT POINTS
========================================================= */

function calculatePlacement(
  position
) {

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


/* =========================================================
   HEALTH
========================================================= */

app.get(
  "/api/health",
  (req, res) => {

    res.json({
      ok: true,
      name: "ScrimForge V4",
      time: new Date().toISOString()
    });

  }
);


/* =========================================================
   ADMIN EXISTS
========================================================= */

app.get(
  "/api/admin-exists",
  (req, res) => {

    try {

      const row =
        db.prepare(`
          SELECT COUNT(*) AS count
          FROM admins
        `).get();

      res.json({
        exists:
          Number(row.count) > 0
      });

    } catch (error) {

      console.error(
        "Admin exists error:",
        error
      );

      res
        .status(500)
        .json({
          error:
            "Unable to check admin account."
        });
    }

  }
);


/* =========================================================
   CURRENT ADMIN
========================================================= */

app.get(
  "/api/me",
  (req, res) => {

    try {

      const admin =
        getAdminFromSession(req);

      if (!admin) {

        return res.json({
          loggedIn: false
        });
      }

      return res.json({

        loggedIn: true,

        id:
          admin.id,

        name:
          admin.name,

        email:
          admin.email

      });

    } catch (error) {

      console.error(
        "ME endpoint error:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "Unable to check login."
        });
    }

  }
);


/* =========================================================
   CREATE FIRST ADMIN
========================================================= */

app.post(
  "/api/setup-admin",
  (req, res) => {

    try {

      const existing =
        db.prepare(`
          SELECT id
          FROM admins
          LIMIT 1
        `).get();

      if (existing) {

        return res
          .status(400)
          .json({
            error:
              "Admin account already exists."
          });
      }

      const name =
        cleanString(
          req.body.name
        );

      const email =
        normalizeEmail(
          req.body.email
        );

      const password =
        String(
          req.body.password ||
          ""
        );

      if (
        !name ||
        !email ||
        !password
      ) {

        return res
          .status(400)
          .json({
            error:
              "Name, email and password are required."
          });
      }

      if (password.length < 6) {

        return res
          .status(400)
          .json({
            error:
              "Password must contain at least 6 characters."
          });
      }

      const passwordHash =
        bcrypt.hashSync(
          password,
          12
        );

      const result =
        db.prepare(`
          INSERT INTO admins (
            name,
            email,
            password_hash
          )
          VALUES (?, ?, ?)
        `).run(
          name,
          email,
          passwordHash
        );

      req.session.adminId =
        Number(
          result.lastInsertRowid
        );

      req.session.adminName =
        name;

      req.session.save(
        error => {

          if (error) {

            console.error(
              "Setup session error:",
              error
            );

            return res
              .status(500)
              .json({
                error:
                  "Admin created, but session could not be saved."
              });
          }

          return res.json({
            success: true,
            name,
            email
          });

        }
      );

    } catch (error) {

      console.error(
        "Setup admin error:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "Unable to create admin account."
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
          req.body.password ||
          ""
        );

      if (
        !email ||
        !password
      ) {

        return res
          .status(400)
          .json({
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
        `).get(
          email
        );

      if (!admin) {

        return res
          .status(401)
          .json({
            error:
              "Invalid email or password."
          });
      }

      const passwordMatches =
        bcrypt.compareSync(
          password,
          admin.password_hash
        );

      if (!passwordMatches) {

        return res
          .status(401)
          .json({
            error:
              "Invalid email or password."
          });
      }


      /*
       * Completely regenerate the session.
       * Then explicitly save it before responding.
       */

      req.session.regenerate(
        regenerateError => {

          if (regenerateError) {

            console.error(
              "Session regenerate error:",
              regenerateError
            );

            return res
              .status(500)
              .json({
                error:
                  "Unable to create login session."
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

                return res
                  .status(500)
                  .json({
                    error:
                      "Unable to save login session."
                  });
              }

              return res.json({

                success: true,

                name:
                  admin.name,

                email:
                  admin.email

              });

            }
          );

        }
      );

    } catch (error) {

      console.error(
        "LOGIN ERROR:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "Login failed. Please try again."
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

          return res
            .status(500)
            .json({
              error:
                "Unable to logout."
            });
        }

        res.clearCookie(
          "connect.sid"
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

      const rows =
        db.prepare(`
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
        `).all();

      return res.json(
        rows
      );

    } catch (error) {

      console.error(
        "Public lobbies error:",
        error
      );

      return res
        .status(500)
        .json({
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

      const rows =
        db.prepare(`
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
        `).all();

      return res.json(
        rows
      );

    } catch (error) {

      console.error(
        "Admin lobbies error:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "Unable to load lobbies."
        });
    }

  }
);


/* =========================================================
   CREATE SCRIM
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

      if (
        !name ||
        !time ||
        !fee
      ) {

        return res
          .status(400)
          .json({
            error:
              "Scrim name, time and entry fee are required."
          });
      }

      if (
        !Number.isInteger(maxTeams) ||
        maxTeams < 1 ||
        maxTeams > 100
      ) {

        return res
          .status(400)
          .json({
            error:
              "Maximum teams must be between 1 and 100."
          });
      }

      const result =
        db.prepare(`
          INSERT INTO lobbies (
            name,
            time,
            fee,
            max_teams,
            status
          )
          VALUES (?, ?, ?, ?, 'open')
        `).run(
          name,
          time,
          fee,
          maxTeams
        );

      return res.json({

        success: true,

        id:
          Number(
            result.lastInsertRowid
          )

      });

    } catch (error) {

      console.error(
        "Create scrim error:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "Unable to create scrim."
        });
    }

  }
);


/* =========================================================
   UPDATE SCRIM
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

      const status =
        cleanString(
          req.body.status
        ).toLowerCase();

      if (
        !Number.isInteger(id) ||
        !["open", "closed"].includes(status)
      ) {

        return res
          .status(400)
          .json({
            error:
              "Invalid lobby update."
          });
      }

      const result =
        db.prepare(`
          UPDATE lobbies
          SET status = ?
          WHERE id = ?
        `).run(
          status,
          id
        );

      if (!result.changes) {

        return res
          .status(404)
          .json({
            error:
              "Lobby not found."
          });
      }

      return res.json({
        success: true
      });

    } catch (error) {

      console.error(
        "Update lobby error:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "Unable to update scrim."
        });
    }

  }
);


/* =========================================================
   DELETE SCRIM
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

        return res
          .status(400)
          .json({
            error:
              "Invalid lobby ID."
          });
      }

      const result =
        db.prepare(`
          DELETE FROM lobbies
          WHERE id = ?
        `).run(id);

      if (!result.changes) {

        return res
          .status(404)
          .json({
            error:
              "Lobby not found."
          });
      }

      return res.json({
        success: true
      });

    } catch (error) {

      console.error(
        "Delete lobby error:",
        error
      );

      return res
        .status(500)
        .json({
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

      if (
        !Number.isInteger(lobbyId) ||
        !team ||
        !captain ||
        !phone ||
        !uid
      ) {

        return res
          .status(400)
          .json({
            error:
              "Please complete all registration fields."
          });
      }

      const lobby =
        db.prepare(`
          SELECT
            id,
            name,
            time,
            fee,
            max_teams,
            status
          FROM lobbies
          WHERE id = ?
        `).get(lobbyId);

      if (!lobby) {

        return res
          .status(404)
          .json({
            error:
              "Selected lobby not found."
          });
      }

      if (
        lobby.status !== "open"
      ) {

        return res
          .status(400)
          .json({
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
        `).get(lobbyId);

      if (
        Number(confirmed.count) >=
        Number(lobby.max_teams)
      ) {

        return res
          .status(400)
          .json({
            error:
              "This lobby is full."
          });
      }

      let ref =
        generateReference();

      while (
        db.prepare(`
          SELECT id
          FROM registrations
          WHERE ref = ?
        `).get(ref)
      ) {

        ref =
          generateReference();
      }

      const result =
        db.prepare(`
          INSERT INTO registrations (
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
        `).run(
          ref,
          lobby.id,
          team,
          captain,
          phone,
          uid,
          lobby.time,
          lobby.fee
        );

      return res.json({

        success: true,

        id:
          Number(
            result.lastInsertRowid
          ),

        ref

      });

    } catch (error) {

      console.error(
        "Registration error:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "Unable to submit registration."
        });
    }

  }
);


/* =========================================================
   REGISTRATION STATUS
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
        `).get(ref);

      if (!row) {

        return res
          .status(404)
          .json({
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

      return res
        .status(500)
        .json({
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
        `).all();

      return res.json(rows);

    } catch (error) {

      console.error(
        "Registrations error:",
        error
      );

      return res
        .status(500)
        .json({
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

        return res
          .status(400)
          .json({
            error:
              "Invalid registration ID."
          });
      }

      if (
        ![
          "pending",
          "confirmed",
          "rejected"
        ].includes(status)
      ) {

        return res
          .status(400)
          .json({
            error:
              "Invalid registration status."
          });
      }

      const registration =
        db.prepare(`
          SELECT
            id,
            lobby_id
          FROM registrations
          WHERE id = ?
        `).get(id);

      if (!registration) {

        return res
          .status(404)
          .json({
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
            SELECT
              id,
              max_teams
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
            );

          if (
            Number(count.count) >=
            Number(lobby.max_teams)
          ) {

            return res
              .status(400)
              .json({
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

      return res
        .status(500)
        .json({
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
        !Number.isInteger(registrationId) ||
        !Number.isInteger(lobbyId)
      ) {

        return res
          .status(400)
          .json({
            error:
              "Invalid registration or lobby."
          });
      }

      const registration =
        db.prepare(`
          SELECT
            id,
            team,
            status
          FROM registrations
          WHERE id = ?
        `).get(
          registrationId
        );

      if (!registration) {

        return res
          .status(404)
          .json({
            error:
              "Registration not found."
          });
      }

      if (
        registration.status !==
        "confirmed"
      ) {

        return res
          .status(400)
          .json({
            error:
              "Confirm the registration before assigning a lobby."
          });
      }

      const lobby =
        db.prepare(`
          SELECT
            id,
            time,
            fee,
            max_teams,
            status
          FROM lobbies
          WHERE id = ?
        `).get(
          lobbyId
        );

      if (!lobby) {

        return res
          .status(404)
          .json({
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
        );

      if (
        Number(count.count) >=
        Number(lobby.max_teams)
      ) {

        return res
          .status(400)
          .json({
            error:
              "Selected lobby is full."
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

      return res.json({
        success: true
      });

    } catch (error) {

      console.error(
        "Assign lobby error:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "Unable to assign lobby."
        });
    }

  }
);


/* =========================================================
   ADMIN STATS
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
        `).get();

      const confirmed =
        db.prepare(`
          SELECT COUNT(*) AS count
          FROM registrations
          WHERE status = 'confirmed'
        `).get();

      const activeLobbies =
        db.prepare(`
          SELECT COUNT(*) AS count
          FROM lobbies
          WHERE status = 'open'
        `).get();

      return res.json({

        pending:
          Number(pending.count),

        confirmed:
          Number(confirmed.count),

        activeLobbies:
          Number(activeLobbies.count)

      });

    } catch (error) {

      console.error(
        "Stats error:",
        error
      );

      return res
        .status(500)
        .json({
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

        return res
          .status(400)
          .json({
            error:
              "Lobby is required."
          });
      }

      const lobby =
        db.prepare(`
          SELECT
            id,
            name
          FROM lobbies
          WHERE name = ?
          LIMIT 1
        `).get(
          lobbyName
        );

      if (!lobby) {

        return res
          .status(404)
          .json({
            error:
              "Lobby not found."
          });
      }

      const teams =
        db.prepare(`
          SELECT
            id,
            team,
            captain
          FROM registrations
          WHERE lobby_id = ?
          AND status = 'confirmed'
          ORDER BY team COLLATE NOCASE ASC
        `).all(
          lobby.id
        );

      return res.json(teams);

    } catch (error) {

      console.error(
        "Leaderboard teams error:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "Unable to load lobby teams."
        });
    }

  }
);


/* =========================================================
   GET MATCH SCORE
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

      if (
        !lobbyName ||
        !Number.isInteger(matchNo) ||
        matchNo < 1 ||
        matchNo > 6
      ) {

        return res
          .status(400)
          .json({
            error:
              "Invalid lobby or match."
          });
      }

      const lobby =
        db.prepare(`
          SELECT id
          FROM lobbies
          WHERE name = ?
          LIMIT 1
        `).get(
          lobbyName
        );

      if (!lobby) {

        return res
          .status(404)
          .json({
            error:
              "Lobby not found."
          });
      }

      const rows =
        db.prepare(`
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

      return res
        .status(500)
        .json({
          error:
            "Unable to load match results."
        });
    }

  }
);


/* =========================================================
   SAVE MATCH SCORE
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

        return res
          .status(400)
          .json({
            error:
              "Lobby is required."
          });
      }

      if (
        !Number.isInteger(matchNo) ||
        matchNo < 1 ||
        matchNo > 6
      ) {

        return res
          .status(400)
          .json({
            error:
              "Match number must be between 1 and 6."
          });
      }

      if (entries.length !== 12) {

        return res
          .status(400)
          .json({
            error:
              "Exactly 12 teams are required."
          });
      }

      const lobby =
        db.prepare(`
          SELECT
            id,
            max_teams
          FROM lobbies
          WHERE name = ?
          LIMIT 1
        `).get(
          lobbyName
        );

      if (!lobby) {

        return res
          .status(404)
          .json({
            error:
              "Lobby not found."
          });
      }

      const confirmedTeams =
        db.prepare(`
          SELECT team
          FROM registrations
          WHERE lobby_id = ?
          AND status = 'confirmed'
          ORDER BY team COLLATE NOCASE ASC
        `).all(
          lobby.id
        );

      if (
        confirmedTeams.length !== 12
      ) {

        return res
          .status(400)
          .json({
            error:
              `This lobby has ${confirmedTeams.length}/12 confirmed teams. Exactly 12 teams are required.`
          });
      }

      const confirmedSet =
        new Set(
          confirmedTeams.map(
            row =>
              String(row.team)
          )
        );

      const submittedTeams =
        entries.map(
          entry =>
            cleanString(
              entry.team
            )
        );

      const uniqueTeams =
        new Set(
          submittedTeams
        );

      if (
        uniqueTeams.size !== 12
      ) {

        return res
          .status(400)
          .json({
            error:
              "Each team must appear exactly once."
          });
      }

      for (
        const team of submittedTeams
      ) {

        if (
          !confirmedSet.has(team)
        ) {

          return res
            .status(400)
            .json({
              error:
                `Team "${team}" is not a confirmed team in this lobby.`
            });
        }
      }

      const positions =
        entries.map(
          entry =>
            Number(entry.position)
        );

      const positionSet =
        new Set(positions);

      if (
        positions.some(
          position =>
            !Number.isInteger(position) ||
            position < 1 ||
            position > 12
        ) ||
        positionSet.size !== 12
      ) {

        return res
          .status(400)
          .json({
            error:
              "Positions must contain every value from 1 to 12 exactly once."
          });
      }

      const normalized =
        entries.map(
          entry => {

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

            const safeKills =
              Number.isInteger(kills) &&
              kills >= 0
                ? kills
                : 0;

            const placementPoints =
              calculatePlacement(
                position
              );

            const booyah =
              position === 1
                ? 1
                : 0;

            const killPoints =
              safeKills;

            const totalPoints =
              placementPoints +
              killPoints;

            return {
              team,
              position,
              kills: safeKills,
              booyah,
              placementPoints,
              killPoints,
              totalPoints
            };

          }
        );

      const deleteExisting =
        db.prepare(`
          DELETE FROM match_scores
          WHERE lobby_id = ?
          AND match_no = ?
        `);

      const insertScore =
        db.prepare(`
          INSERT INTO match_scores (
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

      const saveTransaction =
        db.transaction(
          rows => {

            deleteExisting.run(
              lobby.id,
              matchNo
            );

            for (
              const row of rows
            ) {

              insertScore.run(
                lobby.id,
                matchNo,
                row.team,
                row.position,
                row.kills,
                row.booyah,
                row.placementPoints,
                row.killPoints,
                row.totalPoints
              );

            }

          }
        );

      saveTransaction(
        normalized
      );

      return res.json({

        success: true,

        match:
          matchNo,

        count:
          normalized.length

      });

    } catch (error) {

      console.error(
        "Save match error:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "Unable to save match results."
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

        return res
          .status(400)
          .json({
            error:
              "Lobby is required."
          });
      }

      const lobby =
        db.prepare(`
          SELECT
            id,
            name
          FROM lobbies
          WHERE name = ?
          LIMIT 1
        `).get(
          lobbyName
        );

      if (!lobby) {

        return res
          .status(404)
          .json({
            error:
              "Lobby not found."
          });
      }

      const rows =
        db.prepare(`
          SELECT

            team,

            SUM(booyah) AS booyahs,

            SUM(kills) AS killPoints,

            SUM(placement_points)
              AS placementPoints,

            SUM(total_points)
              AS totalPoints

          FROM match_scores

          WHERE lobby_id = ?

          GROUP BY team

          ORDER BY
            totalPoints DESC,
            killPoints DESC,
            booyahs DESC,
            team COLLATE NOCASE ASC
        `).all(
          lobby.id
        );

      const ranked =
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
        ranked
      );

    } catch (error) {

      console.error(
        "Public leaderboard error:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "Unable to load leaderboard."
        });
    }

  }
);


/* =========================================================
   SPA FALLBACK
   =========================================================
   
   IMPORTANT:
   Do NOT use:
       app.get("*", ...)
   
   because Express 5 changed wildcard route syntax.

   A regular expression works with both Express 4 and 5.
========================================================= */

app.get(
  /^\/(?!api(?:\/|$)).*/,
  (req, res) => {

    const indexPath =
      path.join(
        PUBLIC_DIR,
        "index.html"
      );

    if (
      fs.existsSync(indexPath)
    ) {

      return res.sendFile(
        indexPath
      );
    }

    return res
      .status(500)
      .send(
        "ScrimForge: public/index.html not found."
      );
  }
);


/* =========================================================
   API 404
========================================================= */

app.use(
  "/api",
  (req, res) => {

    return res
      .status(404)
      .json({
        error:
          "API endpoint not found."
      });

  }
);


/* =========================================================
   GENERAL 404
========================================================= */

app.use(
  (req, res) => {

    return res
      .status(404)
      .send(
        "Page not found."
      );

  }
);


/* =========================================================
   ERROR HANDLER
========================================================= */

app.use(
  (error, req, res, next) => {

    console.error(
      "UNHANDLED SERVER ERROR:",
      error
    );

    if (
      res.headersSent
    ) {

      return next(error);
    }

    return res
      .status(500)
      .json({
        error:
          "Internal server error."
      });

  }
);


/* =========================================================
   START SERVER
========================================================= */

let server;

try {

  server =
    app.listen(
      PORT,
      () => {

        console.log(
          "=========================================="
        );

        console.log(
          "       SCRIMFORGE V4 SERVER"
        );

        console.log(
          "=========================================="
        );

        console.log(
          `Server running on port ${PORT}`
        );

        console.log(
          `Public directory: ${PUBLIC_DIR}`
        );

        console.log(
          `Database: ${DB_PATH}`
        );

        console.log(
          "Health: /api/health"
        );

        console.log(
          "=========================================="
        );

      }
    );

} catch (error) {

  console.error(
    "SERVER START ERROR:",
    error
  );

  process.exit(1);
}


/* =========================================================
   GRACEFUL SHUTDOWN
========================================================= */

function shutdown() {

  console.log(
    "Shutting down ScrimForge..."
  );

  try {

    db.close();

  } catch (error) {

    console.error(
      "Database close error:",
      error
    );

  }

  if (server) {

    server.close(
      () => {
        process.exit(0);
      }
    );

  } else {

    process.exit(0);

  }

}


process.on(
  "SIGINT",
  shutdown
);

process.on(
  "SIGTERM",
  shutdown
);
