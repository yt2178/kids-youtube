/* SPDX-License-Identifier: GPL-3.0-or-later */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.KidsParentLinks=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const VIDEO=/^[A-Za-z0-9_-]{11}$/, CHANNEL=/^UC[A-Za-z0-9_-]{22}$/;
  function classify(input){
    if(typeof input!=='string'||input.length>4096||!input.trim()||/\s/.test(input.trim()))throw Error('INVALID_LINK');
    let value=input.trim();if(!/^https?:\/\//i.test(value))value='https://'+value;
    const u=new URL(value),host=u.hostname.toLowerCase(),parts=u.pathname.split('/').filter(Boolean);
    if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.port)throw Error('INVALID_LINK');
    let id=null;
    if(host==='youtu.be'){if(parts.length===1)id=parts[0];}
    else if(['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com'].includes(host)){
      if(parts[0]==='watch'&&parts.length===1&&u.searchParams.getAll('v').length===1)id=u.searchParams.get('v');
      else if(['shorts','live','embed'].includes(parts[0])&&parts.length===2)id=parts[1];
      else{
        const tail=['videos','shorts','streams','featured'];
        if(parts[0]==='channel'&&CHANNEL.test(parts[1])&&(parts.length===2||(parts.length===3&&tail.includes(parts[2]))))
          return {kind:'channel',id:parts[1],url:'https://www.youtube.com/channel/'+parts[1],label:parts[1]};
        let alias;
        if(parts[0]?.startsWith('@')&&(parts.length===1||(parts.length===2&&tail.includes(parts[1]))))alias=parts[0];
        if(['c','user'].includes(parts[0])&&parts[1]&&(parts.length===2||(parts.length===3&&tail.includes(parts[2]))))alias=parts[0]+'/'+parts[1];
        if(alias){
          const decoded=decodeURIComponent(alias),name=decoded.startsWith('@')?decoded.slice(1):decoded.split('/')[1];
          if(!/^[\p{L}\p{N}_.-]{1,100}$/u.test(name)||decoded.split('/').length!==alias.split('/').length)throw Error('INVALID_LINK');
          return {kind:'channel',id:null,url:'https://www.youtube.com/'+alias,label:decoded};
        }
      }
    }else throw Error('INVALID_HOST');
    if(!VIDEO.test(id))throw Error('INVALID_LINK');
    return {kind:'video',id,url:'https://www.youtube.com/watch?v='+id,label:'סרטון '+id};
  }
  function share(text){
    if(typeof text!=='string'||text.length>20000)throw Error('INVALID_LINK');
    const found=new Map();
    for(const value of text.match(/https?:\/\/[^\s<>"']+/gi)||[]){
      try{const link=classify(value.replace(/[),;\]]+$/,''));found.set(link.url,link);}catch(_){}
    }
    if(!found.size){const link=classify(text.trim());found.set(link.url,link);}
    if(found.size!==1)throw Error('ONE_LINK_ONLY');
    return [...found.values()][0];
  }
  return {classify,share};
});
