'use strict';
// Parent configuration: change instance addresses ONLY here.
// Listed in https://docs.invidious.io/instances/ on 2026-10-05.
// Listing is not proof of CORS, embed, or playback availability.
const INVIDIOUS_INSTANCES = [
  'https://invidious.f5.si',
  'https://invidious.tiekoetter.com',
  'https://yt.chocolatemoo53.com'
];
const BROWSER_PLAYBACK_DISABLED = true;
const SETTINGS = Object.freeze({
  requestTimeoutMs: 4000,
  channelBudgetMs: 12500,
  maxPagesPerChannel: 100,
  maxVideosWithoutLimit: 5000,
  parallelChannels: 3, // Browser only; native metadata is throttled below
  cardsPerPage: 60, // Images below the viewport are already lazy-loaded
  playerWaitMs: 6000,
  playerBudgetMs: 18500,
  metadataTTL: 6 * 60 * 60 * 1000,
  channelTTL: 5 * 60 * 1000,
  searchDebounceMs: 150,
  refreshOnReturnMs: 5 * 60 * 1000,
  authorizationRefreshMs: 60 * 1000
});
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const CACHE_KEY = 'kidsYoutubeVideos';
const INSTANCE_KEY = 'kidsYoutubeLastInstance';
const VIEW_KEY = 'kidsYoutubeViewMode';
const SORT_KEY = 'kidsYoutubeSortMode';
const CHANNEL_FILTER_KEY = 'kidsYoutubeChannelFilter';
function sameOriginParent(){
  if(window.parent===window)return false;
  try{
    const expected=new URL('./parents.html',location.href);
    return window.parent.location.origin===location.origin&&window.parent.location.pathname===expected.pathname;
  }catch(_){return false;}
}
const PARENT_CATALOG = new URL(location.href).searchParams.get('parentCatalog') === '1' && sameOriginParent();
const NATIVE_MODE = typeof window.KidsNative === 'object' && window.KidsNative !== null;
const PARENT_API = 'https://jxhelpxhrmwvzrrfrjuh.supabase.co/functions/v1/kids-youtube';
const SCOPE = new URL('./', location.href).href;
// A provider iframe may need its own storage for playback/preferences.
// Its origin must stay external; CSP also blocks a redirect into our origin.
function installFramePolicy() {
  if (!document.head) return;
  const policy=document.createElement('meta');policy.httpEquiv='Content-Security-Policy';
  policy.content=PARENT_CATALOG
    ? "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' https://img.youtube.com https://i.ytimg.com https://yt3.ggpht.com https://yt3.googleusercontent.com; connect-src 'self' https://jxhelpxhrmwvzrrfrjuh.supabase.co; frame-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'"
    : "frame-src 'self'; object-src 'none'; base-uri 'self'";
  document.head.append(policy);
}
installFramePolicy();
const $ = id => document.getElementById(id);
const ui = Object.fromEntries(['app','grid','count','status','status-text','status-retry','spinner','empty','empty-title','empty-text','more','player','back','player-title','media-host','player-spinner','player-message','next-player','player-error','retry-video','app-open-message','install','videos-tab','channels-tab','all-tab','sort','channel-filter','filters','diagnostics','provider-controls','diagnostic-panel','clear-cache','search','search-label','search-toggle','search-row','clear-search','pull-refresh','channel-heading','channel-name','back-channels','browse-title','empty-clear','view-grid','view-list','sort-options'].map(id => [id, $(id)]));
let displayed = new Map();
let activeConfig = {videos:[], channels:[]};
let activeLists = Object.create(null);
let activeLinkRecords = Object.create(null);
let visibleCount = SETTINGS.cardsPerPage;
let loading = false;
let lastLoad = 0;
let installPrompt = null;
let playback = null;
let playerTimer = null;
let frameCleanup = null;
let returnFocus = null;
let returnVideoId = null;
let returnScrollY = 0;
let viewMode = 'all';
let selectedChannelId = null;
let searchQuery = '';
const browseStates = new Map();
let playerSequence = 0;
let searchTimer = null;
const savedSort = storageGet(SORT_KEY);
let sortMode = ['newest','list','name'].includes(savedSort) ? savedSort : 'newest';
const savedChannelFilter = storageGet(CHANNEL_FILTER_KEY);
let channelFilter = typeof savedChannelFilter === 'string' ? savedChannelFilter : '';
let paginationBusy = false;
const channelProgress = new Map();
const verifiedChannelVideos = new Map();
const cardCache = new Map();
let channelDates = Object.create(null);
let loadError = false;
let statusTimer = null;
let approvalMarker = '';
let authorizationReloadPending = false;
let authorizationGeneration = 0;
let loadCycle=0;
let authorityCheckSerial=0;
let authorizationCheckInFlight=false;
let contentRetryBusy=false;
const pendingChannelRetry=new Set();
let debugRequestSerial=0;
let pendingOnlineRefresh = false;
let catalogRetryTimer = null;
let catalogRetryAttempts = 0; // optional display completion only
let authorizationRetryAttempts = 0; // fresh grants only
let catalogRetryPending = false;
const catalogMetrics = {startedAt:0,authorizationMs:0,metadataMs:0,channelsMs:0,firstUsefulMs:0,completedMs:0,requests:0,providerCalls:0,renderCalls:0,displayCacheHits:0,channelCacheHits:0,retries:0};
function debugCatalog(event,details={}){
  if(!NATIVE_MODE)return;
  try{console.log('KidsCatalog '+event+' '+JSON.stringify(details));}catch(_){}
}
const savedView = storageGet(VIEW_KEY);
let viewStyle = savedView === 'list' ? 'list' : 'grid';
function optionalStorage() { try { return localStorage; } catch (_) { return null; } }
function parentToken(){try{return localStorage.getItem('kidsParentToken')||sessionStorage.getItem('kidsParentToken')||'';}catch(_){return '';}}
async function providerFetch(input,options={}) {
  if(!PARENT_CATALOG){catalogMetrics.providerCalls++;return fetch(input,options);}
  let target;try{target=new URL(String(input),location.href);}catch(_){throw new Error('INVALID_PARENT_PROVIDER');}
  if(!INVIDIOUS_INSTANCES.includes(target.origin))throw new Error('INVALID_PARENT_PROVIDER');
  const value=parentToken(),headers={...(options.headers||{}),...(value?{Authorization:'Bearer '+value}:{})};
  catalogMetrics.providerCalls++;
  const response=await fetch(PARENT_API+'?action=provider&target='+encodeURIComponent(target.href),{...options,headers});
  if(response.status===401){
    try{window.parent.postMessage({type:'kids-parent-auth-expired'},location.origin);}catch(_){}
    return response;
  }
  const upstream=Number(response.headers.get('X-Kids-Provider-Status')||0);
  if(upstream>=400&&upstream<=599){
    const body=await response.text();
    return new Response(body,{status:upstream,headers:{'Content-Type':'application/json'}});
  }
  return response;
}
const providers = KidsProviders.createManager({instances:INVIDIOUS_INSTANCES, scope:SCOPE, fetcher:providerFetch, storage:optionalStorage(), timeout:SETTINGS.requestTimeoutMs, budget:SETTINGS.channelBudgetMs});
const diagnosticsEnabled = new URL(location.href).searchParams.get('diagnostics') === '1';
ui['diagnostic-panel'].hidden = !diagnosticsEnabled;
const providerButtons = [];
if(diagnosticsEnabled)INVIDIOUS_INSTANCES.forEach((base,index) => {
  const row=document.createElement('p'),label=document.createElement('span'),button=document.createElement('button');
  label.textContent=new URL(base).hostname+' ';button.type='button';button.className='button';
  button.addEventListener('click',()=>{const paused=providers.snapshot().health[base].api.pausedUntil>Date.now();providers.pauseProvider(base,paused?0:300000);audit();});
  row.append(label,button);ui['provider-controls'].append(row);providerButtons.push({base,index,button});
});
function audit() {
  if (!diagnosticsEnabled) return;
  for(const {base,index,button} of providerButtons)button.textContent=providers.snapshot().health[base].api.pausedUntil>Date.now()?'הפעלת מקור '+(index+1)+' מחדש':'השהיית מקור '+(index+1)+' ל־5 דקות';
  const resources = typeof performance !== 'undefined' ? performance.getEntriesByType('resource').slice(-150).map(r => ({url:r.name,ms:Math.round(r.duration),bytes:r.transferSize,type:r.initiatorType})) : [];
  ui.diagnostics.textContent = JSON.stringify({providers:providers.snapshot(),approvedVideos:activeConfig.videos.length,approvedChannels:activeConfig.channels.length,loadedVideos:displayed.size,renderedCards:ui.grid.children.length,catalogMetrics,resources},null,2);
}
function normalizeVideo(raw, channelId = '') {
  const id = raw && (raw.id || raw.videoId);
  if (!VIDEO_ID.test(id)) return null;
  const authorId = CHANNEL_ID.test(raw.authorId) ? raw.authorId : CHANNEL_ID.test(raw.channelId) ? raw.channelId : '';
  if (channelId && authorId && authorId !== channelId) return null;
  return {id,title:cleanTitle(raw.title),author:typeof raw.author === 'string' ? raw.author.slice(0,300) : '',authorId:authorId || channelId,channelId:channelId || authorId,published:Number.isFinite(raw.published) && raw.published > 0 ? raw.published : 0};
}
function deduplicateVideos(rows) {
  const byId = new Map();
  for (const row of rows) { const video = normalizeVideo(row); if (video && !byId.has(video.id)) byId.set(video.id,video); }
  return [...byId.values()];
}
function getApprovedVideos() { return new Set(activeConfig.videos.map(v => v.id)); }
function getApprovedChannels() { return new Set(activeConfig.channels.map(c => c.id)); }


function storageGet(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (_) { return null; } }
function storageSet(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (_) { return false; } }
function cleanTitle(title) { return typeof title === 'string' && title.trim() ? title.trim().slice(0,300) : 'סרטון מאושר'; }
function normalizeConfig(raw) {
  if (!raw || !Array.isArray(raw.videos) || !Array.isArray(raw.channels)) throw new Error('INVALID_CONFIG');
  const videos = new Map();
  const channels = new Map();
  let skipped = 0;
  for (const video of raw.videos) {
    if (!video || !VIDEO_ID.test(video.id)) { skipped++; continue; }
    if (!videos.has(video.id)) videos.set(video.id, normalizeVideo(video));
  }
  for (const channel of raw.channels) {
    if (!channel || !CHANNEL_ID.test(channel.id) || (channel.maxVideos !== undefined && (!Number.isSafeInteger(channel.maxVideos) || channel.maxVideos < 1))) { skipped++; continue; }
    channels.set(channel.id, {id:channel.id, name:cleanTitle(channel.name), thumbnail:safeChannelImage(channel.thumbnail), ...(channel.maxVideos === undefined ? {} : {maxVideos:channel.maxVideos})});
  }
  return {videos:[...videos.values()], channels:[...channels.values()], skipped};
}
function readSnapshot() {
  const snapshot = storageGet(CACHE_KEY);
  if (!snapshot || ![1,2].includes(snapshot.version) || snapshot.scope !== SCOPE || !snapshot.config || !snapshot.channelLists) return null;
  try {
    snapshot.config = normalizeConfig(snapshot.config);
    snapshot.channelDates = snapshot.channelDates && typeof snapshot.channelDates === 'object' ? snapshot.channelDates : {};
    for (const c of snapshot.config.channels) {
      const stamp = snapshot.channelDates[c.id] || snapshot.savedAt;
      if (!Number.isFinite(stamp) || stamp > Date.now() || Date.now()-stamp > 7*24*60*60*1000) delete snapshot.channelLists[c.id];
    }
    snapshot.channelLists = pruneLists(snapshot.config, snapshot.channelLists);
    snapshot.channelProgress = snapshot.channelProgress && typeof snapshot.channelProgress==='object' ? snapshot.channelProgress : {};
    snapshot.linkRecords = snapshot.linkRecords && typeof snapshot.linkRecords === 'object' ? snapshot.linkRecords : {};
    return snapshot;
  } catch (_) { return null; }
}
function cleanChannelVideos(rows, channel) {
  const result = new Map();
  const limit = channel.maxVideos === undefined ? SETTINGS.maxVideosWithoutLimit : channel.maxVideos;
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || !VIDEO_ID.test(row.id) || row.channelId !== channel.id) continue;
    if (!result.has(row.id)) result.set(row.id, {...normalizeVideo(row, channel.id),author:typeof row.author === 'string' && row.author.trim() ? row.author.slice(0,300) : channel.name});
    if (result.size >= limit) break;
  }
  return [...result.values()];
}
function pruneLists(config, lists) {
  const output = Object.create(null);
  for (const channel of config.channels) output[channel.id] = cleanChannelVideos(lists[channel.id], channel);
  return output;
}
function mergeVideos(config, lists) {
  const result = new Map(config.videos.map(v => [v.id, {...v}]));
  for (const channel of config.channels) {
    for (const video of cleanChannelVideos(lists[channel.id], channel)) {
      if (!result.has(video.id)) result.set(video.id, video);
      else result.set(video.id,{...video,...result.get(video.id),channelId:video.channelId,authorId:video.authorId,published:video.published});
    }
  }
  return result;
}
function saveSnapshot(config, lists) {
  const progress=Object.create(null);
  for(const channel of config.channels){
    const p=channelProgress.get(channel.id);
    if(!p)continue;
    progress[channel.id]={pages:p.pages,complete:!!p.complete,continuation:p.continuation,tokens:[...p.tokens].slice(-SETTINGS.maxPagesPerChannel)};
  }
  return storageSet(CACHE_KEY, {version:2, scope:SCOPE, savedAt:Date.now(), config, channelLists:pruneLists(config, lists), channelDates:Object.fromEntries(config.channels.map(c=>[c.id,channelDates[c.id] || 0])), channelProgress:progress,linkRecords:activeLinkRecords});
}
function restoreChannelProgress(config,lists,previous){
  if(!previous)return 0;
  let restored=0;
  for(const channel of config.channels){
    const p=previous.channelProgress?.[channel.id],stamp=previous.channelDates?.[channel.id];
    if(!p||!Number.isFinite(stamp)||stamp>Date.now()||Date.now()-stamp>SETTINGS.channelTTL)continue;
    if(!Number.isSafeInteger(p.pages)||p.pages<1||p.pages>SETTINGS.maxPagesPerChannel)continue;
    if(typeof p.complete!=='boolean'||(p.continuation!==null&&(typeof p.continuation!=='string'||p.continuation.length>20000)))continue;
    if(!Array.isArray(p.tokens)||p.tokens.length>SETTINGS.maxPagesPerChannel||p.tokens.some(t=>typeof t!=='string'||t.length>20000))continue;
    const videos=cleanChannelVideos(lists[channel.id],channel);
    if(!videos.length||(!p.complete&&!p.continuation))continue;
    channelProgress.set(channel.id,{continuation:p.continuation,pages:p.pages,tokens:new Set(p.tokens),videos,complete:p.complete});
    restored++;
  }
  return restored;
}
function status(text, busy = false) {
  clearTimeout(statusTimer);statusTimer=null;
  ui['status-text'].textContent = text;
  ui.spinner.hidden = true;
  if(ui['status-retry'])ui['status-retry'].hidden=!loadError||!!busy;
  if (!text) {ui.status.hidden=true;return;}
  if (busy) {
    ui.status.hidden=true;
    statusTimer=setTimeout(()=>{
      if (loading || paginationBusy || contentRetryBusy) {
        ui.status.hidden=false;ui.spinner.hidden=false;
      }
    },260);
    return;
  }
  ui.status.hidden=false;
}
function normalizeSearch(text) {
  return String(text || '').normalize('NFKD').replace(/[\u0300-\u036f\u0591-\u05bd\u05bf-\u05c7]/g,'').toLocaleLowerCase('he-IL').replace(/\s+/g,' ').trim();
}
function matchesSearch(text) {
  const terms = normalizeSearch(searchQuery).split(' ').filter(Boolean);
  const content = normalizeSearch(text);
  return terms.every(term => content.includes(term));
}
function browseKey() { return selectedChannelId ? 'channel:' + selectedChannelId : viewMode; }
function rememberBrowse() {
  browseStates.set(browseKey(), {query:searchQuery, count:visibleCount, scrollY:window.scrollY || 0});
}
function scrollToPosition(top) { if (typeof window.scrollTo === 'function') window.scrollTo({top, behavior:'instant'}); }
function switchBrowse(mode, channelId = null) {
  if (playback || !['videos','channels','all'].includes(mode)) return;
  if (channelId && !activeConfig.channels.some(channel => channel.id === channelId)) return;
  flushSearch();
  rememberBrowse();
  viewMode = mode; selectedChannelId = channelId;
  const saved = browseStates.get(browseKey());
  searchQuery = saved ? saved.query : '';
  visibleCount = saved ? saved.count : SETTINGS.cardsPerPage;
  render(activeConfig, activeLists);
  scrollToPosition(saved ? saved.scrollY : 0);
}
function setViewStyle(mode) {
  if (!['grid','list'].includes(mode) || viewStyle===mode) return;
  viewStyle=mode;storageSet(VIEW_KEY,mode);render(activeConfig,activeLists);
}
function clearSearch() {
  clearTimeout(searchTimer); searchTimer = null;
  searchQuery = ''; visibleCount = SETTINGS.cardsPerPage;
  render(activeConfig, activeLists);
  ui.search.focus({preventScroll:true});
}
function render(config, lists) {
  activeConfig = config;
  catalogMetrics.renderCalls++;
  ui.grid.dataset.view=viewStyle;
  ui['view-grid'].setAttribute('aria-pressed',String(viewStyle==='grid'));
  ui['view-list'].setAttribute('aria-pressed',String(viewStyle==='list'));
  activeLists = lists;
  if (selectedChannelId && !config.channels.some(channel => channel.id === selectedChannelId)) {
    browseStates.delete('channel:' + selectedChannelId);
    selectedChannelId = null; viewMode = 'channels'; searchQuery = ''; visibleCount = SETTINGS.cardsPerPage;
  }
  const focus = document.activeElement;
  const focusId = focus && (focus.dataset.videoId || focus.dataset.channelId);
  displayed = mergeVideos(config, lists);
  if(catalogMetrics.startedAt && !catalogMetrics.firstUsefulMs && displayed.size>0)
    catalogMetrics.firstUsefulMs=Date.now()-catalogMetrics.startedAt;
  const manualIds = new Set(config.videos.map(v=>v.id));
  const approvedChannelIds = new Set(config.channels.map(c=>c.id));
  const isChannels = viewMode === 'channels' && !selectedChannelId;
  const selected = config.channels.find(channel => channel.id === selectedChannelId);
  const videoChannels = new Map();
  for (const channel of config.channels) {
    for (const video of cleanChannelVideos(lists[channel.id], channel)) {
      videoChannels.set(video.id, (videoChannels.get(video.id) || '') + ' ' + channel.name);
    }
  }
  // Membership comes from the approved channel list, even when a manual
  // approval wins deduplication and does not carry a channelId itself.
  const channelVideos = selected ? new Set(cleanChannelVideos(lists[selected.id], selected).map(video => video.id)) : null;
  let items = isChannels ? config.channels.filter(channel => matchesSearch(channel.name)) : [...displayed.values()].filter(video =>
    (!channelVideos || channelVideos.has(video.id)) && (viewMode !== 'videos' || (manualIds.has(video.id) && !approvedChannelIds.has(video.authorId) && !videoChannels.has(video.id))) && (viewMode === 'videos' || !channelFilter || selected || video.authorId === channelFilter || (lists[channelFilter] || []).some(v => v.id === video.id)) && matchesSearch(video.title + ' ' + (video.author || '') + ' ' + (videoChannels.get(video.id) || '')));
  if (!isChannels && sortMode === 'newest') items.sort((a,b) => b.published-a.published || a.title.localeCompare(b.title,'he'));
  if (!isChannels && sortMode === 'name') items.sort((a,b) => a.title.localeCompare(b.title,'he'));
  ui.filters.hidden = isChannels;ui['sort-options'].hidden=isChannels;
  ui.sort.value=sortMode;
  const options = document.createDocumentFragment();
  const allOption = document.createElement('option'); allOption.value = ''; allOption.textContent = 'כל הערוצים'; options.append(allOption);
  for (const c of config.channels) { const option = document.createElement('option'); option.value = c.id; option.textContent = c.name; options.append(option); }
  if (!config.channels.some(c => c.id === channelFilter)) {channelFilter = '';storageSet(CHANNEL_FILTER_KEY,'');}
  ui['channel-filter'].replaceChildren(options); ui['channel-filter'].value = viewMode==='videos' ? '' : selected ? selected.id : channelFilter; ui['channel-filter'].disabled = !!selected || viewMode==='videos';
  ui['all-tab'].setAttribute('aria-pressed', String(viewMode === 'all'));
  ui['videos-tab'].setAttribute('aria-pressed', String(viewMode === 'videos'));
  ui['channels-tab'].setAttribute('aria-pressed', String(viewMode === 'channels'));
  ui['channel-heading'].hidden = !selected;
  ui['channel-name'].textContent = selected ? selected.name : '';
  ui['browse-title'].textContent = isChannels ? 'הערוצים שלי' : (selected ? 'הסרטונים של הערוץ' : viewMode === 'videos' ? 'הסרטונים שלי' : 'אלה הסרטונים שלי');
  ui['search-label'].textContent = isChannels ? 'חיפוש בערוצים' : (selected ? 'חיפוש בערוץ' : 'חיפוש בסרטונים');
  ui.search.placeholder = isChannels ? 'חיפוש בערוצים' : (selected ? 'חיפוש בערוץ' : 'חיפוש בסרטונים');
  if (!searchTimer && ui.search.value !== searchQuery) ui.search.value = searchQuery;
  if(searchQuery){ui['search-row'].hidden=false;ui['search-toggle'].setAttribute('aria-expanded','true');}
  ui['clear-search'].hidden = !searchQuery;
  ui.grid.setAttribute('aria-label', isChannels ? 'הערוצים המאושרים' : 'הסרטונים המאושרים');
  const fragment = document.createDocumentFragment();
  for (const item of items.slice(0, visibleCount)) {
    const key = (isChannels ? 'channel:' : 'video:') + item.id + ':' + (isChannels ? JSON.stringify([item.name,item.thumbnail,(lists[item.id] || []).length]) : '');
    const cachedCard = cardCache.get(key);
    if (cachedCard) {
      if (!isChannels) {
        cachedCard.setAttribute('aria-label',(PARENT_CATALOG?'צפייה בסרטון: ':'פתיחה באפליקציה: ')+item.title);
        const thumb=cachedCard.children[0], title=cachedCard.children[1]; title.textContent=item.title;
        const author=cachedCard.children[2] || document.createElement('span');author.className='card-author';author.dir='auto';author.textContent=item.author;
        cachedCard.replaceChildren(...(item.author ? [thumb,title,author] : [thumb,title]));
      }
      fragment.append(cachedCard);continue;
    }
    const card = document.createElement('button');
    cardCache.set(key,card);
    while (cardCache.size > 240) cardCache.delete(cardCache.keys().next().value);
    card.type = 'button'; card.className = 'card';
    if (isChannels) {
      card.dataset.channelId = item.id;
      card.setAttribute('aria-label', 'פתיחת הערוץ: ' + item.name);
      const thumb = document.createElement('span'); thumb.className = 'channel-thumb';
      const fallback = document.createElement('span'); fallback.className = 'channel-fallback'; fallback.textContent = '📺'; fallback.setAttribute('aria-hidden','true');
      thumb.append(fallback);
      if (item.thumbnail) {
        const image = document.createElement('img'); image.className = 'channel-avatar'; image.src = item.thumbnail;
        image.alt = ''; image.loading = PARENT_CATALOG ? 'eager' : 'lazy'; image.decoding = 'async'; image.referrerPolicy = 'no-referrer';
        fallback.hidden = true;
        image.addEventListener('error', () => { image.hidden = true; fallback.hidden = false; }, {once:true});
        thumb.append(image);
      }
      const title = document.createElement('span'); title.className = 'card-title'; title.dir = 'auto'; title.textContent = item.name;
      const count = document.createElement('span'); count.className = 'card-author'; count.textContent = (lists[item.id] || []).length + ' סרטונים נטענו' + (channelProgress.get(item.id)?.continuation ? ' · יש עוד' : '');
      card.append(thumb, title, count);
    } else {
      card.dataset.videoId = item.id;
      card.setAttribute('aria-label', (PARENT_CATALOG ? 'צפייה בסרטון: ' : 'פתיחה באפליקציה: ') + item.title);
      const thumb = document.createElement('span'); thumb.className = 'thumb';
      const image = document.createElement('img');
      image.src = 'https://img.youtube.com/vi/' + item.id + '/mqdefault.jpg';
      image.alt = ''; image.loading = PARENT_CATALOG ? 'eager' : 'lazy'; image.decoding = 'async'; image.referrerPolicy = 'no-referrer';
      image.addEventListener('error', () => { image.hidden = true; }, {once:true});
      const play = document.createElement('span'); play.className = 'play'; play.setAttribute('aria-hidden','true');
      play.textContent = '▶';
      const title = document.createElement('span'); title.className = 'card-title'; title.dir = 'auto'; title.textContent = item.title;
      thumb.append(image, play); card.append(thumb, title);
      if (item.author) {
        const author = document.createElement('span'); author.className = 'card-author'; author.dir = 'auto'; author.textContent = item.author; card.append(author);
      }
    }
    fragment.append(card);
  }
  ui.grid.replaceChildren(fragment);
  ui.count.textContent = items.length ? items.length.toLocaleString('he-IL') + (isChannels ? ' ערוצים לבחירה' : ' סרטונים לבחירה') : '';
  const hasMorePages = !isChannels && config.channels.some(c => (!selected || c.id === selected.id) && (selectedChannelId || !channelFilter || c.id === channelFilter) && channelProgress.get(c.id)?.continuation) && viewMode !== 'videos';
  ui.more.hidden = items.length <= visibleCount && !hasMorePages; ui.more.disabled = paginationBusy;
  ui.more.textContent = isChannels ? 'עוד ערוצים' : 'עוד סרטונים';
  ui.empty.hidden = items.length > 0 || loading;
  const searching = !!normalizeSearch(searchQuery);
  if (!ui.empty.hidden) {
    if (searching) {
      ui['empty-title'].textContent = isChannels ? 'לא מצאתי ערוץ כזה.' : 'לא מצאתי סרטונים כאלה.';
      ui['empty-text'].textContent = 'אפשר לנסות מילה אחרת או לנקות את החיפוש.';
      ui['empty-clear'].hidden = false;ui['empty-clear'].dataset.action='clear';
      ui['empty-clear'].textContent = 'ניקוי החיפוש';
    } else if (loadError) {
      ui['empty-title'].textContent = 'לא הצלחנו לטעון את התוכן.';
      ui['empty-text'].textContent = 'בדקו את החיבור ונסו שוב.';
      ui['empty-clear'].hidden = false;ui['empty-clear'].dataset.action='retry';
      ui['empty-clear'].textContent = 'נסו שוב';
    } else {
      ui['empty-title'].textContent = isChannels ? 'עדיין אין כאן ערוצים.' : 'עדיין אין כאן סרטונים.';
      ui['empty-text'].textContent = isChannels ? 'כשההורה יוסיף ערוצים, הם יופיעו כאן.' : 'כשההורה יוסיף סרטונים או ערוצים, הם יופיעו כאן.';
      ui['empty-clear'].hidden = true;ui['empty-clear'].dataset.action='';
    }
  }
  if (ui['status-text'].textContent.startsWith('אפשר ללחוץ על')) ui.status.hidden=viewMode==='videos' || isChannels;
  if (!searchTimer) audit();
  if (focusId && !playback) {
    const target = [...ui.grid.children].find(card => (card.dataset.videoId || card.dataset.channelId) === focusId);
    if (target) target.focus({preventScroll:true});
  }
}
function orderedInstances() {
  const last = storageGet(INSTANCE_KEY);
  const preferred = last && last.scope === SCOPE && INVIDIOUS_INSTANCES.includes(last.url) ? last.url : null;
  return [...new Set([preferred, ...INVIDIOUS_INSTANCES].filter(Boolean))].filter(url => {
    try { const parsed = new URL(url); return parsed.protocol === 'https:' && parsed.origin === url; } catch (_) { return false; }
  });
}
function rememberInstance(url) { storageSet(INSTANCE_KEY, {scope:SCOPE, url}); }
async function fetchData(url, timeout = SETTINGS.requestTimeoutMs, signal, format = 'json') {
  catalogMetrics.requests++;
  const requestId=++debugRequestSerial,started=Date.now();
  let kind='other';try{kind=new URL(url).searchParams.get('action')||'other';}catch(_){}
  debugCatalog('request-start',{requestId,loadCycle,kind,timeoutMs:timeout});
  try{
    const result=await KidsProviders.fetchJSON(fetch,url,{timeout,signal,format});
    debugCatalog('request-end',{requestId,loadCycle,kind,outcome:'ok',ms:Date.now()-started});
    return result;
  }catch(e){
    debugCatalog('request-end',{requestId,loadCycle,kind,outcome:e?.code||e?.message||'FAILED',ms:Date.now()-started});
    throw e;
  }
}
function fetchJson(url, timeout = SETTINGS.requestTimeoutMs, signal) { return fetchData(url, timeout, signal, 'json'); }
async function fetchAuthorization(source='initial'){
  if(NATIVE_MODE && typeof window.KidsNative.fetchAuthorization==='function'){
    const requestId=++debugRequestSerial,started=Date.now();
    catalogMetrics.requests++;
    debugCatalog('request-start',{requestId,loadCycle,kind:'list',source,transport:'native',timeoutMs:36000});
    try{
      const doc=await window.KidsNative.fetchAuthorization({loadCycle,requestId,source});
      if(!doc||typeof doc.list!=='string'||!Number.isSafeInteger(doc.version)
          ||typeof doc.updatedAt!=='string'||doc.catalogVersion!==1)
        throw new Error('INVALID_AUTH_RESPONSE');
      debugCatalog('request-end',{requestId,loadCycle,kind:'list',source,transport:'native',outcome:'ok',ms:Date.now()-started});
      return doc;
    }catch(e){
      debugCatalog('request-end',{requestId,loadCycle,kind:'list',source,transport:'native',outcome:e?.code||e?.message||'failed',ms:Date.now()-started});
      throw e;
    }
  }
  return fetchJson(PARENT_API+'?action=list');
}

// This parser runs only on the parent's published list, never on child input.
function classifyYouTubeLink(input) {
  if (typeof input !== 'string' || !input.trim() || input.length > 4096) throw new Error('INVALID_LINK');
  let value = input.trim();
  if (/^(?:(?:www|m|music)\.)?youtube\.com\//i.test(value) || /^(?:www\.)?youtu\.be\//i.test(value)) value = 'https://' + value;
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (!['https:','http:'].includes(url.protocol) || url.username || url.password || url.port) throw new Error('INVALID_LINK');
  let videoId = null;
  if (['youtu.be','www.youtu.be'].includes(host)) {
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length === 1) videoId = parts[0];
  }
  else if (['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com'].includes(host)) {
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'watch' && parts.length === 1 && url.searchParams.getAll('v').length === 1) videoId = url.searchParams.get('v');
    else if (['shorts','live','embed'].includes(parts[0]) && parts.length === 2) videoId = parts[1];
    else if (parts[0] === 'channel' && CHANNEL_ID.test(parts[1]) && (parts.length === 2 || (parts.length === 3 && ['videos','shorts','streams','featured','playlists','community','about'].includes(parts[2])))) {
      return {url:'https://www.youtube.com/channel/' + parts[1], kind:'channel', id:parts[1]};
    } else {
      let alias = null;
      if (parts[0] && parts[0].startsWith('@') && (parts.length === 1 || (parts.length === 2 && ['videos','shorts','streams','featured','playlists','community','about'].includes(parts[1])))) alias = parts[0];
      else if (['c','user'].includes(parts[0]) && parts[1] && (parts.length === 2 || (parts.length === 3 && ['videos','shorts','streams','featured','playlists','community','about'].includes(parts[2])))) alias = parts[0] + '/' + parts[1];
      if (alias) {
        const decoded = decodeURIComponent(alias);
        if (/\s|[?#\\]/.test(decoded) || decoded === '@' || decoded.split('/').length !== alias.split('/').length) throw new Error('INVALID_LINK');
        return {url:'https://www.youtube.com/' + alias, kind:'channel', id:null};
      }
    }
  } else throw new Error('INVALID_HOST');
  if (!VIDEO_ID.test(videoId)) throw new Error('INVALID_VIDEO_LINK');
  return {url:'https://www.youtube.com/watch?v=' + videoId, kind:'video', id:videoId};
}
function parseLinkList(text) {
  if (typeof text !== 'string' || text.length > 1000000) throw new Error('INVALID_LIST');
  const entries = new Map();
  const invalidLines = [];
  text.replace(/^\uFEFF/,'').split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) return;
    const input = trimmed.split(/\s+\/\//,1)[0].trim();
    const note = trimmed.split(/\s+\/\//,2)[1];
    try {
      const entry = classifyYouTubeLink(input);
      entry.label = typeof note==='string' ? note.trim().slice(0,300) : '';
      if (!entries.has(entry.url)) entries.set(entry.url, entry);
    } catch (_) { invalidLines.push(index + 1); }
  });
  return {entries:[...entries.values()], invalidLines};
}
function safeChannelImage(value, base) {
  if (typeof value !== 'string' || !value || value.length > 4096) return '';
  try {
    const url = base ? new URL(value, base) : new URL(value);
    const googleImage=['img.youtube.com','i.ytimg.com','yt3.ggpht.com','yt3.googleusercontent.com'].includes(url.hostname);
    const allowed=googleImage || (!PARENT_CATALOG && INVIDIOUS_INSTANCES.includes(url.origin));
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && allowed ? url.href : '';
  } catch (_) { return ''; }
}
function sharedCatalogSnapshot(entries, response){
  const records=Object.create(null),lists=Object.create(null),dates=Object.create(null),progress=Object.create(null);
  if(!response||!Array.isArray(response.entries)||response.entries.length>500)return {records,lists,dates,progress};
  const approved=new Map(entries.map(e=>[e.url,e]));
  for(const row of response.entries){
    if(!row||typeof row.approval_url!=='string')continue;
    const entry=approved.get(row.approval_url);
    if(!entry||row.kind!==entry.kind||(entry.id&&row.item_id!==entry.id))continue;
    const checked=Date.parse(row.checked_at);
    if(!Number.isFinite(checked)||checked>Date.now()+300000)continue;
    const title=cleanTitle(row.title);
    if(entry.kind==='video'){
      if(!VIDEO_ID.test(row.item_id))continue;
      records[entry.url]={kind:'video',id:row.item_id,title,thumbnail:safeChannelImage(row.thumbnail),
        published:Number.isSafeInteger(row.published)?row.published:0,
        authorId:CHANNEL_ID.test(row.channel_id)?row.channel_id:'',verifiedAt:checked};
      continue;
    }
    if(!CHANNEL_ID.test(row.item_id))continue;
    records[entry.url]={kind:'channel',id:row.item_id,name:title,thumbnail:safeChannelImage(row.thumbnail),verifiedAt:checked,serverPinned:true};
    const rows=Array.isArray(row.page)?row.page:[];
    if(rows.length>SETTINGS.maxVideosWithoutLimit*2)continue;
    lists[row.item_id]=cleanChannelVideos(rows.map(v=>({
      ...v,channelId:row.item_id,authorId:row.item_id,
      thumbnail:safeChannelImage(v?.thumbnail)
    })),{id:row.item_id,name:title});
    // Server-side continuations are provider tokens, and can be resumed only
    // while the catalog timestamp is recent enough for our channel TTL.
    if(Date.now()-checked>SETTINGS.channelTTL)continue;
    dates[row.item_id]=checked;
    if(Number.isSafeInteger(row.pages_loaded)&&row.pages_loaded>=1&&row.pages_loaded<=SETTINGS.maxPagesPerChannel){
      const remoteToken=typeof row.continuation==='string'&&row.continuation.length<=20000?row.continuation:null;
      // Invidious tokens cannot be passed to the native NewPipe pager.
      const token=NATIVE_MODE&&remoteToken?'__NATIVE_FIRST_PAGE__':remoteToken;
      const complete=row.complete===true;
      if(token||complete)progress[row.item_id]={pages:row.pages_loaded,complete,continuation:token,tokens:token?[token]:[]};
    }
  }
  return {records,lists,dates,progress};
}
function cachedLinkRecord(entry, records) {
  const old = records && records[entry.url];
  if (old && old.kind === entry.kind && (entry.kind === 'video' ? VIDEO_ID : CHANNEL_ID).test(old.id) && (!entry.id || old.id === entry.id)) {
    catalogMetrics.displayCacheHits++;
    return {kind:old.kind, id:old.id, title:cleanTitle(old.title), name:typeof old.name === 'string' ? old.name.slice(0,300) : '', author:typeof old.author === 'string' ? old.author.slice(0,300) : '', authorId:CHANNEL_ID.test(old.authorId) ? old.authorId : '', published:Number.isFinite(old.published) ? old.published : 0, verifiedAt:Number.isFinite(old.verifiedAt) ? old.verifiedAt : 0, thumbnail:safeChannelImage(old.thumbnail)};
  }
  return entry.id ? {kind:entry.kind, id:entry.id, title:entry.kind==='video' ? cleanTitle(entry.label||'סרטון מאושר') : 'סרטון מאושר', name:entry.kind==='channel' ? cleanTitle(entry.label||'ערוץ מאושר') : 'ערוץ מאושר', author:''} : null;
}
function configFromLinkRecords(entries, records) {
  const videos = [], channels = [];
  for (const entry of entries) {
    const record = cachedLinkRecord(entry, records);
    if (!record) continue;
    if (record.kind === 'video') videos.push(normalizeVideo(record));
    else channels.push({id:record.id, name:record.name || 'ערוץ מאושר', thumbnail:record.thumbnail});
  }
  return normalizeConfig({videos, channels});
}
function validVideoMetadata(data, id) { return !!data && !data.error && data.videoId === id && typeof data.title === 'string' && !!data.title.trim(); }
function getVideoMetadata(id, signal, force = false) {
  return providers.request('/api/v1/videos/' + id,{signal,force,ttl:SETTINGS.metadataTTL,validate:data => validVideoMetadata(data,id)});
}
function getChannelMetadata(id) {
  return providers.request('/api/v1/channels/' + id,{ttl:12*60*60*1000,validate:data => !!data && data.authorId === id && typeof data.author === 'string' && !!data.author.trim()});
}
async function resolveLink(entry, savedRecord) {
  let id = entry.id;
  // An @handle must still resolve freshly: a saved mapping is display metadata,
  // never a grant. A canonical ID, however, is already the parent's grant.
  if (!id) {
    // Only the current server catalog (never device cache) may pin a legacy
    // handle to a UC id, after checking the approval-list version.
    if(savedRecord?.serverPinned===true && savedRecord.kind==='channel' && CHANNEL_ID.test(savedRecord.id))id=savedRecord.id;
    else {
      const data = await providers.request('/api/v1/resolveurl?url=' + encodeURIComponent(entry.url),{force:true,ttl:SETTINGS.metadataTTL,validate:data => !!data && CHANNEL_ID.test(data.ucid || data.browseId)});
      id = data.ucid || data.browseId;
    }
  }
  const verifiedDisplay = savedRecord && savedRecord.kind===entry.kind && savedRecord.id===id;
  const freshMetadata=verifiedDisplay && (savedRecord.serverPinned===true ||
    (Number.isFinite(savedRecord.verifiedAt)&&savedRecord.verifiedAt<=Date.now()
    && Date.now()-savedRecord.verifiedAt<24*60*60*1000));
  if (entry.kind === 'video') {
    if(freshMetadata && savedRecord.title && savedRecord.title!=='סרטון מאושר')
      return {kind:'video',...normalizeVideo(savedRecord),verifiedAt:savedRecord.verifiedAt};
    const data = await getVideoMetadata(id);
    return {kind:'video',...normalizeVideo(data),verifiedAt:Date.now()};
  }
  if(freshMetadata && savedRecord.name && savedRecord.name!=='ערוץ מאושר')
    return {kind:'channel',id,name:savedRecord.name,thumbnail:safeChannelImage(savedRecord.thumbnail),verifiedAt:savedRecord.verifiedAt};
  const data = await getChannelMetadata(id);
  const images = Array.isArray(data.authorThumbnails) ? data.authorThumbnails : [];
  const image = images.find(item => item && item.width >= 128 && safeChannelImage(item.url)) || images.find(item => item && safeChannelImage(item.url));
  return {kind:'channel',id,name:cleanTitle(data.author),thumbnail:image ? safeChannelImage(image.url) : '',verifiedAt:Date.now()};
}
async function channelPage(channelId, continuation, deadline, force = false) {
  let path = '/api/v1/channels/' + channelId + '/videos';
  if (continuation) path += '?continuation=' + encodeURIComponent(continuation);
  return providers.request(path,{force,ttl:SETTINGS.channelTTL,timeoutMs:Math.min(SETTINGS.requestTimeoutMs, Math.max(1,deadline-Date.now())),validate:data => !!data && Array.isArray(data.videos) && (data.continuation == null || (typeof data.continuation === 'string' && data.continuation.length < 20000))});
}
async function loadChannel(channel, pagesToLoad = 1, force = false) {
  const progress = channelProgress.get(channel.id) || {continuation:null,pages:0,tokens:new Set(),videos:[],complete:false};
  if(NATIVE_MODE&&progress.continuation==='__NATIVE_FIRST_PAGE__'){
    progress.continuation=null;progress.pages=0;progress.tokens=new Set();
    // Keep prepared titles, but bootstrap the separate native cursor sequence.
  }
  if (progress.complete) return {videos:progress.videos,complete:true,limited:false,failed:false};
  const deadline = Date.now() + SETTINGS.channelBudgetMs;
  const videos = new Map(progress.videos.map(v => [v.id,v]));
  const limit = channel.maxVideos === undefined ? SETTINGS.maxVideosWithoutLimit : channel.maxVideos;
  let failed = false;
  for (let page = 0; page < pagesToLoad && progress.pages < SETTINGS.maxPagesPerChannel; page++) {
    try {
      const data = await channelPage(channel.id,progress.continuation,deadline,force);
      if(!providers.isNetworkData(data))catalogMetrics.channelCacheHits++;
      progress.pages++;
      if (providers.isNetworkData(data)) channelDates[channel.id]=Date.now();
      for (const row of data.videos) {
        const video = normalizeVideo(row,channel.id);
        if (!video) continue;
        if (!videos.has(video.id)) videos.set(video.id,video);
        if (providers.isNetworkData(data)) verifiedChannelVideos.set(video.id,channel.id);
        if (videos.size >= limit) break;
      }
      if (videos.size >= limit || !data.continuation || progress.tokens.has(data.continuation) || progress.pages >= SETTINGS.maxPagesPerChannel) {
        progress.complete = true; progress.continuation = null; break;
      }
      progress.tokens.add(data.continuation); progress.continuation = data.continuation;
    } catch (_) {failed = true; break;}
  }
  progress.videos = [...videos.values()]; channelProgress.set(channel.id,progress);
  return {videos:progress.videos,complete:progress.complete,limited:!!progress.continuation,failed};
}
async function loadVisibleMetadata() {
  const visible = new Set([...ui.grid.children].map(card=>card.dataset.videoId));
  const pending = activeConfig.videos.filter(video=>visible.has(video.id) && video.title==='סרטון מאושר');
  await parallelMap(pending,async video=>{
    try {
      const data=await getVideoMetadata(video.id); const normalized=normalizeVideo(data);
      if (!getApprovedVideos().has(video.id)) return;
      activeConfig.videos=activeConfig.videos.map(v=>v.id===video.id?normalized:v);
      const url='https://www.youtube.com/watch?v='+video.id;
      if (activeLinkRecords[url]) activeLinkRecords[url]={kind:'video',...normalized};
      saveSnapshot(activeConfig,activeLists);render(activeConfig,activeLists);
    } catch (_) { /* An individual manual ID remains explicitly approved. */ }
  });
}
async function loadMoreVideos() {
  if (loading || paginationBusy || playback) return;
  const loadingText='טוענים עוד סרטונים…';
  paginationBusy = true;ui.more.dataset.busy='true';status(loadingText,true);visibleCount += SETTINGS.cardsPerPage;
  render(activeConfig,activeLists);
  const relevant = activeConfig.channels.filter(c => (viewMode==='all' || !!selectedChannelId) && (!selectedChannelId || c.id === selectedChannelId) && (selectedChannelId || !channelFilter || c.id === channelFilter) && channelProgress.get(c.id)?.continuation);
  try {
    await Promise.all([loadVisibleMetadata(),parallelMap(relevant, async channel => {
      const result = await loadChannel(channel,1);
      activeLists[channel.id] = result.complete ? result.videos : cleanChannelVideos([...result.videos,...(activeLists[channel.id] || [])],channel);
      saveSnapshot(activeConfig,activeLists); render(activeConfig,activeLists);
      if (result.failed) status('חלק מהסרטונים אינם זמינים כרגע. אפשר לנסות שוב מאוחר יותר.');
    })]);
  } finally {
    paginationBusy=false;delete ui.more.dataset.busy;
    if(authorizationReloadPending){
      authorizationReloadPending=false;
      await loadApp({trigger:'pagination-grant-changed'});
    }else{
      render(activeConfig,activeLists);
      if(ui['status-text'].textContent===loadingText)status('');
    }
  }
}
async function parallelMap(items, worker) {
  let index = 0;
  await Promise.all(Array.from({length:Math.min(NATIVE_MODE?1:SETTINGS.parallelChannels, items.length)}, async () => {
    while (index < items.length) { const item = items[index++]; await worker(item); }
  }));
}
function transientAuthorizationFailure(error){
  const code=String(error?.code||error?.message||'');
  return ['DNS_ERROR','CONNECT_ERROR','NETWORK_ERROR','NETWORK_OR_CORS',
    'TIMEOUT','RATE_LIMITED','PROVIDER_ERROR','WHITELIST_UNAVAILABLE',
    'AUTH_CHANGED_RETRY','CATALOG_AUTH_CHANGED','BUSY'].includes(code);
}
function scheduleCatalogRetry(reason='partial'){
  // Only authorization needs long-lived recovery. Optional channel-completion
  // attempts keep their previous three-try cap to avoid excess provider traffic.
  if(catalogRetryTimer || (reason==='partial'&&catalogRetryAttempts>=3))return;
  const steps=reason==='authorization'?[6000,18000,45000,90000,180000]:
    [35000,90000,180000];

  const isGrant=reason==='authorization';
  const count=isGrant?authorizationRetryAttempts:catalogRetryAttempts;
  const stage=Math.min(count,steps.length-1),delay=steps[stage];
  if(isGrant)authorizationRetryAttempts=Math.min(count+1,steps.length);
  else catalogRetryAttempts=Math.min(count+1,steps.length);
  debugCatalog('retry-scheduled',{reason,attempt:isGrant?authorizationRetryAttempts:catalogRetryAttempts,delayMs:delay});
  catalogRetryTimer=setTimeout(()=>{
    catalogRetryTimer=null;
    if(document.hidden||playback||loading||paginationBusy){
      catalogRetryPending=true;return;
    }
    // navigator.onLine is only a hint. It may be true during DNS outages
    // or false while connectivity is recovering; the fresh HTTPS result is
    // the sole authority. Never substitute cached grants.
    catalogMetrics.retries++;
    if(reason==='partial'&&approvalMarker&&displayed.size>0)retryCatalogContents();
    else loadApp({forceCatalog:reason==='partial',trigger:'scheduled-'+reason});
  },delay);
  if(catalogRetryTimer&&typeof catalogRetryTimer.unref==='function')catalogRetryTimer.unref();
}
async function retryCatalogContents(){
  if(contentRetryBusy||loading||paginationBusy||document.hidden||navigator.onLine===false||!approvalMarker)return;
  contentRetryBusy=true;
  status('משלימים את הפרטים החסרים…',true);
  const generation=authorizationGeneration,cycle=loadCycle,serial=++authorityCheckSerial,marker=approvalMarker;
  const current=()=>generation===authorizationGeneration&&cycle===loadCycle&&serial===authorityCheckSerial;
  debugCatalog('partial-retry-start',{loadCycle:cycle,pending:pendingChannelRetry.size});
  try{
    const remote=await fetchAuthorization('partial-retry');
    if(!current())return;
    if(document.hidden){catalogRetryPending=true;return;}
    if(!remote||typeof remote.list!=='string')throw Error('INVALID_REMOTE_LIST');
    const next=String(remote.updatedAt||'')+'\0'+remote.list;
    if(next!==marker){
      debugCatalog('partial-retry-grants-changed',{loadCycle:cycle});
      failClosedAuthorization('רשימת ההורה השתנתה. מאמתים מחדש…');
      await loadApp({trigger:'partial-grant-changed'});return;
    }
    const channels=activeConfig.channels.filter(c=>pendingChannelRetry.has(c.id));
    let failures=0;
    await parallelMap(channels,async channel=>{
      const result=await loadChannel(channel,1,true);
      if(!current())return;
      if(document.hidden){catalogRetryPending=true;return;}
      if(result.failed){failures++;return;}
      pendingChannelRetry.delete(channel.id);
      const nextLists={...activeLists,[channel.id]:result.complete?result.videos:cleanChannelVideos([...result.videos,...(activeLists[channel.id]||[])],channel)};
      activeLists=pruneLists(activeConfig,nextLists);
      saveSnapshot(activeConfig,activeLists);render(activeConfig,activeLists);
    });
    if(!current())return;
    debugCatalog('partial-retry-complete',{loadCycle:cycle,remaining:pendingChannelRetry.size,failures});
    if(failures||pendingChannelRetry.size){status('חלק מהתוכן עדיין לא התעדכן. ננסה שוב אוטומטית.');scheduleCatalogRetry('partial');}
    else {catalogRetryAttempts=0;status('');}
  }catch(e){
    if(!current())return;
    // This is an optional content-completion retry, not the periodic authority
    // enforcement check. A transient auth transport failure here must not erase
    // a catalog that was already freshly authorized; the regular poll remains
    // responsible for fail-closed enforcement.
    debugCatalog('partial-retry-auth-failed',{loadCycle:cycle,error:e?.code||e?.message||'UNKNOWN',kept:displayed.size});
    if(displayed.size&&approvalMarker){
      status('חלק מהתוכן עדיין לא התעדכן. ננסה שוב אוטומטית.');
      scheduleCatalogRetry('partial');
    }else{
      failClosedAuthorization(undefined,'partial-retry-no-authority');
      scheduleCatalogRetry('authorization');
    }
  }finally{contentRetryBusy=false;ui.spinner.hidden=true;}
}
async function loadApp({forceCatalog=false,trigger='unspecified'}={}) {
  if (loading || paginationBusy || !ui.player.hidden) return;
  clearTimeout(catalogRetryTimer);catalogRetryTimer=null;catalogRetryPending=false;
  const startedAt=Date.now();catalogMetrics.startedAt=startedAt;
  const thisCycle=++loadCycle;
  ++authorityCheckSerial;
  pendingChannelRetry.clear();
  debugCatalog('load-start',{loadCycle:thisCycle,forceCatalog,trigger});
  catalogMetrics.requests=0;catalogMetrics.providerCalls=0;catalogMetrics.renderCalls=0;
  catalogMetrics.displayCacheHits=0;catalogMetrics.channelCacheHits=0;
  catalogMetrics.authorizationMs=0;catalogMetrics.metadataMs=0;catalogMetrics.channelsMs=0;catalogMetrics.firstUsefulMs=0;catalogMetrics.completedMs=0;
  loadError=false;
  channelProgress.clear(); verifiedChannelVideos.clear();
  loading = true; lastLoad = Date.now();
  const generation=authorizationGeneration;
  const stillAuthorized=()=>generation===authorizationGeneration;
  ui.grid.setAttribute('aria-busy','true');
  // Never keep previously approved cards visible while authority is being revalidated.
  activeConfig={videos:[],channels:[]};activeLists=Object.create(null);displayed=new Map();
  ui.grid.replaceChildren();ui.count.textContent='';ui.more.hidden=true;ui.empty.hidden=true;
  status('רגע קטן, הסרטונים בדרך…', true);
  const previous = readSnapshot();
  channelDates = {...(previous ? previous.channelDates : {})};
  let config = null;
  let lists = Object.create(null);
  let invalidConfig = false;
  let entries = null, linkFailures = 0, failures=0, invalidLines = [];
  let cacheSaved = true;
  activeLinkRecords = Object.create(null);
  try {
    let raw;
    const remote = await fetchAuthorization('load');
    if(!stillAuthorized())return;
    catalogMetrics.authorizationMs=Date.now()-startedAt;
    debugCatalog('authorization-ok',{loadCycle:thisCycle,ms:catalogMetrics.authorizationMs,version:remote&&remote.version,catalogVersion:remote&&remote.catalogVersion});
    if (!remote || typeof remote.list !== 'string') throw new Error('INVALID_REMOTE_LIST');
    // Successful fresh authority resets ONLY authority backoff, even when
    // optional catalog completion still has outstanding work.
    authorizationRetryAttempts=0;
    raw = remote.list;
    approvalMarker=String(remote.updatedAt||'')+'\0'+raw;
    let shared={records:Object.create(null),lists:Object.create(null),dates:Object.create(null),progress:Object.create(null)};
    if(remote.catalogVersion===1)try {
      let catalog;
      // Native authorization can carry the already-approved, prepared
      // display catalog in the SAME HTTPS response. This removes the extra
      // WebView request and its fixed 4s stall on slow physical devices.
      const bundled= NATIVE_MODE && remote.preparedCatalog;
      if(bundled && bundled.version===remote.version && bundled.updatedAt===remote.updatedAt
          && Array.isArray(bundled.entries)){
        catalog=bundled;
        debugCatalog('shared-catalog-from-authorization',{loadCycle:thisCycle,entries:bundled.entries.length});
      }else if(NATIVE_MODE){
        // The catalog is optional display data. Never issue another catalog
        // request from WebView (or via the native bridge) after a successful
        // authoritative native list. A missing bundle is a cache miss only.
        debugCatalog('shared-catalog-not-bundled',{loadCycle:thisCycle});
      }else{
        catalog=await fetchJson(PARENT_API+'?action=catalog',4000);
      }
      if(!stillAuthorized())return;
      if(catalog&&catalog.available!==false&&Array.isArray(catalog.entries)){
        if(catalog.version!==remote.version||catalog.updatedAt!==remote.updatedAt)
          throw new Error('CATALOG_AUTH_CHANGED');
        shared=sharedCatalogSnapshot(parseLinkList(raw).entries,catalog);
        debugCatalog('shared-catalog-ok',{entries:catalog.entries.length,records:Object.keys(shared.records).length,channelLists:Object.keys(shared.lists).length});
      }
    }catch(e){
      debugCatalog('shared-catalog-miss',{error:String(e&&e.message||'UNKNOWN')});
      if(e?.message==='CATALOG_AUTH_CHANGED')throw e;
      // Catalog unavailable is an ordinary cache miss, never a permission grant.
    }
    {
      try {
        // Compatibility for an old JSON list pasted into the new file.
        if (raw.trimStart().startsWith('{')) config = normalizeConfig(JSON.parse(raw));
        else {
          ({entries, invalidLines} = parseLinkList(raw));
          for (const entry of entries) {
            // A canonical ID comes directly from the freshly validated parent list.
            // Legacy @handles may use ONLY the same-URL mapping returned by the
            // server catalog alongside matching approval version and timestamp.
            // Never authorize an alias from localStorage or a stale response.
            const displaySource=entry.id
              ? {...(previous?.linkRecords||{}),...shared.records}
              : shared.records;
            const record=cachedLinkRecord(entry,displaySource);
            if (record) activeLinkRecords[entry.url] = record;
          }
          config = configFromLinkRecords(entries, activeLinkRecords);
        }
      } catch (error) { invalidConfig = true; throw error; }
      lists = pruneLists(config, {...(previous?.channelLists||{}),...shared.lists});
      channelDates={...channelDates,...shared.dates};
      // Persist removals before metadata or channel requests can fail.
      if (!saveSnapshot(config, lists)) cacheSaved = false;
    }
    // Manual approvals appear immediately; cached channels only after fresh config validation.
    render(config, lists);
    const metadataStarted=Date.now();
    if (entries && entries.length) {
      status('מזהים את הסרטונים והערוצים…', true);
      let resolvedCount=0;
      await parallelMap(entries.filter((entry,index) => entry.kind === 'channel' || index < SETTINGS.cardsPerPage), async entry => {
        try {
          const record=await resolveLink(entry,shared.records[entry.url]||previous?.linkRecords?.[entry.url]);
          if(!stillAuthorized())return;
          activeLinkRecords[entry.url]=record;
        }
        catch (error) { if(!stillAuthorized())return;linkFailures++;debugCatalog('metadata-failed',{kind:entry.kind,hasId:!!entry.id,error:String(error&&error.message||'UNKNOWN')}); }
        if(!stillAuthorized())return;
        // Render the first useful result and then batches, not each late title.
        if(++resolvedCount===1 || resolvedCount%3===0){
          config=configFromLinkRecords(entries,activeLinkRecords);
          lists=pruneLists(config,{...lists,...shared.lists});
          render(config,lists);
        }
      });
      if(!stillAuthorized())return;
      config=configFromLinkRecords(entries,activeLinkRecords);
      lists=pruneLists(config,{...lists,...shared.lists});
      if(!saveSnapshot(config,lists))cacheSaved=false;
      render(config,lists);
    }
    catalogMetrics.metadataMs=Date.now()-metadataStarted;
    const restoredChannels=forceCatalog?0:restoreChannelProgress(config,lists,{channelProgress:{...(previous?.channelProgress||{}),...shared.progress},channelDates:{...(previous?.channelDates||{}),...shared.dates}});
    catalogMetrics.channelCacheHits+=restoredChannels;
    const channelsStarted=Date.now();
    let finished = 0, limited = 0;
    if (config.channels.length) status('טוענים את הסרטונים מהערוצים…', true);
    await parallelMap(config.channels, async channel => {
      const restored=channelProgress.get(channel.id);
      const prepared=(lists[channel.id]||[]).length;
      // Prepared, freshly authorized pages are immediately usable. Do not block
      // startup on slow NewPipe pagination just to complete an optional page.
      const deferNative=NATIVE_MODE&&!forceCatalog&&!restored&&prepared>0;
      if(deferNative){
        pendingChannelRetry.add(channel.id);
        channelProgress.set(channel.id,{continuation:'__NATIVE_FIRST_PAGE__',pages:0,tokens:new Set(),videos:cleanChannelVideos(lists[channel.id],channel),complete:false});
      }
      const result=deferNative ? {videos:lists[channel.id],complete:false,limited:true,failed:false}
        :restored ? {videos:restored.videos,complete:restored.complete,limited:!!restored.continuation,failed:false} : await loadChannel(channel,1,forceCatalog);
      if(!stillAuthorized())return;
      if (result.failed){failures++;pendingChannelRetry.add(channel.id);debugCatalog('channel-page-failed',{loadCycle:thisCycle,channel:channel.id.slice(0,8),cached:(lists[channel.id]||[]).length});}
      if (result.limited) limited++;
      lists[channel.id] = result.complete ? result.videos : cleanChannelVideos([...result.videos, ...(lists[channel.id] || [])], channel);
      if (!saveSnapshot(config, lists)) cacheSaved = false;
      render(config, lists);
      status('טוענים את הסרטונים מהערוצים… ' + (++finished) + ' מתוך ' + config.channels.length, true);
    });
    if(!stillAuthorized())return;
    catalogMetrics.channelsMs=Date.now()-channelsStarted;
    if (!saveSnapshot(config, lists)) cacheSaved = false;
    const messages = [];
    if (invalidLines.length) messages.push('חלק מהקישורים ברשימה זקוקים לבדיקה של ההורה.');
    if (linkFailures && displayed.size) messages.push('חלק מהפרטים לא התעדכנו כרגע. התוכן שכבר נטען עדיין זמין.');
    else if (linkFailures) messages.push('הסרטונים אינם זמינים כרגע. נסו שוב מאוחר יותר.');
    if (failures && displayed.size) messages.push('חלק מהערוצים אינם זמינים כרגע. התוכן שכבר נטען עדיין מוצג.');
    else if (failures) messages.push('הסרטונים אינם זמינים כרגע. נסו שוב מאוחר יותר.');
    if (limited) messages.push('אפשר ללחוץ על ״עוד סרטונים״ להמשך הרשימה.');
    if (!cacheSaved) messages.push('לא הצלחנו לשמור נתונים זמניים במכשיר. התוכן עדיין זמין כל עוד יש חיבור לאינטרנט.');
    if(linkFailures||failures||pendingChannelRetry.size){if(failures||linkFailures)messages.push('המערכת תנסה להשלים את הפרטים שוב באופן אוטומטי.');scheduleCatalogRetry('partial');}
    else {catalogRetryAttempts=0;catalogRetryPending=false;}
    status(messages.join(' '));
  } catch (error) {
    if(!stillAuthorized())return;
    debugCatalog('load-fatal',{loadCycle:thisCycle,phase:catalogMetrics.authorizationMs===0?'authorization':'after-authorization',error:String(error&&error.message||'UNKNOWN'),metrics:{...catalogMetrics}});
    loadError=true;
    activeConfig = {videos:[], channels:[]}; activeLists = Object.create(null);
    displayed = new Map(); ui.grid.replaceChildren(); ui.count.textContent = ''; ui.more.hidden = true;
    activeLinkRecords = Object.create(null);approvalMarker='';
    // Any authority failure clears the local grant snapshot too.
    saveSnapshot({videos:[], channels:[]}, {});
    const retry=transientAuthorizationFailure(error);
    status(retry?'לא הצלחנו לאמת את אישורי ההורה. ננסה להתחבר שוב אוטומטית.':
      'לא ניתן לאמת את ההרשאות כרגע. בדקו את החיבור או בקשו עזרת הורה.');
    if(retry)scheduleCatalogRetry('authorization');
    else debugCatalog('retry-stopped',{reason:'non-transient-authorization'});
  } finally {
    catalogMetrics.completedMs=Date.now()-startedAt;
    loading = false; ui.grid.removeAttribute('aria-busy');
    if(stillAuthorized()){
      render(activeConfig, activeLists);
      if(!loadError)debugCatalog('load-complete',{loadCycle:thisCycle,displayed:displayed.size,linksFailed:linkFailures,channelsFailed:failures,metrics:{...catalogMetrics}});
    }
    if(pendingOnlineRefresh&&navigator.onLine!==false){pendingOnlineRefresh=false;catalogRetryPending=false;loadApp({trigger:'online-pending'});}
    else if(catalogRetryPending&&!document.hidden&&!playback&&!paginationBusy&&navigator.onLine!==false){
      catalogRetryPending=false;catalogMetrics.retries++;
      if(approvalMarker&&displayed.size)retryCatalogContents();else loadApp({forceCatalog:true,trigger:'deferred-retry'});
    }
  }
}

function failClosedAuthorization(message='לא הצלחנו לאמת כרגע את רשימת ההורה.',reason='authorization'){
  clearTimeout(catalogRetryTimer);catalogRetryTimer=null;
  authorizationGeneration++;++authorityCheckSerial;loadError=true;approvalMarker='';
  pendingChannelRetry.clear();catalogRetryPending=false;
  debugCatalog('authorization-blocked',{loadCycle,reason,generation:authorizationGeneration});
  activeConfig={videos:[],channels:[]};activeLists=Object.create(null);activeLinkRecords=Object.create(null);
  displayed=new Map();ui.grid.replaceChildren();ui.count.textContent='';ui.more.hidden=true;saveSnapshot(activeConfig,{});
  status(message);render(activeConfig,activeLists);
}
async function checkAuthorizationFreshness(source='poll'){
  if(authorizationCheckInFlight||contentRetryBusy||loading||playback||document.hidden||navigator.onLine===false)return;
  authorizationCheckInFlight=true;
  const cycle=loadCycle,serial=++authorityCheckSerial,generation=authorizationGeneration;
  const current=()=>cycle===loadCycle&&serial===authorityCheckSerial&&generation===authorizationGeneration&&!loading;
  const started=Date.now();
  debugCatalog('authorization-check-start',{source,loadCycle:cycle,serial});
  try{
    const remote=await fetchAuthorization(source);
    if(!current()){debugCatalog('authorization-check-stale',{source,loadCycle:cycle,serial,outcome:'success'});return;}
    if(!remote||typeof remote.list!=='string')throw new Error('INVALID_REMOTE_LIST');
    const marker=String(remote.updatedAt||'')+'\0'+remote.list;
    debugCatalog('authorization-check-end',{source,loadCycle:cycle,serial,outcome:'ok',ms:Date.now()-started,changed:marker!==approvalMarker});
    if(!approvalMarker||marker!==approvalMarker){
      failClosedAuthorization('רשימת ההורה השתנתה. מאמתים אותה מחדש…','grant-change');
      if(paginationBusy){authorizationReloadPending=true;return;}
      await loadApp({trigger:'fresh-grant-changed'});
    }
  }catch(e){
    if(!current()){debugCatalog('authorization-check-stale',{source,loadCycle:cycle,serial,outcome:e?.code||'failed'});return;}
    debugCatalog('authorization-check-end',{source,loadCycle:cycle,serial,outcome:e?.code||e?.message||'failed',ms:Date.now()-started});
    failClosedAuthorization(undefined,'fresh-check-failed');
    if(transientAuthorizationFailure(e))scheduleCatalogRetry('authorization');
    else debugCatalog('retry-stopped',{reason:'non-transient-authorization'});
  }finally{authorizationCheckInFlight=false;}
}

function playerMessage(text, busy = false) {
  ui['player-message'].textContent = text; ui['player-spinner'].hidden = !busy;
}
function stopMedia() {
  if(frameCleanup){frameCleanup();frameCleanup=null;}
  clearTimeout(playerTimer);
  const media = ui['media-host'].children[0];
  if (media) {
    if (media.tagName.toLowerCase() === 'iframe') media.src='';
    else {media.pause();media.removeAttribute('src');media.load();}
  }
  ui['media-host'].replaceChildren();
}
function playerUnavailable() {
  stopMedia(); ui['player-error'].hidden = false; ui['next-player'].hidden = true;
  playerMessage('');
}
async function verifyVideoApproval(session) {
  if (getApprovedVideos().has(session.video.id)) return true;
  const expected = session.video.authorId || session.video.channelId;
  if (!getApprovedChannels().has(expected)) return false;
  if (verifiedChannelVideos.get(session.video.id) === expected) return true;
  // Persisted metadata is useful for display, but not proof of channel membership.
  const data = await getVideoMetadata(session.video.id,session.controller.signal,true);
  if(data.authorId !== expected || !getApprovedChannels().has(data.authorId))return false;
  verifiedChannelVideos.set(session.video.id,data.authorId);return true;
}
function mediaSource(base, id) {
  if (!INVIDIOUS_INSTANCES.includes(base) || !VIDEO_ID.test(id)) throw new KidsProviders.AppError('INVALID_REQUEST');
  const url = new URL('/latest_version',base);
  url.searchParams.set('id',id); url.searchParams.set('itag','18'); url.searchParams.set('local','true');
  return url.href;
}
async function tryPlayer() {
  if (BROWSER_PLAYBACK_DISABLED) return;
  const session = playback;
  if (!session || session.controller.signal.aborted) return;
  const sequence = ++playerSequence;
  stopMedia(); ui['player-error'].hidden = true; ui['next-player'].hidden = true;ui['next-player'].textContent='נסו נגן אחר';
  playerMessage(session.index ? 'מחפש מקור חלופי...' : 'מתחבר...',true);
  const current = () => playback === session && sequence === playerSequence && !session.controller.signal.aborted;
  try {
    // Recheck grants on every switch. Fresh channel proof stays in memory only;
    // a prior manual approval cannot authorize a later, revoked fallback.
    session.verified = await verifyVideoApproval(session);
    if (!current()) return;
    if (!session.verified) {playerUnavailable();return;}
  } catch (_) {if (current()) playerUnavailable(); return;}
  if (!current()) return;
  const eligible=providers.getHealthyProviders('playback','/embed/'+session.video.id);
  while(session.index<session.instances.length && !eligible.includes(session.instances[session.index]))session.index++;
  if (Date.now() >= session.deadline || session.index >= session.instances.length) {playerUnavailable();return;}
  const base = session.instances[session.index++];
  if (providers.getCachedData('compatibility:'+base+session.video.id) || !providers.getHealthyProviders('native','/native/'+session.video.id).includes(base)) {
    try {await tryCompatiblePlayer(session,base,sequence);} catch (_) {if(current())tryPlayer();}
    return;
  }
  const started = Date.now();
  const media = document.createElement('video');
  media.controls = true; media.autoplay = true; media.playsInline = true; media.preload = 'auto';
  media.setAttribute('controlsList','nodownload noremoteplayback'); media.disableRemotePlayback = true;
  media.setAttribute('aria-label','צפייה: ' + session.video.title);
  let settled = false, becameReady = false;
  const valid = () => current() && ui['media-host'].children[0] === media;
  const fail = error => {
    if (!valid() || settled) return;
    settled = true; if (Number.isFinite(media.currentTime) && media.currentTime > 0) session.resumeTime = media.currentTime;
    if (becameReady) session.deadline = Date.now() + SETTINGS.playerBudgetMs;
    providers.markResourceFailure(base,'/native/'+session.video.id);
    providers.updateProviderHealth(base,'native',false,Date.now()-started,error);
    providers.record({kind:'playback',provider:base,path:session.video.id,outcome:error.code,ms:Date.now()-started});
    audit(); tryCompatiblePlayer(session,base,sequence).catch(() => {if(current())tryPlayer();});
  };
  const ready = () => {
    if (!valid() || settled) return;
    becameReady = true; clearTimeout(playerTimer);
    providers.updateProviderHealth(base,'native',true,Date.now()-started);
    providers.updateProviderHealth(base,'playback',true,Date.now()-started);
    providers.record({kind:'playback',provider:base,path:session.video.id,outcome:'canplay',ms:Date.now()-started});
    rememberInstance(base); playerMessage(''); ui['next-player'].hidden = session.index >= session.instances.length;
    if (session.resumeTime && media.duration > session.resumeTime) {try {media.currentTime=session.resumeTime;} catch (_) {}}
    const promise = media.play();
    if (promise) promise.catch(error => {if (valid() && error.name === 'NotAllowedError') playerMessage('לחצו על ▶ כדי להתחיל');});
    audit();
  };
  media.addEventListener('canplay',ready,{once:true});
  media.addEventListener('error',() => fail(new KidsProviders.AppError('VIDEO_UNAVAILABLE')),{once:true});
  media.addEventListener('playing',() => {if (valid()) {clearTimeout(playerTimer);playerMessage('');audit();}});
  // A temporary pause/buffer is not a failed provider. Only a prolonged stalled
  // stream while playing triggers fallback, with a finite attempt count.
  media.addEventListener('waiting',() => {if (valid() && !media.paused) {clearTimeout(playerTimer);playerTimer=setTimeout(() => fail(new KidsProviders.AppError('TIMEOUT')),SETTINGS.playerWaitMs);}});
  media.addEventListener('ended',() => {if (valid()) {clearTimeout(playerTimer);playerMessage('הסרטון הסתיים. אפשר לחזור ולבחור סרטון אחר.');}});
  ui['media-host'].replaceChildren(media);
  playerTimer = setTimeout(() => fail(new KidsProviders.AppError('TIMEOUT')),Math.max(1,Math.min(SETTINGS.playerWaitMs,session.deadline-Date.now())));
  media.src = mediaSource(base,session.video.id); media.load();
}
async function tryCompatiblePlayer(session,base,sequence) {
  if (BROWSER_PLAYBACK_DISABLED) return;
  const current=()=>playback===session && playerSequence===sequence && !session.controller.signal.aborted;
  if (!current()) return;
  if (Date.now() >= session.deadline) {playerUnavailable();return;}
  playerMessage('מחפש מקור חלופי...',true);
  // Approval was established by verifyVideoApproval: direct parent approval or
  // fresh channel membership. Do not make a second API request a prerequisite
  // for this exact-ID embed; an iframe does not need API CORS permission.
  // Recheck current grants so a revoked channel cannot reuse an old session.
  if (!session.verified || (!getApprovedVideos().has(session.video.id) && !getApprovedChannels().has(session.video.authorId || session.video.channelId))) throw new KidsProviders.AppError('VIDEO_UNAVAILABLE');
  stopMedia();
  const started=Date.now();let settled=false;
  const frame=document.createElement('iframe'); frame.id='compatible-frame'; frame.title='צפייה: '+session.video.title;
  if (new URL(base).origin===new URL(SCOPE).origin) throw new KidsProviders.AppError('INVALID_REQUEST');
  // This outer frame is our own trusted document. Its inner provider frame is
  // sandboxed and governed by an exact embed path, separately for every video.
  frame.setAttribute('allow','autoplay; fullscreen; picture-in-picture');frame.referrerPolicy='no-referrer';
  const failed=code=>{
    if(!current() || settled || ui['media-host'].children[0]!==frame)return;
    settled=true;clearTimeout(playerTimer);
    providers.markResourceFailure(base,'/embed/'+session.video.id);
    if(code==='TIMEOUT')providers.updateProviderHealth(base,'playback',false,Date.now()-started,new KidsProviders.AppError(code));
    providers.record({kind:'embed',provider:base,path:session.video.id,outcome:code,ms:Date.now()-started});audit();tryPlayer();
  };
  const onMessage=event=>{
    if (!current() || ui['media-host'].children[0]!==frame || event.source!==frame.contentWindow || event.origin!==new URL(SCOPE).origin || !event.data || event.data.videoId!==session.video.id) return;
    if(event.data.type==='kids-player-error'){failed('FRAME_UNAVAILABLE');return;}
    if(event.data.type!=='kids-player-ready')return;
    clearTimeout(playerTimer);
    const hasAlternative=session.index<session.instances.length;
    playerMessage(hasAlternative?'אם הסרטון לא מתחיל, לחצו על ▶. אפשר גם לנסות מקור אחר.':'אם הסרטון לא מתחיל, לחצו על ▶ או על ״הסרטון לא מתחיל״.');
    ui['next-player'].textContent=hasAlternative?'נסו נגן אחר':'הסרטון לא מתחיל';ui['next-player'].hidden=false;
    providers.setCachedData('compatibility:'+base+session.video.id,{preferred:true},10*60*1000);
    providers.record({kind:'embed',provider:base,path:session.video.id,outcome:'loaded-not-playback-proof'});audit();
  };
  window.addEventListener('message',onMessage);frameCleanup=()=>window.removeEventListener('message',onMessage);
  frame.addEventListener('load',()=>{if(current())frame.contentWindow.postMessage({type:'kids-player-init',provider:base,videoId:session.video.id,title:session.video.title},new URL(SCOPE).origin);},{once:true});
  frame.addEventListener('error',()=>failed('FRAME_UNAVAILABLE'),{once:true});
  frame.src=new URL('./player.html',SCOPE).href;
  playerTimer=setTimeout(()=>failed('TIMEOUT'),Math.max(1,Math.min(SETTINGS.playerWaitMs,session.deadline-Date.now())));
  ui['media-host'].replaceChildren(frame);
}
function launchNativeApp() {
  const session=playback;
  if(!session || !session.appPrompt || !VIDEO_ID.test(session.video.id))return;
  let leftPage=!!document.hidden,finished=false;
  const cleanup=()=>{if(finished)return;finished=true;document.removeEventListener('visibilitychange',onVisibility);};
  const onVisibility=()=>{if(document.hidden){leftPage=true;cleanup();}};
  document.addEventListener('visibilitychange',onVisibility);
  ui['app-open-message'].textContent='פותחים את האפליקציה…';
  try { location.href='kidsyoutube://video/'+session.video.id; }
  catch (_) {cleanup();ui['app-open-message'].textContent='האפליקציה עדיין לא מותקנת במכשיר הזה.';return;}
  setTimeout(()=>{
    cleanup();
    if(playback===session && !leftPage && !document.hidden)
      ui['app-open-message'].textContent='האפליקציה עדיין לא מותקנת במכשיר הזה.';
  },1200);
}
function openPlayer(id) {
  const video = displayed.get(id);
  if (!video || (!getApprovedVideos().has(id) && !getApprovedChannels().has(video.channelId))) return;
  if (PARENT_CATALOG) {
    status('בודקים שהסרטון עדיין מאושר…',true);
    fetchJson(PARENT_API+'?action=list').then(remote=>{
      if(!remote||typeof remote.list!=='string')throw new Error('INVALID_REMOTE_LIST');
      const freshMarker=String(remote.updatedAt||'')+'\0'+remote.list;
      if(!approvalMarker||freshMarker!==approvalMarker){
        failClosedAuthorization('רשימת ההורה השתנתה. מאמתים מחדש…');
        if(paginationBusy)authorizationReloadPending=true;
        else loadApp({trigger:'parent-video-grant-changed'});
        return;
      }
      const current=displayed.get(id);
      if(!current||(!getApprovedVideos().has(id)&&!getApprovedChannels().has(current.channelId)))return;
      status('');
      window.parent.postMessage({type:'kids-parent-open-video',id:current.id,title:current.title,author:current.author||''},location.origin);
    }).catch(()=>failClosedAuthorization('לא ניתן לאמת כרגע את הרשאות ההורה. נסו שוב מאוחר יותר.'));
    return;
  }
  flushSearch();
  const alreadyOpen = !!playback;
  if (playback && playback.controller) playback.controller.abort();
  else {returnFocus=document.activeElement;returnScrollY=window.scrollY||0;}
  returnVideoId=id;
  stopMedia();
  playback={video,appPrompt:true,controller:new AbortController(),instances:[],index:0,verified:true,resumeTime:0};
  ui['player-title'].textContent=video.title;
  ui['player-error'].hidden=false;ui['next-player'].hidden=true;ui['retry-video'].hidden=false;ui['retry-video'].textContent='פתיחה באפליקציה';
  ui['app-open-message'].textContent='את הסרטון אפשר לפתוח באפליקציית Kids YouTube.';
  playerMessage('');
  ui.player.hidden=false;ui.app.inert=true;ui.app.setAttribute('aria-hidden','true');document.body.style.overflow='hidden';ui.back.focus();
  if (!alreadyOpen) history.pushState({kidsYoutubePlayer:true},'',location.href);
}
function closePlayer(fromHistory = false) {
  if (!playback) return;
  playback.controller.abort(); playback=null; playerSequence++; stopMedia();
  ui.player.hidden=true;ui.app.inert=false;ui.app.removeAttribute('aria-hidden');document.body.style.overflow='';
  const target=returnFocus && returnFocus.isConnected ? returnFocus : [...ui.grid.children].find(card=>card.dataset.videoId===returnVideoId);
  if (target) target.focus({preventScroll:true}); scrollToPosition(returnScrollY);
  if (!fromHistory && history.state && history.state.kidsYoutubePlayer) history.back();
  if(catalogRetryPending&&!document.hidden&&!loading&&!paginationBusy&&navigator.onLine!==false){
    catalogRetryPending=false;catalogMetrics.retries++;
    if(approvalMarker&&displayed.size)retryCatalogContents();else loadApp({forceCatalog:true,trigger:'foreground-deferred-retry'});
  }
}
function flushSearch() {
  if (searchTimer) {clearTimeout(searchTimer);searchTimer=null;searchQuery=ui.search.value.slice(0,100);visibleCount=SETTINGS.cardsPerPage;render(activeConfig,activeLists);}
}
ui.grid.addEventListener('click', event => {
  const card = event.target.closest('button');
  if (!card || !ui.grid.contains(card)) return;
  if (card.dataset.channelId) switchBrowse('channels', card.dataset.channelId);
  else if (card.dataset.videoId) openPlayer(card.dataset.videoId);
});
ui['videos-tab'].addEventListener('click', () => switchBrowse('videos'));
ui['all-tab'].addEventListener('click', () => switchBrowse('all'));
ui['channels-tab'].addEventListener('click', () => switchBrowse('channels'));
ui['back-channels'].addEventListener('click', () => switchBrowse('channels'));
ui['search-toggle'].addEventListener('click',()=>{
  const opening=ui['search-row'].hidden;
  ui['search-row'].hidden=!opening;ui['search-toggle'].setAttribute('aria-expanded',String(opening));
  if(opening)ui.search.focus({preventScroll:true});
  else if(!searchQuery){ui.search.value='';}
});
ui.search.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer=setTimeout(() => {searchTimer=null;searchQuery=ui.search.value.slice(0,100);visibleCount=SETTINGS.cardsPerPage;render(activeConfig,activeLists);},SETTINGS.searchDebounceMs);
});
ui.sort.addEventListener('change', () => {sortMode=ui.sort.value;storageSet(SORT_KEY,sortMode);render(activeConfig,activeLists);});
ui['channel-filter'].addEventListener('change', () => {channelFilter=ui['channel-filter'].value;storageSet(CHANNEL_FILTER_KEY,channelFilter);visibleCount=SETTINGS.cardsPerPage;render(activeConfig,activeLists);});
ui['clear-cache'].addEventListener('click', () => {providers.clearCache();providers.resetHealth();loadApp({trigger:'clear-provider-cache'});});
ui.search.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); flushSearch(); ui.search.blur(); } });
ui['clear-search'].addEventListener('click', clearSearch);
ui['empty-clear'].addEventListener('click', () => {if(ui['empty-clear'].dataset.action==='retry')loadApp({trigger:'user-empty-retry'});else clearSearch();});
ui['view-grid'].addEventListener('click',()=>setViewStyle('grid'));
ui['view-list'].addEventListener('click',()=>setViewStyle('list'));
let pullStartY=null,pullDistance=0;
function resetPull(){pullStartY=null;pullDistance=0;ui['pull-refresh'].dataset.active='false';ui['pull-refresh'].textContent='משכו למטה לרענון';}
document.addEventListener('touchstart',event=>{
  if(loading||playback||window.scrollY>0||event.touches.length!==1||event.target.closest('input,select,button,textarea'))return;
  pullStartY=event.touches[0].clientY;pullDistance=0;
},{passive:true});
document.addEventListener('touchmove',event=>{
  if(pullStartY===null||event.touches.length!==1)return;
  pullDistance=Math.max(0,Math.min(110,event.touches[0].clientY-pullStartY));
  if(pullDistance>12){ui['pull-refresh'].dataset.active='true';ui['pull-refresh'].textContent=pullDistance>=70?'שחררו כדי לרענן':'משכו למטה לרענון';}
},{passive:true});
document.addEventListener('touchend',()=>{
  const refresh=pullStartY!==null&&pullDistance>=70&&!loading&&!playback&&window.scrollY<=0;
  if(!refresh){resetPull();return;}
  pullStartY=null;pullDistance=0;ui['pull-refresh'].dataset.active='true';ui['pull-refresh'].dataset.loading='true';ui['pull-refresh'].textContent='מרענן…';
  Promise.resolve(loadApp({forceCatalog:true,trigger:'pull-to-refresh'})).finally(()=>{delete ui['pull-refresh'].dataset.loading;resetPull();});
},{passive:true});
ui.more.addEventListener('click', loadMoreVideos);
ui['status-retry'].addEventListener('click',()=>{if(!loading&&!paginationBusy){
  authorizationRetryAttempts=0;loadApp({trigger:'error-retry'});
}});
ui.back.addEventListener('click', () => closePlayer());
window.addEventListener('popstate', () => closePlayer(true));
ui['next-player'].addEventListener('click', () => {
  if(!playback || playback.appPrompt)return;
  const media=ui['media-host'].children[0],base=playback.instances[playback.index-1],id=playback.video.id;
  if(media && Number.isFinite(media.currentTime) && media.currentTime)playback.resumeTime=media.currentTime;
  // User-reported failure applies to this video, never every video on the host.
  if(base){providers.removeCachedData('compatibility:'+base+id);providers.markResourceFailure(base,'/embed/'+id);providers.record({kind:'playback',provider:base,videoId:id,outcome:'user-requested-alternative'});}
  playback.deadline=Date.now()+SETTINGS.playerBudgetMs;tryPlayer();
});
ui['retry-video'].addEventListener('click', () => {
  if (playback && playback.appPrompt) {launchNativeApp();return;}
  if (playback) {
    const id=playback.video.id;
    // An explicit tap permits one new bounded round, including authorization
    // metadata and the native route, rather than reusing a known failed embed.
    providers.resetHealth();
    for(const path of ['/native/','/embed/','/api/v1/videos/'])providers.clearResourceFailures(path+id);
    for(const base of INVIDIOUS_INSTANCES)providers.removeCachedData('compatibility:'+base+id);
    playback.instances=providers.getHealthyProviders('playback','/embed/'+id);playback.index=0;playback.deadline=Date.now()+SETTINGS.playerBudgetMs;tryPlayer();
  }
});
document.addEventListener('keydown', event => {
  if (ui.player.hidden) return;
  if (event.key === 'Escape') { event.preventDefault(); closePlayer(); }
  if (event.key === 'Tab') {
    const controls = [...ui.player.querySelectorAll('button,video,iframe')].filter(el => !el.hidden && !el.closest('[hidden]'));
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; ui.install.hidden = false; });
ui.install.addEventListener('click', async () => {
  if (!installPrompt) return;
  try { await installPrompt.prompt(); await installPrompt.userChoice; } catch (_) { /* Use Chrome's install menu if necessary. */ }
  installPrompt = null; ui.install.hidden = true;
});
window.addEventListener('appinstalled', () => { installPrompt = null; ui.install.hidden = true; });
window.addEventListener('offline', () => {failClosedAuthorization('אין חיבור כרגע. הרשימה מוסתרת עד שאפשר יהיה לאמת מחדש את אישורי ההורה.');audit();});
window.addEventListener('online', () => {clearTimeout(catalogRetryTimer);catalogRetryTimer=null;catalogRetryPending=false;catalogRetryAttempts=0;authorizationRetryAttempts=0;providers.resetHealth();if(loading){pendingOnlineRefresh=true;return;}loadApp({trigger:'online'});});
document.addEventListener('visibilitychange', () => {
  if(document.hidden||navigator.onLine===false)return;
  if(catalogRetryPending&&!loading&&!paginationBusy&&!playback){
    catalogRetryPending=false;catalogMetrics.retries++;
    if(approvalMarker&&displayed.size)retryCatalogContents();else loadApp({forceCatalog:true,trigger:'foreground-deferred-retry'});
    return;
  }
  if(Date.now()-lastLoad>SETTINGS.refreshOnReturnMs){loadApp({trigger:'foreground-stale'});return;}
  if(!PARENT_CATALOG&&!NATIVE_MODE)providers.healthCheck().then(audit);
  checkAuthorizationFreshness('foreground');
});
if (history.state && history.state.kidsYoutubePlayer) history.replaceState(null, '', location.href);
loadApp({trigger:'startup'});

if (typeof setInterval === 'function' && !PARENT_CATALOG) {
  if(!NATIVE_MODE)setInterval(() => {if (!document.hidden && !playback && !loading && navigator.onLine !== false) providers.healthCheck().then(audit);},120000);
  setInterval(()=>checkAuthorizationFreshness('poll'),SETTINGS.authorizationRefreshMs);
}
