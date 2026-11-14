(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  let sb,started=false;
  async function client(){
    if(sb)return sb;
    if(!window.supabase?.createClient)await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';s.onload=resolve;s.onerror=()=>reject(new Error('Supabase недоступен'));document.head.append(s);});
    sb=window.supabase.createClient(window.KF_SUPABASE_URL,window.KF_SUPABASE_PUBLISHABLE_KEY);return sb;
  }
  function section(){
    if(started||!$('adminApp')||$('adminApp').classList.contains('admin-hidden'))return;
    started=true;
    const host=document.createElement('section');host.className='admin-panel';host.id='kfStudioTools';
    host.innerHTML='<div class="admin-eyebrow">KF PRODUCTION · STUDIO</div><h2>Статистика и сообщество</h2><div class="kf-admin-stats" id="kfAdminStats"><p>Загружаем статистику…</p></div><div class="kf-admin-columns"><section><h3>Новое уведомление</h3><form id="kfNoticeForm" class="kf-admin-form"><input id="kfNoticeTitle" maxlength="120" minlength="2" placeholder="Заголовок" required><textarea id="kfNoticeBody" maxlength="600" placeholder="Текст уведомления"></textarea><input id="kfNoticeFilm" placeholder="ID фильма (необязательно)"><button class="admin-button" type="submit">Опубликовать</button><p id="kfNoticeMessage" class="admin-message" role="status"></p></form><div id="kfNoticeList"></div></section><section><h3>Комментарии</h3><div id="kfModerationList">Загружаем…</div><h3>Пользователи</h3><div id="kfUsersList">Загружаем…</div></section></div>';
    $('adminApp').append(host);load();
  }
  async function load(){
    try{
      const c=await client(),{data:{session}}=await c.auth.getSession();if(!session)throw new Error('Сессия администратора не найдена.');
      const [profiles,catalog,ratings,comments,views,notices,users]=await Promise.all([
        c.from('profiles').select('id,username,created_at',{count:'exact'}),
        c.from('kf_catalog').select('id,payload'),
        c.from('kf_ratings').select('id',{count:'exact',head:true}),
        c.from('kf_comments').select('id,film_id,body,created_at,is_hidden').order('created_at',{ascending:false}).limit(30),
        c.from('kf_view_events').select('seconds_watched'),
        c.from('kf_notifications').select('id,title,created_at').order('created_at',{ascending:false}).limit(10),
        c.from('profiles').select('id,username,created_at').order('created_at',{ascending:false}).limit(200)
      ]);
      const failed=[profiles,catalog,ratings,comments,views,notices,users].find(x=>x.error);if(failed)throw failed.error;
      const films=(catalog.data||[]).filter(x=>(x.payload?.kind||'movie')!=='series').length;
      const stats={users:profiles.count??(profiles.data||[]).length,films,views:(views.data||[]).length,watch_seconds:(views.data||[]).reduce((sum,x)=>sum+Number(x.seconds_watched||0),0),ratings:ratings.count||0,comments:(comments.data||[]).filter(x=>!x.is_hidden).length};
      const labels=[['users','Пользователи'],['films','Фильмы'],['views','Просмотры'],['watch_seconds','Секунд просмотра'],['ratings','Оценки'],['comments','Комментарии']];
      $('kfAdminStats').replaceChildren();labels.forEach(([key,label])=>{const card=document.createElement('article');card.className='kf-stat-card';const n=document.createElement('b');n.textContent=Number(stats[key]||0).toLocaleString('ru-RU');const t=document.createElement('span');t.textContent=label;card.append(n,t);$('kfAdminStats').append(card);});
      $('kfNoticeList').replaceChildren();(notices.data||[]).forEach(n=>{const row=document.createElement('div');row.className='kf-admin-row';const text=document.createElement('span');text.textContent=n.title;const del=document.createElement('button');del.className='admin-button danger';del.textContent='Удалить';del.onclick=async()=>{const {error}=await c.from('kf_notifications').delete().eq('id',n.id);if(error)alert(error.message);else load();};row.append(text,del);$('kfNoticeList').append(row);});
      $('kfModerationList').replaceChildren();(comments.data||[]).forEach(x=>{const row=document.createElement('div');row.className='kf-admin-row';const text=document.createElement('span');text.textContent=x.film_id+': '+x.body;const toggle=document.createElement('button');toggle.className='admin-button secondary';toggle.textContent=x.is_hidden?'Показать':'Скрыть';toggle.onclick=async()=>{const {error}=await c.from('kf_comments').update({is_hidden:!x.is_hidden}).eq('id',x.id);if(error)alert(error.message);else load();};const del=document.createElement('button');del.className='admin-button danger';del.textContent='Удалить';del.onclick=async()=>{const {error}=await c.from('kf_comments').delete().eq('id',x.id);if(error)alert(error.message);else load();};row.append(text,toggle,del);$('kfModerationList').append(row);});if(!comments.data?.length)$('kfModerationList').textContent='Комментариев пока нет.';
      $('kfUsersList').replaceChildren();(users.data||[]).forEach(u=>{const row=document.createElement('div');row.className='kf-admin-row';const text=document.createElement('span');text.textContent=(u.username||'Без имени')+' · '+u.id;row.append(text);$('kfUsersList').append(row);});if(!users.data?.length)$('kfUsersList').textContent='Пользователей нет.';
    }catch(e){$('kfAdminStats').textContent='Примените supabase/kf-community-schema.sql в SQL Editor Supabase. Подробности: '+e.message;}
  }
  document.addEventListener('submit',async e=>{
    if(e.target.id!=='kfNoticeForm')return;e.preventDefault();
    try{const c=await client(),{data:{user}}=await c.auth.getUser();if(!user)throw new Error('Сначала войди как администратор.');const payload={title:$('kfNoticeTitle').value.trim(),body:$('kfNoticeBody').value.trim(),film_id:$('kfNoticeFilm').value.trim()||null,created_by:user.id,published:true};const {error}=await c.from('kf_notifications').insert(payload);if(error)throw error;$('kfNoticeMessage').textContent='Уведомление опубликовано.';$('kfNoticeForm').reset();load();}catch(err){$('kfNoticeMessage').textContent=err.message;}
  });
  const observer=new MutationObserver(section);const target=$('adminApp');if(target)observer.observe(target,{attributes:true,attributeFilter:['class']});setTimeout(section,1600);
})();