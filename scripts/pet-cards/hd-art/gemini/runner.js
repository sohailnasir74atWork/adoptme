// Gemini redraw runner: paste into the gemini.google.com tab (Claude's browser
// pane, via the JS tool). Runs the whole queue inside the page with no typing
// and no downloads. Each finished picture is PUT to its own GCS upload URL;
// watch.sh pulls it from the bucket, processes it, and pushes it to the CDN.
//
//   1. hd-art/gemini/make_run.sh                     -> prints <name>
//   2. in the Gemini tab:  await __petLoad('<name>')  (then delete q/<name>.json)
//   3. __petRun2()            start now
//      __petSchedule(21, 20)  or start at 21:20 local (after a usage-limit reset)
//   Progress: JSON.parse(localStorage.petLog) / localStorage.petDone. Stop: window.__petStop = true
//
// State lives in localStorage (petItems, petDone, petLog), so a reload loses
// only the in-memory loop: paste this file again and call __petRun2().
// Usage limit: on "limit resets" it waits 30 min and retries the same pet.
// Refusals ("third-party content providers") are skipped; timeouts retried once.

window.__petLoad = async function (name) {
  const r = await fetch(`https://storage.googleapis.com/adoptme-petcards-redraw-kit/q/${name}.json`, { cache: 'no-store' });
  const items = await r.json();
  localStorage.setItem('petItems', JSON.stringify(items));
  return items.length;
};

window.__petSchedule = function (h, m) {
  const start = new Date(); start.setHours(h, m, 0, 0);
  if (start < Date.now()) start.setDate(start.getDate() + 1);
  window.__petWaitUntil = start.getTime();
  setTimeout(() => window.__petRun2(), start - Date.now());
  return `starts in ${Math.round((start - Date.now()) / 60000)} min`;
};

window.__petRun2 = async function () {
  const B = 'https://storage.googleapis.com/adoptme-petcards-redraw-kit';
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const waitFor = async (f, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = f(); if (v) return v; await sleep(250); } return null; };
  const items = JSON.parse(localStorage.getItem('petItems') || '[]');
  const done = new Set(JSON.parse(localStorage.getItem('petDone') || '[]'));
  const skip = new Set(['businessmonkey']);
  const log = JSON.parse(localStorage.getItem('petLog') || '[]');
  const note = (...a) => { log.push([...a, new Date().toTimeString().slice(0, 5)]); localStorage.setItem('petLog', JSON.stringify(log.slice(-400))); };

  async function one(k, name, bg, uid) {
    if (location.pathname !== '/app') {
      const nc = document.querySelector('a[href="/app"], button[aria-label="New chat"], [data-test-id="new-chat-button"] a, [data-test-id="new-chat-button"] button');
      if (nc) nc.click(); else location.assign('/app');
      await waitFor(() => location.pathname === '/app', 10000); await sleep(1500);
    }
    const before = new Set([...document.querySelectorAll('img')].map(i => i.src));
    const r = await fetch(`${B}/kit2/${k}.png`);
    const file = new File([await r.blob()], 'reference.png', { type: 'image/png' });
    (await waitFor(() => document.querySelector('button[aria-label="Upload & tools"]'))).click();
    (await waitFor(() => [...document.querySelectorAll('images-files-uploader button')][0])).click();
    const inp = await waitFor(() => [...document.querySelectorAll('input[type=file]')].find(i => /image/.test(i.accept)));
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const dt = new DataTransfer(); dt.items.add(file); inp.files = dt.files; inp.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => [...document.querySelectorAll('img')].some(i => i.src.startsWith('blob:') && !before.has(i.src)), 8000);
    const bgText = bg === 'navy' ? 'dark navy blue (#0A1A3A)' : 'pure white (#FFFFFF)';
    const prompt = `Generate an image: make a clean high-resolution version of this exact cute toy character (a little ${name.toLowerCase()}) as a smooth stylized 3D render. Keep it identical: same body shape, proportions, colours, markings, eyes and details. Do not add or redesign anything. Same pose and angle, full body visible and fully inside the frame, centred. Soft studio lighting, no shadow, no ground. Background: one perfectly flat solid ${bgText} colour, nothing else. Crisp edges, no text, no watermark. Square image with about 10% margin around the character.`;
    const ed = await waitFor(() => document.querySelector('rich-textarea .ql-editor'));
    ed.focus(); document.execCommand('insertText', false, prompt); // execCommand fires the input events Quill needs
    await sleep(600);
    const send = await waitFor(() => { const b = document.querySelector('button[aria-label="Send message"]'); return b && !b.disabled && b.getAttribute('aria-disabled') !== 'true' ? b : null; }, 8000);
    if (!send) return ['error', 'no send button'];
    send.click();
    let img = null; const t0 = Date.now();
    while (Date.now() - t0 < 240000) {
      img = [...document.querySelectorAll('img.image.loaded')].filter(i => i.naturalWidth >= 1000 && i.complete && !before.has(i.src)).pop();
      if (img) break;
      const tail = document.body.innerText.slice(-400);
      if (Date.now() - t0 > 8000) {
        if (/limit resets|reached your|usage limit/i.test(tail)) return ['limit'];
        if (/can't generate|cannot generate|third-party|I can't help|unable to create/i.test(tail)) return ['refused'];
      }
      await sleep(1500);
    }
    if (!img) return ['timeout', location.pathname]; // the chat often finishes later: open it and grab by hand
    let blob;
    if (img.src.startsWith('blob:')) {
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0); blob = await new Promise(r => c.toBlob(r, 'image/png'));
    } else {
      try { blob = await (await fetch(img.src)).blob(); } catch (e) { return ['tainted', location.pathname]; }
    }
    const res = await fetch(`https://storage.googleapis.com/upload/storage/v1/b/adoptme-petcards-redraw-kit/o?uploadType=resumable&name=out/${k}.png&upload_id=${uid}`,
      { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: blob });
    return res.ok ? ['ok', blob.size] : ['error', 'upload ' + res.status];
  }

  window.__petRunning = true;
  for (const [k, name, bg, uid] of items) {
    if (done.has(k) || skip.has(k)) continue;
    let tries = 0;
    while (!window.__petStop) {
      window.__petCur = k;
      let res; try { res = await one(k, name, bg, uid); } catch (e) { res = ['error', String(e).slice(0, 100)]; }
      note(k, ...res);
      if (res[0] === 'ok') { done.add(k); localStorage.setItem('petDone', JSON.stringify([...done])); break; }
      if (res[0] === 'limit') { window.__petWaitUntil = Date.now() + 30 * 60e3; await sleep(30 * 60e3); continue; }
      if (res[0] === 'refused' || ++tries >= 2) break;
    }
    if (window.__petStop) break;
  }
  window.__petRunning = false; note('__done__');
};
