const express = require("express");
const path = require("path");
const Database = require("better-sqlite3");
const bcrypt = require("bcrypt");
const session = require("express-session");

const app = express();

const PORT = process.env.PORT || 3000;

const db = new Database("scrimforge.db");

db.pragma("foreign_keys = ON");

app.use(express.json());

app.use(
  session({
    secret:
      process.env.SESSION_SECRET ||
      "scrimforge-change-this-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: 1000 * 60 * 60 * 24
    }
  })
);

app.use(express.static(path.join(__dirname, "public")));


/* =========================================================
   DATABASE
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
    time TEXT NOT NULL,
    fee TEXT NOT NULL,
    team TEXT NOT NULL,
    captain TEXT NOT NULL,
    phone TEXT NOT NULL,
    uid TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    lobby_id INTEGER,
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
    placement_points INTEGER NOT NULL DEFAULT 0,
    kill_points INTEGER NOT NULL DEFAULT 0,
    total_points INTEGER NOT NULL DEFAULT 0,

    UNIQUE(lobby_id, match_no, team),

    FOREIGN KEY (lobby_id)
      REFERENCES lobbies(id)
      ON DELETE CASCADE
  );
`);


/* =========================================================
   PLACEMENT POINTS
========================================================= */

function getPlacementPoints(position) {
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

  return table[position] || 0;
}


/* =========================================================
   HELPERS
========================================================= */

function generateReference() {
  const timestamp = Date.now();
  const random =
    Math.floor(1000 + Math.random() * 9000);

  return `SF-${timestamp}-${random}`;
}


function requireAdmin(req, res, next) {
  if (!req.session.adminId) {
    return res.status(401).json({
      error: "Admin login required."
    });
  }

  next();
}


/* =========================================================
   ADMIN EXISTS
========================================================= */

app.get("/api/admin-exists", (req, res) => {
  const row =
    db.prepare(
      "SELECT COUNT(*) AS count FROM admins"
    ).get();

  res.json({
    exists: row.count > 0
  });
});


/* =========================================================
   CURRENT ADMIN
========================================================= */

app.get("/api/me", (req, res) => {
  if (!req.session.adminId) {
    return res.json({
      loggedIn: false
    });
  }

  const admin =
    db.prepare(
      "SELECT id, name, email FROM admins WHERE id = ?"
    ).get(req.session.adminId);

  if (!admin) {
    req.session.destroy(() => {});

    return res.json({
      loggedIn: false
    });
  }

  res.json({
    loggedIn: true,
    name: admin.name,
    email: admin.email
  });
});


/* =========================================================
   CREATE FIRST ADMIN
========================================================= */

app.post("/api/setup-admin", async (req, res) => {
  try {
    const existing =
      db.prepare(
        "SELECT COUNT(*) AS count FROM admins"
      ).get();

    if (existing.count > 0) {
      return res.status(400).json({
        error: "Admin account already exists."
      });
    }

    const {
      name,
      email,
      password
    } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        error: "Name, email and password are required."
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        error: "Password must be at least 6 characters."
      });
    }

    const passwordHash =
      await bcrypt.hash(password, 12);

    const result =
      db.prepare(`
        INSERT INTO admins
        (name, email, password_hash)
        VALUES (?, ?, ?)
      `).run(
        name.trim(),
        email.trim().toLowerCase(),
        passwordHash
      );

    req.session.adminId =
      result.lastInsertRowid;

    res.json({
      success: true,
      name: name.trim()
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Could not create admin."
    });
  }
});


/* =========================================================
   LOGIN
========================================================= */

app.post("/api/login", async (req, res) => {
  try {
    const {
      email,
      password
    } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: "Email and password are required."
      });
    }

    const admin =
      db.prepare(
        "SELECT * FROM admins WHERE email = ?"
      ).get(
        email.trim().toLowerCase()
      );

    if (!admin) {
      return res.status(401).json({
        error: "Invalid email or password."
      });
    }

    const valid =
      await bcrypt.compare(
        password,
        admin.password_hash
      );

    if (!valid) {
      return res.status(401).json({
        error: "Invalid email or password."
      });
    }

    req.session.adminId =
      admin.id;

    res.json({
      success: true,
      name: admin.name
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Login failed."
    });
  }
});


/* =========================================================
   LOGOUT
========================================================= */

app.post(
  "/api/logout",
  requireAdmin,
  (req, res) => {

    req.session.destroy(error => {
      if (error) {
        return res.status(500).json({
          error: "Logout failed."
        });
      }

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

    const lobbies =
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

    res.json(lobbies);
  }
);


/* =========================================================
   ADMIN LOBBIES
========================================================= */

app.get(
  "/api/lobbies",
  requireAdmin,
  (req, res) => {

    const lobbies =
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

    res.json(lobbies);
  }
);


/* =========================================================
   CREATE LOBBY
========================================================= */

app.post(
  "/api/lobbies",
  requireAdmin,
  (req, res) => {

    const {
      name,
      time,
      fee,
      maxTeams
    } = req.body;

    if (
      !name ||
      !time ||
      !fee ||
      !maxTeams
    ) {
      return res.status(400).json({
        error:
          "Lobby name, time, fee and maximum teams are required."
      });
    }

    const max =
      Number(maxTeams);

    if (
      !Number.isInteger(max) ||
      max < 1
    ) {
      return res.status(400).json({
        error:
          "Maximum teams must be a valid number."
      });
    }

    const result =
      db.prepare(`
        INSERT INTO lobbies
        (name, time, fee, max_teams, status)
        VALUES (?, ?, ?, ?, 'open')
      `).run(
        name.trim(),
        time.trim(),
        fee.trim(),
        max
      );

    res.json({
      success: true,
      id: result.lastInsertRowid
    });
  }
);


/* =========================================================
   OPEN / CLOSE LOBBY
========================================================= */

app.patch(
  "/api/lobbies/:id",
  requireAdmin,
  (req, res) => {

    const id =
      Number(req.params.id);

    const {
      status
    } = req.body;

    if (
      status !== "open" &&
      status !== "closed"
    ) {
      return res.status(400).json({
        error: "Invalid lobby status."
      });
    }

    const lobby =
      db.prepare(
        "SELECT id FROM lobbies WHERE id = ?"
      ).get(id);

    if (!lobby) {
      return res.status(404).json({
        error: "Lobby not found."
      });
    }

    db.prepare(
      "UPDATE lobbies SET status = ? WHERE id = ?"
    ).run(status, id);

    res.json({
      success: true
    });
  }
);


/* =========================================================
   NEW FEATURE:
   DELETE ANY LOBBY
========================================================= */

app.delete(
  "/api/lobbies/:id",
  requireAdmin,
  (req, res) => {

    const id =
      Number(req.params.id);

    if (!Number.isInteger(id)) {
      return res.status(400).json({
        error: "Invalid lobby ID."
      });
    }

    const lobby =
      db.prepare(`
        SELECT
          id,
          name,
          status
        FROM lobbies
        WHERE id = ?
      `).get(id);

    if (!lobby) {
      return res.status(404).json({
        error: "Lobby not found."
      });
    }

    const deleteLobby =
      db.transaction(() => {

        /*
          Registrations are preserved.

          Their lobby assignment is removed
          before deleting the lobby.
        */

        db.prepare(`
          UPDATE registrations
          SET lobby_id = NULL
          WHERE lobby_id = ?
        `).run(id);

        /*
          Delete all match scores belonging
          to this lobby.
        */

        db.prepare(`
          DELETE FROM match_scores
          WHERE lobby_id = ?
        `).run(id);

        /*
          Finally delete the lobby.
        */

        db.prepare(`
          DELETE FROM lobbies
          WHERE id = ?
        `).run(id);
      });

    try {

      deleteLobby();

      res.json({
        success: true,
        message:
          `Lobby "${lobby.name}" deleted successfully.`
      });

    } catch (error) {

      console.error(error);

      res.status(500).json({
        error:
          "Could not delete the lobby."
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
        error:
          "All registration fields are required."
      });
    }

    const ref =
      generateReference();

    const result =
      db.prepare(`
        INSERT INTO registrations
        (
          ref,
          time,
          fee,
          team,
          captain,
          phone,
          uid,
          status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
      `).run(
        ref,
        time.trim(),
        fee.trim(),
        team.trim(),
        captain.trim(),
        phone.trim(),
        uid.trim()
      );

    res.json({
      success: true,
      id: result.lastInsertRowid,
      ref
    });
  }
);


/* =========================================================
   REGISTRATION STATUS
========================================================= */

app.get(
  "/api/registration-status/:ref",
  (req, res) => {

    const ref =
      req.params.ref;

    const row =
      db.prepare(`
        SELECT
          r.ref,
          r.team,
          r.time,
          r.fee,
          r.status,
          l.name AS lobby_name
        FROM registrations r
        LEFT JOIN lobbies l
          ON l.id = r.lobby_id
        WHERE r.ref = ?
      `).get(ref);

    if (!row) {
      return res.status(404).json({
        error:
          "Registration reference not found."
      });
    }

    res.json(row);
  }
);


/* =========================================================
   ADMIN REGISTRATIONS
========================================================= */

app.get(
  "/api/registrations",
  requireAdmin,
  (req, res) => {

    const rows =
      db.prepare(`
        SELECT
          r.*,
          l.name AS lobby_name
        FROM registrations r
        LEFT JOIN lobbies l
          ON l.id = r.lobby_id
        ORDER BY r.id DESC
      `).all();

    res.json(rows);
  }
);


/* =========================================================
   UPDATE REGISTRATION STATUS
========================================================= */

app.patch(
  "/api/registrations/:id",
  requireAdmin,
  (req, res) => {

    const id =
      Number(req.params.id);

    const {
      status
    } = req.body;

    if (
      status !== "pending" &&
      status !== "confirmed" &&
      status !== "rejected"
    ) {
      return res.status(400).json({
        error: "Invalid registration status."
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

    db.prepare(`
      UPDATE registrations
      SET status = ?
      WHERE id = ?
    `).run(
      status,
      id
    );

    res.json({
      success: true
    });
  }
);


/* =========================================================
   ASSIGN REGISTRATION TO LOBBY
========================================================= */

app.patch(
  "/api/registrations/:id/lobby",
  requireAdmin,
  (req, res) => {

    const registrationId =
      Number(req.params.id);

    const lobbyId =
      Number(req.body.lobbyId);

    if (
      !Number.isInteger(registrationId) ||
      !Number.isInteger(lobbyId)
    ) {
      return res.status(400).json({
        error: "Invalid registration or lobby."
      });
    }

    const registration =
      db.prepare(`
        SELECT *
        FROM registrations
        WHERE id = ?
      `).get(registrationId);

    if (!registration) {
      return res.status(404).json({
        error:
          "Registration not found."
      });
    }

    if (registration.status !== "confirmed") {
      return res.status(400).json({
        error:
          "Registration must be confirmed first."
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
        error: "Lobby not found."
      });
    }

    if (lobby.status !== "open") {
      return res.status(400).json({
        error:
          "This lobby is closed."
      });
    }

    const confirmed =
      db.prepare(`
        SELECT COUNT(*) AS count
        FROM registrations
        WHERE lobby_id = ?
          AND status = 'confirmed'
      `).get(lobbyId).count;

    /*
      If this registration is already in
      this lobby, don't count it twice.
    */

    if (
      Number(registration.lobby_id) !==
      lobbyId &&
      confirmed >= lobby.max_teams
    ) {
      return res.status(400).json({
        error:
          "This lobby is already full."
      });
    }

    db.prepare(`
      UPDATE registrations
      SET lobby_id = ?
      WHERE id = ?
    `).run(
      lobbyId,
      registrationId
    );

    res.json({
      success: true
    });
  }
);


/* =========================================================
   STATS
========================================================= */

app.get(
  "/api/stats",
  requireAdmin,
  (req, res) => {

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

    res.json({
      pending,
      confirmed,
      activeLobbies
    });
  }
);


/* =========================================================
   LEADERBOARD TEAMS
========================================================= */

app.get(
  "/api/leaderboard/teams",
  requireAdmin,
  (req, res) => {

    const lobby =
      req.query.lobby;

    if (!lobby) {
      return res.status(400).json({
        error:
          "Lobby is required."
      });
    }

    const teams =
      db.prepare(`
        SELECT
          r.team,
          r.uid,
          r.captain
        FROM registrations r
        INNER JOIN lobbies l
          ON l.id = r.lobby_id
        WHERE l.name = ?
          AND r.status = 'confirmed'
        ORDER BY r.id ASC
      `).all(lobby);

    res.json(teams);
  }
);


/* =========================================================
   GET MATCH RESULTS
========================================================= */

app.get(
  "/api/leaderboard/match",
  (req, res) => {

    const {
      lobby,
      match
    } = req.query;

    const matchNo =
      Number(match);

    if (!lobby || !matchNo) {
      return res.status(400).json({
        error:
          "Lobby and match are required."
      });
    }

    const rows =
      db.prepare(`
        SELECT
          ms.team,
          ms.position,
          ms.kills,
          ms.placement_points,
          ms.kill_points,
          ms.total_points
        FROM match_scores ms
        INNER JOIN lobbies l
          ON l.id = ms.lobby_id
        WHERE l.name = ?
          AND ms.match_no = ?
        ORDER BY ms.position ASC
      `).all(
        lobby,
        matchNo
      );

    res.json(rows);
  }
);


/* =========================================================
   SAVE MATCH
========================================================= */

app.post(
  "/api/leaderboard/match",
  requireAdmin,
  (req, res) => {

    const {
      lobby,
      matchNo,
      entries
    } = req.body;

    if (
      !lobby ||
      !matchNo ||
      !Array.isArray(entries)
    ) {
      return res.status(400).json({
        error:
          "Lobby, match and entries are required."
      });
    }

    const match =
      Number(matchNo);

    if (
      !Number.isInteger(match) ||
      match < 1 ||
      match > 6
    ) {
      return res.status(400).json({
        error:
          "Match number must be between 1 and 6."
      });
    }

    if (entries.length !== 12) {
      return res.status(400).json({
        error:
          "Exactly 12 teams are required."
      });
    }

    const lobbyRow =
      db.prepare(`
        SELECT *
        FROM lobbies
        WHERE name = ?
      `).get(lobby);

    if (!lobbyRow) {
      return res.status(404).json({
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
        ORDER BY id ASC
      `).all(lobbyRow.id);

    if (confirmedTeams.length !== 12) {
      return res.status(400).json({
        error:
          `This lobby currently has ${confirmedTeams.length}/12 confirmed teams.`
      });
    }

    const validTeams =
      new Set(
        confirmedTeams.map(
          row => row.team
        )
      );

    const positions = new Set();
    const teams = new Set();

    for (const entry of entries) {

      const position =
        Number(entry.position);

      const kills =
        Number(entry.kills);

      const team =
        String(entry.team || "").trim();

      if (!validTeams.has(team)) {
        return res.status(400).json({
          error:
            `Invalid team: ${team}`
        });
      }

      if (teams.has(team)) {
        return res.status(400).json({
          error:
            "A team appears more than once."
        });
      }

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

      if (positions.has(position)) {
        return res.status(400).json({
          error:
            "Each position can only be used once."
        });
      }

      if (
        !Number.isInteger(kills) ||
        kills < 0
      ) {
        return res.status(400).json({
          error:
            "Kills cannot be negative."
        });
      }

      positions.add(position);
      teams.add(team);
    }

    if (positions.size !== 12) {
      return res.status(400).json({
        error:
          "All positions from 1 to 12 must be used."
      });
    }

    const save =
      db.transaction(() => {

        db.prepare(`
          DELETE FROM match_scores
          WHERE lobby_id = ?
            AND match_no = ?
        `).run(
          lobbyRow.id,
          match
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
              placement_points,
              kill_points,
              total_points
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `);

        for (const entry of entries) {

          const position =
            Number(entry.position);

          const kills =
            Number(entry.kills);

          const placementPoints =
            getPlacementPoints(position);

          /*
            Current scoring:
            1 point per kill.
          */

          const killPoints =
            kills;

          const totalPoints =
            placementPoints +
            killPoints;

          insert.run(
            lobbyRow.id,
            match,
            String(entry.team).trim(),
            position,
            kills,
            placementPoints,
            killPoints,
            totalPoints
          );
        }
      });

    try {

      save();

      res.json({
        success: true
      });

    } catch (error) {

      console.error(error);

      res.status(500).json({
        error:
          "Could not save match results."
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

    const lobby =
      req.query.lobby;

    if (!lobby) {
      return res.status(400).json({
        error:
          "Lobby is required."
      });
    }

    const rows =
      db.prepare(`
        SELECT
          team,
          COUNT(*) AS matchesPlayed,

          SUM(
            CASE
              WHEN position = 1
              THEN 1
              ELSE 0
            END
          ) AS booyahs,

          SUM(placement_points)
            AS placementPoints,

          SUM(kill_points)
            AS killPoints,

          SUM(total_points)
            AS totalPoints

        FROM match_scores

        INNER JOIN lobbies
          ON lobbies.id =
             match_scores.lobby_id

        WHERE lobbies.name = ?

        GROUP BY team

        ORDER BY
          totalPoints DESC,
          killPoints DESC,
          placementPoints DESC,
          team ASC
      `).all(lobby);

    const result =
      rows.map((row, index) => ({
        position:
          index + 1,

        team:
          row.team,

        matchesPlayed:
          Number(row.matchesPlayed),

        booyahs:
          Number(row.booyahs),

        placementPoints:
          Number(row.placementPoints),

        killPoints:
          Number(row.killPoints),

        totalPoints:
          Number(row.totalPoints)
      }));

    res.json(result);
  }
);


/* =========================================================
   START SERVER
========================================================= */

app.listen(
  PORT,
  () => {
    console.log(
      `ScrimForge running on port ${PORT}`
    );
  }
);
