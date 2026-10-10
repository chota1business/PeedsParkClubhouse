const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {chromium} = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/tincy/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(fs.readFileSync(file));}catch{res.writeHead(404).end();}});
function mock(role) {
  window.CONFIG={SUPABASE_URL:'https://example.supabase.co',SUPABASE_ANON_KEY:'test-public'};
  window.published=[];window.uploads=[];window.tablesRead=[];window.version=1;
  window.supabase={createClient:()=>({
    rpc:async()=>({data:[],error:null}),
    auth:{getSession:async()=>({data:{session:{user:{id:'test-admin'}}}}),getUser:async()=>({data:{user:{id:'test-admin'}}}),signOut:async()=>({})},
    storage:{from:()=>({upload:async(path,blob)=>{window.uploads.push({path,type:blob.type,size:blob.size});return {error:null};},getPublicUrl:path=>({data:{publicUrl:'https://example.supabase.co/storage/v1/object/public/website-images/'+path}})})},
    from(table){window.tablesRead.push(table);let update=null;const q={select(){return q;},eq(){return q;},order(){return q;},limit(){return q;},single(){return q;},maybeSingle(){return q;},update(data){update=data;return q;},then(resolve){if(update){if(window.failPublish)return Promise.resolve({error:{message:'Conflict'},data:null}).then(resolve);window.published.push(update.content);window.version++;return Promise.resolve({data:{version:window.version},error:null}).then(resolve);}return Promise.resolve({data:table==='staff'?{id:'test-admin',role,active:true,full_name:'Test Admin'}:table==='website_settings'?{version:window.version,content:{}}:[],error:null}).then(resolve);}};return q;}
  })};
}
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch();const base='http://127.0.0.1:'+server.address().port;try{
  async function pageFor(role){const page=await browser.newPage();await page.route('**/config.js',r=>r.fulfill({body:'',contentType:'text/javascript'}));await page.route(/^https:\/\//,r=>r.fulfill({body:'',contentType:'text/javascript'}));await page.addInitScript(mock,role);return page;}
  const page=await pageFor('admin');const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/admin-v2/website-settings.html');await page.locator('#settingsEditor:not([disabled])').waitFor();
  await page.locator('[name=whatsapp_halls]').fill('919000000011');await page.locator('[name=whatsapp_pool]').fill('919000000022');await page.locator('[name=whatsapp_badminton]').fill('919000000033');
  await page.locator('[name=announcement_enabled]').check();await page.locator('[name=announcement_title]').fill('Swimming coaching registrations open');await page.locator('[name=announcement_message]').fill('Join our new weekend sessions.');await page.locator('[name=announcement_buttonLabel]').fill('Contact Pool');await page.locator('[name=announcement_buttonUrl]').fill('https://wa.me/919000000022');
  await page.locator('[name=phone1]').fill('+919000000001');await page.locator('[name=email1]').fill('office@example.com');
  await page.locator('#settingsGallery .settings-photo').first().getByRole('button',{name:'Move down'}).click();
  const expected=await page.locator('#settingsGallery .settings-photo').first().getByLabel('Image description').inputValue();assert.equal(expected,'L’s Park party lawn');
  await page.locator('#settingsGallery .settings-photo').first().getByLabel('Swimming Pool',{exact:true}).check();
  await page.getByRole('button',{name:'Preview changes',exact:true}).click();await page.locator('#settingsPreview').waitFor({state:'visible'});assert.equal(await page.evaluate(()=>published.length),0);assert.match(await page.locator('#previewContent').innerText(),/office@example.com/);
  await page.getByRole('button',{name:'Publish changes',exact:true}).click();await page.getByText('Published successfully.',{exact:false}).waitFor();assert.equal(await page.evaluate(()=>published[0].phones[0]),'+919000000001');
  assert.equal(await page.evaluate(()=>published[0].announcement.title),'Swimming coaching registrations open');
  assert.deepEqual(await page.evaluate(()=>published[0].gallery[0].tags),['common','pool']);
  const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=200;c.height=100;c.getContext('2d').fillRect(0,0,200,100);return c.toDataURL('image/png').split(',')[1];});
  await page.locator('#settingsImages input[type=file]').first().setInputFiles({name:'photo.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});await page.getByText('Photo ready.',{exact:false}).waitFor();assert.equal(await page.evaluate(()=>uploads[0].type),'image/webp');assert.equal(await page.evaluate(()=>published.length),1);
  await page.locator('#settingsImages input[type=file]').first().setInputFiles({name:'bad.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg/>')});await page.getByText('Choose a JPG, PNG or WebP', {exact:false}).waitFor();assert.equal(await page.evaluate(()=>uploads.length),1);
  await page.getByRole('button',{name:'Preview changes',exact:true}).click();await page.evaluate(()=>window.failPublish=true);await page.getByRole('button',{name:'Publish changes',exact:true}).click();await page.getByText('Publish failed.',{exact:false}).waitFor();assert.equal(await page.locator('#settingsPreview').isVisible(),true);assert.equal(await page.evaluate(()=>published.length),1);
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const content=await page.evaluate(()=>published[0]);await page.close();
  for(const role of ['manager','pool_manager']){const denied=await pageFor(role);await denied.goto(base+'/admin-v2/website-settings.html');if(role==='manager')await denied.locator('#notAuthorised').waitFor({state:'visible'});else await denied.waitForURL('**/hourly-bookings.html?facility=pool');assert.ok(!await denied.evaluate(()=>tablesRead.includes('website_settings')));await denied.close();}
  const publicPage=await pageFor('admin');publicPage.on('pageerror',e=>errors.push(e.message));await publicPage.route('https://example.supabase.co/rest/v1/website_settings**',r=>r.fulfill({json:[{content}]}));await publicPage.goto(base+'/index.html');await publicPage.evaluate(()=>SiteContent.ready);assert.equal(await publicPage.locator('[data-contact-phone="0"]').first().getAttribute('href'),'tel:+919000000001');assert.equal(await publicPage.locator('[data-contact-email="0"]').first().innerText(),'office@example.com');assert.equal(await publicPage.locator('#gallery .photo img').first().getAttribute('alt'),'L’s Park party lawn');assert.equal(await publicPage.locator('#siteAnnouncement h2').innerText(),'Swimming coaching registrations open');assert.equal(await publicPage.locator('#siteAnnouncement a').getAttribute('href'),'https://wa.me/919000000022');await publicPage.locator('#gallery .photo').first().click({force:true});assert.equal(await publicPage.locator('.lightbox-overlay img').getAttribute('alt'),'L’s Park party lawn');
  for(const file of ['club-house.html','pool.html','badminton.html','ac-hall.html','non-ac-hall.html','lawn.html','privacy-policy.html']){await publicPage.goto(base+'/'+file);await publicPage.evaluate(()=>SiteContent.ready);assert.equal(await publicPage.locator('[data-contact-email="0"]').first().innerText(),'office@example.com');}
  for (const [file,id,number] of [['ac-hall.html','ac_hall','919000000011'],['non-ac-hall.html','non_ac_hall','919000000011'],['lawn.html','lawn','919000000011'],['pool.html','pool','919000000022'],['badminton.html','badminton_2','919000000033']]) {
    await publicPage.goto(base+'/'+file);await publicPage.evaluate(()=>SiteContent.ready);
    assert.equal(await publicPage.locator('.whatsapp-float').count(),0);
    assert.equal(await publicPage.locator('.hero-actions [data-facility-whatsapp]').getAttribute('href'),'https://wa.me/'+number);
    assert.equal(await publicPage.locator('.hero-actions [data-facility-whatsapp]').innerText(),'');
    assert.ok((await publicPage.locator('.contact-mini [data-facility-whatsapp]').innerText()).trim().length>0);
    assert.equal(await publicPage.evaluate(id=>SiteContent.whatsappFor(id),id),number);
    for(const contact of await publicPage.locator('[data-facility-whatsapp]').all()){
      assert.equal(await contact.getAttribute('href'),'https://wa.me/'+number);
      assert.equal(await contact.locator('img').getAttribute('src'),'images/whatsapp.svg');
      assert.doesNotMatch(await contact.innerText(),/WhatsApp:|💬/);
      assert.ok((await contact.getAttribute('aria-label')).startsWith('WhatsApp '));
    }
    assert.equal(await publicPage.locator('.footer-contact-layout>div').count(),3);
    assert.equal(await publicPage.locator('.footer-contact-layout>div').nth(1).locator('.footer-link').count(),1);
    assert.equal(await publicPage.locator('.footer-contact-layout>div').nth(2).locator('[data-contact-email]').count(),2);
    await publicPage.evaluate(id=>showBookingConfirmation('TEST-123',{facility:id,facilityLabel:'Test facility',date:'2026-10-20',dateLabel:'20 October',humanLabel:'Morning',slot:'morning'}),id);
    assert.ok((await publicPage.locator('#bookingConfirmation a.btn-primary').getAttribute('href')).startsWith('https://wa.me/'+number+'?text='));
  }
  assert.equal(await publicPage.evaluate(()=>SiteContent.whatsappFor(null)),content.whatsapp);
  assert.equal(await publicPage.locator('#siteAnnouncement').count(),0);
  await publicPage.evaluate(()=>SiteContent.apply({...SiteContent.current,announcement:{...SiteContent.current.announcement,scope:'all'}}));assert.equal(await publicPage.locator('#siteAnnouncement').count(),1);
  await publicPage.setViewportSize({width:390,height:844});assert.ok(await publicPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await publicPage.evaluate(()=>SiteContent.apply({...SiteContent.current,announcement:{...SiteContent.current.announcement,enabled:false}}));assert.equal(await publicPage.locator('#siteAnnouncement').count(),0);
  assert.equal(await publicPage.evaluate(()=>SiteContent.announcementActive({enabled:true,start:'2026-10-10',end:'2026-10-10'},'2026-10-10')),true);
  assert.equal(await publicPage.evaluate(()=>SiteContent.announcementActive({enabled:true,start:'2026-10-11'},'2026-10-10')),false);
  assert.equal(await publicPage.evaluate(()=>SiteContent.announcementActive({enabled:true,end:'2026-10-09'},'2026-10-10')),false);
  await publicPage.evaluate(()=>SiteContent.apply({...SiteContent.current,announcement:{...SiteContent.current.announcement,enabled:true,imageOnly:true,title:'',scope:'all',image:{src:'images/lawn1.jpeg',alt:'Event poster'}}}));
  assert.equal(await publicPage.locator('#siteAnnouncement img').getAttribute('alt'),'Event poster');assert.equal(await publicPage.locator('#siteAnnouncement h2').count(),0);assert.equal(await publicPage.locator('#siteAnnouncement a').count(),0);
  const bannerImage=publicPage.locator('#siteAnnouncement img');
  await bannerImage.evaluate(img=>img.decode());
  assert.equal(await bannerImage.evaluate(img=>getComputedStyle(img).maxHeight),'none');
  for(const width of [601,768,1024,1440]){
    await publicPage.setViewportSize({width,height:900});
    const size=await bannerImage.evaluate(img=>({width:img.clientWidth,height:img.clientHeight,parentWidth:img.parentElement.clientWidth,ratio:img.naturalWidth/img.naturalHeight,fit:getComputedStyle(img).objectFit,maxHeight:getComputedStyle(img).maxHeight}));
    assert.equal(size.width,size.parentWidth);assert.ok(Math.abs(size.width/size.height-size.ratio)<0.02);assert.equal(size.fit,'contain');assert.equal(size.maxHeight,'none');
    assert.ok(await publicPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  }
  await publicPage.setViewportSize({width:390,height:844});
  assert.equal(await bannerImage.evaluate(img=>getComputedStyle(img).maxHeight),'none');
  assert.equal(await publicPage.evaluate(()=>{try{SiteContent.validate({...SiteContent.current,announcement:{...SiteContent.current.announcement,image:null}});return false;}catch{return true;}}),true);
  await publicPage.evaluate(()=>SiteContent.apply({...SiteContent.current,announcement:{...SiteContent.current.announcement,imageOnly:false,enabled:false}}));
  assert.equal(await publicPage.evaluate(()=>SiteContent.safeLink('javascript:alert(1)')),false);
  assert.equal(await publicPage.evaluate(()=>SiteContent.safeLink('//example.com')),false);
  assert.equal(await publicPage.evaluate(()=>{try{SiteContent.validate({...SiteContent.current,announcement:{...SiteContent.current.announcement,start:'2026-10-11',end:'2026-10-10'}});return false;}catch{return true;}}),true);

  await publicPage.addScriptTag({url:base+'/admin-v2/js/admin-actions.js'});
  const message = await publicPage.evaluate(()=>AdminActions.confirmationLink({customer_name:'Anu & family',phone:'9846718106',facility_id:'pool',booking_code:'PP-123',booking_date:'2026-10-20',start_time:'10:00:00',end_time:'11:00:00'}));
  assert.ok(message.startsWith('https://wa.me/919846718106?text='));assert.match(decodeURIComponent(message),/Anu & family/);assert.match(decodeURIComponent(message),/Swimming Pool/);assert.match(decodeURIComponent(message),/10:00–11:00/);
  assert.equal(await publicPage.evaluate(()=>AdminActions.confirmationLink({phone:'bad'})),null);
  await publicPage.goto(base+'/index.html');await publicPage.evaluate(()=>SiteContent.ready);
  await publicPage.locator('.lightbox-overlay').waitFor({state:'attached'});
  await publicPage.evaluate(()=>SiteContent.apply({...SiteContent.current,gallery:Array.from({length:48},(_,i)=>({src:'images/lawn1.jpeg',alt:'Photo '+(i+1),tags:i%2 ? ['common'] : ['pool','ac_hall']}))}));
  assert.equal(await publicPage.locator('#gallery .photo').count(),8);
  await publicPage.getByRole('button',{name:'Pause gallery',exact:true}).click();assert.equal(await publicPage.locator('.cylinder').evaluate(el=>getComputedStyle(el).animationPlayState),'paused');
  assert.match(await publicPage.locator('.gallery-controls [role=status]').innerText(),/1–8 of 48/);
  for(let i=0;i<5;i++)await publicPage.getByRole('button',{name:'Next set',exact:true}).click();
  assert.match(await publicPage.locator('.gallery-controls [role=status]').innerText(),/41–48 of 48/);
  assert.equal(await publicPage.getByRole('button',{name:'Next set',exact:true}).isDisabled(),true);
  await publicPage.getByLabel('Gallery category').selectOption('pool');
  assert.equal(await publicPage.locator('.cylinder').evaluate(el=>getComputedStyle(el).animationPlayState),'paused');
  assert.match(await publicPage.locator('.gallery-controls [role=status]').innerText(),/1–8 of 24/);
  await publicPage.getByRole('button',{name:'Next set',exact:true}).click();
  await publicPage.locator('#gallery .photo').first().click({force:true});
  assert.equal(await publicPage.locator('.lightbox-overlay img').getAttribute('alt'),'Photo 17');
  await publicPage.getByRole('button',{name:'Next photo',exact:true}).click();
  assert.equal(await publicPage.locator('.lightbox-overlay img').getAttribute('alt'),'Photo 19');
  await publicPage.getByRole('button',{name:'Close',exact:true}).click();
  await publicPage.getByLabel('Gallery category').selectOption('badminton');
  assert.equal(await publicPage.locator('#gallery .photo').count(),0);
  assert.match(await publicPage.locator('.gallery-controls [role=status]').innerText(),/No photos/);
  await publicPage.evaluate(()=>SiteContent.apply({...SiteContent.current,gallery:[{src:'images/lawn1.jpeg',alt:'Single image',tags:['common']}]}));
  assert.equal(await publicPage.locator('.cylinder.gallery-single').count(),1);
  await publicPage.locator('#gallery .photo').click({force:true});assert.equal(await publicPage.locator('.lightbox-overlay img').getAttribute('alt'),'Single image');
  await publicPage.getByRole('button',{name:'Close',exact:true}).click();
  assert.equal(await publicPage.evaluate(()=>{try{SiteContent.validate({...SiteContent.current,gallery:Array(49).fill(SiteContent.current.gallery[0])});return false;}catch{return true;}}),true);
  assert.equal(await publicPage.evaluate(()=>{try{SiteContent.validate({...SiteContent.current,gallery:[{...SiteContent.current.gallery[0],tags:['unknown']}]});return false;}catch{return true;}}),true);
  await publicPage.setViewportSize({width:390,height:844});assert.ok(await publicPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await publicPage.route('https://example.supabase.co/rest/v1/website_settings**',r=>r.fulfill({status:500,body:'unavailable'}));await publicPage.goto(base+'/index.html');await publicPage.evaluate(()=>SiteContent.ready);assert.equal(await publicPage.locator('[data-contact-phone="0"]').first().getAttribute('href'),'tel:+919846718106');await publicPage.close();
  assert.deepEqual(errors,[]);
  console.log('PASS: admin edit/upload/preview/publish/conflict, manager denial, mobile layout, public contacts/gallery/lightbox and failure fallback.');
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
