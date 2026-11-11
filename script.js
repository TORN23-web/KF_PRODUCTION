// KF Production — анимации, мобильное меню, фильтры и видеоплеер
const revealElements = document.querySelectorAll('.reveal');
if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });
  revealElements.forEach((el) => observer.observe(el));
} else revealElements.forEach((el) => el.classList.add('visible'));

const topbar = document.querySelector('.topbar');
const menuToggle = document.querySelector('.menu-toggle');
menuToggle?.addEventListener('click', () => {
  const opened = topbar.classList.toggle('menu-open');
  menuToggle.setAttribute('aria-expanded', String(opened));
});
document.querySelectorAll('.main-nav a').forEach((link) => link.addEventListener('click', () => topbar?.classList.remove('menu-open')));

const filterButtons = document.querySelectorAll('.filter-tab');
function applyCatalogFilter(filter) {
  const selected = ['movie', 'series'].includes(filter) ? filter : 'all';
  filterButtons.forEach((button) => button.classList.toggle('active', button.dataset.filter === selected));
  document.querySelectorAll('.movie-card').forEach((card) => {
    card.hidden = selected !== 'all' && card.dataset.kind !== selected;
  });
}
filterButtons.forEach((button) => button.addEventListener('click', () => applyCatalogFilter(button.dataset.filter)));
if (filterButtons.length) applyCatalogFilter(new URLSearchParams(window.location.search).get('filter') || 'all');

const player = document.querySelector('#movie-player');
if (player) {
  const params = new URLSearchParams(window.location.search);
  const videoPath = params.get('video');
  const title = document.querySelector('#video-title');
  const kind = document.querySelector('#video-kind');
  const placeholder = document.querySelector('#video-placeholder');
  const placeholderTitle = document.querySelector('#placeholder-title');
  const placeholderMessage = document.querySelector('#placeholder-message');
  const shell = document.querySelector('#video-shell');
  const controls = document.querySelector('#player-controls');
  const loading = document.querySelector('#player-loading');
  const playToggle = document.querySelector('#play-toggle');
  const muteToggle = document.querySelector('#mute-toggle');
  const volumeRange = document.querySelector('#volume-range');
  const seekBar = document.querySelector('#seek-bar');
  const currentTime = document.querySelector('#current-time');
  const durationTime = document.querySelector('#duration-time');
  const settingsToggle = document.querySelector('#settings-toggle');
  const settingsPanel = document.querySelector('#player-settings');
  const settingsClose = document.querySelector('#settings-close');
  const subtitleSelect = document.querySelector('#subtitle-select');
  const subtitlesToggle = document.querySelector('#subtitles-toggle');
  const qualitySelect = document.querySelector('#quality-select');
  const audioSelect = document.querySelector('#audio-select');
  const settingsNote = document.querySelector('#settings-note');
  title.textContent = params.get('title') || 'Просмотр фильма';
  kind.textContent = (params.get('kind') === 'series' ? 'Сериал' : 'Фильм') + ' · KF Production';

  const formatTime = (seconds) => {
    if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
    const s = Math.floor(seconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const rest = s % 60;
    return h ? [h, String(m).padStart(2, '0'), String(rest).padStart(2, '0')].join(':') : [m, String(rest).padStart(2, '0')].join(':');
  };
  const updatePlayButton = () => {
    const playing = !player.paused && !player.ended;
    playToggle.textContent = playing ? 'Ⅱ' : '▶';
    playToggle.setAttribute('aria-label', playing ? 'Пауза' : 'Воспроизвести');
    playToggle.title = playing ? 'Пауза' : 'Воспроизвести';
    shell.classList.toggle('is-playing', playing);
  };
  const updateVolume = () => {
    muteToggle.textContent = player.muted || player.volume === 0 ? '🔇' : player.volume < 0.5 ? '🔉' : '🔊';
    muteToggle.setAttribute('aria-label', player.muted ? 'Включить звук' : 'Выключить звук');
    volumeRange.value = player.muted ? '0' : String(player.volume);
  };
  const updateTime = () => {
    currentTime.textContent = formatTime(player.currentTime);
    durationTime.textContent = formatTime(player.duration);
    seekBar.value = Number.isFinite(player.duration) && player.duration > 0 ? String(Math.round(player.currentTime / player.duration * 1000)) : '0';
    seekBar.style.setProperty('--seek-progress', seekBar.value / 10 + '%');
  };
  const subtitleOverlay = document.querySelector('#subtitle-overlay');
  const subtitleStatus = document.querySelector('#subtitle-status');
  let subtitleCues = [];
  let subtitlesEnabled = false;
  let statusTimeout;
  const showSubtitleStatus = (message) => {
    subtitleStatus.textContent = message;
    subtitleStatus.hidden = false;
    clearTimeout(statusTimeout);
    statusTimeout = setTimeout(() => { subtitleStatus.hidden = true; }, 2600);
  };
  const parseTimestamp = (value) => {
    const parts = value.trim().replace(',', '.').split(':').map(Number);
    if (parts.some(n => !Number.isFinite(n))) return NaN;
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return NaN;
  };
  const loadTxtSubtitles = async () => {
    const base = videoPath ? videoPath.substring(0, videoPath.lastIndexOf('/') + 1) : 'films/';
    const txtPath = base + 'zona-0-ru.txt';
    try {
      const response = await fetch(txtPath);
      if (!response.ok) throw new Error('TXT subtitle file not found');
      const raw = await response.text();
      // Format: 00:00:01 --> 00:00:04 | Text of subtitle
      subtitleCues = raw.split(/\r?\n/).map(line => {
        const match = line.match(/^\s*(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?)\s*-->\s*(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?)\s*\|\s*(.+?)\s*$/);
        if (!match) return null;
        const start = parseTimestamp(match[1]), end = parseTimestamp(match[2]);
        return Number.isFinite(start) && Number.isFinite(end) && end > start ? { start, end, text: match[3] } : null;
      }).filter(Boolean);
      if (!subtitleCues.length) throw new Error('TXT has no valid subtitle lines');
      subtitleSelect.options[1].disabled = false;
      subtitleSelect.options[1].textContent = 'Русские (.txt)';
      return true;
    } catch (_) {
      subtitleCues = [];
      subtitleSelect.options[1].disabled = true;
      subtitleSelect.options[1].textContent = 'Русские — нет .txt файла';
      return false;
    }
  };
  const setSubtitles = (enabled) => {
    subtitlesEnabled = Boolean(enabled && subtitleCues.length);
    subtitleOverlay.textContent = '';
    subtitleOverlay.classList.toggle('visible', subtitlesEnabled);
    subtitlesToggle.classList.toggle('active', subtitlesEnabled);
    subtitleSelect.value = subtitlesEnabled ? 'ru' : 'off';
    if (!subtitlesEnabled && enabled) showSubtitleStatus('Не найден файл films/zona-0-ru.txt');
  };
  const updateSubtitleText = () => {
    if (!subtitlesEnabled) return;
    const cue = subtitleCues.find(item => player.currentTime >= item.start && player.currentTime < item.end);
    subtitleOverlay.textContent = cue ? cue.text : '';
  };

  playToggle.addEventListener('click', () => {
    if (player.paused) player.play().catch(() => {});
    else player.pause();
  });
  player.addEventListener('click', () => {
    if (player.paused) player.play().catch(() => {});
    else player.pause();
  });
  // Двойной щелчок по видео включает или выключает полноэкранный режим.
  player.addEventListener('dblclick', (event) => {
    event.preventDefault();
    toggleFullscreen();
  });
  player.addEventListener('play', updatePlayButton);
  player.addEventListener('pause', updatePlayButton);
  player.addEventListener('ended', updatePlayButton);
  player.addEventListener('timeupdate', updateTime);
  player.addEventListener('durationchange', updateTime);
  player.addEventListener('volumechange', updateVolume);
  player.addEventListener('waiting', () => loading.classList.add('visible'));
  player.addEventListener('playing', () => loading.classList.remove('visible'));
  player.addEventListener('canplay', () => loading.classList.remove('visible'));
  player.addEventListener('loadedmetadata', () => {
    player.classList.add('ready');
    placeholder.classList.add('hidden');
    loading.classList.remove('visible');
    updateTime();
  }, { once: true });
  player.addEventListener('error', () => {
    player.classList.remove('ready');
    placeholder.classList.remove('hidden');
    loading.classList.remove('visible');
    placeholderTitle.textContent = 'Не удалось загрузить видео';
    placeholderMessage.textContent = 'Проверь, что видеофайл находится в папке films и путь в ссылке указан правильно.';
  });
  seekBar.addEventListener('input', () => {
    if (Number.isFinite(player.duration)) {
      player.currentTime = Number(seekBar.value) / 1000 * player.duration;
      updateTime();
    }
  });
  muteToggle.addEventListener('click', () => { player.muted = !player.muted; updateVolume(); });
  volumeRange.addEventListener('input', () => {
    player.volume = Number(volumeRange.value);
    player.muted = player.volume === 0;
    updateVolume();
  });
  settingsToggle.addEventListener('click', () => { settingsPanel.hidden = !settingsPanel.hidden; });
  settingsClose.addEventListener('click', () => { settingsPanel.hidden = true; });
  subtitlesToggle.addEventListener('click', async () => {
    if (subtitlesEnabled) { setSubtitles(false); return; }
    const loaded = subtitleCues.length > 0 || await loadTxtSubtitles();
    if (loaded) setSubtitles(true);
    else showSubtitleStatus('Добавь films/zona-0-ru.txt с таймкодами и текстом');
  });
  subtitleSelect.addEventListener('change', async () => {
    if (subtitleSelect.value === 'off') setSubtitles(false);
    else if (await loadTxtSubtitles()) setSubtitles(true);
    else { setSubtitles(false); showSubtitleStatus('Не найден файл films/zona-0-ru.txt'); }
  });
  player.addEventListener('timeupdate', updateSubtitleText);
  player.addEventListener('seeked', updateSubtitleText);
  const qualityOptions = [
    { value: 'original', label: 'Оригинал', suffix: '' },
    { value: '1080', label: '1080p', suffix: '-1080p' },
    { value: '720', label: '720p', suffix: '-720p' },
    { value: '480', label: '480p', suffix: '-480p' }
  ];
  const originalVideoUrl = new URL(videoPath || '', window.location.href);
  const originalFile = originalVideoUrl.pathname.split('/').pop();
  const extensionIndex = originalFile.lastIndexOf('.');
  const videoStem = extensionIndex >= 0 ? originalFile.slice(0, extensionIndex) : originalFile;
  const videoExtension = extensionIndex >= 0 ? originalFile.slice(extensionIndex) : '.mp4';
  const videoDirectory = originalVideoUrl.pathname.slice(0, originalVideoUrl.pathname.lastIndexOf('/') + 1);
  const qualitySources = new Map([['original', videoPath]]);
  const refreshQualityOptions = async () => {
    const checks = await Promise.all(qualityOptions.slice(1).map(async item => {
      const candidate = videoDirectory + videoStem + item.suffix + videoExtension;
      try {
        const response = await fetch(candidate, { method: 'HEAD' });
        return { ...item, candidate, available: response.ok };
      } catch (_) { return { ...item, candidate, available: false }; }
    }));
    qualityOptions.slice(1).forEach((item, index) => {
      const found = checks[index];
      qualitySelect.querySelector('option[value="' + item.value + '"]').disabled = !found.available;
      qualitySelect.querySelector('option[value="' + item.value + '"]').textContent = found.available
        ? item.label : item.label + ' — файл не добавлен';
      if (found.available) qualitySources.set(item.value, found.candidate);
    });
  };
  qualitySelect.addEventListener('change', async () => {
    const source = qualitySources.get(qualitySelect.value);
    if (!source) {
      settingsNote.textContent = 'Для этого качества добавь отдельный файл в папку films.';
      qualitySelect.value = 'original';
      return;
    }
    if (source === player.currentSrc || new URL(source, window.location.href).href === player.currentSrc) return;
    const wasPlaying = !player.paused;
    const time = player.currentTime || 0;
    const selectedQuality = qualitySelect.value;
    settingsNote.textContent = 'Переключаем качество…';
    player.addEventListener('loadedmetadata', () => {
      try { player.currentTime = Math.min(time, Math.max(0, player.duration - 0.1)); } catch (_) {}
      if (wasPlaying) player.play().catch(() => {});
      settingsNote.textContent = 'Выбрано качество: ' + (qualityOptions.find(q => q.value === selectedQuality)?.label || selectedQuality) + '.';
    }, { once: true });
    player.src = source;
    player.load();
  });
  audioSelect.addEventListener('change', () => {
    if (audioSelect.value !== 'original') {
      audioSelect.value = 'original';
      settingsNote.textContent = 'Дополнительной озвучки пока нет. Добавь отдельную аудиодорожку, чтобы включить переключение.';
    }
  });
  async function toggleFullscreen() {
    try {
      if (!document.fullscreenElement) {
        const target = shell || player;
        if (target && target.requestFullscreen) await target.requestFullscreen();
        else throw new Error('Fullscreen API недоступен');
      } else {
        await document.exitFullscreen();
      }
    } catch (error) {
      settingsNote.textContent = 'Не удалось включить полный экран. Попробуйте открыть страницу в обычном окне браузера.';
      settingsPanel.hidden = false;
    }
  }
  document.querySelector('#fullscreen-toggle').addEventListener('click', toggleFullscreen);
  // Горячие клавиши плеера. Capture помогает перехватить пробел до прокрутки страницы.
  document.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (target instanceof HTMLElement && (
      target.isContentEditable ||
      target.matches('input, select, textarea, [role="textbox"]')
    )) return;

    const key = event.key.toLowerCase();
    if (event.code === 'Space' || event.code === 'KeyK') {
      event.preventDefault();
      if (player.paused) player.play().catch(() => {});
      else player.pause();
      return;
    }
    if (key === 'f' || event.code === 'KeyF') {
      event.preventDefault();
      toggleFullscreen();
      return;
    }
    if (event.code === 'ArrowRight' || event.code === 'ArrowLeft') {
      event.preventDefault();
      if (!Number.isFinite(player.duration) || player.duration <= 0) return;
      const delta = event.code === 'ArrowRight' ? 10 : -10;
      player.currentTime = Math.max(0, Math.min(player.duration, player.currentTime + delta));
      return;
    }
    if (event.code === 'Escape') {
      settingsPanel.hidden = true;
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    }
  }, true);
  loadTxtSubtitles();
  refreshQualityOptions();

  if (videoPath) {
    player.src = videoPath;
    placeholderTitle.textContent = 'Загрузка видео…';
    placeholderMessage.textContent = 'Подключаем видеофайл.';
    player.load();
  } else {
    placeholderTitle.textContent = 'Видео не выбрано';
    placeholderMessage.textContent = 'Открой фильм или серию из каталога, чтобы начать просмотр.';
  }
  updatePlayButton();
  updateVolume();
}