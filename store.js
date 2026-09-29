// 기도 저장소. firebaseConfig가 있으면 Firestore, 없으면 체험 모드(localStorage).
// 세 페이지가 모두 이 파일 하나만 씁니다.
import { firebaseConfig } from "./config.js";

export const isDemo = !firebaseConfig;
export const MAX_TEXT = 300;
export const MAX_NAME = 20;

const store = isDemo ? demoStore() : await firebaseStore(firebaseConfig);
export default store;

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function demoStore() {
  const KEY = "gido-demo-v1";
  const channel = "BroadcastChannel" in window ? new BroadcastChannel(KEY) : null;
  const subs = new Set();
  const load = () => {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
  };
  const emit = () => { const all = load(); subs.forEach((fn) => fn(all)); };
  const save = (all) => {
    try { localStorage.setItem(KEY, JSON.stringify(all)); } catch {}
    channel?.postMessage("changed");
    emit();
  };
  if (channel) channel.onmessage = emit;
  addEventListener("storage", (e) => { if (e.key === KEY) emit(); });
  const watch = (fn) => { subs.add(fn); fn(load()); return () => subs.delete(fn); };

  return {
    async submit({ text, name }) {
      const all = load();
      all.push({ id: newId(), text, name, status: "pending", createdAt: Date.now() });
      save(all);
    },
    watchApproved(cb) {
      return watch((all) => cb(all.filter((p) => p.status === "approved")
        .sort((a, b) => (a.approvedAt || 0) - (b.approvedAt || 0))));
    },
    watchAll(cb) {
      return watch((all) => cb([...all].sort((a, b) => b.createdAt - a.createdAt)));
    },
    async update(id, patch) {
      const all = load();
      const p = all.find((x) => x.id === id);
      if (!p) return;
      Object.assign(p, patch);
      if (patch.status === "approved") p.approvedAt = Date.now();
      save(all);
    },
    onAuth(cb) { cb({ email: "체험 모드" }); return () => {}; },
    async signIn() {},
    async signOut() {},
  };
}

async function firebaseStore(config) {
  const V = "10.14.1";
  const base = `https://www.gstatic.com/firebasejs/${V}`;
  const [{ initializeApp }, fs, auth] = await Promise.all([
    import(`${base}/firebase-app.js`),
    import(`${base}/firebase-firestore.js`),
    import(`${base}/firebase-auth.js`),
  ]);
  const app = initializeApp(config);
  const db = fs.getFirestore(app);
  const au = auth.getAuth(app);
  const col = fs.collection(db, "prayers");
  const ms = (t) => (t && t.toMillis ? t.toMillis() : Date.now());
  const toPrayer = (d) => {
    const v = d.data();
    return { id: d.id, text: v.text, name: v.name, status: v.status,
      createdAt: ms(v.createdAt), approvedAt: v.approvedAt ? ms(v.approvedAt) : 0 };
  };

  return {
    async submit({ text, name }) {
      await fs.addDoc(col, { text, name, status: "pending", createdAt: fs.serverTimestamp() });
    },
    watchApproved(cb, onError) {
      const q = fs.query(col, fs.where("status", "==", "approved"));
      return fs.onSnapshot(q, (snap) => cb(snap.docs.map(toPrayer)
        .sort((a, b) => a.approvedAt - b.approvedAt)), onError);
    },
    watchAll(cb, onError) {
      const q = fs.query(col, fs.orderBy("createdAt", "desc"), fs.limit(300));
      return fs.onSnapshot(q, (snap) => cb(snap.docs.map(toPrayer)), onError);
    },
    async update(id, patch) {
      const data = { ...patch };
      if (patch.status === "approved") data.approvedAt = fs.serverTimestamp();
      await fs.updateDoc(fs.doc(db, "prayers", id), data);
    },
    onAuth(cb) { return auth.onAuthStateChanged(au, cb); },
    signIn(email, password) { return auth.signInWithEmailAndPassword(au, email, password); },
    signOut() { return auth.signOut(au); },
  };
}
