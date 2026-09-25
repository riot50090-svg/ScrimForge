const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();

const PORT = process.env.PORT || 10000;

const DATA_FILE = path.join(
  __dirname,
  "scrimforge-data.json"
);


/* =====================================================
   MIDDLEWARE
===================================================== */

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

app.use(
  express.static(__dirname)
);


/* =====================================================
   DATABASE
===================================================== */

let db = loadDB();

const sessions = new Map();


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
      fs.readFileSync(
        DATA_FILE,
        "utf8"
      )
    );

    return {

      nextLobbyId:
        Number(data.nextLobbyId) || 1,

      nextRegistrationId:
        Number(data.nextRegistrationId) || 1,

      nextScoreId:
        Number(data.nextScoreId) || 1,

      admins:
        Array.isArray(data.admins)
          ? data.admins
          : [],

      lobbies:
        Array.isArray(data.lobbies)
          ? data.lobbies
          : [],

      registrations:
        Array.isArray(data.registrations)
          ? data.registrations
          : [],

      scores:
        Array.isArray(data.scores)
          ? data.scores
          : []

    };

  } catch (error) {

    console.error(
      "Could not load database:",
      error
    );

    return emptyDB();

  }

}


function saveDB() {

  const tmp =
    DATA_FILE + ".tmp";

  fs.writeFileSync(
    tmp,
    JSON.stringify(
      db,
      null,
      2
    )
  );

  fs.renameSync(
    tmp,
    DATA_FILE
  );

}


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

  const raw =
    req.headers.cookie || "";

  const match =
    raw.match(
      /scrimforge_session=([^;]+)/
    );

  return match
    ? decodeURIComponent(match[1])
    : null;

}


function currentAdmin(req) {

  const token =
    getToken(req);

  return token
    ? sessions.get(token) || null
    : null;

}


function requireAdmin(
  req,
  res,
  next
) {

  const admin =
    currentAdmin(req);

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


/* =====================================================
   LOBBY HELPERS
===================================================== */

function lobbyById(id) {

  return db.lobbies.find(
    lobby =>
      Number(lobby.id) ===
      Number(id)
  );

}


function lobbyByName(name) {

  return db.lobbies.find(
    lobby =>
      String(lobby.name).trim() ===
      String(name).trim()
  );

}


function confirmedRegistrations(
  lobbyId
) {

  return db.registrations.filter(
    registration =>
      Number(registration.lobby_id) ===
        Number(lobbyId) &&
      registration.status ===
        "confirmed"
  );

}


function confirmedCount(
  lobbyId
) {

  return confirmedRegistrations(
    lobbyId
  ).length;

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
      confirmedCount(lobby.id)

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

  return (
    table[Number(position)] || 0
  );

}


function killPoints(kills) {

  return Number(kills);

}


function isBooyah(position) {

  return Number(position) === 1
    ? 1
    : 0;

}


/* =====================================================
   ADMIN ROUTES
===================================================== */

app.get(
  "/api/admin-exists",
  (req, res) => {

    res.json({
      exists:
        db.admins.length > 0
    });

  }
);


app.get(
  "/api/me",
  (req, res) => {

    const admin =
      currentAdmin(req);

    res.json(
      admin

        ? {
            loggedIn: true,
            name: admin.name,
            email: admin.email
          }

        : {
            loggedIn: false
          }
    );

  }
);


app.post(
  "/api/setup-admin",
  (req, res) => {

    if (db.admins.length) {

      return res
        .status(400)
        .json({
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

      return res
        .status(400)
        .json({
          error:
            "Name, email and a password of at least 6 characters are required."
        });

    }

    const admin = {

      id: 1,

      name:
        String(name).trim(),

      email:
        String(email)
          .trim()
          .toLowerCase(),

      password:
        hashPassword(password)

    };

    db.admins.push(admin);

    saveDB();

    const token =
      crypto
        .randomBytes(32)
        .toString("hex");

    sessions.set(
      token,
      {
        id: admin.id,
        name: admin.name,
        email: admin.email
      }
    );

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

    const admin =
      db.admins.find(
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

      return res
        .status(401)
        .json({
          error:
            "Invalid email or password."
        });

    }

    const token =
      crypto
        .randomBytes(32)
        .toString("hex");

    sessions.set(
      token,
      {
        id: admin.id,
        name: admin.name,
        email: admin.email
      }
    );

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

    const token =
      getToken(req);

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
      db.lobbies.map(
        publicLobby
      )
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
      db.lobbies.map(
        publicLobby
      )
    );

  }
);


/* CREATE LOBBY */

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

    const max =
      Number(maxTeams);

    if (
      !cleanName ||
      !cleanTime ||
      !cleanFee ||
      !Number.isInteger(max) ||
      max < 1
    ) {

      return res
        .status(400)
        .json({
          error:
            "Lobby name, time, fee and valid maximum teams are required."
        });

    }

    const lobby = {

      id:
        db.nextLobbyId++,

      name:
        cleanName,

      time:
        cleanTime,

      fee:
        cleanFee,

      max_teams:
        max,

      status:
        "open",

      created_at:
        new Date().toISOString()

    };

    db.lobbies.push(lobby);

    saveDB();

    res.json(
      publicLobby(lobby)
    );

  }
);


/* OPEN / CLOSE */

app.patch(
  "/api/lobbies/:id",
  requireAdmin,
  (req, res) => {

    const lobby =
      lobbyById(
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

    if (
      ![
        "open",
        "closed"
      ].includes(req.body.status)
    ) {

      return res
        .status(400)
        .json({
          error:
            "Invalid lobby status."
        });

    }

    lobby.status =
      req.body.status;

    saveDB();

    res.json(
      publicLobby(lobby)
    );

  }
);


/* =====================================================
   DELETE LOBBY
===================================================== */

app.delete(
  "/api/lobbies/:id",
  requireAdmin,
  (req, res) => {

    const id =
      Number(req.params.id);

    const lobby =
      lobbyById(id);

    if (!lobby) {

      return res
        .status(404)
        .json({
          error:
            "Lobby not found."
        });

    }

    const lobbyName =
      lobby.name;

    db.lobbies =
      db.lobbies.filter(
        x =>
          Number(x.id) !== id
      );

    db.registrations =
      db.registrations.filter(
        registration =>
          Number(
            registration.lobby_id
          ) !== id
      );

    db.scores =
      db.scores.filter(
        score =>
          Number(
            score.lobby_id
          ) !== id
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
      team,
      captain,
      phone,
      uid
    } = req.body || {};

    const id =
      Number(lobbyId);

    const lobby =
      lobbyById(id);

    if (!lobby) {

      return res
        .status(400)
        .json({
          error:
            "Please select a valid scrim."
        });

    }

    if (lobby.status !== "open") {

      return res
        .status(400)
        .json({
          error:
            "This scrim is closed."
        });

    }

    if (
      confirmedCount(lobby.id) >=
      Number(lobby.max_teams)
    ) {

      return res
        .status(400)
        .json({
          error:
            "That scrim is full."
        });

    }

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

      return res
        .status(400)
        .json({
          error:
            "Team, captain, phone and UID are required."
        });

    }

    /*
      Time and fee are ALWAYS taken from
      the selected lobby on the server.
      The browser cannot change them.
    */

    const row = {

      id:
        db.nextRegistrationId++,

      ref:
        makeRef(),

      lobby_id:
        lobby.id,

      time:
        lobby.time,

      fee:
        lobby.fee,

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

      created_at:
        new Date().toISOString()

    };

    db.registrations.push(row);

    saveDB();

    res.json({

      ref: row.ref,

      status: row.status,

      lobby_name:
        lobby.name,

      time:
        lobby.time,

      fee:
        lobby.fee

    });

  }
);


/* =====================================================
   STATUS
===================================================== */

app.get(
  "/api/registration-status/:ref",
  (req, res) => {

    const ref =
      String(req.params.ref || "").trim();

    const row =
      db.registrations.find(
        registration =>
          registration.ref === ref
      );

    if (!row) {

      return res
        .status(404)
        .json({
          error:
            "Registration reference not found."
        });

    }

    const lobby =
      row.lobby_id
        ? lobbyById(row.lobby_id)
        : null;

    res.json({

      team:
        row.team,

      captain:
        row.captain,

      phone:
        row.phone,

      uid:
        row.uid,

      ref:
        row.ref,

      time:
        row.time,

      fee:
        row.fee,

      status:
        row.status,

      lobby_id:
        row.lobby_id,

      lobby_name:
        lobby
          ? lobby.name
          : null,

      created_at:
        row.created_at

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
        row => ({
          ...row
        })
      )
    );

  }
);


/* =====================================================
   CONFIRM / REJECT + ASSIGN LOBBY
===================================================== */

app.patch(
  "/api/registrations/:id",
  requireAdmin,
  (req, res) => {

    const row =
      db.registrations.find(
        registration =>
          Number(registration.id) ===
          Number(req.params.id)
      );

    if (!row) {

      return res
        .status(404)
        .json({
          error:
            "Registration not found."
        });

    }

    const newStatus =
      String(
        req.body.status || ""
      ).toLowerCase();

    if (
      ![
        "pending",
        "confirmed",
        "rejected"
      ].includes(newStatus)
    ) {

      return res
        .status(400)
        .json({
          error:
            "Invalid registration status."
        });

    }


    /* -------------------------
       REJECT
    ------------------------- */

    if (newStatus === "rejected") {

      row.status = "rejected";

      row.lobby_id = null;

      saveDB();

      return res.json({

        ok: true,

        status:
          row.status,

        lobby_id:
          null

      });

    }


    /* -------------------------
       PENDING
    ------------------------- */

    if (newStatus === "pending") {

      row.status = "pending";

      saveDB();

      return res.json({

        ok: true,

        status:
          row.status

      });

    }


    /* -------------------------
       CONFIRM
    ------------------------- */

    const lobbyId =
      Number(
        req.body.lobbyId ||
        req.body.lobby_id
      );

    const lobby =
      lobbyById(lobbyId);

    if (!lobby) {

      return res
        .status(400)
        .json({
          error:
            "Please select a valid lobby before accepting."
        });

    }

    if (lobby.status !== "open") {

      return res
        .status(400)
        .json({
          error:
            "The selected lobby is closed."
        });

    }


    /*
      Prevent duplicate team names
      inside the same lobby.
    */

    const duplicateTeam =
      db.registrations.find(
        registration =>
          Number(
            registration.lobby_id
          ) === Number(lobby.id) &&

          registration.status ===
            "confirmed" &&

          Number(
            registration.id
          ) !== Number(row.id) &&

          String(
            registration.team
          ).trim().toLowerCase() ===
            String(
              row.team
            ).trim().toLowerCase()
      );

    if (duplicateTeam) {

      return res
        .status(400)
        .json({
          error:
            "This team is already confirmed in that lobby."
        });

    }


    /*
      Check lobby capacity.
    */

    const alreadyConfirmed =
      confirmedRegistrations(
        lobby.id
      ).filter(
        registration =>
          Number(registration.id) !==
          Number(row.id)
      ).length;

    if (
      alreadyConfirmed >=
      Number(lobby.max_teams)
    ) {

      return res
        .status(400)
        .json({
          error:
            "That lobby is full."
        });

    }


    /*
      IMPORTANT:
      Status + lobby assignment happen
      together in ONE operation.
    */

    row.status =
      "confirmed";

    row.lobby_id =
      lobby.id;

    /*
      Always synchronize these values
      with the selected lobby.
    */

    row.time =
      lobby.time;

    row.fee =
      lobby.fee;

    saveDB();

    res.json({

      ok: true,

      status:
        row.status,

      lobby_id:
        row.lobby_id,

      lobby_name:
        lobby.name,

      time:
        row.time,

      fee:
        row.fee

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
        registration =>
          Number(registration.id) ===
          Number(req.params.id)
      );

    if (!row) {

      return res
        .status(404)
        .json({
          error:
            "Registration not found."
        });

    }

    const lobby =
      lobbyById(
        req.body.lobbyId
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
      row.status !==
      "confirmed"
    ) {

      return res
        .status(400)
        .json({
          error:
            "Confirm the registration first."
        });

    }

    const duplicateTeam =
      db.registrations.find(
        registration =>
          Number(
            registration.lobby_id
          ) === Number(lobby.id) &&

          registration.status ===
            "confirmed" &&

          Number(
            registration.id
          ) !== Number(row.id) &&

          String(
            registration.team
          ).trim().toLowerCase() ===
            String(
              row.team
            ).trim().toLowerCase()
      );

    if (duplicateTeam) {

      return res
        .status(400)
        .json({
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

      return res
        .status(400)
        .json({
          error:
            "That lobby is full."
        });

    }

    row.lobby_id =
      lobby.id;

    row.time =
      lobby.time;

    row.fee =
      lobby.fee;

    saveDB();

    res.json({

      ok: true,

      lobby_id:
        lobby.id,

      lobby_name:
        lobby.name

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
          r =>
            r.status ===
            "pending"
        ).length,

      confirmed:
        db.registrations.filter(
          r =>
            r.status ===
            "confirmed"
        ).length,

      activeLobbies:
        db.lobbies.filter(
          lobby =>
            lobby.status ===
            "open"
        ).length

    });

  }
);


/* =====================================================
   LEADERBOARD TEAMS
===================================================== */

app.get(
  "/api/leaderboard/teams",
  requireAdmin,
  (req, res) => {

    const lobby =
      lobbyByName(
        req.query.lobby
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
      confirmedRegistrations(
        lobby.id
      )
      .map(
        registration => ({
          team:
            registration.team
        })
      );

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
      lobbyByName(
        req.query.lobby
      );

    if (!lobby) {

      return res
        .status(404)
        .json({
          error:
            "Lobby not found."
        });

    }

    const match =
      Number(req.query.match);

    if (
      !Number.isInteger(match) ||
      match < 1 ||
      match > 6
    ) {

      return res
        .status(400)
        .json({
          error:
            "Invalid match."
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

        .sort(
          (a, b) =>
            Number(a.position) -
            Number(b.position)
        )

        .map(
          score => ({

            team:
              score.team,

            position:
              Number(score.position),

            kills:
              Number(score.kills),

            booyah:
              Number(score.booyah),

            placement_points:
              Number(
                score.placement_points
              ),

            kill_points:
              Number(
                score.kill_points
              ),

            total_points:
              Number(
                score.total_points
              )

          })
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
      lobbyByName(
        lobbyName
      );

    const match =
      Number(matchNo);

    if (!lobby) {

      return res
        .status(404)
        .json({
          error:
            "Lobby not found."
        });

    }

    if (
      !Number.isInteger(match) ||
      match < 1 ||
      match > 6
    ) {

      return res
        .status(400)
        .json({
          error:
            "Invalid match."
        });

    }

    if (
      !Array.isArray(entries) ||
      entries.length !== 12
    ) {

      return res
        .status(400)
        .json({
          error:
            "Exactly 12 teams are required for a match."
        });

    }


    /* ---------------------------------------------
       CONFIRMED TEAMS
    --------------------------------------------- */

    const confirmed =
      confirmedRegistrations(
        lobby.id
      );

    if (confirmed.length !== 12) {

      return res
        .status(400)
        .json({
          error:
            `This lobby has ${confirmed.length}/12 confirmed teams. Exactly 12 teams are required.`
        });

    }


    /* ---------------------------------------------
       UNIQUE TEAM LIST
    --------------------------------------------- */

    const confirmedTeamMap =
      new Map();

    confirmed.forEach(
      registration => {

        const key =
          String(
            registration.team
          )
            .trim()
            .toLowerCase();

        confirmedTeamMap.set(
          key,
          registration.team
        );

      }
    );


    if (
      confirmedTeamMap.size !==
      confirmed.length
    ) {

      return res
        .status(400)
        .json({
          error:
            "This lobby contains duplicate team names. Fix the registrations before entering scores."
        });

    }


    const enteredTeams =
      new Set();

    const positions =
      new Set();

    const cleanedEntries = [];


    /* ---------------------------------------------
       VALIDATE EVERY ENTRY
    --------------------------------------------- */

    for (
      const entry of entries
    ) {

      const team =
        String(
          entry.team || ""
        ).trim();

      const teamKey =
        team.toLowerCase();

      const position =
        Number(
          entry.position
        );

      const kills =
        Number(
          entry.kills
        );


      /* TEAM */

      if (!team) {

        return res
          .status(400)
          .json({
            error:
              "Every score row must have a team."
          });

      }

      if (
        !confirmedTeamMap.has(
          teamKey
        )
      ) {

        return res
          .status(400)
          .json({
            error:
              `Team "${team}" is not assigned to this lobby.`
          });

      }

      if (
        enteredTeams.has(
          teamKey
        )
      ) {

        return res
          .status(400)
          .json({
            error:
              `Team "${team}" appears more than once in this match.`
          });

      }


      /* POSITION */

      if (
        !Number.isInteger(position) ||
        position < 1 ||
        position > 12
      ) {

        return res
          .status(400)
          .json({
            error:
              "Positions must be unique numbers from 1 to 12."
          });

      }

      if (
        positions.has(position)
      ) {

        return res
          .status(400)
          .json({
            error:
              `Position ${position} is used more than once.`
          });

      }


      /* KILLS */

      if (
        !Number.isInteger(kills) ||
        kills < 0
      ) {

        return res
          .status(400)
          .json({
            error:
              "Kills must be whole numbers greater than or equal to zero."
          });

      }


      /* ---------------------------------------------
         CALCULATE
      --------------------------------------------- */

      const placement =
        placementPoints(
          position
        );

      const killsPoints =
        killPoints(
          kills
        );

      const booyah =
        isBooyah(
          position
        );

      const total =
        placement +
        killsPoints;


      enteredTeams.add(
        teamKey
      );

      positions.add(
        position
      );


      cleanedEntries.push({

        team:
          confirmedTeamMap.get(
            teamKey
          ),

        position,

        kills,

        booyah,

        placement_points:
          placement,

        kill_points:
          killsPoints,

        total_points:
          total

      });

    }


    /* ---------------------------------------------
       ENSURE ALL 12 POSITIONS EXIST
    --------------------------------------------- */

    for (
      let position = 1;
      position <= 12;
      position++
    ) {

      if (
        !positions.has(position)
      ) {

        return res
          .status(400)
          .json({
            error:
              `Position ${position} is missing. Positions 1 to 12 must all be used exactly once.`
          });

      }

    }


    /* ---------------------------------------------
       ENSURE ALL 12 TEAMS EXIST
    --------------------------------------------- */

    if (
      enteredTeams.size !== 12
    ) {

      return res
        .status(400)
        .json({
          error:
            "Exactly 12 unique teams are required."
        });

    }


    /* ---------------------------------------------
       REMOVE OLD VERSION OF THIS MATCH
       BEFORE SAVING UPDATED VERSION
    --------------------------------------------- */

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


    /* ---------------------------------------------
       SAVE NEW RESULTS
    --------------------------------------------- */

    cleanedEntries.forEach(
      entry => {

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

      }
    );


    saveDB();


    /* ---------------------------------------------
       RETURN CALCULATED RESULTS
    --------------------------------------------- */

    res.json({

      ok: true,

      lobby:
        lobby.name,

      match:
        match,

      entries:
        cleanedEntries

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
      lobbyByName(
        req.query.lobby
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
      new Map();


    db.scores

      .filter(
        score =>
          Number(score.lobby_id) ===
          Number(lobby.id)
      )

      .forEach(
        score => {

          const key =
            String(
              score.team
            )
              .trim()
              .toLowerCase();


          if (
            !teams.has(key)
          ) {

            teams.set(
              key,
              {

                team:
                  score.team,

                matchesPlayed:
                  0,

                booyahs:
                  0,

                placementPoints:
                  0,

                killPoints:
                  0,

                totalPoints:
                  0

              }
            );

          }


          const team =
            teams.get(key);


          team.matchesPlayed += 1;

          team.booyahs +=
            Number(
              score.booyah
            ) || (
              Number(
                score.position
              ) === 1
                ? 1
                : 0
            );

          team.placementPoints +=
            Number(
              score.placement_points
            ) || 0;

          team.killPoints +=
            Number(
              score.kill_points
            ) || 0;

          team.totalPoints +=
            Number(
              score.total_points
            ) ||
            (
              Number(
                score.placement_points
              ) +
              Number(
                score.kill_points
              )
            );

        }
      );


    const rows =
      [...teams.values()]


        .sort(
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
        id:
          lobby.id,

        name:
          lobby.name,

        time:
          lobby.time,

        fee:
          lobby.fee
      },

      rows

    });

  }
);


/* =====================================================
   FALLBACK
===================================================== */

app.get(
  "*",
  (req, res) => {

    res.sendFile(
      path.join(
        __dirname,
        "index.html"
      )
    );

  }
);


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
