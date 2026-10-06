'use strict';
// Trusted, same-origin bridge. No URL input; only its actual parent can initialize
// it. A new document per attempt permits one immutable, exact-path frame policy.
(function () {
  if (window.parent === window) {document.getElementById('message').textContent='אפשר לבחור סרטון מתוך האפליקציה.';return;}
  let initialized=false;
  window.addEventListener('message',event=>{
    if(initialized || event.source!==window.parent || event.origin!==location.origin || !event.data || event.data.type!=='kids-player-init')return;
    const {provider,videoId,title}=event.data;
    if(!/^[A-Za-z0-9_-]{11}$/.test(videoId) || typeof provider!=='string')return;
    let base;
    try {base=new URL(provider);if(base.protocol!=='https:'||base.origin!==provider||base.username||base.password||base.origin===location.origin)return;} catch(_){return;}
    initialized=true;
    document.addEventListener('securitypolicyviolation',event=>{
      if(event.disposition==='enforce' && event.effectiveDirective==='frame-src')window.parent.postMessage({type:'kids-player-error',videoId},location.origin);
    });
    const embed=new URL('/embed/'+videoId,base);
    const policy=document.createElement('meta');policy.httpEquiv='Content-Security-Policy';policy.content="frame-src "+embed.href+"; object-src 'none'; base-uri 'none'";document.head.append(policy);
    const frame=document.createElement('iframe');frame.id='approved-embed';frame.title=typeof title==='string'?title.slice(0,300):'סרטון מאושר';
    // External origin + exact frame path: no access to this trusted document.
    frame.setAttribute('sandbox','allow-scripts allow-same-origin allow-presentation');
    frame.setAttribute('allow','autoplay; fullscreen; picture-in-picture');frame.referrerPolicy='no-referrer';
    frame.addEventListener('load',()=>window.parent.postMessage({type:'kids-player-ready',videoId},location.origin),{once:true});
    frame.addEventListener('error',()=>window.parent.postMessage({type:'kids-player-error',videoId},location.origin),{once:true});
    embed.search='autoplay=1&related_videos=false&continue=0&comments=false&iv_load_policy=3&quality=dash&local=true';
    frame.src=embed.href;document.body.replaceChildren(frame);
  });
})();
