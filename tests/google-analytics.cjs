const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('js/google-analytics.js', 'utf8');
function run(hostname, pathname='/pool.html') {
  const scripts=[];
  const window={location:{hostname,pathname,origin:'https://'+hostname,search:'?customer=private',hash:'#booking'}};
  const context=vm.createContext({window,document:{createElement:()=>({}),head:{append:script=>scripts.push(script)}}});
  vm.runInContext(source,context);vm.runInContext(source,context);
  return {window,scripts};
}
for(const host of ['peedspark.com','www.peedspark.com']) {
  const {window,scripts}=run(host);
  assert.equal(scripts.length,1);
  assert.equal(scripts[0].src,'https://www.googletagmanager.com/gtag/js?id=G-PMVRG1TGW7');
  assert.equal(scripts[0].async,true);
  const config=window.dataLayer.find(entry=>entry[0]==='config');
  assert.equal(config[1],'G-PMVRG1TGW7');
  assert.equal(config[2].page_location,'https://'+host+'/pool.html');
}
for(const host of ['staging.peedspark.com','localhost','127.0.0.1','chota1business.github.io'])assert.equal(run(host).scripts.length,0);
assert.equal(run('peedspark.com','/admin-v2/bookings.html').scripts.length,0);
for(const file of fs.readdirSync('.').filter(file=>file.endsWith('.html'))) {
  const html=fs.readFileSync(file,'utf8');
  assert.equal((html.match(/src="js\/google-analytics.js/g)||[]).length,1,file);
  assert.ok(html.indexOf('js/google-analytics.js')<html.indexOf('</head>'),file);
}
console.log('PASS: public page coverage, correct GA4 ID, production-only loading, duplicate prevention and clean page URLs.');
