
const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const bcrypt = require("bcryptjs");
const path = require("path");
const Database = require("better-sqlite3");

const app = express();
app.set("trust proxy",1);
const PORT = process.env.PORT || 3000;
const db = new Database(process.env.DB_PATH || "scrimforge.db");

db.exec(`
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
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
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lobby TEXT NOT NULL,
  winner TEXT NOT NULL,
  kills INTEGER NOT NULL,
  points INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
`);

app.use(express.json());
app.use(express.urlencoded({extended:true}));
app.use(session({
  store: new SQLiteStore({ db: "sessions.sqlite", dir: "." }),
  secret: process.env.SESSION_SECRET || "CHANGE_THIS_TO_A_LONG_RANDOM_SECRET",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly:true, sameSite:"lax", secure:process.env.NODE_ENV === "production", maxAge: 1000*60*60*12 }
}));
app.use(express.static(path.join(__dirname, "public")));

function auth(req,res,next){
  if (!req.session.adminId) return res.status(401).json({error:"Unauthorized"});
  next();
}
function now(){ return new Date().toISOString(); }

app.post("/api/setup-admin", async (req,res)=>{
  const count = db.prepare("SELECT COUNT(*) c FROM admins").get().c;
  if (count) return res.status(403).json({error:"Admin already exists"});
  const {name,email,password} = req.body;
  if (!name || !email || !password || password.length < 6) return res.status(400).json({error:"Name, email and a password of at least 6 characters are required"});
  const hash = await bcrypt.hash(password,12);
  const info = db.prepare("INSERT INTO admins(name,email,password_hash,created_at) VALUES(?,?,?,?)").run(name,email.toLowerCase(),hash,now());
  req.session.adminId = info.lastInsertRowid;
  req.session.adminName = name;
  res.json({ok:true,name});
});

app.post("/api/login", async (req,res)=>{
  const {email,password} = req.body;
  const admin = db.prepare("SELECT * FROM admins WHERE email=?").get((email||"").toLowerCase());
  if (!admin || !(await bcrypt.compare(password||"",admin.password_hash))) return res.status(401).json({error:"Incorrect email or password"});
  req.session.adminId = admin.id;
  req.session.adminName = admin.name;
  res.json({ok:true,name:admin.name});
});
app.post("/api/logout",(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get("/api/me",(req,res)=>res.json({loggedIn:!!req.session.adminId,name:req.session.adminName||null}));

app.post("/api/registrations", (req,res)=>{
  const {time,fee,team,captain,phone,uid} = req.body;
  if(!time||!fee||!team||!captain||!phone||!uid) return res.status(400).json({error:"All fields are required"});
  const ref = `SF-${time.replace(/\s/g,"").replace(":","")}-${fee}-${Math.floor(1000+Math.random()*9000)}`;
  try{
    db.prepare(`INSERT INTO registrations(ref,time,fee,team,captain,phone,uid,status,created_at)
      VALUES(?,?,?,?,?,?,?,'pending',?)`).run(ref,time,fee,team,captain,phone,uid,now());
    res.json({ok:true,ref});
  }catch(e){ res.status(500).json({error:"Could not save registration"}); }
});

app.get("/api/registrations",auth,(req,res)=>{
  res.json(db.prepare("SELECT * FROM registrations ORDER BY id DESC").all());
});

// Public endpoint: visitors only see confirmed lobby counts, never private registration details.
app.get("/api/public/lobbies",(req,res)=>{
  res.json(db.prepare("SELECT time, fee, COUNT(*) AS confirmed FROM registrations WHERE status='confirmed' GROUP BY time, fee").all());
});

app.get("/api/admin-exists",(req,res)=>{
  res.json({exists: !!db.prepare("SELECT id FROM admins LIMIT 1").get()});
});
app.patch("/api/registrations/:id",auth,(req,res)=>{
  const status = req.body.status;
  if(!["pending","confirmed","rejected"].includes(status)) return res.status(400).json({error:"Invalid status"});
  const r = db.prepare("UPDATE registrations SET status=? WHERE id=?").run(status,req.params.id);
  if(!r.changes) return res.status(404).json({error:"Registration not found"});
  res.json({ok:true});
});

app.get("/api/results",(req,res)=>res.json(db.prepare("SELECT * FROM results ORDER BY id DESC").all()));
app.post("/api/results",auth,(req,res)=>{
  const {lobby,winner,kills,points}=req.body;
  if(!lobby||!winner||kills===undefined||points===undefined) return res.status(400).json({error:"All result fields are required"});
  db.prepare("INSERT INTO results(lobby,winner,kills,points,created_at) VALUES(?,?,?,?,?)").run(lobby,winner,Number(kills),Number(points),now());
  res.json({ok:true});
});

app.get("/api/stats",auth,(req,res)=>{
  const pending=db.prepare("SELECT COUNT(*) c FROM registrations WHERE status='pending'").get().c;
  const confirmed=db.prepare("SELECT COUNT(*) c FROM registrations WHERE status='confirmed'").get().c;
  res.json({pending,confirmed,activeLobbies:30});
});

app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
app.listen(PORT,()=>console.log(`ScrimForge V2 running on http://localhost:${PORT}`));
