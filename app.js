/* Family password — change this one constant if needed. */
const DEFAULT_PASSWORD = 'wafa';
const ROOM_ID = 'ws-family-room-2026';
const HISTORY_KEY = 'ws-family-room-history-v2';
const PERSON_KEY = 'ws-family-room-person-v2';
const MAX_HISTORY = 500;

const GIFT_DETAILS = {
  heart: { emoji: '❤️', label: 'A heart for you' },
  flower: { emoji: '🌸', label: 'A flower for you' },
  coffee: { emoji: '☕', label: 'Coffee together?' },
  'miss you': { emoji: '💌', label: 'Miss you' },
  'good night': { emoji: '🌙', label: 'Good night' },
  'thinking of you': { emoji: '💭', label: 'Thinking of you' },
  hug: { emoji: '🤗', label: 'A big hug' }
};

const $ = (sel) => document.querySelector(sel);
const gate = $('#gate');
const room = $('#room');
const gateForm = $('#gate-form');
const passwordInput = $('#password');
const passwordError = $('#password-error');
const personInputs = [...document.querySelectorAll('input[name="person"]')];
const messagesEl = $('#messages');
const composer = $('#composer');
const messageInput = $('#message-input');
const connectionStatus = $('#connection-status');
const statusLabel = $('#status-label');
const onlineLine = $('#online-line');
const peerNote = $('#peer-note');
const welcomeLine = $('#welcome-line');
const lastPing = $('#last-ping');
const startCallButton = $('#start-call');
const hangUpButton = $('#hang-up');
const videoGrid = $('#video-grid');
const localVideo = $('#local-video');
const remoteVideo = $('#remote-video');
const mediaError = $('#media-error');
const pttButton = $('#ptt-button');
const pttNote = $('#ptt-note');

let currentUser = '';
let remoteUser = '';
let messages = loadHistory();
let peer = null;
let isHost = false;
let ownPeerId = '';
let connections = new Map();
let peerNames = new Map();
let localStream = null;
let pttStream = null;
let pttCalls = new Map();
let pttActive = false;
let calls = new Map();
let reconnectTimer = null;
let lastConnectAttempt = 0;

function safeStorageGet(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}

function loadHistory() {
  const saved = safeStorageGet(HISTORY_KEY, []);
  return Array.isArray(saved)
    ? saved.filter((item) => item && item.id && item.createdAt).slice(-MAX_HISTORY)
    : [];
}

function saveHistory() {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(messages.slice(-MAX_HISTORY)));
  } catch {
    /* local history is a convenience */
  }
}

function makeId() {
  return window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatTime(timestamp) {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(timestamp));
}

function mediaFailReason(error) {
  const insecure =
    !window.isSecureContext &&
    location.hostname !== 'localhost' &&
    location.hostname !== '127.0.0.1';
  if (insecure || !navigator.mediaDevices?.getUserMedia) {
    return 'Needs HTTPS on phone (GitHub Pages). LAN http://192.x often blocks camera/mic.';
  }
  const name = error?.name || '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return 'Permission blocked — allow mic/camera, or just use chat.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'No mic/camera found on this device.';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'Mic/camera busy in another app.';
  }
  return error?.message || 'Mic/camera unavailable here. Chat still works.';
}

function showMediaError(text) {
  if (!mediaError) return;
  mediaError.hidden = !text;
  mediaError.textContent = text || '';
}

function renderMessages() {
  messagesEl.replaceChildren();
  if (!messages.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = '<strong>Our quiet corner 🌷</strong>Send a note or a tiny gift.<br>أهلاً بك';
    messagesEl.append(empty);
    return;
  }
  const fragment = document.createDocumentFragment();
  messages
    .slice()
    .sort((a, b) => a.createdAt - b.createdAt)
    .forEach((message) => {
      const item = document.createElement('article');
      item.className = `message${message.sender === currentUser ? ' mine' : ''}`;
      const meta = document.createElement('div');
      meta.className = 'message-meta';
      meta.textContent = `${message.sender} · ${formatTime(message.createdAt)}`;
      const bubble = document.createElement('div');
      bubble.className = message.type === 'gift' ? 'bubble gift-bubble' : 'bubble';
      if (message.type === 'gift') {
        const gift = GIFT_DETAILS[message.gift] || {
          emoji: message.emoji || '💝',
          label: message.text || 'A little gift'
        };
        const emoji = document.createElement('span');
        emoji.className = 'gift-emoji';
        emoji.textContent = gift.emoji;
        const label = document.createElement('span');
        label.className = 'gift-label';
        label.textContent = gift.label;
        bubble.append(emoji, label);
      } else {
        bubble.textContent = message.text;
      }
      item.append(meta, bubble);
      fragment.append(item);
    });
  messagesEl.append(fragment);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function setConnectionStatus(connected, label) {
  connectionStatus.classList.toggle('connected', connected);
  connectionStatus.classList.toggle('waiting', !connected);
  statusLabel.textContent = label || (connected ? 'Connected' : 'Waiting');
}

function setPeerNote(text) {
  peerNote.textContent = text;
}

function refreshOnlineLine() {
  const active = [...connections.values()].filter((conn) => conn.open);
  const names = new Set();
  if (currentUser) names.add(currentUser);
  active.forEach((conn) => {
    const named = peerNames.get(conn.peer);
    if (named) names.add(named);
  });
  if (remoteUser) names.add(remoteUser);

  if (active.length) {
    const list = [...names];
    onlineLine.textContent =
      list.length >= 2 ? `Online: ${list.join(' + ')}` : 'Linked · waiting to see their name';
  } else {
    onlineLine.textContent = currentUser ? `Only you so far (${currentUser})` : 'Only you so far';
  }
}

function openRoom(person) {
  currentUser = person;
  try {
    localStorage.setItem(PERSON_KEY, JSON.stringify(person));
  } catch {
    /* optional preference */
  }
  welcomeLine.textContent = `Hi ${person} · مرحبا ${person === 'Wafa' ? 'وفاء' : 'سامي'}`;
  gate.hidden = true;
  room.hidden = false;
  renderMessages();
  refreshOnlineLine();
  messageInput.focus();
  initializePeer();
}

function closePeer() {
  if (reconnectTimer) window.clearTimeout(reconnectTimer);
  reconnectTimer = null;
  connections.forEach((conn) => {
    try {
      conn.close();
    } catch {
      /* already closed */
    }
  });
  connections.clear();
  peerNames.clear();
  remoteUser = '';
  if (peer) {
    try {
      peer.destroy();
    } catch {
      /* already closed */
    }
  }
  peer = null;
  ownPeerId = '';
}

function lockRoom() {
  stopPtt(true);
  hangUp();
  closePeer();
  room.hidden = true;
  gate.hidden = false;
  gateForm.reset();
  passwordInput.value = '';
  passwordError.hidden = true;
  showMediaError('');
  passwordInput.focus();
}

function addMessage(message, shouldBroadcast = true) {
  if (!message || !message.id || messages.some((existing) => existing.id === message.id)) return false;
  const normalized = {
    id: String(message.id),
    sender: message.sender === 'Wafa' ? 'Wafa' : 'Sammy',
    type: message.type === 'gift' ? 'gift' : 'text',
    text: String(message.text || '').slice(0, 500),
    gift: String(message.gift || ''),
    emoji: String(message.emoji || ''),
    createdAt: Number(message.createdAt) || Date.now()
  };
  messages.push(normalized);
  messages = messages.slice(-MAX_HISTORY);
  saveHistory();
  renderMessages();
  if (shouldBroadcast) sendPacket({ kind: 'message', message: normalized });
  return true;
}

function sendText(text) {
  const cleanText = text.trim();
  if (!cleanText) return;
  addMessage({ id: makeId(), sender: currentUser, type: 'text', text: cleanText, createdAt: Date.now() });
}

function sendGift(giftName) {
  const gift = GIFT_DETAILS[giftName];
  if (!gift) return;
  addMessage({
    id: makeId(),
    sender: currentUser,
    type: 'gift',
    gift: giftName,
    emoji: gift.emoji,
    text: gift.label,
    createdAt: Date.now()
  });
}

function mergeHistory(incoming) {
  if (!Array.isArray(incoming)) return;
  let changed = false;
  incoming.slice(-MAX_HISTORY).forEach((item) => {
    if (addMessage(item, false)) changed = true;
  });
  if (changed) renderMessages();
}

function sendPacket(packet) {
  connections.forEach((conn) => {
    if (conn && conn.open) {
      try {
        conn.send(packet);
      } catch {
        /* connection may close between check and send */
      }
    }
  });
}

function updateConnectedState() {
  const active = [...connections.values()].filter((conn) => conn.open);
  if (active.length) {
    setConnectionStatus(true, 'Connected');
    setPeerNote('Live link is on · messages also save on this device.');
  } else {
    setConnectionStatus(false, 'Waiting');
    setPeerNote(
      isHost ? 'Room open · waiting for the other person.' : 'Looking for the room… chat still works offline.'
    );
  }
  refreshOnlineLine();
}

function handlePacket(packet, fromPeerId) {
  if (!packet || typeof packet !== 'object') return;
  if (packet.kind === 'hello' && packet.person) {
    peerNames.set(fromPeerId, packet.person === 'Wafa' ? 'Wafa' : 'Sammy');
    remoteUser = peerNames.get(fromPeerId);
    refreshOnlineLine();
    return;
  }
  if (packet.kind === 'message') addMessage(packet.message, false);
  if (packet.kind === 'history') mergeHistory(packet.messages);
  if (packet.kind === 'ping') sendPacket({ kind: 'pong', at: packet.at, person: currentUser });
  if (packet.kind === 'pong') {
    lastPing.textContent = `Heartbeat · ${formatTime(Date.now())}`;
    if (packet.person) {
      peerNames.set(fromPeerId, packet.person === 'Wafa' ? 'Wafa' : 'Sammy');
      remoteUser = peerNames.get(fromPeerId);
      refreshOnlineLine();
    }
  }
}

function setupConnection(conn) {
  if (!conn || conn.__familyRoomSetup) return;
  conn.__familyRoomSetup = true;
  let opened = false;
  const onOpen = () => {
    if (opened) return;
    opened = true;
    const previous = connections.get(conn.peer);
    if (previous && previous !== conn) {
      try {
        previous.close();
      } catch {
        /* replaced */
      }
    }
    connections.set(conn.peer, conn);
    setConnectionStatus(true, 'Connected');
    setPeerNote('Live link is on · messages also save on this device.');
    try {
      conn.send({ kind: 'hello', person: currentUser });
      conn.send({ kind: 'history', messages: messages.slice(-MAX_HISTORY) });
    } catch {
      /* connection closed immediately */
    }
    refreshOnlineLine();
  };
  conn.on('open', onOpen);
  conn.on('data', (data) => handlePacket(data, conn.peer));
  conn.on('close', () => {
    if (connections.get(conn.peer) === conn) connections.delete(conn.peer);
    peerNames.delete(conn.peer);
    if (![...connections.values()].some((c) => c.open)) remoteUser = '';
    updateConnectedState();
    scheduleGuestReconnect();
  });
  conn.on('error', () => {
    if (connections.get(conn.peer) === conn) connections.delete(conn.peer);
    updateConnectedState();
    scheduleGuestReconnect();
  });
  if (conn.open) onOpen();
}

function createHostPeer() {
  isHost = true;
  try {
    peer = new Peer(ROOM_ID, { debug: 0 });
  } catch {
    setPeerNote('Live link unavailable here, but local chat is ready.');
    return;
  }
  peer.on('open', (id) => {
    ownPeerId = id;
    updateConnectedState();
  });
  peer.on('connection', setupConnection);
  peer.on('call', handleIncomingCall);
  peer.on('disconnected', () => {
    setConnectionStatus(false, 'Waiting');
    setPeerNote('The link paused briefly · reconnecting…');
    try {
      peer.reconnect();
    } catch {
      /* retry on heartbeat */
    }
  });
  peer.on('error', (error) => {
    if (error?.type === 'unavailable-id') {
      try {
        peer.destroy();
      } catch {
        /* replaced below */
      }
      createGuestPeer();
    } else if (error?.type !== 'peer-unavailable') {
      setPeerNote('Live link is taking a moment · local chat is ready.');
    }
  });
}

function createGuestPeer() {
  isHost = false;
  try {
    peer = new Peer(undefined, { debug: 0 });
  } catch {
    setPeerNote('Live link unavailable here, but local chat is ready.');
    return;
  }
  peer.on('open', (id) => {
    ownPeerId = id;
    connectToHost();
  });
  peer.on('call', handleIncomingCall);
  peer.on('disconnected', () => {
    try {
      peer.reconnect();
    } catch {
      /* retry below */
    }
  });
  peer.on('error', (error) => {
    if (error?.type !== 'peer-unavailable') {
      setPeerNote('Looking for the room… chat still works offline.');
    }
  });
}

function connectToHost() {
  if (!peer || peer.destroyed || !ownPeerId || Date.now() - lastConnectAttempt < 3500) return;
  lastConnectAttempt = Date.now();
  setPeerNote('Looking for the room…');
  try {
    setupConnection(peer.connect(ROOM_ID, { reliable: true }));
  } catch {
    scheduleGuestReconnect();
  }
}

function scheduleGuestReconnect() {
  if (isHost || reconnectTimer || !room || room.hidden) return;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    if (![...connections.values()].some((conn) => conn.open)) connectToHost();
  }, 7000);
}

function initializePeer() {
  if (!window.Peer) {
    setPeerNote('Live link needs internet; local chat is ready.');
    return;
  }
  closePeer();
  setConnectionStatus(false, 'Waiting');
  setPeerNote('Opening the private link…');
  refreshOnlineLine();
  createHostPeer();
}

function heartbeat() {
  if (room.hidden) return;
  const active = [...connections.values()].filter((conn) => conn.open);
  if (active.length) {
    active.forEach((conn) => {
      try {
        conn.send({ kind: 'ping', at: Date.now(), person: currentUser });
      } catch {
        /* next heartbeat will retry */
      }
    });
    lastPing.textContent = `Heartbeat · ${formatTime(Date.now())}`;
  } else {
    updateConnectedState();
    scheduleGuestReconnect();
  }
}

async function getLocalStream(video = true) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw Object.assign(new Error(mediaFailReason()), { name: 'SecurityError' });
  }
  if (video && localStream) return localStream;
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: true,
    video: video
      ? { facingMode: 'user', width: { ideal: 320, max: 640 }, height: { ideal: 240, max: 480 } }
      : false
  });
  if (video) {
    localStream = stream;
    localVideo.srcObject = localStream;
    videoGrid.hidden = false;
  }
  return stream;
}

function setupCall(call) {
  if (!call) return;
  calls.set(call.peer, call);
  call.on('stream', (stream) => {
    remoteVideo.srcObject = stream;
    videoGrid.hidden = false;
  });
  call.on('close', () => {
    calls.delete(call.peer);
    if (!calls.size) hangUp(false);
  });
  call.on('error', () => {
    calls.delete(call.peer);
    setPeerNote('Light call ended; chat is still connected.');
  });
  hangUpButton.hidden = false;
  startCallButton.hidden = true;
}

async function startCall() {
  const active = [...connections.values()].filter((conn) => conn.open);
  if (!active.length || !peer) {
    setPeerNote('Wait until Connected before starting a call.');
    return;
  }
  showMediaError('');
  try {
    const stream = await getLocalStream(true);
    active.forEach((conn) => {
      try {
        setupCall(peer.call(conn.peer, stream));
      } catch {
        /* call may race */
      }
    });
    setPeerNote('Light call is on · chat remains below.');
  } catch (error) {
    const reason = mediaFailReason(error);
    showMediaError(reason);
    setPeerNote(reason);
  }
}

async function handleIncomingCall(call) {
  const isPtt = !!(call.metadata && call.metadata.ptt);
  try {
    let stream;
    try {
      stream = await getLocalStream(!isPtt);
    } catch (videoErr) {
      if (!isPtt) showMediaError(mediaFailReason(videoErr));
      stream = await getLocalStream(false);
    }
    call.answer(stream);
    if (isPtt) {
      call.on('stream', (remote) => {
        // Play remote PTT audio through a hidden audio element path via remote video element.
        remoteVideo.srcObject = remote;
      });
      call.on('close', () => {});
      setPeerNote('Push-to-talk audio coming in…');
    } else {
      setupCall(call);
      setPeerNote('Call connected · chat remains below.');
    }
  } catch (error) {
    call.answer();
    if (!isPtt) setupCall(call);
    const reason = mediaFailReason(error);
    showMediaError(reason);
    setPeerNote(reason);
  }
}

function hangUp(stopStream = true) {
  calls.forEach((call) => {
    try {
      call.close();
    } catch {
      /* already closed */
    }
  });
  calls.clear();
  if (stopStream && localStream) {
    localStream.getTracks().forEach((track) => track.stop());
    localStream = null;
  }
  localVideo.srcObject = null;
  remoteVideo.srcObject = null;
  videoGrid.hidden = true;
  hangUpButton.hidden = true;
  startCallButton.hidden = false;
}

async function startPtt(event) {
  if (event) event.preventDefault();
  if (pttActive) return;
  const active = [...connections.values()].filter((conn) => conn.open);
  if (!active.length || !peer) {
    pttNote.hidden = false;
    pttNote.textContent = 'Wait until the big pill says Connected.';
    return;
  }
  pttNote.hidden = true;
  showMediaError('');
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error(mediaFailReason()), { name: 'SecurityError' });
    pttStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    pttActive = true;
    pttButton.classList.add('live');
    pttButton.setAttribute('aria-pressed', 'true');
    pttButton.textContent = 'Talking… release to stop';
    active.forEach((conn) => {
      try {
        const call = peer.call(conn.peer, pttStream, { metadata: { ptt: true } });
        pttCalls.set(conn.peer, call);
        call.on('close', () => pttCalls.delete(conn.peer));
        call.on('error', () => pttCalls.delete(conn.peer));
      } catch {
        /* race with reconnect */
      }
    });
  } catch (error) {
    const reason = mediaFailReason(error);
    pttNote.hidden = false;
    pttNote.textContent = reason;
    showMediaError(reason);
    stopPtt(true);
  }
}

function stopPtt(force = false) {
  if (!pttActive && !force) return;
  pttActive = false;
  pttButton.classList.remove('live');
  pttButton.setAttribute('aria-pressed', 'false');
  pttButton.textContent = 'Hold to talk';
  pttCalls.forEach((call) => {
    try {
      call.close();
    } catch {
      /* closed */
    }
  });
  pttCalls.clear();
  if (pttStream) {
    pttStream.getTracks().forEach((track) => track.stop());
    pttStream = null;
  }
}

gateForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const person = personInputs.find((input) => input.checked)?.value;
  if (passwordInput.value !== DEFAULT_PASSWORD || !person) {
    passwordError.hidden = false;
    passwordInput.setAttribute('aria-invalid', 'true');
    return;
  }
  passwordError.hidden = true;
  passwordInput.removeAttribute('aria-invalid');
  openRoom(person);
});

composer.addEventListener('submit', (event) => {
  event.preventDefault();
  sendText(messageInput.value);
  messageInput.value = '';
  messageInput.focus();
});

document.querySelectorAll('.gift-button').forEach((button) =>
  button.addEventListener('click', () => sendGift(button.dataset.gift))
);
document.querySelectorAll('.emoji-button').forEach((button) =>
  button.addEventListener('click', () => {
    messageInput.value += button.dataset.emoji;
    messageInput.focus();
  })
);
$('#lock-button').addEventListener('click', lockRoom);
startCallButton.addEventListener('click', startCall);
hangUpButton.addEventListener('click', () => hangUp());

pttButton.addEventListener('pointerdown', startPtt);
pttButton.addEventListener('pointerup', () => stopPtt());
pttButton.addEventListener('pointercancel', () => stopPtt());
pttButton.addEventListener('pointerleave', () => {
  if (pttActive) stopPtt();
});
pttButton.addEventListener('keydown', (e) => {
  if (e.code === 'Space' || e.key === ' ') {
    e.preventDefault();
    startPtt(e);
  }
});
pttButton.addEventListener('keyup', (e) => {
  if (e.code === 'Space' || e.key === ' ') {
    e.preventDefault();
    stopPtt();
  }
});

const savedPerson = safeStorageGet(PERSON_KEY, '');
if (savedPerson === 'Sammy' || savedPerson === 'Wafa') {
  const savedInput = personInputs.find((input) => input.value === savedPerson);
  if (savedInput) savedInput.checked = true;
}
renderMessages();
window.setInterval(heartbeat, 20000);
window.addEventListener('beforeunload', () => {
  stopPtt(true);
  hangUp();
  closePeer();
});
