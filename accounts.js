(() => {
  const $ = (s, root=document) => root.querySelector(s);
  const api = async (url, options={}) => {
    const response = await fetch(url, { credentials:'same-origin', headers:{'Content-Type':'application/json', ...(options.headers||{})}, ...options });
    const data = await response.json().catch(()=>({error:'Не удалось прочитать ответ сервера.'}));
    if(!response.ok) throw new Error(data.error || 'Произошла ошибка.');
    return data;
  };
  const accountPage = document.body.classList.contains('account-page');
  let currentUser = null;
  function makeHeaderLink(user) {
    const header=$('.topbar'); if(!header || $('.account-nav-link',header)) return;
    const a=document.createElement('a'); a.className='top-cta account-nav-link'; a.href='account.html'; a.textContent=user?'Мой профиль':'Войти';
    const menu=$('.menu-toggle',header); header.insertBefore(a,menu||null);
  }
  async function refreshAdminLink() {
    const header=$('.topbar'); if(!header) return;
    let isAdmin=false;
    try { isAdmin=!!(await api('/api/admin/me')).authenticated; } catch { isAdmin=false; }
    let link=$('.admin-panel-nav-link',header);
    if(isAdmin && !link) { link=document.createElement('a'); link.className='top-cta admin-panel-nav-link'; link.href='admin.html'; link.textContent='Перейти в админ-панель'; const menu=$('.menu-toggle',header); header.insertBefore(link,menu||null); }
    if(!isAdmin && link) link.remove();
  }
  async function refreshUser() {
    try { currentUser=(await api('/api/me')).user; } catch { currentUser=null; }
    makeHeaderLink(currentUser);
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
    const a=document.createElement('a'); a.className='account-media-card'; a.href=item.url;
    const img=document.createElement('img'); img.src=item.image; img.alt=''; img.loading='lazy';
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
        await api('/api/'+mode,{method:'POST',body:JSON.stringify({email:$('#email').value,password:$('#password').value})});
        currentUser=(await api('/api/me')).user; $('#authMessage').textContent=''; renderAccount();
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