const express = require("express");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === "production";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL belum diatur.");
  process.exit(1);
}
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  console.error("SESSION_SECRET wajib ada dan minimal 32 karakter.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false }
});

app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "50kb" }));
app.use(express.urlencoded({ extended: true, limit: "50kb" }));

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: "draft-8",
  legacyHeaders: false
}));

app.use(session({
  store: new pgSession({ pool, tableName: "user_sessions", createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    maxAge: 8 * 60 * 60 * 1000
  }
}));

async function query(text, params=[]) {
  return pool.query(text, params);
}

async function initDb() {
  await query(`
    CREATE TABLE IF NOT EXISTS admins (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS voters (
      id SERIAL PRIMARY KEY,
      nis TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      voted BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS candidates (
      id SERIAL PRIMARY KEY,
      number INTEGER UNIQUE NOT NULL,
      name TEXT NOT NULL,
      class_name TEXT NOT NULL,
      vision TEXT NOT NULL,
      mission TEXT NOT NULL,
      photo TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS votes (
      id SERIAL PRIMARY KEY,
      voter_id INTEGER UNIQUE NOT NULL REFERENCES voters(id) ON DELETE RESTRICT,
      candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  const a = await query("SELECT id FROM admins LIMIT 1");
  if (!a.rows.length) {
    const hash = await bcrypt.hash(process.env.DEFAULT_ADMIN_PASSWORD || "admin123", 12);
    await query("INSERT INTO admins(username,password_hash) VALUES($1,$2)", [
      process.env.DEFAULT_ADMIN_USERNAME || "admin", hash
    ]);
  }

  const v = await query("SELECT id FROM voters LIMIT 1");
  if (!v.rows.length) {
    await query(`INSERT INTO voters(nis,name) VALUES
      ('1001','Andi'),('1002','Budi'),('1003','Citra'),('1004','Dewi')
      ON CONFLICT (nis) DO NOTHING`);
  }

  const c = await query("SELECT id FROM candidates LIMIT 1");
  if (!c.rows.length) {
    await query(`INSERT INTO candidates(number,name,class_name,vision,mission) VALUES
      (1,'Calon 1','XII RPL','Mewujudkan OSIS yang aktif, kreatif, dan berprestasi.','Meningkatkan kegiatan siswa; memperkuat solidaritas; mengembangkan bakat dan prestasi.'),
      (2,'Calon 2','XII Keperawatan','Membangun sekolah yang disiplin, inspiratif, dan berkarakter.','Mendorong kedisiplinan; membuat kegiatan positif; meningkatkan kepedulian sosial.'),
      (3,'Calon 3','XI TKJ','Menjadikan OSIS sebagai wadah aspirasi siswa.','Membuka ruang aspirasi; memperbanyak kegiatan kreatif; meningkatkan kerja sama antarsiswa.')
      ON CONFLICT (number) DO NOTHING`);
  }
}

function adminOnly(req,res,next) {
  if (!req.session.adminId) return res.status(401).json({error:"Belum login admin"});
  next();
}

app.get("/health", async (req,res)=>{
  try { await query("SELECT 1"); res.json({ok:true}); }
  catch { res.status(503).json({ok:false}); }
});

app.get("/api/candidates", async (req,res)=>{
  const r = await query("SELECT * FROM candidates ORDER BY number");
  res.json(r.rows);
});

app.post("/api/login-voter", async (req,res)=>{
  const nis = String(req.body.nis || "").trim();
  if (!nis) return res.status(400).json({error:"NIS wajib diisi"});
  const r = await query("SELECT * FROM voters WHERE nis=$1", [nis]);
  const voter = r.rows[0];
  if (!voter) return res.status(404).json({error:"NIS tidak ditemukan"});
  if (voter.voted) return res.status(409).json({error:"NIS ini sudah menggunakan hak pilih"});
  req.session.voterId = voter.id;
  req.session.voterName = voter.name;
  res.json({name:voter.name});
});

app.post("/api/vote", async (req,res)=>{
  if (!req.session.voterId) return res.status(401).json({error:"Silakan login sebagai pemilih"});
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const vr = await client.query("SELECT * FROM voters WHERE id=$1 FOR UPDATE", [req.session.voterId]);
    const voter = vr.rows[0];
    const cr = await client.query("SELECT * FROM candidates WHERE id=$1", [Number(req.body.candidateId)]);
    if (!voter || voter.voted) throw Object.assign(new Error("Hak pilih sudah digunakan"),{status:409});
    if (!cr.rows[0]) throw Object.assign(new Error("Kandidat tidak ditemukan"),{status:404});
    await client.query("INSERT INTO votes(voter_id,candidate_id) VALUES($1,$2)", [voter.id, cr.rows[0].id]);
    await client.query("UPDATE voters SET voted=TRUE WHERE id=$1", [voter.id]);
    await client.query("COMMIT");
    req.session.voterId = null;
    req.session.voterName = null;
    res.json({ok:true});
  } catch(e) {
    await client.query("ROLLBACK");
    res.status(e.status || 400).json({error:e.message || "Gagal menyimpan suara"});
  } finally { client.release(); }
});

app.post("/api/admin/login", async (req,res)=>{
  const username=String(req.body.username||"").trim();
  const password=String(req.body.password||"");
  const r=await query("SELECT * FROM admins WHERE username=$1",[username]);
  if(!r.rows[0] || !(await bcrypt.compare(password,r.rows[0].password_hash)))
    return res.status(401).json({error:"Username atau password salah"});
  req.session.adminId=r.rows[0].id;
  res.json({ok:true});
});

app.post("/api/admin/logout",adminOnly,(req,res)=>{
  req.session.destroy(()=>res.json({ok:true}));
});

app.get("/api/admin/stats",adminOnly,async(req,res)=>{
  const candidates=(await query(`
    SELECT c.id,c.number,c.name,c.class_name,COUNT(v.id)::int AS votes
    FROM candidates c LEFT JOIN votes v ON v.candidate_id=c.id
    GROUP BY c.id ORDER BY c.number`)).rows;
  const total=Number((await query("SELECT COUNT(*) n FROM voters")).rows[0].n);
  const voted=Number((await query("SELECT COUNT(*) n FROM voters WHERE voted=TRUE")).rows[0].n);
  res.json({candidates,total,voted,notVoted:total-voted});
});

app.get("/api/admin/voters",adminOnly,async(req,res)=>{
  res.json((await query("SELECT id,nis,name,voted FROM voters ORDER BY id DESC")).rows);
});

app.post("/api/admin/voters",adminOnly,async(req,res)=>{
  const nis=String(req.body.nis||"").trim(), name=String(req.body.name||"").trim();
  if(!nis||!name) return res.status(400).json({error:"NIS dan nama wajib diisi"});
  try { await query("INSERT INTO voters(nis,name) VALUES($1,$2)",[nis,name]); res.json({ok:true}); }
  catch { res.status(409).json({error:"NIS sudah terdaftar"}); }
});

app.post("/api/admin/candidates",adminOnly,async(req,res)=>{
  const {number,name,class_name,vision,mission}=req.body;
  try {
    await query(`INSERT INTO candidates(number,name,class_name,vision,mission)
      VALUES($1,$2,$3,$4,$5)`,[Number(number),name,class_name,vision,mission]);
    res.json({ok:true});
  } catch { res.status(400).json({error:"Nomor kandidat sudah dipakai atau data tidak lengkap"}); }
});

app.post("/api/admin/reset-voting",adminOnly,async(req,res)=>{
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM votes");
    await client.query("UPDATE voters SET voted=FALSE");
    await client.query("COMMIT");
    res.json({ok:true});
  } catch { await client.query("ROLLBACK"); res.status(500).json({error:"Reset gagal"}); }
  finally { client.release(); }
});

app.use(express.static(path.join(__dirname,"public")));
app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));

initDb()
  .then(()=>app.listen(PORT,()=>console.log(`E-Voting OSIS berjalan di port ${PORT}`)))
  .catch(err=>{console.error(err);process.exit(1)});
