/* =========================================================
   SCRIMFORGE V4
   SERVER.JS
   Stable Express + Better-SQLite3 Backend
   ========================================================= */

"use strict";

const path = require("path");
const fs = require("fs");

const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");


/* =========================================================
   APP
========================================================= */

const app = express();

const PORT = Number(process.env.PORT) || 3000;

const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const DATA_DIR = path.join(ROOT_DIR, "data");

fs.mkdirSync(PUBLIC_DIR, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });


/* =========================================================
   PROXY / DEPLOYMENT
========================================================= */

if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}


/* =========================================================
   DATABASE
========================================================= */

const dbPath = path.join(DATA_DIR, "scrimforge.db");

const db = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");


/* =========================================================
   DATABASE TABLES
========================================================= */

db.exec(`
  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS lobbies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    time TEXT NOT NULL,
    fee TEXT NOT NULL,
    max_teams INTEGER NOT NULL DEFAULT 12,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
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
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (lobby_id)
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
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,

    UNIQUE(lobby_id, match_no, team),

    FOREIGN KEY (lobby_id)
      REFERENCES lobbies(id)
      ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expired INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_expired
  ON sessions(expired);

  CREATE INDEX IF NOT EXISTS idx_registrations_lobby
  ON registrations(lobby_id);

  CREATE INDEX IF NOT EXISTS idx_scores_lobby
  ON match_scores(lobby_id);
`);


/* =========================================================
   CUSTOM SQLITE SESSION STORE
   Uses the SAME better-sqlite3 database.
========================================================= */

class BetterSQLiteSessionStore extends session.Store {

  constructor(database) {

    super();

    this.db = database;

    this.getStatement = this.db.prepare(`
      SELECT sess
      FROM sessions
      WHERE sid = ?
        AND expired > ?
    `);

    this.setStatement = this.db.prepare(`
      INSERT INTO sessions
        (sid, sess, expired)
      VALUES
        (?, ?, ?)
      ON CONFLICT(sid)
      DO UPDATE SET
        sess = excluded.sess,
        expired = excluded.expired
    `);

    this.destroyStatement = this.db.prepare(`
      DELETE FROM sessions
      WHERE sid = ?
    `);

    this.touchStatement = this.db.prepare(`
      UPDATE sessions
      SET expired = ?
      WHERE sid = ?
    `);

    this.clearExpiredStatement = this.db.prepare(`
      DELETE FROM sessions
      WHERE expired <= ?
    `);
  }


  get(sid, callback) {

    try {

      const row = this.getStatement.get(
        sid,
        Date.now()
      );

      if (!row) {
        return callback(null, null);
      }

      let sess;

      try {
        sess = JSON.parse(row.sess);
      } catch (error) {
        console.error("SESSION JSON ERROR:", error);
        return callback(null, null);
      }

      callback(null, sess);

    } catch (error) {

      console.error("SESSION GET ERROR:", error);

      callback(error);

    }
  }


  set(sid, sess, callback) {

    try {

      const maxAge =
        sess &&
        sess.cookie &&
        Number(sess.cookie.maxAge)
          ? Number(sess.cookie.maxAge)
          : 1000 * 60 * 60 * 24 * 7;

      const expired =
        Date.now() + maxAge;

      this.setStatement.run(
        sid,
        JSON.stringify(sess),
        expired
      );

      callback(null);

    } catch (error) {

      console.error("SESSION SET ERROR:", error);

      callback(error);

    }
  }


  destroy(sid, callback) {

    try {

      this.destroyStatement.run(sid);

      callback(null);

    } catch (error) {

      console.error("SESSION DESTROY ERROR:", error);

      callback(error);

    }
  }


  touch(sid, sess, callback) {

    try {

      const maxAge =
        sess &&
        sess.cookie &&
        Number(sess.cookie.maxAge)
          ? Number(sess.cookie.maxAge)
          : 1000 * 60 * 60 * 24 * 7;

      const expired =
        Date.now() + maxAge;

      this.touchStatement.run(
        expired,
        sid
      );

      callback(null);

    } catch (error) {

      console.error("SESSION TOUCH ERROR:", error);

      callback(error);

    }
  }


  clearExpiredSessions() {

    try {

      this.clearExpiredStatement.run(
        Date.now()
      );

    } catch (error) {

      console.error(
        "SESSION CLEANUP ERROR:",
        error
      );

    }
  }
}


const sessionStore =
  new BetterSQLiteSessionStore(db);


/* =========================================================
   EXPRESS MIDDLEWARE
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


/* =========================================================
   SESSION
========================================================= */

app.use(
  session({

    store: sessionStore,

    secret:
      process.env.SESSION_SECRET ||
      "scrimforge-v4-super-secret-change-this",

    resave: false,

    saveUninitialized: false,

    rolling: true,

    cookie: {

      httpOnly: true,

      sameSite: "lax",

      secure:
        process.env.NODE_ENV === "production",

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
   SESSION CLEANUP
========================================================= */

const sessionCleanup =
  setInterval(
    () => {
      sessionStore.clearExpiredSessions();
    },
    1000 * 60 * 30
  );

if (sessionCleanup.unref) {
  sessionCleanup.unref();
}


/* =========================================================
   STATIC WEBSITE
========================================================= */

app.use(
  express.static(
    PUBLIC_DIR,
    {
      index: false
    }
  )
);


/* =========================================================
   HELPERS
========================================================= */

function clean(value) {

  return String(
    value ?? ""
  ).trim();

}


function generateReference() {

  let ref;

  do {

    const random =
      Math.random()
        .toString(36)
        .substring(2, 10)
        .toUpperCase();

    ref =
      `SF-${random}`;

  } while (
    db
      .prepare(
        "SELECT id FROM registrations WHERE ref = ?"
      )
      .get(ref)
  );

  return ref;
}


function placementPoints(position) {

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
    ] ?? 0
  );
}


function requireAdmin(req, res, next) {

  if (
    !req.session ||
    !req.session.adminId
  ) {

    return res.status(401).json({

      error:
        "Admin login required."

    });

  }

  next();

}


/* =========================================================
   HEALTH
========================================================= */

app.get(
  "/health",
  (req, res) => {

    res.status(200).json({

      ok: true,

      service:
        "ScrimForge V4",

      database:
        "connected",

      time:
        new Date().toISOString()

    });

  }
);


/* =========================================================
   ROOT
========================================================= */

app.get(
  "/",
  (req, res) => {

    res.sendFile(
      path.join(
        PUBLIC_DIR,
        "index.html"
      )
    );

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
        db
          .prepare(
            `
            SELECT COUNT(*) AS count
            FROM admins
            `
          )
          .get();

      res.json({

        exists:
          Number(row.count) > 0

      });

    } catch (error) {

      console.error(
        "ADMIN EXISTS ERROR:",
        error
      );

      res.status(500).json({

        error:
          "Unable to check admin."

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

      if (
        !req.session ||
        !req.session.adminId
      ) {

        return res.json({
          loggedIn: false
        });

      }

      const admin =
        db
          .prepare(
            `
            SELECT
              id,
              name,
              email
            FROM admins
            WHERE id = ?
            `
          )
          .get(
            req.session.adminId
          );

      if (!admin) {

        return req.session.destroy(
          () => {

            res.json({
              loggedIn: false
            });

          }
        );

      }

      res.json({

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
        "ME ERROR:",
        error
      );

      res.status(500).json({

        error:
          "Unable to load account."

      });

    }

  }
);


/* =========================================================
   SETUP ADMIN
========================================================= */

app.post(
  "/api/setup-admin",
  (req, res) => {

    try {

      const name =
        clean(
          req.body.name
        );

      const email =
        clean(
          req.body.email
        ).toLowerCase();

      const password =
        String(
          req.body.password || ""
        );

      if (
        !name ||
        !email ||
        !password
      ) {

        return res.status(400).json({

          error:
            "Name, email and password are required."

        });

      }

      if (
        password.length < 6
      ) {

        return res.status(400).json({

          error:
            "Password must be at least 6 characters."

        });

      }

      const count =
        db
          .prepare(
            `
            SELECT COUNT(*) AS count
            FROM admins
            `
          )
          .get();

      if (
        Number(count.count) > 0
      ) {

        return res.status(409).json({

          error:
            "Admin account already exists."

        });

      }

      const passwordHash =
        bcrypt.hashSync(
          password,
          12
        );

      const result =
        db
          .prepare(
            `
            INSERT INTO admins
              (
                name,
                email,
                password_hash
              )
            VALUES
              (?, ?, ?)
            `
          )
          .run(
            name,
            email,
            passwordHash
          );

      req.session.regenerate(
        regenerateError => {

          if (regenerateError) {

            console.error(
              "SETUP SESSION REGENERATE ERROR:",
              regenerateError
            );

            return res.status(500).json({

              error:
                "Admin created, but session could not be started."

            });

          }

          req.session.adminId =
            Number(
              result.lastInsertRowid
            );

          req.session.save(
            saveError => {

              if (saveError) {

                console.error(
                  "SETUP SESSION SAVE ERROR:",
                  saveError
                );

                return res.status(500).json({

                  error:
                    "Admin created, but login session could not be saved."

                });

              }

              res.json({

                success: true,

                name,

                email

              });

            }

          );

        }
      );

    } catch (error) {

      console.error(
        "SETUP ADMIN ERROR:",
        error
      );

      res.status(500).json({

        error:
          "Unable to create admin account."

      });

    }

  }
);


/* =========================================================
   ADMIN LOGIN
========================================================= */

app.post(
  "/api/login",
  (req, res) => {

    try {

      const email =
        clean(
          req.body.email
        ).toLowerCase();

      const password =
        String(
          req.body.password || ""
        );

      console.log(
        `[LOGIN] Request received for: ${email || "(empty email)"}`
      );

      if (
        !email ||
        !password
      ) {

        return res.status(400).json({

          error:
            "Email and password are required."

        });

      }

      const admin =
        db
          .prepare(
            `
            SELECT
              id,
              name,
              email,
              password_hash
            FROM admins
            WHERE email = ?
            LIMIT 1
            `
          )
          .get(
            email
          );

      if (!admin) {

        console.log(
          `[LOGIN] Admin not found: ${email}`
        );

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

        console.log(
          `[LOGIN] Wrong password: ${email}`
        );

        return res.status(401).json({

          error:
            "Invalid email or password."

        });

      }

      /*
        Regenerate the session before assigning
        adminId. This prevents session fixation
        and also gives us a fresh session ID.
      */

      req.session.regenerate(
        regenerateError => {

          if (regenerateError) {

            console.error(
              "LOGIN SESSION REGENERATE ERROR:",
              regenerateError
            );

            return res.status(500).json({

              error:
                "Login succeeded, but the session could not be created."

            });

          }

          req.session.adminId =
            Number(
              admin.id
            );

          req.session.save(
            saveError => {

              if (saveError) {

                console.error(
                  "LOGIN SESSION SAVE ERROR:",
                  saveError
                );

                return res.status(500).json({

                  error:
                    "Login succeeded, but the session could not be saved."

                });

              }

              console.log(
                `[LOGIN] Successful: ${email}`
              );

              res.status(200).json({

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

      res.status(500).json({

        error:
          "Login server error."

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
            "LOGOUT ERROR:",
            error
          );

          return res.status(500).json({

            error:
              "Unable to logout."

          });

        }

        res.clearCookie(
          "connect.sid"
        );

        res.json({

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
        db
          .prepare(
            `
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
            `
          )
          .all();

      res.json(rows);

    } catch (error) {

      console.error(
        "PUBLIC LOBBIES ERROR:",
        error
      );

      res.status(500).json({

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
        db
          .prepare(
            `
            SELECT

              l.*,

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
            `
          )
          .all();

      res.json(rows);

    } catch (error) {

      console.error(
        "ADMIN LOBBIES ERROR:",
        error
      );

      res.status(500).json({

        error:
          "Unable to load admin lobbies."

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
        clean(
          req.body.name
        );

      const time =
        clean(
          req.body.time
        );

      const fee =
        clean(
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

        return res.status(400).json({

          error:
            "Name, time and fee are required."

        });

      }

      if (
        !Number.isInteger(maxTeams) ||
        maxTeams < 1 ||
        maxTeams > 100
      ) {

        return res.status(400).json({

          error:
            "Maximum teams must be between 1 and 100."

        });

      }

      const result =
        db
          .prepare(
            `
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
            `
          )
          .run(
            name,
            time,
            fee,
            maxTeams
          );

      res.json({

        success: true,

        id:
          Number(
            result.lastInsertRowid
          )

      });

    } catch (error) {

      console.error(
        "CREATE LOBBY ERROR:",
        error
      );

      res.status(500).json({

        error:
          "Unable to create lobby."

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

      const status =
        clean(
          req.body.status
        ).toLowerCase();

      if (
        !Number.isInteger(id)
      ) {

        return res.status(400).json({

          error:
            "Invalid lobby ID."

        });

      }

      if (
        !["open", "closed"]
          .includes(status)
      ) {

        return res.status(400).json({

          error:
            "Lobby status must be open or closed."

        });

      }

      const result =
        db
          .prepare(
            `
            UPDATE lobbies
            SET status = ?
            WHERE id = ?
            `
          )
          .run(
            status,
            id
          );

      if (!result.changes) {

        return res.status(404).json({

          error:
            "Lobby not found."

        });

      }

      res.json({

        success: true

      });

    } catch (error) {

      console.error(
        "UPDATE LOBBY ERROR:",
        error
      );

      res.status(500).json({

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

      if (
        !Number.isInteger(id)
      ) {

        return res.status(400).json({

          error:
            "Invalid lobby ID."

        });

      }

      const transaction =
        db.transaction(
          () => {

            db
              .prepare(
                `
                DELETE FROM match_scores
                WHERE lobby_id = ?
                `
              )
              .run(id);

            db
              .prepare(
                `
                DELETE FROM registrations
                WHERE lobby_id = ?
                `
              )
              .run(id);

            const result =
              db
                .prepare(
                  `
                  DELETE FROM lobbies
                  WHERE id = ?
                  `
                )
                .run(id);

            return result.changes;

          }
        );

      const changes =
        transaction();

      if (!changes) {

        return res.status(404).json({

          error:
            "Lobby not found."

        });

      }

      res.json({

        success: true

      });

    } catch (error) {

      console.error(
        "DELETE LOBBY ERROR:",
        error
      );

      res.status(500).json({

        error:
          "Unable to delete lobby."

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
        clean(
          req.body.team
        );

      const captain =
        clean(
          req.body.captain
        );

      const phone =
        clean(
          req.body.phone
        );

      const uid =
        clean(
          req.body.uid
        );

      if (
        !Number.isInteger(lobbyId) ||
        lobbyId <= 0
      ) {

        return res.status(400).json({

          error:
            "Please select a valid lobby."

        });

      }

      if (
        !team ||
        !captain ||
        !phone ||
        !uid
      ) {

        return res.status(400).json({

          error:
            "Please complete all registration fields."

        });

      }

      const lobby =
        db
          .prepare(
            `
            SELECT *
            FROM lobbies
            WHERE id = ?
            `
          )
          .get(
            lobbyId
          );

      if (!lobby) {

        return res.status(404).json({

          error:
            "Selected lobby no longer exists."

        });

      }

      if (
        String(lobby.status)
          .toLowerCase() !== "open"
      ) {

        return res.status(400).json({

          error:
            "This lobby is currently closed."

        });

      }

      const count =
        db
          .prepare(
            `
            SELECT COUNT(*) AS count
            FROM registrations
            WHERE lobby_id = ?
              AND status = 'confirmed'
            `
          )
          .get(
            lobbyId
          );

      if (
        Number(count.count) >=
        Number(lobby.max_teams)
      ) {

        return res.status(400).json({

          error:
            "This lobby is full."

        });

      }

      const ref =
        generateReference();

      const result =
        db
          .prepare(
            `
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
            VALUES
              (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
            `
          )
          .run(
            ref,
            lobbyId,
            team,
            captain,
            phone,
            uid,
            lobby.time,
            lobby.fee
          );

      res.json({

        success: true,

        id:
          Number(
            result.lastInsertRowid
          ),

        ref

      });

    } catch (error) {

      console.error(
        "REGISTRATION ERROR:",
        error
      );

      res.status(500).json({

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
        clean(
          req.params.ref
        ).toUpperCase();

      const row =
        db
          .prepare(
            `
            SELECT
              r.*,
              l.name AS lobby_name

            FROM registrations r

            LEFT JOIN lobbies l
              ON l.id = r.lobby_id

            WHERE UPPER(r.ref) = ?
            `
          )
          .get(
            ref
          );

      if (!row) {

        return res.status(404).json({

          error:
            "Registration reference not found."

        });

      }

      res.json({

        id:
          row.id,

        ref:
          row.ref,

        team:
          row.team,

        captain:
          row.captain,

        time:
          row.time,

        fee:
          row.fee,

        status:
          row.status,

        lobby_name:
          row.lobby_name || ""

      });

    } catch (error) {

      console.error(
        "STATUS ERROR:",
        error
      );

      res.status(500).json({

        error:
          "Unable to check registration status."

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
        db
          .prepare(
            `
            SELECT
              r.*,
              l.name AS lobby_name

            FROM registrations r

            LEFT JOIN lobbies l
              ON l.id = r.lobby_id

            ORDER BY r.id DESC
            `
          )
          .all();

      res.json(rows);

    } catch (error) {

      console.error(
        "REGISTRATION LIST ERROR:",
        error
      );

      res.status(500).json({

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
        clean(
          req.body.status
        ).toLowerCase();

      if (
        !Number.isInteger(id)
      ) {

        return res.status(400).json({

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

        return res.status(400).json({

          error:
            "Invalid registration status."

        });

      }

      const registration =
        db
          .prepare(
            `
            SELECT *
            FROM registrations
            WHERE id = ?
            `
          )
          .get(
            id
          );

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
          db
            .prepare(
              `
              SELECT *
              FROM lobbies
              WHERE id = ?
              `
            )
            .get(
              registration.lobby_id
            );

        if (lobby) {

          const count =
            db
              .prepare(
                `
                SELECT COUNT(*) AS count
                FROM registrations
                WHERE lobby_id = ?
                  AND status = 'confirmed'
                  AND id != ?
                `
              )
              .get(
                lobby.id,
                id
              );

          if (
            Number(count.count) >=
            Number(lobby.max_teams)
          ) {

            return res.status(400).json({

              error:
                "This lobby is already full."

            });

          }

        }

      }

      db
        .prepare(
          `
          UPDATE registrations
          SET status = ?
          WHERE id = ?
          `
        )
        .run(
          status,
          id
        );

      res.json({

        success: true

      });

    } catch (error) {

      console.error(
        "UPDATE REGISTRATION ERROR:",
        error
      );

      res.status(500).json({

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
        db
          .prepare(
            `
            SELECT *
            FROM registrations
            WHERE id = ?
            `
          )
          .get(
            registrationId
          );

      if (!registration) {

        return res.status(404).json({

          error:
            "Registration not found."

        });

      }

      const lobby =
        db
          .prepare(
            `
            SELECT *
            FROM lobbies
            WHERE id = ?
            `
          )
          .get(
            lobbyId
          );

      if (!lobby) {

        return res.status(404).json({

          error:
            "Lobby not found."

        });

      }

      const confirmed =
        db
          .prepare(
            `
            SELECT COUNT(*) AS count
            FROM registrations
            WHERE lobby_id = ?
              AND status = 'confirmed'
              AND id != ?
            `
          )
          .get(
            lobbyId,
            registrationId
          );

      if (
        registration.status === "confirmed" &&
        Number(confirmed.count) >=
          Number(lobby.max_teams)
      ) {

        return res.status(400).json({

          error:
            "This lobby is full."

        });

      }

      db
        .prepare(
          `
          UPDATE registrations
          SET
            lobby_id = ?,
            time = ?,
            fee = ?
          WHERE id = ?
          `
        )
        .run(
          lobbyId,
          lobby.time,
          lobby.fee,
          registrationId
        );

      res.json({

        success: true

      });

    } catch (error) {

      console.error(
        "ASSIGN LOBBY ERROR:",
        error
      );

      res.status(500).json({

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
        db
          .prepare(
            `
            SELECT COUNT(*) AS count
            FROM registrations
            WHERE status = 'pending'
            `
          )
          .get();

      const confirmed =
        db
          .prepare(
            `
            SELECT COUNT(*) AS count
            FROM registrations
            WHERE status = 'confirmed'
            `
          )
          .get();

      const activeLobbies =
        db
          .prepare(
            `
            SELECT COUNT(*) AS count
            FROM lobbies
            WHERE status = 'open'
            `
          )
          .get();

      res.json({

        pending:
          Number(
            pending.count
          ),

        confirmed:
          Number(
            confirmed.count
          ),

        activeLobbies:
          Number(
            activeLobbies.count
          )

      });

    } catch (error) {

      console.error(
        "STATS ERROR:",
        error
      );

      res.status(500).json({

        error:
          "Unable to load statistics."

      });

    }

  }
);


/* =========================================================
   CONFIRMED TEAMS
========================================================= */

app.get(
  "/api/leaderboard/teams",
  requireAdmin,
  (req, res) => {

    try {

      const lobbyName =
        clean(
          req.query.lobby
        );

      if (!lobbyName) {

        return res.status(400).json({

          error:
            "Lobby is required."

        });

      }

      const lobby =
        db
          .prepare(
            `
            SELECT *
            FROM lobbies
            WHERE name = ?
            ORDER BY id DESC
            LIMIT 1
            `
          )
          .get(
            lobbyName
          );

      if (!lobby) {

        return res.status(404).json({

          error:
            "Lobby not found."

        });

      }

      const teams =
        db
          .prepare(
            `
            SELECT
              id,
              team,
              captain,
              uid
            FROM registrations
            WHERE lobby_id = ?
              AND status = 'confirmed'
            ORDER BY id ASC
            `
          )
          .all(
            lobby.id
          );

      res.json(teams);

    } catch (error) {

      console.error(
        "LEADERBOARD TEAMS ERROR:",
        error
      );

      res.status(500).json({

        error:
          "Unable to load confirmed teams."

      });

    }

  }
);


/* =========================================================
   GET MATCH
========================================================= */

app.get(
  "/api/leaderboard/match",
  (req, res) => {

    try {

      const lobbyName =
        clean(
          req.query.lobby
        );

      const match =
        Number(
          req.query.match
        );

      if (
        !lobbyName ||
        !Number.isInteger(match) ||
        match < 1 ||
        match > 6
      ) {

        return res.status(400).json({

          error:
            "Valid lobby and match are required."

        });

      }

      const lobby =
        db
          .prepare(
            `
            SELECT *
            FROM lobbies
            WHERE name = ?
            ORDER BY id DESC
            LIMIT 1
            `
          )
          .get(
            lobbyName
          );

      if (!lobby) {

        return res.status(404).json({

          error:
            "Lobby not found."

        });

      }

      const rows =
        db
          .prepare(
            `
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
            `
          )
          .all(
            lobby.id,
            match
          );

      res.json(rows);

    } catch (error) {

      console.error(
        "GET MATCH ERROR:",
        error
      );

      res.status(500).json({

        error:
          "Unable to load match results."

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
        clean(
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
            "No score entries received."

        });

      }

      const lobby =
        db
          .prepare(
            `
            SELECT *
            FROM lobbies
            WHERE name = ?
            ORDER BY id DESC
            LIMIT 1
            `
          )
          .get(
            lobbyName
          );

      if (!lobby) {

        return res.status(404).json({

          error:
            "Lobby not found."

        });

      }

      const teams =
        db
          .prepare(
            `
            SELECT team
            FROM registrations
            WHERE lobby_id = ?
              AND status = 'confirmed'
            `
          )
          .all(
            lobby.id
          );

      const confirmedTeams =
        new Set(
          teams.map(
            row => row.team
          )
        );

      for (
        const entry
        of entries
      ) {

        if (
          !confirmedTeams.has(
            clean(
              entry.team
            )
          )
        ) {

          return res.status(400).json({

            error:
              `Team "${clean(entry.team)}" is not a confirmed team in this lobby.`

          });

        }

      }

      const positions =
        entries.map(
          entry =>
            Number(
              entry.position
            )
        );

      const uniquePositions =
        new Set(
          positions
        );

      for (
        const position
        of positions
      ) {

        if (
          !Number.isInteger(position) ||
          position < 1 ||
          position > 12
        ) {

          return res.status(400).json({

            error:
              "Positions must be between 1 and 12."

          });

        }

      }

      if (
        uniquePositions.size !==
        positions.length
      ) {

        return res.status(400).json({

          error:
            "Each team must have a unique position."

        });

      }

      const transaction =
        db.transaction(
          () => {

            db
              .prepare(
                `
                DELETE FROM match_scores
                WHERE lobby_id = ?
                  AND match_no = ?
                `
              )
              .run(
                lobby.id,
                matchNo
              );

            const insert =
              db.prepare(
                `
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
                `
              );

            for (
              const entry
              of entries
            ) {

              const team =
                clean(
                  entry.team
                );

              const position =
                Number(
                  entry.position
                );

              const kills =
                Math.max(
                  0,
                  Number(
                    entry.kills
                  ) || 0
                );

              const booyah =
                position === 1
                  ? 1
                  : 0;

              const placement =
                placementPoints(
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

                team,

                position,

                kills,

                booyah,

                placement,

                killPoints,

                total

              );

            }

          }
        );

      transaction();

      res.json({

        success: true

      });

    } catch (error) {

      console.error(
        "SAVE MATCH ERROR:",
        error
      );

      res.status(500).json({

        error:
          "Unable to save match results."

      });

    }

  }
);


/* =========================================================
   PUBLIC LEADERBOARD
========================================================= */

app.get(
  "/api/public-leaderboard",
  (req, res) => {

    try {

      const lobbyName =
        clean(
          req.query.lobby
        );

      if (!lobbyName) {

        return res.status(400).json({

          error:
            "Lobby is required."

        });

      }

      const lobby =
        db
          .prepare(
            `
            SELECT *
            FROM lobbies
            WHERE name = ?
            ORDER BY id DESC
            LIMIT 1
            `
          )
          .get(
            lobbyName
          );

      if (!lobby) {

        return res.status(404).json({

          error:
            "Lobby not found."

        });

      }

      const rows =
        db
          .prepare(
            `
            SELECT

              team,

              SUM(booyah)
                AS booyahs,

              SUM(kill_points)
                AS killPoints,

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
              team ASC
            `
          )
          .all(
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

      res.json(result);

    } catch (error) {

      console.error(
        "PUBLIC LEADERBOARD ERROR:",
        error
      );

      res.status(500).json({

        error:
          "Unable to load leaderboard."

      });

    }

  }
);


/* =========================================================
   UNKNOWN API
========================================================= */

app.use(
  "/api",
  (req, res) => {

    res.status(404).json({

      error:
        `API route not found: ${req.method} ${req.originalUrl}`

    });

  }
);


/* =========================================================
   FRONTEND FALLBACK
========================================================= */

app.get(
  "*",
  (req, res) => {

    res.sendFile(
      path.join(
        PUBLIC_DIR,
        "index.html"
      )
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

    res.status(500).json({

      error:
        "Internal server error."

    });

  }
);


/* =========================================================
   START
========================================================= */

let server;

try {

  server =
    app.listen(
      PORT,
      "0.0.0.0",
      () => {

        console.log("");
        console.log(
          "=============================================="
        );
        console.log(
          "        SCRIMFORGE V4 SERVER ONLINE"
        );
        console.log(
          "=============================================="
        );
        console.log(
          `PORT:     ${PORT}`
        );
        console.log(
          `Website:  http://localhost:${PORT}`
        );
        console.log(
          `Health:   http://localhost:${PORT}/health`
        );
        console.log(
          `Database: ${dbPath}`
        );
        console.log(
          "Session:  Better-SQLite3"
        );
        console.log(
          "=============================================="
        );
        console.log("");

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
   PROCESS ERROR HANDLERS
========================================================= */

process.on(
  "uncaughtException",
  error => {

    console.error(
      "UNCAUGHT EXCEPTION:",
      error
    );

  }
);

process.on(
  "unhandledRejection",
  error => {

    console.error(
      "UNHANDLED REJECTION:",
      error
    );

  }
);


/* =========================================================
   GRACEFUL SHUTDOWN
========================================================= */

function shutdown(signal) {

  console.log(
    `\n${signal} received. Shutting down...`
  );

  if (!server) {

    process.exit(0);

  }

  server.close(
    () => {

      try {

        db.close();

      } catch (error) {

        console.error(
          "DATABASE CLOSE ERROR:",
          error
        );

      }

      process.exit(0);

    }
  );

}


process.on(
  "SIGINT",
  () => shutdown("SIGINT")
);

process.on(
  "SIGTERM",
  () => shutdown("SIGTERM")
);
