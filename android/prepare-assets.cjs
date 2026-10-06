// Packaging only: the deployed vanilla PWA remains unchanged.
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..'), target = path.join(__dirname, 'app/build/generated/kidsAssets');
function once(text, needle, replacement) {
  text = text.replace(/\r\n/g,'\n');
  if (text.split(needle).length !== 2) throw new Error('Frontend adapter anchor changed: ' + needle.slice(0,60));
  return text.replace(needle, replacement);
}
function prepare(output = target) {
  fs.mkdirSync(output, {recursive:true});
  let html = fs.readFileSync(path.join(root,'index.html'),'utf8');
  html = once(html, "if ('serviceWorker' in navigator)", "if (false && 'serviceWorker' in navigator)");
  html = once(html, '<script src="./providers.js?v=20261006h" defer></script>', '<script src="./providers.js?v=20261006h" defer></script>\n  <script src="./native-adapter.js" defer></script>');
  let app = fs.readFileSync(path.join(root,'app.js'),'utf8');
  app = once(app, 'const providers = KidsProviders.createManager({instances:INVIDIOUS_INSTANCES, scope:SCOPE, fetcher:fetch, storage:optionalStorage(), timeout:SETTINGS.requestTimeoutMs, budget:SETTINGS.channelBudgetMs});', 'const providers = KidsNative.createManager();');
  app = once(app, 'function openPlayer(id) {\n  const video = displayed.get(id);', "function openPlayer(id) {\n  const video = displayed.get(id);\n  if (video && (getApprovedVideos().has(id) || getApprovedChannels().has(video.channelId))) KidsNative.openPlayer(id);\n  return;\n  // Browser player remains in the source for website regression checks.");
  // No iframe, external scripts, or external document may run in the native WebView.
  html = html.replace('<head>', '<head><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\' \'unsafe-inline\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' https://img.youtube.com https://*.ytimg.com https://*.ggpht.com https://*.googleusercontent.com; connect-src \'self\'; frame-src \'none\'; object-src \'none\'; base-uri \'self\'; form-action \'none\'">');
  fs.copyFileSync(path.join(__dirname,'LICENSE'),path.join(output,'LICENSE.txt'));
  fs.copyFileSync(path.join(__dirname,'THIRD_PARTY_NOTICES.md'),path.join(output,'THIRD_PARTY_NOTICES.txt'));
  fs.writeFileSync(path.join(output,'index.html'), html);
  fs.writeFileSync(path.join(output,'app.js'), app);
  fs.copyFileSync(path.join(__dirname,'native-adapter.js'),path.join(output,'native-adapter.js'));
  fs.copyFileSync(path.join(root,'providers.js'),path.join(output,'providers.js'));
  fs.copyFileSync(path.join(root,'manifest.json'),path.join(output,'manifest.json'));
  fs.cpSync(path.join(root,'icons'),path.join(output,'icons'),{recursive:true});
  fs.mkdirSync(path.join(__dirname,'app/build/generated/kidsRes/mipmap'),{recursive:true});
  fs.copyFileSync(path.join(root,'icons/icon-192.png'),path.join(__dirname,'app/build/generated/kidsRes/mipmap/ic_launcher.png'));
  return {html,app};
}
if (require.main === module) prepare();
module.exports = {prepare,once};
