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


function loadDB() {

  if (!fs.existsSync(DATA_FILE)) {

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

  try {

    const data =
      JSON.parse(
        fs.readFileSync(
          DATA_FILE,
          "utf8"
        )
      );

    return {

      nextLobbyId:
        data.nextLobbyId || 1,

      nextRegistrationId:
        data.nextRegistrationId || 1,

      nextScoreId:
        data.nextScoreId || 1,

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

  } catch {

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
    .update(
      String(password)
    )
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
    ? decodeURIComponent(
        match[1]
      )
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

  req.admin =
    admin;

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
      String(lobby.name) ===
      String(name)
  );

}


function confirmedCount(lobbyId) {

  return db.registrations
    .filter(
      registration =>
        Number(
          registration.lobby_id
        ) === Number(lobbyId) &&
        registration.status ===
          "confirmed"
    )
    .length;

}


function publicLobby(lobby) {

  return {

    id:
      lobby.id,

    name:
      lobby.name,

    time:
      lobby.time,

    fee:
      lobby.fee,

    max_teams:
      lobby.max_teams,

    status:
      lobby.status,

    confirmed:
      confirmedCount(
        lobby.id
      )

  };

}


/* =====================================================
   PLACEMENT POINTS
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
    table[
      Number(position)
    ] || 0
  );

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
      crypto.randomBytes(32)
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
      name:
        admin.name
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
          String(
            email || ""
          )
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
      crypto.randomBytes(32)
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
      name:
        admin.name
    });

  }
);


app.post(
  "/api/logout",
  (req, res) => {

    const token =
      getToken(req);

    if (token) {

      sessions.delete(
        token
      );

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


/* =====================================================
   CREATE LOBBY
===================================================== */

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

    const max =
      Number(maxTeams);

    if (
      !name ||
      !time ||
      !fee ||
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
        String(name).trim(),

      time:
        String(time).trim(),

      fee:
        String(fee).trim(),

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


/* =====================================================
   OPEN / CLOSE LOBBY
===================================================== */

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
      ].includes(
        req.body.status
      )
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
   DELETE SCRIM
===================================================== */

app.delete(
  "/api/lobbies/:id",
  requireAdmin,
  (req, res) => {

    const id =
      Number(
        req.params.id
      );

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
        lobby =>
          Number(lobby.id) !==
          id
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
   IMPORTANT:
   USER SENDS ONLY lobbyId + DETAILS.
   TIME AND FEE COME FROM THE SERVER.
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
            "Please select a scrim category and fill all required details."
        });

    }

    const lobby =
      lobbyById(lobbyId);

    if (!lobby) {

      return res
        .status(404)
        .json({
          error:
            "Selected scrim category was not found."
        });

    }

    if (
      lobby.status !==
      "open"
    ) {

      return res
        .status(400)
        .json({
          error:
            "This scrim is currently closed."
        });

    }

    if (
      confirmedCount(
        lobby.id
      ) >=
      Number(
        lobby.max_teams
      )
    ) {

      return res
        .status(400)
        .json({
          error:
            "This scrim is already full."
        });

    }

    const row = {

      id:
        db.nextRegistrationId++,

      ref:
        makeRef(),

      /*
        The user cannot choose these values.
        They are copied directly from the
        selected lobby.
      */

      time:
        String(lobby.time),

      fee:
        String(lobby.fee),

      /*
        Category selected by user.
      */

      category_lobby_id:
        lobby.id,

      team:
        String(team).trim(),

      captain:
        String(captain).trim(),

      phone:
        String(phone).trim(),

      uid:
        String(uid).trim(),

      /*
        EVERY new registration starts pending.
      */

      status:
        "pending",

      /*
        Admin can later assign the confirmed
        registration to an actual lobby.
      */

      lobby_id:
        null,

      created_at:
        new Date().toISOString()

    };

    db.registrations.push(
      row
    );

    /*
      This is the important part:
      registration is saved immediately.
      It does NOT depend on the admin
      being online.
    */

    saveDB();

    res.json({

      ok: true,

      ref:
        row.ref,

      status:
        row.status,

      category:
        lobby.name,

      time:
        lobby.time,

      fee:
        lobby.fee

    });

  }
);


/* =====================================================
   CHECK REGISTRATION STATUS
===================================================== */

app.get(
  "/api/registration-status/:ref",
  (req, res) => {

    const ref =
      String(
        req.params.ref || ""
      ).trim();

    const row =
      db.registrations.find(
        registration =>
          String(
            registration.ref
          ).toLowerCase() ===
          ref.toLowerCase()
      );

    if (!row) {

      return res
        .status(404)
        .json({
          error:
            "Registration reference not found."
        });

    }

    const assignedLobby =
      row.lobby_id
        ? lobbyById(
            row.lobby_id
          )
        : null;

    const categoryLobby =
      row.category_lobby_id
        ? lobbyById(
            row.category_lobby_id
          )
        : null;

    res.json({

      ok: true,

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

      /*
        ALWAYS return current status.
      */

      status:
        row.status,

      /*
        Category originally selected.
      */

      category:
        categoryLobby
          ? categoryLobby.name
          : null,

      /*
        Actual lobby assigned by admin.
      */

      lobby_name:
        assignedLobby
          ? assignedLobby.name
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

    const registrations =
      db.registrations.map(
        row => {

          const assignedLobby =
            row.lobby_id
              ? lobbyById(
                  row.lobby_id
                )
              : null;

          const categoryLobby =
            row.category_lobby_id
              ? lobbyById(
                  row.category_lobby_id
                )
              : null;

          return {

            ...row,

            category_name:
              categoryLobby
                ? categoryLobby.name
                : null,

            assigned_lobby_name:
              assignedLobby
                ? assignedLobby.name
                : null

          };

        }
      );

    res.json(
      registrations
    );

  }
);


/* =====================================================
   CONFIRM / REJECT REGISTRATION
===================================================== */

app.patch(
  "/api/registrations/:id",
  requireAdmin,
  (req, res) => {

    const row =
      db.registrations.find(
        registration =>
          Number(
            registration.id
          ) ===
          Number(
            req.params.id
          )
      );

    if (!row) {

      return res
        .status(404)
        .json({
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

      return res
        .status(400)
        .json({
          error:
            "Invalid registration status."
        });

    }

    /*
      Save the status permanently.
    */

    row.status =
      status;

    /*
      A rejected registration cannot
      stay assigned to a lobby.
    */

    if (
      status ===
      "rejected"
    ) {

      row.lobby_id =
        null;

    }

    saveDB();

    res.json({

      ok: true,

      id:
        row.id,

      status:
        row.status,

      lobby_id:
        row.lobby_id

    });

  }
);


/* =====================================================
   ASSIGN CONFIRMED REGISTRATION TO LOBBY
===================================================== */

app.patch(
  "/api/registrations/:id/lobby",
  requireAdmin,
  (req, res) => {

    const row =
      db.registrations.find(
        registration =>
          Number(
            registration.id
          ) ===
          Number(
            req.params.id
          )
      );

    if (!row) {

      return res
        .status(404)
        .json({
          error:
            "Registration not found."
        });

    }

    /*
      Only confirmed registrations
      can enter an actual lobby.
    */

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

    const count =
      confirmedCount(
        lobby.id
      );

    /*
      If this registration is already
      in this same lobby, don't count it
      as a new team.
    */

    if (
      count >=
        Number(
          lobby.max_teams
        ) &&
      Number(
        row.lobby_id
      ) !==
        Number(
          lobby.id
        )
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

    saveDB();

    res.json({

      ok: true,

      registrationId:
        row.id,

      lobbyId:
        lobby.id,

      lobbyName:
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
        db.registrations
          .filter(
            r =>
              r.status ===
              "pending"
          )
          .length,

      confirmed:
        db.registrations
          .filter(
            r =>
              r.status ===
              "confirmed"
          )
          .length,

      activeLobbies:
        db.lobbies
          .filter(
            lobby =>
              lobby.status ===
              "open"
          )
          .length

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
      db.registrations

        .filter(
          registration =>
            Number(
              registration.lobby_id
            ) ===
            Number(
              lobby.id
            ) &&
            registration.status ===
              "confirmed"
        )

        .map(
          registration => ({
            team:
              registration.team
          })
        );

    res.json(
      teams
    );

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
      Number(
        req.query.match
      );

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
            Number(
              score.lobby_id
            ) ===
            Number(
              lobby.id
            ) &&
            Number(
              score.match_no
            ) ===
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
              score.position,

            kills:
              score.kills,

            placement_points:
              score.placement_points,

            kill_points:
              score.kill_points,

            total_points:
              score.placement_points +
              score.kill_points

          })
        );

    res.json(
      rows
    );

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
      Number(
        matchNo
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

    const confirmed =
      db.registrations.filter(
        registration =>
          Number(
            registration.lobby_id
          ) ===
          Number(
            lobby.id
          ) &&
          registration.status ===
            "confirmed"
      );

    if (
      confirmed.length !==
      12
    ) {

      return res
        .status(400)
        .json({
          error:
            `This lobby has ${confirmed.length}/12 confirmed teams.`
        });

    }

    const names =
      new Set(
        confirmed.map(
          registration =>
            registration.team
        )
      );

    const positions =
      new Set();

    for (
      const entry
      of entries
    ) {

      const position =
        Number(
          entry.position
        );

      const kills =
        Number(
          entry.kills
        );

      if (
        !names.has(
          entry.team
        )
      ) {

        return res
          .status(400)
          .json({
            error:
              `Team ${entry.team} is not assigned to this lobby.`
          });

      }

      if (
        !Number.isInteger(
          position
        ) ||
        position < 1 ||
        position > 12 ||
        positions.has(
          position
        )
      ) {

        return res
          .status(400)
          .json({
            error:
              "Positions must be unique and range from 1 to 12."
          });

      }

      if (
        !Number.isFinite(
          kills
        ) ||
        kills < 0
      ) {

        return res
          .status(400)
          .json({
            error:
              "Kills must be zero or more."
          });

      }

      positions.add(
        position
      );

    }


    db.scores =
      db.scores.filter(
        score =>
          !(
            Number(
              score.lobby_id
            ) ===
            Number(
              lobby.id
            ) &&
            Number(
              score.match_no
            ) ===
            match
          )
      );


    for (
      const entry
      of entries
    ) {

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
          Number(
            entry.position
          ),

        kills:
          Number(
            entry.kills
          ),

        placement_points:
          placementPoints(
            entry.position
          ),

        kill_points:
          Number(
            entry.kills
          )

      });

    }

    saveDB();

    res.json({
      ok: true
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
          Number(
            score.lobby_id
          ) ===
          Number(
            lobby.id
          )
      )

      .forEach(
        score => {

          if (
            !teams.has(
              score.team
            )
          ) {

            teams.set(
              score.team,
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
            teams.get(
              score.team
            );

          team.matchesPlayed++;

          team.booyahs +=
            Number(
              score.position
            ) === 1
              ? 1
              : 0;

          team.placementPoints +=
            Number(
              score.placement_points
            );

          team.killPoints +=
            Number(
              score.kill_points
            );

          team.totalPoints +=
            Number(
              score.placement_points
            ) +
            Number(
              score.kill_points
            );

        }
      );


    const rows =
      [
        ...teams.values()
      ]

      .sort(
        (a, b) =>
          b.totalPoints -
          a.totalPoints ||

          b.killPoints -
          a.killPoints ||

          b.placementPoints -
          a.placementPoints
      );


    rows.forEach(
      (row, index) => {

        row.position =
          index + 1;

      }
    );


    res.json(
      rows
    );

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
   START SERVER
===================================================== */

app.listen(
  PORT,
  () => {

    console.log(
      `ScrimForge running on port ${PORT}`
    );

  }
);
