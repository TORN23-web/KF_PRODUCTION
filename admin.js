(() => {
  const $ = id => document.getElementById(id);
  const login = $('adminLogin'), app = $('adminApp'), loginForm = $('adminLoginForm'), form = $('contentForm');
  let sb, items = [];
  const message = (id, text) => { const el = $(id); if (el) el.textContent = text || ''; };
  const escapeText = value => String(value || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const showApp = yes => { login.classList.toggle('admin-hidden', yes); app.classList.toggle('admin-hidden', !yes); };
  async function client() {
    if (sb) return sb;
    if (!window.KF_SUPABASE_URL || !window.KF_SUPABASE_PUBLISHABLE_KEY) throw new Error('Проверь supabase-config.js.');
    if (!window.supabase?.createClient) await new Promise((resolve, reject) => {
      const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
      s.onload = resolve; s.onerror = () => reject(new Error('Не удалось загрузить Supabase.')); document.head.appendChild(s);
    });
    sb = window.supabase.createClient(window.KF_SUPABASE_URL, window.KF_SUPABASE_PUBLISHABLE_KEY);
    return sb;
  }
  async function api(path, options = {}) {
    const c = await client();
    const { data: { session } } = await c.auth.getSession();
    if (!session?.access_token) throw new Error('Войди в аккаунт KF Production.');
    const response = await fetch(window.KF_SUPABASE_URL + '/functions/v1/kf-admin' + path, {
      method: options.method || 'GET',
      headers: { 'Content-Type': 'application/json', apikey: window.KF_SUPABASE_PUBLISHABLE_KEY, Authorization: 'Bearer ' + session.access_token },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Ошибка API (' + response.status + ').');
    return data;
  }
  async function check() {
    try {
      const c = await client(), { data: { session } } = await c.auth.getSession();
      if (!session) { showApp(false); return; }
      await api('/me'); showApp(true); await loadItems(); await loadAdmins();
    } catch (e) { showApp(false); message('loginMessage', e.message); }
  }
  loginForm.addEventListener('submit', async e => {
    e.preventDefault(); message('loginMessage', 'Проверяем вход…');
    try {
      const c = await client();
      const { error } = await c.auth.signInWithPassword({ email: $('adminUsername').value.trim(), password: $('adminPassword').value });
      if (error) throw error;
      await api('/me'); $('adminPassword').value = ''; message('loginMessage', '');
      showApp(true); await loadItems(); await loadAdmins();
    } catch (err) { message('loginMessage', err.message || 'Не удалось войти.'); }
  });
  $('adminLogout').addEventListener('click', async () => { try { await (await client()).auth.signOut(); } catch {} showApp(false); });
  function reset() { form.reset(); $('contentId').value = ''; $('formHeading').textContent = 'Добавить фильм или сериал'; $('saveContent').textContent = 'Опубликовать'; message('formMessage', ''); }
  $('resetForm').addEventListener('click', reset);
  const castToText = cast => (Array.isArray(cast) ? cast : []).map(x => (x[0] || '') + ': ' + (x[1] || '')).join('\n');
  function editItem(item) {
    $('contentId').value=item.id; $('contentTitle').value=item.title||''; $('contentKind').value=item.kind||'movie';
    $('contentYear').value=item.year||''; $('contentGenre').value=item.genre||''; $('contentDescription').value=item.description||'';
    $('contentPoster').value=item.poster||''; $('contentVideo').value=item.video||''; $('contentVideoTitle').value=item.videoTitle||'';
    $('contentTrailer').value=item.trailer||''; $('contentCast').value=castToText(item.cast);
    $('formHeading').textContent='Редактировать: '+item.title; $('saveContent').textContent='Сохранить изменения'; message('formMessage','');
    window.scrollTo({top:0,behavior:'smooth'});
  }
  async function loadItems() {
    message('itemsMessage','Загружаем каталог…');
    try {
      items=(await api('/catalog')).items||[]; const host=$('adminItems'); host.replaceChildren();
      if (!items.length) { message('itemsMessage','Каталог Supabase пока пуст. Старые записи локального JSON не переносятся автоматически.'); return; }
      message('itemsMessage','Всего публикаций: '+items.length);
      items.forEach(item => {
        const row=document.createElement('article'); row.className='admin-item'; const img=document.createElement('img');
        img.src=item.poster||'assets/zona-0.jpg'; img.alt=''; img.onerror=()=>{img.src='assets/zona-0.jpg';};
        const copy=document.createElement('div'); copy.className='admin-item-copy';
        copy.innerHTML='<b>'+escapeText(item.title)+'</b><small>'+escapeText(item.kind==='series'?'Сериал':'Фильм')+' · '+escapeText(item.year||'Год не указан')+' · ID: '+escapeText(item.id)+'</small>';
        const edit=document.createElement('button'); edit.className='admin-button secondary'; edit.textContent='Изменить'; edit.addEventListener('click',()=>editItem(item));
        const del=document.createElement('button'); del.className='admin-button danger'; del.textContent='Удалить';
        del.addEventListener('click',async()=>{if(!confirm('Удалить «'+item.title+'» из каталога?'))return;try{await api('/catalog/'+encodeURIComponent(item.id),{method:'DELETE'});if($('contentId').value===item.id)reset();await loadItems();}catch(e){message('itemsMessage',e.message);}});
        row.append(img,copy,edit,del); host.append(row);
      });
    } catch(e) { message('itemsMessage',e.message); }
  }
  $('refreshItems').addEventListener('click',loadItems);
  async function loadAdmins() {
    const host=$('adminAccountsList'); if(!host)return; message('adminsMessage','Загружаем список…');
    try {
      const data=await api('/admins'); host.replaceChildren();
      (data.admins||[]).forEach(a=>{
        const row=document.createElement('article'); row.className='admin-item'; const copy=document.createElement('div'); copy.className='admin-item-copy';
        const name=document.createElement('b'); name.textContent=a.user_id; const date=document.createElement('small'); date.textContent='UUID администратора · '+(a.created_at?new Date(a.created_at).toLocaleDateString('ru-RU'):'дата не указана');
        copy.append(name,date); row.append(copy);
        const c=sb; c.auth.getUser().then(({data:{user}})=>{if(user?.id!==a.user_id){const del=document.createElement('button');del.className='admin-button danger';del.textContent='Удалить доступ';del.addEventListener('click',async()=>{if(!confirm('Отозвать права администратора '+a.user_id+'?'))return;try{await api('/admins/'+a.user_id,{method:'DELETE'});await loadAdmins();}catch(e){message('adminsMessage',e.message);}});row.append(del);}});
        host.append(row);
      });
      message('adminsMessage','Всего администраторов: '+(data.admins||[]).length);
    } catch(e) { message('adminsMessage',e.message); }
  }
  const adminAccountForm=$('adminAccountForm');
  if(adminAccountForm)adminAccountForm.addEventListener('submit',async e=>{
    e.preventDefault();message('adminsMessage','Добавляем администратора…');
    try { await api('/admins',{method:'POST',body:{user_id:$('newAdminUsername').value.trim()}});$('newAdminUsername').value='';message('adminsMessage','Права администратора добавлены.');await loadAdmins(); }
    catch(err){message('adminsMessage',err.message);}
  });
  $('refreshAdmins')?.addEventListener('click',loadAdmins);
  form.addEventListener('submit',async e=>{
    e.preventDefault();message('formMessage','Сохраняем публикацию…');const id=$('contentId').value;
    const cast=$('contentCast').value.split(/\r?\n/).map(line=>{const i=line.indexOf(':');return i<0?['Съёмочная группа',line.trim()]:[line.slice(0,i).trim(),line.slice(i+1).trim()];}).filter(x=>x[1]);
    const payload={title:$('contentTitle').value.trim(),kind:$('contentKind').value,year:$('contentYear').value.trim(),genre:$('contentGenre').value.trim(),description:$('contentDescription').value.trim(),poster:$('contentPoster').value.trim(),video:$('contentVideo').value.trim(),videoTitle:$('contentVideoTitle').value.trim(),trailer:$('contentTrailer').value.trim(),cast};
    try{const out=await api(id?'/catalog/'+encodeURIComponent(id):'/catalog',{method:id?'PUT':'POST',body:payload});message('formMessage',out.message||'Сохранено.');reset();await loadItems();}
    catch(err){message('formMessage',err.message);}
  });
  async function uploadFile(inputId,kind,targetId,messageId){
    const file=$(inputId).files[0];if(!file){message(messageId,'Сначала выбери файл.');return;}
    const max=kind==='poster'?5*1024*1024:80*1024*1024;if(file.size>max){message(messageId,'Файл слишком большой.');return;}
    message(messageId,'Загружаем в Supabase Storage…');
    try{const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Не удалось прочитать файл.'));reader.readAsDataURL(file);});
      const result=await api('/upload',{method:'POST',body:{kind,filename:file.name,data:String(dataUrl).split(',')[1]||''}});
      $(targetId).value=result.path;message(messageId,'Загружено в Supabase Storage.');
    }catch(err){message(messageId,err.message);}
  }
  $('uploadPoster').addEventListener('click',()=>uploadFile('posterFile','poster','contentPoster','posterUploadMessage'));
  $('uploadVideo').addEventListener('click',()=>uploadFile('videoFile','video','contentVideo','videoUploadMessage'));
  check();
})();
