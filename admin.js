(() => {
 const $ = id => document.getElementById(id);
 const login = $('adminLogin'), app = $('adminApp'), loginForm = $('adminLoginForm'), form = $('contentForm');
 const api = async (url, options={}) => {
   const r = await fetch(url,{credentials:'same-origin',headers:{'Content-Type':'application/json',...(options.headers||{})},...options});
   const data = await r.json().catch(()=>({error:'Сервер вернул некорректный ответ.'}));
   if(!r.ok) throw new Error(data.error||'Ошибка запроса.');
   return data;
 };
 const message = (id,text) => { $(id).textContent=text||''; };
 const escapeText = value => String(value||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let items=[];
 function showApp(yes){login.classList.toggle('admin-hidden',yes);app.classList.toggle('admin-hidden',!yes);}
 async function check(){try{const status=await api('/api/admin/me');if(!status.authenticated){showApp(false);return;}showApp(true);await loadItems();}catch{showApp(false);}}
 loginForm.addEventListener('submit',async e=>{e.preventDefault();message('loginMessage','Проверяем вход…');try{await api('/api/admin/login',{method:'POST',body:JSON.stringify({username:$('adminUsername').value,password:$('adminPassword').value})});$('adminPassword').value='';message('loginMessage','');showApp(true);await loadItems();}catch(err){message('loginMessage',err.message);}});
 $('adminLogout').addEventListener('click',async()=>{try{await api('/api/admin/logout',{method:'POST',body:'{}'});}catch{}showApp(false);});
 function reset(){form.reset();$('contentId').value='';$('formHeading').textContent='Добавить фильм или сериал';$('saveContent').textContent='Опубликовать';message('formMessage','');}
 $('resetForm').addEventListener('click',reset);
 function castToText(cast){return (Array.isArray(cast)?cast:[]).map(x=>(x[0]||'')+': '+(x[1]||'')).join('\n');}
 function editItem(item){$('contentId').value=item.id;$('contentTitle').value=item.title||'';$('contentKind').value=item.kind||'movie';$('contentYear').value=item.year||'';$('contentGenre').value=item.genre||'';$('contentDescription').value=item.description||'';$('contentPoster').value=item.poster||'';$('contentVideo').value=item.video||'';$('contentVideoTitle').value=item.videoTitle||'';$('contentTrailer').value=item.trailer||'';$('contentCast').value=castToText(item.cast);$('formHeading').textContent='Редактировать: '+item.title;$('saveContent').textContent='Сохранить изменения';message('formMessage','');window.scrollTo({top:0,behavior:'smooth'});}
 async function loadItems(){message('itemsMessage','Загружаем каталог…');try{items=(await api('/api/admin/catalog')).items||[];const host=$('adminItems');host.replaceChildren();if(!items.length){message('itemsMessage','Пока нет добавленных публикаций.');return;}message('itemsMessage','Всего публикаций: '+items.length);items.forEach(item=>{const row=document.createElement('article');row.className='admin-item';const img=document.createElement('img');img.src=item.poster||'assets/zona-0.jpg';img.alt='';img.onerror=()=>{img.src='assets/zona-0.jpg';};const copy=document.createElement('div');copy.className='admin-item-copy';copy.innerHTML='<b>'+escapeText(item.title)+'</b><small>'+escapeText(item.kind==='series'?'Сериал':'Фильм')+' · '+escapeText(item.year||'Год не указан')+' · ID: '+escapeText(item.id)+'</small>';const edit=document.createElement('button');edit.className='admin-button secondary';edit.textContent='Изменить';edit.addEventListener('click',()=>editItem(item));const del=document.createElement('button');del.className='admin-button danger';del.textContent='Удалить';del.addEventListener('click',async()=>{if(!confirm('Удалить «'+item.title+'» из каталога?'))return;try{await api('/api/admin/catalog/'+encodeURIComponent(item.id),{method:'DELETE'});if($('contentId').value===item.id)reset();await loadItems();}catch(e){message('itemsMessage',e.message);}});row.append(img,copy,edit,del);host.append(row);});}catch(e){message('itemsMessage',e.message);}}
 $('refreshItems').addEventListener('click',loadItems);
 form.addEventListener('submit',async e=>{e.preventDefault();message('formMessage','Сохраняем публикацию…');const id=$('contentId').value;const cast=$('contentCast').value.split(/\r?\n/).map(line=>{const i=line.indexOf(':');return i<0?['Съёмочная группа',line.trim()]:[line.slice(0,i).trim(),line.slice(i+1).trim()];}).filter(x=>x[1]);const payload={title:$('contentTitle').value.trim(),kind:$('contentKind').value,year:$('contentYear').value.trim(),genre:$('contentGenre').value.trim(),description:$('contentDescription').value.trim(),poster:$('contentPoster').value.trim(),video:$('contentVideo').value.trim(),videoTitle:$('contentVideoTitle').value.trim(),trailer:$('contentTrailer').value.trim(),cast};
 try{const out=await api(id?'/api/admin/catalog/'+encodeURIComponent(id):'/api/admin/catalog',{method:id?'PUT':'POST',body:JSON.stringify(payload)});message('formMessage',out.message||'Сохранено.');reset();await loadItems();}catch(err){message('formMessage',err.message);}});
 async function uploadFile(inputId,kind,targetId,messageId){
   const file=$(inputId).files[0];if(!file){message(messageId,'Сначала выбери файл.');return;}
   const max=kind==='poster'?5*1024*1024:80*1024*1024;
   if(file.size>max){message(messageId,kind==='poster'?'Постер больше 5 МБ.':'Видео больше 80 МБ.');return;}
   message(messageId,'Загружаем файл на сервер…');
   try{
     const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Не удалось прочитать файл.'));reader.readAsDataURL(file);});
     const base64=String(dataUrl).split(',')[1]||'';
     const result=await api('/api/admin/upload',{method:'POST',body:JSON.stringify({kind,filename:file.name,data:base64})});
     $(targetId).value=result.path;message(messageId,'Загружено: '+result.path);
   }catch(err){message(messageId,err.message);}
 }
 $('uploadPoster').addEventListener('click',()=>uploadFile('posterFile','poster','contentPoster','posterUploadMessage'));
 $('uploadVideo').addEventListener('click',()=>uploadFile('videoFile','video','contentVideo','videoUploadMessage'));
 check();
})();