const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = __dirname;
// На хостинге укажи KF_DATA_DIR на постоянный диск/каталог.
// Локально данные по умолчанию остаются в папке проекта: data/accounts.json.
const DATA_DIR = path.resolve(process.env.KF_DATA_DIR || path.join(ROOT, 'data'));
const DB_FILE = path.join(DATA_DIR, 'accounts.json');
const PORT = Number(process.env.PORT || 3000);

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ users: [] }, null, 2), { mode: 0o600 });

const sessions = new Map();
const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.png':'image/png', '.svg':'image/svg+xml', '.mp4':'video/mp4', '.txt':'text/plain; charset=utf-8', '.ico':'image/x-icon', '.webp':'image/webp', '.gif':'image/gif' };
function readDb() {
  try {
    const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    return db && Array.isArray(db.users) ? db : { users: [] };
  } catch (err) {
    console.error('Не удалось прочитать базу аккаунтов:', err.message);
    throw new Error('Не удалось прочитать базу аккаунтов.');
  }
}
// Атомарная запись снижает риск повреждения файла при остановке процесса во время сохранения.
function writeDb(db) {
  const temp = DB_FILE + '.' + process.pid + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(db, null, 2), { mode: 0o600 });
  fs.renameSync(temp, DB_FILE);
}
function json(res, status, value, extra = {}) { res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', ...extra }); res.end(JSON.stringify(value)); }
function cookies(req) { return Object.fromEntries((req.headers.cookie || '').split(';').map(x => x.trim()).filter(Boolean).map(x => { const i=x.indexOf('='); return [x.slice(0,i), decodeURIComponent(x.slice(i+1))]; })); }
function sessionUser(req) { const token = cookies(req).kf_session; const email = token && sessions.get(token); if (!email) return null; return readDb().users.find(u => u.email === email) || null; }
function publicUser(u) { return { email:u.email, avatar:u.avatar || '', createdAt:u.createdAt || '' }; }
function readBody(req, limit=2*1024*1024) { return new Promise((resolve, reject) => { let data='', size=0; req.on('data', chunk => { size += chunk.length; if (size > limit) { reject(Object.assign(new Error('Слишком большой запрос'), { status:413 })); req.destroy(); return; } data += chunk; }); req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(Object.assign(new Error('Некорректный JSON'), { status:400 })); } }); req.on('error', reject); }); }
function hashPassword(password, salt=crypto.randomBytes(16).toString('hex')) { return new Promise((resolve,reject) => crypto.scrypt(password, salt, 64, (err, key) => err ? reject(err) : resolve({ salt, hash:key.toString('hex') }))); }
async function passwordMatches(password, user) {
  if (!user || typeof user.salt !== 'string' || typeof user.hash !== 'string' || !/^[a-f0-9]{128}$/i.test(user.hash)) return false;
  const key = await new Promise((resolve,reject) => crypto.scrypt(password, user.salt, 64, (err,k) => err ? reject(err) : resolve(k)));
  return crypto.timingSafeEqual(key, Buffer.from(user.hash,'hex'));
}
function validEmail(email) { return typeof email === 'string' && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
function validAvatar(value) { return value === '' || (typeof value === 'string' && /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(value) && value.length <= 1_000_000); }
async function api(req,res,url) {
  if (req.method === 'GET' && url.pathname === '/api/me') { const u=sessionUser(req); return json(res,200,{ user:u?publicUser(u):null }); }
  if (req.method === 'POST' && url.pathname === '/api/register') {
    const b=await readBody(req); const email=String(b.email||'').trim().toLowerCase(); const password=b.password;
    if (!validEmail(email)) return json(res,400,{error:'Введи корректную электронную почту.'});
    if (typeof password !== 'string' || password.length < 8 || password.length > 200) return json(res,400,{error:'Пароль должен содержать от 8 до 200 символов.'});
    const db=readDb(); if(db.users.some(u=>u.email===email)) return json(res,409,{error:'Аккаунт с такой почтой уже существует. Войди в него.'});
    const p=await hashPassword(password); const user={email,salt:p.salt,hash:p.hash,avatar:'',favorites:[],progress:{},createdAt:new Date().toISOString()};
    db.users.push(user); writeDb(db); const token=crypto.randomBytes(32).toString('hex'); sessions.set(token,email);
    return json(res,201,{user:publicUser(user)},{'Set-Cookie':'kf_session='+token+'; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000'});
  }
  if (req.method === 'POST' && url.pathname === '/api/login') {
    const b=await readBody(req); const email=String(b.email||'').trim().toLowerCase(); const password=b.password;
    const user=readDb().users.find(u=>u.email===email);
    if (!user || typeof password!=='string' || !(await passwordMatches(password,user))) return json(res,401,{error:'Неверная почта или пароль.'});
    const token=crypto.randomBytes(32).toString('hex'); sessions.set(token,email);
    return json(res,200,{user:publicUser(user)},{'Set-Cookie':'kf_session='+token+'; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000'});
  }
  if (req.method === 'POST' && url.pathname === '/api/logout') {
    const token=cookies(req).kf_session; if(token) sessions.delete(token);
    return json(res,200,{ok:true},{'Set-Cookie':'kf_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'});
  }
  const user=sessionUser(req);
  if (!user) return json(res,401,{error:'Войди в аккаунт, чтобы сохранить изменения.'});
  const db=readDb(); const saved=db.users.find(u=>u.email===user.email);
  if(req.method==='GET' && url.pathname==='/api/library') return json(res,200,{favorites:saved.favorites||[],progress:saved.progress||{}});
  if(req.method==='POST' && url.pathname==='/api/profile') {
    const b=await readBody(req); if(!validAvatar(b.avatar)) return json(res,400,{error:'Не удалось сохранить аватар. Выбери изображение до 700 КБ.'});
    saved.avatar=b.avatar; writeDb(db); return json(res,200,{user:publicUser(saved)});
  }
  if(req.method==='POST' && url.pathname==='/api/favorites') {
    const b=await readBody(req); const id=String(b.id||''); if(!/^[a-z0-9_-]{1,80}$/i.test(id)) return json(res,400,{error:'Неизвестный фильм или сериал.'});
    saved.favorites=saved.favorites||[]; const isFavorite=saved.favorites.includes(id);
    saved.favorites=isFavorite?saved.favorites.filter(x=>x!==id):[...saved.favorites,id]; writeDb(db);
    return json(res,200,{favorites:saved.favorites,isFavorite:!isFavorite});
  }
  if(req.method==='POST' && url.pathname==='/api/progress') {
    const b=await readBody(req); const id=String(b.id||''); const time=Number(b.time); const duration=Number(b.duration); const title=String(b.title||id).slice(0,160); const kind=b.kind==='series'?'series':'movie';
    if(!/^[a-z0-9_-]{1,80}$/i.test(id)||!Number.isFinite(time)||time<0||!Number.isFinite(duration)||duration<0) return json(res,400,{error:'Некорректная позиция просмотра.'});
    saved.progress=saved.progress||{}; if(duration>0 && time>=duration-5) delete saved.progress[id]; else saved.progress[id]={id,time,duration,title,kind,updatedAt:Date.now()};
    writeDb(db); return json(res,200,{ok:true});
  }
  return json(res,404,{error:'API-маршрут не найден.'});
}
const server=http.createServer(async(req,res)=>{
  let url;
  try { url=new URL(req.url,'http://localhost'); }
  catch { res.writeHead(400); return res.end('Некорректный запрос.'); }
  if(url.pathname.startsWith('/api/')) { try { await api(req,res,url); } catch(e) { console.error(e); if(!res.headersSent) json(res,e.status||500,{error:e.status?e.message:'Внутренняя ошибка сервера.'}); } return; }
  let pathname;
  try { pathname=decodeURIComponent(url.pathname); }
  catch { res.writeHead(400); return res.end('Некорректный путь.'); }
  if(pathname==='/') pathname='/index.html';
  // Никогда не отдаём браузеру базу аккаунтов, серверный код или секретные файлы.
  if (/(^|\/)data(\/|$)/i.test(pathname) || /(^|\.)(env|git)(\/|$)/i.test(pathname) || /(^|\/)(server\.js|package-lock\.json|accounts\.json)$/i.test(pathname)) {
    res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8','X-Content-Type-Options':'nosniff'}); return res.end('Файл не найден.');
  }
  const target=path.resolve(ROOT,'.'+pathname);
  if(!target.startsWith(ROOT+path.sep) && target!==ROOT) { res.writeHead(403); return res.end('Forbidden'); }
  fs.stat(target,(err,st)=>{ if(err||!st.isFile()) {res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'}); return res.end('Файл не найден.');}
    res.writeHead(200,{'Content-Type':mime[path.extname(target).toLowerCase()]||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':path.extname(target).toLowerCase()==='.html'?'no-cache':'public, max-age=3600'});
    fs.createReadStream(target).pipe(res);
  });
});
server.listen(PORT,'0.0.0.0',()=>console.log('KF Production запущен: http://localhost:'+PORT+'; база аккаунтов: '+DB_FILE));
