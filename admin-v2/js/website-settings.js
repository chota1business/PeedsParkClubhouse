// Admin-only editor. Uploads do not change the website until Publish succeeds.
let settingsVersion, draft, preview, dirty = false, busy = false;
const settingsNote = message => { document.getElementById('settingsNote').textContent = message; };
const clone = value => structuredClone(value);
document.addEventListener('DOMContentLoaded', async () => {
  const session = await requireStaffSession();
  if (!session) return;
  if (session.staff.role !== 'admin') { document.getElementById('notAuthorised').hidden = false; return; }
  document.getElementById('staffName').textContent = session.staff.full_name;
  document.getElementById('staffRole').textContent = 'Admin';
  document.getElementById('pageContent').hidden = false;
  try {
    const { data, error } = await supabaseClient.from('website_settings').select('*').eq('id',1).single();
    if (error) throw error;
    settingsVersion = data.version; draft = SiteContent.merge(data.content);
    renderEditor(); await loadHistory(); settingsNote('Edit content, preview it, then publish. Nothing changes on the website until you publish.');
    document.getElementById('settingsEditor').disabled = false;
  } catch(error) { settingsNote('Could not load settings: ' + error.message + '. Reload to try again.'); }
  document.getElementById('settingsForm').addEventListener('submit', event => {
    event.preventDefault();
    if (busy || !draft) return;
    try { readContacts(); preview = clone(SiteContent.validate(draft)); renderPreview(); }
    catch(error) { settingsNote(error.message); }
  });
  document.getElementById('publishSettings').addEventListener('click', publishSettings);
  document.getElementById('cancelPreview').addEventListener('click', () => { document.getElementById('settingsPreview').hidden = true; preview = null; });
  window.addEventListener('beforeunload', event => { if (dirty || busy) { event.preventDefault(); event.returnValue = ''; } });
});
function changed() { dirty = true; preview = null; document.getElementById('settingsPreview').hidden = true; }
function readContacts() {
  const form = document.getElementById('settingsForm');
  draft.phones = [form.elements.phone1.value.trim(),form.elements.phone2.value.trim()];
  draft.emails = [form.elements.email1.value.trim(),form.elements.email2.value.trim()];
  draft.whatsapp = form.elements.whatsapp.value.trim().replace(/^\+/, '');
}
function renderEditor() {
  const form = document.getElementById('settingsForm');
  ['phone1','phone2'].forEach((key,i) => form.elements[key].value = draft.phones[i]);
  ['email1','email2'].forEach((key,i) => form.elements[key].value = draft.emails[i]);
  form.elements.whatsapp.value = draft.whatsapp;
  form.oninput = changed;
  const images = document.getElementById('settingsImages'); images.replaceChildren();
  for (const [key,[label]] of Object.entries(SiteContent.slots)) images.append(imageEditor(draft.images[key],label, null));
  renderGallery();
}
function imageUrl(src) { return src.startsWith('images/') ? '../' + src : src; }
function imageEditor(item,label,index) {
  const card = document.createElement('article'); card.className='settings-photo';
  const title = document.createElement('h4'); title.textContent=label;
  const img = document.createElement('img'); img.src=imageUrl(item.src); img.alt=item.alt;
  const caption = document.createElement('label'); caption.textContent='Image description';
  const input = document.createElement('input'); input.value=item.alt; input.maxLength=250; input.required=true;
  input.addEventListener('input',()=>{ item.alt=input.value; changed(); }); caption.append(input);
  const uploadLabel = document.createElement('label'); uploadLabel.textContent='Replace photo';
  const file = document.createElement('input'); file.type='file'; file.accept='image/jpeg,image/png,image/webp';
  file.addEventListener('change',async()=>{ if (!file.files[0]) return; try { const src=await uploadPhoto(file.files[0]); item.src=src; img.src=src; changed(); settingsNote('Photo ready. Preview and publish to put it on the website.'); } catch(error) { settingsNote(error.message); } finally { file.value=''; } });
  uploadLabel.append(file); card.append(title,img,caption,uploadLabel);
  if (index !== null) {
    const controls=document.createElement('div'); controls.className='settings-actions';
    for (const [text,offset] of [['Move up',-1],['Move down',1]]) {
      const button=document.createElement('button'); button.type='button'; button.textContent=text; button.className='btn btn-outline-dark btn-sm'; button.disabled=index+offset<0 || index+offset>=draft.gallery.length;
      button.addEventListener('click',()=>{ [draft.gallery[index],draft.gallery[index+offset]]=[draft.gallery[index+offset],draft.gallery[index]]; changed(); renderGallery(); }); controls.append(button);
    }
    const remove=document.createElement('button'); remove.type='button'; remove.textContent='Remove'; remove.className='btn btn-outline-dark btn-sm'; remove.disabled=draft.gallery.length===1;
    remove.addEventListener('click',()=>{draft.gallery.splice(index,1);changed();renderGallery();}); controls.append(remove);card.append(controls);
  }
  return card;
}
function renderGallery() {
  document.getElementById('settingsGallery').replaceChildren(...draft.gallery.map((item,i)=>imageEditor(item,`Gallery photo ${i+1}`,i)));
  const add=document.getElementById('addGalleryPhoto'); add.disabled=draft.gallery.length>=12;
  add.onchange=async()=>{ if(!add.files[0])return; try { const src=await uploadPhoto(add.files[0]);draft.gallery.push({src,alt:'New gallery photo'});changed();renderGallery();settingsNote('Photo added. Give it a description before publishing.'); }catch(error){settingsNote(error.message);}finally{add.value='';} };
}
async function uploadPhoto(file) {
  if(busy)throw Error('Wait for the current upload to finish.');
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5*1024*1024)throw Error('Choose a JPG, PNG or WebP image no larger than 5 MB.');
  busy=true; document.getElementById('settingsEditor').disabled=true;settingsNote('Preparing and uploading photo…');
  try {
    const bitmap=await createImageBitmap(file);
    if(bitmap.width<100||bitmap.height<50||bitmap.width*bitmap.height>50000000){bitmap.close();throw Error('Use an image at least 100 × 50 pixels and no more than 50 megapixels.');}
    const scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',.85)); if(!blob)throw Error('Could not process this image.');
    const path=crypto.randomUUID()+'.webp';const {error}=await supabaseClient.storage.from('website-images').upload(path,blob,{contentType:blob.type,upsert:false,cacheControl:'31536000'});if(error)throw error;
    return supabaseClient.storage.from('website-images').getPublicUrl(path).data.publicUrl;
  } finally {busy=false;document.getElementById('settingsEditor').disabled=false;}
}
function renderPreview() {
  const root=document.getElementById('previewContent');root.replaceChildren();
  const contacts=document.createElement('p');contacts.textContent=`Phone: ${preview.phones.join(' / ')} · Email: ${preview.emails.join(' / ')} · WhatsApp: +${preview.whatsapp}`;root.append(contacts);
  const grid=document.createElement('div');grid.className='settings-grid';
  for(const [label,item] of [...Object.entries(SiteContent.slots).map(([key,[label]])=>[label,preview.images[key]]),...preview.gallery.map((item,i)=>['Gallery '+(i+1),item])]){
    const figure=document.createElement('figure');const img=document.createElement('img');img.src=imageUrl(item.src);img.alt=item.alt;const caption=document.createElement('figcaption');caption.textContent=label+' — '+item.alt;figure.append(img,caption);grid.append(figure);
  }
  root.append(grid);document.getElementById('settingsPreview').hidden=false;document.getElementById('settingsPreview').scrollIntoView({block:'start'});
}
async function publishSettings() {
  if(!preview||busy)return;
  busy=true;const button=document.getElementById('publishSettings');button.disabled=true;document.getElementById('settingsEditor').disabled=true;
  try {
    SiteContent.validate(preview);
    const {data,error}=await supabaseClient.from('website_settings').update({content:preview}).eq('id',1).eq('version',settingsVersion).select('version').single();
    if(error)throw Error('Publish failed. Another admin may have published changes; reload before retrying. '+error.message);
    settingsVersion=data.version;dirty=false;draft=clone(preview);preview=null;renderEditor();document.getElementById('settingsPreview').hidden=true;settingsNote('Published successfully. Visitors will see these changes on their next page load.');await loadHistory();
  }catch(error){settingsNote(error.message);}finally{busy=false;button.disabled=false;document.getElementById('settingsEditor').disabled=false;}
}
async function loadHistory() {
  const {data,error}=await supabaseClient.from('website_settings_history').select('version,published_at,actor_id').order('version',{ascending:false}).limit(10);
  const list=document.getElementById('settingsHistory');list.replaceChildren();
  if(error){list.textContent='Could not load publish history.';return;}
  for(const row of data||[]){const li=document.createElement('li');li.textContent=`Version ${row.version} · ${new Date(row.published_at).toLocaleString()} · Admin ${row.actor_id}`;list.append(li);}
  if(!data?.length)list.textContent='No changes published yet.';
}
