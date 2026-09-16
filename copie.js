firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

const params = new URLSearchParams(window.location.search);
if (params.get('source')) document.getElementById('source').value = params.get('source');
if (params.get('dest')) document.getElementById('dest').value = params.get('dest');

async function copier() {
  const log = document.getElementById('log');
  const source = document.getElementById('source').value.trim();
  const dest = document.getElementById('dest').value.trim();
  if (!source || !dest) { log.textContent = "Remplis les deux clés."; return; }
  if (source === dest) { log.textContent = "Source et destination identiques, rien à faire."; return; }

  log.textContent = "Copie des rubriques...\n";
  const srcRef = db.collection('sites').doc(source);
  const dstRef = db.collection('sites').doc(dest);

  const rubSnap = await srcRef.collection('rubriques').get();
  const rubMap = {};
  for (const doc of rubSnap.docs) {
    const newDoc = await dstRef.collection('rubriques').add(doc.data());
    rubMap[doc.id] = newDoc.id;
    log.textContent += `Rubrique copiée : ${doc.data().nom}\n`;
  }

  log.textContent += "\nCopie des plats...\n";
  const platSnap = await srcRef.collection('plats').get();
  let count = 0;
  for (const doc of platSnap.docs) {
    const data = doc.data();
    const newRubriqueId = rubMap[data.rubriqueId] || data.rubriqueId || '';
    await dstRef.collection('plats').add({ ...data, rubriqueId: newRubriqueId });
    count++;
    log.textContent += `Plat copié : ${data.nom}\n`;
  }

  log.textContent += `\nTerminé. ${rubSnap.docs.length} rubrique(s) et ${count} plat(s) copiés vers la clé ${dest}.`;
}

document.getElementById('btn-copier').onclick = copier;
