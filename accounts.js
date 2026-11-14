(() => {
  const $ = (s, root=document) => root.querySelector(s);
  let supabaseClientPromise;
  let activeProfileId = localStorage.getItem('kf-active-profile') || '';
  async function resolveProfile(sb, user) {
    if (activeProfileId) {
      const {data,error}=await sb.from('kf_profiles').select('id').eq('id',activeProfileId).eq('user_id',user.id).maybeSingle();
      if (!error && data) return data.id;
      activeProfileId='';
      localStorage.removeItem('kf-active-profile');
    }
    const {data,error}=await sb.from('kf_profiles').select('id').eq('user_id',user.id).eq('is_default',true).maybeSingle();
    if (error) throw error;
    if (data) activeProfileId=data.id;
    else {
      const created=await sb.from('kf_profiles').insert({user_id:user.id,name:'Основной',is_default:true}).select('id').single();
      if(created.error) throw created.error;
      activeProfileId=created.data.id;
    }
    if (activeProfileId) localStorage.setItem('kf-active-profile',activeProfileId);
    return activeProfileId || null;
  }
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
      return window.supabase.createClient(window.KF_SUPABASE_URL, window.KF_SUPABASE_PUBLISHABLE_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storage: window.localStorage,
          storageKey: 'kf-production-auth'
        }
      });
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
      let profileId=null;try{profileId=await resolveProfile(sb,user);}catch(profileError){console.warn('KF profiles schema is not applied yet:',profileError);}
      let f,p;
      if(profileId){
        [f,p]=await Promise.all([
          sb.from('favorites').select('film_id').eq('user_id',user.id).eq('profile_id',profileId),
          sb.from('watch_progress').select('film_id,position_seconds,duration_seconds,updated_at').eq('user_id',user.id).eq('profile_id',profileId)
        ]);
        if(f.error||p.error)[f,p]=await Promise.all([
          sb.from('favorites').select('film_id').eq('user_id',user.id),
          sb.from('watch_progress').select('film_id,position_seconds,duration_seconds,updated_at').eq('user_id',user.id)
        ]);
      }else{
        [f,p]=await Promise.all([
          sb.from('favorites').select('film_id').eq('user_id',user.id),
          sb.from('watch_progress').select('film_id,position_seconds,duration_seconds,updated_at').eq('user_id',user.id)
        ]);
      }
      if (f.error) fail(f.error); if (p.error) fail(p.error);
      const progress = {};
      (p.data || []).forEach(row => { progress[row.film_id] = { id: row.film_id, time: row.position_seconds, duration: row.duration_seconds || 0, updatedAt: Date.parse(row.updated_at) || 0 }; });
      return { favorites: (f.data || []).map(row => row.film_id), progress };
    }
    if (url === '/api/favorites' && options.method === 'POST') {
      const { data: { user }, error: userError } = await sb.auth.getUser(); if (userError) fail(userError);
      if (!user) throw new Error('Сначала войди в аккаунт.');
      let profileId=null;try{profileId=await resolveProfile(sb,user);}catch(_){}
      let query=sb.from('favorites').select('id').eq('user_id',user.id).eq('film_id',body.id);
      if(profileId)query=query.eq('profile_id',profileId);
      let {data:existing,error:readError}=await query.maybeSingle();
      if(readError&&profileId){const fallback=await sb.from('favorites').select('id').eq('user_id',user.id).eq('film_id',body.id).maybeSingle();existing=fallback.data;readError=fallback.error;}
      if (readError) fail(readError);
      if (existing) {
        const { error } = await sb.from('favorites').delete().eq('id', existing.id); if (error) fail(error); return { isFavorite: false };
      }
      let inserted=await sb.from('favorites').insert({ user_id:user.id, profile_id:profileId, film_id:body.id });
      if(inserted.error&&profileId)inserted=await sb.from('favorites').insert({user_id:user.id,film_id:body.id});
      if (inserted.error) fail(inserted.error); return { isFavorite: true };
    }
    if (url === '/api/profile' && options.method === 'POST') {
      const { data: { user }, error: userError } = await sb.auth.getUser(); if (userError) fail(userError);
      if (!user) throw new Error('Сначала войди в аккаунт.');
      const { data: existing, error: readError } = await sb.from('profiles').select('username,avatar_url').eq('id', user.id).maybeSingle();
      if (readError) fail(readError);
      const username = body.username === undefined ? (existing?.username || (user.email || '').split('@')[0]) : String(body.username).trim();
      if (username.length < 2 || username.length > 24 || !/^[\p{L}\p{N} _.-]+$/u.test(username)) throw new Error('Имя должно содержать 2–24 символа: буквы, цифры, пробел, точку, дефис или подчёркивание.');
      const avatar = body.avatar === undefined ? (existing?.avatar_url || null) : body.avatar;
      const { error } = await sb.from('profiles').upsert({ id: user.id, username, avatar_url: avatar });
      if (error) fail(error); return { user: { id: user.id, email: user.email, avatar, username } };
    }
    if (url === '/api/progress' && options.method === 'POST') {
      const { data: { user }, error: userError } = await sb.auth.getUser(); if (userError) fail(userError);
      if (!user) return { ok: true };
      let profileId=null;try{profileId=await resolveProfile(sb,user);}catch(_){}
      const progress={user_id:user.id,profile_id:profileId,film_id:body.id,position_seconds:Math.max(0,Number(body.time)||0),duration_seconds:Math.max(0,Number(body.duration)||0),updated_at:new Date().toISOString()};
      let saved=profileId?await sb.from('watch_progress').upsert(progress,{onConflict:'user_id,profile_id,film_id'}):await sb.from('watch_progress').upsert(progress,{onConflict:'user_id,film_id'});
      if(saved.error&&profileId)saved=await sb.from('watch_progress').upsert({user_id:user.id,film_id:body.id,position_seconds:progress.position_seconds,duration_seconds:progress.duration_seconds,updated_at:progress.updated_at},{onConflict:'user_id,film_id'});
      if (saved.error) fail(saved.error); return { ok: true };
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
    }
    const menu=$('.menu-toggle',header);
    if(menu && a.parentElement!==header) menu.insertAdjacentElement('afterend',a);
    else if(!menu && a.parentElement!==header) header.appendChild(a);
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
    if(isAdmin && !link) { link=document.createElement('a'); link.className='top-cta admin-panel-nav-link'; link.href='admin.html'; link.textContent='Админ-панель'; }
    const accountLink=$('.account-nav-link',header);
    const nav=$('.main-nav',header);
    if(isAdmin && link && accountLink && accountLink.parentElement===header && link.parentElement!==header) accountLink.insertAdjacentElement('afterend',link);
    else if(isAdmin && link && nav && link.parentElement!==nav) nav.appendChild(link);
    if(!isAdmin && link) link.remove();
  }
  async function refreshUser() {
    // Show the sign-in link immediately, without waiting for Supabase/network.
    makeHeaderLink(currentUser);
    const header=$('.topbar');
    const staleAdminLink=header&&$('.admin-panel-nav-link',header);
    if(staleAdminLink) staleAdminLink.remove();
    try {
      const sb=await getSupabase();
      // Restore the persisted browser session directly from Supabase Auth.
      const { data: { session }, error: sessionError } = await sb.auth.getSession();
      if (sessionError) throw sessionError;
      if (!session) {
        currentUser=null;
        makeHeaderLink(null);
      } else {
        const { data: { user }, error: userError } = await sb.auth.getUser();
        if (userError) throw userError;
        if (!user) {
          currentUser=null;
          makeHeaderLink(null);
        } else {
          let profile=null;
          try {
            const { data, error: profileError } = await sb.from('profiles')
              .select('username,avatar_url').eq('id', user.id).maybeSingle();
            if (!profileError) profile=data;
            else console.warn('KF Production: профиль не прочитан:', profileError.message);
          } catch (profileError) {
            console.warn('KF Production: профиль не прочитан:', profileError);
          }
          currentUser={id:user.id,email:user.email,avatar:profile?.avatar_url||null,
            username:profile?.username||(user.email||'').split('@')[0]};
          makeHeaderLink(currentUser);
        }
      }
    } catch (error) {
      // A failed network request must not erase a previously restored session.
      makeHeaderLink(currentUser);
      console.warn('KF Production: не удалось восстановить сессию:', error);
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
      a.href='player.html?video='+encodeURIComponent(item.video)+'&title='+encodeURIComponent(item.videoTitle||item.title)+'&kind='+(item.kind==='СЕРИАЛ'?'series':'movie')+'&id='+encodeURIComponent(id);
    }
    a.append(img,copy); return a;
  }
  async function renderProfileSwitcher() {
    const profile=$('#accountProfile'); if(!profile)return;
    let host=$('#kfProfileSwitcher');
    if(!host){
      host=document.createElement('section');host.id='kfProfileSwitcher';host.className='account-library-section kf-family-panel';
      host.innerHTML='<span class="account-overline">KF FAMILY</span><h2>Семейные профили</h2><p class="kf-family-intro">Создай отдельный профиль для каждого члена семьи. У каждого будут свои избранное и продолжение просмотра.</p><div class="kf-family-current"><span class="kf-family-avatar" id="kfProfileAvatar">👤</span><div><small>СЕЙЧАС СМОТРИТ</small><b id="kfProfileCurrentName">Основной</b></div></div><div class="kf-profile-controls"><label class="kf-profile-field"><span>Выбрать профиль</span><select id="kfProfileSelect" aria-label="Выбрать профиль"></select></label><label class="kf-profile-field"><span>Имя профиля</span><input id="kfProfileName" maxlength="24" minlength="2" placeholder="Например, Мама"></label><label class="kf-profile-field"><span>Аватар</span><select id="kfProfileAvatarChoice" aria-label="Аватар профиля"><option value="👤">👤 Человек</option><option value="🧒">🧒 Ребёнок</option><option value="👩">👩 Женщина</option><option value="👨">👨 Мужчина</option><option value="🧑">🧑 Подросток</option><option value="🐱">🐱 Кот</option><option value="🐼">🐼 Панда</option><option value="🦊">🦊 Лиса</option><option value="🤖">🤖 Робот</option><option value="⭐">⭐ Звезда</option></select></label><div class="kf-family-actions"><button id="kfSaveProfile" type="button" class="account-primary-button">Сохранить профиль</button><button id="kfDeleteProfile" type="button" class="account-logout">Удалить профиль</button></div><div class="kf-family-create"><label class="kf-profile-field"><span>Новый профиль</span><input id="kfNewProfileName" maxlength="24" minlength="2" placeholder="Имя нового профиля"></label><button id="kfCreateProfile" type="button" class="account-primary-button">＋ Добавить</button></div></div><p id="kfProfileMessage" class="account-message" role="status"></p><small class="kf-family-limit">Можно создать до 5 профилей на один аккаунт.</small>';
      profile.insertBefore(host,profile.querySelector('.account-library-section'));
    }
    const sb=await getSupabase();const {data:{user},error:userError}=await sb.auth.getUser();if(userError)throw userError;if(!user)return;
    await resolveProfile(sb,user);
    const {data,error}=await sb.from('kf_profiles').select('id,name,is_default,avatar_url').eq('user_id',user.id).order('created_at',{ascending:true});
    if(error)throw error;
    const profiles=data||[], active=profiles.find(p=>p.id===activeProfileId)||profiles.find(p=>p.is_default)||profiles[0];
    if(!active)return;
    activeProfileId=active.id;localStorage.setItem('kf-active-profile',activeProfileId);
    const select=$('#kfProfileSelect');select.replaceChildren();
    profiles.forEach(p=>{const o=document.createElement('option');o.value=p.id;o.textContent=p.name+(p.is_default?' · основной':'');select.append(o);});
    select.value=activeProfileId;
    $('#kfProfileCurrentName').textContent=active.name;
    $('#kfProfileAvatar').textContent=active.avatar_url||'👤';
    $('#kfProfileName').value=active.name;
    $('#kfProfileAvatarChoice').value=active.avatar_url||'👤';
    $('#kfDeleteProfile').disabled=!!active.is_default;
    $('#kfCreateProfile').disabled=profiles.length>=5;
    select.onchange=()=>{activeProfileId=select.value;localStorage.setItem('kf-active-profile',activeProfileId);renderAccount();};
    $('#kfCreateProfile').onclick=async()=>{
      const name=$('#kfNewProfileName').value.trim(),msg=$('#kfProfileMessage');
      if(name.length<2||name.length>24){msg.textContent='Имя профиля должно содержать 2–24 символа.';return;}
      if(profiles.length>=5){msg.textContent='Достигнут лимит: 5 профилей.';return;}
      const {data:created,error:createError}=await sb.from('kf_profiles').insert({user_id:user.id,name,is_default:false,avatar_url:'👤'}).select('id').single();
      if(createError){msg.textContent=createError.message.includes('не более 5')?'Можно создать не более 5 профилей.':createError.message;return;}
      activeProfileId=created.id;localStorage.setItem('kf-active-profile',activeProfileId);msg.textContent='Семейный профиль создан.';renderAccount();
    };
    $('#kfSaveProfile').onclick=async()=>{
      const name=$('#kfProfileName').value.trim(),avatar_url=$('#kfProfileAvatarChoice').value;
      const msg=$('#kfProfileMessage');
      if(name.length<2||name.length>24){msg.textContent='Имя должно содержать 2–24 символа.';return;}
      const {error:updateError}=await sb.from('kf_profiles').update({name,avatar_url}).eq('id',active.id).eq('user_id',user.id);
      if(updateError){msg.textContent=updateError.message;return;}
      msg.textContent='Профиль сохранён.';renderAccount();
    };
    $('#kfDeleteProfile').onclick=async()=>{
      if(active.is_default){$('#kfProfileMessage').textContent='Основной профиль удалить нельзя.';return;}
      if(!confirm('Удалить профиль «'+active.name+'»? Его избранное и история просмотра тоже будут удалены.'))return;
      const fallback=profiles.find(p=>p.is_default)||profiles.find(p=>p.id!==active.id);
      const {error:deleteError}=await sb.from('kf_profiles').delete().eq('id',active.id).eq('user_id',user.id);
      if(deleteError){$('#kfProfileMessage').textContent=deleteError.message;return;}
      activeProfileId=fallback?.id||'';if(activeProfileId)localStorage.setItem('kf-active-profile',activeProfileId);else localStorage.removeItem('kf-active-profile');
      renderAccount();
    };
    $('#kfProfileMessage').textContent='Избранное и продолжение просмотра разделены между профилями.';
  }
  function formatTime(value){ const s=Math.floor(value||0); return Math.floor(s/60)+':'+String(s%60).padStart(2,'0'); }
  function removeDuplicateAccountSections(profile) {
    if (!profile) return;
    const seen = new Set();
    profile.querySelectorAll('.account-library-section').forEach(section => {
      const heading = section.querySelector('h2');
      const title = (heading?.textContent || '').trim().toLocaleLowerCase('ru');
      if (!title) return;
      if (title === 'продолжить просмотр' || title === 'избранное') {
        if (seen.has(title)) section.remove();
        else seen.add(title);
      }
    });
    const progress = $('#progressList', profile), favorites = $('#favoriteList', profile);
    [progress, favorites].forEach(list => {
      if (!list) return;
      const cards = new Set();
      Array.from(list.children).forEach(card => {
        const key = card.getAttribute('href') || card.textContent.trim();
        if (cards.has(key)) card.remove(); else cards.add(key);
      });
    });
  }
  async function renderAccount() {
    const auth=$('#accountAuth'), profile=$('#accountProfile'); if(!auth||!profile) return;
    removeDuplicateAccountSections(profile);
    auth.hidden=!!currentUser; profile.hidden=!currentUser;
    if(!currentUser) return;
    $('#accountEmail').textContent=currentUser.email;
    const usernameInput=$('#accountUsername'); if(usernameInput) usernameInput.value=currentUser.username||'';
    const avatar=$('#accountAvatar'); avatar.src=currentUser.avatar||'';
    avatar.hidden=!currentUser.avatar;
    $('#accountAvatarPlaceholder').hidden=!!currentUser.avatar;
    const next=new URLSearchParams(location.search).get('next');
    const continueButton=$('#continueLast');
    continueButton.hidden=true;
    $('#favoriteList').replaceChildren(); $('#progressList').replaceChildren();
    try{await renderProfileSwitcher();}catch(profileError){console.warn('KF profiles are not ready:',profileError);}
    removeDuplicateAccountSections(profile);
    try {
      const lib=await api('/api/library');
      const favorites=[...new Set(lib.favorites||[])], progress=lib.progress||{};
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
        const sb=await getSupabase();
        const { data: { session }, error: sessionError } = await sb.auth.getSession();
        if (sessionError) throw sessionError;
        if (!session) { $('#authMessage').textContent='Проверь почту для подтверждения регистрации, затем войди.'; return; }
        const { data: { user }, error: userError } = await sb.auth.getUser();
        if (userError) throw userError;
        if (!user) { $('#authMessage').textContent='Не удалось восстановить вход. Попробуй войти ещё раз.'; return; }
        let savedProfile=null;
        try {
          const {data,error:profileError}=await sb.from('profiles').select('username,avatar_url').eq('id',user.id).maybeSingle();
          if(!profileError) savedProfile=data;
        } catch {}
        currentUser={id:user.id,email:user.email,avatar:savedProfile?.avatar_url||null,username:savedProfile?.username||(user.email||'').split('@')[0]};
        makeHeaderLink(currentUser);
        $('#authMessage').textContent=''; renderAccount();
        await refreshAdminLink();
        const next=new URLSearchParams(location.search).get('next'); if(next) location.href=next;
      } catch(err){$('#authMessage').textContent=err.message;} finally {submit.disabled=false;}
    });
    $('#logoutButton').addEventListener('click',async()=>{try{await api('/api/logout',{method:'POST',body:'{}'});currentUser=null;renderAccount();}catch(e){$('#accountMessage').textContent=e.message;}});
    $('#usernameForm').addEventListener('submit',async e=>{
      e.preventDefault();
      const input=$('#accountUsername'), button=$('#usernameForm button[type="submit"]');
      const username=input.value.trim();
      if(username.length<2||username.length>24||!/^[\p{L}\p{N} _.-]+$/u.test(username)){
        $('#accountMessage').textContent='Имя должно содержать 2–24 символа: буквы, цифры, пробел, точку, дефис или подчёркивание.';
        return;
      }
      button.disabled=true; $('#accountMessage').textContent='Сохраняем имя…';
      try{
        const result=await api('/api/profile',{method:'POST',body:JSON.stringify({username})});
        currentUser=result.user;
        input.value=currentUser.username;
        $('#accountMessage').textContent='Имя аккаунта сохранено.';
        makeHeaderLink(currentUser);
      }catch(error){$('#accountMessage').textContent=error.message;}
      finally{button.disabled=false;}
    });
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
    const params=new URLSearchParams(location.search);
    const id=params.get('id')||'zona0';
    let lastSent=0, restored=false, pendingSave=false;
    const saveProgress=async(force=false)=>{
      if(!currentUser || !Number.isFinite(player.duration)||player.duration<=0) return;
      const now=Date.now(); if(!force && now-lastSent<8000)return; lastSent=now;
      try {
        await api('/api/progress',{method:'POST',body:JSON.stringify({
          id,time:player.ended?0:(player.currentTime||0),duration:player.duration,
          title:params.get('title')||'Просмотр',
          kind:params.get('kind')==='series'?'series':'movie'
        })});
      } catch(error) { console.warn('KF Production: прогресс не сохранён:',error); }
    };
    const restoreProgress=async()=>{
      if(restored || !currentUser || !Number.isFinite(player.duration) || player.duration<=0) return;
      restored=true;
      try {
        const lib=await api('/api/library');
        const saved=lib.progress && lib.progress[id];
        if(!saved || !Number.isFinite(Number(saved.time))) return;
        const position=Math.max(0,Number(saved.time));
        // Не перематываем в самый конец и не восстанавливаем уже завершённый просмотр.
        if(position>5 && position<player.duration-5) {
          player.currentTime=position;
          updateTimeFromRestore();
          const resumeNotice=document.createElement('div');
          resumeNotice.textContent='Продолжаем с '+formatTime(position);
          resumeNotice.style.cssText='position:absolute;left:50%;top:18px;transform:translateX(-50%);z-index:8;padding:9px 14px;background:#111d;color:#fff;border:1px solid #ffffff35;border-radius:8px;font-size:13px;pointer-events:none';
          const shell=$('#video-shell'); if(shell){shell.appendChild(resumeNotice);setTimeout(()=>resumeNotice.remove(),3500);}
        }
      } catch(error) { console.warn('KF Production: позиция просмотра не восстановлена:',error); }
    };
    function updateTimeFromRestore(){
      const duration=player.duration;
      const seek=$('#seek-bar'),now=$('#current-time'),total=$('#duration-time');
      if(now) now.textContent=formatTime(player.currentTime);
      if(total) total.textContent=formatTime(duration);
      if(seek){seek.value=String(Math.round(player.currentTime/duration*1000));seek.style.setProperty('--seek-progress',seek.value/10+'%');}
    }
    // Metadata can load before Supabase restores the saved login session.
    // Retry restoration after authentication is ready as well as after metadata.
    player.addEventListener('loadedmetadata',restoreProgress);
    player.addEventListener('kf-auth-ready',restoreProgress);
    player.addEventListener('timeupdate',()=>saveProgress(false));
    player.addEventListener('pause',()=>saveProgress(true));
    player.addEventListener('ended',()=>saveProgress(true));
    document.addEventListener('visibilitychange',()=>{if(document.hidden)saveProgress(true);});
    window.addEventListener('pagehide',()=>saveProgress(true));
    window.addEventListener('beforeunload',()=>saveProgress(true));
  }
  fetch(window.KF_SUPABASE_URL+'/functions/v1/kf-admin/public/catalog',{headers:{apikey:window.KF_SUPABASE_PUBLISHABLE_KEY},cache:'no-store'}).then(r=>r.ok?r.json():{items:[]}).then(data=>{
    (data.items||[]).forEach(item=>{
      knownItems[item.id]={title:item.title,url:'detail.html?id='+encodeURIComponent(item.id),image:item.poster||'assets/zona-0.jpg',kind:item.kind==='series'?'СЕРИАЛ':'ФИЛЬМ',video:item.video,videoTitle:item.videoTitle||item.title};
    });
    if(accountPage&&currentUser) renderAccount();
  }).catch(()=>{});
  refreshUser().then(()=>{
    const activePlayer=$('#movie-player');
    if(activePlayer) activePlayer.dispatchEvent(new Event('kf-auth-ready'));
  });
})();