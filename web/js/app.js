// FreeCore-Mind Production Frontend Controller
let currentSessionId = null;
let currentSessionObj = null;
let sessions = [];
let groups = [];
let archivedSessions = [];
let providers = [];
let customization = {
  appName: "FreeCore-Mind",
  appAvatar: "assets/CoreNyan.png",
  userName: "LynnH",
  userAvatar: "assets/doodle/doodle_1.png",
  userColor: "#f472b6",
  userBubbleBg: "#1f1b29",
  agentName: "小可",
  agentAvatar: "assets/CoreNyan.png",
  agentColor: "#38bdf8",
  agentBubbleBg: "#161b22",
  appBg: "#0d1117",
  sidebarBg: "#090d13",
  sendKey: "enter"
};
let attachedImages = [];
let contextMenuTargetId = null;
let groupContextMenuTargetId = null;
let currentUser = null;
function setUserAvatar(img, user) {
  if (!img || !user) return;
  // 1. 如果账户提供了 avatar（例如 FreeCore-Account 正版 Mojang 头像端点），优先采用
  if (user.avatar && !user.avatar.includes('doodle_1.png')) {
    img.src = user.avatar;
    return;
  }
  // 2. 存在正版 UUID，使用官方 minotar 渲染（避免第三方源 403）
  if (user.minecraftUuid) {
    const cleanUuid = String(user.minecraftUuid).replace(/-/g, '');
    img.src = `https://account.lynnhma.xyz/api/avatar/mojang/${cleanUuid}`;
    img.onerror = () => {
      img.src = `https://minotar.net/helm/${cleanUuid}/64.png`;
    };
    return;
  }
  // 3. 兜底回退按昵称渲染
  const name = user.nickname || 'LynnH_Ma';
  img.src = `https://minotar.net/helm/${encodeURIComponent(name)}/64.png`;
}
let sessionLoadVersion = 0;

// Login & Auth Elements
const loginOverlayEl = document.getElementById('loginOverlay');
const loginUsernameEl = document.getElementById('loginUsername');
const loginPasswordEl = document.getElementById('loginPassword');
const btnLoginSubmitEl = document.getElementById('btnLoginSubmit');
const btnLauncherLoginEl = document.getElementById('btnLauncherLogin');
const loginErrorEl = document.getElementById('loginError');
const currentUserBadgeEl = document.getElementById('currentUserBadge');
const currentUserAvatarImgEl = document.getElementById('currentUserAvatarImg');
const currentUserNameLabelEl = document.getElementById('currentUserNameLabel');
const btnLogoutEl = document.getElementById('btnLogout');

// Check Auth Status & Enforce Gate
async function checkAuthAndInit() {
  try {
    const res = await fetch('/api/auth/status');
    const data = await res.json();
    if (data.authenticated && data.user) {
      currentUser = data.user;
      const userAvatar = currentUser.avatar || (currentUser.minecraftUuid ? `https://account.lynnhma.xyz/api/avatar/mojang/${currentUser.minecraftUuid}` : `https://minotar.net/helm/${encodeURIComponent(currentUser.nickname)}/64.png`);
      loginOverlayEl.style.display = 'none';
      currentUserBadgeEl.style.display = 'inline-flex';
      currentUserNameLabelEl.textContent = currentUser.nickname;
      if (currentUserAvatarImgEl) {
        setUserAvatar(currentUserAvatarImgEl, currentUser);
      }
      customization.userName = currentUser.nickname;
      customization.userAvatar = userAvatar;
      initApp();
    } else {
      loginOverlayEl.style.display = 'flex';
    }
  } catch(e) {
    loginOverlayEl.style.display = 'flex';
  }
}

btnLauncherLoginEl.addEventListener('click', async () => {
  loginErrorEl.style.display = 'none';
  btnLauncherLoginEl.disabled = true;
  btnLauncherLoginEl.textContent = '正在连接 FreeCore-Account...';
  try {
    const start = await fetch('/api/auth/launcher/start');
    const data = await start.json();
    if (!start.ok || !data.authorizationUrl) throw new Error(data.error || '授权初始化失败');
    window.open(data.authorizationUrl, '_blank', 'noopener,noreferrer');
    const deadline = Date.now() + 10 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 1500));
      const result = await fetch(`/api/auth/launcher/callback?state=${encodeURIComponent(data.state)}`, { cache: 'no-store' });
      const body = await result.json().catch(() => ({}));
      if (result.status === 202 || body.pending === true) continue;
      if (!result.ok || !body.authenticated) throw new Error(body.error || '授权未完成');
      currentUser = body.user;
      const userAvatar = currentUser.avatar || (currentUser.minecraftUuid ? `https://account.lynnhma.xyz/api/avatar/mojang/${currentUser.minecraftUuid}` : `https://minotar.net/helm/${encodeURIComponent(currentUser.nickname)}/64.png`);
      loginOverlayEl.style.display = 'none';
      currentUserBadgeEl.style.display = 'inline-flex';
      currentUserNameLabelEl.textContent = currentUser.nickname;
      setUserAvatar(currentUserAvatarImgEl, currentUser);
      customization.userName = currentUser.nickname;
      customization.userAvatar = currentUser.avatar;
      showToast(`欢迎回来，${currentUser.nickname}`);
      initApp();
      return;
    }
    throw new Error('授权等待超时');
  } catch (error) {
    loginErrorEl.textContent = error.message || '授权登录失败';
    loginErrorEl.style.display = 'block';
  } finally {
    btnLauncherLoginEl.disabled = false;
    btnLauncherLoginEl.textContent = '使用 FreeCore-Account 授权登录';
  }
});

btnLoginSubmitEl?.remove();

/* Legacy password handlers are intentionally disabled. */
/*
btnLoginSubmitEl.addEventListener('click', async () => {
  const username = loginUsernameEl.value.trim();
  const password = loginPasswordEl.value;
  if (!username || !password) {
    loginErrorEl.textContent = '请输入账号与密码';
    loginErrorEl.style.display = 'block';
    return;
  }
  loginErrorEl.style.display = 'none';
  btnLoginSubmitEl.disabled = true;
  btnLoginSubmitEl.textContent = '登录中...';

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      currentUser = data.user;
      const userAvatar = currentUser.avatar || (currentUser.minecraftUuid ? `https://account.lynnhma.xyz/api/avatar/mojang/${currentUser.minecraftUuid}` : `https://minotar.net/helm/${encodeURIComponent(currentUser.nickname)}/64.png`);
      loginOverlayEl.style.display = 'none';
      currentUserBadgeEl.style.display = 'inline-flex';
      currentUserNameLabelEl.textContent = currentUser.nickname;
      if (currentUserAvatarImgEl) {
        setUserAvatar(currentUserAvatarImgEl, currentUser);
      }
      customization.userName = currentUser.nickname;
      customization.userAvatar = userAvatar;
      showToast(`欢迎回来，${currentUser.nickname}`);
      initApp();
    } else {
      loginErrorEl.textContent = data.error || '登录失败';
      loginErrorEl.style.display = 'block';
    }
  } catch(e) {
    loginErrorEl.textContent = '连接服务失败: ' + e.message;
    loginErrorEl.style.display = 'block';
  } finally {
    btnLoginSubmitEl.disabled = false;
    btnLoginSubmitEl.textContent = '登 录';
  }
});

loginPasswordEl?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') btnLauncherLoginEl.click();
});
*/

btnLogoutEl.addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  currentUser = null;
  currentUserBadgeEl.style.display = 'none';
  loginOverlayEl.style.display = 'flex';
});

// DOM References
const sidebarEl = document.getElementById('sidebar');
const toggleSidebarBtnEl = document.getElementById('toggleSidebarBtn');
const expandSidebarBtnEl = document.getElementById('expandSidebarBtn');
const mobileDrawerBackdropEl = document.getElementById('mobileDrawerBackdrop');

function openMobileSidebar() {
  sidebarEl.classList.add('mobile-open');
  if (mobileDrawerBackdropEl) mobileDrawerBackdropEl.style.display = 'block';
}

function closeMobileSidebar() {
  sidebarEl.classList.remove('mobile-open');
  if (mobileDrawerBackdropEl) mobileDrawerBackdropEl.style.display = 'none';
}

if (mobileDrawerBackdropEl) {
  mobileDrawerBackdropEl.addEventListener('click', closeMobileSidebar);
}

const appNameTextEl = document.getElementById('appNameText');
const appAvatarImgEl = document.getElementById('appAvatarImg');

const sessionListEl = document.getElementById('sessionList');
const currentSessionTitleEl = document.getElementById('currentSessionTitle');
const chatMessagesEl = document.getElementById('chatMessages');
const chatInputEl = document.getElementById('chatInput');
const sendBtnEl = document.getElementById('sendBtn');
const newChatBtnEl = document.getElementById('newChatBtn');
const btnNewGroupEl = document.getElementById('btnNewGroup');
const sessionSearchEl = document.getElementById('sessionSearch');
const fileInputEl = document.getElementById('fileInput');
const btnOpenRecycleEl = document.getElementById('btnOpenRecycle');
const recycleCountBadgeEl = document.getElementById('recycleCountBadge');

const modelSelectEl = document.getElementById('modelSelect');
const modelPickerTriggerEl = document.getElementById('modelPickerTrigger');
const modelPickerCurrentTextEl = document.getElementById('modelPickerCurrentText');
const modelPickerDropdownEl = document.getElementById('modelPickerDropdown');
const modelPickerSearchEl = document.getElementById('modelPickerSearch');
const modelPickerListEl = document.getElementById('modelPickerList');
const thinkingSelectEl = document.getElementById('thinkingSelect');
const btnCompactEl = document.getElementById('btnCompact');
const imagePreviewBarEl = document.getElementById('imagePreviewBar');

const sessionContextMenuEl = document.getElementById('sessionContextMenu');
const ctxPinEl = document.getElementById('ctxPin');
const ctxRenameEl = document.getElementById('ctxRename');
const ctxSubmenuGroupsEl = document.getElementById('ctxSubmenuGroups');
const ctxArchiveEl = document.getElementById('ctxArchive');
const ctxDeleteEl = document.getElementById('ctxDelete');

const groupContextMenuEl = document.getElementById('groupContextMenu');
const ctxGroupRenameEl = document.getElementById('ctxGroupRename');
const ctxGroupDeleteEl = document.getElementById('ctxGroupDelete');

const fmContextMenuEl = document.getElementById('fmContextMenu');
const ctxFmRenameEl = document.getElementById('ctxFmRename');
const ctxFmCopyEl = document.getElementById('ctxFmCopy');
const ctxFmPasteEl = document.getElementById('ctxFmPaste');
const ctxFmDeleteEl = document.getElementById('ctxFmDelete');

// Clipboard buffer for file manager
let fmClipboardPath = null;
let fmContextMenuTarget = null; // { apiBase, relPath, isDir, parentDir }

const modalOverlayEl = document.getElementById('modalOverlay');
const modalTitleEl = document.getElementById('modalTitle');
const modalContentEl = document.getElementById('modalContent');
const modalCloseEl = document.getElementById('modalClose');
const toastNoticeEl = document.getElementById('toastNotice');

const btnSkillsEl = document.getElementById('btnSkills');
const btnMemoryEl = document.getElementById('btnMemory');
const btnPluginsEl = document.getElementById('btnPlugins');
const btnSettingsEl = document.getElementById('btnSettings');
const btnToolAuditEl = document.getElementById('btnToolAudit');

// Toast notification helper
let toastTimer = null;
function showToast(msg, duration = 2200) {
  if (toastTimer) clearTimeout(toastTimer);
  toastNoticeEl.textContent = msg;
  toastNoticeEl.classList.add('show');
  toastTimer = setTimeout(() => {
    toastNoticeEl.classList.remove('show');
  }, duration);
}

// Copy to clipboard helper (Ultra-clean temporary button check feedback without ugly black box push)
window.copyText = (text, btnEl = null) => {
  const doFeedback = () => {
    if (btnEl) {
      const origHtml = btnEl.innerHTML;
      btnEl.innerHTML = `<span style="color: #3fb950; font-size: 11px; display: inline-flex; align-items: center; gap: 2px;">✓ 已复制</span>`;
      setTimeout(() => {
        btnEl.innerHTML = origHtml;
      }, 1400);
    } else {
      showToast('已复制到剪贴板');
    }
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(doFeedback).catch(() => {
      fallbackCopy(text, doFeedback);
    });
  } else {
    fallbackCopy(text, doFeedback);
  }
};

function fallbackCopy(text, cb) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
  cb?.();
}

// Edit & Delete Single Message
window.editMessageInSession = (index) => {
  if (!currentSessionObj || !currentSessionObj.messages?.[index]) return;
  const msg = currentSessionObj.messages[index];
  const msgId = msg.id || (msg.time ? String(msg.time) : String(index));
  const newContent = prompt('修改此条消息内容：', msg.content || '');
  if (newContent !== null && newContent.trim() !== (msg.content || '').trim()) {
    fetch(`/api/sessions/${currentSessionId}/messages/${msgId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: newContent })
    }).then(res => res.json()).then(data => {
      if (data.success) {
        msg.content = newContent;
        renderMessages(currentSessionObj.messages);
        showToast('消息已修改保存');
      } else {
        alert(data.error || '修改失败');
      }
    });
  }
};

window.deleteMessageInSession = (index) => {
  if (!currentSessionObj || !currentSessionObj.messages?.[index]) return;
  const msg = currentSessionObj.messages[index];
  const msgId = msg.id || (msg.time ? String(msg.time) : String(index));
  if (confirm('确认删除此条对话记录吗？')) {
    fetch(`/api/sessions/${currentSessionId}/messages/${msgId}`, {
      method: 'DELETE'
    }).then(res => res.json()).then(data => {
      if (data.success) {
        currentSessionObj.messages.splice(index, 1);
        renderMessages(currentSessionObj.messages);
        showToast('消息已删除');
      } else {
        alert(data.error || '删除失败');
      }
    });
  }
};

// Lightbox Viewer Logic
const imageLightboxEl = document.getElementById('imageLightbox');
const lightboxImgEl = document.getElementById('lightboxImg');
const lbBtnDownloadEl = document.getElementById('lbBtnDownload');
const lbBtnCloseEl = document.getElementById('lbBtnClose');
let currentLightboxUrl = '';
let currentZoomScale = 1;

window.openImageLightbox = (url) => {
  currentLightboxUrl = url;
  currentZoomScale = 1;
  lightboxImgEl.src = url;
  lightboxImgEl.style.transform = `scale(${currentZoomScale})`;
  imageLightboxEl.style.display = 'flex';
};

lbBtnCloseEl.addEventListener('click', () => {
  imageLightboxEl.style.display = 'none';
});

imageLightboxEl.addEventListener('click', (e) => {
  if (e.target === imageLightboxEl || e.target.id === 'lightboxContainer') {
    imageLightboxEl.style.display = 'none';
  }
});

lightboxImgEl.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (e.deltaY < 0) {
    currentZoomScale = Math.min(currentZoomScale + 0.15, 3.5);
  } else {
    currentZoomScale = Math.max(currentZoomScale - 0.15, 0.5);
  }
  lightboxImgEl.style.transform = `scale(${currentZoomScale})`;
});

lbBtnDownloadEl.addEventListener('click', () => {
  if (!currentLightboxUrl) return;
  const a = document.createElement('a');
  a.href = currentLightboxUrl;
  a.download = currentLightboxUrl.split('/').pop() || 'download-image.png';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  showToast('原图已开始下载');
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && imageLightboxEl.style.display !== 'none') {
    imageLightboxEl.style.display = 'none';
  }
});
toggleSidebarBtnEl.addEventListener('click', () => {
  if (window.innerWidth <= 768) {
    closeMobileSidebar();
  } else {
    sidebarEl.classList.add('collapsed');
    expandSidebarBtnEl.style.display = 'flex';
  }
});

expandSidebarBtnEl.addEventListener('click', () => {
  if (window.innerWidth <= 768) {
    openMobileSidebar();
  } else {
    sidebarEl.classList.remove('collapsed');
    expandSidebarBtnEl.style.display = 'none';
  }
});

// Steer / Queue Intervene Action Triggers
const composerInterveneGroupEl = document.getElementById('composerInterveneGroup');
const btnSteerEl = document.getElementById('btnSteer');
const btnQueueEl = document.getElementById('btnQueue');
const btnStopTaskEl = document.getElementById('btnStopTask');

let isTaskRunning = false;

function setTaskRunningState(running) {
  isTaskRunning = running;
  if (running) {
    composerInterveneGroupEl.style.display = 'inline-flex';
    sendBtnEl.style.display = 'none';
  } else {
    composerInterveneGroupEl.style.display = 'none';
    sendBtnEl.style.display = 'inline-flex';
    sendBtnEl.disabled = false;
  }
}

btnSteerEl.addEventListener('click', async () => {
  const text = chatInputEl.value.trim();
  const images = [...attachedImages];
  if (!text && images.length === 0) return alert('请输入插话指令内容');
  if (!currentSessionId) return;

  chatInputEl.value = '';
  chatInputEl.style.height = 'auto';
  attachedImages = [];
  renderImagePreviews();

  await fetch('/api/chat/steer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: currentSessionId, message: text, images })
  });
  showToast('已直接插队：指令将在当前工具执行后优先响应');
});

btnQueueEl.addEventListener('click', async () => {
  const text = chatInputEl.value.trim();
  const images = [...attachedImages];
  if (!text && images.length === 0) return alert('请输入排队指令内容');
  if (!currentSessionId) return;

  chatInputEl.value = '';
  chatInputEl.style.height = 'auto';
  attachedImages = [];
  renderImagePreviews();

  const selectedVal = modelSelectEl.value || '';
  const [providerId, modelId] = selectedVal.split('::');

  await fetch('/api/chat/queue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: currentSessionId,
      message: text,
      images,
      providerId: providerId || undefined,
      model: modelId || undefined,
      thinkingEffort: thinkingSelectEl.value
    })
  });
  showToast('已排队：本轮执行完成后自动触发本条指令');
});

btnStopTaskEl.addEventListener('click', async () => {
  if (!currentSessionId) return;
  await fetch('/api/chat/interrupt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: currentSessionId })
  });
  showToast('已发送任务中断信号');
  setTaskRunningState(false);
});
fileInputEl.addEventListener('change', (e) => {
  const files = e.target.files;
  if (!files || files.length === 0) return;
  for (const file of files) {
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (event) => {
        addImageAttachment(event.target.result);
      };
      reader.readAsDataURL(file);
    }
  }
  fileInputEl.value = '';
});

// Clipboard image paste & Drag-and-drop
chatInputEl.addEventListener('paste', async (e) => {
  const items = e.clipboardData?.items;
  if (!items) return;

  for (const item of items) {
    if (item.type.indexOf('image') !== -1) {
      e.preventDefault();
      const file = item.getAsFile();
      const reader = new FileReader();
      reader.onload = (event) => {
        addImageAttachment(event.target.result);
      };
      reader.readAsDataURL(file);
    }
  }
});

chatInputEl.addEventListener('dragover', (e) => { e.preventDefault(); });
chatInputEl.addEventListener('drop', (e) => {
  e.preventDefault();
  const files = e.dataTransfer?.files;
  if (!files) return;
  for (const file of files) {
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (event) => {
        addImageAttachment(event.target.result);
      };
      reader.readAsDataURL(file);
    }
  }
});

function addImageAttachment(dataUrl) {
  attachedImages.push(dataUrl);
  renderImagePreviews();
}

function renderImagePreviews() {
  if (attachedImages.length === 0) {
    imagePreviewBarEl.style.display = 'none';
    imagePreviewBarEl.innerHTML = '';
    return;
  }
  imagePreviewBarEl.style.display = 'flex';
  imagePreviewBarEl.innerHTML = '';
  attachedImages.forEach((img, idx) => {
    const box = document.createElement('div');
    box.className = 'preview-thumb-box';
    box.innerHTML = `
      <img src="${img}" class="preview-thumb" alt="attachment">
      <button class="preview-remove-btn" onclick="removeImageAttachment(${idx})">×</button>
    `;
    imagePreviewBarEl.appendChild(box);
  });
}

window.removeImageAttachment = (idx) => {
  attachedImages.splice(idx, 1);
  renderImagePreviews();
};

// Textarea auto resize
chatInputEl.addEventListener('input', () => {
  chatInputEl.style.height = 'auto';
  chatInputEl.style.height = Math.min(chatInputEl.scrollHeight, 170) + 'px';
});

// Configurable Send Shortcut Handler
chatInputEl.addEventListener('keydown', (e) => {
  const sendKey = customization.sendKey || 'enter';

  if (sendKey === 'ctrl_enter') {
    // Ctrl + Enter to Send, Enter to Newline
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      sendMessage();
    }
  } else {
    // Enter to Send, Shift + Enter to Newline
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      sendMessage();
    }
  }
});

sendBtnEl.addEventListener('click', sendMessage);
newChatBtnEl.addEventListener('click', () => createNewChat('default'));

btnNewGroupEl.addEventListener('click', async () => {
  const gName = prompt('请输入新组名称：');
  if (gName && gName.trim()) {
    await fetch('/api/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: gName.trim() })
    });
    showToast('分组已创建');
    loadGroupsAndSessions();
  }
});

// Manual Compaction
if (btnCompactEl) {
  btnCompactEl.addEventListener('click', async () => {
    if (!currentSessionId) return;
    if (!confirm('确定对当前会话执行上下文压缩吗？系统将提炼 Checkpoint 摘要并折叠旧历史。')) return;

    const ringProgress = document.getElementById('contextRingProgress');
    const ringText = document.getElementById('contextRingText');
    if (ringText) ringText.textContent = '...';
    try {
      const res = await fetch('/api/compact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: currentSessionId })
      });
      const r = await res.json();
      if (res.ok) {
        showToast('上下文压缩完成');
        selectSession(currentSessionId);
      } else {
        alert(r.error || '压缩未触发');
      }
    } catch(e) {
      alert('请求失败: ' + e.message);
    } finally {
      computeSessionContextRatio();
    }
  });
}

modalCloseEl.addEventListener('click', () => {
  modalOverlayEl.style.display = 'none';
});

modalOverlayEl.addEventListener('click', (e) => {
  if (e.target === modalOverlayEl) modalOverlayEl.style.display = 'none';
});

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${m}-${day} ${h}:${min}`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Load and Apply Full Customization
async function loadCustomization() {
  try {
    const res = await fetch('/api/customization');
    if (res.ok) {
      customization = await res.json();
      applyCustomization();
    }
  } catch(e) {}
}

function applyCustomization() {
  appNameTextEl.textContent = customization.appName || 'FreeCore-Mind';
  document.title = customization.appName || 'FreeCore-Mind';
  if (customization.appAvatar) {
    appAvatarImgEl.src = customization.appAvatar;
  }

  // Update input placeholder according to configured shortcut
  const isCtrlEnter = (customization.sendKey === 'ctrl_enter');
  chatInputEl.placeholder = `输入任务指令... (${isCtrlEnter ? 'Ctrl+Enter 发送, Enter 换行' : 'Enter 发送, Shift+Enter 换行'})`;

  const root = document.documentElement;
  if (customization.userColor) root.style.setProperty('--user-theme-color', customization.userColor);
  if (customization.agentColor) root.style.setProperty('--agent-theme-color', customization.agentColor);
  if (customization.userBubbleBg) root.style.setProperty('--bg-card-user', customization.userBubbleBg);
  if (customization.agentBubbleBg) root.style.setProperty('--bg-card', customization.agentBubbleBg);
  if (customization.appBg) root.style.setProperty('--bg-app', customization.appBg);
  if (customization.sidebarBg) root.style.setProperty('--bg-sidebar', customization.sidebarBg);
}

// Load Providers & Models
function renderCustomModelPicker(filter = '') {
  if (!modelPickerListEl) return;
  modelPickerListEl.innerHTML = '';
  const search = filter.toLowerCase().trim();

  let firstFound = null;

  providers.forEach(p => {
    const matchedModels = (p.models || []).filter(m => {
      const name = (m.name || m.id).toLowerCase();
      const pName = (p.name || '').toLowerCase();
      return name.includes(search) || pName.includes(search);
    });

    if (matchedModels.length === 0) return;

    const grpLabel = document.createElement('div');
    grpLabel.className = 'model-picker-group-label';
    grpLabel.textContent = p.name;
    modelPickerListEl.appendChild(grpLabel);

    matchedModels.forEach(m => {
      const val = `${p.id}::${m.id}`;
      if (!firstFound) firstFound = { val, name: m.name || m.id };

      const item = document.createElement('div');
      item.className = `model-picker-item ${modelSelectEl.value === val ? 'selected' : ''}`;
      item.innerHTML = `
        <span>${escapeHtml(m.name || m.id)}</span>
        <span class="item-check">✓</span>
      `;

      item.onclick = (e) => {
        e.stopPropagation();
        modelSelectEl.value = val;
        modelPickerCurrentTextEl.textContent = m.name || m.id;
        modelPickerDropdownEl.classList.remove('active');
        renderCustomModelPicker(modelPickerSearchEl?.value || '');
      };

      modelPickerListEl.appendChild(item);
    });
  });

  if (!modelSelectEl.value && firstFound) {
    modelSelectEl.value = firstFound.val;
    modelPickerCurrentTextEl.textContent = firstFound.name;
  }
}

// Bind Model Picker Trigger and Outside Click
if (modelPickerTriggerEl) {
  modelPickerTriggerEl.onclick = (e) => {
    e.stopPropagation();
    const isActive = modelPickerDropdownEl.classList.toggle('active');
    if (isActive) {
      modelPickerSearchEl.value = '';
      renderCustomModelPicker('');
      setTimeout(() => modelPickerSearchEl.focus(), 50);
    }
  };

  modelPickerSearchEl.onclick = (e) => e.stopPropagation();
  modelPickerSearchEl.oninput = (e) => {
    renderCustomModelPicker(e.target.value);
  };

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.model-custom-picker-wrap')) {
      modelPickerDropdownEl.classList.remove('active');
    }
  });
}

async function loadProviders() {
  try {
    const res = await fetch('/api/providers');
    if (res.ok) {
      providers = await res.json();
      renderCustomModelPicker();
      // Set current selected model label if preset
      if (providers.length > 0 && providers[0].models?.length > 0) {
        const p = providers[0];
        const m = p.models[0];
        if (!modelSelectEl.value) {
          modelSelectEl.value = `${p.id}::${m.id}`;
          modelPickerCurrentTextEl.textContent = m.name || m.id;
        }
      }
    }
  } catch(e) {
    console.error('Failed to load providers:', e);
  }
}

// Load Groups & Sessions
async function loadGroupsAndSessions() {
  try {
    const [resGroups, resSessions, resArchived] = await Promise.all([
      fetch('/api/groups'),
      fetch('/api/sessions'),
      fetch('/api/sessions?archived=true')
    ]);

    if (resGroups.ok) {
      const gData = await resGroups.json();
      if (Array.isArray(gData) && gData.length > 0) {
        groups = gData;
      }
    }
    if (resSessions.ok) {
      const sData = await resSessions.json();
      if (Array.isArray(sData)) {
        sessions = sData;
      }
    }
    if (resArchived.ok) {
      const aData = await resArchived.json();
      if (Array.isArray(aData)) {
        archivedSessions = aData;
        recycleCountBadgeEl.textContent = archivedSessions.length;
      }
    }

    renderGroupsAndSessions(sessionSearchEl.value);

    // If active session not selected, select the first session or create new
    if (sessions.length > 0) {
      const exists = sessions.some(s => s.id === currentSessionId);
      if (!currentSessionId || !exists) {
        selectSession(sessions[0].id);
      }
    } else {
      createNewChat('default');
    }
  } catch(e) {
    console.error('Failed to load groups and sessions:', e);
    // If sessions array has items in memory, still render
    if (sessions.length > 0) {
      renderGroupsAndSessions(sessionSearchEl.value);
    }
  }
}

// Drag-and-drop state & Collapsed groups state persistence
let draggedType = null; // 'group' or 'session'
let draggedId = null;
let collapsedGroupIds = new Set();

// Render Accordion Groups and Sessions
function renderGroupsAndSessions(filter = '') {
  sessionListEl.innerHTML = '';

  const groupMap = new Map();
  groups.forEach(g => groupMap.set(g.id, []));
  if (!groupMap.has('default')) groupMap.set('default', []);

  // Place sessions into respective groups
  sessions.forEach(s => {
    const gId = s.groupId || 'default';
    if (!groupMap.has(gId)) groupMap.set(gId, []);
    groupMap.get(gId).push(s);
  });

  let totalMatched = 0;

  // Make sure 'default' group is included in groups list if missing
  const effectiveGroups = [...groups];
  if (!effectiveGroups.some(g => g.id === 'default')) {
    effectiveGroups.unshift({ id: 'default', name: '默认会话' });
  }

  // Also collect any groups present in groupMap but not in effectiveGroups
  for (const gId of groupMap.keys()) {
    if (!effectiveGroups.some(g => g.id === gId)) {
      effectiveGroups.push({ id: gId, name: gId === 'default' ? '默认会话' : '分组' });
    }
  }

  effectiveGroups.forEach((g) => {
    const groupItems = groupMap.get(g.id) || [];
    // If filter is active and this group has 0 matches, hide the empty group
    if (filter && groupItems.length === 0) return;

    totalMatched += groupItems.length;

    const groupEl = document.createElement('div');
    // NEVER collapse group if it contains items and user didn't explicitly collapse, or if filter active
    const isCollapsed = filter ? false : collapsedGroupIds.has(g.id);
    groupEl.className = `session-group ${isCollapsed ? 'collapsed' : ''}`;
    groupEl.id = `group_${g.id}`;
    groupEl.dataset.groupId = g.id;

    // Group Header (Draggable)
    const headerEl = document.createElement('div');
    headerEl.className = 'group-header';
    headerEl.draggable = true;
    headerEl.innerHTML = `
      <div class="group-title-wrap">
        <span class="group-drag-handle" title="按住拖拽调整组上下顺序">⠿</span>
        <span class="group-chevron">▼</span>
        <span>${escapeHtml(g.name)}</span>
        <span style="font-size: 10px; color: var(--text-muted);">(${groupItems.length})</span>
      </div>
      <div>
        <button class="group-new-btn" title="在该组中新建会话">+</button>
      </div>
    `;

    // Group Drag Event Listeners with precise Before/After Line Indicator
    headerEl.ondragstart = (e) => {
      draggedType = 'group';
      draggedId = g.id;
      groupEl.classList.add('dragging');
      e.dataTransfer.setData('text/plain', g.id);
      e.dataTransfer.effectAllowed = 'move';
    };

    headerEl.ondragend = () => {
      groupEl.classList.remove('dragging');
      draggedType = null;
      draggedId = null;
      document.querySelectorAll('.session-group').forEach(el => {
        el.classList.remove('drop-before', 'drop-after');
      });
    };

    groupEl.ondragover = (e) => {
      if (draggedType === 'group' && draggedId !== g.id) {
        e.preventDefault();
        const rect = groupEl.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (e.clientY < midY) {
          groupEl.classList.add('drop-before');
          groupEl.classList.remove('drop-after');
        } else {
          groupEl.classList.add('drop-after');
          groupEl.classList.remove('drop-before');
        }
      }
    };

    groupEl.ondragleave = () => {
      groupEl.classList.remove('drop-before', 'drop-after');
    };

    groupEl.ondrop = async (e) => {
      if (draggedType === 'group' && draggedId && draggedId !== g.id) {
        e.preventDefault();
        const isAfter = groupEl.classList.contains('drop-after');
        groupEl.classList.remove('drop-before', 'drop-after');

        const fromIdx = groups.findIndex(item => item.id === draggedId);
        if (fromIdx === -1) return;
        const [moved] = groups.splice(fromIdx, 1);

        let toIdx = groups.findIndex(item => item.id === g.id);
        if (toIdx !== -1) {
          if (isAfter) toIdx += 1;
          groups.splice(toIdx, 0, moved);
          renderGroupsAndSessions(sessionSearchEl.value);
          await fetch('/api/groups/reorder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ groupIds: groups.map(item => item.id) })
          });
          showToast('分组排序已更新');
        }
      }
    };

    headerEl.querySelector('.group-title-wrap').onclick = () => {
      if (collapsedGroupIds.has(g.id)) {
        collapsedGroupIds.delete(g.id);
        groupEl.classList.remove('collapsed');
      } else {
        collapsedGroupIds.add(g.id);
        groupEl.classList.add('collapsed');
      }
    };

    headerEl.querySelector('.group-new-btn').onclick = (e) => {
      e.stopPropagation();
      createNewChat(g.id);
    };

    headerEl.oncontextmenu = (e) => {
      e.preventDefault();
      openGroupContextMenu(e, g);
    };

    // Group Items Container (Allows dropping session directly into group container)
    const itemsBox = document.createElement('div');
    itemsBox.className = 'group-items-box';
    itemsBox.dataset.groupId = g.id;

    itemsBox.ondragover = (e) => {
      if (draggedType === 'session') {
        e.preventDefault();
        itemsBox.classList.add('drag-over');
      }
    };

    itemsBox.ondragleave = (e) => {
      itemsBox.classList.remove('drag-over');
    };

    itemsBox.ondrop = async (e) => {
      if (draggedType === 'session' && draggedId) {
        e.preventDefault();
        itemsBox.classList.remove('drag-over');
        const targetSession = sessions.find(s => s.id === draggedId);
        if (targetSession && targetSession.groupId !== g.id) {
          targetSession.groupId = g.id;
          await fetch(`/api/sessions/${draggedId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ groupId: g.id })
          });
          showToast(`已移动到「${g.name}」`);
          loadGroupsAndSessions();
        }
      }
    };

    groupItems.forEach((s, sIdx) => {
      const item = document.createElement('div');
      item.className = `session-item ${s.id === currentSessionId ? 'active' : ''} ${s.pinned ? 'pinned' : ''}`;
      item.style.animationDelay = `${Math.min(sIdx * 18, 220)}ms`;
      item.draggable = true;
      item.dataset.sessionId = s.id;

      // Session Drag Handlers with precise Insertion Line Indicator (drop-before / drop-after)
      item.ondragstart = (e) => {
        draggedType = 'session';
        draggedId = s.id;
        item.classList.add('dragging');
        e.dataTransfer.setData('text/plain', s.id);
        e.dataTransfer.effectAllowed = 'move';
      };

      item.ondragend = () => {
        item.classList.remove('dragging');
        draggedType = null;
        draggedId = null;
        document.querySelectorAll('.session-item').forEach(el => {
          el.classList.remove('drop-before', 'drop-after');
        });
      };

      item.ondragover = (e) => {
        if (draggedType === 'session' && draggedId !== s.id) {
          e.preventDefault();
          e.stopPropagation();
          const rect = item.getBoundingClientRect();
          const midY = rect.top + rect.height / 2;
          if (e.clientY < midY) {
            item.classList.add('drop-before');
            item.classList.remove('drop-after');
          } else {
            item.classList.add('drop-after');
            item.classList.remove('drop-before');
          }
        }
      };

      item.ondragleave = () => {
        item.classList.remove('drop-before', 'drop-after');
      };

      item.ondrop = async (e) => {
        if (draggedType === 'session' && draggedId && draggedId !== s.id) {
          e.preventDefault();
          e.stopPropagation();
          const isAfter = item.classList.contains('drop-after');
          item.classList.remove('drop-before', 'drop-after');

          const fromIdx = sessions.findIndex(sess => sess.id === draggedId);
          if (fromIdx === -1) return;
          const [moved] = sessions.splice(fromIdx, 1);
          moved.groupId = g.id; // Also adopts current group

          let toIdx = sessions.findIndex(sess => sess.id === s.id);
          if (toIdx !== -1) {
            if (isAfter) toIdx += 1;
            sessions.splice(toIdx, 0, moved);
            renderGroupsAndSessions(sessionSearchEl.value);

            await fetch('/api/sessions/reorder', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                sessionIds: sessions.map(sess => sess.id),
                targetGroupId: g.id,
                movedId: moved.id
              })
            });
            showToast('会话排序已更新');
          }
        }
      };

      item.onclick = () => selectSession(s.id);
      item.oncontextmenu = (e) => {
        e.preventDefault();
        openContextMenu(e, s);
      };

      const titleRow = document.createElement('div');
      titleRow.className = 'session-title-row';

      const dragHandle = document.createElement('span');
      dragHandle.className = 'group-drag-handle';
      dragHandle.textContent = '⠿';
      titleRow.appendChild(dragHandle);

      if (s.pinned) {
        const pinBadge = document.createElement('span');
        pinBadge.className = 'session-pin-badge';
        pinBadge.textContent = '📌';
        titleRow.appendChild(pinBadge);
      }

      const title = document.createElement('div');
      title.className = 'session-title';
      title.textContent = s.title || '新会话';
      titleRow.appendChild(title);

      const meta = document.createElement('div');
      meta.className = 'session-meta';
      meta.innerHTML = `<span>${s.messageCount || 0} 条消息</span><span>${formatTime(s.updatedAt)}</span>`;

      item.appendChild(titleRow);
      item.appendChild(meta);
      itemsBox.appendChild(item);
    });

    groupEl.appendChild(headerEl);
    groupEl.appendChild(itemsBox);
    sessionListEl.appendChild(groupEl);
  });

  if (filter && totalMatched === 0) {
    const emptyEl = document.createElement('div');
    emptyEl.style.cssText = 'padding: 24px 16px; text-align: center; color: var(--text-muted); font-size: 13px;';
    emptyEl.textContent = '未找到匹配的会话内容';
    sessionListEl.appendChild(emptyEl);
  }
}

let searchDebounceTimer = null;
sessionSearchEl.addEventListener('input', (e) => {
  const query = e.target.value.trim();
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(async () => {
    if (!query) {
      await loadGroupsAndSessions();
      return;
    }
    // Search both title and full content via API
    try {
      const res = await fetch(`/api/sessions?search=${encodeURIComponent(query)}`);
      if (res.ok) {
        const searchResults = await res.json();
        sessions = searchResults;
        renderGroupsAndSessions(query);
      }
    } catch(err) {
      console.error('Search error:', err);
    }
  }, 200);
});

// Session Context Menu
function openContextMenu(e, session) {
  contextMenuTargetId = session.id;
  sessionContextMenuEl.style.left = `${Math.min(e.clientX, window.innerWidth - 180)}px`;
  sessionContextMenuEl.style.top = `${Math.min(e.clientY, window.innerHeight - 220)}px`;
  sessionContextMenuEl.style.display = 'block';

  ctxPinEl.textContent = session.pinned ? '取消置顶' : '置顶会话';

  ctxSubmenuGroupsEl.innerHTML = '';
  groups.forEach(g => {
    const subItem = document.createElement('div');
    subItem.className = 'context-menu-item';
    subItem.textContent = g.name;
    subItem.onclick = async (ev) => {
      ev.stopPropagation();
      await fetch(`/api/sessions/${session.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId: g.id })
      });
      showToast(`已移动到「${g.name}」`);
      sessionContextMenuEl.style.display = 'none';
      loadGroupsAndSessions();
    };
    ctxSubmenuGroupsEl.appendChild(subItem);
  });
}

// Group Context Menu
function openGroupContextMenu(e, group) {
  groupContextMenuTargetId = group.id;
  groupContextMenuEl.style.left = `${Math.min(e.clientX, window.innerWidth - 160)}px`;
  groupContextMenuEl.style.top = `${Math.min(e.clientY, window.innerHeight - 150)}px`;
  groupContextMenuEl.style.display = 'block';
}

document.addEventListener('click', () => {
  sessionContextMenuEl.style.display = 'none';
  groupContextMenuEl.style.display = 'none';
  if (fmContextMenuEl) fmContextMenuEl.style.display = 'none';
});

ctxPinEl.onclick = async () => {
  if (!contextMenuTargetId) return;
  const target = sessions.find(s => s.id === contextMenuTargetId);
  const newPinState = !target?.pinned;
  await fetch(`/api/sessions/${contextMenuTargetId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pinned: newPinState })
  });
  showToast(newPinState ? '会话已置顶' : '已取消置顶');
  loadGroupsAndSessions();
};

ctxRenameEl.onclick = async () => {
  if (!contextMenuTargetId) return;
  const target = sessions.find(s => s.id === contextMenuTargetId);
  const newTitle = prompt('请输入会话新名称：', target?.title || '');
  if (newTitle && newTitle.trim()) {
    await fetch(`/api/sessions/${contextMenuTargetId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTitle.trim() })
    });
    showToast('重命名成功');
    loadGroupsAndSessions();
    if (currentSessionId === contextMenuTargetId) {
      currentSessionTitleEl.textContent = newTitle.trim();
    }
  }
};

ctxArchiveEl.onclick = async () => {
  if (!contextMenuTargetId) return;
  await fetch(`/api/sessions/${contextMenuTargetId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ archived: true })
  });
  showToast('会话已归档至回收站');
  if (currentSessionId === contextMenuTargetId) currentSessionId = null;
  loadGroupsAndSessions();
};

ctxDeleteEl.onclick = async () => {
  if (!contextMenuTargetId) return;
  if (confirm('确认彻底删除此会话吗？此操作无法撤销。')) {
    await fetch(`/api/sessions/${contextMenuTargetId}`, { method: 'DELETE' });
    showToast('会话已彻底删除');
    if (currentSessionId === contextMenuTargetId) currentSessionId = null;
    loadGroupsAndSessions();
  }
};

// Group Context Menu Operations
ctxGroupRenameEl.onclick = async () => {
  if (!groupContextMenuTargetId) return;
  const target = groups.find(g => g.id === groupContextMenuTargetId);
  const newName = prompt('重命名分组：', target?.name || '');
  if (newName && newName.trim()) {
    await fetch(`/api/groups/${groupContextMenuTargetId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim() })
    });
    showToast('分组名称已更新');
    loadGroupsAndSessions();
  }
};

ctxGroupDeleteEl.onclick = async () => {
  if (!groupContextMenuTargetId) return;
  if (groupContextMenuTargetId === 'default') {
    alert('默认会话组不可删除');
    return;
  }
  if (confirm('确认删除此分组吗？组内会话将自动归入默认组。')) {
    await fetch(`/api/groups/${groupContextMenuTargetId}`, { method: 'DELETE' });
    showToast('分组已删除');
    loadGroupsAndSessions();
  }
};

// Recycle Bin Modal
btnOpenRecycleEl.addEventListener('click', async () => {
  modalTitleEl.innerHTML = '回收站';
  modalContentEl.innerHTML = '<div style="color: #fff; text-align: center; padding: 20px;">正在加载归档会话...</div>';
  modalOverlayEl.style.display = 'flex';

  try {
    const res = await fetch('/api/sessions?archived=true');
    const list = await res.json();
    archivedSessions = list;
    recycleCountBadgeEl.textContent = list.length;

    if (list.length === 0) {
      modalContentEl.innerHTML = '<div style="color: #8b949e; text-align: center; padding: 40px;">回收站为空，暂无归档会话。</div>';
      return;
    }

    let html = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
        <span style="font-size: 13px; color: #fff;">共 <b>${list.length}</b> 个归档会话：</span>
        <button id="btnEmptyRecycle" class="btn-secondary" style="color: var(--color-red); border-color: rgba(248,113,113,0.3);">清空回收站</button>
      </div>
      <div style="display: flex; flex-direction: column; gap: 8px;">
    `;

    for (const s of list) {
      html += `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: #090d13; border: 1px solid var(--border-default); border-radius: var(--radius-md);">
          <div>
            <div style="font-weight: 600; font-size: 13.5px; color: #fff;">${escapeHtml(s.title)}</div>
            <div style="font-size: 11px; color: #8b949e; margin-top: 2px;">${formatTime(s.updatedAt)} · ${s.messageCount || 0} 条消息</div>
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="footer-btn" onclick="restoreSession('${s.id}')" style="color: var(--color-cyan); padding: 4px 8px;">取回</button>
            <button class="footer-btn" onclick="deletePermanent('${s.id}')" style="color: var(--color-red); padding: 4px 8px;">销毁</button>
          </div>
        </div>
      `;
    }
    html += '</div>';
    modalContentEl.innerHTML = html;

    document.getElementById('btnEmptyRecycle').onclick = async () => {
      if (confirm('确认清空回收站吗？所有归档聊天记录将永久删除！')) {
        await fetch('/api/sessions-recycle/empty', { method: 'POST' });
        showToast('回收站已清空');
        modalOverlayEl.style.display = 'none';
        loadGroupsAndSessions();
      }
    };
  } catch(e) {
    modalContentEl.innerHTML = '加载失败: ' + e.message;
  }
});

window.restoreSession = async (id) => {
  await fetch(`/api/sessions/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ archived: false })
  });
  showToast('会话已取回恢复');
  modalOverlayEl.style.display = 'none';
  loadGroupsAndSessions();
  selectSession(id);
};
if (ctxFmRenameEl) {
  ctxFmRenameEl.onclick = async () => {
    if (!fmContextMenuTarget) return;
    const { apiBase, relPath, refresh, setActive } = fmContextMenuTarget;
    const oldName = relPath.split('/').pop();
    const newName = prompt('重命名为：', oldName);
    if (newName && newName.trim() && newName.trim() !== oldName) {
      const parentDir = relPath.includes('/') ? relPath.substring(0, relPath.lastIndexOf('/')) : '';
      const safeNewName = newName.trim().endsWith('.md') ? newName.trim() : `${newName.trim()}.md`;
      const targetRel = parentDir ? `${parentDir}/${safeNewName}` : safeNewName;
      await fetch(`${apiBase}/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPath: relPath, newPath: targetRel })
      });
      showToast('重命名成功');
      setActive?.(targetRel);
      refresh();
    }
  };
}

if (ctxFmCopyEl) {
  ctxFmCopyEl.onclick = () => {
    if (!fmContextMenuTarget) return;
    fmClipboardPath = fmContextMenuTarget.relPath;
    showToast(`已复制：${fmContextMenuTarget.relPath.split('/').pop()}`);
  };
}

if (ctxFmPasteEl) {
  ctxFmPasteEl.onclick = async () => {
    if (!fmContextMenuTarget || !fmClipboardPath) return;
    const { apiBase, relPath, isDir, refresh, setActive } = fmContextMenuTarget;
    const targetDir = isDir ? relPath : (relPath.includes('/') ? relPath.substring(0, relPath.lastIndexOf('/')) : '');
    const srcFileName = fmClipboardPath.split('/').pop().replace(/\.md$/, '');
    const destName = `${srcFileName}-copy.md`;
    const destRel = targetDir ? `${targetDir}/${destName}` : destName;

    await fetch(`${apiBase}/copy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ srcPath: fmClipboardPath, destPath: destRel })
    });
    showToast(`已粘贴为 ${destName}`);
    setActive?.(destRel);
    refresh();
  };
}

if (ctxFmDeleteEl) {
  ctxFmDeleteEl.onclick = async () => {
    if (!fmContextMenuTarget) return;
    const { apiBase, relPath, refresh } = fmContextMenuTarget;
    if (confirm(`确认彻底删除「${relPath}」吗？`)) {
      await fetch(`${apiBase}/file?path=${encodeURIComponent(relPath)}`, { method: 'DELETE' });
      showToast('文件已删除');
      refresh();
    }
  };
}

// Global FM Hotkeys: Ctrl+C / Ctrl+V / F2
document.addEventListener('keydown', (e) => {
  // If modal is open and focusing on file manager
  if (modalOverlayEl.style.display !== 'none' && document.querySelector('.fm-layout')) {
    const isEditorFocused = (document.activeElement === document.getElementById('fmEditor') || document.activeElement === document.getElementById('fmCurrentPath'));
    if (!isEditorFocused) {
      // F2 to Rename
      if (e.key === 'F2') {
        const activeItem = document.querySelector('.fm-file-item.active');
        if (activeItem && activeItem.dataset.relPath) {
          e.preventDefault();
          ctxFmRenameEl.click();
        }
      }
      // Ctrl+C to Copy selected file
      if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
        const activeItem = document.querySelector('.fm-file-item.active');
        if (activeItem && activeItem.dataset.relPath) {
          e.preventDefault();
          fmClipboardPath = activeItem.dataset.relPath;
          showToast(`已复制：${fmClipboardPath.split('/').pop()}`);
        }
      }
      // Ctrl+V to Paste into current directory
      if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V')) {
        if (fmClipboardPath) {
          e.preventDefault();
          const activeItem = document.querySelector('.fm-file-item.active');
          const relPath = activeItem?.dataset.relPath || '';
          const targetDir = relPath.includes('/') ? relPath.substring(0, relPath.lastIndexOf('/')) : '';
          const srcFileName = fmClipboardPath.split('/').pop().replace(/\.md$/, '');
          const destName = `${srcFileName}-copy.md`;
          const destRel = targetDir ? `${targetDir}/${destName}` : destName;

          const isSkill = modalTitleEl.textContent.includes('Skills');
          const apiBase = isSkill ? '/api/skills-manager' : '/api/memory-manager';

          fetch(`${apiBase}/copy`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ srcPath: fmClipboardPath, destPath: destRel })
          }).then(() => {
            showToast(`已粘贴为 ${destName}`);
            // Trigger refresh
            if (isSkill) openFileManagerModal('skills');
            else openFileManagerModal('memory');
          });
        }
      }
    }
  }
});

window.deletePermanent = async (id) => {
  if (confirm('确认永久销毁此记录吗？')) {
    await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
    showToast('已彻底删除');
    btnOpenRecycleEl.click();
    loadGroupsAndSessions();
  }
};

// Create New Chat
async function createNewChat(groupId = 'default') {
  try {
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId })
    });
    const session = await res.json();
    sessions.unshift({
      id: session.id,
      title: session.title,
      groupId: session.groupId || groupId,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messageCount: 0
    });
    renderGroupsAndSessions(sessionSearchEl.value);
    selectSession(session.id);
  } catch(e) {
    console.error('Failed to create new chat:', e);
  }
}

// Select Session
async function selectSession(sessionId) {
  const loadVersion = ++sessionLoadVersion;
  if (window.innerWidth <= 768) {
    closeMobileSidebar();
  }
  currentSessionId = sessionId;

  // Make sure the group containing current session is not collapsed
  const currentSess = sessions.find(s => s.id === sessionId);
  if (currentSess) {
    const gId = currentSess.groupId || 'default';
    if (collapsedGroupIds.has(gId)) {
      collapsedGroupIds.delete(gId);
    }
  }

  renderGroupsAndSessions(sessionSearchEl.value);

  chatMessagesEl.innerHTML = '<div style="color: var(--text-secondary); text-align: center; margin-top: 50px; font-size: 13px;">加载会话记录中...</div>';

  try {
    const res = await fetch(`/api/sessions/${sessionId}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const session = await res.json();
    if (loadVersion !== sessionLoadVersion || sessionId !== currentSessionId) return;
     currentSessionObj = session;
    currentSessionTitleEl.textContent = session.title || '新会话';
    renderMessages(session.messages || []);
    if (Array.isArray(window.__activeTurns)) {
      const activeForCur = window.__activeTurns.find(t => t.sessionId === sessionId);
      if (activeForCur) {
        setTaskRunningState(true);
        ensureThinkingBubble();
      }
    }
    scrollToBottom();
  } catch (e) {
    console.error('Failed to load session:', e);
    chatMessagesEl.innerHTML = `<div style="color: #f87171; text-align: center; margin-top: 50px; font-size: 13px;">加载会话失败: ${escapeHtml(e.message)}</div>`;
  }
}

// DSH Context Window Snapshot Modal
window.inspectTurnContext = (msgIndex) => {
  if (!currentSessionObj) return;
  const messages = currentSessionObj.messages || [];
  const priorMessages = messages.slice(0, msgIndex + 1);

  modalTitleEl.innerHTML = `上下文视图 (第 ${msgIndex + 1} 步)`;
  modalOverlayEl.style.display = 'flex';

  let html = `
    <div style="font-size: 12px; color: #fff; margin-bottom: 12px;">
      此轮交互模型上下文快照（累积 <b>${priorMessages.length}</b> 条消息与系统提示词）：
    </div>
    <div style="display: flex; flex-direction: column; gap: 8px;">
  `;

  priorMessages.forEach((m, idx) => {
    html += `
      <div style="background: #090d13; border: 1px solid var(--border-default); border-radius: var(--radius-sm); padding: 8px 12px;">
        <div style="font-weight: 700; font-size: 11.5px; color: #fff; display: flex; justify-content: space-between;">
          <span>[${idx + 1}] Role: ${escapeHtml(m.role)}</span>
          <span style="font-size: 10px; color: var(--text-muted);">${formatTime(m.time)}</span>
        </div>
        <div class="tool-code-box" style="margin-top: 4px; max-height: 120px;">${escapeHtml(typeof m.content === 'string' ? m.content : JSON.stringify(m.content || m.args || m.result, null, 2))}</div>
      </div>
    `;
  });

  html += '</div>';
  modalContentEl.innerHTML = html;
};

// DSH 1:1 Exact Token Usage Details Modal
window.showUsageDetailsModal = (usageJson, model) => {
  try {
    const u = JSON.parse(decodeURIComponent(usageJson));
    modalTitleEl.innerHTML = `本轮用量明细`;
    modalOverlayEl.style.display = 'flex';

    const promptTok = u.prompt_tokens ?? u.inputTokens ?? 0;
    const output = u.completion_tokens ?? u.outputTokens ?? 0;
    const total = u.total_tokens ?? u.totalTokens ?? (promptTok + output);
    const cacheRead = u.cache_read ?? u.cacheReadTokens ?? 0;
    const uncachedInput = u.uncached_input ?? Math.max(0, promptTok - cacheRead);
    const reasoning = u.reasoning_tokens ?? u.reasoningTokens ?? 0;
    const cacheWrite = u.cache_write ?? u.cacheWriteTokens ?? 0;

    let cacheHitPercent = null;
    const denominator = uncachedInput + cacheRead;
    if (denominator > 0 && cacheRead > 0) {
      cacheHitPercent = Math.round((cacheRead / denominator) * 100);
    }

    modalContentEl.innerHTML = `
      <div class="dsh-stat-panel" style="width: 100%; max-width: 440px; margin: 0 auto;">
        <div class="dsh-stat-title">
          <span class="dsh-stat-title-label">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path></svg>
            本轮用量
          </span>
          <span class="dsh-stat-title-val">${total} tok</span>
        </div>
        <div class="dsh-stat-rule"></div>
        <dl class="dsh-stat-dl">
          ${model ? `<dt>提供方 / 模型</dt><dd>${escapeHtml(model)}</dd>` : ''}
          ${cacheHitPercent !== null ? `<dt>缓存命中</dt><dd>${cacheHitPercent}%</dd>` : ''}
          <dt>未缓存输入</dt><dd>${uncachedInput} tok</dd>
          ${cacheRead > 0 || u.cache_read !== undefined || u.cacheReadTokens !== undefined ? `<dt>缓存读取</dt><dd style="color: var(--color-emerald);">${cacheRead} tok</dd>` : ''}
          ${cacheWrite > 0 ? `<dt>缓存写入</dt><dd>${cacheWrite} tok</dd>` : ''}
          <dt>输出</dt>
          <dd>
            ${output} tok
            ${reasoning > 0 ? `<span class="dsh-stat-reasoning">（其中推理 ${reasoning} tok）</span>` : ''}
          </dd>
        </dl>
      </div>
    `;
  } catch(e) {}
};

// File Diff Inspection Modal (文件变动审查)
window.inspectFileDiff = (diffDataJson) => {
  try {
    const data = JSON.parse(decodeURIComponent(diffDataJson));
    modalTitleEl.innerHTML = `文件变更审查: ${escapeHtml(data.filename)}`;
    modalOverlayEl.style.display = 'flex';

    let diffHtml = `
      <div class="diff-container">
        <div class="diff-file-header">
          <span style="color: #fff; font-weight: 700;">${escapeHtml(data.path)}</span>
          <div style="font-size: 11px;">
            <span style="color: #4ade80;">+${data.addedCount} 行</span>
            <span style="color: #f87171; margin-left: 8px;">-${data.deletedCount} 行</span>
          </div>
        </div>
        <div class="diff-lines-list">
    `;

    (data.diff || []).forEach(d => {
      const isAdd = d.type === 'add';
      const isDel = d.type === 'del';
      const lineClass = isAdd ? 'add' : (isDel ? 'del' : '');
      const prefix = isAdd ? '+' : (isDel ? '-' : ' ');
      const gutter = isAdd ? (d.newNo || '') : (isDel ? (d.oldNo || '') : (d.newNo || ''));

      diffHtml += `
        <div class="diff-line ${lineClass}">
          <div class="diff-gutter">${gutter}</div>
          <div style="user-select: none; width: 14px; text-align: center;">${prefix}</div>
          <div style="flex: 1;">${escapeHtml(d.line)}</div>
        </div>
      `;
    });

    diffHtml += `</div></div>`;
    modalContentEl.innerHTML = diffHtml;
  } catch(e) {}
};

// Ultra-lightweight Syntax Highlighter for Code Blocks
function highlightCodeTokens(rawCode) {
  let escaped = escapeHtml(rawCode);
  // Comments: // ...
  escaped = escaped.replace(/(\/\/[^\n]*)/g, '<span class="tok-comment">$1</span>');
  // Strings: '...' or "..." or `...`
  escaped = escaped.replace(/(&quot;[\s\S]*?&quot;|&#039;[\s\S]*?&#039;|`[\s\S]*?`)/g, '<span class="tok-str">$1</span>');
  // Keywords
  const kwRegex = /\b(const|let|var|function|return|if|else|for|while|await|async|import|export|from|class|new|try|catch|finally|throw|typeof|instanceof|switch|case|break|default|true|false|null|undefined)\b/g;
  escaped = escaped.replace(kwRegex, '<span class="tok-kw">$1</span>');
  // Numbers
  escaped = escaped.replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="tok-num">$1</span>');
  // Function calls: foo(...)
  escaped = escaped.replace(/\b([a-zA-Z_$][a-zA-Z0-9_$]*)(?=\s*\()/g, '<span class="tok-fn">$1</span>');
  return escaped;
}

window.openFileManager = (type, initialRelPath = null) => {
  openFileManagerModal(type, initialRelPath);
};
window.openFileManagerModal = (type, initialRelPath = null) => {
  openFileManagerModal(type, initialRelPath);
};

// Load Skills Tree inside Settings tab
window.loadSettingsSkillsTree = async () => {
  const container = document.getElementById('settingsSkillsTreeList');
  if (!container) return;
  try {
    const res = await fetch('/api/skills');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const skills = data.skills || [];
    if (skills.length === 0) {
      container.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding: 20px;">暂无 Skills 技能</div>';
      return;
    }
    container.innerHTML = skills.map((s, idx) => {
      const targetRel = s.relPath || `${s.name || s.id}.md`;
      const encodedRel = encodeURIComponent(targetRel);
      return `
      <div class="settings-list-row" style="animation-delay: ${Math.min(idx * 25, 250)}ms; border-bottom: 1px solid rgba(255,255,255,0.06); padding: 10px 8px; display: flex; justify-content: space-between; align-items: center; gap: 12px; border-radius: 6px;">
        <div style="min-width: 0; flex: 1;">
          <div style="font-weight: 700; color: #fff; font-size: 13px; display: flex; align-items: center; gap: 6px;">
            <span style="color: var(--color-cyan); font-family: var(--font-mono);">${escapeHtml(s.name || s.id)}</span>
          </div>
          <div style="font-size: 11.5px; color: var(--text-muted); margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(s.description || '自定义技能')}</div>
        </div>
        <button class="btn-secondary" style="font-size: 11px; padding: 4px 10px; white-space: nowrap;" onclick="openFileManagerModal('skills', decodeURIComponent('${encodedRel}'))">查看代码</button>
      </div>
    `;
    }).join('');
  } catch(e) {
    container.innerHTML = `<div style="color: var(--color-red); padding: 10px;">加载失败: ${escapeHtml(e.message)}</div>`;
  }
};

// Load Memory Tree inside Settings tab
window.loadSettingsMemoryTree = async () => {
  const container = document.getElementById('settingsMemoryTreeList');
  if (!container) return;
  try {
    const res = await fetch('/api/memory/list');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const cards = data.cards || [];
    if (cards.length === 0) {
      container.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding: 20px;">暂无记忆知识卡</div>';
      return;
    }
    container.innerHTML = cards.map((c, idx) => {
      const targetRel = c.relPath || c.id || '';
      const encodedRel = encodeURIComponent(targetRel);
      return `
      <div class="settings-list-row" style="animation-delay: ${Math.min(idx * 20, 240)}ms; border-bottom: 1px solid rgba(255,255,255,0.06); padding: 10px 8px; display: flex; justify-content: space-between; align-items: center; gap: 12px; border-radius: 6px;">
        <div style="min-width: 0; flex: 1;">
          <div style="font-weight: 700; color: #fff; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(c.title || c.id)}</div>
          <div style="font-size: 11px; color: var(--text-muted); margin-top: 3px;">
            <span style="color: var(--color-pink);">${escapeHtml(c.scope || '默认库')}</span> · ${escapeHtml(c.updatedAt || '')}
          </div>
        </div>
        <button class="btn-secondary" style="font-size: 11px; padding: 4px 10px; white-space: nowrap;" onclick="openFileManagerModal('memory', decodeURIComponent('${encodedRel}'))">查看卡片</button>
      </div>
    `;
    }).join('');
  } catch(e) {
    container.innerHTML = `<div style="color: var(--text-muted); padding: 10px;">直接点击右上角【打开独立记忆知识卡管理器】查看完整卡片库</div>`;
  }
};

// Global helpers for settings audit and plugins
window.renderAuditInSettings = async () => {
  const container = document.getElementById('settingsAuditContainer');
  if (!container) return;
  container.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding: 20px;">正在加载审计记录...</div>';
  try {
    const queryParam = currentSessionId ? `&sessionId=${encodeURIComponent(currentSessionId)}` : '';
    const res = await fetch(`/api/audit?limit=35${queryParam}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const list = data.records || [];
    if (list.length === 0) {
      container.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding: 20px;">暂无工具调用审计记录</div>';
      return;
    }
    container.innerHTML = list.map((r, idx) => {
      const isErr = r.status === 'error';
      return `
      <div class="settings-list-row" style="animation-delay: ${Math.min(idx * 20, 240)}ms; border-bottom: 1px solid rgba(255,255,255,0.06); padding: 10px 8px; display: flex; justify-content: space-between; align-items: center; gap: 12px; border-radius: 6px;">
        <div style="min-width: 0; flex: 1;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="color: var(--color-cyan); font-weight: 700; font-family: var(--font-mono);">${escapeHtml(r.toolName || r.name || 'tool')}</span>
            <span class="tool-status-pill" style="${isErr ? 'color: var(--color-red); border-color: rgba(248,113,113,0.3); background: rgba(248,113,113,0.1);' : 'color: var(--color-emerald); border-color: rgba(52,211,153,0.3); background: rgba(52,211,153,0.12);'}">${escapeHtml(r.status || 'success')}</span>
            ${r.durationMs ? `<span style="color: var(--text-muted); font-size: 10.5px; font-family: var(--font-mono);">${r.durationMs}ms</span>` : ''}
          </div>
          <div style="font-size: 11.5px; color: #8b949e; margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(r.purpose || r.summary || '')}</div>
        </div>
        <div style="font-size: 11px; color: var(--text-muted); white-space: nowrap;">${formatTime(r.time || r.timestamp)}</div>
      </div>
    `;
    }).join('');
  } catch(err) {
    container.innerHTML = `<div style="color: var(--color-red); padding: 12px;">加载失败: ${escapeHtml(err.message)}</div>`;
  }
};

window.togglePlugin = async (id, enabled) => {
  try {
    const res = await fetch('/api/plugins/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, enabled })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    showToast(`插件 ${id} 已${enabled ? '启用' : '停用'}`);
    if (document.getElementById('settingsPluginsContainer')) {
      window.renderPluginsInSettings();
    } else {
      loadPluginsList();
    }
  } catch (e) {
    showToast(`切换插件失败: ${e.message}`);
  }
};

window.renderPluginsInSettings = async () => {
  const container = document.getElementById('settingsPluginsContainer');
  if (!container) return;
  container.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding: 20px;">正在加载插件列表...</div>';
  try {
    const res = await fetch('/api/plugins');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const plugins = Array.isArray(data) ? data : (data.plugins || []);
    if (plugins.length === 0) {
      container.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding: 20px;">当前未加载外部动态插件</div>';
      return;
    }
    container.innerHTML = plugins.map((p, idx) => {
      const toolBadges = Array.isArray(p.tools) && p.tools.length > 0
        ? `<div style="display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px;">` +
          p.tools.map(t => `<span style="font-size: 10.5px; font-family: var(--font-mono); padding: 1px 6px; border-radius: 4px; background: rgba(56,189,248,0.12); color: var(--color-cyan); border: 1px solid rgba(56,189,248,0.25);" title="${escapeHtml(t.description || '')}">⚡ ${escapeHtml(t.name)}</span>`).join('') +
          `</div>`
        : '';
      return `
      <div class="settings-list-row" style="animation-delay: ${Math.min(idx * 30, 240)}ms; border-bottom: 1px solid rgba(255,255,255,0.06); padding: 12px 8px; display: flex; justify-content: space-between; align-items: center; gap: 14px; border-radius: 6px;">
        <div style="min-width: 0; flex: 1;">
          <div style="font-weight: 700; color: #fff; font-size: 13.5px;">
            ${escapeHtml(p.name || p.id)}
            <span style="font-size: 11px; color: var(--color-cyan); font-weight: normal; margin-left: 6px;">v${escapeHtml(p.version || '1.0.0')}</span>
          </div>
          <div style="font-size: 12px; color: var(--text-muted); margin-top: 3px;">${escapeHtml(p.description || '')}</div>
          ${toolBadges}
        </div>
        <button onclick="togglePlugin('${escapeHtml(p.id)}', ${!p.enabled})" class="btn-secondary" style="font-size: 11.5px; padding: 5px 12px; white-space: nowrap; color: ${p.enabled ? 'var(--color-emerald)' : 'var(--text-muted)'}; border-color: ${p.enabled ? 'rgba(52,211,153,0.4)' : 'var(--border-default)'}; background: ${p.enabled ? 'rgba(52,211,153,0.1)' : 'transparent'};">
          ${p.enabled ? '● 已启用 (点击停用)' : '○ 已停用 (点击启用)'}
        </button>
      </div>
    `;
    }).join('');
  } catch(err) {
    container.innerHTML = `<div style="color: var(--color-red); padding: 12px;">加载失败: ${escapeHtml(err.message)}</div>`;
  }
};
// ================= DSH Free Interactive Chat Width Drag Resizer =================
const chatResizeHandleLeft = document.getElementById('chatResizeHandleLeft');
const chatResizeHandleRight = document.getElementById('chatResizeHandleRight');
let isDraggingChatWidth = false;
let startDragX = 0;
let startWidthPx = 820;

function getChatCardsMaxWidth() {
  const card = document.querySelector('.message-card');
  if (card) {
    const computed = window.getComputedStyle(card).maxWidth;
    if (computed && computed.endsWith('px')) return parseFloat(computed);
  }
  return parseInt(localStorage.getItem('fc_chat_custom_width_px'), 10) || 820;
}

function setChatCustomWidth(widthPx) {
  const clamped = Math.max(540, Math.min(window.innerWidth - 60, widthPx));
  localStorage.setItem('fc_chat_custom_width_px', clamped);
  
  let dynamicStyle = document.getElementById('dynamicChatWidthStyle');
  if (!dynamicStyle) {
    dynamicStyle = document.createElement('style');
    dynamicStyle.id = 'dynamicChatWidthStyle';
    document.head.appendChild(dynamicStyle);
  }
  dynamicStyle.textContent = `
    .chat-messages .message-card,
    .composer-container .composer-card {
      max-width: ${clamped}px !important;
    }
  `;
}

// Restore saved custom drag width if present
const savedCustomWidth = localStorage.getItem('fc_chat_custom_width_px');
if (savedCustomWidth) {
  setChatCustomWidth(parseInt(savedCustomWidth, 10));
}

function initDragHandle(handleEl, isLeft) {
  if (!handleEl) return;
  handleEl.addEventListener('pointerdown', (e) => {
    isDraggingChatWidth = true;
    startDragX = e.clientX;
    startWidthPx = getChatCardsMaxWidth();
    handleEl.setPointerCapture(e.pointerId);
    handleEl.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    e.preventDefault();
  });

  handleEl.addEventListener('pointermove', (e) => {
    if (!isDraggingChatWidth) return;
    const dx = e.clientX - startDragX;
    const delta = isLeft ? -dx * 2 : dx * 2;
    setChatCustomWidth(startWidthPx + delta);
  });

  const stopDrag = (e) => {
    if (!isDraggingChatWidth) return;
    isDraggingChatWidth = false;
    handleEl.classList.remove('dragging');
    document.body.style.cursor = '';
    try { handleEl.releasePointerCapture(e.pointerId); } catch(_) {}
  };

  handleEl.addEventListener('pointerup', stopDrag);
  handleEl.addEventListener('pointercancel', stopDrag);
}

initDragHandle(chatResizeHandleLeft, true);
initDragHandle(chatResizeHandleRight, false);

// ================= DSH Ring Indicator for Context Usage =================
function updateContextRing(usageRatio = 0.15, tokenInfo = '') {
  const ringProgress = document.getElementById('contextRingProgress');
  const ringText = document.getElementById('contextRingText');
  const ringBtn = document.getElementById('btnCompact');
  const pct = Math.min(100, Math.max(0, Math.round(usageRatio * 100)));

  if (ringProgress) {
    ringProgress.setAttribute('stroke-dasharray', `${pct}, 100`);
    if (pct >= 80) {
      ringProgress.setAttribute('stroke', 'var(--color-red)');
    } else if (pct >= 50) {
      ringProgress.setAttribute('stroke', 'var(--color-amber)');
    } else {
      ringProgress.setAttribute('stroke', 'var(--color-cyan)');
    }
  }

  if (ringText) {
    ringText.textContent = `${pct}%`;
  }

  if (ringBtn) {
    ringBtn.title = `上下文占用: ${pct}%\n${tokenInfo || '点击执行上下文智能压缩摘要'}`;
  }
}

function computeSessionContextRatio() {
  if (!currentSessionObj || !currentSessionObj.messages) return;
  let totalChars = 0;
  currentSessionObj.messages.forEach(m => {
    totalChars += (m.content ? m.content.length : 0);
  });
  const maxChars = 160000;
  const ratio = Math.min(1, Math.max(0.05, totalChars / maxChars));
  const estTokens = Math.round(totalChars * 0.6);
  updateContextRing(ratio, `估算 Token: ~${estTokens.toLocaleString()} / 128,000\n点击立即执行上下文压缩`);
}
function renderBubbleContent(text) {
  if (!text) return '';

  if (window.marked && window.marked.parse) {
    try {
      // Standard GFM Markdown without harmful breaks:true that causes double blank lines
      marked.setOptions({
        gfm: true,
        tables: true,
        breaks: false,
        mangle: false,
        headerIds: false
      });

      // Custom renderer for code block to match DSH style with language header & copy button
      // Compatible with both Marked v4/v5 (code, lang) and Marked v13+/v18 ({ text, lang })
      const renderer = new marked.Renderer();
      renderer.code = function(codeOrToken, langArg) {
        const isTokenObj = codeOrToken && typeof codeOrToken === 'object';
        const rawCode = isTokenObj ? (codeOrToken.text || '') : String(codeOrToken || '');
        const language = (isTokenObj ? codeOrToken.lang : langArg) || 'text';
        const highlighted = highlightCodeTokens(rawCode);
        const encoded = encodeURIComponent(rawCode);
        return `
          <div class="code-block-wrapper">
            <div class="code-block-header">
              <span class="code-lang-tag">${escapeHtml(language)}</span>
              <button class="code-copy-btn" onclick="copyText(decodeURIComponent('${encoded}'), this)">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                复制
              </button>
            </div>
            <pre class="tool-code-box"><code>${highlighted}</code></pre>
          </div>
        `;
      };

      renderer.table = function(headerOrToken, bodyArg) {
        if (headerOrToken && typeof headerOrToken === 'object' && Array.isArray(headerOrToken.header)) {
          const token = headerOrToken;
          let headerHtml = '';
          let cellRow = '';
          for (let j = 0; j < token.header.length; j++) {
            cellRow += this.tablecell(token.header[j]);
          }
          headerHtml += this.tablerow({ text: cellRow });
          let bodyHtml = '';
          for (let j = 0; j < (token.rows || []).length; j++) {
            const row = token.rows[j];
            cellRow = '';
            for (let k = 0; k < row.length; k++) {
              cellRow += this.tablecell(row[k]);
            }
            bodyHtml += this.tablerow({ text: cellRow });
          }
          return `
            <div class="markdown-table-wrapper">
              <table class="markdown-table">
                <thead>${headerHtml}</thead>
                <tbody>${bodyHtml}</tbody>
              </table>
            </div>
          `;
        }
        return `
          <div class="markdown-table-wrapper">
            <table class="markdown-table">
              <thead>${headerOrToken || ''}</thead>
              <tbody>${bodyArg || ''}</tbody>
            </table>
          </div>
        `;
      };

      return marked.parse(text, { renderer });
    } catch(err) {
      console.error('Marked parse error:', err);
    }
  }

  // Fallback if marked is loading
  let escaped = escapeHtml(text);
  escaped = escaped.replace(/```([\s\S]*?)```/g, '<pre class="tool-code-box"><code>$1</code></pre>');
  return escaped;
}

// Helper: Check if a user message is an internal DSH runtime snapshot / system-reminder
function isSystemInjectedUserMessage(m) {
  if (!m || m.role !== 'user' || typeof m.content !== 'string') return false;
  const trimmed = m.content.trim();
  return (
    trimmed.startsWith('Current runtime context. This snapshot supersedes') ||
    trimmed.startsWith('<system-reminder>')
  );
}

// Copy message by index safely from session memory (Pass clicked button for in-place checkmark)
window.copyMessageContentByIndex = (index, btnEl = null) => {
  if (!currentSessionObj || !currentSessionObj.messages?.[index]) return;
  const content = currentSessionObj.messages[index].content || '';
  copyText(content, btnEl);
};

// Render Messages
function renderMessages(messages) {
  chatMessagesEl.innerHTML = '';
  const list = Array.isArray(messages) ? messages : [];

  if (list.length === 0) {
    chatMessagesEl.innerHTML = `
      <div style="margin: auto; text-align: center; color: var(--text-muted); padding: 48px 20px;">
        <div style="font-size: 15px; font-weight: 600; color: var(--text-secondary); margin-bottom: 6px;">当前会话暂无消息</div>
        <div style="font-size: 12.5px;">在下方输入框发送指令即可开始与 ${escapeHtml(customization.agentName || '小可')} 对话</div>
      </div>
    `;
    computeSessionContextRatio();
    return;
  }

  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    if (!m) continue;

    // Skip internal runtime context / system-reminder injections
    if (isSystemInjectedUserMessage(m)) {
      continue;
    }

    if (m.role === 'tool_execution') {
      appendToolUnifiedCard(m);
      continue;
    }

    if (m.role === 'tool_call') {
      // Collect consecutive tool_calls and match with subsequent tool_results
      const callBatch = [];
      while (i < list.length && list[i] && list[i].role === 'tool_call') {
        callBatch.push(list[i]);
        i++;
      }
      const resultBatch = [];
      while (i < list.length && list[i] && list[i].role === 'tool_result') {
        resultBatch.push(list[i]);
        i++;
      }
      i--; // step back so outer loop increments properly

      const usedResultIndices = new Set();
      for (let cIdx = 0; cIdx < callBatch.length; cIdx++) {
        const callMsg = callBatch[cIdx];
        // Match by call_id first, fallback to positional index
        let matchedIdx = resultBatch.findIndex((r, rIdx) => !usedResultIndices.has(rIdx) && r.call_id && r.call_id === callMsg.call_id);
        if (matchedIdx === -1 && cIdx < resultBatch.length && !usedResultIndices.has(cIdx)) {
          matchedIdx = cIdx;
        }
        if (matchedIdx !== -1) usedResultIndices.add(matchedIdx);
        const resMsg = matchedIdx !== -1 ? resultBatch[matchedIdx] : null;
        const durationMs = resMsg?.durationMs ?? ((resMsg?.time && callMsg.time && resMsg.time >= callMsg.time) ? (resMsg.time - callMsg.time) : 0);

        appendToolUnifiedCard({
          call_id: callMsg.call_id || `call_${callMsg.time || i}_${cIdx}`,
          name: callMsg.name || 'tool',
          purpose: callMsg.purpose || `执行 ${callMsg.name || 'tool'}`,
          args: callMsg.args,
          result: resMsg ? resMsg.result : undefined,
          fileDiff: resMsg ? resMsg.fileDiff : undefined,
          durationMs,
          status: resMsg ? (resMsg.status || 'success') : 'success',
          time: callMsg.time
        });
      }
      continue;
    }

    if (m.role === 'tool_result') {
      // Standalone orphan tool_result
      appendToolUnifiedCard({
        call_id: m.call_id || `res_${m.time || i}`,
        name: m.name || 'tool_result',
        purpose: m.purpose || (m.name ? `执行 ${m.name}` : '工具返回结果'),
        args: m.args,
        result: m.result,
        fileDiff: m.fileDiff,
        durationMs: m.durationMs || 0,
        status: m.status || 'success',
        time: m.time
      });
      continue;
    }

    if (m.role === 'user' || m.role === 'assistant' || m.role === 'compaction_summary') {
      appendMessageCard(m, i);
    }
  }
  computeSessionContextRatio();
}

// Append Bubble with Pure Icon Sub-Bar
function appendMessageCard(m, index = 0) {
  const card = document.createElement('div');
  card.className = `message-card ${m.role}`;
  card.id = `msg_${m.time || index}`;

  if (m.role === 'user') {
    let imgHtml = '';
    if (m.images && m.images.length > 0) {
      imgHtml = m.images.map(img => `<img src="${img}" class="attached-img" alt="image" onclick="openImageLightbox('${img}')">`).join('');
    }
    // Respect per-message author if recorded, otherwise use default
    const name = m.author || m.userName || customization.userName || 'LynnH_Ma';
    const avatar = m.avatar || m.userAvatar || (currentUser?.avatar ? currentUser.avatar : (name ? `https://minotar.net/helm/${encodeURIComponent(name)}/64.png` : customization.userAvatar));

    card.innerHTML = `
      <div class="card-header">
        <img src="${avatar}" class="card-avatar-sm" alt="User">
        <span>${escapeHtml(name)}</span>
        <span style="font-size: 10px; color: var(--text-muted);">${formatTime(m.time)}</span>
      </div>
      <div class="card-bubble">
        ${renderBubbleContent(m.content)}
        ${imgHtml}
      </div>
      <div class="message-sub-bar">
        <button class="sub-bar-icon-btn" title="编辑此消息" onclick="editMessageInSession(${index})">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
        </button>
        <span class="sub-bar-divider"></span>
        <button class="sub-bar-icon-btn" title="查看此轮上下文" onclick="inspectTurnContext(${index})">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
        </button>
        <span class="sub-bar-divider"></span>
        <button class="sub-bar-icon-btn" title="复制文本" onclick="copyMessageContentByIndex(${index}, this)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
        </button>
        <span class="sub-bar-divider"></span>
        <button class="sub-bar-icon-btn" style="color: var(--color-red);" title="删除此消息" onclick="deleteMessageInSession(${index})">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      </div>
    `;
  } else if (m.role === 'assistant') {
    const avatar = customization.agentAvatar || 'assets/CoreNyan.png';
    const name = customization.agentName || '小可';

    const usage = m.usage;
    let usageTagHtml = '';
    if (usage) {
      const cacheRead = usage.cache_read ?? usage.cacheReadTokens ?? 0;
      const promptTok = usage.prompt_tokens ?? usage.inputTokens ?? 0;
      const compTok = usage.completion_tokens ?? usage.outputTokens ?? 0;
      const total = usage.total_tokens ?? usage.totalTokens ?? (promptTok + compTok);
      const encodedUsage = encodeURIComponent(JSON.stringify(usage));
      const cacheHitText = cacheRead > 0 ? ` · 缓存命中 ${cacheRead}` : '';
      usageTagHtml = `
        <span class="sub-bar-tag" title="点击查看用量明细" onclick="showUsageDetailsModal('${encodedUsage}', '${escapeHtml(m.model || '')}')">
          ${total} tok${cacheHitText}
        </span>
      `;
    }
    const modelTagHtml = m.model ? `<span class="sub-bar-tag">${escapeHtml(m.model)}</span>` : '';

    card.innerHTML = `
      <div class="card-header">
        <img src="${avatar}" class="card-avatar-sm" alt="Agent">
        <span>${escapeHtml(name)}</span>
        <span style="font-size: 10px; color: var(--text-muted);">${formatTime(m.time)}</span>
      </div>
      <div class="card-bubble">${renderBubbleContent(m.content)}</div>
      <div class="message-sub-bar">
        <button class="sub-bar-icon-btn" title="编辑此消息" onclick="editMessageInSession(${index})">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
        </button>
        <span class="sub-bar-divider"></span>
        <button class="sub-bar-icon-btn" title="复制文本" onclick="copyMessageContentByIndex(${index}, this)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
        </button>
        <span class="sub-bar-divider"></span>
        <button class="sub-bar-icon-btn" title="查看此轮上下文" onclick="inspectTurnContext(${index})">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
        </button>
        <span class="sub-bar-divider"></span>
        <button class="sub-bar-icon-btn" style="color: var(--color-red);" title="删除此消息" onclick="deleteMessageInSession(${index})">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
        ${modelTagHtml}
        ${usageTagHtml}
      </div>
    `;
  } else if (m.role === 'compaction_summary') {
    card.className = 'compaction-card';
    card.innerHTML = `
      <div style="font-weight: 700; margin-bottom: 4px; display: flex; justify-content: space-between;">
        <span>Context Compaction Checkpoint</span>
        <span>${formatTime(m.time)}</span>
      </div>
      <div style="white-space: pre-wrap;">${escapeHtml(m.content)}</div>
    `;
  } else {
    return;
  }

  chatMessagesEl.appendChild(card);
}

// Combined Tool Execution Card with Diff Review Trigger
function appendToolUnifiedCard(exec) {
  const isErr = exec.status === 'error';
  const card = document.createElement('div');
  card.className = `tool-unified-card ${isErr ? 'error' : 'success'} collapsed`;
  card.id = `tool_exec_${exec.call_id}`;

  const purpose = exec.purpose || `执行 ${exec.name}`;

  let diffBadgeHtml = '';
  if (exec.fileDiff) {
    const encodedDiff = encodeURIComponent(JSON.stringify(exec.fileDiff));
    diffBadgeHtml = `
      <span class="tool-diff-badge" title="审查文件变动" onclick="event.stopPropagation(); inspectFileDiff('${encodedDiff}')">
        审查变动 (+${exec.fileDiff.addedCount}/-${exec.fileDiff.deletedCount})
      </span>
    `;
  }

  const hasArgs = exec.args !== undefined && exec.args !== null && (typeof exec.args !== 'object' || Object.keys(exec.args).length > 0);
  const argsDisplay = hasArgs
    ? (typeof exec.args === 'string' ? exec.args : JSON.stringify(exec.args, null, 2))
    : '(无参数或历史导入已省略参数)';

  const hasResult = exec.result !== undefined && exec.result !== null && exec.result !== '';
  const resultDisplay = hasResult
    ? (typeof exec.result === 'string' ? exec.result : JSON.stringify(exec.result, null, 2))
    : '(已完成 · 历史导入记录未保存输出详情)';

  card.innerHTML = `
    <div class="tool-unified-header" onclick="this.parentElement.classList.toggle('collapsed')">
      <div class="tool-header-main">
        <span class="tool-name-badge">${escapeHtml(exec.name)}</span>
        <span class="tool-purpose-text" title="${escapeHtml(purpose)}">${escapeHtml(purpose)}</span>
      </div>
      <div class="tool-unified-right">
        ${diffBadgeHtml}
        <span class="tool-status-pill">${exec.durationMs ? exec.durationMs + 'ms' : (isErr ? 'Error' : '完成')}</span>
        <span class="tool-chevron">▼</span>
      </div>
    </div>
    <div class="tool-unified-body">
      <div class="tool-field-title">调用参数 (Arguments):</div>
      <div class="tool-code-box">${escapeHtml(argsDisplay)}</div>
      <div class="tool-field-title">执行输出 (Output):</div>
      <div class="tool-code-box">${escapeHtml(resultDisplay)}</div>
    </div>
  `;

  chatMessagesEl.appendChild(card);
}

function scrollToBottom() {
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

// Send Message SSE
async function sendMessage() {
  const text = chatInputEl.value.trim();
  const imagesToSend = [...attachedImages];
  if (!text && imagesToSend.length === 0) return;
  if (!currentSessionId) return;

  chatInputEl.value = '';
  chatInputEl.style.height = 'auto';
  attachedImages = [];
  renderImagePreviews();

  const userMsgIndex = currentSessionObj?.messages?.length || 0;
  const currentAuthor = currentUser?.nickname || customization.userName || 'LynnH_Ma';
  const currentAvatar = currentUser?.avatar || (currentUser?.minecraftUuid ? `https://account.lynnhma.xyz/api/avatar/mojang/${currentUser.minecraftUuid}` : `https://minotar.net/helm/${encodeURIComponent(currentAuthor)}/64.png`);

  appendMessageCard({
    role: 'user',
    content: text,
    images: imagesToSend,
    author: currentAuthor,
    avatar: currentAvatar,
    time: Date.now()
  }, userMsgIndex);
  scrollToBottom();

  const avatar = customization.agentAvatar || 'assets/CoreNyan.png';
  const name = customization.agentName || '小可';

  const assistantCard = document.createElement('div');
  assistantCard.className = 'message-card assistant streaming-card';
  assistantCard.innerHTML = `
    <div class="card-header">
      <img src="${avatar}" class="card-avatar-sm" alt="Agent">
      <span>${escapeHtml(name)}</span>
      <span class="thinking-pulse" style="font-size: 11px;">Thinking...</span>
    </div>
    <div class="card-bubble" style="min-height: 24px;"><span class="streaming-cursor"></span></div>
    <div class="message-sub-bar" style="display: none;"></div>
  `;
  chatMessagesEl.appendChild(assistantCard);
  const bubbleEl = assistantCard.querySelector('.card-bubble');
  const headerEl = assistantCard.querySelector('.card-header');
  const subBarEl = assistantCard.querySelector('.message-sub-bar');
  scrollToBottom();

  sendBtnEl.disabled = true;
  setTaskRunningState(true);

  const selectedVal = modelSelectEl.value || '';
  const [providerId, modelId] = selectedVal.split('::');

  let assistantMeta = null;

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: currentSessionId,
        message: text,
        images: imagesToSend,
        author: currentAuthor,
        avatar: currentAvatar,
        clientId: window.__fcClientId || undefined,
        providerId: providerId || undefined,
        model: modelId || undefined,
        thinkingEffort: thinkingSelectEl.value
      })
    });

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let currentAssistantText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const raw = trimmed.slice(6);
        if (raw === '[DONE]') break;

        try {
          const evt = JSON.parse(raw);
          if (evt.type === 'delta') {
            currentAssistantText += evt.content;
            bubbleEl.innerHTML = escapeHtml(currentAssistantText) + '<span class="streaming-cursor"></span>';
            scrollToBottom();
          } else if (evt.type === 'assistant_meta') {
            assistantMeta = evt;
          } else if (evt.type === 'compaction') {
            showToast('已自动压缩历史上下文');
          } else if (evt.type === 'tool_start') {
            const toolCard = document.createElement('div');
            toolCard.className = 'tool-unified-card';
            toolCard.id = `tool_exec_${evt.callId}`;
            toolCard.innerHTML = `
              <div class="tool-unified-header">
                <div class="tool-header-main">
                  <span class="tool-name-badge">${escapeHtml(evt.name)}</span>
                  <span class="tool-purpose-text">${escapeHtml(evt.purpose)}</span>
                </div>
                <div class="tool-unified-right">
                  <span class="tool-status-pill">执行中...</span>
                </div>
              </div>
            `;
            // Keep tool cards below thinking bubble/assistant card
            chatMessagesEl.appendChild(toolCard);
            scrollToBottom();
          } else if (evt.type === 'tool_finish') {
            const existing = document.getElementById(`tool_exec_${evt.call_id}`);
            const isErr = evt.status === 'error';
            const finCard = document.createElement('div');
            finCard.className = `tool-unified-card ${isErr ? 'error' : 'success'} collapsed`;
            finCard.id = `tool_exec_${evt.call_id}`;

            let diffBadge = '';
            if (evt.fileDiff) {
              const enc = encodeURIComponent(JSON.stringify(evt.fileDiff));
              diffBadge = `
                <span class="tool-diff-badge" title="审查文件变动" onclick="event.stopPropagation(); inspectFileDiff('${enc}')">
                  审查变动 (+${evt.fileDiff.addedCount}/-${evt.fileDiff.deletedCount})
                </span>
              `;
            }

            finCard.innerHTML = `
              <div class="tool-unified-header" onclick="this.parentElement.classList.toggle('collapsed')">
                <div class="tool-header-main">
                  <span class="tool-name-badge">${escapeHtml(evt.name)}</span>
                  <span class="tool-purpose-text">${escapeHtml(evt.purpose)}</span>
                </div>
                <div class="tool-unified-right">
                  ${diffBadge}
                  <span class="tool-status-pill">${evt.durationMs ? evt.durationMs + 'ms' : '完成'}</span>
                  <span class="tool-chevron">▼</span>
                </div>
              </div>
              <div class="tool-unified-body">
                <div class="tool-field-title">调用参数 (Arguments):</div>
                <div class="tool-code-box">${escapeHtml(JSON.stringify(evt.args, null, 2))}</div>
                <div class="tool-field-title">执行输出 (Output):</div>
                <div class="tool-code-box">${escapeHtml(typeof evt.result === 'string' ? evt.result : JSON.stringify(evt.result, null, 2))}</div>
              </div>
            `;
            if (existing) {
              existing.replaceWith(finCard);
            } else {
              chatMessagesEl.appendChild(finCard);
            }
            scrollToBottom();
          } else if (evt.type === 'task_stopped') {
             const label = evt.code === 'TASK_TIMEOUT' ? '任务超时，已自动中止。' : '任务已中断。';
             bubbleEl.textContent = currentAssistantText ? `${currentAssistantText}\n\n[${label}]` : `[${label}]`;
             showToast(label);
           } else if (evt.type === 'task_stopped') {
             const label = evt.code === 'TASK_TIMEOUT' ? '任务超时，已自动中止。' : '任务已中断。';
             bubbleEl.textContent = currentAssistantText ? `${currentAssistantText}\n\n[${label}]` : `[${label}]`;
             showToast(label);
           } else if (evt.type === 'error') {
            bubbleEl.textContent += `\n[Error]: ${evt.error}`;
          }
        } catch(e) {}
      }
    }

    bubbleEl.innerHTML = renderBubbleContent(currentAssistantText);
    assistantCard.classList.remove('streaming-card');
    const pulseEl = headerEl.querySelector('.thinking-pulse');
    if (pulseEl) pulseEl.remove();
    const timeSpan = document.createElement('span');
    timeSpan.style.fontSize = '10px';
    timeSpan.style.color = 'var(--text-muted)';
    timeSpan.textContent = formatTime(Date.now());
    headerEl.appendChild(timeSpan);

    const asstIndex = (currentSessionObj?.messages?.length || 1);
    let usageTagHtml = '';
    if (assistantMeta?.usage) {
      const u = assistantMeta.usage;
      const total = u.total_tokens || ((u.prompt_tokens || 0) + (u.completion_tokens || 0));
      const cacheRead = u.cache_read || 0;
      const encUsage = encodeURIComponent(JSON.stringify(u));
      const cacheHitText = cacheRead > 0 ? ` · 缓存命中 ${cacheRead}` : '';
      usageTagHtml = `
        <span class="sub-bar-tag" title="点击查看用量明细" onclick="showUsageDetailsModal('${encUsage}', '${escapeHtml(assistantMeta.model || '')}')">
          ${total} tok${cacheHitText}
        </span>
      `;
    }
    const modelTagHtml = assistantMeta?.model ? `<span class="sub-bar-tag">${escapeHtml(assistantMeta.model)}</span>` : '';

    subBarEl.style.display = 'flex';
    subBarEl.innerHTML = `
      <button class="sub-bar-icon-btn" title="复制文本" onclick="copyText(this.closest('.message-card')?.querySelector('.card-bubble')?.textContent || '')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
      </button>
      <span class="sub-bar-divider"></span>
      <button class="sub-bar-icon-btn" title="查看此轮上下文" onclick="inspectTurnContext(${asstIndex})">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
      </button>
      ${modelTagHtml}
      ${usageTagHtml}
    `;

  } catch(e) {
    bubbleEl.textContent = `通信故障: ${e.message}`;
  } finally {
    setTaskRunningState(false);
    loadGroupsAndSessions();
  }
}

// ================= Refined Settings Modal (White Plain Text, 2-3 char Tabs) =================
let lastActiveSettingsTab = 'persona';

window.openSettingsModal = async (initialTab = lastActiveSettingsTab) => {
  modalTitleEl.innerHTML = '设置';
  modalContentEl.innerHTML = '<div style="color: #fff; text-align: center; padding: 20px;">加载中...</div>';
  modalOverlayEl.style.display = 'flex';

  try {
    const res = await fetch('/api/settings');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { config, persona, providers: currentProviders, customization: currentCustom } = await res.json();

    modalContentEl.innerHTML = `
      <div class="modal-tabs">
        <button class="modal-tab-btn active" id="tabBtn_persona">人设</button>
        <button class="modal-tab-btn" id="tabBtn_custom">外观</button>
        <button class="modal-tab-btn" id="tabBtn_providers">模型</button>
        <button class="modal-tab-btn" id="tabBtn_skills">Skills</button>
        <button class="modal-tab-btn" id="tabBtn_memory">记忆</button>
        <button class="modal-tab-btn" id="tabBtn_audit">审计</button>
        <button class="modal-tab-btn" id="tabBtn_plugins">插件</button>
        <button class="modal-tab-btn" id="tabBtn_paths">系统</button>
      </div>

      <!-- Tab 1: 人设 -->
      <div id="tab_persona" class="tab-pane">
        <div class="persona-card-preview">
          <img src="${escapeHtml(currentCustom?.agentAvatar || 'assets/CoreNyan.png')}" class="persona-avatar-lg" alt="Avatar">
          <div style="flex: 1;">
            <div style="font-size: 16px; font-weight: 800; color: #fff;">${escapeHtml(persona.name || '小可')} (${escapeHtml(persona.fullName || 'CoreNyan')})</div>
            <div style="font-size: 12px; color: #fff; margin-top: 5px;">${escapeHtml(persona.stance || '少女玩家与服务器 OP')}</div>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
          <div class="form-group">
            <label class="form-label">自称</label>
            <input type="text" id="pName" class="form-input" value="${escapeHtml(persona.name || '小可')}">
          </div>
          <div class="form-group">
            <label class="form-label">全称标识</label>
            <input type="text" id="pFullName" class="form-input" value="${escapeHtml(persona.fullName || '小可 (CoreNyan)')}">
          </div>
        </div>

        <div class="form-group" style="margin-top: 10px;">
          <label class="form-label">关系立场</label>
          <textarea id="pStance" class="form-input" rows="2">${escapeHtml(persona.stance || '')}</textarea>
        </div>

        <div class="form-group" style="margin-top: 10px;">
          <label class="form-label">性格正文</label>
          <textarea id="pCharacter" class="form-input" rows="3">${escapeHtml(persona.character || '')}</textarea>
        </div>

        <div class="form-group" style="margin-top: 10px;">
          <label class="form-label">语气规范</label>
          <textarea id="pTone" class="form-input" rows="2">${escapeHtml(persona.tone || '')}</textarea>
        </div>

        <div class="form-group" style="margin-top: 10px;">
          <label class="form-label">形象与职责</label>
          <textarea id="pAppearance" class="form-input" rows="3">${escapeHtml(persona.appearance || '')}</textarea>
        </div>

        <div class="form-group" style="margin-top: 10px;">
          <label class="form-label">工作契约 (换行分隔)</label>
          <textarea id="pContracts" class="form-input" rows="3">${escapeHtml((persona.contracts || []).join('\n'))}</textarea>
        </div>
      </div>

      <!-- Tab 2: 个性化 (Full Frontend Customization + Send Shortcut) -->
      <div id="tab_custom" class="tab-pane" style="display: none;">
        <div style="font-size: 12.5px; color: #fff; margin-bottom: 12px;">
          自由定制全局界面色彩、气泡样式、角色标识与快捷键：
        </div>

        <!-- 快捷键配置 -->
        <div style="border: 1px solid var(--border-default); border-radius: var(--radius-md); padding: 14px; background: #090d13; margin-bottom: 12px;">
          <div style="font-weight: 700; font-size: 13px; margin-bottom: 10px; color: #fff;">发送快捷键偏好</div>
          <div class="form-group">
            <label class="form-label">发送消息方式</label>
            <select id="custSendKey" class="form-input" style="cursor: pointer;">
              <option value="enter" ${currentCustom?.sendKey === 'enter' ? 'selected' : ''}>Enter 发送，Shift+Enter 换行</option>
              <option value="ctrl_enter" ${currentCustom?.sendKey === 'ctrl_enter' ? 'selected' : ''}>Ctrl+Enter 发送，Enter 换行</option>
            </select>
          </div>
        </div>

        <!-- 用户样式配置（头像与昵称由 FreeCore-Account 实时同步，仅保留颜色自定义） -->
        <div style="border: 1px solid var(--border-default); border-radius: var(--radius-md); padding: 14px; background: #090d13; margin-bottom: 12px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
            <div style="font-weight: 700; font-size: 13px; color: #fff;">用户 (User) 气泡与标识</div>
            <span style="font-size: 11px; color: var(--text-muted);">昵称与皮肤头像已自动同步当前登录账户</span>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
            <div class="form-group">
              <label class="form-label">昵称与描边色彩</label>
              <div class="form-color-picker">
                <input type="color" id="custUserColor" class="form-color-input" value="${currentCustom?.userColor || '#f472b6'}">
                <input type="text" class="form-input" style="flex: 1;" value="${currentCustom?.userColor || '#f472b6'}" oninput="custUserColor.value=this.value">
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">气泡底色</label>
              <div class="form-color-picker">
                <input type="color" id="custUserBubbleBg" class="form-color-input" value="${currentCustom?.userBubbleBg || '#1f1b29'}">
                <input type="text" class="form-input" style="flex: 1;" value="${currentCustom?.userBubbleBg || '#1f1b29'}" oninput="custUserBubbleBg.value=this.value">
              </div>
            </div>
          </div>
        </div>

        <!-- AI 样式配置 -->
        <div style="border: 1px solid var(--border-default); border-radius: var(--radius-md); padding: 14px; background: #090d13; margin-bottom: 12px;">
          <div style="font-weight: 700; font-size: 13px; margin-bottom: 10px; color: #fff;">AI (Assistant) 气泡与标识</div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px;">
            <div class="form-group">
              <label class="form-label">AI 角色名称</label>
              <input type="text" id="custAgentName" class="form-input" value="${escapeHtml(currentCustom?.agentName || '小可')}">
            </div>
            <div class="form-group">
              <label class="form-label">AI 头像 (路径或点击上传)</label>
              <div style="display: flex; gap: 6px;">
                <input type="text" id="custAgentAvatar" class="form-input" style="flex: 1;" value="${escapeHtml(currentCustom?.agentAvatar || 'assets/CoreNyan.png')}">
                <button type="button" class="btn-secondary" style="white-space: nowrap; padding: 6px 10px;" onclick="document.getElementById('uploadAgentAvatarInput').click()">上传</button>
                <input type="file" id="uploadAgentAvatarInput" accept="image/*" style="display: none;" onchange="handleAvatarUpload(this, 'custAgentAvatar')">
              </div>
            </div>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
            <div class="form-group">
              <label class="form-label">名称与描边色彩</label>
              <div class="form-color-picker">
                <input type="color" id="custAgentColor" class="form-color-input" value="${currentCustom?.agentColor || '#38bdf8'}">
                <input type="text" class="form-input" style="flex: 1;" value="${currentCustom?.agentColor || '#38bdf8'}" oninput="custAgentColor.value=this.value">
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">气泡底色</label>
              <div class="form-color-picker">
                <input type="color" id="custAgentBubbleBg" class="form-color-input" value="${currentCustom?.agentBubbleBg || '#161b22'}">
                <input type="text" class="form-input" style="flex: 1;" value="${currentCustom?.agentBubbleBg || '#161b22'}" oninput="custAgentBubbleBg.value=this.value">
              </div>
            </div>
          </div>
        </div>

        <!-- 全局背景配置 -->
        <div style="border: 1px solid var(--border-default); border-radius: var(--radius-md); padding: 14px; background: #090d13;">
          <div style="font-weight: 700; font-size: 13px; margin-bottom: 10px; color: #fff;">系统全局品牌与背景</div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px;">
            <div class="form-group">
              <label class="form-label">左上角应用名称</label>
              <input type="text" id="custAppName" class="form-input" value="${escapeHtml(currentCustom?.appName || 'FreeCore-Mind')}">
            </div>
            <div class="form-group">
              <label class="form-label">应用图标 (路径或点击上传)</label>
              <div style="display: flex; gap: 6px;">
                <input type="text" id="custAppAvatar" class="form-input" style="flex: 1;" value="${escapeHtml(currentCustom?.appAvatar || 'assets/CoreNyan.png')}">
                <button type="button" class="btn-secondary" style="white-space: nowrap; padding: 6px 10px;" onclick="document.getElementById('uploadAppAvatarInput').click()">上传</button>
                <input type="file" id="uploadAppAvatarInput" accept="image/*" style="display: none;" onchange="handleAvatarUpload(this, 'custAppAvatar')">
              </div>
            </div>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
            <div class="form-group">
              <label class="form-label">主背景底色</label>
              <div class="form-color-picker">
                <input type="color" id="custAppBg" class="form-color-input" value="${currentCustom?.appBg || '#0d1117'}">
                <input type="text" class="form-input" style="flex: 1;" value="${currentCustom?.appBg || '#0d1117'}" oninput="custAppBg.value=this.value">
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">侧边栏底色</label>
              <div class="form-color-picker">
                <input type="color" id="custSidebarBg" class="form-color-input" value="${currentCustom?.sidebarBg || '#090d13'}">
                <input type="text" class="form-input" style="flex: 1;" value="${currentCustom?.sidebarBg || '#090d13'}" oninput="custSidebarBg.value=this.value">
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Tab 3: 模型 -->
      <div id="tab_providers" class="tab-pane" style="display: none;">
        <div id="providersListContainer" style="display: flex; flex-direction: column; gap: 12px; margin-bottom: 12px;"></div>
        <button id="btnAddProvider" class="btn-secondary" style="margin-bottom: 14px;">+ 添加中转站</button>
      </div>

      <!-- Tab 4: Skills -->
      <div id="tab_skills" class="tab-pane" style="display: none;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <div>
            <div style="font-weight: 700; color: #fff; font-size: 14px;">Skills 技能资产中心</div>
            <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px; font-family: var(--font-mono);">${escapeHtml(config.paths?.skills || '')}</div>
          </div>
          <button class="btn-primary" style="font-size: 12px; padding: 6px 12px;" onclick="openFileManagerModal('skills')">打开独立 Skills 深度管理器 ↗</button>
        </div>
        <div id="settingsSkillsTreeList" style="background: #090d13; border: 1px solid var(--border-default); border-radius: 8px; padding: 12px; max-height: 380px; overflow-y: auto;">
          <div style="text-align: center; color: var(--text-muted); padding: 20px;">正在加载 Skills 清单...</div>
        </div>
      </div>

      <!-- Tab 5: 记忆 -->
      <div id="tab_memory" class="tab-pane" style="display: none;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <div>
            <div style="font-weight: 700; color: #fff; font-size: 14px;">记忆核心知识库 (Memory Vault)</div>
            <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px; font-family: var(--font-mono);">${escapeHtml(config.paths?.memoryVault || '')}</div>
          </div>
          <button class="btn-primary" style="font-size: 12px; padding: 6px 12px;" onclick="openFileManagerModal('memory')">打开独立记忆知识卡管理器 ↗</button>
        </div>
        <div id="settingsMemoryTreeList" style="background: #090d13; border: 1px solid var(--border-default); border-radius: 8px; padding: 12px; max-height: 380px; overflow-y: auto;">
          <div style="text-align: center; color: var(--text-muted); padding: 20px;">正在加载记忆知识卡清单...</div>
        </div>
      </div>

      <!-- Tab 6: 审计 -->
      <div id="tab_audit" class="tab-pane" style="display: none;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
          <span style="font-size: 13px; color: var(--text-muted);">工具调用审计时间轴</span>
          <button class="btn-secondary" style="font-size: 12px; padding: 4px 10px;" onclick="renderAuditInSettings()">加载审计日志</button>
        </div>
        <div id="settingsAuditContainer" style="max-height: 320px; overflow-y: auto; background: #090d13; border: 1px solid var(--border-default); border-radius: 8px; padding: 12px; font-size: 12.5px; color: #c9d1d9;">
          点击上方按钮加载最新审计记录
        </div>
      </div>

      <!-- Tab 7: 插件 -->
      <div id="tab_plugins" class="tab-pane" style="display: none;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
          <span style="font-size: 13px; color: var(--text-muted);">CoreNyan 动态工具与扩展插件</span>
          <button class="btn-secondary" style="font-size: 12px; padding: 4px 10px;" onclick="renderPluginsInSettings()">加载插件列表</button>
        </div>
        <div id="settingsPluginsContainer" style="max-height: 320px; overflow-y: auto; background: #090d13; border: 1px solid var(--border-default); border-radius: 8px; padding: 12px; font-size: 12.5px; color: #c9d1d9;">
          点击上方按钮加载当前运行的插件
        </div>
      </div>

      <!-- Tab 8: 系统 -->
      <div id="tab_paths" class="tab-pane" style="display: none;">
        <div class="form-group">
          <label class="form-label">服务端口</label>
          <input type="number" id="cfgPort" class="form-input" value="${config.server.port || 25999}">
        </div>
        <div class="form-group">
          <label class="form-label">记忆路径</label>
          <input type="text" id="pathMemory" class="form-input" value="${escapeHtml(config.paths.memoryVault || '')}">
        </div>
        <div class="form-group">
          <label class="form-label">Skills 路径</label>
          <input type="text" id="pathSkills" class="form-input" value="${escapeHtml(config.paths.skills || '')}">
        </div>
        <div class="form-group">
          <label class="form-label">工作区路径</label>
          <input type="text" id="pathWorkspace" class="form-input" value="${escapeHtml(config.paths.workspace || '')}">
        </div>
      </div>

      <div style="margin-top: 14px; display: flex; gap: 12px; align-items: center;">
        <button id="btnSaveSettings" class="btn-submit">保存配置 (Ctrl+S)</button>
        <span id="saveStatus" style="font-size: 13px; font-weight: 600; color: #fff;"></span>
      </div>
    `;

    let localProviders = JSON.parse(JSON.stringify(currentProviders || []));
    const renderProviderRows = () => {
      const container = document.getElementById('providersListContainer');
      container.innerHTML = '';
      localProviders.forEach((p, idx) => {
        const item = document.createElement('div');
        item.style.border = '1px solid var(--border-default)';
        item.style.borderRadius = 'var(--radius-md)';
        item.style.padding = '12px';
        item.style.background = '#090d13';

        const modelsStr = (p.models || []).map(m => m.id).join(', ');

        item.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <input type="text" class="form-input prov-name" style="font-weight: 700; width: 220px;" value="${escapeHtml(p.name)}" placeholder="中转站名称">
            <button class="footer-btn" style="color: var(--color-red); padding: 4px 8px;" onclick="deleteProviderRow(${idx})">删除</button>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px;">
            <div class="form-group">
              <label class="form-label">Base URL</label>
              <input type="text" class="form-input prov-url" value="${escapeHtml(p.baseURL)}" placeholder="https://api.example.com/v1">
            </div>
            <div class="form-group">
              <label class="form-label">API Key</label>
              <input type="password" class="form-input prov-key" value="${escapeHtml(p.apiKey)}" placeholder="sk-...">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">模型列表 (英文逗号分隔)</label>
            <input type="text" class="form-input prov-models" value="${escapeHtml(modelsStr)}" placeholder="gemini-3.8-flash, gpt-5.6-terra">
          </div>
        `;
        container.appendChild(item);
      });
    };

    window.deleteProviderRow = (idx) => {
      localProviders.splice(idx, 1);
      renderProviderRows();
    };

    document.getElementById('btnAddProvider').onclick = () => {
      localProviders.push({
        id: `provider-${Date.now()}`,
        name: '新中转站',
        baseURL: 'https://api.example.com/v1',
        apiKey: '',
        models: [{ id: 'gpt-4o', name: 'GPT-4o' }]
      });
      renderProviderRows();
    };

    renderProviderRows();

    const tabs = ['persona', 'custom', 'providers', 'skills', 'memory', 'audit', 'plugins', 'paths'];
    const switchSettingsTab = (t) => {
      lastActiveSettingsTab = t;
      tabs.forEach(o => {
        const pane = document.getElementById(`tab_${o}`);
        const b = document.getElementById(`tabBtn_${o}`);
        if (pane) pane.style.display = o === t ? 'block' : 'none';
        if (b) b.classList.toggle('active', o === t);
      });
      if (t === 'skills') window.loadSettingsSkillsTree();
      if (t === 'memory') window.loadSettingsMemoryTree();
      if (t === 'audit') window.renderAuditInSettings();
      if (t === 'plugins') window.renderPluginsInSettings();
    };
    tabs.forEach(t => {
      const btn = document.getElementById(`tabBtn_${t}`);
      if (btn) {
        btn.onclick = () => switchSettingsTab(t);
      }
    });
    if (initialTab && tabs.includes(initialTab)) {
      switchSettingsTab(initialTab);
    }

    document.getElementById('btnSaveSettings').onclick = async () => {
      const statusEl = document.getElementById('saveStatus');
      statusEl.textContent = '保存中...';

      const rows = document.querySelectorAll('#providersListContainer > div');
      const updatedProviders = [];
      rows.forEach((row, idx) => {
        const name = row.querySelector('.prov-name').value.trim();
        const baseURL = row.querySelector('.prov-url').value.trim();
        const apiKey = row.querySelector('.prov-key').value.trim();
        const modelsRaw = row.querySelector('.prov-models').value.trim();
        const models = modelsRaw.split(',').map(m => m.trim()).filter(Boolean).map(m => ({ id: m, name: m }));
        const id = localProviders[idx]?.id || `provider-${Date.now()}-${idx}`;
        updatedProviders.push({ id, name, baseURL, apiKey, models });
      });

      const updatedConfig = {
        server: {
          port: parseInt(document.getElementById('cfgPort').value, 10) || 25999,
          host: config.server.host || '0.0.0.0'
        },
        llm: config.llm,
        paths: {
          memoryVault: document.getElementById('pathMemory').value.trim(),
          skills: document.getElementById('pathSkills').value.trim(),
          workspace: document.getElementById('pathWorkspace').value.trim(),
          sessions: config.paths.sessions
        }
      };

      const rawContracts = document.getElementById('pContracts').value.split('\n').map(c => c.trim()).filter(Boolean);

      const updatedPersona = {
        name: document.getElementById('pName').value.trim(),
        fullName: document.getElementById('pFullName').value.trim(),
        stance: document.getElementById('pStance').value.trim(),
        character: document.getElementById('pCharacter').value.trim(),
        tone: document.getElementById('pTone').value.trim(),
        appearance: document.getElementById('pAppearance').value.trim(),
        contracts: rawContracts
      };

      const updatedCustom = {
        appName: document.getElementById('custAppName').value.trim(),
        appAvatar: document.getElementById('custAppAvatar').value.trim(),
        userColor: document.getElementById('custUserColor').value.trim(),
        userBubbleBg: document.getElementById('custUserBubbleBg').value.trim(),
        agentName: document.getElementById('custAgentName').value.trim(),
        agentAvatar: document.getElementById('custAgentAvatar').value.trim(),
        agentColor: document.getElementById('custAgentColor').value.trim(),
        agentBubbleBg: document.getElementById('custAgentBubbleBg').value.trim(),
        appBg: document.getElementById('custAppBg').value.trim(),
        sidebarBg: document.getElementById('custSidebarBg').value.trim(),
        sendKey: document.getElementById('custSendKey').value
      };

      try {
        const sRes = await fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            config: updatedConfig,
            persona: updatedPersona,
            providers: updatedProviders,
            customization: updatedCustom
          })
        });
        showToast('配置已保存并即时生效');
        statusEl.textContent = '已保存';
        customization = updatedCustom;
        applyCustomization();
        loadProviders();
        if (currentSessionId) selectSession(currentSessionId);
        setTimeout(() => { statusEl.textContent = ''; }, 3000);
      } catch (err) {
        statusEl.textContent = '保存失败: ' + err.message;
      }
    };

  } catch(e) {
    modalContentEl.innerHTML = '<div style="color: #f87171; padding: 20px;">加载设置失败: ' + e.message + '</div>';
  }
};

btnSettingsEl.addEventListener('click', () => {
  window.openSettingsModal(lastActiveSettingsTab || 'persona');
});

// 2. Tool Audit Modal
if (btnToolAuditEl) {
  btnToolAuditEl.addEventListener('click', async () => {
    modalTitleEl.innerHTML = '审计';
    modalContentEl.innerHTML = '<div style="color: #fff; text-align: center; padding: 20px;">加载工具记录中...</div>';
    modalOverlayEl.style.display = 'flex';

    try {
      const res = await fetch(`/api/tool-calls?sessionId=${currentSessionId || ''}`);
      const data = await res.json();
      const calls = data.calls || [];

      if (calls.length === 0) {
        modalContentEl.innerHTML = '<div style="color: #8b949e; text-align: center; padding: 40px;">暂无工具调用记录。</div>';
        return;
      }

      let html = `
        <div style="font-size: 13px; color: #fff; margin-bottom: 6px;">
          已审计 <b>${calls.length}</b> 次系统工具操作：
        </div>
        <div style="display: flex; flex-direction: column; gap: 10px;">
      `;

      for (const c of calls) {
        const isErr = c.status === 'error';
        html += `
          <div style="border: 1px solid var(--border-default); border-left: 3px solid ${isErr ? 'var(--color-red)' : 'var(--color-emerald)'}; border-radius: var(--radius-md); padding: 12px; background: #090d13;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
              <div style="font-weight: 700; color: #fff; font-family: var(--font-mono); font-size: 13px;">
                ${escapeHtml(c.name)} <span style="font-size: 12px; font-weight: 400; color: var(--color-cyan);">(${escapeHtml(c.purpose || '执行')})</span>
              </div>
              <div style="font-size: 11px; display: flex; gap: 8px; align-items: center;">
                <span class="tool-status-pill" style="${isErr ? 'color: var(--color-red); border-color: rgba(248,113,113,0.3); background: rgba(248,113,113,0.1);' : ''}">
                  ${isErr ? 'Error' : 'OK'}
                </span>
                <span style="color: var(--text-muted);">${c.durationMs ? c.durationMs + 'ms' : ''}</span>
                <span style="color: var(--text-muted);">${formatTime(c.time)}</span>
              </div>
            </div>
            <div style="font-size: 11px; color: #fff; margin-bottom: 4px;">Arguments:</div>
            <div class="tool-code-box" style="max-height: 80px; margin-bottom: 6px;">${escapeHtml(JSON.stringify(c.args, null, 2))}</div>
            <div style="font-size: 11px; color: #fff; margin-bottom: 4px;">Output:</div>
            <div class="tool-code-box" style="max-height: 100px;">${escapeHtml(typeof c.result === 'string' ? c.result : JSON.stringify(c.result, null, 2))}</div>
          </div>
        `;
      }
      html += '</div>';
      modalContentEl.innerHTML = html;
    } catch(e) {
      modalContentEl.innerHTML = '<div style="color: #f87171; padding: 20px;">加载审计失败: ' + e.message + '</div>';
    }
  });
}

// 3. Generic File Manager Modal Generator (For Skills and Memory)
function openFileManagerModal(type, initialRelPath = null) {
  const isSkill = type === 'skills';
  const apiBase = isSkill ? '/api/skills-manager' : '/api/memory-manager';
  const titleName = isSkill ? 'Skills 规则管理' : 'Memory 记忆知识库';

  modalTitleEl.innerHTML = `
    <div style="display: inline-flex; align-items: center; gap: 10px;">
      <span>${titleName}</span>
      <button class="btn-secondary" style="font-size: 11px; padding: 3px 10px;" onclick="window.openSettingsModal('${isSkill ? 'skills' : 'memory'}')">← 返回设置</button>
    </div>
  `;
  modalOverlayEl.style.display = 'flex';

  modalContentEl.innerHTML = `
    <div class="fm-layout">
      <div class="fm-sidebar">
        <div class="fm-sidebar-header">
          <span style="font-size: 12px; font-weight: 700; color: #fff;">文件列表</span>
          <button id="fmBtnNew" class="btn-secondary" style="padding: 3px 8px; font-size: 11px;">+ 新建</button>
        </div>
        <div id="fmFileList" class="fm-file-list">
          <div style="color: var(--text-muted); font-size: 11.5px; padding: 10px; text-align: center;">加载中...</div>
        </div>
      </div>
      <div class="fm-main">
        <div class="fm-main-header">
          <div style="display: flex; align-items: center; gap: 8px;">
            <input type="text" id="fmCurrentPath" class="form-input" style="font-size: 12px; padding: 4px 8px; width: 260px;" placeholder="文件名.md">
            <span id="fmSaveStatus" style="font-size: 11.5px; color: var(--color-emerald);"></span>
          </div>
          <div style="display: flex; gap: 8px;">
            <button id="fmBtnSave" class="btn-submit" style="padding: 4px 12px; font-size: 12px;">保存 (Ctrl+S)</button>
          </div>
        </div>
        <textarea id="fmEditor" class="fm-editor" placeholder="在此编辑 Markdown 内容..."></textarea>
      </div>
    </div>
  `;

  let fileList = [];
  let currentActivePath = initialRelPath ? initialRelPath.replace(/\\/g, '/') : null;
  let collapsedFolderPaths = new Set();
  let defaultCollapsedInitialized = false;

  const loadFiles = async () => {
    try {
      const res = await fetch(apiBase);
      const data = await res.json();
      fileList = data.files || [];

      // Initialize all folder paths to be collapsed by default (except ancestors of currentActivePath)
      if (!defaultCollapsedInitialized) {
        fileList.forEach(f => {
          const parts = f.relPath.replace(/\\/g, '/').split('/');
          let curr = '';
          for (let i = 0; i < parts.length - 1; i++) {
            curr = curr ? `${curr}/${parts[i]}` : parts[i];
            collapsedFolderPaths.add(curr);
          }
        });
        if (currentActivePath) {
          const activeParts = currentActivePath.split('/');
          let curr = '';
          for (let i = 0; i < activeParts.length - 1; i++) {
            curr = curr ? `${curr}/${activeParts[i]}` : activeParts[i];
            collapsedFolderPaths.delete(curr);
          }
        }
        defaultCollapsedInitialized = true;
      }

      renderTree();
      if (currentActivePath) {
        const matched = fileList.find(f => f.relPath.replace(/\\/g, '/') === currentActivePath);
        if (matched) {
          loadFileContent(matched.relPath);
        } else if (fileList.length > 0) {
          loadFileContent(fileList[0].relPath);
        }
      } else if (fileList.length > 0) {
        loadFileContent(fileList[0].relPath);
      }
    } catch (e) {
      document.getElementById('fmFileList').innerHTML = `<div style="color: #f87171; padding: 10px;">加载失败: ${e.message}</div>`;
    }
  };

  // Build hierarchical folder tree from flat relative paths
  const buildTree = (files) => {
    const root = { name: '', isDir: true, path: '', children: new Map(), files: [] };
    for (const f of files) {
      const parts = f.relPath.replace(/\\/g, '/').split('/');
      let curr = root;
      let currPath = '';
      for (let i = 0; i < parts.length - 1; i++) {
        const p = parts[i];
        currPath = currPath ? `${currPath}/${p}` : p;
        if (!curr.children.has(p)) {
          curr.children.set(p, { name: p, isDir: true, path: currPath, children: new Map(), files: [] });
        }
        curr = curr.children.get(p);
      }
      curr.files.push(f);
    }
    return root;
  };

  // Context menu launcher for FM
  const openFmMenu = (e, targetInfo) => {
    e.preventDefault();
    e.stopPropagation();
    fmContextMenuTarget = targetInfo;
    fmContextMenuEl.style.left = `${Math.min(e.clientX, window.innerWidth - 160)}px`;
    fmContextMenuEl.style.top = `${Math.min(e.clientY, window.innerHeight - 180)}px`;
    fmContextMenuEl.style.display = 'block';

    ctxFmPasteEl.style.display = fmClipboardPath ? 'block' : 'none';
  };

  const renderTreeNode = (node, container) => {
    // 1. Render directories first
    const sortedDirKeys = Array.from(node.children.keys()).sort();
    for (const dirKey of sortedDirKeys) {
      const dirNode = node.children.get(dirKey);
      const folderEl = document.createElement('div');
      const isCollapsed = collapsedFolderPaths.has(dirNode.path);
      folderEl.className = `fm-tree-folder ${isCollapsed ? 'collapsed' : ''}`;

      const headerEl = document.createElement('div');
      headerEl.className = 'fm-tree-folder-header';
      headerEl.innerHTML = `
        <span class="fm-tree-chevron">▼</span>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
        <span>${escapeHtml(dirNode.name)}</span>
      `;

      // Directory Drag & Drop Drop Target
      headerEl.ondragover = (e) => {
        if (e.dataTransfer.types.includes('text/fm-file')) {
          e.preventDefault();
          headerEl.classList.add('drag-over');
        }
      };
      headerEl.ondragleave = () => {
        headerEl.classList.remove('drag-over');
      };
      headerEl.ondrop = async (e) => {
        headerEl.classList.remove('drag-over');
        const srcRel = e.dataTransfer.getData('text/fm-file');
        if (srcRel) {
          e.preventDefault();
          const fileName = srcRel.split('/').pop();
          const destRel = `${dirNode.path}/${fileName}`;
          if (srcRel !== destRel) {
            await fetch(`${apiBase}/rename`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ oldPath: srcRel, newPath: destRel })
            });
            showToast(`已移动到 ${dirNode.name}`);
            if (currentActivePath === srcRel) currentActivePath = destRel;
            loadFiles();
          }
        }
      };

      headerEl.onclick = () => {
        if (collapsedFolderPaths.has(dirNode.path)) {
          collapsedFolderPaths.delete(dirNode.path);
          folderEl.classList.remove('collapsed');
        } else {
          collapsedFolderPaths.add(dirNode.path);
          folderEl.classList.add('collapsed');
        }
      };

      headerEl.oncontextmenu = (e) => {
        openFmMenu(e, { apiBase, relPath: dirNode.path, isDir: true, refresh: loadFiles });
      };

      const childrenEl = document.createElement('div');
      childrenEl.className = 'fm-tree-folder-children';
      renderTreeNode(dirNode, childrenEl);

      folderEl.appendChild(headerEl);
      folderEl.appendChild(childrenEl);
      container.appendChild(folderEl);
    }

    // 2. Render files in this directory
    node.files.sort((a, b) => a.name.localeCompare(b.name)).forEach(f => {
      const item = document.createElement('div');
      item.className = `fm-file-item ${f.relPath === currentActivePath ? 'active' : ''}`;
      item.draggable = true;
      item.dataset.relPath = f.relPath;

      // File Drag Handlers
      item.ondragstart = (e) => {
        item.classList.add('dragging');
        e.dataTransfer.setData('text/fm-file', f.relPath);
        e.dataTransfer.effectAllowed = 'move';
      };
      item.ondragend = () => {
        item.classList.remove('dragging');
      };

      item.innerHTML = `
        <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; display: inline-flex; align-items: center; gap: 5px;">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
          ${escapeHtml(f.name)}
        </span>
        <span class="fm-file-item-del" title="删除文件">×</span>
      `;

      item.onclick = (e) => {
        if (e.target.classList.contains('fm-file-item-del')) return;
        loadFileContent(f.relPath);
      };

      item.oncontextmenu = (e) => {
        openFmMenu(e, {
          apiBase,
          relPath: f.relPath,
          isDir: false,
          refresh: loadFiles,
          setActive: (p) => { currentActivePath = p; }
        });
      };

      item.querySelector('.fm-file-item-del').onclick = async (e) => {
        e.stopPropagation();
        if (confirm(`确认删除文件「${f.relPath}」吗？`)) {
          await fetch(`${apiBase}/file?path=${encodeURIComponent(f.relPath)}`, { method: 'DELETE' });
          showToast('文件已删除');
          if (currentActivePath === f.relPath) {
            currentActivePath = null;
            document.getElementById('fmCurrentPath').value = '';
            document.getElementById('fmEditor').value = '';
          }
          loadFiles();
        }
      };

      container.appendChild(item);
    });
  };

  const renderTree = () => {
    const listEl = document.getElementById('fmFileList');
    listEl.innerHTML = '';
    if (fileList.length === 0) {
      listEl.innerHTML = '<div style="color: var(--text-muted); font-size: 11.5px; padding: 10px; text-align: center;">暂无文件</div>';
      return;
    }
    const treeRoot = buildTree(fileList);
    renderTreeNode(treeRoot, listEl);
  };

  const loadFileContent = async (relPath) => {
    currentActivePath = relPath;
    document.getElementById('fmCurrentPath').value = relPath;
    renderTree();
    try {
      const res = await fetch(`${apiBase}/file?path=${encodeURIComponent(relPath)}`);
      const data = await res.json();
      document.getElementById('fmEditor').value = data.content || '';
    } catch (e) {
      document.getElementById('fmEditor').value = '加载失败: ' + e.message;
    }
  };

  document.getElementById('fmBtnNew').onclick = () => {
    const newName = prompt('请输入新文件相对路径（如 rule.md 或 sub/spec.md）：');
    if (newName && newName.trim()) {
      const safe = newName.trim().endsWith('.md') ? newName.trim() : `${newName.trim()}.md`;
      currentActivePath = safe;
      document.getElementById('fmCurrentPath').value = safe;
      document.getElementById('fmEditor').value = `# ${safe.replace(/\.md$/, '')}\n\n`;
      document.getElementById('fmBtnSave').click();
    }
  };

  document.getElementById('fmBtnSave').onclick = async () => {
    const relPath = document.getElementById('fmCurrentPath').value.trim();
    if (!relPath) return alert('请输入文件名');
    const content = document.getElementById('fmEditor').value;
    const statusEl = document.getElementById('fmSaveStatus');

    statusEl.textContent = '保存中...';
    try {
      const res = await fetch(`${apiBase}/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: relPath, content })
      });
      if (res.ok) {
        statusEl.textContent = '已保存';
        showToast('文件保存成功');
        currentActivePath = relPath;
        loadFiles();
        setTimeout(() => { statusEl.textContent = ''; }, 2500);
      } else {
        const err = await res.json();
        alert(err.error || '保存失败');
      }
    } catch (e) {
      alert('保存失败: ' + e.message);
    }
  };

  loadFiles();
}

// 3. Skills Modal Trigger
if (btnSkillsEl) {
  btnSkillsEl.addEventListener('click', () => {
    openFileManagerModal('skills');
  });
}

// 3.1 Memory Modal Trigger
if (btnMemoryEl) {
  btnMemoryEl.addEventListener('click', () => {
    openFileManagerModal('memory');
  });
}

// 4. Plugins Modal
if (btnPluginsEl) {
  btnPluginsEl.addEventListener('click', async () => {
    modalTitleEl.innerHTML = '插件';
    modalContentEl.innerHTML = '<div style="color: #fff; text-align: center; padding: 20px;">加载插件列表中...</div>';
    modalOverlayEl.style.display = 'flex';
    loadPluginsList();
  });
}

async function loadPluginsList() {
  try {
    const res = await fetch('/api/plugins');
    const data = await res.json();
    const list = Array.isArray(data) ? data : (data.plugins || []);
    let html = '<div style="font-size: 13px; color: #fff; margin-bottom: 10px;">扩展插件：</div><div style="display: flex; flex-direction: column; gap: 8px;">';
    for (const p of list) {
      html += `
        <div style="border: 1px solid var(--border-default); border-radius: var(--radius-md); padding: 12px 16px; background: #090d13; display: flex; justify-content: space-between; align-items: center;">
          <div>
            <div style="font-weight: 700; font-size: 13.5px; color: #fff;">${escapeHtml(p.name)} <span style="font-size: 11px; color: var(--text-muted);">v${escapeHtml(p.version)}</span></div>
            <div style="font-size: 12px; color: #8b949e; margin-top: 4px;">${escapeHtml(p.description)}</div>
          </div>
          <div>
            <button onclick="togglePlugin('${escapeHtml(p.id)}', ${!p.enabled})" class="footer-btn" style="color: ${p.enabled ? 'var(--color-emerald)' : 'var(--text-muted)'}; padding: 4px 10px;">
              ${p.enabled ? '已启用' : '已停用'}
            </button>
          </div>
        </div>
      `;
    }
    html += '</div>';
    modalContentEl.innerHTML = html;
  } catch(e) {
    modalContentEl.innerHTML = '<div style="color: #f87171; padding: 20px;">加载失败: ' + e.message + '</div>';
  }
}

// Helper: Custom Avatar Upload handler
window.handleAvatarUpload = (inputEl, targetInputId) => {
  const file = inputEl.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const dataUrl = e.target.result;
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl })
      });
      const data = await res.json();
      if (res.ok && data.url) {
        document.getElementById(targetInputId).value = data.url;
        showToast('图标上传成功，点击保存或按 Ctrl+S 生效');
      } else {
        alert(data.error || '上传失败');
      }
    } catch(err) {
      alert('上传发生错误: ' + err.message);
    }
  };
  reader.readAsDataURL(file);
};

// Global Ctrl+S listener to save settings or file manager if modal is open
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
    if (modalOverlayEl.style.display !== 'none') {
      const fmSaveBtn = document.getElementById('fmBtnSave');
      const saveBtn = document.getElementById('btnSaveSettings');
      if (fmSaveBtn) {
        e.preventDefault();
        fmSaveBtn.click();
      } else if (saveBtn) {
        e.preventDefault();
        saveBtn.click();
      }
    }
  }
});

// Helper to ensure thinking bubble exists for assistant
function ensureThinkingBubble() {
  let card = chatMessagesEl.querySelector('.message-card.assistant.streaming-card');
  if (!card) {
    const avatar = customization.agentAvatar || 'assets/CoreNyan.png';
    const name = customization.agentName || '小可';
    card = document.createElement('div');
    card.className = 'message-card assistant streaming-card';
    card.innerHTML = `
      <div class="card-header">
        <img src="${avatar}" class="card-avatar-sm" alt="Agent">
        <span>${escapeHtml(name)}</span>
        <span class="thinking-pulse" style="font-size: 11px;">Thinking...</span>
      </div>
      <div class="card-bubble" style="min-height: 24px;"><span class="streaming-cursor"></span></div>
      <div class="message-sub-bar" style="display: none;"></div>
    `;
    chatMessagesEl.appendChild(card);
    scrollToBottom();
  }
  return card;
}

// Multi-terminal Realtime Sync SSE Connection
function initSyncListener() {
  const evtSource = new EventSource('/api/sync/events');
  const myClientId = 'client_' + Math.random().toString(36).slice(2) + Date.now();
  window.__fcClientId = myClientId;

  evtSource.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.clientId === window.__fcClientId) {
        // Ignore events emitted by this same client tab to prevent double rendering
        return;
      }
      if (data.type === 'connected') {
        if (Array.isArray(data.activeTurns)) {
          window.__activeTurns = data.activeTurns;
          const activeForCur = data.activeTurns.find(t => t.sessionId === currentSessionId);
          if (activeForCur) {
            setTaskRunningState(true);
            ensureThinkingBubble();
          }
        }
        return;
      }
      if (data.type === 'turn_started') {
        if (data.sessionId === currentSessionId) {
          setTaskRunningState(true);
          appendMessageCard(data.userMessage);
          ensureThinkingBubble();
          scrollToBottom();
        }
      } else if (data.type === 'stream_event') {
        if (data.sessionId === currentSessionId) {
          const evt = data.event;
          if (evt.type === 'delta') {
            ensureThinkingBubble();
            let lastCard = chatMessagesEl.querySelector('.message-card.assistant:last-child');
            const bubble = lastCard?.querySelector('.card-bubble');
            if (bubble) {
              const curText = bubble.textContent || '';
              bubble.innerHTML = escapeHtml(curText + evt.content) + '<span class="streaming-cursor"></span>';
              scrollToBottom();
            }
          } else if (evt.type === 'tool_start') {
            ensureThinkingBubble();
            const toolCard = document.createElement('div');
            toolCard.className = 'tool-unified-card';
            toolCard.id = `tool_exec_${evt.callId}`;
            toolCard.innerHTML = `
              <div class="tool-unified-header">
                <div class="tool-header-main">
                  <span class="tool-name-badge">${escapeHtml(evt.name)}</span>
                  <span class="tool-purpose-text">${escapeHtml(evt.purpose)}</span>
                </div>
                <div class="tool-unified-right"><span class="tool-status-pill">执行中...</span><span class="tool-chevron">▼</span></div>
              </div>
              <div class="tool-unified-body"><div class="tool-code-box">${escapeHtml(JSON.stringify(evt.args, null, 2))}</div></div>
            `;
            chatMessagesEl.appendChild(toolCard);
            scrollToBottom();
          } else if (evt.type === 'tool_finish') {
            const existing = document.getElementById(`tool_exec_${evt.call_id}`);
            if (existing) {
              existing.className = `tool-unified-card ${evt.status === 'error' ? 'error' : 'success'} collapsed`;
              existing.querySelector('.tool-status-pill').textContent = evt.durationMs ? `${evt.durationMs}ms` : '完成';
            }
          }
        }
      } else if (data.type === 'turn_finished' || data.type === 'turn_interrupted') {
        if (data.sessionId === currentSessionId) {
          setTaskRunningState(false);
          selectSession(currentSessionId);
        }
        loadGroupsAndSessions();
      } else if (data.type === 'queue_dispatched') {
        if (data.sessionId === currentSessionId) {
          sendMessage();
        }
      } else if (data.type === 'message_updated' || data.type === 'message_deleted') {
        if (data.sessionId === currentSessionId) {
          selectSession(currentSessionId);
        }
      }
    } catch(err){}
  };

  evtSource.onerror = () => {
    // Reconnects automatically
  };
}

// Start Up Sequence
function initApp() {
  loadCustomization();
  loadProviders();
  loadGroupsAndSessions();
  initSyncListener();
}

// Ensure startup runs both after auth check and on direct DOMContentLoaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => checkAuthAndInit());
} else {
  checkAuthAndInit();
}
