const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const expected=fs.mkdtempSync(path.join(os.tmpdir(),'kids-bundle-reference-'));
function files(dir,prefix=''){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(x=>x.isDirectory()?files(path.join(dir,x.name),prefix+x.name+'/'):[prefix+x.name]);}
try{
  require('./prepare-assets.cjs').prepare(expected);
  const actual=path.join(__dirname,'app/build/generated/kidsAssets');
  assert.deepEqual(files(actual).sort(),files(expected).sort());
  for(const file of files(expected))assert.equal(Buffer.compare(fs.readFileSync(path.join(actual,file)),fs.readFileSync(path.join(expected,file))),0,file);
  console.log('Gradle and JS reference produce identical packaged assets');
}finally{fs.rmSync(expected,{recursive:true,force:true});}
