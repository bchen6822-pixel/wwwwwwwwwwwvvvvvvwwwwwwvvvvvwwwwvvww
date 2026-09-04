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

// ===================== 【补上】/api/check-auth 登录校验接口 =====================
// 前端登录后、页面自动登录时都会调用这个接口校验账号状态
app.post('/api/check-auth', (req, res) => {
  try {
    const { username, device_fp } = req.body;
    const db = readDB();
    const user = db.find(u => u.username === username);

    if (!user) {
      return res.json({ code: -1, msg: "账号不存在" });
    }
    if (!user.enabled) {
      return res.json({ code: -1, msg: "账号已禁用" });
    }
    if (user.expireAt && Date.now() > new Date(user.expireAt).getTime()) {
      return res.json({ code: -1, msg: "账号已过期" });
    }
    // 设备绑定校验（如果后续要做设备锁，在这里判断 device_fp）
    // 目前不做设备锁定，直接放行
    return res.json({ code: 1, msg: "校验通过" });
  } catch (err) {
    console.error('check-auth 错误:', err);
    return res.json({ code: -10, msg: "服务器校验异常" });
  }
});

// ===================== 【补上】/api/tiktok-rotate TikTok用户信息接口 =====================
// 前端输入用户名后调用，返回头像、昵称、粉丝数等
// 目前返回模拟数据，后续接入真实采集再替换内部逻辑
app.get('/api/tiktok-rotate', (req, res) => {
  try {
    const username = (req.query.username || "").replace(/^@/, "");
    if (!username) {
      return res.json({ success: false, msg: "用户名不能为空" });
    }
    // 模拟返回，保证前端不报错、头像区域正常显示占位
    res.json({
      success: true,
      avatarUrl: "",
      nickname: "@" + username,
      videoCount: 0,
      followerCount: 0,
      followingCount: 0
    });
  } catch (err) {
    console.error('tiktok-rotate 错误:', err);
    res.json({ success: false, msg: "查询失败" });
  }
});

// ------------------------------
// 用户登录（带过期、禁用、互踢 + 返回余额币数）
// ------------------------------
app.post('/api/login', (req, res) => {
  try {
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
  } catch (err) {
    console.error('login 错误:', err);
    res.json({ ok: false, msg: '登录处理失败，请稍后重试' });
  }
});

// ------------------------------
// 前端每次刷新校验 token 同时返回余额
// ------------------------------
app.post('/api/check', (req, res) => {
  try {
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
  } catch (err) {
    console.error('check 错误:', err);
    res.json({ ok: false });
  }
});

// ------------------------------
// 管理员
// ------------------------------
app.post('/api/admin/login', (req, res) => {
  try {
    const { user, pwd } = req.body;
    if (user === admin.user && pwd === admin.pwd) {
      res.json({ ok: true });
    } else {
      res.json({ ok: false });
    }
  } catch (err) {
    console.error('admin/login 错误:', err);
    res.json({ ok: false });
  }
});

app.get('/api/admin/list', (req, res) => {
  try {
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
  } catch (err) {
    console.error('admin/list 错误:', err);
    res.json([]);
  }
});

app.post('/api/admin/delete', (req, res) => {
  try {
    const { username } = req.body;
    let db = readDB();
    db = db.filter(x => x.username !== username);
    writeDB(db);
    res.json({ ok: true });
  } catch (err) {
    console.error('admin/delete 错误:', err);
    res.json({ ok: false, msg: '删除失败' });
  }
});

app.post('/api/admin/toggle', (req, res) => {
  try {
    const { username, enabled } = req.body;
    const db = readDB();
    const u = db.find(x => x.username === username);
    if (u) {
      u.enabled = enabled;
      if (!enabled) u.token = null;
    }
    writeDB(db);
    res.json({ ok: true });
  } catch (err) {
    console.error('admin/toggle 错误:', err);
    res.json({ ok: false, msg: '操作失败' });
  }
});

app.post('/api/admin/batch', (req, res) => {
  try {
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
  } catch (err) {
    console.error('admin/batch 错误:', err);
    res.json({ ok: false, msg: '批量添加失败' });
  }
});

// ------------------------------
// 修改管理员账号密码
// ------------------------------
app.post('/api/admin/set-user-pwd', (req, res) => {
  try {
    const { newUser, newPwd } = req.body;
    if (newUser) admin.user = newUser;
    if (newPwd) admin.pwd = newPwd;
    res.json({ ok: true });
  } catch (err) {
    console.error('admin/set-user-pwd 错误:', err);
    res.json({ ok: false });
  }
});

// ------------------------------
// 设置用户有效期
// ------------------------------
app.post('/api/admin/set-expire', (req, res) => {
  try {
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
  } catch (err) {
    console.error('admin/set-expire 错误:', err);
    res.json({ ok: false, msg: '设置失败' });
  }
});

// ===================== 新增接口：管理员修改用户美金余额 =====================
app.post('/api/admin/set-usd-balance', (req, res) => {
  try {
    const { username, usd_balance } = req.body;
    const db = readDB();
    const user = db.find(u => u.username === username);
    if (!user) return res.json({ ok: false, msg: "用户不存在" });
    user.usd_balance = parseFloat(usd_balance) || 0;
    writeDB(db);
    res.json({ ok: true });
  } catch (err) {
    console.error('admin/set-usd-balance 错误:', err);
    res.json({ ok: false, msg: '修改余额失败' });
  }
});

// ===================== 新增接口：扣除Coin余额（加了 try-catch 防护） =====================
app.post('/api/deduct-coin', (req, res) => {
  try {
    const { username, token, coinAmount } = req.body;

    // 参数校验
    if (!username || !token || !coinAmount || coinAmount <= 0) {
      return res.json({ ok: false, msg: "参数不完整" });
    }

    const db = readDB();
    const user = db.find(u => u.username === username);

    if (!user || !user.enabled || !user.token || user.token !== token) {
      return res.json({ ok: false, msg: "登录失效，请重新登录" });
    }
    if (user.expireAt && Date.now() > new Date(user.expireAt).getTime()) {
      return res.json({ ok: false, msg: "账号已过期" });
    }

    const usdNeed = coinAmount / USD_TO_COIN_RATE;
    const currentUsd = Number(user.usd_balance || 0);

    if (currentUsd < usdNeed) {
      return res.json({ ok: false, msg: "余额不足" });
    }

    // 扣减余额，用 Math.round 避免浮点精度漂移
    user.usd_balance = Math.round((currentUsd - usdNeed) * 100) / 100;
    writeDB(db);

    const newUsd = user.usd_balance;
    const newCoin = newUsd * USD_TO_COIN_RATE;

    res.json({
      ok: true,
      new_usd: newUsd,
      new_coin: newCoin
    });
  } catch (err) {
    console.error('deduct-coin 错误:', err);
    res.json({ ok: false, msg: "扣款处理失败，请稍后重试" });
  }
});

// ===================== 全局错误兜底（任何未捕获异常都不会让服务崩） =====================
app.use((err, req, res, next) => {
  console.error('全局未捕获错误:', err);
  res.status(500).json({ ok: false, msg: '服务器内部错误' });
});

const PORT = process.env.PORT || 3000;
// ✅ Render必须监听 0.0.0.0，避免健康检测失败
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Running on ${PORT}`);
});

