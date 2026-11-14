(()=>{'use strict';
const $=id=>document.getElementById(id),pad=n=>String(n).padStart(2,'0'),format=n=>'¥'+Math.abs(n).toLocaleString('ja-JP'),dateKey=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const today=dateKey(new Date()),categories={expense:['食費','外食','日用品','交通費','ガソリン','娯楽','固定費','その他'],income:['給与','臨時収入','その他']};
let cloud=null,db=null,records=[],selected=today,view=new Date(),cloudLoaded=false,localRecords=[],heroData=null,importing=false,heroLoaded=false;
let busy=0,liveStatus='クラウドを読み込み中…',liveKind='info',isCached=false,hasPendingWrites=false;
try{const a=JSON.parse(localStorage.getItem('suehiro-records-v1')||'[]');if(Array.isArray(a))localRecords=a.filter(x=>x&&typeof x.date==='string'&&Number.isFinite(x.amount));}catch{}
function status(s,kind='info'){
  liveStatus=s;liveKind=kind;showStatus();
}
function showStatus(){
  const el=$('cloudStatus');
  if(!navigator.onLine){el.textContent='オフラインです。変更は通信回復後に確認してください';el.dataset.kind='error';return;}
  if(busy>0){el.textContent='クラウドに保存中…';el.dataset.kind='info';return;}
  if(hasPendingWrites){el.textContent='クラウドへの反映を確認中…';el.dataset.kind='info';return;}
  if(isCached&&cloudLoaded){el.textContent='保存済みデータを表示中。通信状態を確認してください';el.dataset.kind='info';return;}
  el.textContent=liveStatus;el.dataset.kind=liveKind;
}
async function withSaving(work,successMessage='クラウドに保存済み'){
  busy++;showStatus();
  try{const result=await work();status(successMessage,'ok');return result;}
  catch(e){status('保存に失敗しました。通信状況を確認して再試行してください。','error');throw e;}
  finally{busy=Math.max(0,busy-1);showStatus();}
}
window.addEventListener('online',showStatus);
window.addEventListener('offline',showStatus);

const sum=(rs,t)=>rs.filter(r=>r.type===t).reduce((n,r)=>n+r.amount,0),monthKey=()=>`${view.getFullYear()}-${pad(view.getMonth()+1)}`;
function openDb(){return new Promise(resolve=>{if(!indexedDB){resolve(null);return;}const r=indexedDB.open('suehiro-kakeibo-photo-v1',1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('photos'))r.result.createObjectStore('photos');};r.onsuccess=()=>resolve(r.result);r.onerror=()=>resolve(null);});}
const localPhoto=key=>new Promise(resolve=>{if(!db)return resolve(null);const r=db.transaction('photos').objectStore('photos').get(key);r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>resolve(null);});
const toData=blob=>new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(blob);});
async function compress(file,max=1000){const image=await createImageBitmap(file);const scale=Math.min(1,max/Math.max(image.width,image.height));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);image.close();for(const quality of [.72,.58,.43,.3]){const b=await new Promise(r=>canvas.toBlob(r,'image/jpeg',quality));if(b&&b.size<340000)return await toData(b);}throw Error('写真の容量が大きすぎます');}
function showHero(data){const img=$('heroImage'),ph=$('heroPlaceholder');if(data){img.src=data;img.hidden=false;ph.hidden=true;ph.style.display='none';}else{img.removeAttribute('src');img.hidden=true;ph.hidden=false;ph.style.display='flex';}}
function render(){const monthly=records.filter(r=>r.date.startsWith(monthKey())),income=sum(monthly,'income'),expense=sum(monthly,'expense');$('summaryMonth').textContent=`${view.getFullYear()}年${view.getMonth()+1}月の家計`;$('incomeSum').textContent=format(income);$('expenseSum').textContent=format(expense);$('balanceSum').textContent=(income-expense>0?'+':income-expense<0?'−':'')+format(income-expense);$('monthTitle').textContent=`${view.getFullYear()}年 ${view.getMonth()+1}月`;renderCalendar();renderRecords();}
function renderCalendar(){const p=$('calendar');p.replaceChildren();['日','月','火','水','木','金','土'].forEach((d,i)=>{const x=document.createElement('div');x.className='weekday'+(i===0?' sun':i===6?' sat':'');x.textContent=d;p.append(x);});const first=new Date(view.getFullYear(),view.getMonth(),1).getDay(),days=new Date(view.getFullYear(),view.getMonth()+1,0).getDate();for(let i=0;i<Math.ceil((first+days)/7)*7;i++){const n=i-first+1,b=document.createElement('button');b.className='day';if(n<1||n>days){b.classList.add('empty');b.disabled=true;}else{const date=monthKey()+'-'+pad(n),daily=records.filter(x=>x.date===date),expense=sum(daily,'expense');if(date===selected)b.classList.add('selected');if(date===today)b.classList.add('today');if(daily.some(x=>x.hasPhoto))b.classList.add('has-photo');const t=document.createElement('span');t.className='day-num';t.textContent=n;b.append(t);if(expense){const s=document.createElement('span');s.className='day-spend';s.textContent='−'+(expense>=10000?Math.round(expense/1000)+'千':expense.toLocaleString());b.append(s);}b.onclick=()=>{selected=date;render();};}p.append(b);}}
async function renderRecords(){const current=selected,p=$('recordList');p.replaceChildren();$('recordsTitle').textContent=`${Number(selected.slice(5,7))}月${Number(selected.slice(8))}日の記録`;const daily=records.filter(r=>r.date===selected).sort((a,b)=>Number(b.id)-Number(a.id));if(!daily.length){const empty=document.createElement('p');empty.className='empty-records';empty.textContent='この日の記録はありません。';p.append(empty);return;}for(const r of daily){const div=document.createElement('div');div.className='record';if(r.hasPhoto){const img=document.createElement('img');img.className='thumb';img.alt='記録写真';cloud.getImage('entry-'+r.id).then(data=>{if(data&&current===selected)img.src=data;}).catch(()=>{});div.append(img);}const info=document.createElement('div');info.className='record-info';const title=document.createElement('div');title.className='record-category';title.textContent=r.category;const memo=document.createElement('div');memo.className='record-memo';memo.textContent=r.memo||'メモなし';info.append(title,memo);const val=document.createElement('div');val.className='record-amount '+r.type;val.textContent=(r.type==='income'?'+':'−')+format(r.amount);const del=document.createElement('button');del.className='delete-btn';del.textContent='×';del.setAttribute('aria-label','記録削除');del.onclick=async()=>{if(!confirm('この記録を削除しますか？'))return;try{await withSaving(async()=>{await cloud.deleteRecord(r.id);if(r.hasPhoto)await cloud.deleteImage('entry-'+r.id);});}catch(e){status('削除に失敗しました。通信を確認してください。','error');}};div.append(info,val,del);p.append(div);}}
function refreshCategories(){const t=document.querySelector('input[name="type"]:checked').value,old=$('entryCategory').value;$('entryCategory').replaceChildren();for(const c of categories[t]){const el=document.createElement('option');el.value=c;el.textContent=c;$('entryCategory').append(el);}if(categories[t].includes(old))$('entryCategory').value=old;}
$('prevMonth').onclick=()=>{view=new Date(view.getFullYear(),view.getMonth()-1,1);selected=monthKey()+'-01';render();};$('nextMonth').onclick=()=>{view=new Date(view.getFullYear(),view.getMonth()+1,1);selected=monthKey()+'-01';render();};
$('addEntry').onclick=()=>{if(!cloudLoaded)return alert('クラウドの読み込み完了後に入力してください。');$('entryForm').reset();$('entryDate').value=selected;$('photoPreview').replaceChildren();refreshCategories();$('entryDialog').showModal();};$('closeDialog').onclick=()=>$('entryDialog').close();document.querySelectorAll('input[name="type"]').forEach(x=>x.onchange=refreshCategories);
$('entryPhoto').onchange=()=>{const file=$('entryPhoto').files[0],p=$('photoPreview');p.replaceChildren();if(file){const img=document.createElement('img'),url=URL.createObjectURL(file);img.src=url;img.onload=()=>URL.revokeObjectURL(url);p.append(img);}};
$('entryForm').onsubmit=async e=>{e.preventDefault();if(!cloudLoaded)return;const b=$('entryForm').querySelector('[type=submit]'),amount=Number($('entryAmount').value),date=$('entryDate').value;if(!Number.isSafeInteger(amount)||amount<=0||amount>1e12||!/^\d{4}-\d{2}-\d{2}$/.test(date))return alert('日付と金額を確認してね。');b.disabled=true;const id=String(Date.now())+String(Math.floor(Math.random()*100000));let hasPhoto=false;try{await withSaving(async()=>{const file=$('entryPhoto').files[0];if(file){await cloud.saveImage('entry-'+id,await compress(file,850));hasPhoto=true;}await cloud.saveRecord({id,date,type:document.querySelector('input[name="type"]:checked').value,category:$('entryCategory').value,memo:$('entryMemo').value.trim(),amount,hasPhoto});});$('entryDialog').close();selected=date;const [yy,mm]=date.split('-').map(Number);view=new Date(yy,mm-1,1);}catch(err){status('保存失敗。記録はまだ確定していません。','error');alert('クラウドに保存できませんでした。通信かFirestoreのルールを確認してください。');}finally{b.disabled=false;}};
$('heroUpload').onchange=async e=>{const file=e.target.files[0];if(!file||!cloudLoaded)return;try{await withSaving(async()=>{const data=await compress(file,1100);await cloud.saveImage('hero',data);},'トップ写真をクラウドに保存済み');}catch(err){status('写真の保存に失敗しました。','error');alert('写真を保存できませんでした。画像を小さくして再試行してください。');}e.target.value='';};
$('exportBtn').onclick=()=>{const blob=new Blob([JSON.stringify({app:'末廣家の家計簿',exported:new Date().toISOString(),records,notice:'写真は含まれません'},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='末廣家の家計簿-'+today+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);alert('文字の記録を保存しました。写真は含まれません。');};
// 移行機能は設定画面にのみ配置。トップには出さない。
const settingsDialog=$('settingsDialog');
$('openSettings').onclick=()=>{updateMigrationCount();updateFamilyDisplay();settingsDialog.showModal();};
$('closeSettings').onclick=$('settingsDone').onclick=()=>settingsDialog.close();
settingsDialog.addEventListener('click',e=>{if(e.target===settingsDialog)settingsDialog.close();});
function updateMigrationCount(){
  const oldIds=new Set(records.map(r=>String(r.id)));
  const missing=localRecords.filter(r=>!oldIds.has(String(r.id)));
  const heroMissing=!heroData;
  $('migrationCount').textContent=`端末の記録 ${localRecords.length}件（未移行 ${missing.length}件）${heroMissing?'・トップ写真も確認可能':'・トップ写真は保存済み'}`;
  $('migrationButton').disabled=!cloudLoaded||importing;
}
async function doImport(){
  if(importing||!cloudLoaded)return;
  const cloudIds=new Set(records.map(r=>String(r.id)));
  const missing=localRecords.filter(r=>!cloudIds.has(String(r.id)));
  const oldHero=heroData?null:await localPhoto('hero');
  if(!missing.length&&!oldHero){status('以前の記録はすべてクラウドに保存済みです','ok');updateMigrationCount();return;}
  const yes=confirm(`未移行の記録${missing.length}件${oldHero?'とトップ写真':''}をクラウドへコピーします。既存の記録とトップ写真は上書きしません。続行しますか？`);
  if(!yes)return;
  importing=true;updateMigrationCount();status('以前の記録と写真をコピー中…');let success=0,failed=0;
  for(const r of missing){
    try{
      let hasPhoto=!!r.hasPhoto;
      if(hasPhoto){const blob=await localPhoto('entry-'+r.id);if(blob){await cloud.importImageIfMissing('entry-'+r.id,await compress(blob,850));}else hasPhoto=false;}
      await cloud.importRecordIfMissing({...r,id:String(r.id),hasPhoto});success++;
    }catch{failed++;}
  }
  if(oldHero){try{await cloud.importImageIfMissing('hero',await compress(oldHero,1100));}catch{failed++;}}
  importing=false;updateMigrationCount();
  status(failed?`移行：${success}件成功、${failed}件失敗。元の記録は保持しています。`:`以前の記録${success}件を引き継ぎました。自動保存は引き続き有効です。`,failed?'error':'ok');
}
$('migrationButton').onclick=doImport;

// 夫婦共有 v4: UIDはアプリ内のみで入力。トップ写真は個人用のまま。
function updateFamilyDisplay(){
  const mode=cloud?.getMode?.()||{shared:false};
  $('familySetup').hidden=!cloud||mode.shared;
  $('familyActive').hidden=!cloud||!mode.shared;
  $('familyMigration').hidden=!cloud||!mode.isOwner;
  $('familyIdSettings').hidden=!cloud||!mode.isOwner;
}
$('createFamily').onclick=async()=>{
  const b=$('createFamily');b.disabled=true;$('familyMessage').textContent='設定中…';
  try{await cloud.createFamily($('spouseUid').value);$('familyMessage').textContent='共有を開始しました。次に下の「以前の記録をコピー」を実行してください。';}
  catch(e){$('familyMessage').textContent=e.message||'設定に失敗しました。';}finally{b.disabled=false;updateFamilyDisplay();}
};
$('joinFamily').onclick=async()=>{
  const b=$('joinFamily');b.disabled=true;$('familyMessage').textContent='確認中…';
  try{await cloud.joinFamily($('ownerUid').value);$('familyMessage').textContent='共有に参加しました。';}
  catch(e){$('familyMessage').textContent=e.message||'参加できませんでした。';}finally{b.disabled=false;updateFamilyDisplay();}
};
$('copyFamilyId').onclick=async()=>{
  try{await navigator.clipboard.writeText(cloud.uid);alert('部長の共有IDをコピーしました。奥さんのアプリで貼り付けてください。');}
  catch{alert('共有IDをコピーできませんでした。Safariで開いて再試行してください。');}
};
$('migrateFamily').onclick=async()=>{
  if(!cloud?.getMode().isOwner)return;
  if(!confirm('部長の個人用クラウド記録を、夫婦共有の保存先へコピーします。元データと個人トップ写真はそのまま残ります。実行しますか？'))return;
  const b=$('migrateFamily');b.disabled=true;$('familyMigrationResult').textContent='コピー中…';
  try{const result=await cloud.migratePersonalToFamily(p=>{$('familyMigrationResult').textContent=`${p.total}件中、コピー${p.copied}件・既存${p.skipped}件・失敗${p.failed}件`;});
    $('familyMigrationResult').textContent=`完了：コピー${result.copied}件、既存${result.skipped}件、失敗${result.failed}件。${result.failed?'失敗した記録を確認し、再実行してください。':'部長の元データは残っています。'}`;
  }catch(e){$('familyMigrationResult').textContent='コピーできませんでした：'+(e.message||'通信を確認してください');}
  finally{b.disabled=false;}
};
window.addEventListener('suehiro-cloud-mode-changed',()=>{
  cloudLoaded=false;records=[];isCached=false;hasPendingWrites=false;render();status('共有データの読み込み中…');updateFamilyDisplay();
});

window.addEventListener('suehiro-cloud-ready',()=>{
  updateFamilyDisplay();
  cloud=window.SuehiroCloud;cloudLoaded=false;heroLoaded=false;heroData=null;status('クラウドを読み込み中…');
  cloud.watchRecords((data,meta)=>{records=data;cloudLoaded=true;isCached=!!meta?.fromCache;hasPendingWrites=!!meta?.hasPendingWrites;render();status('クラウドに接続済み・自動保存','ok');updateMigrationCount();},()=>{cloudLoaded=false;status('読み込みエラー。Firestoreのルールを確認してください。','error');updateMigrationCount();});
  cloud.watchHero(data=>{heroData=data;heroLoaded=true;showHero(data);updateMigrationCount();},()=>status('トップ写真の読み込みに失敗しました。','error'));
});
window.addEventListener('suehiro-cloud-disconnected',()=>{cloud=null;updateFamilyDisplay();cloudLoaded=false;records=[];heroData=null;heroLoaded=false;isCached=false;hasPendingWrites=false;showHero(null);render();status('ログイン待ち');updateMigrationCount();});
(async()=>{db=await openDb();render();if('serviceWorker'in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('./sw.js').catch(()=>{});})();
})();
