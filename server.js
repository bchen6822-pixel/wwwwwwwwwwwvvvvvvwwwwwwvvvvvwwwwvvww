const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

const DB_FILE = path.join(__dirname, 'db.json');

if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify([], null, 2));
}

// ===================== 统一TikTok兑换比例常量 =====================
const USD_TO_COIN_RATE = 95; // 1 USD = 95 Coin
// =================================================================

// 定义管理员账号
let admin = {
  user: "admin",
  pwd: "admin123"
};

function readDB() {
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}
function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}
function now() {
  return new Date().toISOString();
}

// 生成随机 token
function genToken() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// 生成 6~7 位美金余额 100000.00 ~ 999999.99
function randomUsdBalance(){
  const intPart = Math.floor(Math.random() * 900000 + 100000);
  const decPart = Math.floor(Math.random() * 99);
  return parseFloat(`${intPart}.${decPart}`);
}

// ------------------------------
// 用户登录（带过期、禁用、互踢 + 返回余额币数）
// ------------------------------
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const db = readDB();

  const user = db.find(u => u.username === username);
  if (!user) return res.json({ ok: false, msg: '账号不存在' });

  if (user.password !== password) {
    return res.json({ ok: false, msg: '密码错误' });
  }

  if (!user.enabled) {
    return res.json({ ok: false, msg: '账号已禁用' });
  }

  const nowTs = Date.now();
  if (user.expireAt) {
    const expTs = new Date(user.expireAt).getTime();
    if (nowTs > expTs) {
      return res.json({ ok: false, msg: '账号已过期' });
    }
  }

  const token = genToken();
  user.token = token;
  // 不存在余额就自动填充随机余额
  if(user.usd_balance === undefined || user.usd_balance === null){
    user.usd_balance = randomUsdBalance();
  }
  writeDB(db);

  const usd = Number(user.usd_balance || 0);
  const coin = usd * USD_TO_COIN_RATE;

  res.json({
    ok: true,
    token,
    usd_balance: usd,
    coin_balance: coin,
    rate_text: `1 USD = ${USD_TO_COIN_RATE} Coin`
  });
});

// ------------------------------
// 前端每次刷新校验 token 同时返回余额
// ------------------------------
app.post('/api/check', (req, res) => {
  const { username, token } = req.body;
  const db = readDB();
  const user = db.find(u => u.username === username);

  if (!user || !user.enabled || !user.token || user.token !== token) {
    return res.json({ ok: false });
  }

  if (user.expireAt && Date.now() > new Date(user.expireAt).getTime()) {
    return res.json({ ok: false });
  }

  const usd = Number(user.usd_balance || 0);
  const coin = usd * USD_TO_COIN_RATE;
  res.json({
    ok: true,
    usd_balance: usd,
    coin_balance: coin,
    rate_text: `1 USD = ${USD_TO_COIN_RATE} Coin`
  });
});

// ------------------------------
// 管理员
// ------------------------------
app.post('/api/admin/login', (req, res) => {
  const { user, pwd } = req.body;
  if (user === admin.user && pwd === admin.pwd) {
    res.json({ ok: true });
  } else {
    res.json({ ok: false });
  }
});

app.get('/api/admin/list', (req, res) => {
  const db = readDB();
  const list = db.map(item => {
    const usd = Number(item.usd_balance ?? 0);
    return {
      ...item,
      usd_balance: usd,
      coin_balance: usd * USD_TO_COIN_RATE,
      rate_text: `1 USD = ${USD_TO_COIN_RATE} Coin`
    };
  })
  res.json(list);
});

app.post('/api/admin/delete', (req, res) => {
  const { username } = req.body;
  let db = readDB();
  db = db.filter(x => x.username !== username);
  writeDB(db);
  res.json({ ok: true });
});

app.post('/api/admin/toggle', (req, res) => {
  const { username, enabled } = req.body;
  const db = readDB();
  const u = db.find(x => x.username === username);
  if (u) {
    u.enabled = enabled;
    if (!enabled) u.token = null;
  }
  writeDB(db);
  res.json({ ok: true });
});

app.post('/api/admin/batch', (req, res) => {
  const { lines, days } = req.body;
  const db = readDB();
  const arr = lines.split(/\n/).map(x => x.trim()).filter(Boolean);

  let success = 0;
  let exist = 0;

  for (const line of arr) {
    const [user, pwd] = line.split(/\s+/).filter(Boolean);
    if (!user || !pwd) continue;
    if (db.some(x => x.username === user)) {
      exist++;
      continue;
    }

    const nowTime = now();
    const expire = days > 0
      ? new Date(Date.now() + days * 86400000).toISOString()
      : null;

    db.push({
      username: user,
      password: pwd,
      enabled: true,
      createdAt: nowTime,
      expireAt: expire,
      token: null,
      usd_balance: randomUsdBalance()
    });
    success++;
  }

  writeDB(db);
  res.json({ ok: true, success, exist });
});

// ------------------------------
// 修改管理员账号密码
// ------------------------------
app.post('/api/admin/set-user-pwd', (req, res) => {
  const { newUser, newPwd } = req.body;
  if (newUser) admin.user = newUser;
  if (newPwd) admin.pwd = newPwd;
  res.json({ ok: true });
});

// ------------------------------
// 设置用户有效期
// ------------------------------
app.post('/api/admin/set-expire', (req, res) => {
  const { username, days } = req.body;
  const db = readDB();
  const user = db.find(u => u.username === username);

  if (!user) {
    return res.json({ ok: false, msg: "用户不存在" });
  }

  if (days <= 0) {
    user.expireAt = null;
  } else {
    user.expireAt = new Date(Date.now() + days * 86400 * 1000).toISOString();
  }

  writeDB(db);
  res.json({ ok: true });
});

// ===================== 新增接口：管理员修改用户美金余额 =====================
app.post('/api/admin/set-usd-balance', (req, res) => {
  const { username, usd_balance } = req.body;
  const db = readDB();
  const user = db.find(u => u.username === username);
  if (!user) return res.json({ ok: false, msg: "用户不存在" });
  user.usd_balance = parseFloat(usd_balance) || 0;
  writeDB(db);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on ${PORT}`));
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

const DB_FILE = path.join(__dirname, 'db.json');

if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify([], null, 2));
}

// ===================== 统一TikTok兑换比例常量 =====================
const USD_TO_COIN_RATE = 95; // 1 USD = 95 Coin
// =================================================================

// 定义管理员账号
let admin = {
  user: "admin",
  pwd: "admin123"
};

function readDB() {
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}
function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}
function now() {
  return new Date().toISOString();
}

// 生成随机 token
function genToken() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// 生成 6~7 位美金余额 100000.00 ~ 999999.99
function randomUsdBalance(){
  const intPart = Math.floor(Math.random() * 900000 + 100000);
  const decPart = Math.floor(Math.random() * 99);
  return parseFloat(`${intPart}.${decPart}`);
}

// ------------------------------
// 用户登录（带过期、禁用、互踢 + 返回余额币数）
// ------------------------------
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const db = readDB();

  const user = db.find(u => u.username === username);
  if (!user) return res.json({ ok: false, msg: '账号不存在' });

  if (user.password !== password) {
    return res.json({ ok: false, msg: '密码错误' });
  }

  if (!user.enabled) {
    return res.json({ ok: false, msg: '账号已禁用' });
  }

  const nowTs = Date.now();
  if (user.expireAt) {
    const expTs = new Date(user.expireAt).getTime();
    if (nowTs > expTs) {
      return res.json({ ok: false, msg: '账号已过期' });
    }
  }

  const token = genToken();
  user.token = token;
  // 不存在余额就自动填充随机余额
  if(user.usd_balance === undefined || user.usd_balance === null){
    user.usd_balance = randomUsdBalance();
  }
  writeDB(db);

  const usd = Number(user.usd_balance || 0);
  const coin = usd * USD_TO_COIN_RATE;

  res.json({
    ok: true,
    token,
    usd_balance: usd,
    coin_balance: coin,
    rate_text: `1 USD = ${USD_TO_COIN_RATE} Coin`
  });
});

// ------------------------------
// 前端每次刷新校验 token 同时返回余额
// ------------------------------
app.post('/api/check', (req, res) => {
  const { username, token } = req.body;
  const db = readDB();
  const user = db.find(u => u.username === username);

  if (!user || !user.enabled || !user.token || user.token !== token) {
    return res.json({ ok: false });
  }

  if (user.expireAt && Date.now() > new Date(user.expireAt).getTime()) {
    return res.json({ ok: false });
  }

  const usd = Number(user.usd_balance || 0);
  const coin = usd * USD_TO_COIN_RATE;
  res.json({
    ok: true,
    usd_balance: usd,
    coin_balance: coin,
    rate_text: `1 USD = ${USD_TO_COIN_RATE} Coin`
  });
});

// ------------------------------
// 管理员
// ------------------------------
app.post('/api/admin/login', (req, res) => {
  const { user, pwd } = req.body;
  if (user === admin.user && pwd === admin.pwd) {
    res.json({ ok: true });
  } else {
    res.json({ ok: false });
  }
});

app.get('/api/admin/list', (req, res) => {
  const db = readDB();
  const list = db.map(item => {
    const usd = Number(item.usd_balance ?? 0);
    return {
      ...item,
      usd_balance: usd,
      coin_balance: usd * USD_TO_COIN_RATE,
      rate_text: `1 USD = ${USD_TO_COIN_RATE} Coin`
    };
  })
  res.json(list);
});

app.post('/api/admin/delete', (req, res) => {
  const { username } = req.body;
  let db = readDB();
  db = db.filter(x => x.username !== username);
  writeDB(db);
  res.json({ ok: true });
});

app.post('/api/admin/toggle', (req, res) => {
  const { username, enabled } = req.body;
  const db = readDB();
  const u = db.find(x => x.username === username);
  if (u) {
    u.enabled = enabled;
    if (!enabled) u.token = null;
  }
  writeDB(db);
  res.json({ ok: true });
});

app.post('/api/admin/batch', (req, res) => {
  const { lines, days } = req.body;
  const db = readDB();
  const arr = lines.split(/\n/).map(x => x.trim()).filter(Boolean);

  let success = 0;
  let exist = 0;

  for (const line of arr) {
    const [user, pwd] = line.split(/\s+/).filter(Boolean);
    if (!user || !pwd) continue;
    if (db.some(x => x.username === user)) {
      exist++;
      continue;
    }

    const nowTime = now();
    const expire = days > 0
      ? new Date(Date.now() + days * 86400000).toISOString()
      : null;

    db.push({
      username: user,
      password: pwd,
      enabled: true,
      createdAt: nowTime,
      expireAt: expire,
      token: null,
      usd_balance: randomUsdBalance()
    });
    success++;
  }

  writeDB(db);
  res.json({ ok: true, success, exist });
});

// ------------------------------
// 修改管理员账号密码
// ------------------------------
app.post('/api/admin/set-user-pwd', (req, res) => {
  const { newUser, newPwd } = req.body;
  if (newUser) admin.user = newUser;
  if (newPwd) admin.pwd = newPwd;
  res.json({ ok: true });
});

// ------------------------------
// 设置用户有效期
// ------------------------------
app.post('/api/admin/set-expire', (req, res) => {
  const { username, days } = req.body;
  const db = readDB();
  const user = db.find(u => u.username === username);

  if (!user) {
    return res.json({ ok: false, msg: "用户不存在" });
  }

  if (days <= 0) {
    user.expireAt = null;
  } else {
    user.expireAt = new Date(Date.now() + days * 86400 * 1000).toISOString();
  }

  writeDB(db);
  res.json({ ok: true });
});

// ===================== 新增接口：管理员修改用户美金余额 =====================
app.post('/api/admin/set-usd-balance', (req, res) => {
  const { username, usd_balance } = req.body;
  const db = readDB();
  const user = db.find(u => u.username === username);
  if (!user) return res.json({ ok: false, msg: "用户不存在" });
  user.usd_balance = parseFloat(usd_balance) || 0;
  writeDB(db);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on ${PORT}`));
