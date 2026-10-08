// Build a separate test-only PWA. Never deploy or write to production.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const production='https://jxhelpxhrmwvzrrfrjuh.supabase.co/functions/v1/kids-youtube';
function validate(url){
  if(typeof url!=='string'||!/^https:\/\/[a-z0-9-]+\.supabase\.co\/functions\/v1\/kids-youtube(?:-staging)?$/.test(url)||url===production)
    throw Error('STAGING_BACKEND_URL must use a distinct HTTPS staging function/project URL');
  return url;
}
function build(url=process.env.STAGING_BACKEND_URL,out=path.join(root,'staging-dist')){
  url=validate(url);
  fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out,{recursive:true});
  const files=['index.html','app.js','providers.js','parents.html','parents.js','parent-links.js','sw.js','manifest.json'];
  const productionHost=new URL(production).hostname,stageHost=new URL(url).hostname;
  for(const name of files){
    let text=fs.readFileSync(path.join(root,name),'utf8');
    text=text.replaceAll(production,url).replaceAll(productionHost,stageHost);
    // Github Pages sites can share a host but NEVER the production cookies,
    // remembered parent token, preferences or cached metadata storage keys.
    text=text.replaceAll('kidsParentToken','kidsStagingParentToken');
    text=text.replaceAll('kidsYoutube','kidsStagingYoutube');
    text=text.replaceAll('kids-youtube-shell:','kids-youtube-staging-shell:');
    text=text.replaceAll('kids-youtube-images:','kids-youtube-staging-images:');
    if(name==='manifest.json'){
      const manifest=JSON.parse(text);manifest.name+=' — בדיקה';manifest.short_name+=' בדיקה';
      text=JSON.stringify(manifest,null,2);
    }
    if(text.includes(production))
      throw Error('Production backend remains in staging file '+name);
    fs.writeFileSync(path.join(out,name),text);
  }
  fs.cpSync(path.join(root,'icons'),path.join(out,'icons'),{recursive:true});
  fs.writeFileSync(path.join(out,'build.json'),JSON.stringify({
    candidateSha:process.env.KIDS_BUILD_SHA||'local',backendHost:stageHost,
    staging:true
  },null,2));
  return out;
}
if(require.main===module){build();console.log('Staging assets generated, not deployed');}
module.exports={build,validate};
