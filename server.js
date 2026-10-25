const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = __dirname;
// Загружаем локальные настройки из .env без сторонних зависимостей; переменные окружения хостинга имеют приоритет.
const ENV_FILE = path.join(ROOT, '.env');
if (fs.existsSync(ENV_FILE)) {
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, '$2');
  }
}
// На хостинге укажи KF_DATA_DIR на постоянный диск/каталог.
// Локально данные по умолчанию остаются в папке проекта: data/accounts.json.
const DATA_DIR = path.resolve(process.env.KF_DATA_DIR || path.join(ROOT, 'data'));
const DB_FILE = path.join(DATA_DIR, 'accounts.json');
const PORT = Number(process.env.PORT || 3000);

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ users: [] }, null, 2), { mode: 0o600 });

const sessions = new Map();
const adminSessions = new Map();
const CATALOG_FILE = path.join(DATA_DIR, 'catalog.json');
const ADMINS_FILE = path.join(DATA_DIR, 'admins.json');
if (!fs.existsSync(ADMINS_FILE)) fs.writeFileSync(ADMINS_FILE, JSON.stringify({ admins: [] }, null, 2), { mode: 0o600 });
const MEDIA_DIR = path.resolve(process.env.KF_MEDIA_DIR || path.join(ROOT, 'uploads'));
fs.mkdirSync(MEDIA_DIR, { recursive: true });
if (!fs.existsSync(CATALOG_FILE)) fs.writeFileSync(CATALOG_FILE, JSON.stringify({ items: [] }, null, 2), { mode: 0o600 });
const mime= { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.png':'image/png', '.svg':'image/svg+xml', '.mp4':'video/mp4', '.webm':'video/webm', '.txt':'text/plain; charset=utf-8', '.ico':'image/x-icon', '.webp':'image/webp', '.gif':'image/gif' };
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
function readCatalog() {
  try { const data = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8')); return data && Array.isArray(data.items) ? data : { items: [] }; }
  catch (err) { console.error('Не удалось прочитать каталог:', err.message); throw new Error('Не удалось прочитать каталог.'); }
}
function writeCatalog(data) {
  const temp = CATALOG_FILE + '.' + process.pid + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(temp, CATALOG_FILE);
}
function readAdmins() { const data = JSON.parse(fs.readFileSync(ADMINS_FILE, 'utf8')); return data && Array.isArray(data.admins) ? data : { admins: [] }; }
function writeAdmins(data) { const temp = ADMINS_FILE + '.' + process.pid + '.tmp'; fs.writeFileSync(temp, JSON.stringify(data, null, 2), { mode: 0o600 }); fs.renameSync(temp, ADMINS_FILE); }
function adminEmail(req) { const token = cookies(req).kf_admin; return token ? (adminSessions.get(token) || null) : null; }
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aa = Buffer.from(a), bb = Buffer.from(b);
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function validMediaPath(value, optional=false) {
  if (optional && value === '') return true;
  if (typeof value !== 'string' || !value || value.length > 2000 || /[\\\\\r\n]/.test(value)) return false;
  if (/^https:\/\//i.test(value)) return true;
  return /^(assets|films)\/[a-z0-9_ .%()\-]+\.(jpg|jpeg|png|webp|gif|mp4|webm|vtt|txt)$/i.test(value) || /^\/media\/[a-z0-9_.-]+\.(jpg|jpeg|png|webp|gif|mp4|webm)$/i.test(value);
}
function cleanCatalogItem(body, existing={}) {
  const title = String(body.title || '').trim().slice(0,160);
  const kind = body.kind === 'series' ? 'series' : body.kind === 'movie' ? 'movie' : '';
  const video = String(body.video || '').trim();
  const poster = String(body.poster || '').trim();
  const trailer = String(body.trailer || '').trim();
  if (!title || !kind || !video || !validMediaPath(video) || !validMediaPath(poster,true) || !validMediaPath(trailer,true))
    throw Object.assign(new Error('Проверь название, тип и адреса постера/видео. Используй HTTPS-ссылку или путь assets/... / films/...'), { status: 400 });
  const id = existing.id || ('kf-' + crypto.randomBytes(6).toString('hex'));
  const year = String(body.year || '').trim();
  if (year && !/^\d{4}$/.test(year)) throw Object.assign(new Error('Год должен состоять из четырёх цифр.'), { status: 400 });
  const cast = Array.isArray(body.cast) ? body.cast.slice(0,30).map(x => [String(x[0]||'').slice(0,80),String(x[1]||'').slice(0,300)]).filter(x=>x[0]&&x[1]) : [];
  return { id, title, kind, year, genre:String(body.genre||'').trim().slice(0,100), description:String(body.description||'').trim().slice(0,4000), poster, video, videoTitle:String(body.videoTitle||title).trim().slice(0,160), trailer, cast, updatedAt:new Date().toISOString() };
}
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
  if (req.method === 'GET' && url.pathname === '/api/catalog') return json(res,200,{items:readCatalog().items});
  if (req.method === 'GET' && url.pathname === '/api/admin/me') { const username=adminEmail(req); return json(res,200,{authenticated:!!username,username}); }
  if (req.method === 'POST' && url.pathname === '/api/admin/login') {
    const b=await readBody(req,16*1024); const username=String(b.username||'').trim().toLowerCase(); const password=b.password;
    const store=readAdmins(); let admin=store.admins.find(a=>a.username===username);
    // Первичный администратор создаётся из серверных переменных только при пустом списке.
    if (!store.admins.length && process.env.KF_ADMIN_USER && process.env.KF_ADMIN_PASSWORD && safeEqual(username,process.env.KF_ADMIN_USER.trim().toLowerCase()) && safeEqual(String(password||''),process.env.KF_ADMIN_PASSWORD)) {
      const p=await hashPassword(String(password)); admin={username,salt:p.salt,hash:p.hash,createdAt:new Date().toISOString()}; store.admins.push(admin); writeAdmins(store);
    }
    if (!admin || typeof password!=='string' || !(await passwordMatches(password,admin))) return json(res,401,{error:'Неверный логин или пароль администратора.'});
    const token=crypto.randomBytes(32).toString('hex'); adminSessions.set(token,admin.username);
    const secure=process.env.NODE_ENV==='production' ? '; Secure' : '';
    return json(res,200,{ok:true,username:admin.username},{'Set-Cookie':'kf_admin='+token+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800'+secure});
  }
  if (req.method === 'GET' && url.pathname === '/api/admin/accounts') {
    if (!adminEmail(req)) return json(res,401,{error:'Войди в панель администратора.'});
    return json(res,200,{admins:readAdmins().admins.map(a=>({username:a.username,createdAt:a.createdAt||''}))});
  }
  if (req.method === 'POST' && url.pathname === '/api/admin/accounts') {
    if (!adminEmail(req)) return json(res,401,{error:'Войди в панель администратора.'});
    const b=await readBody(req,16*1024); const username=String(b.username||'').trim().toLowerCase(); const password=b.password;
    if (!/^[a-z0-9][a-z0-9._-]{2,39}$/.test(username)) return json(res,400,{error:'Логин: 3–40 символов, латинские буквы, цифры, точка, дефис или подчёркивание.'});
    if (typeof password!=='string'||password.length<12||password.length>200) return json(res,400,{error:'Пароль нового администратора должен содержать от 12 до 200 символов.'});
    const store=readAdmins(); if(store.admins.some(a=>a.username===username)) return json(res,409,{error:'Администратор с таким логином уже существует.'});
    const p=await hashPassword(password); store.admins.push({username,salt:p.salt,hash:p.hash,createdAt:new Date().toISOString()}); writeAdmins(store);
    return json(res,201,{ok:true,admin:{username,createdAt:new Date().toISOString()}});
  }
  if (req.method === 'DELETE' && url.pathname.startsWith('/api/admin/accounts/')) {
    if (!adminEmail(req)) return json(res,401,{error:'Войди в панель администратора.'});
    const username=decodeURIComponent(url.pathname.slice('/api/admin/accounts/'.length)).toLowerCase();
    if(username===adminEmail(req)) return json(res,400,{error:'Нельзя удалить текущий аккаунт, пока ты в нём авторизован.'});
    const store=readAdmins(); if(store.admins.length<=1) return json(res,400,{error:'Нельзя удалить последнего администратора.'});
    const before=store.admins.length; store.admins=store.admins.filter(a=>a.username!==username);
    if(store.admins.length===before) return json(res,404,{error:'Администратор не найден.'}); writeAdmins(store);
    for (const [token, name] of adminSessions) if (name === username) adminSessions.delete(token);
    return json(res,200,{ok:true});
  }
  if (req.method === 'POST' && url.pathname === '/api/admin/logout') {
    const token=cookies(req).kf_admin; if(token) adminSessions.delete(token);
    return json(res,200,{ok:true},{'Set-Cookie':'kf_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'});
  }
  if (req.method === 'POST' && url.pathname === '/api/admin/upload') {
    if (!adminEmail(req)) return json(res,401,{error:'Войди в панель администратора.'});
    const b=await readBody(req,110*1024*1024);
    const kind=b.kind==='poster'?'poster':'video';
    const original=String(b.filename||'').split(/[\\\\/]/).pop().toLowerCase();
    const ext=path.extname(original);
    const allowed=kind==='poster'?['.jpg','.jpeg','.png','.webp','.gif']:['.mp4','.webm'];
    if(!allowed.includes(ext)) return json(res,400,{error:kind==='poster'?'Постер должен быть JPG, PNG, WebP или GIF.':'Видео должно быть MP4 или WebM.'});
    const encoded=String(b.data||'');
    if(!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length<8) return json(res,400,{error:'Файл не удалось прочитать.'});
    const bytes=Buffer.from(encoded,'base64');
    const max=kind==='poster'?5*1024*1024:80*1024*1024;
    if(!bytes.length || bytes.length>max) return json(res,413,{error:kind==='poster'?'Постер должен быть не больше 5 МБ.':'Видео должно быть не больше 80 МБ.'});
    const stored=Date.now().toString(36)+'-'+crypto.randomBytes(6).toString('hex')+ext;
    fs.writeFileSync(path.join(MEDIA_DIR,stored),bytes,{flag:'wx'});
    return json(res,201,{path:'/media/'+stored,size:bytes.length,message:'Файл загружен на сервер.'});
  }
  if (url.pathname.startsWith('/api/admin/catalog')) {
    if (!adminEmail(req)) return json(res,401,{error:'Войди в панель администратора.'});
    const catalog=readCatalog();
    if (req.method==='GET' && url.pathname==='/api/admin/catalog') return json(res,200,{items:catalog.items});
    if (req.method==='POST' && url.pathname==='/api/admin/catalog') {
      const item=cleanCatalogItem(await readBody(req),{}); catalog.items.unshift(item); writeCatalog(catalog);
      return json(res,201,{item,message:'Публикация добавлена в каталог.'});
    }
    const match=url.pathname.match(/^\/api\/admin\/catalog\/([a-z0-9_-]{1,80})$/i);
    if (match && req.method==='PUT') {
      const index=catalog.items.findIndex(x=>x.id===match[1]); if(index<0) return json(res,404,{error:'Публикация не найдена.'});
      catalog.items[index]=cleanCatalogItem(await readBody(req),catalog.items[index]); writeCatalog(catalog);
      return json(res,200,{item:catalog.items[index],message:'Изменения сохранены.'});
    }
    if (match && req.method==='DELETE') {
      const before=catalog.items.length; catalog.items=catalog.items.filter(x=>x.id!==match[1]);
      if(catalog.items.length===before) return json(res,404,{error:'Публикация не найдена.'});
      writeCatalog(catalog); return json(res,200,{ok:true});
    }
    return json(res,405,{error:'Метод не поддерживается.'});
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
  const isMedia = pathname.startsWith('/media/');
  const baseDir = isMedia ? MEDIA_DIR : ROOT;
  const target = isMedia ? path.resolve(MEDIA_DIR, pathname.slice('/media/'.length)) : path.resolve(ROOT, '.' + pathname);
  if(!target.startsWith(baseDir+path.sep) && target!==baseDir) { res.writeHead(403); return res.end('Forbidden'); }
  fs.stat(target,(err,st)=>{ if(err||!st.isFile()) {res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'}); return res.end('Файл не найден.');}
    res.writeHead(200,{'Content-Type':mime[path.extname(target).toLowerCase()]||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':path.extname(target).toLowerCase()==='.html'?'no-cache':'public, max-age=3600'});
    fs.createReadStream(target).pipe(res);
  });
});
server.listen(PORT,'0.0.0.0',()=>console.log('KF Production запущен: http://localhost:'+PORT+'; база аккаунтов: '+DB_FILE));
