(() => {
  'use strict';
  const $ = (s, r=document) => r.querySelector(s);
  const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let clientPromise;
  async function client(){
    if(clientPromise)return clientPromise;
    clientPromise=(async()=>{
      if(!window.supabase?.createClient){await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';s.onload=resolve;s.onerror=()=>reject(new Error('Supabase недоступен'));document.head.append(s);});}
      return window.supabase.createClient(window.KF_SUPABASE_URL,window.KF_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,storageKey:'kf-production-auth'}});
    })();return clientPromise;
  }
  async function current(){const c=await client();const {data:{user}}=await c.auth.getUser();return {c,user};}
  async function detailCommunity(){
    const id=new URLSearchParams(location.search).get('id')||'zona0', host=$('#detailCast')?.parentElement;
    if(!host||$('#kfCommunity'))return;
    const panel=document.createElement('section');panel.id='kfCommunity';panel.className='kf-community-panel';
    panel.innerHTML='<div class="kf-community-head"><div><span class="okko-overline">СООБЩЕСТВО KF</span><h2>Оценки и обсуждение</h2></div><div id="kfRatingSummary">Загрузка оценок…</div></div><div class="kf-rating-form"><label for="kfRating">Твоя оценка</label><select id="kfRating"><option value="5">★★★★★ — Отлично</option><option value="4">★★★★☆ — Хорошо</option><option value="3">★★★☆☆ — Нормально</option><option value="2">★★☆☆☆ — Не очень</option><option value="1">★☆☆☆☆ — Не понравилось</option></select><button id="kfRateButton" type="button">Оценить</button></div><form id="kfCommentForm"><label for="kfComment">Комментарий</label><textarea id="kfComment" maxlength="1200" minlength="2" placeholder="Поделись впечатлением о фильме…" required></textarea><button type="submit">Опубликовать комментарий</button><p id="kfCommunityMessage" role="status"></p></form><div id="kfComments" class="kf-comments-list"></div>';
    host.insertAdjacentElement('afterend',panel);
    try{
      const {c,user}=await current();
      async function load(){
        const [ratings,comments,mine]=await Promise.all([
          c.from('kf_ratings').select('rating').eq('film_id',id),
          c.from('kf_comments').select('id,body,created_at,user_id').eq('film_id',id).eq('is_hidden',false).order('created_at',{ascending:false}).limit(50),
          user?c.from('kf_ratings').select('rating').eq('film_id',id).eq('user_id',user.id).maybeSingle():Promise.resolve({data:null,error:null})
        ]);
        if(ratings.error||comments.error)throw ratings.error||comments.error;
        const values=(ratings.data||[]).map(x=>Number(x.rating)).filter(x=>x>=1&&x<=5);
        $('#kfRatingSummary').textContent=values.length?'★ '+(values.reduce((a,b)=>a+b,0)/values.length).toFixed(1)+' · '+values.length+' оценок':'Пока нет оценок';
        if(mine.data)$('#kfRating').value=String(mine.data.rating);
        const list=$('#kfComments');list.replaceChildren();
        (comments.data||[]).forEach(x=>{const article=document.createElement('article');article.className='kf-comment';const p=document.createElement('p');p.textContent=x.body;const small=document.createElement('small');small.textContent=new Date(x.created_at).toLocaleString('ru-RU');article.append(p,small);list.append(article);});
        if(!comments.data?.length)list.textContent='Пока нет комментариев. Будь первым!';
      }
      $('#kfRateButton').onclick=async()=>{if(!user){location.href='account.html?next='+encodeURIComponent(location.href);return;}const rating=Number($('#kfRating').value);const {error}=await c.from('kf_ratings').upsert({user_id:user.id,film_id:id,rating,updated_at:new Date().toISOString()},{onConflict:'user_id,film_id'});$('#kfCommunityMessage').textContent=error?error.message:'Оценка сохранена.';if(!error)load();};
      $('#kfCommentForm').onsubmit=async e=>{e.preventDefault();if(!user){location.href='account.html?next='+encodeURIComponent(location.href);return;}const body=$('#kfComment').value.trim();if(body.length<2)return;const {error}=await c.from('kf_comments').insert({user_id:user.id,film_id:id,body});$('#kfCommunityMessage').textContent=error?error.message:'Комментарий опубликован.';if(!error){$('#kfComment').value='';load();}};
      await load();
    }catch(e){$('#kfCommunityMessage').textContent='Сообщество станет доступно после применения обновления базы данных Supabase.';console.warn('KF community:',e);}
  }
  async function homePersonalized(){
    const main=$('main');if(!main||$('#kfPersonalRecommendations'))return;
    try{
      const response=await fetch(window.KF_SUPABASE_URL+'/functions/v1/kf-admin/public/catalog',{headers:{apikey:window.KF_SUPABASE_PUBLISHABLE_KEY},cache:'no-store'});if(!response.ok)return;
      const items=(await response.json()).items||[];const movies=items.filter(x=>x.id&&x.title);
      if(!movies.length)movies.push({id:'zona0',title:'ЗОНА 0',kind:'series',genre:'Триллер / фантастика',poster:'assets/zona-0.jpg'});
      const {c,user}=await current();let favoriteIds=[];
      if(user){const {data}=await c.from('favorites').select('film_id').eq('user_id',user.id);favoriteIds=(data||[]).map(x=>x.film_id);}
      const favoriteGenres=movies.filter(x=>favoriteIds.includes(x.id)).map(x=>(x.genre||'').toLowerCase());
      const ranked=movies.map(x=>({item:x,score:(favoriteIds.includes(x.id)?10:0)+(favoriteGenres.some(g=>g&&String(x.genre||'').toLowerCase().includes(g))?5:0)})).sort((a,b)=>b.score-a.score).slice(0,6).map(x=>x.item);
      const section=document.createElement('section');section.id='kfPersonalRecommendations';section.className='okko-row-section';section.innerHTML='<div class="okko-section-title"><div><span class="okko-overline">KF FOR YOU</span><h2>Подобрано для тебя</h2></div></div><div class="okko-movie-row"></div>';
      const row=section.querySelector('.okko-movie-row');
      ranked.forEach(item=>{const a=document.createElement('a');a.className='okko-movie-card';a.href='detail.html?id='+encodeURIComponent(item.id);const poster=document.createElement('div');poster.className='okko-poster';if(item.poster)poster.style.backgroundImage='url("'+String(item.poster).replace(/["\\\\\\r\\n]/g,'')+'")';poster.style.backgroundSize='cover';poster.style.backgroundPosition='center';const name=document.createElement('b');name.textContent=item.title;poster.append(name);const meta=document.createElement('div');meta.className='okko-movie-meta';meta.textContent=item.genre||'KF ORIGINALS';a.append(poster,meta);row.append(a);});
      const anchor=$('#adminMoviesRow')||$('.series-row');if(anchor)anchor.insertAdjacentElement('afterend',section);else main.append(section);
    }catch(e){console.warn('Персональные рекомендации пока недоступны:',e);}
  }
  async function homeNotifications(){
    const header=$('.okko-header');if(!header||$('#kfNotificationBell'))return;
    try{
      const {c,user}=await current();if(!user)return;
      const link=document.createElement('a');link.id='kfNotificationBell';link.className='top-cta';link.href='account.html#notifications';link.textContent='Уведомления';link.title='Новые объявления KF Production';
      const menu=$('.menu-toggle',header);if(menu)menu.insertAdjacentElement('beforebegin',link);else header.append(link);
      const {count,error}=await c.from('kf_notifications').select('id',{count:'exact',head:true}).eq('published',true);
      if(!error&&count)link.textContent='Уведомления · '+count;
    }catch(e){console.warn('Уведомления KF:',e);}
  }
  async function accountNotifications(){
    const profile=$('#accountProfile');if(!profile||$('#kfAccountNotifications'))return;
    const history=document.createElement('section');history.id='kfWatchHistory';history.className='account-library-section';history.innerHTML='<span class="account-overline">НЕДАВНО СМОТРЕЛИ</span><h2>История просмотров</h2><div id="kfHistoryList" class="kf-notification-list">Загрузка…</div>';profile.append(history);
    const section=document.createElement('section');section.id='kfAccountNotifications';section.className='account-library-section';
    section.innerHTML='<span class="account-overline">KF PRODUCTION</span><h2 id="notifications">Уведомления</h2><div id="kfNotificationList" class="kf-notification-list">Загрузка…</div>';
    profile.append(section);
    try{
      const {c,user}=await current();
      if(user){const historyResult=await c.from('kf_view_events').select('film_id,viewed_at').eq('user_id',user.id).order('viewed_at',{ascending:false}).limit(30);const historyHost=$('#kfHistoryList');historyHost.replaceChildren();if(!historyResult.error&&(historyResult.data||[]).length){historyResult.data.forEach(v=>{const a=document.createElement('a');a.className='kf-notification';a.href='detail.html?id='+encodeURIComponent(v.film_id);const b=document.createElement('b');b.textContent=v.film_id;const t=document.createElement('small');t.textContent=new Date(v.viewed_at).toLocaleString('ru-RU');a.append(b,t);historyHost.append(a);});}else historyHost.textContent='История пока пуста.';}
      const {data,error}=await c.from('kf_notifications').select('id,title,body,film_id,created_at').eq('published',true).order('created_at',{ascending:false}).limit(30);if(error)throw error;const host=$('#kfNotificationList');host.replaceChildren();let modal=$('#kfNotificationModal');if(!modal){modal=document.createElement('div');modal.id='kfNotificationModal';modal.className='kf-notice-modal';modal.hidden=true;modal.innerHTML='<div class="kf-notice-dialog" role="dialog" aria-modal="true" aria-labelledby="kfNoticeModalTitle"><button type="button" class="kf-notice-close" aria-label="Закрыть">×</button><span class="account-overline">KF PRODUCTION · УВЕДОМЛЕНИЕ</span><h2 id="kfNoticeModalTitle"></h2><p class="kf-notice-modal-body"></p><small class="kf-notice-modal-date"></small></div>';document.body.append(modal);const close=()=>{modal.hidden=true;document.body.classList.remove('kf-notice-modal-open');};modal.querySelector('.kf-notice-close').addEventListener('click',close);modal.addEventListener('click',e=>{if(e.target===modal)close();});document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!modal.hidden)close();});}const openNotice=n=>{modal.querySelector('#kfNoticeModalTitle').textContent=n.title||'Уведомление';modal.querySelector('.kf-notice-modal-body').textContent=n.body||'';modal.querySelector('.kf-notice-modal-date').textContent=new Date(n.created_at).toLocaleString('ru-RU');modal.hidden=false;document.body.classList.add('kf-notice-modal-open');modal.querySelector('.kf-notice-close').focus();};(data||[]).forEach(n=>{const a=document.createElement('article');a.className='kf-notification kf-notification-clickable';a.tabIndex=0;a.setAttribute('role','button');a.setAttribute('aria-label','Открыть уведомление: '+(n.title||''));const h=document.createElement('b');h.textContent=n.title;const p=document.createElement('p');p.textContent=n.body;const t=document.createElement('small');t.textContent=new Date(n.created_at).toLocaleString('ru-RU');a.append(h,p,t);a.addEventListener('click',()=>openNotice(n));a.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openNotice(n);}});host.append(a);});if(!data?.length)host.textContent='Новых уведомлений пока нет.';
    }catch(e){$('#kfNotificationList').textContent='Уведомления появятся после обновления базы Supabase.';}
  }
  async function trackViews(){
    const video=$('#movie-player');if(!video)return;let viewId=null,clientRef=null,userRef=null,lastReported=0,startingAt=0,busy=false;
    async function flush(){
      if(!viewId||!clientRef||!userRef||busy)return;
      const watched=Math.max(0,Math.floor((video.currentTime||0)-startingAt));
      if(watched-lastReported<20&& !video.ended && !video.paused)return;
      busy=true;try{const {error}=await clientRef.from('kf_view_events').update({seconds_watched:watched}).eq('id',viewId).eq('user_id',userRef);if(!error)lastReported=watched;}catch(e){console.warn('Не удалось обновить статистику просмотра:',e);}finally{busy=false;}
    }
    video.addEventListener('play',async()=>{if(viewId||busy)return;busy=true;try{const {c,user}=await current();if(!user)return;clientRef=c;userRef=user.id;startingAt=video.currentTime||0;const {data,error}=await c.from('kf_view_events').insert({user_id:user.id,film_id:new URLSearchParams(location.search).get('id')||'unknown'}).select('id').single();if(error)throw error;viewId=data.id;}catch(e){console.warn('Не удалось записать просмотр:',e);}finally{busy=false;}});
    video.addEventListener('timeupdate',flush);video.addEventListener('pause',flush);video.addEventListener('ended',flush);window.addEventListener('pagehide',flush);
  }
  if(location.pathname.endsWith('detail.html'))detailCommunity();
  if(location.pathname.endsWith('index.html')||location.pathname.endsWith('/')){homeNotifications();homePersonalized();}
  if(location.pathname.endsWith('account.html')){const obs=new MutationObserver(()=>{if($('#accountProfile')&&!$('#accountProfile').hidden)accountNotifications();});obs.observe(document.body,{subtree:true,attributes:true,attributeFilter:['hidden']});setTimeout(accountNotifications,1800);}
  trackViews();
})();