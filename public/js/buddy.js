import { $, h, state, api, nav, sq, iconNode, svgNode, toast, fail, confirmBox, promptBox, show, form, field } from './ui.js';

const mascot = () => svgNode(`<svg class="mascot" viewBox="0 0 72 72" role="img" aria-label="Scrxaper Buddy"><g class="sway">
  <g fill="#b7c9e6" opacity=".55"><ellipse cx="36" cy="12" rx="8" ry="11"/><ellipse cx="14" cy="30" rx="11" ry="8"/><ellipse cx="58" cy="30" rx="11" ry="8"/></g>
  <circle cx="36" cy="42" r="22" fill="#e8f1ff"/><circle cx="20" cy="50" r="12" fill="#e8f1ff"/><circle cx="52" cy="50" r="12" fill="#e8f1ff"/>
  <g fill="#1a1d24"><ellipse cx="28" cy="42" rx="4" ry="5.5"/><ellipse cx="44" cy="42" rx="4" ry="5.5"/></g>
  <g class="shine" fill="#fff"><circle cx="29.4" cy="40" r="1.4"/><circle cx="45.4" cy="40" r="1.4"/></g></g></svg>`);
function renderMarkdown(text) {
  const root = document.createElement('div');
  text.split(/```/).forEach((part, i) => {
    if (i % 2) { const pre = document.createElement('pre'); const code = document.createElement('code'); code.textContent = part.replace(/^[\w+-]*\n/, ''); pre.append(code); root.append(pre); return; }
    part.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/).forEach((seg) => {
      if (/^`[^`]+`$/.test(seg)) root.append(Object.assign(document.createElement('code'), { textContent: seg.slice(1, -1) }));
      else if (/^\*\*[^*]+\*\*$/.test(seg)) root.append(Object.assign(document.createElement('strong'), { textContent: seg.slice(2, -2) }));
      else root.append(document.createTextNode(seg));
    });
  });
  return root;
}
const greeting = () => { const hr = new Date().getHours(); return hr < 5 ? 'Still up' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening'; };
const buddy = { conv: null };

export async function showBuddy(note) {
  const s = await api('/api/ai/settings');
  if (!s.available) return show(h('h2', {}, 'Buddy'), mascot(), h('p', { className: 'empty' }, 'The AI buddy is switched off on this server because AI_KEY_SECRET is not set. Ask the person who runs it to set it.'));
  if (!s.hasKey) return setup(s, note);
  const convs = await api('/api/ai/conversations');
  const log = h('div', { className: 'buddy-log', role: 'log', ariaLive: 'polite' });
  const say = (role, content) => {
    const bubble = h('div', { className: `msg${role === 'user' ? ' mine' : ''}` });
    bubble.append(role === 'user' ? document.createTextNode(content) : renderMarkdown(content));
    if (role !== 'user') bubble.append(sq('link', 'Copy reply', () => navigator.clipboard?.writeText(content).then(() => toast('Copied', { ic: 'check' })), 'small'));
    log.append(bubble); bubble.scrollIntoView({ block: 'end' });
  };
  const open = async (id) => { buddy.conv = id; log.replaceChildren(); if (id) (await api(`/api/ai/messages?conversation=${id}`)).messages.forEach((m) => say(m.role, m.content)); else say('assistant', `${greeting()}, ${state.displayName}. I'm your buddy. What's on your mind?`); };
  const picker = h('select', { ariaLabel: 'Conversation', style: { flex: '1', 'min-width': '0' } }, h('option', { value: '' }, 'New conversation'), ...convs.map((c) => h('option', { value: c.id, selected: String(c.id) === String(buddy.conv) }, c.title)));
  picker.addEventListener('change', () => open(picker.value ? Number(picker.value) : null));
  const err = h('p', { className: 'error', role: 'alert' });
  const composer = form(async (v) => {
    const text = v.text.trim(); if (!text) return; err.textContent = ''; say('user', text); composer.elements.text.value = '';
    try { const r = await api('/api/ai/chat', { body: { conversation: buddy.conv, text, localTime: new Date().toLocaleString() } }); buddy.conv = r.conversation; say('assistant', r.reply); } catch (e) { err.textContent = `${e.message} Your message was not saved. Send it again to retry.`; }
  }, h('div', { className: 'composer-row' }, field('text', 'Message your buddy', { required: true, maxLength: 4000, style: { flex: '1', 'border-radius': '999px' } }), h('button', { className: 'sq primary-sq', type: 'submit', ariaLabel: 'Send' }, iconNode('send', 20))));
  show(h('h2', {}, iconNode('buddy', 22), 'Buddy'), mascot(), h('div', { className: 'buddy-chat' }, h('div', { className: 'field-row' }, picker,
    sq('edit', 'Rename', async () => { if (!buddy.conv) return; const t = await promptBox('Rename conversation', 'Title', '', 'Rename'); if (t) { await api('/api/ai/rename', { body: { conversation: buddy.conv, title: t } }); showBuddy(); } }, 'small'),
    sq('x', 'Clear', async () => { if (buddy.conv && await confirmBox('Clear this conversation?', 'Messages are removed, the chat stays.', 'Clear', true)) { await api('/api/ai/clear', { body: { conversation: buddy.conv } }); open(buddy.conv); } }, 'small'),
    sq('trash', 'Delete', async () => { if (buddy.conv && await confirmBox('Delete this conversation?', '', 'Delete', true)) { await api('/api/ai/delete', { body: { conversation: buddy.conv } }); buddy.conv = null; showBuddy(); } }, 'small danger-sq'),
    sq('gear', 'Settings', () => setup(s), 'small')), log, err, composer));
  open(buddy.conv); if (note) err.textContent = note;
}
function setup(s, note) {
  const msg = h('p', { className: 'error', role: 'alert' }, note || '');
  const f = form(async (v) => { msg.textContent = ''; try { await api('/api/ai/settings', { body: { apiKey: v.apiKey, model: v.model, personality: v.personality } }); await api('/api/ai/test', { body: {} }); showBuddy(); } catch (e) { msg.textContent = e.message; } },
    field('apiKey', s.hasKey ? 'New API key (leave blank to keep the current one)' : 'Groq API key', { type: 'password', required: !s.hasKey, autocomplete: 'off' }), field('model', 'Model', { value: s.model, required: true }),
    h('textarea', { name: 'personality', placeholder: 'Optional personality, e.g. “short, dry humour”', ariaLabel: 'Personality', maxLength: 500, value: s.personality }), h('button', { className: 'primary', type: 'submit' }, 'Save and test connection'));
  show(h('h2', {}, 'Your buddy'), mascot(), h('p', { className: 'help' }, 'Buddy’s replies come from Groq, an outside AI provider. What you type in a buddy chat, plus your chosen personality and your local time, is sent to Groq with your own API key. Nothing else about your account is sent. Scrxaper stores your key encrypted on the server and never shows it again. Groq handles that text under its own terms, so these chats are not private from Groq.'), f, msg,
    ...(s.hasKey ? [h('div', { className: 'field-row' }, h('button', { className: 'ghost', type: 'button', onclick: async () => { await api('/api/ai/key/delete', { body: {} }); showBuddy(); } }, 'Remove my key'),
      h('button', { className: 'ghost', type: 'button', onclick: async () => { if (await confirmBox('Delete every buddy conversation?', '', 'Delete all', true)) { await api('/api/ai/delete-all', { body: {} }); buddy.conv = null; showBuddy(); } } }, 'Delete all conversations'), h('button', { className: 'ghost', type: 'button', onclick: () => showBuddy() }, 'Back'))] : []));
}
nav.showBuddy = () => showBuddy().catch(fail);
