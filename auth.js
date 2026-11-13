import {initializeApp} from 'https://www.gstatic.com/firebasejs/13.3.0/firebase-app.js';
import {getAuth,setPersistence,browserLocalPersistence,onAuthStateChanged,signInWithEmailAndPassword,signOut} from 'https://www.gstatic.com/firebasejs/13.3.0/firebase-auth.js';
import {getFirestore,collection,doc,setDoc,getDoc,deleteDoc,onSnapshot,serverTimestamp} from 'https://www.gstatic.com/firebasejs/13.3.0/firebase-firestore.js';
const config={apiKey:'AIzaSyARnnrDQs0RigPP3xEQDspPjROeMCLVolE',authDomain:'suehiro-kakeibo.firebaseapp.com',projectId:'suehiro-kakeibo',storageBucket:'suehiro-kakeibo.firebasestorage.app',messagingSenderId:'972353857496',appId:'1:972353857496:web:99a0df162600c2504634ad'};
const app=initializeApp(config),auth=getAuth(app),database=getFirestore(app);
const gate=document.getElementById('authGate'),form=document.getElementById('authForm'),message=document.getElementById('authMessage');
let unsubscribe=[];
function disconnect(){unsubscribe.forEach(f=>f());unsubscribe=[];window.SuehiroCloud=null;window.dispatchEvent(new Event('suehiro-cloud-disconnected'));}
function bridge(user){const uid=user.uid,own=(kind,key)=>doc(database,'users',uid,kind,String(key));window.SuehiroCloud={
  uid,
  watchRecords(ok,fail){const stop=onSnapshot(collection(database,'users',uid,'entries'),q=>ok(q.docs.map(x=>x.data())),fail);unsubscribe.push(stop);},
  watchHero(ok,fail){const stop=onSnapshot(own('media','hero'),s=>ok(s.exists()?s.data().data:null),fail);unsubscribe.push(stop);},
  async saveRecord(record){await setDoc(own('entries',record.id),{...record,updatedAt:serverTimestamp()});},
  async deleteRecord(id){await deleteDoc(own('entries',id));},
  async saveImage(id,data){await setDoc(own('media',id),{data,updatedAt:serverTimestamp()});},
  async getImage(id){const s=await getDoc(own('media',id));return s.exists()?s.data().data:null;},
  async deleteImage(id){await deleteDoc(own('media',id));}
};window.dispatchEvent(new Event('suehiro-cloud-ready'));}
try{await setPersistence(auth,browserLocalPersistence);}catch{message.textContent='ログイン情報の保持に制限があります。Safariの通常タブで開いてください。';}
onAuthStateChanged(auth,user=>{disconnect();if(user){gate.hidden=true;gate.style.display='none';bridge(user);let b=document.getElementById('logoutButton');if(!b){b=document.createElement('button');b.id='logoutButton';b.type='button';b.textContent='ログアウト';b.style.cssText='font-size:12px;background:transparent;border:1px solid #ccc;border-radius:10px;padding:8px';document.querySelector('header').append(b);}b.onclick=()=>{if(confirm('ログアウトしますか？'))signOut(auth);};}else{gate.hidden=false;gate.style.display='flex';form.hidden=false;message.textContent='登録したメールアドレスとパスワードでログインしてください。';document.getElementById('logoutButton')?.remove();}},()=>{message.textContent='認証の確認に失敗しました。通信を確認してください。';form.hidden=false;});
form.addEventListener('submit',async e=>{e.preventDefault();const b=document.getElementById('authSubmit');b.disabled=true;message.textContent='ログイン中…';try{await signInWithEmailAndPassword(auth,document.getElementById('authEmail').value.trim(),document.getElementById('authPassword').value);document.getElementById('authPassword').value='';}catch(e){message.textContent='ログインできませんでした。メールアドレス、パスワードを確認してください。';}finally{b.disabled=false;}});
