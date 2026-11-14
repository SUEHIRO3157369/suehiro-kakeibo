import {initializeApp} from 'https://www.gstatic.com/firebasejs/13.3.0/firebase-app.js';
import {getAuth,setPersistence,browserLocalPersistence,onAuthStateChanged,signInWithEmailAndPassword,signOut} from 'https://www.gstatic.com/firebasejs/13.3.0/firebase-auth.js';
import {getFirestore,collection,doc,setDoc,getDoc,getDocs,getDocsFromServer,getDocFromServer,deleteDoc,onSnapshot,serverTimestamp,runTransaction} from 'https://www.gstatic.com/firebasejs/13.3.0/firebase-firestore.js';
const config={apiKey:'AIzaSyARnnrDQs0RigPP3xEQDspPjROeMCLVolE',authDomain:'suehiro-kakeibo.firebaseapp.com',projectId:'suehiro-kakeibo',storageBucket:'suehiro-kakeibo.firebasestorage.app',messagingSenderId:'972353857496',appId:'1:972353857496:web:99a0df162600c2504634ad'};
const app=initializeApp(config),auth=getAuth(app),database=getFirestore(app);
const gate=document.getElementById('authGate'),form=document.getElementById('authForm'),message=document.getElementById('authMessage');
let unsubscribe=[],lastBridge=null;
function disconnect(){unsubscribe.forEach(f=>{try{f()}catch{}});unsubscribe=[];lastBridge=null;window.SuehiroCloud=null;window.dispatchEvent(new Event('suehiro-cloud-disconnected'));}
function bridge(user){
  const uid=user.uid,own=(kind,key)=>doc(database,'users',uid,kind,String(key));
  const privateEntries=collection(database,'users',uid,'entries');
  let familyId=null,recordUnsubscribe=null,recordCallback=null,recordError=null;
  const familyDoc=id=>doc(database,'families',id);
  const familyEntries=id=>collection(database,'families',id,'entries');
  const personalMedia=id=>own('media',id);
  const activeEntry=id=>familyId?doc(database,'families',familyId,'entries',String(id)):own('entries',id);
  const activeMedia=id=>familyId?doc(database,'families',familyId,'media',String(id)):own('media',id);
  const metadata=()=>({uid,familyId,isOwner:familyId===uid,shared:!!familyId});
  function announce(){window.dispatchEvent(new CustomEvent('suehiro-cloud-mode-changed',{detail:metadata()}));}
  function restartRecordWatch(){if(recordUnsubscribe){recordUnsubscribe();recordUnsubscribe=null;}if(recordCallback){const col=familyId?familyEntries(familyId):privateEntries;recordUnsubscribe=onSnapshot(col,{includeMetadataChanges:true},q=>recordCallback(q.docs.map(x=>x.data()),{fromCache:q.metadata.fromCache,hasPendingWrites:q.metadata.hasPendingWrites}),recordError);}}
  async function selectFamily(id){familyId=id;restartRecordWatch();announce();}
  const bridgeObject={
    uid, getMode:metadata,
    watchRecords(ok,fail){recordCallback=ok;recordError=fail;restartRecordWatch();return ()=>{if(recordUnsubscribe)recordUnsubscribe();recordUnsubscribe=null;recordCallback=null;};},
    // トップ写真は家族共有を開始しても常に本人専用の領域に保存
    watchHero(ok,fail){const stop=onSnapshot(personalMedia('hero'),s=>ok(s.exists()?s.data().data:null),fail);unsubscribe.push(stop);},
    async saveRecord(record){await setDoc(activeEntry(record.id),{...record,updatedAt:serverTimestamp()});},
    async deleteRecord(id){await deleteDoc(activeEntry(id));},
    async saveImage(id,data){await setDoc(id==='hero'?personalMedia('hero'):activeMedia(id),{data,updatedAt:serverTimestamp()});},
    async getImage(id){const s=await getDoc(id==='hero'?personalMedia('hero'):activeMedia(id));return s.exists()?s.data().data:null;},
    async deleteImage(id){await deleteDoc(id==='hero'?personalMedia('hero'):activeMedia(id));},
    async importRecordIfMissing(record){const target=activeEntry(record.id);return runTransaction(database,async tx=>{const s=await tx.get(target);if(s.exists())return false;tx.set(target,{...record,updatedAt:serverTimestamp()});return true;});},
    async importImageIfMissing(id,data){const target=id==='hero'?personalMedia('hero'):activeMedia(id);return runTransaction(database,async tx=>{const s=await tx.get(target);if(s.exists())return false;tx.set(target,{data,updatedAt:serverTimestamp()});return true;});},
    // バックアップは必ずサーバーから取得。夫婦共通の家計データ＋本人専用トップ写真。
    async exportFullBackup(){
      if(!navigator.onLine)throw Error('オンラインで実行してください。');
      const scope=familyId?collection(database,'families',familyId,'entries'):privateEntries;
      const media=familyId?collection(database,'families',familyId,'media'):collection(database,'users',uid,'media');
      const [entrySnap,mediaSnap,heroSnap]=await Promise.all([
        getDocsFromServer(scope),getDocsFromServer(media),getDocFromServer(personalMedia('hero'))
      ]);
      if(entrySnap.docs.some(d=>d.metadata.hasPendingWrites)||mediaSnap.docs.some(d=>d.metadata.hasPendingWrites))throw Error('保存中の変更があります。少し後に再実行してください。');
      const entries=entrySnap.docs.map(d=>({id:d.id,...d.data(),updatedAt:undefined}));
      const photos={};
      for(const d of mediaSnap.docs){const v=d.data().data;if(d.id!=='hero'&&typeof v==='string'&&v.startsWith('data:image/'))photos[d.id]=v;}
      const hero=heroSnap.exists()&&typeof heroSnap.data().data==='string'?heroSnap.data().data:null;
      return {format:'suehiro-kakeibo-backup',version:1,exportedAt:new Date().toISOString(),
        scope:familyId?'family':'personal',familyId:familyId||null,
        // 本人専用トップ写真はこのバックアップを作成した本人だけに復元可能
        heroOwnerUid:uid,entries,photos,hero};
    },
    async restoreFullBackup(backup,progress){
      if(!navigator.onLine)throw Error('オンラインで実行してください。');
      if(backup.scope!==(familyId?'family':'personal')||(backup.scope==='family'&&backup.familyId!==familyId))
        throw Error('現在の家計簿とバックアップの共有先が異なります。復元できません。');
      let copied=0,skipped=0,failed=0;
      for(const r of backup.entries){
        try{if(await bridgeObject.importRecordIfMissing(r))copied++;else skipped++;}catch(e){failed++;}
        progress?.({copied,skipped,failed});
      }
      let photosCopied=0,photosSkipped=0;
      for(const [id,data] of Object.entries(backup.photos)){
        try{if(await bridgeObject.importImageIfMissing(id,data))photosCopied++;else photosSkipped++;}catch(e){failed++;}
        progress?.({copied,skipped,failed,photosCopied});
      }
      let heroRestored=false;
      if(backup.hero&&backup.heroOwnerUid===uid){
        try{heroRestored=await bridgeObject.importImageIfMissing('hero',backup.hero);}catch(e){failed++;}
      }
      return {copied,skipped,failed,photosCopied,photosSkipped,heroRestored,
        heroSkippedForDifferentUser:!!backup.hero&&backup.heroOwnerUid!==uid};
    },
    async createFamily(spouseUid){
      spouseUid=spouseUid.trim();
      if(!/^[A-Za-z0-9]{10,128}$/.test(spouseUid)||spouseUid===uid)throw Error('奥さんのUIDを確認してください。');
      const target=familyDoc(uid),existing=await getDoc(target);
      if(existing.exists()){if(existing.data().spouseUid!==spouseUid)throw Error('共有先がすでに登録されています。勝手に変更せず確認してください。');}
      else await setDoc(target,{ownerUid:uid,spouseUid,createdAt:serverTimestamp()});
      localStorage.setItem('suehiro-family-id-'+uid,uid);
      await selectFamily(uid);
    },
    async joinFamily(ownerUid){
      ownerUid=ownerUid.trim();if(!/^[A-Za-z0-9]{10,128}$/.test(ownerUid))throw Error('共有IDを確認してください。');
      const s=await getDoc(familyDoc(ownerUid));
      if(!s.exists()||s.data().spouseUid!==uid)throw Error('共有への招待を確認できませんでした。部長側の設定を確認してください。');
      localStorage.setItem('suehiro-family-id-'+uid,ownerUid);await selectFamily(ownerUid);
    },
    // 自分の元データは残したまま、同じIDの記録・写真は上書きせず共有領域へコピー
    async migratePersonalToFamily(progress){
      if(!familyId||familyId!==uid)throw Error('この移行は共有を開始した部長のアカウントで実行してください。');
      const snapshot=await getDocs(privateEntries);let copied=0,skipped=0,failed=0;
      for(const d of snapshot.docs){
        const record=d.data(),id=String(record.id||d.id);
        try{
          if(record.hasPhoto){const photo=await getDoc(personalMedia('entry-'+id));if(photo.exists())await bridgeObject.importImageIfMissing('entry-'+id,photo.data().data);}
          if(await bridgeObject.importRecordIfMissing({...record,id}))copied++;else skipped++;
        }catch(e){failed++;}
        progress?.({copied,skipped,failed,total:snapshot.size});
      }
      return {copied,skipped,failed,total:snapshot.size};
    }
  };
  lastBridge=bridgeObject;window.SuehiroCloud=bridgeObject;
  window.dispatchEvent(new Event('suehiro-cloud-ready'));
  // 家族IDは端末に保持。部長はログイン時に既存の共有設定を再取得する。
  (async()=>{try{
    let id=localStorage.getItem('suehiro-family-id-'+uid);
    if(!id){const s=await getDoc(familyDoc(uid));if(s.exists()&&s.data().ownerUid===uid)id=uid;}
    if(id){const s=await getDoc(familyDoc(id));if(s.exists()&&(s.data().ownerUid===uid||s.data().spouseUid===uid)){
      if(lastBridge===bridgeObject){localStorage.setItem('suehiro-family-id-'+uid,id);await selectFamily(id);}return;
    }}
    if(lastBridge===bridgeObject)announce();
  }catch(e){if(lastBridge===bridgeObject)announce();}})();
  unsubscribe.push(()=>{if(recordUnsubscribe)recordUnsubscribe();});
}
try{await setPersistence(auth,browserLocalPersistence);}catch{message.textContent='ログイン情報の保持に制限があります。Safariの通常タブで開いてください。';}
onAuthStateChanged(auth,user=>{disconnect();if(user){gate.hidden=true;gate.style.display='none';bridge(user);let b=document.getElementById('logoutButton');if(!b){b=document.createElement('button');b.id='logoutButton';b.type='button';b.textContent='ログアウト';b.style.cssText='font-size:12px;background:transparent;border:1px solid #ccc;border-radius:10px;padding:8px';document.querySelector('header').append(b);}b.onclick=()=>{if(confirm('ログアウトしますか？'))signOut(auth);};}else{gate.hidden=false;gate.style.display='flex';form.hidden=false;message.textContent='登録したメールアドレスとパスワードでログインしてください。';document.getElementById('logoutButton')?.remove();}},()=>{message.textContent='認証の確認に失敗しました。通信を確認してください。';form.hidden=false;});
form.addEventListener('submit',async e=>{e.preventDefault();const b=document.getElementById('authSubmit');b.disabled=true;message.textContent='ログイン中…';try{await signInWithEmailAndPassword(auth,document.getElementById('authEmail').value.trim(),document.getElementById('authPassword').value);document.getElementById('authPassword').value='';}catch(e){message.textContent='ログインできませんでした。メールアドレス、パスワードを確認してください。';}finally{b.disabled=false;}});
