(() => {
  const $ = (s, root=document) => root.querySelector(s);
  let supabaseClientPromise;
  const getSupabase = async () => {
    if (supabaseClientPromise) return supabaseClientPromise;
    supabaseClientPromise = (async () => {
      if (!window.KF_SUPABASE_URL || !window.KF_SUPABASE_PUBLISHABLE_KEY ||
          window.KF_SUPABASE_PUBLISHABLE_KEY === 'PASTE_YOUR_SB_PUBLISHABLE_KEY_HERE') {
        throw new Error('Добавь публичный sb_publishable_ ключ в файл supabase-config.js.');
      }
      if (!window.supabase?.createClient) {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
          script.onload = resolve;
          script.onerror = () => reject(new Error('Не удалось загрузить библиотеку Supabase. Проверь подключение к интернету.'));
          document.head.appendChild(script);
        });
      }
      return window.supabase.createClient(window.KF_SUPABASE_URL, window.KF_SUPABASE_PUBLISHABLE_KEY);
    })();
    return supabaseClientPromise;
  };
  const api = async (url, options={}) => {
    const sb = await getSupabase();
    const body = options.body ? JSON.parse(options.body) : {};
    const fail = (error) => { throw new Error(error?.message || 'Произошла ошибка Supabase.'); };
    if (url === '/api/register' && options.method === 'POST') {
      const { data, error } = await sb.auth.signUp({ email: body.email, password: body.password });
      if (error) fail(error);
      if (data.user && data.session) {
        const { error: profileError } = await sb.from('profiles').upsert({ id: data.user.id, username: body.email.split('@')[0] });
        if (profileError) fail(profileError);
      }
      if (data.user && !data.session) return { pendingEmailConfirmation: true };
      return { user: data.user };
    }
    if (url === '/api/login' && options.method === 'POST') {
      const { data, error } = await sb.auth.signInWithPassword({ email: body.email, password: body.password });
      if (error) fail(error);
      return { user: data.user };
    }
    if (url === '/api/logout' && options.method === 'POST') {
      const { error } = await sb.auth.signOut(); if (error) fail(error); return { ok: true };
    }
    if (url === '/api/me') {
      const { data: { user }, error } = await sb.auth.getUser();
      if (error && error.name !== 'AuthSessionMissingError') fail(error);
      if (!user) return { user: null };
      // Profile data is optional and must not prevent a valid Supabase login.
      let profile = null;
      try {
        const { data, error: profileError } = await sb.from('profiles').select('username,avatar_url').eq('id', user.id).maybeSingle();
        if (!profileError) profile = data;
        else console.warn('KF Production: профиль не прочитан:', profileError.message);
      } catch (profileError) {
        console.warn('KF Production: профиль не прочитан:', profileError);
      }
      return { user: { id: user.id, email: user.email, avatar: profile?.avatar_url || null, username: profile?.username || (user.email || '').split('@')[0] } };
    }
    if (url === '/api/library') {
      const { data: { user }, error: userError } = await sb.auth.getUser(); if (userError) fail(userError);
      if (!user) return { favorites: [], progress: {} };
      const [f, p] = await Promise.all([
        sb.from('favorites').select('film_id').eq('user_id', user.id),
        sb.from('watch_progress').select('film_id,position_seconds,duration_seconds,updated_at').eq('user_id', user.id)
      ]);
      if (f.error) fail(f.error); if (p.error) fail(p.error);
      const progress = {};
      (p.data || []).forEach(row => { progress[row.film_id] = { id: row.film_id, time: row.position_seconds, duration: row.duration_seconds || 0, updatedAt: Date.parse(row.updated_at) || 0 }; });
      return { favorites: (f.data || []).map(row => row.film_id), progress };
    }
    if (url === '/api/favorites' && options.method === 'POST') {
      const { data: { user }, error: userError } = await sb.auth.getUser(); if (userError) fail(userError);
      if (!user) throw new Error('Сначала войди в аккаунт.');
      const { data: existing, error: readError } = await sb.from('favorites').select('id').eq('user_id', user.id).eq('film_id', body.id).maybeSingle();
      if (readError) fail(readError);
      if (existing) {
        const { error } = await sb.from('favorites').delete().eq('id', existing.id); if (error) fail(error); return { isFavorite: false };
      }
      const { error } = await sb.from('favorites').insert({ user_id: user.id, film_id: body.id }); if (error) fail(error); return { isFavorite: true };
    }
    if (url === '/api/profile' && options.method === 'POST') {
      const { data: { user }, error: userError } = await sb.auth.getUser(); if (userError) fail(userError);
      if (!user) throw new Error('Сначала войди в аккаунт.');
      const { error } = await sb.from('profiles').upsert({ id: user.id, avatar_url: body.avatar });
      if (error) fail(error); return { user: { id: user.id, email: user.email, avatar: body.avatar } };
    }
    if (url === '/api/progress' && options.method === 'POST') {
      const { data: { user }, error: userError } = await sb.auth.getUser(); if (userError) fail(userError);
      if (!user) return { ok: true };
      const { error } = await sb.from('watch_progress').upsert({ user_id: user.id, film_id: body.id, position_seconds: Math.max(0, Number(body.time) || 0), duration_seconds: Math.max(0, Number(body.duration) || 0), updated_at: new Date().toISOString() }, { onConflict: 'user_id,film_id' });
      if (error) fail(error); return { ok: true };
    }
    // Admin and dynamic catalogue endpoints still belong to the existing Node.js backend.
    const response = await fetch(url, { credentials:'same-origin', headers:{'Content-Type':'application/json', ...(options.headers||{})}, ...options });
    const data = await response.json().catch(()=>({error:'Не удалось прочитать ответ сервера.'}));
    if(!response.ok) throw new Error(data.error || 'Произошла ошибка.');
    return data;
  };
  const accountPage = document.body.classList.contains('account-page');
  let currentUser = null;
  function makeHeaderLink(user) {
    const header=$('.topbar'); if(!header) return;
    let a=$('.account-nav-link',header);
    if(!a) {
      a=document.createElement('a'); a.className='top-cta account-nav-link'; a.href='account.html';
      const menu=$('.menu-toggle',header); header.insertBefore(a,menu||null);
    }
    a.textContent=user?'Мой профиль':'Войти';
    a.setAttribute('aria-label', a.textContent);
  }
  async function refreshAdminLink() {
    const header=$('.topbar'); if(!header) return;
    let isAdmin=false;
    try {
      const sb=await getSupabase();
      const { data: { session }, error: sessionError } = await sb.auth.getSession();
      if (sessionError) throw sessionError;
      if (session?.access_token) {
        const response=await fetch(window.KF_SUPABASE_URL+'/functions/v1/kf-admin/me', {
          headers: { apikey: window.KF_SUPABASE_PUBLISHABLE_KEY, Authorization: 'Bearer '+session.access_token },
          cache: 'no-store'
        });
        if (response.ok) {
          const result=await response.json();
          isAdmin=result.authenticated===true;
        }
      }
    } catch { isAdmin=false; }
    let link=$('.admin-panel-nav-link',header);
    if(isAdmin && !link) { link=document.createElement('a'); link.className='top-cta admin-panel-nav-link'; link.href='admin.html'; link.textContent='Админ-панель'; const menu=$('.menu-toggle',header); header.insertBefore(link,menu||null); }
    if(!isAdmin && link) link.remove();
  }
  async function refreshUser() {
    // Show the sign-in link immediately, without waiting for Supabase/network.
    makeHeaderLink(currentUser);
    const header=$('.topbar');
    const staleAdminLink=header&&$('.admin-panel-nav-link',header);
    if(staleAdminLink) staleAdminLink.remove();
    try {
      const result=await api('/api/me');
      currentUser=result.user||null;
      makeHeaderLink(currentUser);
    } catch (error) {
      // A temporary network error is not proof that the saved session is invalid.
      makeHeaderLink(currentUser);
      console.warn('KF Production: не удалось проверить сессию:', error);
    }
    await refreshAdminLink();
    if(accountPage) renderAccount();
    if($('.detail-actions')) addFavoriteButton();
  }
  async function addFavoriteButton() {
    const actions=$('.detail-actions'); if(!actions || $('.favorite-toggle',actions)) return;
    const btn=document.createElement('button'); btn.type='button'; btn.className='detail-trailer-link favorite-toggle'; btn.textContent='♡ В избранное';
    btn.style.cssText='background:#ffffff10;border:1px solid #ffffff26;border-radius:9px;padding:14px 18px;color:#fff;cursor:pointer;font:inherit;font-size:13px';
    actions.appendChild(btn);
    const id=new URLSearchParams(location.search).get('id')||'zona0';
    const sync=async()=>{ if(!currentUser) return; try { const lib=await api('/api/library'); const yes=(lib.favorites||[]).includes(id); btn.textContent=yes?'♥ В избранном':'♡ В избранное'; btn.classList.toggle('is-favorite',yes); } catch {} };
    btn.addEventListener('click',async()=>{
      if(!currentUser){ location.href='account.html?next='+encodeURIComponent(location.pathname+location.search); return; }
      try { const result=await api('/api/favorites',{method:'POST',body:JSON.stringify({id})}); btn.textContent=result.isFavorite?'♥ В избранном':'♡ В избранное'; }
      catch(e){ alert(e.message); }
    });
    await sync();
  }
  const knownItems = {
    zona0:{title:'ЗОНА 0',url:'detail.html?id=zona0',image:'assets/zona-0.jpg',kind:'СЕРИАЛ',video:'films/zona-0-episode1.mp4',videoTitle:'ЗОНА 0 — 1 серия'}
  };
  function itemCard(id, label, progress) {
    const item=knownItems[id]; if(!item) return null;
    const a=document.createElement('a'); a.className='account-media-card'; a.href=item.url; a.style.cssText='display:block;width:160px;max-width:100%;min-width:0;overflow:hidden;box-sizing:border-box;'
    const img=document.createElement('img'); img.src=item.image; img.alt=''; img.loading='lazy'; img.style.cssText='display:block;width:100%;max-width:100%;height:240px;aspect-ratio:auto;object-fit:cover;box-sizing:border-box;'
    const copy=document.createElement('div'); copy.className='account-media-copy';
    const small=document.createElement('span'); small.textContent=label||item.kind;
    const title=document.createElement('b'); title.textContent=item.title;
    copy.append(small,title);
    if(progress && progress.duration>0) {
      const wrap=document.createElement('div'); wrap.className='account-progress-track';
      const fill=document.createElement('span'); fill.style.width=Math.max(0,Math.min(100,progress.time/progress.duration*100))+'%'; wrap.append(fill); copy.append(wrap);
      const time=document.createElement('small'); time.textContent='Продолжить с '+formatTime(progress.time); copy.append(time);
      a.href='player.html?video='+encodeURIComponent('films/zona-0-episode1.mp4')+'&title='+encodeURIComponent('ЗОНА 0 — 1 серия')+'&kind=series&id=zona0';
    }
    a.append(img,copy); return a;
  }
  function formatTime(value){ const s=Math.floor(value||0); return Math.floor(s/60)+':'+String(s%60).padStart(2,'0'); }
  async function renderAccount() {
    const auth=$('#accountAuth'), profile=$('#accountProfile'); if(!auth||!profile) return;
    auth.hidden=!!currentUser; profile.hidden=!currentUser;
    if(!currentUser) return;
    $('#accountEmail').textContent=currentUser.email;
    const avatar=$('#accountAvatar'); avatar.src=currentUser.avatar||'';
    avatar.hidden=!currentUser.avatar;
    $('#accountAvatarPlaceholder').hidden=!!currentUser.avatar;
    const next=new URLSearchParams(location.search).get('next');
    const continueButton=$('#continueLast');
    continueButton.hidden=true;
    $('#favoriteList').replaceChildren(); $('#progressList').replaceChildren();
    try {
      const lib=await api('/api/library');
      const favorites=lib.favorites||[], progress=lib.progress||{};
      favorites.forEach(id=>{const card=itemCard(id,'ИЗБРАННОЕ');if(card)$('#favoriteList').append(card);});
      Object.values(progress).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0)).forEach(p=>{const card=itemCard(p.id,'ПРОДОЛЖИТЬ ПРОСМОТР',p);if(card)$('#progressList').append(card);});
      $('#favoritesEmpty').hidden=favorites.length>0;
      $('#progressEmpty').hidden=Object.keys(progress).length>0;
    } catch(e) { $('#accountMessage').textContent=e.message; }
    if(next) continueButton.hidden=false;
    continueButton.onclick=()=>location.href=next||'index.html';
  }
  if(accountPage) {
    const tabs=$$('.auth-tab'), form=$('#authForm'), submit=$('#authSubmit'), heading=$('#authHeading');
    let mode='login';
    function $$(s,root=document){return Array.from(root.querySelectorAll(s));}
    tabs.forEach(tab=>tab.addEventListener('click',()=>{mode=tab.dataset.mode;tabs.forEach(t=>t.classList.toggle('active',t===tab));submit.textContent=mode==='register'?'Создать аккаунт':'Войти';heading.textContent=mode==='register'?'Создай аккаунт KF Production':'Вход в KF Production';$('#passwordHelp').hidden=mode!=='register';$('#authMessage').textContent='';}));
    form.addEventListener('submit',async e=>{
      e.preventDefault(); $('#authMessage').textContent='Проверяем данные…'; submit.disabled=true;
      try {
        const authResult = await api('/api/'+mode,{method:'POST',body:JSON.stringify({email:$('#email').value,password:$('#password').value})});
        if (mode === 'register' && authResult.pendingEmailConfirmation) {
          $('#authMessage').textContent='Аккаунт создан. Проверь почту и подтверди адрес, затем войди.';
          return;
        }
        currentUser=(await api('/api/me')).user;
        if (!currentUser) { $('#authMessage').textContent='Проверь почту для подтверждения регистрации, затем войди.'; return; }
        $('#authMessage').textContent=''; renderAccount();
        const next=new URLSearchParams(location.search).get('next'); if(next) location.href=next;
      } catch(err){$('#authMessage').textContent=err.message;} finally {submit.disabled=false;}
    });
    $('#logoutButton').addEventListener('click',async()=>{try{await api('/api/logout',{method:'POST',body:'{}'});currentUser=null;renderAccount();}catch(e){$('#accountMessage').textContent=e.message;}});
    $('#avatarFile').addEventListener('change',async()=>{
      const file=$('#avatarFile').files[0]; if(!file)return;
      if(!/^image\/(png|jpeg|webp|gif)$/.test(file.type)||file.size>700*1024){$('#accountMessage').textContent='Выбери PNG, JPG, WebP или GIF размером до 700 КБ.';return;}
      const reader=new FileReader(); reader.onload=async()=>{try{const r=await api('/api/profile',{method:'POST',body:JSON.stringify({avatar:reader.result})});currentUser=r.user;$('#accountMessage').textContent='Аватар сохранён.';renderAccount();}catch(e){$('#accountMessage').textContent=e.message;}};reader.readAsDataURL(file);
    });
  }
  const showAdminLogin=$('#showAdminLogin'), adminSiteLoginForm=$('#adminSiteLoginForm');
  if(showAdminLogin && adminSiteLoginForm) {
    showAdminLogin.addEventListener('click',()=>{ const userForm=$('#authForm'); if(userForm) userForm.hidden=true; const tabs=$('.auth-tabs'); if(tabs) tabs.hidden=true; showAdminLogin.hidden=true; adminSiteLoginForm.hidden=false; $('#authHeading').textContent='Вход администратора'; $('#siteAdminUsername').focus(); });
    $('#showUserLogin').addEventListener('click',()=>{ adminSiteLoginForm.hidden=true; showAdminLogin.hidden=false; const userForm=$('#authForm'); if(userForm) userForm.hidden=false; const tabs=$('.auth-tabs'); if(tabs) tabs.hidden=false; $('#authHeading').textContent='Вход в KF Production'; $('#siteAdminLoginMessage').textContent=''; });
    adminSiteLoginForm.addEventListener('submit',async e=>{ e.preventDefault(); $('#siteAdminLoginMessage').textContent='Проверяем вход администратора…'; const button=adminSiteLoginForm.querySelector('button[type="submit"]'); button.disabled=true; try { await api('/api/admin/login',{method:'POST',body:JSON.stringify({username:$('#siteAdminUsername').value,password:$('#siteAdminPassword').value})}); $('#siteAdminPassword').value=''; await refreshAdminLink(); location.href='admin.html'; } catch(err) { $('#siteAdminLoginMessage').textContent=err.message; } finally { button.disabled=false; } });
  }
  const player=$('#movie-player');
  if(player) {
    const params=new URLSearchParams(location.search); const id=params.get('id')||'zona0';
    let lastSent=0;
    const saveProgress=async(force=false)=>{
      if(!currentUser || !Number.isFinite(player.duration)||player.duration<=0) return;
      const now=Date.now(); if(!force && now-lastSent<10000)return; lastSent=now;
      try{await api('/api/progress',{method:'POST',body:JSON.stringify({id,time:player.currentTime||0,duration:player.duration,title:params.get('title')||'Просмотр',kind:params.get('kind')==='series'?'series':'movie'})});}catch{}
    };
    player.addEventListener('timeupdate',()=>saveProgress(false));
    player.addEventListener('pause',()=>saveProgress(true));
    player.addEventListener('ended',()=>saveProgress(true));
    document.addEventListener('visibilitychange',()=>{if(document.hidden)saveProgress(true);});
    window.addEventListener('pagehide',()=>saveProgress(true));
  }
  fetch('/api/catalog',{cache:'no-store'}).then(r=>r.ok?r.json():{items:[]}).then(data=>{
    (data.items||[]).forEach(item=>{
      knownItems[item.id]={title:item.title,url:'detail.html?id='+encodeURIComponent(item.id),image:item.poster||'assets/zona-0.jpg',kind:item.kind==='series'?'СЕРИАЛ':'ФИЛЬМ',video:item.video,videoTitle:item.videoTitle||item.title};
    });
    if(accountPage&&currentUser) renderAccount();
  }).catch(()=>{});
  refreshUser();
})();