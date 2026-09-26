const config = require("./config");
const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();

const PORT = process.env.PORT || 10000;
const DATA_FILE = path.join(__dirname, "scrimforge-data.json");

/* =====================================================
   MIDDLEWARE
===================================================== */

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

/* =====================================================
   DATABASE
===================================================== */

function emptyDB() {
  return {
    nextLobbyId: 1,
    nextRegistrationId: 1,
    nextScoreId: 1,
    admins: [],
    lobbies: [],
    registrations: [],
    scores: []
  };
}

function loadDB() {
  if (!fs.existsSync(DATA_FILE)) {
    return emptyDB();
  }

  try {
    const data = JSON.parse(
      fs.readFileSync(DATA_FILE, "utf8")
    );

    return {
      nextLobbyId: Number(data.nextLobbyId) || 1,
      nextRegistrationId:
        Number(data.nextRegistrationId) || 1,
      nextScoreId:
        Number(data.nextScoreId) || 1,

      admins: Array.isArray(data.admins)
        ? data.admins
        : [],

      lobbies: Array.isArray(data.lobbies)
        ? data.lobbies
        : [],

      registrations:
        Array.isArray(data.registrations)
          ? data.registrations
          : [],

      scores: Array.isArray(data.scores)
        ? data.scores
        : []
    };
  } catch (error) {
    console.error("Could not load database:", error);
    return emptyDB();
  }
}

let db = loadDB();

function saveDB() {
  const tmp = DATA_FILE + ".tmp";

  fs.writeFileSync(
    tmp,
    JSON.stringify(db, null, 2),
    "utf8"
  );

  fs.renameSync(tmp, DATA_FILE);
}

const sessions = new Map();

/* =====================================================
   AUTHENTICATION
===================================================== */

function hashPassword(password) {
  return crypto
    .createHash("sha256")
    .update(String(password))
    .digest("hex");
}

function makeRef() {
  return `SF-${Date.now()}-${Math.floor(
    1000 + Math.random() * 9000
  )}`;
}

function getToken(req) {
  const raw = req.headers.cookie || "";

  const match = raw.match(
    /scrimforge_session=([^;]+)/
  );

  return match
    ? decodeURIComponent(match[1])
    : null;
}

function currentAdmin(req) {
  const token = getToken(req);

  return token
    ? sessions.get(token) || null
    : null;
}

function requireAdmin(req, res, next) {
  const admin = currentAdmin(req);

  if (!admin) {
    return res.status(401).json({
      error: "Admin login required."
    });
  }

  req.admin = admin;
  next();
}

/* =====================================================
   LOBBY HELPERS
===================================================== */

function lobbyById(id) {
  return db.lobbies.find(
    lobby =>
      Number(lobby.id) === Number(id)
  );
}

function lobbyByName(name) {
  return db.lobbies.find(
    lobby =>
      String(lobby.name) === String(name)
  );
}

function confirmedRegistrations(lobbyId) {
  return db.registrations.filter(
    registration =>
      Number(registration.lobby_id) ===
        Number(lobbyId) &&
      registration.status === "confirmed"
  );
}

function confirmedCount(lobbyId) {
  return confirmedRegistrations(lobbyId).length;
}

function publicLobby(lobby) {
  return {
    id: lobby.id,
    name: lobby.name,
    time: lobby.time,
    fee: lobby.fee,
    max_teams: Number(lobby.max_teams),
    status: lobby.status,
    confirmed: confirmedCount(lobby.id)
  };
}

/* =====================================================
   SCORE CALCULATION
===================================================== */

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

  return table[Number(position)] || 0;
}

function killPoints(kills) {
  return Number(kills) || 0;
}

function booyahPoints(position) {
  return Number(position) === 1 ? 1 : 0;
}

/* =====================================================
   ADMIN
===================================================== */

app.get(
  "/api/admin-exists",
  (req, res) => {
    res.json({
      exists: db.admins.length > 0
    });
  }
);

app.get(
  "/api/me",
  (req, res) => {
    const admin = currentAdmin(req);

    if (!admin) {
      return res.json({
        loggedIn: false
      });
    }

    res.json({
      loggedIn: true,
      name: admin.name,
      email: admin.email
    });
  }
);

app.post(
  "/api/setup-admin",
  (req, res) => {
    if (db.admins.length) {
      return res.status(400).json({
        error:
          "An admin account already exists."
      });
    }

    const {
      name,
      email,
      password
    } = req.body || {};

    if (
      !name ||
      !email ||
      !password ||
      String(password).length < 6
    ) {
      return res.status(400).json({
        error:
          "Name, email and a password of at least 6 characters are required."
      });
    }

    const admin = {
      id: 1,
      name: String(name).trim(),
      email: String(email)
        .trim()
        .toLowerCase(),
      password: hashPassword(password)
    };

    db.admins.push(admin);
    saveDB();

    const token = crypto
      .randomBytes(32)
      .toString("hex");

    sessions.set(token, {
      id: admin.id,
      name: admin.name,
      email: admin.email
    });

    res.setHeader(
      "Set-Cookie",
      `scrimforge_session=${encodeURIComponent(
        token
      )}; HttpOnly; SameSite=Lax; Path=/`
    );

    res.json({
      name: admin.name
    });
  }
);

app.post(
  "/api/login",
  (req, res) => {
    const {
      email,
      password
    } = req.body || {};

    const admin = db.admins.find(
      a =>
        a.email ===
        String(email || "")
          .trim()
          .toLowerCase()
    );

    if (
      !admin ||
      admin.password !==
        hashPassword(password)
    ) {
      return res.status(401).json({
        error:
          "Invalid email or password."
      });
    }

    const token = crypto
      .randomBytes(32)
      .toString("hex");

    sessions.set(token, {
      id: admin.id,
      name: admin.name,
      email: admin.email
    });

    res.setHeader(
      "Set-Cookie",
      `scrimforge_session=${encodeURIComponent(
        token
      )}; HttpOnly; SameSite=Lax; Path=/`
    );

    res.json({
      name: admin.name
    });
  }
);

app.post(
  "/api/logout",
  (req, res) => {
    const token = getToken(req);

    if (token) {
      sessions.delete(token);
    }

    res.setHeader(
      "Set-Cookie",
      "scrimforge_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"
    );

    res.json({
      ok: true
    });
  }
);

/* =====================================================
   PUBLIC LOBBIES
===================================================== */

app.get(
  "/api/public/lobbies",
  (req, res) => {
    res.json(
      db.lobbies.map(publicLobby)
    );
  }
);

/* =====================================================
   ADMIN LOBBIES
===================================================== */

app.get(
  "/api/lobbies",
  requireAdmin,
  (req, res) => {
    res.json(
      db.lobbies.map(publicLobby)
    );
  }
);

app.post(
  "/api/lobbies",
  requireAdmin,
  (req, res) => {
    const {
      name,
      time,
      fee,
      maxTeams
    } = req.body || {};

    const cleanName =
      String(name || "").trim();

    const cleanTime =
      String(time || "").trim();

    const cleanFee =
      String(fee || "").trim();

    const max = Number(maxTeams);

    if (
      !cleanName ||
      !cleanTime ||
      !cleanFee ||
      !Number.isInteger(max) ||
      max < 1
    ) {
      return res.status(400).json({
        error:
          "Lobby name, time, fee and valid maximum teams are required."
      });
    }

    const lobby = {
      id: db.nextLobbyId++,
      name: cleanName,
      time: cleanTime,
      fee: cleanFee,
      max_teams: max,
      status: "open",
      created_at:
        new Date().toISOString()
    };

    db.lobbies.push(lobby);
    saveDB();

    res.json(publicLobby(lobby));
  }
);

app.patch(
  "/api/lobbies/:id",
  requireAdmin,
  (req, res) => {
    const lobby =
      lobbyById(req.params.id);

    if (!lobby) {
      return res.status(404).json({
        error: "Lobby not found."
      });
    }

    if (
      !["open", "closed"].includes(
        req.body.status
      )
    ) {
      return res.status(400).json({
        error: "Invalid lobby status."
      });
    }

    lobby.status =
      req.body.status;

    saveDB();

    res.json(publicLobby(lobby));
  }
);

app.delete(
  "/api/lobbies/:id",
  requireAdmin,
  (req, res) => {
    const id = Number(req.params.id);

    const lobby = lobbyById(id);

    if (!lobby) {
      return res.status(404).json({
        error: "Lobby not found."
      });
    }

    const lobbyName = lobby.name;

    db.lobbies =
      db.lobbies.filter(
        l => Number(l.id) !== id
      );

    db.registrations =
      db.registrations.filter(
        r =>
          Number(r.lobby_id) !== id
      );

    db.scores =
      db.scores.filter(
        s =>
          Number(s.lobby_id) !== id
      );

    saveDB();

    res.json({
      ok: true,
      message:
        `Lobby "${lobbyName}" deleted successfully.`
    });
  }
);

/* =====================================================
   REGISTRATION
===================================================== */

app.post(
  "/api/registrations",
  (req, res) => {
    const {
      lobbyId,
      time,
      fee,
      team,
      captain,
      phone,
      uid
    } = req.body || {};

    const cleanTeam =
      String(team || "").trim();

    const cleanCaptain =
      String(captain || "").trim();

    const cleanPhone =
      String(phone || "").trim();

    const cleanUid =
      String(uid || "").trim();

    if (
      !cleanTeam ||
      !cleanCaptain ||
      !cleanPhone ||
      !cleanUid
    ) {
      return res.status(400).json({
        error:
          "Team, captain, phone and UID are required."
      });
    }

    let lobby = null;

    /* Find lobby by ID when provided */
    if (
      lobbyId !== undefined &&
      lobbyId !== null &&
      String(lobbyId).trim() !== ""
    ) {
      lobby = lobbyById(lobbyId);
    }

    /* Fallback: find lobby by time + fee */
    if (!lobby && time && fee) {
      lobby = db.lobbies.find(
        l =>
          String(l.time).trim() ===
            String(time).trim() &&
          String(l.fee).trim() ===
            String(fee).trim() &&
          l.status === "open"
      );
    }

    if (!lobby) {
      return res.status(400).json({
        error:
          "The selected scrim is not currently open."
      });
    }

    if (lobby.status !== "open") {
      return res.status(400).json({
        error:
          "This scrim is closed."
      });
    }

    const confirmed =
      confirmedCount(lobby.id);

    if (
      confirmed >=
      Number(lobby.max_teams)
    ) {
      return res.status(400).json({
        error:
          "That scrim is full."
      });
    }

    /*
      Prevent the same team from creating
      multiple pending/confirmed registrations
      in the same lobby.
    */
    const duplicate =
      db.registrations.find(
        registration =>
          Number(registration.lobby_id) ===
            Number(lobby.id) &&
          ["pending", "confirmed"].includes(
            registration.status
          ) &&
          String(registration.team)
            .trim()
            .toLowerCase() ===
            cleanTeam.toLowerCase()
      );

    if (duplicate) {
      return res.status(400).json({
        error:
          "This team already has a registration for this scrim."
      });
    }

    const row = {
      id:
        db.nextRegistrationId++,

      ref:
        makeRef(),

      time:
        String(lobby.time).trim(),

      fee:
        String(lobby.fee).trim(),

      team:
        cleanTeam,

      captain:
        cleanCaptain,

      phone:
        cleanPhone,

      uid:
        cleanUid,

      status:
        "pending",

      lobby_id:
        lobby.id,

      created_at:
        new Date().toISOString()
    };

    db.registrations.push(row);

    saveDB();

    res.json({
      ok: true,

      ref:
        row.ref,

      lobby_id:
        lobby.id,

      lobby_name:
        lobby.name,

      time:
        row.time,

      fee:
        row.fee,

      status:
        row.status,

      message:
        "Registration submitted successfully. Payment can be completed through WhatsApp, then the admin can confirm the registration."
    });
  }
);

/* =====================================================
   REGISTRATION STATUS
===================================================== */

/* =====================================================
   REGISTRATION STATUS
===================================================== */

app.get(
  "/api/registration-status/:ref",
  (req, res) => {
    const row =
      db.registrations.find(
        r => r.ref === req.params.ref
      );

    if (!row) {
      return res.status(404).json({
        error:
          "Registration reference not found."
      });
    }

    const lobby = row.lobby_id
      ? lobbyById(row.lobby_id)
      : null;

    res.json({
      team: row.team,
      captain: row.captain,
      phone: row.phone,
      uid: row.uid,
      ref: row.ref,
      time: row.time,
      fee: row.fee,
      status: row.status,
      lobby_id: row.lobby_id,
      lobby_name:
        lobby ? lobby.name : null,
      created_at: row.created_at
    });
  }
);

/* =====================================================
   ADMIN REGISTRATIONS
===================================================== */

app.get(
  "/api/registrations",
  requireAdmin,
  (req, res) => {
    res.json(
      db.registrations.map(
        r => ({ ...r })
      )
    );
  }
);

app.patch(
  "/api/registrations/:id",
  requireAdmin,
  (req, res) => {
    const row =
      db.registrations.find(
        r =>
          Number(r.id) ===
          Number(req.params.id)
      );

    if (!row) {
      return res.status(404).json({
        error:
          "Registration not found."
      });
    }

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
      return res.status(400).json({
        error:
          "Invalid registration status."
      });
    }

    if (status === "rejected") {
      row.status = "rejected";
      row.lobby_id = null;

      saveDB();

      return res.json({
        ok: true,
        status: row.status
      });
    }

    if (status === "pending") {
      row.status = "pending";

      saveDB();

      return res.json({
        ok: true,
        status: row.status
      });
    }

    const requestedLobbyId =
      req.body.lobbyId ??
      row.lobby_id;

    const lobby =
      lobbyById(requestedLobbyId);

    if (!lobby) {
      return res.status(400).json({
        error:
          "Please select a valid lobby before confirming."
      });
    }

    if (lobby.status !== "open") {
      return res.status(400).json({
        error:
          "The selected lobby is closed."
      });
    }

    const duplicate =
      db.registrations.find(
        r =>
          Number(r.id) !==
            Number(row.id) &&
          Number(r.lobby_id) ===
            Number(lobby.id) &&
          r.status === "confirmed" &&
          String(r.team)
            .trim()
            .toLowerCase() ===
            String(row.team)
              .trim()
              .toLowerCase()
      );

    if (duplicate) {
      return res.status(400).json({
        error:
          "This team is already confirmed in that lobby."
      });
    }

    if (
      confirmedCount(lobby.id) >=
        Number(lobby.max_teams) &&
      Number(row.lobby_id) !==
        Number(lobby.id)
    ) {
      return res.status(400).json({
        error:
          "That lobby is full."
      });
    }

    row.status = "confirmed";
    row.lobby_id = lobby.id;
    row.time = lobby.time;
    row.fee = lobby.fee;

    saveDB();

    res.json({
      ok: true,
      status: row.status,
      lobby_id: row.lobby_id,
      lobby_name: lobby.name
    });
  }
);

/* =====================================================
   MANUAL LOBBY ASSIGNMENT
===================================================== */

app.patch(
  "/api/registrations/:id/lobby",
  requireAdmin,
  (req, res) => {
    const row =
      db.registrations.find(
        r =>
          Number(r.id) ===
          Number(req.params.id)
      );

    if (!row) {
      return res.status(404).json({
        error:
          "Registration not found."
      });
    }

    const lobby =
      lobbyById(req.body.lobbyId);

    if (!lobby) {
      return res.status(404).json({
        error: "Lobby not found."
      });
    }

    if (row.status !== "confirmed") {
      return res.status(400).json({
        error:
          "Confirm the registration first."
      });
    }

    if (lobby.status !== "open") {
      return res.status(400).json({
        error:
          "The selected lobby is closed."
      });
    }

    const duplicate =
      db.registrations.find(
        r =>
          Number(r.id) !==
            Number(row.id) &&
          Number(r.lobby_id) ===
            Number(lobby.id) &&
          r.status === "confirmed" &&
          String(r.team)
            .trim()
            .toLowerCase() ===
            String(row.team)
              .trim()
              .toLowerCase()
      );

    if (duplicate) {
      return res.status(400).json({
        error:
          "This team is already assigned to that lobby."
      });
    }

    if (
      confirmedCount(lobby.id) >=
        Number(lobby.max_teams) &&
      Number(row.lobby_id) !==
        Number(lobby.id)
    ) {
      return res.status(400).json({
        error:
          "That lobby is full."
      });
    }

    row.lobby_id = lobby.id;
    row.time = lobby.time;
    row.fee = lobby.fee;

    saveDB();

    res.json({
      ok: true,
      lobby_id: lobby.id,
      lobby_name: lobby.name
    });
  }
);

/* =====================================================
   STATS
===================================================== */

app.get(
  "/api/stats",
  requireAdmin,
  (req, res) => {
    res.json({
      pending:
        db.registrations.filter(
          r => r.status === "pending"
        ).length,

      confirmed:
        db.registrations.filter(
          r => r.status === "confirmed"
        ).length,

      activeLobbies:
        db.lobbies.filter(
          l => l.status === "open"
        ).length
    });
  }
);

/* =====================================================
   LEADERBOARD TEAM LIST
===================================================== */

app.get(
  "/api/leaderboard/teams",
  requireAdmin,
  (req, res) => {
    const lobby =
      lobbyByName(req.query.lobby);

    if (!lobby) {
      return res.status(404).json({
        error: "Lobby not found."
      });
    }

    const seen = new Set();

    const teams =
      confirmedRegistrations(lobby.id)
        .filter(registration => {
          const key =
            String(
              registration.team
            )
              .trim()
              .toLowerCase();

          if (seen.has(key)) {
            return false;
          }

          seen.add(key);
          return true;
        })
        .map(registration => ({
          team: registration.team
        }));

    res.json(teams);
  }
);

/* =====================================================
   MATCH LEADERBOARD
===================================================== */

app.get(
  "/api/leaderboard/match",
  (req, res) => {
    const lobby =
      lobbyByName(req.query.lobby);

    if (!lobby) {
      return res.status(404).json({
        error: "Lobby not found."
      });
    }

    const match =
      Number(req.query.match);

    if (
      !Number.isInteger(match) ||
      match < 1 ||
      match > 6
    ) {
      return res.status(400).json({
        error: "Invalid match."
      });
    }

    const rows =
      db.scores
        .filter(
          score =>
            Number(score.lobby_id) ===
              Number(lobby.id) &&
            Number(score.match_no) ===
              match
        )
        .map(score => {
          const position =
            Number(score.position);

          const kills =
            Number(score.kills) || 0;

          const placement =
            Number(
              score.placement_points
            ) ||
            placementPoints(position);

          const kill =
            Number(score.kill_points);

          const killPts =
            Number.isFinite(kill)
              ? kill
              : kills;

          const booyah =
            position === 1 ? 1 : 0;

          return {
            team: score.team,
            position,
            kills,
            booyah,
            placement_points:
              placement,
            kill_points:
              killPts,
            total_points:
              placement + killPts
          };
        })
        .sort(
          (a, b) =>
            a.position - b.position
        );

    res.json(rows);
  }
);

/* =====================================================
   SAVE MATCH SCORE
===================================================== */

app.post(
  "/api/leaderboard/match",
  requireAdmin,
  (req, res) => {
    const {
      lobby: lobbyName,
      matchNo,
      entries
    } = req.body || {};

    const lobby =
      lobbyByName(lobbyName);

    const match =
      Number(matchNo);

    if (!lobby) {
      return res.status(404).json({
        error: "Lobby not found."
      });
    }

    if (
      !Number.isInteger(match) ||
      match < 1 ||
      match > 6
    ) {
      return res.status(400).json({
        error: "Invalid match."
      });
    }

    if (
      !Array.isArray(entries) ||
      entries.length !== 12
    ) {
      return res.status(400).json({
        error:
          "Exactly 12 teams are required for a match."
      });
    }

    const confirmed =
      confirmedRegistrations(
        lobby.id
      );

    if (confirmed.length !== 12) {
      return res.status(400).json({
        error:
          `This lobby has ${confirmed.length}/12 confirmed teams. Exactly 12 teams are required.`
      });
    }

    const confirmedMap =
      new Map();

    confirmed.forEach(reg => {
      confirmedMap.set(
        String(reg.team)
          .trim()
          .toLowerCase(),
        reg.team
      );
    });

    const enteredTeams =
      new Set();

    const positions =
      new Set();

    const cleanedEntries = [];

    for (const entry of entries) {
      const team =
        String(
          entry.team || ""
        ).trim();

      const teamKey =
        team.toLowerCase();

      const position =
        Number(entry.position);

      const kills =
        Number(entry.kills);

      if (!team) {
        return res.status(400).json({
          error:
            "Every score row must have a team."
        });
      }

      if (!confirmedMap.has(teamKey)) {
        return res.status(400).json({
          error:
            `Team "${team}" is not assigned to this lobby.`
        });
      }

      if (enteredTeams.has(teamKey)) {
        return res.status(400).json({
          error:
            `Team "${team}" appears more than once.`
        });
      }

      if (
        !Number.isInteger(position) ||
        position < 1 ||
        position > 12
      ) {
        return res.status(400).json({
          error:
            "Positions must be unique numbers from 1 to 12."
        });
      }

      if (positions.has(position)) {
        return res.status(400).json({
          error:
            `Position ${position} is used more than once.`
        });
      }

      if (
        !Number.isInteger(kills) ||
        kills < 0
      ) {
        return res.status(400).json({
          error:
            "Kills must be whole numbers greater than or equal to zero."
        });
      }

      const placement =
        placementPoints(position);

      const kill =
        killPoints(kills);

      const booyah =
        booyahPoints(position);

      const total =
        placement + kill;

      enteredTeams.add(teamKey);
      positions.add(position);

      cleanedEntries.push({
        team:
          confirmedMap.get(teamKey),

        position,

        kills,

        booyah,

        placement_points:
          placement,

        kill_points:
          kill,

        total_points:
          total
      });
    }

    for (
      let position = 1;
      position <= 12;
      position++
    ) {
      if (!positions.has(position)) {
        return res.status(400).json({
          error:
            `Position ${position} is missing.`
        });
      }
    }

    if (enteredTeams.size !== 12) {
      return res.status(400).json({
        error:
          "Exactly 12 unique teams are required."
      });
    }

    /* Remove previous version of this match */
    db.scores =
      db.scores.filter(
        score =>
          !(
            Number(score.lobby_id) ===
              Number(lobby.id) &&
            Number(score.match_no) ===
              match
          )
      );

    /* Save new results */
    cleanedEntries.forEach(entry => {
      db.scores.push({
        id:
          db.nextScoreId++,

        lobby_id:
          lobby.id,

        match_no:
          match,

        team:
          entry.team,

        position:
          entry.position,

        kills:
          entry.kills,

        booyah:
          entry.booyah,

        placement_points:
          entry.placement_points,

        kill_points:
          entry.kill_points,

        total_points:
          entry.total_points,

        updated_at:
          new Date().toISOString()
      });
    });

    saveDB();

    res.json({
      ok: true,
      lobby: lobby.name,
      match,
      entries: cleanedEntries
    });
  }
);

/* =====================================================
   PUBLIC OVERALL LEADERBOARD
===================================================== */

app.get(
  "/api/public-leaderboard",
  (req, res) => {
    const lobby =
      lobbyByName(req.query.lobby);

    if (!lobby) {
      return res.status(404).json({
        error: "Lobby not found."
      });
    }

    const teams = new Map();

    /* Add every confirmed team first */
    confirmedRegistrations(
      lobby.id
    ).forEach(registration => {
      const key =
        String(
          registration.team
        )
          .trim()
          .toLowerCase();

      if (!teams.has(key)) {
        teams.set(key, {
          team: registration.team,
          matchesPlayed: 0,
          booyahs: 0,
          placementPoints: 0,
          killPoints: 0,
          totalPoints: 0
        });
      }
    });

    /* Add saved match results */
    db.scores
      .filter(
        score =>
          Number(score.lobby_id) ===
          Number(lobby.id)
      )
      .forEach(score => {
        const key =
          String(score.team)
            .trim()
            .toLowerCase();

        if (!teams.has(key)) {
          teams.set(key, {
            team: score.team,
            matchesPlayed: 0,
            booyahs: 0,
            placementPoints: 0,
            killPoints: 0,
            totalPoints: 0
          });
        }

        const team =
          teams.get(key);

        const position =
          Number(score.position);

        const placement =
          Number(
            score.placement_points
          ) ||
          placementPoints(position);

        const kills =
          Number(score.kills) || 0;

        const kill =
          Number(score.kill_points);

        const killPts =
          Number.isFinite(kill)
            ? kill
            : kills;

        team.matchesPlayed += 1;

        team.booyahs +=
          position === 1 ? 1 : 0;

        team.placementPoints +=
          placement;

        team.killPoints +=
          killPts;

        team.totalPoints +=
          placement + killPts;
      });

    /* Sort by total points */
    const rows =
      [...teams.values()].sort(
        (a, b) =>
          b.totalPoints -
            a.totalPoints ||

          b.killPoints -
            a.killPoints ||

          b.placementPoints -
            a.placementPoints ||

          b.booyahs -
            a.booyahs ||

          a.team.localeCompare(
            b.team
          )
      );

    rows.forEach(
      (row, index) => {
        row.position =
          index + 1;
      }
    );

    res.json({
      lobby: {
        id: lobby.id,
        name: lobby.name,
        time: lobby.time,
        fee: lobby.fee
      },
      rows
    });
  }
);

/* =====================================================
   V4 LOBBY DETAILS
===================================================== */

app.get(
  "/api/public/lobbies/:id",
  (req, res) => {
    const lobby =
      lobbyById(req.params.id);

    if (!lobby) {
      return res.status(404).json({
        error: "Lobby not found."
      });
    }

    const registrations =
      confirmedRegistrations(lobby.id)
        .map(registration => ({
          team: registration.team,
          captain: registration.captain,
          uid: registration.uid
        }));

    res.json({
      id: lobby.id,
      name: lobby.name,
      time: lobby.time,
      fee: lobby.fee,
      max_teams:
        Number(lobby.max_teams),
      confirmed:
        registrations.length,
      remaining:
        Math.max(
          0,
          Number(lobby.max_teams) -
            registrations.length
        ),
      status: lobby.status,
      registrations
    });
  }
);
   
/* =====================================================
   SAFE FALLBACK
===================================================== */

app.use((req, res) => {
  if (
    req.method === "GET" &&
    req.accepts("html")
  ) {
    return res.sendFile(
      path.join(
        __dirname,
        "index.html"
      )
    );
  }

  res.status(404).json({
    error: "Not found."
  });
});

/* =====================================================
   START
===================================================== */

app.listen(
  PORT,
  () => {
    console.log(
      `ScrimForge running on port ${PORT}`
    );
  }
);
