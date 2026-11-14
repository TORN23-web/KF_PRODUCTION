(() => {
  'use strict';
  const $ = (s, root=document) => root.querySelector(s);
  const esc = value => String(value || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safeUrl = value => {
    const v = String(value || '');
    return /^(https:\/\/|assets\/|films\/)/i.test(v) ? v.replace(/["\\\r\n]/g, '') : '';
  };
  function card(item) {
    const a=document.createElement('a'); a.className='okko-movie-card reveal visible';
    a.href='detail.html?id='+encodeURIComponent(item.id);
    a.dataset.title=(item.title||'').toLocaleLowerCase('ru');
    a.dataset.genre=(item.genre||'').toLocaleLowerCase('ru');
    a.dataset.kind=item.kind||'movie'; a.dataset.year=String(item.year||'');
    a.dataset.cast=(item.cast||[]).map(x=>Array.isArray(x)?x.join(' '):'').join(' ').toLocaleLowerCase('ru');
    const poster=document.createElement('div'); poster.className='okko-poster okko-poster-three';
    const image=safeUrl(item.poster); if(image) poster.style.backgroundImage='url("'+image+'")';
    poster.style.backgroundSize='cover'; poster.style.backgroundPosition='center';
    const kicker=document.createElement('span'); kicker.className='okko-poster-kicker'; kicker.textContent=item.kind==='series'?'KF SERIES':'KF ORIGINALS';
    const title=document.createElement('b'); title.textContent=item.title||'Без названия';
    const play=document.createElement('span'); play.className='okko-card-play'; play.textContent='▶';
    poster.append(kicker,title,play);
    const meta=document.createElement('div'); meta.className='okko-movie-meta';
    const type=document.createElement('span'); type.textContent=(item.kind==='series'?'СЕРИАЛ':'ФИЛЬМ')+(item.year?' · '+item.year:'');
    const name=document.createElement('b'); name.textContent=item.title||'Без названия'; meta.append(type,name);
    if(item.releaseAt && new Date(item.releaseAt).getTime()>Date.now()){
      const release=document.createElement('small'); release.className='kf-premiere-countdown'; release.dataset.release=item.releaseAt; meta.append(release);
    }
    a.append(poster,meta); return a;
  }
  function addToolbar(items) {
    const main=$('main'); if(!main||$('#catalogToolbar')) return;
    const bar=document.createElement('div'); bar.className='catalog-toolbar'; bar.id='catalogToolbar';
    bar.innerHTML='<input id="catalogSearch" type="search" placeholder="Поиск по названию, жанру или актёрам…" aria-label="Поиск по каталогу"><label>Тип <select id="catalogKind"><option value="">Все материалы</option><option value="movie">Фильмы</option><option value="series">Сериалы</option></select></label><label>Жанр <select id="catalogGenre"><option value="">Все жанры</option></select></label><label>Год <select id="catalogYear"><option value="">Любой год</option></select></label><label>Сортировка <select id="catalogSort"><option value="new">Сначала новые</option><option value="old">Сначала старые</option><option value="title">По названию</option></select></label>';
    const hero=$('.recommended-hero'); if(hero) hero.insertAdjacentElement('afterend',bar); else main.prepend(bar);
    const genres=new Set(), years=new Set();
    items.forEach(x=>{String(x.genre||'').split(/[,/]/).map(g=>g.trim()).filter(Boolean).forEach(g=>genres.add(g)); if(x.year)years.add(String(x.year));});
    [...genres].sort((a,b)=>a.localeCompare(b,'ru')).forEach(g=>{const o=document.createElement('option');o.value=g.toLocaleLowerCase('ru');o.textContent=g;$('#catalogGenre').append(o);});
    [...years].sort((a,b)=>Number(b)-Number(a)).forEach(y=>{const o=document.createElement('option');o.value=y;o.textContent=y;$('#catalogYear').append(o);});
    const search=$('#catalogSearch'), kind=$('#catalogKind'), genre=$('#catalogGenre'), year=$('#catalogYear'), sort=$('#catalogSort');
    const apply=()=>{const q=search.value.trim().toLocaleLowerCase('ru');const cards=[...document.querySelectorAll('#adminMoviesRow .okko-movie-card,.series-row .okko-movie-card')];
      cards.forEach(a=>{const hay=[a.dataset.title,a.dataset.genre,a.dataset.cast,a.textContent].join(' ').toLocaleLowerCase('ru');a.hidden=!!((q&&!hay.includes(q))||(kind.value&&a.dataset.kind!==kind.value)||(genre.value&&!(a.dataset.genre||'').includes(genre.value))||(year.value&&a.dataset.year!==year.value));});
      const rows=[...document.querySelectorAll('#adminMoviesRow .okko-movie-row,.series-row .okko-movie-row')];rows.forEach(row=>{[...row.children].sort((a,b)=>sort.value==='title'?a.dataset.title.localeCompare(b.dataset.title,'ru'):sort.value==='old'?Number(a.dataset.year||0)-Number(b.dataset.year||0):Number(b.dataset.year||0)-Number(a.dataset.year||0)).forEach(el=>row.append(el));});
    };
    [search,kind,genre,year,sort].forEach(el=>el.addEventListener(el.tagName==='INPUT'?'input':'change',apply));
  }
  function setupHero(items) {
    const candidates=items.filter(x=>x.id&&x.title&&x.video);
    if(!candidates.length)return;
    const hero=$('#recommendedHero'), art=$('#recommendedArt'), title=$('#recommendedTitle'), desc=$('#recommendedDescription'), watch=$('#recommendedWatch'), number=$('#recommendedNumber'), dotsHost=$('#recommendedDots');
    if(!hero||!art||!title||!watch)return;
    const slides=candidates.slice(0,8); let index=0,timer=null;
    dotsHost.replaceChildren();
    slides.forEach((x,i)=>{const b=document.createElement('button');b.type='button';b.setAttribute('aria-label','Рекомендация '+(i+1));b.addEventListener('click',()=>show(i));dotsHost.append(b);});
    const show=i=>{index=(i+slides.length)%slides.length;const x=slides[index];title.textContent=x.title;desc.textContent=x.description||'Оригинальный проект KF Production.';watch.href='detail.html?id='+encodeURIComponent(x.id);watch.innerHTML='<span>▶</span> '+(x.kind==='series'?'Смотреть':'Смотреть фильм');number.textContent=String(index+1).padStart(2,'0');const poster=safeUrl(x.poster);if(poster)art.style.backgroundImage='linear-gradient(90deg,rgba(8,9,13,.96) 0%,rgba(8,9,13,.55) 45%,rgba(8,9,13,.08) 100%),url("'+poster+'")';[...dotsHost.children].forEach((b,j)=>{b.classList.toggle('selected',j===index);b.setAttribute('aria-current',j===index?'true':'false');});};
    const prev=$('#recommendedPrev'),next=$('#recommendedNext');
    if(slides.length>1){prev.hidden=false;next.hidden=false;prev.onclick=()=>show(index-1);next.onclick=()=>show(index+1);timer=setInterval(()=>show(index+1),5000);}else{prev.hidden=true;next.hidden=true;}
    show(0);
    document.addEventListener('visibilitychange',()=>{if(document.hidden&&timer){clearInterval(timer);timer=null;}else if(!document.hidden&&slides.length>1&&!timer)timer=setInterval(()=>show(index+1),5000);});
  }
  function updateCountdowns(){document.querySelectorAll('.kf-premiere-countdown').forEach(el=>{const ms=new Date(el.dataset.release).getTime()-Date.now();if(!Number.isFinite(ms)||ms<=0){el.textContent='Уже доступно';return;}const d=Math.floor(ms/86400000),h=Math.floor(ms%86400000/3600000),m=Math.floor(ms%3600000/60000);el.textContent='Премьера через '+(d?d+' д. ':'')+h+' ч. '+m+' мин.';});}
  async function run(){
    let items=[],heroItems=[];
    try{const r=await fetch(window.KF_SUPABASE_URL+'/functions/v1/kf-admin/public/catalog',{headers:{apikey:window.KF_SUPABASE_PUBLISHABLE_KEY},cache:'no-store'});if(r.ok){const data=await r.json();heroItems=(data.items||[]).filter(x=>x&&x.id&&x.title);items=heroItems.filter(x=>x.id!=='zona0');}}catch(e){console.warn('Каталог KF Production недоступен:',e);}
    const seriesSection=$('.series-row'),seriesRow=seriesSection?.querySelector('.okko-movie-row');
    const movies=items.filter(x=>x.kind!=='series'),series=items.filter(x=>x.kind==='series');
    if(seriesRow){series.forEach(x=>seriesRow.append(card(x)));if(!series.length&&!seriesRow.querySelector('a[href*="zona0"]'))seriesRow.append(card({id:'zona0',title:'ЗОНА 0',kind:'series',year:'2026',genre:'Триллер / фантастика',poster:'assets/зона 0 картинка 2.jpg'}));}
    let originals=$('#adminMoviesRow');
    if(!originals){originals=document.createElement('section');originals.id='adminMoviesRow';originals.className='okko-row-section okko-featured';originals.innerHTML='<span id="films"></span><div class="okko-section-title"><div><span class="okko-overline">KF ORIGINALS</span><h2>Фильмы</h2></div></div><div class="okko-movie-row"></div>';mainInsert(originals,seriesSection);}
    const row=originals.querySelector('.okko-movie-row');movies.forEach(x=>row.append(card(x)));
    if(!movies.length){const empty=document.createElement('div');empty.className='kf-originals-empty';empty.textContent='Новые оригинальные фильмы KF Production скоро появятся здесь.';row.append(empty);}
    addToolbar(items);setupHero(heroItems);updateCountdowns();setInterval(updateCountdowns,60000);
  }
  function mainInsert(section,before){const main=$('main');if(before)main.insertBefore(section,before);else main.append(section);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run);else run();
})();