/* =========================================================
   SCRIMFORGE V4
   APP.JS
   ========================================================= */

"use strict";


/* =========================================================
   GLOBAL STATE
========================================================= */

let currentScoreMatch = 1;
let leaderboardTimer = null;
let selectedRegistrationLobby = null;


/* =========================================================
   PAGE NAVIGATION
========================================================= */

function showPage(pageId){

  document
    .querySelectorAll(".page")
    .forEach(page => {
      page.classList.remove("active");
    });

  const page =
    document.getElementById(pageId);

  if(page){
    page.classList.add("active");
  }

  if(pageId === "home"){
    loadPublicLobbies("homeLobbies");
  }

  if(pageId === "scrims"){
    loadPublicLobbies("scrimList");
  }

  if(pageId === "leaderboard"){
    loadLeaderboardLobbyOptions();
  }

  if(pageId === "admin"){
    checkAdmin();
  }

  window.scrollTo({
    top:0,
    behavior:"smooth"
  });
}


/* =========================================================
   MESSAGE SYSTEM
========================================================= */

function showMessage(
  id,
  text,
  type = "success"
){

  const element =
    document.getElementById(id);

  if(!element) return;

  element.textContent =
    String(text || "");

  element.className =
    "message show " + type;
}


/* =========================================================
   API HELPER
   IMPROVED ERROR HANDLING
========================================================= */

async function api(
  url,
  options = {}
){

  const finalOptions = {
    credentials:"same-origin",
    ...options,
    headers:{
      "Accept":"application/json",
      ...(options.body
        ? {
            "Content-Type":
              "application/json"
          }
        : {}),
      ...(options.headers || {})
    }
  };

  let response;

  try{

    response =
      await fetch(
        url,
        finalOptions
      );

  }catch(error){

    console.error(
      "FETCH ERROR:",
      error
    );

    throw new Error(
      "Unable to connect to the server. Please check that the website server is running."
    );

  }


  /*
    Read the response as text first.

    This is important because some server
    errors may return HTML/plain text instead
    of JSON.
  */

  let rawText = "";

  try{

    rawText =
      await response.text();

  }catch(error){

    console.error(
      "Response reading error:",
      error
    );

  }


  let data = null;


  if(rawText){

    try{

      data =
        JSON.parse(rawText);

    }catch(error){

      data = null;

    }

  }


  /*
    IMPORTANT:

    Do not hide the real HTTP status.

    Example:
    401 = invalid login
    403 = forbidden
    404 = route missing
    500 = server error
  */

  if(!response.ok){

    console.error(
      "API ERROR:",
      {
        url,
        status:response.status,
        statusText:response.statusText,
        body:rawText
      }
    );


    const serverMessage =
      data?.error ||
      data?.message ||
      rawText?.trim();


    if(serverMessage){

      throw new Error(
        `HTTP ${response.status}: ${serverMessage}`
      );

    }


    throw new Error(
      `HTTP ${response.status}: ${
        response.statusText ||
        "Request failed"
      }`
    );

  }


  /*
    Successful response.

    Some endpoints may return an empty
    response, so don't force JSON.
  */

  if(!rawText){

    return {};

  }


  if(data !== null){

    return data;

  }


  /*
    Successful plain-text response.
  */

  return {
    message:rawText
  };

}


/* =========================================================
   PUBLIC LOBBIES
========================================================= */

async function loadPublicLobbies(
  targetId = "homeLobbies"
){

  const target =
    document.getElementById(targetId);

  if(!target) return;

  target.innerHTML =
    '<p class="muted">Loading lobbies...</p>';

  try{

    const lobbies =
      await api(
        "/api/public/lobbies"
      );

    if(
      !Array.isArray(lobbies) ||
      !lobbies.length
    ){

      target.innerHTML =
        `
        <div class="card">
          <p class="muted">
            No lobbies available right now.
          </p>
        </div>
        `;

      return;
    }


    target.innerHTML =
      lobbies.map(
        lobby => {

          const confirmed =
            Number(
              lobby.confirmed || 0
            );

          const maxTeams =
            Number(
              lobby.max_teams || 0
            );

          const full =
            maxTeams > 0 &&
            confirmed >= maxTeams;

          const open =
            String(
              lobby.status || ""
            ).toLowerCase() === "open";


          return `
            <div class="card lobby-card">

              <span class="badge ${
                open
                  ? "open"
                  : "closed"
              }">

                ${
                  open
                    ? "OPEN"
                    : "CLOSED"
                }

              </span>

              <h3>
                ${escapeHTML(lobby.name)}
              </h3>

              <p>
                <strong>Time:</strong>
                ${escapeHTML(lobby.time)}
              </p>

              <p>
                <strong>Entry:</strong>
                ${escapeHTML(lobby.fee)}
              </p>

              <p>
                <strong>Teams:</strong>
                ${confirmed}/${maxTeams}
              </p>

              <br>

              ${
                open && !full

                ?

                `
                <button
                  class="btn small"
                  onclick="useLobby(
                    ${Number(lobby.id)}
                  )"
                >
                  Register
                </button>
                `

                :

                `
                <button
                  class="btn small secondary"
                  disabled
                >
                  ${
                    full
                      ? "FULL"
                      : "CLOSED"
                  }
                </button>
                `
              }

            </div>
          `;

        }
      ).join("");

  }catch(error){

    console.error(
      "Public lobby error:",
      error
    );

    target.innerHTML =
      `
      <div class="card">

        <p class="muted">
          ${escapeHTML(error.message)}
        </p>

      </div>
      `;

  }
}


/* =========================================================
   SELECT LOBBY
========================================================= */

async function useLobby(
  lobbyId
){

  if(!lobbyId){

    showPage("scrims");

    return;
  }

  try{

    const lobbies =
      await api(
        "/api/public/lobbies"
      );

    const lobby =
      lobbies.find(
        item =>
          Number(item.id) ===
          Number(lobbyId)
      );

    if(!lobby){

      alert(
        "This lobby is no longer available."
      );

      return;
    }

    if(
      String(lobby.status).toLowerCase()
      !== "open"
    ){

      alert(
        "This lobby is currently closed."
      );

      return;
    }


    const confirmed =
      Number(lobby.confirmed || 0);

    const maxTeams =
      Number(lobby.max_teams || 0);

    if(
      maxTeams > 0 &&
      confirmed >= maxTeams
    ){

      alert(
        "This lobby is full."
      );

      return;
    }


    selectedRegistrationLobby = {
      id:Number(lobby.id),
      name:String(lobby.name || ""),
      time:String(lobby.time || ""),
      fee:String(lobby.fee || "")
    };


    const lobbyInput =
      document.getElementById(
        "regLobbyId"
      );

    const timeInput =
      document.getElementById(
        "regTime"
      );

    const feeInput =
      document.getElementById(
        "regFee"
      );


    if(lobbyInput){
      lobbyInput.value =
        selectedRegistrationLobby.id;
    }


    if(timeInput){

      timeInput.value =
        selectedRegistrationLobby.time;

      timeInput.readOnly = true;

      timeInput.setAttribute(
        "readonly",
        "readonly"
      );

    }


    if(feeInput){

      feeInput.value =
        selectedRegistrationLobby.fee;

      feeInput.readOnly = true;

      feeInput.setAttribute(
        "readonly",
        "readonly"
      );

    }


    showPage("register");

  }catch(error){

    alert(
      error.message
    );

  }
}


/* =========================================================
   REGISTRATION
========================================================= */

const registrationForm =
  document.getElementById(
    "registrationForm"
  );

if(registrationForm){

  registrationForm.addEventListener(
    "submit",
    async event => {

      event.preventDefault();


      const lobbyId =
        document.getElementById(
          "regLobbyId"
        )?.value;


      if(!lobbyId){

        showMessage(
          "registerMessage",
          "Please select a lobby first.",
          "error"
        );

        return;
      }


      try{

        const data =
          await api(
            "/api/registrations",
            {
              method:"POST",

              body:JSON.stringify({

                lobbyId:
                  Number(lobbyId),

                team:
                  document.getElementById(
                    "regTeam"
                  ).value.trim(),

                captain:
                  document.getElementById(
                    "regCaptain"
                  ).value.trim(),

                phone:
                  document.getElementById(
                    "regPhone"
                  ).value.trim(),

                uid:
                  document.getElementById(
                    "regUid"
                  ).value.trim()

              })
            }
          );


        showMessage(
          "registerMessage",
          data.ref
            ? `Registration submitted successfully. Your reference is ${data.ref}`
            : "Registration submitted successfully."
        );


        registrationForm.reset();

        selectedRegistrationLobby =
          null;


      }catch(error){

        showMessage(
          "registerMessage",
          error.message,
          "error"
        );

      }

    }
  );

}


/* =========================================================
   STATUS
========================================================= */

async function checkStatus(){

  const input =
    document.getElementById(
      "statusRef"
    );

  const result =
    document.getElementById(
      "statusResult"
    );

  if(!input) return;


  const ref =
    input.value.trim();


  if(!ref){

    showMessage(
      "statusMessage",
      "Please enter your registration reference.",
      "error"
    );

    return;
  }


  try{

    const data =
      await api(
        `/api/registration-status/${encodeURIComponent(ref)}`
      );


    showMessage(
      "statusMessage",
      "Registration found."
    );


    if(result){

      result.innerHTML =
        `
        <div class="card">

          <h3>
            ${escapeHTML(data.team)}
          </h3>

          <p>
            <strong>Reference:</strong>
            ${escapeHTML(data.ref)}
          </p>

          <p>
            <strong>Time:</strong>
            ${escapeHTML(data.time)}
          </p>

          <p>
            <strong>Fee:</strong>
            ${escapeHTML(data.fee)}
          </p>

          <p>
            <strong>Status:</strong>
            ${escapeHTML(data.status)}
          </p>

          <p>
            <strong>Lobby:</strong>
            ${
              data.lobby_name
                ? escapeHTML(data.lobby_name)
                : "Not assigned yet"
            }
          </p>

        </div>
        `;

    }

  }catch(error){

    showMessage(
      "statusMessage",
      error.message,
      "error"
    );

    if(result){
      result.innerHTML = "";
    }

  }
}


/* =========================================================
   ADMIN CHECK
========================================================= */

async function checkAdmin(){

  try{

    const exists =
      await api(
        "/api/admin-exists"
      );


    const me =
      await api(
        "/api/me"
      );


    const loginBox =
      document.getElementById(
        "adminLoginBox"
      );

    const setupBox =
      document.getElementById(
        "adminSetupBox"
      );

    const dashboard =
      document.getElementById(
        "adminDashboard"
      );


    /*
      FIRST ADMIN:
      show setup

      ADMIN EXISTS:
      show login

      LOGGED IN:
      show dashboard
    */

    if(setupBox){

      setupBox.classList.toggle(
        "hidden",
        Boolean(exists.exists)
      );

    }


    if(loginBox){

      loginBox.classList.toggle(
        "hidden",
        !exists.exists ||
        Boolean(me.loggedIn)
      );

    }


    if(dashboard){

      dashboard.classList.toggle(
        "hidden",
        !me.loggedIn
      );

    }


    if(me.loggedIn){

      showAdminDashboard(
        me.name
      );

    }

  }catch(error){

    console.error(
      "Admin check failed:",
      error
    );


    const loginMessage =
      document.getElementById(
        "loginMessage"
      );


    if(loginMessage){

      showMessage(
        "loginMessage",
        error.message,
        "error"
      );

    }

  }
}


/* =========================================================
   ADMIN DASHBOARD
========================================================= */

function showAdminDashboard(
  name
){

  document
    .getElementById(
      "adminLoginBox"
    )
    ?.classList.add(
      "hidden"
    );


  document
    .getElementById(
      "adminSetupBox"
    )
    ?.classList.add(
      "hidden"
    );


  document
    .getElementById(
      "adminDashboard"
    )
    ?.classList.remove(
      "hidden"
    );


  const nameElement =
    document.getElementById(
      "adminName"
    );


  if(nameElement){

    nameElement.textContent =
      name || "Admin";

  }


  loadAdminData();
}


/* =========================================================
   ADMIN SETUP
========================================================= */

const setupForm =
  document.getElementById(
    "setupForm"
  );


if(setupForm){

  setupForm.addEventListener(
    "submit",
    async event => {

      event.preventDefault();


      try{

        const data =
          await api(
            "/api/setup-admin",
            {
              method:"POST",

              body:JSON.stringify({

                name:
                  document.getElementById(
                    "setupName"
                  ).value.trim(),

                email:
                  document.getElementById(
                    "setupEmail"
                  ).value.trim(),

                password:
                  document.getElementById(
                    "setupPassword"
                  ).value

              })
            }
          );


        showAdminDashboard(
          data.name
        );


      }catch(error){

        showMessage(
          "setupMessage",
          error.message,
          "error"
        );

      }

    }
  );

}


/* =========================================================
   LOGIN
========================================================= */

const loginForm =
  document.getElementById(
    "loginForm"
  );


if(loginForm){

  loginForm.addEventListener(
    "submit",
    async event => {

      event.preventDefault();


      const loginButton =
        loginForm.querySelector(
          'button[type="submit"]'
        );


      const loginMessage =
        document.getElementById(
          "loginMessage"
        );


      if(loginButton){

        loginButton.disabled =
          true;

        loginButton.textContent =
          "Logging in...";

      }


      if(loginMessage){

        loginMessage.className =
          "message";

        loginMessage.textContent =
          "";

      }


      try{

        const email =
          document.getElementById(
            "loginEmail"
          )?.value
          .trim();


        const password =
          document.getElementById(
            "loginPassword"
          )?.value;


        if(!email || !password){

          throw new Error(
            "Please enter both email and password."
          );

        }


        console.log(
          "Attempting admin login..."
        );


        const data =
          await api(
            "/api/login",
            {
              method:"POST",

              body:JSON.stringify({

                email,
                password

              })
            }
          );


        console.log(
          "Admin login response:",
          data
        );


        showAdminDashboard(
          data.name || "Admin"
        );


        loginForm.reset();


      }catch(error){

        console.error(
          "ADMIN LOGIN ERROR:",
          error
        );


        showMessage(
          "loginMessage",
          error.message ||
            "Login failed.",
          "error"
        );


      }finally{

        if(loginButton){

          loginButton.disabled =
            false;

          loginButton.textContent =
            "Login";

        }

      }

    }
  );

}


/* =========================================================
   LOGOUT
========================================================= */

async function logout(){

  try{

    await api(
      "/api/logout",
      {
        method:"POST"
      }
    );


    document
      .getElementById(
        "adminDashboard"
      )
      ?.classList.add(
        "hidden"
      );


    showPage("admin");

    await checkAdmin();


  }catch(error){

    alert(
      error.message
    );

  }
}


/* =========================================================
   ADMIN DATA
========================================================= */

async function loadAdminData(){

  try{

    await Promise.all([
      loadStats(),
      loadAdminLobbies(),
      loadRegistrations()
    ]);


    await loadScoreLobbyOptions();


  }catch(error){

    console.error(
      "Admin data error:",
      error
    );

  }
}


/* =========================================================
   INDIVIDUAL REFRESH BUTTONS
========================================================= */

async function refreshStatsPanel(){

  const button =
    event?.currentTarget;

  setRefreshLoading(
    button,
    true
  );


  try{

    await loadStats();

  }finally{

    setRefreshLoading(
      button,
      false
    );

  }

}


async function refreshLobbyPanel(){

  const button =
    event?.currentTarget;

  setRefreshLoading(
    button,
    true
  );


  try{

    await loadAdminLobbies();
    await loadStats();
    await loadScoreLobbyOptions();


  }finally{

    setRefreshLoading(
      button,
      false
    );

  }

}


async function refreshRegistrationPanel(){

  const button =
    event?.currentTarget;

  setRefreshLoading(
    button,
    true
  );


  try{

    await loadRegistrations();
    await loadStats();


  }finally{

    setRefreshLoading(
      button,
      false
    );

  }

}


async function refreshScorePanel(){

  const button =
    event?.currentTarget;

  setRefreshLoading(
    button,
    true
  );


  try{

    await loadScoreLobbyOptions();
    await renderScoreEntry();


  }finally{

    setRefreshLoading(
      button,
      false
    );

  }

}


function setRefreshLoading(
  button,
  loading
){

  if(!button) return;


  if(loading){

    button.dataset.originalText =
      button.textContent;

    button.textContent =
      "⟳ Loading...";

    button.disabled =
      true;

  }else{

    button.textContent =
      button.dataset.originalText ||
      "🔄 Refresh";

    button.disabled =
      false;

  }

}


/* =========================================================
   ADMIN STATS
========================================================= */

async function loadStats(){

  try{

    const stats =
      await api(
        "/api/stats"
      );


    const pending =
      document.getElementById(
        "pendingCount"
      );

    const confirmed =
      document.getElementById(
        "confirmedCount"
      );

    const active =
      document.getElementById(
        "activeLobbyCount"
      );


    if(pending)
      pending.textContent =
        Number(
          stats.pending || 0
        );


    if(confirmed)
      confirmed.textContent =
        Number(
          stats.confirmed || 0
        );


    if(active)
      active.textContent =
        Number(
          stats.activeLobbies || 0
        );


  }catch(error){

    console.error(
      "Stats error:",
      error
    );

  }
}


/* =========================================================
   CREATE LOBBY
========================================================= */

const lobbyForm =
  document.getElementById(
    "lobbyForm"
  );


if(lobbyForm){

  lobbyForm.addEventListener(
    "submit",
    async event => {

      event.preventDefault();


      try{

        await api(
          "/api/lobbies",
          {
            method:"POST",

            body:JSON.stringify({

              name:
                document.getElementById(
                  "lobbyName"
                ).value.trim(),

              time:
                document.getElementById(
                  "lobbyTime"
                ).value.trim(),

              fee:
                document.getElementById(
                  "lobbyFee"
                ).value.trim(),

              maxTeams:
                Number(
                  document.getElementById(
                    "lobbyMaxTeams"
                  ).value
                )

            })
          }
        );


        showMessage(
          "lobbyMessage",
          "Lobby created successfully."
        );


        lobbyForm.reset();


        const maxTeams =
          document.getElementById(
            "lobbyMaxTeams"
          );


        if(maxTeams){

          maxTeams.value =
            12;

        }


        await refreshAllLobbyData();


      }catch(error){

        showMessage(
          "lobbyMessage",
          error.message,
          "error"
        );

      }

    }
  );

}


/* =========================================================
   LOBBY DATA REFRESH
========================================================= */

async function refreshAllLobbyData(){

  await loadAdminLobbies();
  await loadStats();
  await loadScoreLobbyOptions();

  await loadPublicLobbies(
    "homeLobbies"
  );

  await loadPublicLobbies(
    "scrimList"
  );

}


/* =========================================================
   ADMIN LOBBIES
========================================================= */

async function loadAdminLobbies(){

  const target =
    document.getElementById(
      "adminLobbies"
    );


  if(!target) return;


  try{

    const lobbies =
      await api(
        "/api/lobbies"
      );


    if(
      !Array.isArray(lobbies) ||
      !lobbies.length
    ){

      target.innerHTML =
        `
        <div class="card">
          <p class="muted">
            No lobbies created yet.
          </p>
        </div>
        `;

      return;
    }


    target.innerHTML =
      lobbies.map(
        lobby => {

          const open =
            String(
              lobby.status || ""
            ).toLowerCase() === "open";


          return `
            <div class="card">

              <span class="badge ${
                open
                  ? "open"
                  : "closed"
              }">

                ${
                  open
                    ? "OPEN"
                    : "CLOSED"
                }

              </span>


              <h3>
                ${escapeHTML(
                  lobby.name
                )}
              </h3>


              <p>
                <strong>Time:</strong>
                ${escapeHTML(
                  lobby.time
                )}
              </p>


              <p>
                <strong>Fee:</strong>
                ${escapeHTML(
                  lobby.fee
                )}
              </p>


              <p>
                <strong>Teams:</strong>
                ${Number(
                  lobby.confirmed || 0
                )}
                /
                ${Number(
                  lobby.max_teams || 0
                )}
              </p>


              <br>


              <div
                style="
                  display:flex;
                  gap:8px;
                  flex-wrap:wrap;
                "
              >

                <button
                  class="btn small ${
                    open
                      ? "danger"
                      : "success"
                  }"
                  onclick="toggleLobby(
                    ${Number(lobby.id)},
                    '${escapeAttribute(
                      lobby.status
                    )}'
                  )"
                >

                  ${
                    open
                      ? "Close Lobby"
                      : "Open Lobby"
                  }

                </button>


                <button
                  class="btn small danger-outline"
                  onclick="deleteLobby(
                    ${Number(lobby.id)},
                    '${escapeAttribute(
                      lobby.name
                    )}'
                  )"
                >

                  Delete Scrim

                </button>

              </div>

            </div>
          `;

        }
      ).join("");


  }catch(error){

    target.innerHTML =
      `
      <div class="card">
        <p class="muted">
          ${escapeHTML(
            error.message
          )}
        </p>
      </div>
      `;

  }
}


/* =========================================================
   TOGGLE LOBBY
========================================================= */

async function toggleLobby(
  id,
  currentStatus
){

  try{

    await api(
      `/api/lobbies/${id}`,
      {
        method:"PATCH",

        body:JSON.stringify({

          status:
            String(currentStatus)
              .toLowerCase() === "open"
              ? "closed"
              : "open"

        })
      }
    );


    await refreshAllLobbyData();


  }catch(error){

    alert(
      error.message
    );

  }
}


/* =========================================================
   DELETE LOBBY
========================================================= */

async function deleteLobby(
  id,
  name
){

  const confirmed =
    confirm(
      `Delete "${name}" permanently?\n\nThis will delete the scrim and its linked registrations and match scores. This cannot be undone.`
    );


  if(!confirmed) return;


  try{

    await api(
      `/api/lobbies/${id}`,
      {
        method:"DELETE"
      }
    );


    alert(
      "Scrim deleted successfully."
    );


    await loadAdminLobbies();
    await loadRegistrations();
    await loadStats();
    await loadScoreLobbyOptions();

    await loadPublicLobbies(
      "homeLobbies"
    );

    await loadPublicLobbies(
      "scrimList"
    );

    await loadLeaderboardLobbyOptions();


  }catch(error){

    alert(
      error.message
    );

  }
}


/* =========================================================
   REGISTRATIONS
========================================================= */

async function loadRegistrations(){

  const tbody =
    document.getElementById(
      "registrationTable"
    );


  if(!tbody) return;


  try{

    const rows =
      await api(
        "/api/registrations"
      );


    if(
      !Array.isArray(rows) ||
      !rows.length
    ){

      tbody.innerHTML =
        `
        <tr>
          <td colspan="9">
            No registrations yet.
          </td>
        </tr>
        `;

      return;
    }


    const lobbies =
      await api(
        "/api/lobbies"
      );


    tbody.innerHTML =
      rows.map(
        row => {

          const options =
            lobbies.map(
              lobby => {

                const selected =
                  Number(
                    row.lobby_id
                  ) ===
                  Number(
                    lobby.id
                  );


                return `
                  <option
                    value="${Number(
                      lobby.id
                    )}"
                    ${
                      selected
                        ? "selected"
                        : ""
                    }
                  >
                    ${escapeHTML(
                      lobby.name
                    )}
                  </option>
                `;

              }
            ).join("");


          return `
            <tr>

              <td>
                ${Number(row.id)}
              </td>

              <td>
                ${escapeHTML(row.ref)}
              </td>

              <td>
                ${escapeHTML(row.team)}
              </td>

              <td>
                ${escapeHTML(row.captain)}
              </td>

              <td>
                ${escapeHTML(row.fee)}
              </td>

              <td>
                ${escapeHTML(row.time)}
              </td>

              <td>
                ${escapeHTML(row.status)}
              </td>

              <td>

                ${
                  row.status === "confirmed"

                  ?

                  `
                  <select
                    onchange="assignLobby(
                      ${Number(row.id)},
                      this.value
                    )"
                  >

                    <option value="">
                      Select
                    </option>

                    ${options}

                  </select>
                  `

                  :

                  "Confirm first"
                }

              </td>

              <td>

                <div
                  style="
                    display:flex;
                    gap:6px;
                    flex-wrap:wrap;
                  "
                >

                  ${
                    row.status !==
                    "confirmed"

                    ?

                    `
                    <button
                      class="btn small success"
                      onclick="updateRegistration(
                        ${Number(row.id)},
                        'confirmed'
                      )"
                    >
                      Confirm
                    </button>
                    `

                    : ""
                  }


                  ${
                    row.status !==
                    "rejected"

                    ?

                    `
                    <button
                      class="btn small danger"
                      onclick="updateRegistration(
                        ${Number(row.id)},
                        'rejected'
                      )"
                    >
                      Reject
                    </button>
                    `

                    : ""
                  }

                </div>

              </td>

            </tr>
          `;

        }
      ).join("");


  }catch(error){

    tbody.innerHTML =
      `
      <tr>
        <td colspan="9">
          ${escapeHTML(
            error.message
          )}
        </td>
      </tr>
      `;

  }
}


/* =========================================================
   UPDATE REGISTRATION
========================================================= */

async function updateRegistration(
  id,
  status
){

  try{

    await api(
      `/api/registrations/${id}`,
      {
        method:"PATCH",

        body:JSON.stringify({
          status
        })
      }
    );


    await loadRegistrations();
    await loadStats();
    await loadScoreLobbyOptions();

    await loadPublicLobbies(
      "homeLobbies"
    );

    await loadPublicLobbies(
      "scrimList"
    );


  }catch(error){

    alert(
      error.message
    );

  }
}


/* =========================================================
   ASSIGN LOBBY
========================================================= */

async function assignLobby(
  registrationId,
  lobbyId
){

  if(!lobbyId) return;


  try{

    await api(
      `/api/registrations/${registrationId}/lobby`,
      {
        method:"PATCH",

        body:JSON.stringify({
          lobbyId:Number(lobbyId)
        })
      }
    );


    await loadRegistrations();
    await loadStats();


  }catch(error){

    alert(
      error.message
    );

    await loadRegistrations();

  }
}


/* =========================================================
   SCORE LOBBY OPTIONS
========================================================= */

async function loadScoreLobbyOptions(){

  const select =
    document.getElementById(
      "scoreLobby"
    );


  if(!select) return;


  try{

    const lobbies =
      await api(
        "/api/lobbies"
      );


    const previous =
      select.value;


    select.innerHTML =
      `
      <option value="">
        Select lobby
      </option>
      ` +

      lobbies.map(
        lobby => `
          <option
            value="${escapeAttribute(
              lobby.name
            )}"
          >
            ${escapeHTML(
              lobby.name
            )}
          </option>
        `
      ).join("");


    if(
      previous &&
      lobbies.some(
        lobby =>
          lobby.name === previous
      )
    ){

      select.value =
        previous;

    }


    await renderScoreEntry();


  }catch(error){

    console.error(
      error
    );

  }
}


/* =========================================================
   SCORE MATCH
========================================================= */

function selectScoreMatch(
  match,
  button
){

  currentScoreMatch =
    Number(match);


  document
    .querySelectorAll(
      ".match-tabs button"
    )
    .forEach(
      element => {

        element.classList.remove(
          "active"
        );

      }
    );


  if(button){

    button.classList.add(
      "active"
    );

  }


  renderScoreEntry();
}


/* =========================================================
   SCORE ENTRY
========================================================= */

async function renderScoreEntry(){

  const body =
    document.getElementById(
      "scoreEntryBody"
    );


  const select =
    document.getElementById(
      "scoreLobby"
    );


  if(!body || !select) return;


  const lobby =
    select.value;


  if(!lobby){

    body.innerHTML =
      `
      <p class="muted">
        Select a lobby first.
      </p>
      `;

    return;
  }


  body.innerHTML =
    `
    <p class="muted">
      Loading teams...
    </p>
    `;


  try{

    const teams =
      await api(
        `/api/leaderboard/teams?lobby=${encodeURIComponent(
          lobby
        )}`
      );


    if(
      !Array.isArray(teams) ||
      teams.length !== 12
    ){

      body.innerHTML =
        `
        <div class="message show error">

          This lobby currently has
          ${
            Array.isArray(teams)
              ? teams.length
              : 0
          }/12 confirmed teams.

          Exactly 12 teams are required
          to enter match results.

        </div>
        `;

      return;
    }


    let existing = [];


    try{

      existing =
        await api(
          `/api/leaderboard/match?lobby=${encodeURIComponent(
            lobby
          )}&match=${currentScoreMatch}`
        );

    }catch(error){

      existing = [];

    }


    const oldMap =
      new Map(
        existing.map(
          row => [
            row.team,
            row
          ]
        )
      );


    body.innerHTML =
      `
      <div class="table-wrap">

        <table class="score-table">

          <thead>

            <tr>

              <th>Team</th>
              <th>Position</th>
              <th>Kills</th>
              <th>Booyah</th>
              <th>Placement</th>
              <th>Kill Points</th>
              <th>Total</th>

            </tr>

          </thead>

          <tbody>

            ${
              teams.map(
                (team,index) => {

                  const old =
                    oldMap.get(
                      team.team
                    );


                  const position =
                    old
                      ? old.position
                      : index + 1;


                  const kills =
                    old
                      ? old.kills
                      : 0;


                  const placement =
                    old
                      ? old.placement_points
                      : calculatePlacement(
                          position
                        );


                  const killPoints =
                    old
                      ? old.kill_points
                      : kills;


                  const total =
                    placement +
                    killPoints;


                  return `
                    <tr>

                      <td>
                        <strong>
                          ${escapeHTML(
                            team.team
                          )}
                        </strong>
                      </td>

                      <td>

                        <input
                          type="number"
                          min="1"
                          max="12"
                          class="score-position"
                          data-team="${escapeAttribute(
                            team.team
                          )}"
                          value="${position}"
                          oninput="previewScoreRow(this)"
                        >

                      </td>

                      <td>

                        <input
                          type="number"
                          min="0"
                          class="score-kills"
                          data-team="${escapeAttribute(
                            team.team
                          )}"
                          value="${kills}"
                          oninput="previewScoreRow(this)"
                        >

                      </td>

                      <td class="preview-booyah">
                        ${
                          Number(position) === 1
                            ? "YES"
                            : "—"
                        }
                      </td>

                      <td class="preview-placement">
                        ${placement}
                      </td>

                      <td class="preview-kills">
                        ${killPoints}
                      </td>

                      <td class="preview-total">
                        <strong>
                          ${total}
                        </strong>
                      </td>

                    </tr>
                  `;

                }
              ).join("")
            }

          </tbody>

        </table>

      </div>

      <br>

      <button
        class="btn success"
        onclick="saveCurrentMatch()"
      >
        Save Match
        ${currentScoreMatch}
      </button>
      `;


  }catch(error){

    body.innerHTML =
      `
      <div class="message show error">
        ${escapeHTML(
          error.message
        )}
      </div>
      `;

  }
}


/* =========================================================
   PLACEMENT POINTS
========================================================= */

function calculatePlacement(
  position
){

  const table = {

    1:12,
    2:9,
    3:8,
    4:7,
    5:6,
    6:5,
    7:4,
    8:3,
    9:2,
    10:1,
    11:0,
    12:0

  };


  return (
    table[
      Number(position)
    ] || 0
  );

}


/* =========================================================
   SCORE PREVIEW
========================================================= */

function previewScoreRow(
  input
){

  const row =
    input.closest("tr");


  if(!row) return;


  const position =
    Number(
      row.querySelector(
        ".score-position"
      ).value
    );


  const kills =
    Number(
      row.querySelector(
        ".score-kills"
      ).value
    ) || 0;


  const placement =
    calculatePlacement(
      position
    );


  const booyah =
    position === 1
      ? "YES"
      : "—";


  const total =
    placement +
    kills;


  const booyahCell =
    row.querySelector(
      ".preview-booyah"
    );


  const placementCell =
    row.querySelector(
      ".preview-placement"
    );


  const killsCell =
    row.querySelector(
      ".preview-kills"
    );


  const totalCell =
    row.querySelector(
      ".preview-total"
    );


  if(booyahCell)
    booyahCell.textContent =
      booyah;


  if(placementCell)
    placementCell.textContent =
      placement;


  if(killsCell)
    killsCell.textContent =
      kills;


  if(totalCell)
    totalCell.innerHTML =
      `<strong>${total}</strong>`;

}


/* =========================================================
   SAVE MATCH
========================================================= */

async function saveCurrentMatch(){

  const lobby =
    document.getElementById(
      "scoreLobby"
    )?.value;


  if(!lobby){

    alert(
      "Please select a lobby."
    );

    return;
  }


  const entries = [];


  document
    .querySelectorAll(
      ".score-position"
    )
    .forEach(
      input => {

        const row =
          input.closest("tr");


        if(!row) return;


        const killsInput =
          row.querySelector(
            ".score-kills"
          );


        entries.push({

          team:
            input.dataset.team,

          position:
            Number(
              input.value
            ),

          kills:
            Number(
              killsInput?.value
            ) || 0

        });

      }
    );


  try{

    await api(
      "/api/leaderboard/match",
      {
        method:"POST",

        body:JSON.stringify({

          lobby,

          matchNo:
            currentScoreMatch,

          entries

        })
      }
    );


    alert(
      `Match ${currentScoreMatch} saved successfully.`
    );


    await renderScoreEntry();


    await loadPublicLeaderboard(
      true
    );


  }catch(error){

    alert(
      error.message
    );

  }
}


/* =========================================================
   PUBLIC LEADERBOARD OPTIONS
========================================================= */

async function loadLeaderboardLobbyOptions(){

  const select =
    document.getElementById(
      "publicLobbySelect"
    );


  if(!select) return;


  const previous =
    select.value;


  try{

    const lobbies =
      await api(
        "/api/public/lobbies"
      );


    select.innerHTML =
      `
      <option value="">
        Select a lobby
      </option>
      ` +

      lobbies.map(
        lobby => `
          <option
            value="${escapeAttribute(
              lobby.name
            )}"
          >
            ${escapeHTML(
              lobby.name
            )}
          </option>
        `
      ).join("");


    if(
      previous &&
      lobbies.some(
        lobby =>
          lobby.name === previous
      )
    ){

      select.value =
        previous;

    }


    startLeaderboardLive();


    if(select.value){

      await loadPublicLeaderboard(
        true
      );

    }


  }catch(error){

    console.error(
      error
    );

  }
}


/* =========================================================
   PUBLIC LEADERBOARD
========================================================= */

async function loadPublicLeaderboard(
  silent = false
){

  const lobby =
    document.getElementById(
      "publicLobbySelect"
    )?.value;


  const match =
    document.getElementById(
      "publicMatchSelect"
    )?.value;


  const target =
    document.getElementById(
      "publicLeaderboard"
    );


  if(!target) return;


  if(!lobby){

    if(!silent){

      target.innerHTML =
        `
        <div class="message show error">
          Please select a lobby.
        </div>
        `;

    }

    return;
  }


  try{

    if(match === "overall"){

      const data =
        await api(
          `/api/public-leaderboard?lobby=${encodeURIComponent(
            lobby
          )}`
        );


      const rows =
        Array.isArray(data)
          ? data
          : data.rows || [];


      renderOverallLeaderboard(
        target,
        rows
      );


    }else{

      const data =
        await api(
          `/api/leaderboard/match?lobby=${encodeURIComponent(
            lobby
          )}&match=${encodeURIComponent(
            match
          )}`
        );


      renderMatchLeaderboard(
        target,
        data,
        match
      );

    }


  }catch(error){

    if(!silent){

      target.innerHTML =
        `
        <div class="message show error">

          ${escapeHTML(
            error.message
          )}

        </div>
        `;

    }

  }
}


/* =========================================================
   LIVE LEADERBOARD
========================================================= */

function startLeaderboardLive(){

  if(leaderboardTimer){

    clearInterval(
      leaderboardTimer
    );

  }


  leaderboardTimer =
    setInterval(
      async () => {

        const page =
          document.getElementById(
            "leaderboard"
          );


        const lobby =
          document.getElementById(
            "publicLobbySelect"
          );


        if(
          page &&
          page.classList.contains(
            "active"
          ) &&
          lobby &&
          lobby.value
        ){

          await loadPublicLeaderboard(
            true
          );

        }

      },
      5000
    );

}


/* =========================================================
   OVERALL LEADERBOARD
========================================================= */

function renderOverallLeaderboard(
  target,
  rows
){

  if(
    !Array.isArray(rows) ||
    !rows.length
  ){

    target.innerHTML =
      `
      <div class="card">

        <p class="muted">
          No confirmed teams in this
          lobby yet.
        </p>

      </div>
      `;

    return;
  }


  target.innerHTML =
    `
    <div class="card live-box">

      <div class="top-actions">

        <div>

          <h3>
            Live Overall Leaderboard
          </h3>

          <p class="muted">
            Automatically updated.
          </p>

        </div>

        <span class="badge open">
          LIVE
        </span>

      </div>


      <div class="table-wrap">

        <table>

          <thead>

            <tr>
              <th>Rank</th>
              <th>Team</th>
              <th>Booyahs</th>
              <th>Kill Points</th>
              <th>Placement Points</th>
              <th>Total Points</th>
            </tr>

          </thead>


          <tbody>

            ${
              rows.map(
                row => `
                  <tr>

                    <td class="rank">
                      #${Number(
                        row.position
                      )}
                    </td>

                    <td>
                      <strong>
                        ${escapeHTML(
                          row.team
                        )}
                      </strong>
                    </td>

                    <td>
                      ${Number(
                        row.booyahs || 0
                      )}
                    </td>

                    <td>
                      ${Number(
                        row.killPoints || 0
                      )}
                    </td>

                    <td>
                      ${Number(
                        row.placementPoints || 0
                      )}
                    </td>

                    <td>
                      <strong>
                        ${Number(
                          row.totalPoints || 0
                        )}
                      </strong>
                    </td>

                  </tr>
                `
              ).join("")
            }

          </tbody>

        </table>

      </div>

    </div>
    `;

}


/* =========================================================
   MATCH LEADERBOARD
========================================================= */

function renderMatchLeaderboard(
  target,
  rows,
  match
){

  if(
    !Array.isArray(rows) ||
    !rows.length
  ){

    target.innerHTML =
      `
      <div class="card">

        <p class="muted">

          No results have been published
          for Match ${escapeHTML(match)}
          yet.

        </p>

      </div>
      `;

    return;
  }


  target.innerHTML =
    `
    <div class="card">

      <div class="top-actions">

        <div>

          <h3>
            Match ${escapeHTML(match)}
            Leaderboard
          </h3>

          <p class="muted">
            Results for this match.
          </p>

        </div>

        <span class="badge open">
          LIVE
        </span>

      </div>


      <div class="table-wrap">

        <table>

          <thead>

            <tr>
              <th>Position</th>
              <th>Team</th>
              <th>Booyah</th>
              <th>Kills</th>
              <th>Kill Points</th>
              <th>Placement Points</th>
              <th>Total Points</th>
            </tr>

          </thead>


          <tbody>

            ${
              rows.map(
                row => `
                  <tr>

                    <td class="rank">
                      #${Number(
                        row.position
                      )}
                    </td>

                    <td>
                      <strong>
                        ${escapeHTML(
                          row.team
                        )}
                      </strong>
                    </td>

                    <td>
                      ${
                        Number(
                          row.booyah
                        ) === 1
                          ? "YES"
                          : "—"
                      }
                    </td>

                    <td>
                      ${Number(
                        row.kills || 0
                      )}
                    </td>

                    <td>
                      ${Number(
                        row.kill_points || 0
                      )}
                    </td>

                    <td>
                      ${Number(
                        row.placement_points || 0
                      )}
                    </td>

                    <td>
                      <strong>
                        ${Number(
                          row.total_points || 0
                        )}
                      </strong>
                    </td>

                  </tr>
                `
              ).join("")
            }

          </tbody>

        </table>

      </div>

    </div>
    `;

}


/* =========================================================
   ESCAPE HELPERS
========================================================= */

function escapeHTML(
  value
){

  return String(
    value ?? ""
  )
    .replaceAll(
      "&",
      "&amp;"
    )
    .replaceAll(
      "<",
      "&lt;"
    )
    .replaceAll(
      ">",
      "&gt;"
    )
    .replaceAll(
      '"',
      "&quot;"
    )
    .replaceAll(
      "'",
      "&#039;"
    );

}


function escapeAttribute(
  value
){

  return escapeHTML(
    value
  );

}


/* =========================================================
   EVENTS
========================================================= */

document
  .getElementById(
    "scoreLobby"
  )
  ?.addEventListener(
    "change",
    renderScoreEntry
  );


document
  .getElementById(
    "publicLobbySelect"
  )
  ?.addEventListener(
    "change",
    () => {

      loadPublicLeaderboard();

    }
  );


document
  .getElementById(
    "publicMatchSelect"
  )
  ?.addEventListener(
    "change",
    () => {

      const lobby =
        document.getElementById(
          "publicLobbySelect"
        )?.value;


      if(lobby){

        loadPublicLeaderboard();

      }

    }
  );


/* =========================================================
   INITIALIZATION
========================================================= */

document.addEventListener(
  "DOMContentLoaded",
  () => {

    loadPublicLobbies(
      "homeLobbies"
    );


    startLeaderboardLive();


    const timeInput =
      document.getElementById(
        "regTime"
      );


    const feeInput =
      document.getElementById(
        "regFee"
      );


    if(timeInput){

      timeInput.readOnly =
        true;

      timeInput.setAttribute(
        "readonly",
        "readonly"
      );

    }


    if(feeInput){

      feeInput.readOnly =
        true;

      feeInput.setAttribute(
        "readonly",
        "readonly"
      );

    }

  }
);
