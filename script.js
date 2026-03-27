/* NovaMind AI v3.0 - script.js */

// ══ STATE ══════════════════════════════════
let API_KEY          = '';
let uploadedFiles    = [];
let activeFileIndex  = -1;
let isProcessing     = false;
let chatHistory      = [];
let currentSessionId = '';
let isLightTheme     = false;
let calcHistoryLog   = [];
let recognition      = null;
let isListening      = false;
let currentUser      = null;
let calcExpr         = '';

// ══ API KEY ════════════════════════════════
function saveApiKey() {
  const key = document.getElementById('apiKeyInput').value.trim();
  if (!key) { showToast('Please enter your Gemini API key', 'error'); return; }
  API_KEY = key;
  localStorage.setItem('nm_api_key', key);
  document.getElementById('apiModal').style.display = 'none';
  document.getElementById('authModal').style.display = 'flex';
}
document.getElementById('apiKeyInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') saveApiKey();
});

// ══ AUTH ═══════════════════════════════════
function switchAuthTab(tab) {
  document.getElementById('loginForm').style.display    = tab === 'login'    ? 'block' : 'none';
  document.getElementById('registerForm').style.display = tab === 'register' ? 'block' : 'none';
  document.getElementById('loginTab').classList.toggle('active', tab === 'login');
  document.getElementById('registerTab').classList.toggle('active', tab === 'register');
  document.getElementById('authMsg').textContent = '';
  document.getElementById('authMsg').className = 'auth-msg';
}

function setAuthMsg(msg, type) {
  const el = document.getElementById('authMsg');
  el.textContent = msg;
  el.className = 'auth-msg ' + type;
}

function skipAuth() {
  document.getElementById('authModal').style.display = 'none';
  currentSessionId = 'session_' + Date.now();
  showToast('Continuing as guest', '');
  loadHistoryList();
}

async function doLogin() {
  const email    = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  if (!email || !password) { setAuthMsg('Please fill all fields', 'error'); return; }
  setAuthMsg('Logging in...', '');
  try {
    const res  = await fetch('/api/login', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({email, password}) });
    const data = await res.json();
    if (!res.ok) { setAuthMsg(data.error, 'error'); return; }
    currentUser = data.user;
    localStorage.setItem('nm_user', JSON.stringify(data.user));
    document.getElementById('authModal').style.display = 'none';
    showToast(data.message + ' Welcome back!', 'success');
    updateUserBadge();
    currentSessionId = 'session_' + Date.now();
    if (data.chats && data.chats.length > 0) {
      localStorage.setItem('nm_chat_index', JSON.stringify(data.chats.map(c => ({id: c.session_id, title: c.title, updated_at: c.updated_at, message_count: c.message_count}))));
    }
    loadHistoryList();
  } catch(e) { setAuthMsg('Server connection error', 'error'); }
}

async function doRegister() {
  const username = document.getElementById('regUsername').value.trim();
  const email    = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;
  if (!username || !email || !password) { setAuthMsg('Please fill all fields', 'error'); return; }
  setAuthMsg('Creating account...', '');
  try {
    const res  = await fetch('/api/register', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({username, email, password}) });
    const data = await res.json();
    if (!res.ok) { setAuthMsg(data.error, 'error'); return; }
    currentUser = data.user;
    localStorage.setItem('nm_user', JSON.stringify(data.user));
    setAuthMsg('Account created! Welcome ' + data.user.username + '!', 'success');
    setTimeout(() => {
      document.getElementById('authModal').style.display = 'none';
      showToast('Welcome to NovaMind!', 'success');
      updateUserBadge();
      currentSessionId = 'session_' + Date.now();
      loadHistoryList();
    }, 1200);
  } catch(e) { setAuthMsg('Server connection error', 'error'); }
}

function logoutUser() {
  currentUser = null;
  localStorage.removeItem('nm_user');
  localStorage.removeItem('nm_chat_index');
  updateUserBadge();
  document.getElementById('historyList').innerHTML = '<div class="history-empty">No saved chats yet.<br>Start chatting!</div>';
  showToast('Logged out', '');
}

function updateUserBadge() {
  const badge = document.getElementById('userBadge');
  badge.innerHTML = currentUser
    ? `<div class="user-badge"><span>👤 ${currentUser.username}</span><button onclick="logoutUser()" title="Logout">✕</button></div>`
    : '';
}

// ══ THEME ══════════════════════════════════
function toggleTheme() {
  isLightTheme = !isLightTheme;
  document.body.classList.toggle('light-theme', isLightTheme);
  document.getElementById('themeToggleBtn').textContent = isLightTheme ? '☀️' : '🌙';
  localStorage.setItem('nm_theme', isLightTheme ? 'light' : 'dark');
}

// ══ MODE SWITCH ════════════════════════════
function switchMode(mode) {
  document.querySelectorAll('.mode-btn').forEach((b, i) => b.classList.toggle('active', ['chat','summarize','calc'][i] === mode));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.getElementById({chat:'chatPanel', summarize:'summarizePanel', calc:'calcPanel'}[mode]).classList.add('active');
}

// ══ CHAT HISTORY ═══════════════════════════
async function newChat() {
  if (chatHistory.length > 0) await saveCurrentChat();
  chatHistory = [];
  currentSessionId = 'session_' + Date.now();
  document.getElementById('messages').innerHTML = `
    <div class="welcome" id="welcomeScreen">
      <span class="welcome-icon">🤖</span>
      <h2>Hello! I'm NovaMind</h2>
      <p>Powered by Google Gemini — Chat, analyze files,<br>summarize documents, and solve math problems.</p>
      <div class="welcome-chips">
        <div class="chip" onclick="quickPrompt('What can you do?')">What can you do?</div>
        <div class="chip" onclick="quickPrompt('Write a short poem about AI')">Write a poem</div>
        <div class="chip" onclick="quickPrompt('Explain quantum computing simply')">Explain quantum computing</div>
        <div class="chip" onclick="quickPrompt('Give me a pasta carbonara recipe')">Give me a recipe</div>
        <div class="chip" onclick="quickPrompt('Help me write a professional email')">Write an email</div>
        <div class="chip" onclick="quickPrompt('What are the latest trends in AI?')">AI trends</div>
      </div>
    </div>`;
  showToast('New chat started', 'success');
}

async function saveCurrentChat() {
  if (!chatHistory.length || !currentSessionId) return;
  const title = chatHistory[0]?.content?.substring(0, 50) || 'Chat';
  const data  = { id: currentSessionId, title, messages: chatHistory, updated_at: new Date().toISOString(), message_count: chatHistory.length };
  localStorage.setItem('nm_chat_' + currentSessionId, JSON.stringify(data));
  let index = JSON.parse(localStorage.getItem('nm_chat_index') || '[]');
  index = index.filter(s => s.id !== currentSessionId);
  index.unshift({ id: currentSessionId, title, updated_at: data.updated_at, message_count: data.message_count });
  if (index.length > 30) index = index.slice(0, 30);
  localStorage.setItem('nm_chat_index', JSON.stringify(index));
  loadHistoryList();
}

function loadHistoryList() {
  const container = document.getElementById('historyList');
  const index     = JSON.parse(localStorage.getItem('nm_chat_index') || '[]');
  if (!index.length) { container.innerHTML = '<div class="history-empty">No saved chats yet.<br>Start chatting!</div>'; return; }
  container.innerHTML = index.map(s => `
    <div class="history-item ${s.id === currentSessionId ? 'active' : ''}" onclick="loadChat('${s.id}')">
      <div class="history-item-title">${escapeHtml(s.title)}</div>
      <div class="history-item-meta">${s.message_count} msgs · ${formatDate(s.updated_at)}</div>
      <button class="history-delete" onclick="deleteChat(event,'${s.id}')">🗑</button>
    </div>`).join('');
}

async function loadChat(sessionId) {
  const data = JSON.parse(localStorage.getItem('nm_chat_' + sessionId) || 'null');
  if (!data) { showToast('Chat not found', 'error'); return; }
  currentSessionId = sessionId;
  chatHistory = data.messages || [];
  const msgs = document.getElementById('messages');
  msgs.innerHTML = '';
  for (const msg of chatHistory) addMessage(msg.role === 'assistant' ? 'ai' : 'user', msg.content, false);
  loadHistoryList();
  msgs.scrollTop = msgs.scrollHeight;
  showToast('Chat loaded', 'success');
}

function deleteChat(e, sessionId) {
  e.stopPropagation();
  localStorage.removeItem('nm_chat_' + sessionId);
  let index = JSON.parse(localStorage.getItem('nm_chat_index') || '[]');
  index = index.filter(s => s.id !== sessionId);
  localStorage.setItem('nm_chat_index', JSON.stringify(index));
  if (currentSessionId === sessionId) { currentSessionId = ''; chatHistory = []; }
  loadHistoryList();
  showToast('Chat deleted', '');
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso), now = new Date(), diff = now - d;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff/60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff/3600000) + 'h ago';
  return d.toLocaleDateString();
}

// ══ EXPORT ═════════════════════════════════
function exportCurrentChat() {
  if (!chatHistory.length) { showToast('No chat to export', 'error'); return; }
  const lines = ['NovaMind AI Chat Export', 'Date: ' + new Date().toLocaleString(), '='.repeat(50), ''];
  for (const msg of chatHistory) { lines.push('[' + (msg.role === 'user' ? 'You' : 'NovaMind') + ']'); lines.push(msg.content); lines.push(''); }
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([lines.join('\n')], {type:'text/plain'})), download: 'novamind_chat_' + Date.now() + '.txt' });
  a.click(); URL.revokeObjectURL(a.href);
  showToast('Chat exported!', 'success');
}

// ══ FILE HANDLING ══════════════════════════
const uploadZone = document.getElementById('uploadZone');
const fileInput  = document.getElementById('fileInput');
uploadZone.addEventListener('dragover',  e => { e.preventDefault(); uploadZone.classList.add('drag-over'); });
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
uploadZone.addEventListener('drop', e => { e.preventDefault(); uploadZone.classList.remove('drag-over'); handleFiles(e.dataTransfer.files); });
fileInput.addEventListener('change', e => { handleFiles(e.target.files); fileInput.value = ''; });

async function handleFiles(files) {
  for (const file of files) {
    showToast('Uploading ' + file.name + '...', '');
    try {
      let content;
      try {
        const fd = new FormData(); fd.append('file', file);
        const res = await fetch('/api/upload', { method: 'POST', body: fd });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        content = data.content;
      } catch {
        if (file.name.toLowerCase().endsWith('.pdf')) throw new Error('PDF needs Flask backend running.');
        content = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = e => resolve(e.target.result); r.onerror = reject; r.readAsText(file); });
      }
      uploadedFiles.push({ name: file.name, size: file.size, content, type: file.type });
      renderFileList();
      showToast(file.name + ' loaded', 'success');
    } catch(err) { showToast('Error: ' + err.message, 'error'); }
  }
}

function renderFileList() {
  document.getElementById('fileList').innerHTML = uploadedFiles.map((f, i) => `
    <div class="file-item ${i === activeFileIndex ? 'active' : ''}" onclick="selectFile(${i})">
      <span class="file-icon">${getFileIcon(f.name)}</span>
      <div class="file-info"><div class="file-name">${f.name}</div><div class="file-size">${formatSize(f.size)}</div></div>
      <button class="file-remove" onclick="removeFile(event,${i})">×</button>
    </div>`).join('');
}

function selectFile(i) {
  activeFileIndex = i; renderFileList(); updateContextBar();
  document.getElementById('sumInput').value = uploadedFiles[i].content.substring(0, 8000);
  updateSumCharCount(); showToast(uploadedFiles[i].name + ' selected', 'success');
}
function removeFile(e, i) {
  e.stopPropagation(); uploadedFiles.splice(i, 1);
  if (activeFileIndex === i) activeFileIndex = -1; else if (activeFileIndex > i) activeFileIndex--;
  renderFileList(); updateContextBar();
}
function updateContextBar() {
  document.getElementById('contextBar').innerHTML = activeFileIndex >= 0
    ? `<div class="ctx-tag">📎 ${uploadedFiles[activeFileIndex].name} <button onclick="clearContext()">×</button></div>` : '';
}
function clearContext() { activeFileIndex = -1; renderFileList(); updateContextBar(); }
function getFileIcon(n) { return {pdf:'📕',csv:'📊',json:'🔧',md:'📝',txt:'📄'}[n.split('.').pop().toLowerCase()] || '📄'; }
function formatSize(b) { if(b<1024) return b+' B'; if(b<1048576) return (b/1024).toFixed(1)+' KB'; return (b/1048576).toFixed(1)+' MB'; }

// ══ BACKEND API CALLS ══════════════════════
async function callBackendChat(history) {
  const res = await fetch('/api/chat', { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ api_key: API_KEY, history, session_id: currentSessionId, user_id: currentUser ? currentUser.id : null }) });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.response;
}
async function callBackendSummarize(text, style) {
  const res = await fetch('/api/summarize', { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ api_key: API_KEY, text, style, user_id: currentUser ? currentUser.id : null }) });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.summary;
}
async function callBackendMath(question) {
  const res = await fetch('/api/math', { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ api_key: API_KEY, question }) });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.answer;
}

// ══ CHAT ═══════════════════════════════════
function quickPrompt(text) { document.getElementById('chatInput').value = text; switchMode('chat'); sendMessage(); }
function handleKey(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }
function autoResize(el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 140) + 'px'; }
function updateCharCount() {
  const v = document.getElementById('chatInput').value, el = document.getElementById('charCount');
  if (v.length > 50) { el.textContent = v.length + ' chars'; el.style.display = 'inline'; } else { el.style.display = 'none'; }
}

async function sendMessage() {
  if (isProcessing) return;
  const input = document.getElementById('chatInput');
  const text  = input.value.trim();
  if (!text) return;
  if (!API_KEY) { showToast('Please enter your Gemini API key first', 'error'); document.getElementById('apiModal').style.display = 'flex'; return; }
  const w = document.getElementById('welcomeScreen'); if (w) w.remove();
  addMessage('user', text);
  input.value = ''; input.style.height = 'auto'; document.getElementById('charCount').style.display = 'none';
  const userContent = activeFileIndex >= 0
    ? `[File: ${uploadedFiles[activeFileIndex].name}]\n${uploadedFiles[activeFileIndex].content.substring(0,6000)}\n\n---\nUser: ${text}` : text;
  chatHistory.push({ role: 'user', content: userContent });
  isProcessing = true; document.getElementById('sendBtn').disabled = true;
  const tid = addTyping();
  try {
    const response = await callBackendChat(chatHistory);
    removeTyping(tid); addMessage('ai', response);
    chatHistory.push({ role: 'assistant', content: response });
    await saveCurrentChat();
  } catch(err) { removeTyping(tid); addMessage('ai', '⚠️ ' + err.message); }
  isProcessing = false; document.getElementById('sendBtn').disabled = false;
}

function addMessage(role, text, scroll = true) {
  const msgs = document.getElementById('messages'), div = document.createElement('div');
  div.className = 'message ' + role;
  div.innerHTML = `<div class="msg-avatar">${role==='ai'?'🤖':'👤'}</div>
    <div class="msg-body">
      <div class="msg-role">${role==='ai'?'NovaMind':'You'}</div>
      <div class="msg-content">${formatMessage(text)}</div>
      <div class="msg-actions"><button class="msg-copy-btn" onclick="copyMsgText(this)">📋</button></div>
    </div>`;
  msgs.appendChild(div); if (scroll) msgs.scrollTop = msgs.scrollHeight;
}

function copyMsgText(btn) {
  navigator.clipboard.writeText(btn.closest('.msg-body').querySelector('.msg-content').innerText)
    .then(() => { btn.textContent = '✅'; setTimeout(() => btn.textContent = '📋', 1500); });
}

function addTyping() {
  const msgs = document.getElementById('messages'), id = 'typing_' + Date.now(), div = document.createElement('div');
  div.className = 'message ai typing-indicator'; div.id = id;
  div.innerHTML = `<div class="msg-avatar">🤖</div><div class="msg-body"><div class="msg-role">NovaMind</div>
    <div class="msg-content"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div></div>`;
  msgs.appendChild(div); msgs.scrollTop = msgs.scrollHeight; return id;
}
function removeTyping(id) { const el = document.getElementById(id); if (el) el.remove(); }

function formatMessage(t) {
  return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\n/g,'<br>');
}
function escapeHtml(t) { return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ══ VOICE ══════════════════════════════════
function toggleVoice() {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) { showToast('Voice not supported in this browser', 'error'); return; }
  if (isListening) { stopVoice(); return; }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR(); recognition.continuous = false; recognition.interimResults = true; recognition.lang = 'en-US';
  recognition.onstart  = () => { isListening = true; document.getElementById('voiceBtn').textContent = '🔴'; document.getElementById('voiceIndicator').style.display = 'flex'; };
  recognition.onresult = e  => { const t = Array.from(e.results).map(r => r[0].transcript).join(''); document.getElementById('chatInput').value = t; autoResize(document.getElementById('chatInput')); };
  recognition.onend    = () => { isListening = false; document.getElementById('voiceBtn').textContent = '🎤'; document.getElementById('voiceIndicator').style.display = 'none'; const t = document.getElementById('chatInput').value.trim(); if (t) sendMessage(); };
  recognition.onerror  = e  => { stopVoice(); showToast('Voice error: ' + e.error, 'error'); };
  recognition.start();
}
function stopVoice() { if (recognition) recognition.stop(); isListening = false; document.getElementById('voiceBtn').textContent = '🎤'; document.getElementById('voiceIndicator').style.display = 'none'; }

// ══ SUMMARIZER ═════════════════════════════
function updateSumCharCount() { const l = document.getElementById('sumInput').value.length; document.getElementById('sumCharCount').textContent = l > 0 ? l.toLocaleString() + ' chars' : ''; }

async function runSummarizer() {
  const text = document.getElementById('sumInput').value.trim();
  if (!text) { showToast('Please enter text to summarize', 'error'); return; }
  if (!API_KEY) { showToast('Please enter your API key', 'error'); return; }
  const style = document.getElementById('sumStyle').value, btn = document.getElementById('sumBtn');
  btn.disabled = true; btn.textContent = '⏳ Working...'; document.getElementById('sumOutput').value = '';
  try { document.getElementById('sumOutput').value = await callBackendSummarize(text, style); showToast('Summary ready!', 'success'); }
  catch(err) { document.getElementById('sumOutput').value = 'Error: ' + err.message; showToast('Summarization failed', 'error'); }
  btn.disabled = false; btn.textContent = '✨ Summarize';
}
function copySummary() { const t = document.getElementById('sumOutput').value; if (!t) { showToast('Nothing to copy','error'); return; } navigator.clipboard.writeText(t).then(() => showToast('Copied!', 'success')); }

// ══ CALCULATOR ═════════════════════════════
function calcNum(n) { if (calcExpr === 'Error') calcClear(); calcExpr += n; updateCalcDisplay(); }
function calcOp(op) { if (calcExpr === 'Error') calcClear(); calcExpr += op; updateCalcDisplay(); }
function calcBackspace() { if (calcExpr === 'Error') { calcClear(); return; } calcExpr = calcExpr.slice(0,-1); updateCalcDisplay(); if (!calcExpr) document.getElementById('calcResult').textContent = '0'; }
function calcClear() { calcExpr = ''; document.getElementById('calcExpression').textContent = ''; document.getElementById('calcResult').textContent = '0'; }

function calcEquals() {
  if (!calcExpr) return;
  document.getElementById('calcExpression').textContent = calcExpr + ' =';
  try {
    const r = Function('"use strict";return(' + calcExpr.replace(/\u00d7/g,'*').replace(/\u00f7/g,'/').replace(/%/g,'/100') + ')')();
    if (!isFinite(r)) throw new Error();
    const d = Number.isInteger(r) ? r.toString() : parseFloat(r.toFixed(10)).toString();
    document.getElementById('calcResult').textContent = d;
    addCalcHistory(calcExpr + ' = ' + d); calcExpr = d;
  } catch { document.getElementById('calcResult').textContent = 'Error'; calcExpr = 'Error'; }
}

function updateCalcDisplay() {
  document.getElementById('calcExpression').textContent = calcExpr;
  try { const r = Function('"use strict";return(' + calcExpr.replace(/\u00d7/g,'*').replace(/\u00f7/g,'/').replace(/%/g,'/100') + ')')(); if (isFinite(r) && calcExpr.length > 1) document.getElementById('calcResult').textContent = parseFloat(r.toFixed(10)); } catch {}
}

function addCalcHistory(entry) {
  calcHistoryLog.unshift(entry); if (calcHistoryLog.length > 5) calcHistoryLog.pop();
  document.getElementById('calcHistory').innerHTML = calcHistoryLog.map(e => `<div class="calc-history-item" onclick="useCalcHistory('${e}')">${e}</div>`).join('');
}
function useCalcHistory(e) { const r = e.split(' = ')[1]; if (r) { calcExpr = r; updateCalcDisplay(); } }

document.addEventListener('keydown', e => {
  if (!document.getElementById('calcPanel').classList.contains('active')) return;
  if (document.activeElement === document.getElementById('aiMathInput')) return;
  if ('0123456789'.includes(e.key)) calcNum(e.key);
  else if (['+','-','*','/','.','(',')'].includes(e.key)) { e.preventDefault(); calcOp(e.key); }
  else if (e.key === '%') { e.preventDefault(); calcOp('%'); }
  else if (e.key === 'Enter' || e.key === '=') calcEquals();
  else if (e.key === 'Backspace') calcBackspace();
  else if (e.key === 'Escape') calcClear();
});

async function solveAiMath() {
  const q = document.getElementById('aiMathInput').value.trim(); if (!q) return;
  const el = document.getElementById('aiMathResult'); el.style.display = 'block';
  const local = tryLocalMath(q); if (local !== null) { el.textContent = '✅ ' + local; return; }
  if (!API_KEY) { el.textContent = 'Enter your API key for complex math problems.'; return; }
  el.textContent = '⏳ Solving...';
  try { el.textContent = await callBackendMath(q); } catch(err) { el.textContent = '⚠️ ' + err.message; }
}

function tryLocalMath(q) {
  q = q.toLowerCase().trim(); let m;
  m = q.match(/([\d.]+)%\s*of\s*([\d.]+)/); if (m) return `${m[1]}% of ${m[2]} = ${(parseFloat(m[1])/100)*parseFloat(m[2])}`;
  m = q.match(/sqrt\s*(?:of)?\s*([\d.]+)/); if (m) return `sqrt(${m[1]}) = ${Math.sqrt(parseFloat(m[1]))}`;
  m = q.match(/([\d.]+)\s*\^\s*([\d.]+)/); if (m) return `${m[1]}^${m[2]} = ${Math.pow(parseFloat(m[1]),parseFloat(m[2]))}`;
  m = q.match(/(?:what is|calculate|solve)?\s*([\d.]+)\s*([+\-*/x])\s*([\d.]+)/);
  if (m) { const a=parseFloat(m[1]),b=parseFloat(m[3]),op=m[2]; let r; if(op==='+')r=a+b; else if(op==='-')r=a-b; else if(op==='*'||op==='x')r=a*b; else if(op==='/')r=b?a/b:'undefined'; if(r!==undefined)return `${a} ${op} ${b} = ${r}`; }
  return null;
}

// ══ TOAST ══════════════════════════════════
function showToast(msg, type) {
  const t = document.getElementById('toast'); t.textContent = msg; t.className = 'toast ' + (type||'') + ' show';
  setTimeout(() => t.classList.remove('show'), 3000);
}

// ══ INIT ═══════════════════════════════════
window.addEventListener('load', () => {
  const savedKey = localStorage.getItem('nm_api_key');
  if (savedKey) { API_KEY = savedKey; document.getElementById('apiModal').style.display = 'none'; }
  else { document.getElementById('apiKeyInput').focus(); }

  if (localStorage.getItem('nm_theme') === 'light') {
    isLightTheme = true; document.body.classList.add('light-theme');
    document.getElementById('themeToggleBtn').textContent = '☀️';
  }

  const savedUser = localStorage.getItem('nm_user');
  if (savedUser) {
    currentUser = JSON.parse(savedUser); updateUserBadge();
    currentSessionId = 'session_' + Date.now(); loadHistoryList();
  } else if (savedKey) {
    setTimeout(() => { document.getElementById('authModal').style.display = 'flex'; }, 300);
  } else {
    currentSessionId = 'session_' + Date.now();
  }
});