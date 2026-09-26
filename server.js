/* =========================================================
   SCRIMFORGE V4
   SERVER.JS
   Free Fire Scrim & Tournament Management Platform
========================================================= */

"use strict";

const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const path = require("path");
const crypto = require("crypto");

const app = express();

const PORT = process.env.PORT || 3000;

const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const DB_DIR = path.join(ROOT_DIR, "data");
const DB_PATH = path.join(DB_DIR, "scrimforge.db");

const fs = require("fs");

if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

/* =========================================================
   DATABASE
========================================================= */

const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

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
    fee TEXT NOT NULL,
    time TEXT NOT NULL,
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
   EXPRESS
========================================================= */

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    store: new SQLiteStore({
      db: "sessions.sqlite",
      dir: DB_DIR
    }),

    secret:
      process.env.SESSION_SECRET ||
      "scrimforge-v4-change-this-secret-in-production",

    resave: false,
    saveUninitialized: false,

    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 24
    }
  })
);

app.use(express.static(PUBLIC_DIR));

/* =========================================================
   HELPERS
========================================================= */

function sendError(res, status, message) {
  return res.status(status).json({
    error: message
  });
}

function requireAdmin(req, res, next) {
  if (!req.session.adminId) {
    return sendError(
      res,
      401,
      "Admin login required."
    );
  }

  next();
}

function generateReference() {
  return (
    "SF-" +
    crypto
      .randomBytes(4)
      .toString("hex")
      .toUpperCase()
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

  return table[Number(position)] || 0;
}

function cleanString(value) {
  return String(value ?? "").trim();
}

function normalizeStatus(status) {
  return cleanString(status).toLowerCase();
}

/* =========================================================
   ADMIN EXISTS
========================================================= */

app.get(
  "/api/admin-exists",
  (req, res) => {
    const row = db
      .prepare(
        "SELECT COUNT(*) AS count FROM admins"
      )
      .get();

    res.json({
      exists: Number(row.count) > 0
    });
  }
);

/* =========================================================
   CURRENT USER
========================================================= */

app.get(
  "/api/me",
  (req, res) => {
    if (!req.session.adminId) {
      return res.json({
        loggedIn: false
      });
    }

    const admin = db
      .prepare(
        `
        SELECT id, name, email
        FROM admins
        WHERE id = ?
        `
      )
      .get(req.session.adminId);

    if (!admin) {
      req.session.destroy(() => {});

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
  }
);

/* =========================================================
   ADMIN SETUP
========================================================= */

app.post(
  "/api/setup-admin",
  async (req, res) => {
    try {
      const name = cleanString(req.body.name);
      const email =
        cleanString(req.body.email).toLowerCase();
      const password = String(
        req.body.password || ""
      );

      if (!name || !email || !password) {
        return sendError(
          res,
          400,
          "Name, email and password are required."
        );
      }

      const existing = db
        .prepare(
          "SELECT id FROM admins LIMIT 1"
        )
        .get();

      if (existing) {
        return sendError(
          res,
          400,
          "Admin account already exists."
        );
      }

      if (password.length < 6) {
        return sendError(
          res,
          400,
          "Password must contain at least 6 characters."
        );
      }

      const passwordHash =
        await bcrypt.hash(password, 12);

      const result = db
        .prepare(
          `
          INSERT INTO admins
          (name, email, password_hash)
          VALUES (?, ?, ?)
          `
        )
        .run(
          name,
          email,
          passwordHash
        );

      req.session.adminId =
        result.lastInsertRowid;

      res.json({
        success: true,
        name
      });
    } catch (error) {
      console.error(error);

      return sendError(
        res,
        500,
        "Unable to create admin account."
      );
    }
  }
);

/* =========================================================
   LOGIN
========================================================= */

app.post(
  "/api/login",
  async (req, res) => {
    try {
      const email =
        cleanString(req.body.email).toLowerCase();

      const password =
        String(req.body.password || "");

      if (!email || !password) {
        return sendError(
          res,
          400,
          "Email and password are required."
        );
      }

      const admin = db
        .prepare(
          `
          SELECT *
          FROM admins
          WHERE email = ?
          `
        )
        .get(email);

      if (!admin) {
        return sendError(
          res,
          401,
          "Invalid email or password."
        );
      }

      const valid =
        await bcrypt.compare(
          password,
          admin.password_hash
        );

      if (!valid) {
        return sendError(
          res,
          401,
          "Invalid email or password."
        );
      }

      req.session.adminId = admin.id;

      res.json({
        success: true,
        name: admin.name
      });
    } catch (error) {
      console.error(error);

      return sendError(
        res,
        500,
        "Login failed."
      );
    }
  }
);

/* =========================================================
   LOGOUT
========================================================= */

app.post(
  "/api/logout",
  (req, res) => {
    req.session.destroy(error => {
      if (error) {
        return sendError(
          res,
          500,
          "Logout failed."
        );
      }

      res.clearCookie("connect.sid");

      res.json({
        success: true
      });
    });
  }
);

/* =========================================================
   PUBLIC LOBBIES
========================================================= */

app.get(
  "/api/public/lobbies",
  (req, res) => {
    try {
      const rows = db
        .prepare(
          `
          SELECT
            l.id,
            l.name,
            l.time,
            l.fee,
            l.max_teams,
            l.status,

            (
              SELECT COUNT(*)
              FROM registrations r
              WHERE
                r.lobby_id = l.id
                AND r.status = 'confirmed'
            ) AS confirmed

          FROM lobbies l

          ORDER BY
            l.id DESC
          `
        )
        .all();

      res.json(rows);
    } catch (error) {
      console.error(error);

      return sendError(
        res,
        500,
        "Unable to load lobbies."
      );
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
      const rows = db
        .prepare(
          `
          SELECT
            l.*,

            (
              SELECT COUNT(*)
              FROM registrations r
              WHERE
                r.lobby_id = l.id
                AND r.status = 'confirmed'
            ) AS confirmed

          FROM lobbies l

          ORDER BY
            l.id DESC
          `
        )
        .all();

      res.json(rows);
    } catch (error) {
      console.error(error);

      return sendError(
        res,
        500,
        "Unable to load admin lobbies."
      );
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
        cleanString(req.body.name);

      const time =
        cleanString(req.body.time);

      const fee =
        cleanString(req.body.fee);

      const maxTeams =
        Number(req.body.maxTeams);

      if (!name || !time || !fee) {
        return sendError(
          res,
          400,
          "Lobby name, time and fee are required."
        );
      }

      if (
        !Number.isInteger(maxTeams) ||
        maxTeams < 1 ||
        maxTeams > 100
      ) {
        return sendError(
          res,
          400,
          "Maximum teams must be between 1 and 100."
        );
      }

      const result = db
        .prepare(
          `
          INSERT INTO lobbies
          (name, time, fee, max_teams, status)
          VALUES (?, ?, ?, ?, 'open')
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
        id: result.lastInsertRowid
      });
    } catch (error) {
      console.error(error);

      return sendError(
        res,
        500,
        "Unable to create lobby."
      );
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
        Number(req.params.id);

      if (!Number.isInteger(id)) {
        return sendError(
          res,
          400,
          "Invalid lobby ID."
        );
      }

      const lobby = db
        .prepare(
          "SELECT * FROM lobbies WHERE id = ?"
        )
        .get(id);

      if (!lobby) {
        return sendError(
          res,
          404,
          "Lobby not found."
        );
      }

      if (req.body.status !== undefined) {
        const status =
          normalizeStatus(
            req.body.status
          );

        if (
          status !== "open" &&
          status !== "closed"
        ) {
          return sendError(
            res,
            400,
            "Invalid lobby status."
          );
        }

        db.prepare(
          `
          UPDATE lobbies
          SET status = ?
          WHERE id = ?
          `
        ).run(
          status,
          id
        );
      }

      res.json({
        success: true
      });
    } catch (error) {
      console.error(error);

      return sendError(
        res,
        500,
        "Unable to update lobby."
      );
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
        Number(req.params.id);

      if (!Number.isInteger(id)) {
        return sendError(
          res,
          400,
          "Invalid lobby ID."
        );
      }

      const lobby = db
        .prepare(
          "SELECT id FROM lobbies WHERE id = ?"
        )
        .get(id);

      if (!lobby) {
        return sendError(
          res,
          404,
          "Lobby not found."
        );
      }

      db.prepare(
        "DELETE FROM lobbies WHERE id = ?"
      ).run(id);

      res.json({
        success: true
      });
    } catch (error) {
      console.error(error);

      return sendError(
        res,
        500,
        "Unable to delete lobby."
      );
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
        Number(req.body.lobbyId);

      const team =
        cleanString(req.body.team);

      const captain =
        cleanString(req.body.captain);

      const phone =
        cleanString(req.body.phone);

      const uid =
        cleanString(req.body.uid);

      if (
        !Number.isInteger(lobbyId) ||
        lobbyId <= 0
      ) {
        return sendError(
          res,
          400,
          "Please select a valid lobby."
        );
      }

      if (
        !team ||
        !captain ||
        !phone ||
        !uid
      ) {
        return sendError(
          res,
          400,
          "All registration fields are required."
        );
      }

      const lobby = db
        .prepare(
          `
          SELECT *
          FROM lobbies
          WHERE id = ?
          `
        )
        .get(lobbyId);

      if (!lobby) {
        return sendError(
          res,
          404,
          "Selected lobby was not found."
        );
      }

      if (
        normalizeStatus(lobby.status)
        !== "open"
      ) {
        return sendError(
          res,
          400,
          "This lobby is currently closed."
        );
      }

      const confirmed =
        db
          .prepare(
            `
            SELECT COUNT(*) AS count
            FROM registrations
            WHERE
              lobby_id = ?
              AND status = 'confirmed'
            `
          )
          .get(lobbyId);

      if (
        Number(confirmed.count)
        >= Number(lobby.max_teams)
      ) {
        return sendError(
          res,
          400,
          "This lobby is full."
        );
      }

      const duplicate = db
        .prepare(
          `
          SELECT id
          FROM registrations
          WHERE
            lobby_id = ?
            AND uid = ?
            AND status != 'rejected'
          LIMIT 1
          `
        )
        .get(
          lobbyId,
          uid
        );

      if (duplicate) {
        return sendError(
          res,
          400,
          "This UID is already registered in this lobby."
        );
      }

      let ref;

      do {
        ref = generateReference();

        const exists = db
          .prepare(
            `
            SELECT id
            FROM registrations
            WHERE ref = ?
            `
          )
          .get(ref);

        if (!exists) break;
      } while (true);

      db.prepare(
        `
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
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
        `
      ).run(
        ref,
        lobby.id,
        team,
        captain,
        phone,
        uid,
        lobby.fee,
        lobby.time
      );

      res.json({
        success: true,
        ref
      });
    } catch (error) {
      console.error(error);

      return sendError(
        res,
        500,
        "Unable to submit registration."
      );
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

      const row = db
        .prepare(
          `
          SELECT
            r.*,
            l.name AS lobby_name

          FROM registrations r

          LEFT JOIN lobbies l
            ON l.id = r.lobby_id

          WHERE r.ref = ?
          `
        )
        .get(ref);

      if (!row) {
        return sendError(
          res,
          404,
          "Registration reference not found."
        );
      }

      res.json({
        ref: row.ref,
        team: row.team,
        captain: row.captain,
        phone: row.phone,
        uid: row.uid,
        fee: row.fee,
        time: row.time,
        status: row.status,
        lobby_name:
          row.lobby_name || null
      });
    } catch (error) {
      console.error(error);

      return sendError(
        res,
        500,
        "Unable to check registration."
      );
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
        .prepare(
          `
          SELECT
            r.*,
            l.name AS lobby_name

          FROM registrations r

          LEFT JOIN lobbies l
            ON l.id = r.lobby_id

          ORDER BY
            r.id DESC
          `
        )
        .all();

      res.json(rows);
    } catch (error) {
      console.error(error);

      return sendError(
        res,
        500,
        "Unable to load registrations."
      );
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
        Number(req.params.id);

      const status =
        normalizeStatus(
          req.body.status
        );

      if (
        !Number.isInteger(id)
      ) {
        return sendError(
          res,
          400,
          "Invalid registration ID."
        );
      }

      if (
        ![
          "pending",
          "confirmed",
          "rejected"
        ].includes(status)
      ) {
        return sendError(
          res,
          400,
          "Invalid registration status."
        );
      }

      const registration =
        db.prepare(
          `
          SELECT *
          FROM registrations
          WHERE id = ?
          `
        ).get(id);

      if (!registration) {
        return sendError(
          res,
          404,
          "Registration not found."
        );
      }

      if (
        status === "confirmed" &&
        registration.lobby_id
      ) {
        const lobby = db
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
          const count = db
            .prepare(
              `
              SELECT COUNT(*) AS count
              FROM registrations
              WHERE
                lobby_id = ?
                AND status = 'confirmed'
                AND id != ?
              `
            )
            .get(
              lobby.id,
              id
            );

          if (
            Number(count.count)
            >= Number(lobby.max_teams)
          ) {
            return sendError(
              res,
              400,
              "This lobby is already full."
            );
          }
        }
      }

      db.prepare(
        `
        UPDATE registrations
        SET status = ?
        WHERE id = ?
        `
      ).run(
        status,
        id
      );

      res.json({
        success: true
      });
    } catch (error) {
      console.error(error);

      return sendError(
        res,
        500,
        "Unable to update registration."
      );
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
        Number(req.params.id);

      const lobbyId =
        Number(req.body.lobbyId);

      if (
        !Number.isInteger(registrationId) ||
        !Number.isInteger(lobbyId)
      ) {
        return sendError(
          res,
          400,
          "Invalid registration or lobby."
        );
      }

      const registration =
        db.prepare(
          `
          SELECT *
          FROM registrations
          WHERE id = ?
          `
        ).get(
          registrationId
        );

      if (!registration) {
        return sendError(
          res,
          404,
          "Registration not found."
        );
      }

      if (
        registration.status !==
        "confirmed"
      ) {
        return sendError(
          res,
          400,
          "Confirm the registration before assigning a lobby."
        );
      }

      const lobby =
        db.prepare(
          `
          SELECT *
          FROM lobbies
          WHERE id = ?
          `
        ).get(lobbyId);

      if (!lobby) {
        return sendError(
          res,
          404,
          "Lobby not found."
        );
      }

      const count =
        db.prepare(
          `
          SELECT COUNT(*) AS count
          FROM registrations
          WHERE
            lobby_id = ?
            AND status = 'confirmed'
            AND id != ?
          `
        ).get(
          lobbyId,
          registrationId
        );

      if (
        Number(count.count)
        >= Number(lobby.max_teams)
      ) {
        return sendError(
          res,
          400,
          "Selected lobby is full."
        );
      }

      db.prepare(
        `
        UPDATE registrations
        SET
          lobby_id = ?,
          fee = ?,
          time = ?
        WHERE id = ?
        `
      ).run(
        lobby.id,
        lobby.fee,
        lobby.time,
        registrationId
      );

      res.json({
        success: true
      });
    } catch (error) {
      console.error(error);

      return sendError(
        res,
        500,
        "Unable to assign lobby."
      );
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
        db.prepare(
          `
          SELECT COUNT(*) AS count
          FROM registrations
          WHERE status = 'pending'
          `
        ).get();

      const confirmed =
        db.prepare(
          `
          SELECT COUNT(*) AS count
          FROM registrations
          WHERE status = 'confirmed'
          `
        ).get();

      const activeLobbies =
        db.prepare(
          `
          SELECT COUNT(*) AS count
          FROM lobbies
          WHERE status = 'open'
          `
        ).get();

      res.json({
        pending:
          Number(pending.count),

        confirmed:
          Number(confirmed.count),

        activeLobbies:
          Number(activeLobbies.count)
      });
    } catch (error) {
      console.error(error);

      return sendError(
        res,
        500,
        "Unable to load statistics."
      );
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
        return sendError(
          res,
          400,
          "Lobby is required."
        );
      }

      const lobby =
        db.prepare(
          `
          SELECT *
          FROM lobbies
          WHERE name = ?
          LIMIT 1
          `
        ).get(
          lobbyName
        );

      if (!lobby) {
        return sendError(
          res,
          404,
          "Lobby not found."
        );
      }

      const teams =
        db.prepare(
          `
          SELECT
            team,
            captain,
            uid

          FROM registrations

          WHERE
            lobby_id = ?
            AND status = 'confirmed'

          ORDER BY
            id ASC
          `
        ).all(
          lobby.id
        );

      res.json(
        teams.map(row => ({
          team: row.team,
          captain: row.captain,
          uid: row.uid
        }))
      );
    } catch (error) {
      console.error(error);

      return sendError(
        res,
        500,
        "Unable to load leaderboard teams."
      );
    }
  }
);

/* =========================================================
   GET MATCH SCORES
========================================================= */

app.get(
  "/api/leaderboard/match",
  requireAdminOrPublic,
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
        return sendError(
          res,
          400,
          "Lobby is required."
        );
      }

      if (
        !Number.isInteger(matchNo) ||
        matchNo < 1 ||
        matchNo > 6
      ) {
        return sendError(
          res,
          400,
          "Match number must be between 1 and 6."
        );
      }

      const lobby =
        db.prepare(
          `
          SELECT *
          FROM lobbies
          WHERE name = ?
          LIMIT 1
          `
        ).get(
          lobbyName
        );

      if (!lobby) {
        return sendError(
          res,
          404,
          "Lobby not found."
        );
      }

      const rows =
        db.prepare(
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

          WHERE
            lobby_id = ?
            AND match_no = ?

          ORDER BY
            position ASC
          `
        ).all(
          lobby.id,
          matchNo
        );

      res.json(rows);
    } catch (error) {
      console.error(error);

      return sendError(
        res,
        500,
        "Unable to load match scores."
      );
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
    const transaction =
      db.transaction(() => {
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
          throw new Error(
            "Lobby is required."
          );
        }

        if (
          !Number.isInteger(matchNo) ||
          matchNo < 1 ||
          matchNo > 6
        ) {
          throw new Error(
            "Match number must be between 1 and 6."
          );
        }

        if (entries.length !== 12) {
          throw new Error(
            "Exactly 12 teams are required."
          );
        }

        const lobby =
          db.prepare(
            `
            SELECT *
            FROM lobbies
            WHERE name = ?
            LIMIT 1
            `
          ).get(
            lobbyName
          );

        if (!lobby) {
          throw new Error(
            "Lobby not found."
          );
        }

        const confirmedTeams =
          db.prepare(
            `
            SELECT team
            FROM registrations
            WHERE
              lobby_id = ?
              AND status = 'confirmed'
            ORDER BY id ASC
            `
          ).all(
            lobby.id
          );

        if (
          confirmedTeams.length !== 12
        ) {
          throw new Error(
            "This lobby must have exactly 12 confirmed teams."
          );
        }

        const officialTeams =
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

          if (!officialTeams.has(team)) {
            throw new Error(
              `Invalid team: ${team}`
            );
          }

          if (submittedTeams.has(team)) {
            throw new Error(
              `Duplicate team: ${team}`
            );
          }

          submittedTeams.add(team);

          if (
            !Number.isInteger(position) ||
            position < 1 ||
            position > 12
          ) {
            throw new Error(
              `Invalid position for ${team}.`
            );
          }

          if (
            !Number.isInteger(kills) ||
            kills < 0
          ) {
            throw new Error(
              `Invalid kills for ${team}.`
            );
          }
        }

        if (
          submittedTeams.size !== 12
        ) {
          throw new Error(
            "All 12 teams must be submitted."
          );
        }

        const positions =
          entries.map(
            entry =>
              Number(
                entry.position
              )
          );

        if (
          new Set(positions).size !== 12
        ) {
          throw new Error(
            "Every team must have a unique position from 1 to 12."
          );
        }

        db.prepare(
          `
          DELETE FROM match_scores
          WHERE
            lobby_id = ?
            AND match_no = ?
          `
        ).run(
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
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `
          );

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

          const booyah =
            position === 1
              ? 1
              : 0;

          const placementPoints =
            calculatePlacement(
              position
            );

          const killPoints =
            kills;

          const totalPoints =
            placementPoints +
            killPoints;

          insert.run(
            lobby.id,
            matchNo,
            team,
            position,
            kills,
            booyah,
            placementPoints,
            killPoints,
            totalPoints
          );
        }
      });

    try {
      transaction();

      res.json({
        success: true
      });
    } catch (error) {
      console.error(error);

      return sendError(
        res,
        400,
        error.message
      );
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
        return sendError(
          res,
          400,
          "Lobby is required."
        );
      }

      const lobby =
        db.prepare(
          `
          SELECT *
          FROM lobbies
          WHERE name = ?
          LIMIT 1
          `
        ).get(
          lobbyName
        );

      if (!lobby) {
        return sendError(
          res,
          404,
          "Lobby not found."
        );
      }

      const rows =
        db.prepare(
          `
          SELECT
            team,

            SUM(booyah) AS booyahs,

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
            placementPoints DESC,
            team ASC
          `
        ).all(
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

      res.json(ranked);
    } catch (error) {
      console.error(error);

      return sendError(
        res,
        500,
        "Unable to load public leaderboard."
      );
    }
  }
);

/* =========================================================
   ADMIN OR PUBLIC SCORE ACCESS
========================================================= */

function requireAdminOrPublic(
  req,
  res,
  next
) {
  next();
}

/* =========================================================
   HEALTH
========================================================= */

app.get(
  "/api/health",
  (req, res) => {
    res.json({
      ok: true,
      app: "ScrimForge V4"
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
   START SERVER
========================================================= */

app.listen(
  PORT,
  () => {
    console.log(
      `ScrimForge V4 running on port ${PORT}`
    );
  }
);

/* =========================================================
   CLEAN SHUTDOWN
========================================================= */

function shutdown() {
  console.log(
    "Shutting down ScrimForge V4..."
  );

  db.close();

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
