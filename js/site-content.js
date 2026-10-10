// Public website content. Existing HTML remains a fallback if settings cannot load.
window.SiteContent = (() => {
  const galleryCategories = { common:'Common', ac_hall:'AC Hall', non_ac_hall:'Non-AC Hall', lawn:'Party Hall / Lawn', pool:'Swimming Pool', badminton:'Badminton' };
  const galleryLimit = 48;
  const slots = {
    logo: ['Site logo', 'images/peedspark-logo.jpg'],
    home_hero: ['Homepage hero', 'images/lawn1.jpeg'],
    clubhouse_hero: ['Club House hero', 'images/frontview2.jpeg'],
    pool_hero: ['Pool hero', 'images/swimmingpool3.jpeg'],
    badminton_hero: ['Badminton hero', 'images/badminton2.jpeg'],
    ac_hall_hero: ['AC Hall hero', 'images/hall1.jpeg'],
    non_ac_hall_hero: ['Non-AC Hall hero', 'images/Non-ACHall.jpeg'],
    lawn_hero: ['Party Lawn hero', 'images/lawn1.jpeg'],
    parking: ['Parking photo', 'images/parking.jpeg'],
    coaching: ['Coaching photo', 'images/swimmingpool2.jpeg'],
    clubhouse_banner: ['Club House name banner', 'images/ls-park-banner.png'],
    enquiry_banner: ['Desktop enquiry banner', 'images/enquiry-banner-aqua.png'],
  };
  const defaults = {
    phones: ['+919846718106', '+919946440088'], emails: ['peedspark@gmail.com', 'lsparkclubhouse@gmail.com'], whatsapp: '919846718106',
    announcement: { enabled:false, imageOnly:false, title:'', message:'', scope:'home', start:'', end:'', buttonLabel:'', buttonUrl:'', image:null },
    facilityWhatsapp: { halls: '', pool: '', badminton: '' },
    images: Object.fromEntries(Object.entries(slots).map(([key, value]) => [key, { src: value[1], alt: value[0] }])),
    gallery: [['hall2.jpeg','Hall entrance set up for an event'],['lawn1.jpeg','L’s Park party lawn'],['swimmingpool1.jpeg','L’s Park swimming pool'],['badminton.jpeg','Badminton court building'],['warmup.jpeg','Badminton warm-up area'],['baby.jpeg','Baby pool'],['garden1.jpeg','L’s Park garden']].map(([file,alt]) => ({src: 'images/' + file, alt})),
  };
  let current = merge(defaults);
  function safeImage(src) {
    if (typeof src !== 'string') return false;
    if (/^images\/[a-zA-Z0-9 _.-]+\.(png|jpe?g|webp)$/i.test(src)) return true;
    try {
      const url = new URL(src), base = new URL(window.CONFIG.SUPABASE_URL);
      return url.protocol === 'https:' && url.origin === base.origin && url.pathname.startsWith('/storage/v1/object/public/website-images/') && !url.search && !url.hash;
    } catch { return false; }
  }
  function validate(data) {
    if (!data || !Array.isArray(data.phones) || data.phones.length !== 2 || data.phones.some(x => !/^\+[1-9]\d{7,14}$/.test(x))) throw Error('Enter both phone numbers with country code, for example +919846718106.');
    if (!Array.isArray(data.emails) || data.emails.length !== 2 || data.emails.some(x => !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(x))) throw Error('Enter two valid email addresses.');
    if (!/^[1-9]\d{7,14}$/.test(data.whatsapp)) throw Error('Enter a WhatsApp number including country code.');
    for (const group of ['halls','pool','badminton']) if (data.facilityWhatsapp?.[group] && !/^[1-9]\d{7,14}$/.test(data.facilityWhatsapp[group])) throw Error('Enter a valid facility WhatsApp number including country code.');
    validateAnnouncement(data.announcement);
    if (!Array.isArray(data.gallery) || data.gallery.length < 1 || data.gallery.length > galleryLimit) throw Error(`Use between 1 and ${galleryLimit} gallery photos.`);
    for(const item of data.gallery) if(!Array.isArray(item.tags) || !item.tags.length || item.tags.some(tag=>!Object.hasOwn(galleryCategories,tag)) || new Set(item.tags).size!==item.tags.length) throw Error('Choose at least one valid category for each gallery photo.');
    for (const key of Object.keys(slots)) if (!data.images?.[key]) throw Error('A website photo is missing.');
    for (const item of [...Object.values(data.images), ...data.gallery]) if (!safeImage(item.src) || typeof item.alt !== 'string' || !item.alt.trim() || item.alt.length > 250) throw Error('Each image needs a valid photo and a description of up to 250 characters.');
    return data;
  }
  function merge(data) { return { ...structuredClone(defaults), ...data, gallery:(data?.gallery || defaults.gallery).map(item=>({...item,tags:item.tags===undefined ? ['common'] : item.tags})), announcement: { ...defaults.announcement, ...data?.announcement }, facilityWhatsapp: { ...defaults.facilityWhatsapp, ...data?.facilityWhatsapp }, images: { ...structuredClone(defaults.images), ...data?.images } }; }
  function renderGallery() {
    const root=document.getElementById('gallery'), cylinder=root?.querySelector('.cylinder');if(!cylinder)return;
    root.querySelector('.gallery-controls')?.remove();
    const controls=document.createElement('div');controls.className='gallery-controls container';
    const label=document.createElement('label');label.textContent='Show photos: ';
    const select=document.createElement('select');select.setAttribute('aria-label','Gallery category');
    for(const [value,text] of [['all','All photos'],...Object.entries(galleryCategories)]){const option=document.createElement('option');option.value=value;option.textContent=text;select.append(option);}label.append(select);
    const previous=document.createElement('button');previous.type='button';previous.textContent='Previous set';
    const next=document.createElement('button');next.type='button';next.textContent='Next set';
    const status=document.createElement('span');status.setAttribute('role','status');controls.append(label,previous,status,next);root.querySelector('.gallery-wrap').before(controls);
    let page=0;
    function draw(){
      const photos=current.gallery.filter(item=>select.value==='all'||item.tags.includes(select.value));
      const pages=Math.ceil(photos.length/8);page=Math.min(page,Math.max(0,pages-1));
      const visible=photos.slice(page*8,page*8+8);
      cylinder.replaceChildren(...visible.map((item,index)=>{const button=document.createElement('button');button.type='button';button.className='photo';button.setAttribute('aria-label','View larger photo: '+item.alt);button.style.transform=`rotateY(${index*360/visible.length}deg) translateZ(290px)`;const img=document.createElement('img');img.src=item.src;img.alt=item.alt;img.loading='lazy';button.append(img);return button;}));
      cylinder.classList.toggle('gallery-single',visible.length===1);
      previous.disabled=page===0;next.disabled=page>=pages-1;previous.hidden=next.hidden=pages<=1;
      status.textContent=photos.length ? `${page*8+1}–${page*8+visible.length} of ${photos.length} photos` : 'No photos in this category yet.';
      document.dispatchEvent(new Event('galleryupdated'));
    }
    select.onchange=()=>{page=0;draw();};previous.onclick=()=>{page--;draw();};next.onclick=()=>{page++;draw();};draw();
  }
  function safeLink(value) {
    if (typeof value !== 'string' || /[\\\x00-\x20]/.test(value)) return false;
    if (/^\/(?!\/)/.test(value) || /^[a-z][a-z0-9-]*\.html(?:[?#].*)?$/i.test(value)) return true;
    try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
  }
  function validateAnnouncement(a) {
    if (!a) return;
    if (typeof a.enabled !== 'boolean' || !['home','all'].includes(a.scope)) throw Error('Choose where to show the announcement.');
    for (const [key,max] of [['title',120],['message',800],['buttonLabel',60],['buttonUrl',2048]]) if (typeof a[key] !== 'string' || a[key].length > max) throw Error('Announcement text is too long or invalid.');
    if (typeof a.imageOnly !== 'boolean') throw Error('Choose a valid banner display mode.');
    if (a.enabled && a.imageOnly && !a.image) throw Error('Upload an image for the image-only banner.');
    if (a.enabled && !a.imageOnly && !a.title.trim()) throw Error('Enter an announcement title before showing it.');
    for (const key of ['start','end']) if (a[key] && (!/^\d{4}-\d{2}-\d{2}$/.test(a[key]) || !Number.isFinite(Date.parse(a[key])) || new Date(a[key]).toISOString().slice(0,10) !== a[key])) throw Error('Enter valid announcement dates.');
    if (a.start && a.end && a.end < a.start) throw Error('Announcement end date must be on or after the start date.');
    if (!!a.buttonLabel.trim() !== !!a.buttonUrl.trim() || (a.buttonUrl && !safeLink(a.buttonUrl))) throw Error('Enter both a button label and a safe HTTPS or website link.');
    if (a.image && (!safeImage(a.image.src) || typeof a.image.alt !== 'string' || !a.image.alt.trim() || a.image.alt.length > 250)) throw Error('Add a valid announcement image description.');
  }
  function announcementActive(a, date = new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'})) {
    return !!a?.enabled && (!a.start || date >= a.start) && (!a.end || date <= a.end);
  }
  function announcementElement(a, isPreview = false) {
    const section=document.createElement('section'); section.className='site-announcement'; section.setAttribute('aria-label','Announcements and events');
    const inner=document.createElement('div'); inner.className='container announcement-inner';
    if(a.imageOnly) {
      section.classList.add('announcement-image-only');
      const content=document.createElement('div');content.className='announcement-image-content';
      const tag=document.createElement('span');tag.className='announcement-tag';tag.textContent='WHAT’S HAPPENING';content.append(tag);
      if(a.image) { const img=document.createElement('img');img.src=isPreview && a.image.src.startsWith('images/') ? '../'+a.image.src : a.image.src;img.alt=a.image.alt;content.append(img); }
      inner.append(content);section.append(inner);return section;
    }
    if(a.image) { const img=document.createElement('img'); img.src=isPreview && a.image.src.startsWith('images/') ? '../'+a.image.src : a.image.src; img.alt=a.image.alt; inner.append(img); }
    const text=document.createElement('div');text.className='announcement-text';
    const tag=document.createElement('span');tag.className='announcement-tag';tag.textContent='WHAT’S HAPPENING';
    const title=document.createElement('h2');title.textContent=a.title;
    const message=document.createElement('p');message.textContent=a.message;text.append(tag,title,message);
    if(a.buttonLabel && safeLink(a.buttonUrl)) { const link=document.createElement('a'); link.className='btn btn-primary';link.textContent=a.buttonLabel;link.href=isPreview && /^[a-z][a-z0-9-]*\.html/i.test(a.buttonUrl) ? '../'+a.buttonUrl : a.buttonUrl; text.append(link); }
    inner.append(text);section.append(inner);return section;
  }
  function renderAnnouncement() {
    document.getElementById('siteAnnouncement')?.remove();
    if(location.pathname.includes('/admin-v2/')) return;
    const a=current.announcement;
    if(!announcementActive(a) || (a.scope==='home' && !['/','/index.html'].includes(location.pathname) && !location.pathname.endsWith('/index.html'))) return;
    const header=document.querySelector('.site-header');if(!header) return;
    const section=announcementElement(a);section.id='siteAnnouncement';header.after(section);
  }
  function whatsappFor(facility) {
    const group = ['ac_hall','non_ac_hall','lawn'].includes(facility) ? 'halls' : facility === 'pool' ? 'pool' : ['badminton_1','badminton_2'].includes(facility) ? 'badminton' : null;
    return current.facilityWhatsapp?.[group] || current.whatsapp;
  }
  function phoneText(number) { return number.startsWith('+91') && number.length === 13 ? number.slice(3,8) + ' ' + number.slice(8) : number; }
  function apply(data) {
    current = validate(merge(data));
    document.querySelectorAll('[data-content-image]').forEach(el => {
      const item = current.images[el.dataset.contentImage];
      if (!item) return;
      if (el.tagName === 'IMG') { el.src = item.src; el.alt = item.alt; }
      else el.style.backgroundImage = `url("${encodeURI(item.src)}")`;
    });
    document.querySelectorAll('[data-contact-phone]').forEach(a => {
      const i = Number(a.dataset.contactPhone); a.href = 'tel:' + current.phones[i];
      if (a.dataset.contactLabel === 'number') a.textContent = '📞 ' + phoneText(current.phones[i]);
    });
    document.querySelectorAll('[data-facility-whatsapp], [data-whatsapp-number]').forEach(a=>{
      const number=whatsappFor(a.dataset.facilityWhatsapp || a.dataset.whatsappFacility);
      a.href='https://wa.me/'+number;
      a.setAttribute('aria-label','WhatsApp '+phoneText('+'+number));
      const icon=document.createElement('img');icon.src='images/whatsapp.svg';icon.alt='';icon.className='whatsapp-icon';
      const label=document.createElement('span');label.textContent=phoneText('+'+number);
      if(a.hasAttribute('data-whatsapp-icon-only')) a.replaceChildren(icon);
      else a.replaceChildren(icon,label);
    });
    document.querySelectorAll('[data-contact-email]').forEach(a => { const value = current.emails[Number(a.dataset.contactEmail)]; a.href = 'mailto:' + value; a.textContent = value; });
    document.querySelectorAll('a[href*="wa.me/"]').forEach(a => { const url = new URL(a.href); url.pathname = '/' + whatsappFor(a.dataset.whatsappFacility || (a.classList.contains('whatsapp-float') ? window.FACILITY_PAGE_CONFIG?.facilities?.[0]?.id : null)); a.href = url.href; });
    renderAnnouncement();
    renderGallery();
  }
  async function load() {
    try {
      if (!window.CONFIG?.SUPABASE_URL || !window.CONFIG?.SUPABASE_ANON_KEY) return;
      const response = await fetch(window.CONFIG.SUPABASE_URL + '/rest/v1/website_settings?id=eq.1&select=content', { headers: { apikey: window.CONFIG.SUPABASE_ANON_KEY }, signal: AbortSignal.timeout(8000), cache: 'no-store' });
      if (!response.ok) throw Error('Settings unavailable');
      const rows = await response.json();
      if (rows[0]) apply(rows[0].content);
    } catch (error) { console.warn('Using existing website content:', error.message); }
  }
  const ready = location.pathname.includes('/admin-v2/') ? Promise.resolve() : new Promise(resolve => {
    const start = () => {renderGallery();load().finally(resolve);};
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
  });
  return { galleryCategories, galleryLimit, announcementActive, announcementElement, safeLink, renderAnnouncement, whatsappFor, slots, defaults, merge, validate, safeImage, apply, ready, get current() { return current; } };
})();
