const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
const previewVideos = [...document.querySelectorAll('video[data-preview]')];
const cinemaState = new WeakMap();

function attachSource(video) {
  if (!video.getAttribute('src')) video.src = video.dataset.preview;
}
function labelPlayback(video) {
  const wallButton = video.closest('.tile-visual')?.querySelector('.wall-motion-toggle');
  if (wallButton) {
    wallButton.textContent = video.paused ? 'Play' : 'Pause';
    wallButton.setAttribute('aria-label', `${video.paused ? 'Play' : 'Pause'} project preview`);
  }
  const cinema = video.closest('.cinema');
  if (!cinema) return;
  cinema.querySelector('.motion-toggle').textContent = video.paused ? 'Play film' : 'Pause film';
  const title = cinema.querySelector('.now-playing').textContent;
  cinema.querySelector('.motion-state').textContent = `${video.paused ? 'Paused' : 'Playing'} · ${title} · silent preview`;
}
function pauseForVisibility(video) {
  if (!video.paused) {
    cinemaState.get(video).internalPause = true;
    video.pause();
  }
}

previewVideos.forEach(video => {
  cinemaState.set(video, { userPaused:false, internalPause:false });
  video.muted = true;
  video.addEventListener('play', () => {
    cinemaState.get(video).userPaused = false;
    labelPlayback(video);
  });
  video.addEventListener('pause', () => {
    const state = cinemaState.get(video);
    if (!state.internalPause) state.userPaused = true;
    state.internalPause = false;
    labelPlayback(video);
  });
  video.addEventListener('error', () => {
    const cinema = video.closest('.cinema');
    if (cinema) cinema.querySelector('.motion-state').textContent = 'Preview could not load. Open the original film using the link above.';
  });
  // Native controls remain usable when automatic motion is disabled.
  attachSource(video);
});

const motionObserver = new IntersectionObserver(entries => {
  for (const entry of entries) {
    const video = entry.target;
    const state = cinemaState.get(video);
    if (entry.intersectionRatio >= .35 && !document.hidden && !motionPreference.matches && !navigator.connection?.saveData && !state.userPaused) {
      video.play().catch(() => labelPlayback(video));
    } else if (entry.intersectionRatio < .1) pauseForVisibility(video);
  }
}, { threshold:[0,.1,.35,.7] });
previewVideos.forEach(video => motionObserver.observe(video));

document.querySelectorAll('.wall-motion-toggle').forEach(button => {
  const video = button.closest('.tile-visual').querySelector('video');
  labelPlayback(video);
  button.addEventListener('click', () => {
    if (video.paused) video.play().catch(() => labelPlayback(video));
    else video.pause();
  });
});

document.querySelectorAll('.cinema').forEach(cinema => {
  const video = cinema.querySelector('video');
  cinema.querySelector('.motion-toggle').addEventListener('click', () => {
    if (video.paused) video.play().catch(() => labelPlayback(video));
    else video.pause();
  });
  cinema.querySelectorAll('.film-choice').forEach(choice => choice.addEventListener('click', () => {
    cinema.querySelectorAll('.film-choice').forEach(button => {
      const selected = button === choice;
      button.classList.toggle('selected',selected);
      button.setAttribute('aria-pressed',String(selected));
    });
    pauseForVisibility(video);
    video.src = choice.dataset.movie;
    video.poster = choice.dataset.poster;
    video.setAttribute('aria-label',`${choice.dataset.title} film`);
    cinema.querySelector('.now-playing').textContent = choice.dataset.title;
    cinema.querySelector('.film-original').href = choice.dataset.original;
    video.load();
    video.play().catch(() => labelPlayback(video));
  }));
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) previewVideos.forEach(pauseForVisibility);
});
motionPreference.addEventListener('change', e => {
  if (e.matches) previewVideos.forEach(pauseForVisibility);
});
