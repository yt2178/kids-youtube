const fs=require('node:fs'),path=require('node:path');
const out=path.resolve(__dirname,'..','staging-dist');
fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,'index.html'),'<!doctype html><meta charset="utf-8"><title>Removed</title><main dir="rtl"><h1>סביבת הבדיקה הוסרה</h1><p>יש להשתמש באתר הרגיל.</p></main>');
console.log('staging removed tombstone');
