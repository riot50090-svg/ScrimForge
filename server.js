/* =========================================================
   SCRIMFORGE V4
   SERVER.JS
   Complete backend for V4 frontend
   ========================================================= */

"use strict";

const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const app = express();

const PORT = process.env.PORT || 3000;

/* =========================================================
   DIRECTORIES
========================================================= */

const DATA_DIR = path.join(__dirname, "data");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH =
  process.env.DB_PATH ||
  path.join(DATA_DIR, "scrimforge.db");

const SESSION_DIR = DATA_DIR;

const SESSION_DB =
  process.env.SESSION_DB ||
  "sessions.sqlite";


/* =========================================================
   DATABASE
========================================================= */

const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
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

  CREATE TABLE IF NOT EXISTS registrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ref TEXT NOT NULL UNIQUE,
    lobby_id INTEGER,
    time TEXT NOT NULL,
    fee TEXT NOT NULL,
    team TEXT NOT NULL,
    captain TEXT NOT NULL,
    phone TEXT NOT NULL,
    uid TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lobby_id INTEGER NOT NULL,
    match_no INTEGER NOT NULL,
    team TEXT NOT NULL,
    position INTEGER NOT NULL,
    kills INTEGER NOT NULL DEFAULT 0,
    placement_points INTEGER NOT NULL DEFAULT 0,
    kill_points INTEGER NOT NULL DEFAULT 0,
    total_points INTEGER NOT NULL DEFAULT 0,
    booyah INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    UNIQUE(lobby_id, match_no, team)
  );
`);


/* =========================================================
   MIGRATION SAFETY
========================================================= */

function columnExists(table, column) {
  const columns = db
    .prepare(`PRAGMA table_info(${table})`)
    .all();

  return columns.some(
    c => c.name === column
  );
}

try {

  if (
    !columnExists(
      "registrations",
      "lobby_id"
    )
  ) {
    db.exec(`
      ALTER TABLE registrations
      ADD COLUMN lobby_id INTEGER
    `);
  }

} catch (error) {
  console.error(
    "Registration migration error:",
    error
  );
}


/* =========================================================
   EXPRESS
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
      db: SESSION_DB,
      dir: SESSION_DIR
    }),

    secret:
      process.env.SESSION_SECRET ||
      "scrimforge-v4-session-secret-change-this",

    resave: false,

    saveUninitialized: false,

    rolling: true,

    cookie: {

      httpOnly: true,

      sameSite: "lax",

      secure:
        process.env.NODE_ENV ===
        "production",

      maxAge:
        1000 *
        60 *
        60 *
        12
    }

  })
);


/* =========================================================
   STATIC FRONTEND
========================================================= */

app.use(
  express.static(__dirname)
);


/* =========================================================
   HELPERS
========================================================= */

function now() {
  return new Date().toISOString();
}


function makeRef() {

  return (
    "SF-" +
    Math.random()
      .toString(36)
      .substring(2, 10)
      .toUpperCase()
  );
}


function getLobbyById(id) {

  return db
    .prepare(
      "SELECT * FROM lobbies WHERE id = ?"
    )
    .get(Number(id));

}


function getLobbyByName(name) {

  return db
    .prepare(
      "SELECT * FROM lobbies WHERE name = ?"
    )
    .get(String(name));

}


function confirmedCount(lobbyId) {

  return db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM registrations
      WHERE lobby_id = ?
      AND status = 'confirmed'
    `)
    .get(Number(lobbyId))
    .count;

}


function publicLobby(lobby) {

  return {

    id: lobby.id,

    name: lobby.name,

    time: lobby.time,

    fee: lobby.fee,

    max_teams:
      Number(lobby.max_teams),

    status: lobby.status,

    confirmed:
      Number(
        confirmedCount(lobby.id)
      )

  };

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
    ] || 0
  );
}


/* =========================================================
   ADMIN AUTH
========================================================= */

function requireAdmin(
  req,
  res,
  next
) {

  if (
    !req.session ||
    !req.session.adminId
  ) {

    return res
      .status(401)
      .json({
        error:
          "Admin login required."
      });

  }

  next();

}


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
            "SELECT id FROM admins LIMIT 1"
          )
          .get();

      res.json({
        exists: !!row
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
            "Could not check admin account."
        });

    }

  }
);


/* =========================================================
   CURRENT USER
========================================================= */

app.get(
  "/api/me",
  (req, res) => {

    res.json({

      loggedIn:
        !!(
          req.session &&
          req.session.adminId
        ),

      name:
        req.session
          ? req.session.adminName ||
            null
          : null

    });

  }
);


/* =========================================================
   CREATE FIRST ADMIN
========================================================= */

app.post(
  "/api/setup-admin",
  async (req, res) => {

    try {

      const count =
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM admins"
          )
          .get()
          .count;

      if (Number(count) > 0) {

        return res
          .status(403)
          .json({
            error:
              "Admin already exists."
          });

      }

      const name =
        String(
          req.body.name || ""
        ).trim();

      const email =
        String(
          req.body.email || ""
        )
          .trim()
          .toLowerCase();

      const password =
        String(
          req.body.password || ""
        );

      if (
        !name ||
        !email ||
        !password ||
        password.length < 6
      ) {

        return res
          .status(400)
          .json({
            error:
              "Name, email and a password of at least 6 characters are required."
          });

      }

      const passwordHash =
        await bcrypt.hash(
          password,
          12
        );

      const result =
        db
          .prepare(`
            INSERT INTO admins
            (
              name,
              email,
              password_hash,
              created_at
            )
            VALUES (?, ?, ?, ?)
          `)
          .run(
            name,
            email,
            passwordHash,
            now()
          );


      /*
        IMPORTANT SESSION FIX

        Regenerate session before
        storing administrator identity.
      */

      req.session.regenerate(
        (sessionError) => {

          if (sessionError) {

            console.error(
              "Setup session regenerate error:",
              sessionError
            );

            return res
              .status(500)
              .json({
                error:
                  "Admin created, but login session could not be created."
              });

          }

          req.session.adminId =
            Number(
              result.lastInsertRowid
            );

          req.session.adminName =
            name;


          req.session.save(
            (saveError) => {

              if (saveError) {

                console.error(
                  "Setup session save error:",
                  saveError
                );

                return res
                  .status(500)
                  .json({
                    error:
                      "Admin created, but login session could not be saved."
                  });

              }

              return res.json({

                ok: true,

                name

              });

            }
          );

        }
      );

    } catch (error) {

      console.error(
        "Setup admin error:",
        error
      );

      res
        .status(500)
        .json({
          error:
            "Could not create admin account."
        });

    }

  }
);


/* =========================================================
   ADMIN LOGIN
========================================================= */

app.post(
  "/api/login",
  async (req, res) => {

    try {

      const email =
        String(
          req.body.email || ""
        )
          .trim()
          .toLowerCase();

      const password =
        String(
          req.body.password || ""
        );


      if (!email || !password) {

        return res
          .status(400)
          .json({
            error:
              "Email and password are required."
          });

      }


      const admin =
        db
          .prepare(`
            SELECT *
            FROM admins
            WHERE email = ?
            LIMIT 1
          `)
          .get(email);


      if (!admin) {

        return res
          .status(401)
          .json({
            error:
              "Incorrect email or password."
          });

      }


      const valid =
        await bcrypt.compare(
          password,
          admin.password_hash
        );


      if (!valid) {

        return res
          .status(401)
          .json({
            error:
              "Incorrect email or password."
          });

      }


      /*
        =====================================================
        CRITICAL LOGIN FIX
        =====================================================

        Regenerate the session so an old/broken
        session cannot interfere with login.
      */

      req.session.regenerate(
        (sessionError) => {

          if (sessionError) {

            console.error(
              "LOGIN SESSION REGENERATE ERROR:",
              sessionError
            );

            return res
              .status(500)
              .json({
                error:
                  "Login session could not be created."
              });

          }


          req.session.adminId =
            Number(admin.id);

          req.session.adminName =
            String(admin.name);


          /*
            Explicitly save the session before
            sending the successful response.
          */

          req.session.save(
            (saveError) => {

              if (saveError) {

                console.error(
                  "LOGIN SESSION SAVE ERROR:",
                  saveError
                );

                return res
                  .status(500)
                  .json({
                    error:
                      "Login session could not be saved."
                  });

              }


              console.log(
                `Admin login successful: ${admin.email}`
              );


              return res.json({

                ok: true,

                name:
                  admin.name

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
            "Server error during login."
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
        ok: true
      });

    }

    req.session.destroy(
      (error) => {

        if (error) {

          console.error(
            "Logout error:",
            error
          );

          return res
            .status(500)
            .json({
              error:
                "Could not log out."
            });

        }

        res.clearCookie(
          "connect.sid"
        );

        res.json({
          ok: true
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

      const lobbies =
        db
          .prepare(`
            SELECT *
            FROM lobbies
            ORDER BY id DESC
          `)
          .all();

      res.json(
        lobbies.map(
          publicLobby
        )
      );

    } catch (error) {

      console.error(
        "Public lobby error:",
        error
      );

      res
        .status(500)
        .json({
          error:
            "Could not load public lobbies."
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

      const lobbies =
        db
          .prepare(`
            SELECT *
            FROM lobbies
            ORDER BY id DESC
          `)
          .all();

      res.json(
        lobbies.map(
          lobby => ({

            id: lobby.id,

            name: lobby.name,

            time: lobby.time,

            fee: lobby.fee,

            max_teams:
              Number(
                lobby.max_teams
              ),

            status:
              lobby.status,

            confirmed:
              Number(
                confirmedCount(
                  lobby.id
                )
              ),

            created_at:
              lobby.created_at

          })
        )
      );

    } catch (error) {

      console.error(
        "Admin lobby error:",
        error
      );

      res
        .status(500)
        .json({
          error:
            "Could not load lobbies."
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
        String(
          req.body.name || ""
        ).trim();

      const time =
        String(
          req.body.time || ""
        ).trim();

      const fee =
        String(
          req.body.fee || ""
        ).trim();

      const maxTeams =
        Number(
          req.body.maxTeams
        );


      if (
        !name ||
        !time ||
        !fee ||
        !Number.isInteger(maxTeams) ||
        maxTeams < 1 ||
        maxTeams > 100
      ) {

        return res
          .status(400)
          .json({
            error:
              "Please provide valid lobby details."
          });

      }


      const result =
        db
          .prepare(`
            INSERT INTO lobbies
            (
              name,
              time,
              fee,
              max_teams,
              status,
              created_at
            )
            VALUES (?, ?, ?, ?, 'open', ?)
          `)
          .run(
            name,
            time,
            fee,
            maxTeams,
            now()
          );


      res.json({

        ok: true,

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

      res
        .status(500)
        .json({
          error:
            "Could not create lobby."
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

      const lobby =
        getLobbyById(
          req.params.id
        );

      if (!lobby) {

        return res
          .status(404)
          .json({
            error:
              "Lobby not found."
          });

      }


      const status =
        String(
          req.body.status || ""
        ).toLowerCase();


      if (
        !["open", "closed"]
          .includes(status)
      ) {

        return res
          .status(400)
          .json({
            error:
              "Invalid lobby status."
          });

      }


      db
        .prepare(`
          UPDATE lobbies
          SET status = ?
          WHERE id = ?
        `)
        .run(
          status,
          lobby.id
        );


      res.json({
        ok: true
      });

    } catch (error) {

      console.error(
        "Update lobby error:",
        error
      );

      res
        .status(500)
        .json({
          error:
            "Could not update lobby."
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

      const lobbyId =
        Number(
          req.params.id
        );

      const lobby =
        getLobbyById(
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


      const transaction =
        db.transaction(
          () => {

            db
              .prepare(`
                DELETE FROM scores
                WHERE lobby_id = ?
              `)
              .run(
                lobbyId
              );


            db
              .prepare(`
                UPDATE registrations
                SET lobby_id = NULL
                WHERE lobby_id = ?
              `)
              .run(
                lobbyId
              );


            db
              .prepare(`
                DELETE FROM lobbies
                WHERE id = ?
              `)
              .run(
                lobbyId
              );

          }
        );


      transaction();


      res.json({
        ok: true
      });

    } catch (error) {

      console.error(
        "Delete lobby error:",
        error
      );

      res
        .status(500)
        .json({
          error:
            "Could not delete lobby."
        });

    }

  }
);


/* =========================================================
   REGISTRATION
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
        String(
          req.body.team || ""
        ).trim();

      const captain =
        String(
          req.body.captain || ""
        ).trim();

      const phone =
        String(
          req.body.phone || ""
        ).trim();

      const uid =
        String(
          req.body.uid || ""
        ).trim();


      if (
        !lobbyId ||
        !team ||
        !captain ||
        !phone ||
        !uid
      ) {

        return res
          .status(400)
          .json({
            error:
              "All fields are required."
          });

      }


      const lobby =
        getLobbyById(
          lobbyId
        );


      if (!lobby) {

        return res
          .status(404)
          .json({
            error:
              "Selected lobby does not exist."
          });

      }


      if (
        String(
          lobby.status
        ).toLowerCase() !==
        "open"
      ) {

        return res
          .status(400)
          .json({
            error:
              "This lobby is closed."
          });

      }


      const confirmed =
        Number(
          confirmedCount(
            lobbyId
          )
        );


      if (
        confirmed >=
        Number(
          lobby.max_teams
        )
      ) {

        return res
          .status(400)
          .json({
            error:
              "This lobby is full."
          });

      }


      let ref;

      do {

        ref = makeRef();

      } while (
        db
          .prepare(
            "SELECT id FROM registrations WHERE ref = ?"
          )
          .get(ref)
      );


      const result =
        db
          .prepare(`
            INSERT INTO registrations
            (
              ref,
              lobby_id,
              time,
              fee,
              team,
              captain,
              phone,
              uid,
              status,
              created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
          `)
          .run(
            ref,
            lobbyId,
            lobby.time,
            lobby.fee,
            team,
            captain,
            phone,
            uid,
            now()
          );


      res.json({

        ok: true,

        ref,

        id:
          Number(
            result.lastInsertRowid
          )

      });

    } catch (error) {

      console.error(
        "Registration error:",
        error
      );

      res
        .status(500)
        .json({
          error:
            "Could not save registration."
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
          .prepare(`
            SELECT
              r.*,
              l.name AS lobby_name
            FROM registrations r
            LEFT JOIN lobbies l
              ON l.id = r.lobby_id
            ORDER BY r.id DESC
          `)
          .all();

      res.json(
        rows.map(
          row => ({

            id: row.id,

            ref: row.ref,

            lobby_id:
              row.lobby_id,

            lobby_name:
              row.lobby_name ||
              null,

            time:
              row.time,

            fee:
              row.fee,

            team:
              row.team,

            captain:
              row.captain,

            phone:
              row.phone,

            uid:
              row.uid,

            status:
              row.status,

            created_at:
              row.created_at

          })
        )
      );

    } catch (error) {

      console.error(
        "Registrations error:",
        error
      );

      res
        .status(500)
        .json({
          error:
            "Could not load registrations."
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

      const row =
        db
          .prepare(`
            SELECT
              r.*,
              l.name AS lobby_name
            FROM registrations r
            LEFT JOIN lobbies l
              ON l.id = r.lobby_id
            WHERE r.ref = ?
            LIMIT 1
          `)
          .get(
            req.params.ref
          );


      if (!row) {

        return res
          .status(404)
          .json({
            error:
              "Registration reference not found."
          });

      }


      res.json({

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
          row.lobby_name ||
          null

      });

    } catch (error) {

      console.error(
        "Status error:",
        error
      );

      res
        .status(500)
        .json({
          error:
            "Could not check registration status."
        });

    }

  }
);


/* =========================================================
   UPDATE REGISTRATION STATUS
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
        String(
          req.body.status || ""
        ).toLowerCase();


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
        db
          .prepare(`
            SELECT *
            FROM registrations
            WHERE id = ?
          `)
          .get(id);


      if (!registration) {

        return res
          .status(404)
          .json({
            error:
              "Registration not found."
          });

      }


      if (
        status === "confirmed"
      ) {

        if (
          !registration.lobby_id
        ) {

          return res
            .status(400)
            .json({
              error:
                "Assign a lobby before confirming this registration."
            });

        }


        const lobby =
          getLobbyById(
            registration.lobby_id
          );


        if (!lobby) {

          return res
            .status(400)
            .json({
              error:
                "Assigned lobby no longer exists."
            });

        }


        const confirmed =
          confirmedCount(
            lobby.id
          );


        if (
          registration.status !==
            "confirmed" &&
          confirmed >=
            Number(
              lobby.max_teams
            )
        ) {

          return res
            .status(400)
            .json({
              error:
                "This lobby is already full."
            });

        }

      }


      db
        .prepare(`
          UPDATE registrations
          SET status = ?
          WHERE id = ?
        `)
        .run(
          status,
          id
        );


      res.json({
        ok: true
      });

    } catch (error) {

      console.error(
        "Registration update error:",
        error
      );

      res
        .status(500)
        .json({
          error:
            "Could not update registration."
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


      const registration =
        db
          .prepare(`
            SELECT *
            FROM registrations
            WHERE id = ?
          `)
          .get(
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


      const lobby =
        getLobbyById(
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


      if (
        registration.status !==
        "confirmed"
      ) {

        return res
          .status(400)
          .json({
            error:
              "Confirm the registration first."
          });

      }


      const confirmed =
        confirmedCount(
          lobbyId
        );


      if (
        registration.lobby_id !==
          lobbyId &&
        confirmed >=
          Number(
            lobby.max_teams
          )
      ) {

        return res
          .status(400)
          .json({
            error:
              "This lobby is full."
          });

      }


      db
        .prepare(`
          UPDATE registrations
          SET
            lobby_id = ?,
            time = ?,
            fee = ?
          WHERE id = ?
        `)
        .run(
          lobbyId,
          lobby.time,
          lobby.fee,
          registrationId
        );


      res.json({
        ok: true
      });

    } catch (error) {

      console.error(
        "Assign lobby error:",
        error
      );

      res
        .status(500)
        .json({
          error:
            "Could not assign lobby."
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
        db
          .prepare(`
            SELECT COUNT(*) AS count
            FROM registrations
            WHERE status = 'pending'
          `)
          .get()
          .count;


      const confirmed =
        db
          .prepare(`
            SELECT COUNT(*) AS count
            FROM registrations
            WHERE status = 'confirmed'
          `)
          .get()
          .count;


      const activeLobbies =
        db
          .prepare(`
            SELECT COUNT(*) AS count
            FROM lobbies
            WHERE status = 'open'
          `)
          .get()
          .count;


      res.json({

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

      res
        .status(500)
        .json({
          error:
            "Could not load statistics."
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
        String(
          req.query.lobby || ""
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
        getLobbyByName(
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
        db
          .prepare(`
            SELECT
              team,
              id
            FROM registrations
            WHERE lobby_id = ?
            AND status = 'confirmed'
            ORDER BY id ASC
          `)
          .all(
            lobby.id
          );


      res.json(
        teams.map(
          row => ({
            team:
              row.team
          })
        )
      );

    } catch (error) {

      console.error(
        "Leaderboard teams error:",
        error
      );

      res
        .status(500)
        .json({
          error:
            "Could not load leaderboard teams."
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
        String(
          req.body.lobby || ""
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


      if (
        !lobbyName ||
        !Number.isInteger(
          matchNo
        ) ||
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


      if (!entries.length) {

        return res
          .status(400)
          .json({
            error:
              "No score entries received."
          });

      }


      const lobby =
        getLobbyByName(
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
        db
          .prepare(`
            SELECT team
            FROM registrations
            WHERE lobby_id = ?
            AND status = 'confirmed'
          `)
          .all(
            lobby.id
          )
          .map(
            row =>
              String(row.team)
          );


      if (
        confirmedTeams.length !==
        Number(lobby.max_teams)
      ) {

        return res
          .status(400)
          .json({
            error:
              `This lobby currently has ${confirmedTeams.length}/${lobby.max_teams} confirmed teams.`
          });

      }


      const submittedTeams =
        entries.map(
          entry =>
            String(
              entry.team || ""
            )
        );


      const uniqueTeams =
        new Set(
          submittedTeams
        );


      if (
        uniqueTeams.size !==
        submittedTeams.length
      ) {

        return res
          .status(400)
          .json({
            error:
              "Duplicate teams were submitted."
          });

      }


      const transaction =
        db.transaction(
          () => {

            const deleteExisting =
              db.prepare(`
                DELETE FROM scores
                WHERE lobby_id = ?
                AND match_no = ?
              `);


            deleteExisting.run(
              lobby.id,
              matchNo
            );


            const insert =
              db.prepare(`
                INSERT INTO scores
                (
                  lobby_id,
                  match_no,
                  team,
                  position,
                  kills,
                  placement_points,
                  kill_points,
                  total_points,
                  booyah,
                  created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              `);


            for (
              const entry
              of entries
            ) {

              const team =
                String(
                  entry.team || ""
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


              if (
                !team ||
                !Number.isInteger(
                  position
                ) ||
                position < 1 ||
                position > 12
              ) {

                throw new Error(
                  "Invalid team position."
                );

              }


              const placement =
                placementPoints(
                  position
                );


              const killPoints =
                kills;


              const total =
                placement +
                killPoints;


              const booyah =
                position === 1
                  ? 1
                  : 0;


              insert.run(

                lobby.id,

                matchNo,

                team,

                position,

                kills,

                placement,

                killPoints,

                total,

                booyah,

                now()

              );

            }

          }
        );


      transaction();


      res.json({
        ok: true
      });

    } catch (error) {

      console.error(
        "Save match error:",
        error
      );

      res
        .status(500)
        .json({
          error:
            error.message ||
            "Could not save match."
        });

    }

  }
);


/* =========================================================
   GET MATCH LEADERBOARD
========================================================= */

app.get(
  "/api/leaderboard/match",
  (req, res) => {

    try {

      const lobbyName =
        String(
          req.query.lobby || ""
        );

      const matchNo =
        Number(
          req.query.match
        );


      if (
        !lobbyName ||
        !Number.isInteger(
          matchNo
        )
      ) {

        return res
          .status(400)
          .json({
            error:
              "Lobby and match are required."
          });

      }


      const lobby =
        getLobbyByName(
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
        db
          .prepare(`
            SELECT
              team,
              position,
              kills,
              placement_points,
              kill_points,
              total_points,
              booyah
            FROM scores
            WHERE lobby_id = ?
            AND match_no = ?
            ORDER BY position ASC
          `)
          .all(
            lobby.id,
            matchNo
          );


      res.json(
        rows
      );

    } catch (error) {

      console.error(
        "Match leaderboard error:",
        error
      );

      res
        .status(500)
        .json({
          error:
            "Could not load match leaderboard."
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
        String(
          req.query.lobby || ""
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
        getLobbyByName(
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
        db
          .prepare(`
            SELECT
              team,

              SUM(
                CASE
                  WHEN booyah = 1
                  THEN 1
                  ELSE 0
                END
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

            FROM scores

            WHERE lobby_id = ?

            GROUP BY team

            ORDER BY
              totalPoints DESC,
              killPoints DESC,
              booyahs DESC,
              team ASC
          `)
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


      res.json(
        result
      );

    } catch (error) {

      console.error(
        "Public leaderboard error:",
        error
      );

      res
        .status(500)
        .json({
          error:
            "Could not load public leaderboard."
        });

    }

  }
);


/* =========================================================
   HEALTH CHECK
========================================================= */

app.get(
  "/api/health",
  (req, res) => {

    res.json({

      ok: true,

      service:
        "ScrimForge V4",

      database:
        "connected",

      time:
        now()

    });

  }
);


/* =========================================================
   SPA FALLBACK
========================================================= */

app.get(
  "*",
  (req, res, next) => {

    if (
      req.path.startsWith(
        "/api/"
      )
    ) {

      return res
        .status(404)
        .json({
          error:
            "API endpoint not found."
        });

    }


    res.sendFile(
      path.join(
        __dirname,
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
      "Unhandled server error:",
      error
    );

    if (res.headersSent) {
      return next(error);
    }

    res
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

app.listen(
  PORT,
  () => {

    console.log(
      "======================================"
    );

    console.log(
      "ScrimForge V4 server started"
    );

    console.log(
      `http://localhost:${PORT}`
    );

    console.log(
      `Database: ${DB_PATH}`
    );

    console.log(
      "======================================"

    );

  }
);
