(function () {
  'use strict';

  var CHAT_ENDPOINT = '/api/chat';
  var CAPTURE_ENDPOINT = '/api/chat-lead-capture';
  var GREETING = "Hey there. I'm the Synex AI Labs assistant. Ask me about our services, or tell me what you're looking to automate.";

  var conversationHistory = [];
  var isOpen = false;
  var leadCaptured = false;
  var isLoading = false;
  var greetingShown = false;

  /* ── DOM CREATION ─────────────────────────────────────────────── */

  function buildWidget() {
    var w = document.createElement('div');
    w.className = 'chat-widget';
    w.id = 'synex-chat-widget';
    w.innerHTML =
      '<div class="chat-window" id="synex-chat-window">' +
        '<div class="chat-header">' +
          '<div class="chat-header-left">' +
            '<span class="chat-header-name">Synex AI</span>' +
            '<div class="chat-header-status">' +
              '<div class="chat-online-dot"></div>' +
              '<span>Online</span>' +
            '</div>' +
          '</div>' +
          '<button class="chat-close-btn" id="synex-chat-close" aria-label="Close chat">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">' +
              '<path d="M18 6L6 18"/><path d="M6 6l12 12"/>' +
            '</svg>' +
          '</button>' +
        '</div>' +
        '<div class="chat-messages" id="synex-chat-messages"></div>' +
        '<div class="chat-input-area">' +
          '<textarea class="chat-input" id="synex-chat-input" placeholder="Type a message..." rows="1" aria-label="Chat message"></textarea>' +
          '<button class="chat-send-btn" id="synex-chat-send" aria-label="Send">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
              '<line x1="22" y1="2" x2="11" y2="13"/>' +
              '<polygon points="22 2 15 22 11 13 2 9 22 2"/>' +
            '</svg>' +
          '</button>' +
        '</div>' +
      '</div>' +
      '<div class="chat-tooltip" id="synex-chat-tooltip">Got any questions? Let\'s talk...</div>' +
      '<button class="chat-bubble" id="synex-chat-bubble" aria-label="Open chat" aria-expanded="false">' +
        '<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">' +
          '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>' +
        '</svg>' +
      '</button>';
    return w;
  }

  /* ── MESSAGES ─────────────────────────────────────────────────── */

  function addMessage(role, text) {
    var el = document.getElementById('synex-chat-messages');
    if (!el) return;
    var div = document.createElement('div');
    div.className = 'chat-msg ' + role;
    div.textContent = text;
    el.appendChild(div);
    el.scrollTop = el.scrollHeight;
  }

  function showTyping() {
    var el = document.getElementById('synex-chat-messages');
    if (!el) return null;
    var div = document.createElement('div');
    div.className = 'chat-msg bot chat-typing';
    div.innerHTML = '<span></span><span></span><span></span>';
    el.appendChild(div);
    el.scrollTop = el.scrollHeight;
    return div;
  }

  /* ── OPEN / CLOSE ─────────────────────────────────────────────── */

  function openChat() {
    isOpen = true;
    var win = document.getElementById('synex-chat-window');
    var tip = document.getElementById('synex-chat-tooltip');
    var btn = document.getElementById('synex-chat-bubble');
    if (win) win.classList.add('open');
    if (tip) tip.classList.remove('visible');
    if (btn) btn.setAttribute('aria-expanded', 'true');

    if (!greetingShown) {
      greetingShown = true;
      setTimeout(function () {
        addMessage('bot', GREETING);
      }, 120);
    }

    setTimeout(function () {
      var inp = document.getElementById('synex-chat-input');
      if (inp) inp.focus();
    }, 300);
  }

  function closeChat() {
    isOpen = false;
    var win = document.getElementById('synex-chat-window');
    var btn = document.getElementById('synex-chat-bubble');
    if (win) win.classList.remove('open');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }

  function toggleChat() {
    if (isOpen) { closeChat(); } else { openChat(); }
  }

  /* ── SEND ─────────────────────────────────────────────────────── */

  function handleSend() {
    var inputEl = document.getElementById('synex-chat-input');
    var sendBtn = document.getElementById('synex-chat-send');
    if (!inputEl || !sendBtn) return;

    var text = inputEl.value.trim();
    if (!text || isLoading) return;

    inputEl.value = '';
    inputEl.style.height = 'auto';

    addMessage('user', text);
    conversationHistory.push({ role: 'user', content: text });

    isLoading = true;
    sendBtn.disabled = true;
    var typingEl = showTyping();

    fetch(CHAT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: conversationHistory }),
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (typingEl) typingEl.remove();

        var msg = data.message || 'Sorry, something went wrong. Please try again.';
        addMessage('bot', msg);
        conversationHistory.push({ role: 'assistant', content: msg });

        if (data.leadCapture && !leadCaptured) {
          leadCaptured = true;
          fetch(CAPTURE_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data.leadCapture),
          }).catch(function () {});
        }
      })
      .catch(function () {
        if (typingEl) typingEl.remove();
        addMessage('bot', 'Something went wrong. Please try again in a moment.');
      })
      .finally(function () {
        isLoading = false;
        sendBtn.disabled = false;
        var inp = document.getElementById('synex-chat-input');
        if (inp) inp.focus();
      });
  }

  /* ── INIT ─────────────────────────────────────────────────────── */

  function init() {
    if (document.getElementById('synex-chat-widget')) return; /* guard double-init */

    var widget = buildWidget();
    document.body.appendChild(widget);

    /* Show bubble after 3 s, tooltip 400 ms later */
    setTimeout(function () {
      var bubble = document.getElementById('synex-chat-bubble');
      if (bubble) bubble.classList.add('visible');
      setTimeout(function () {
        var tip = document.getElementById('synex-chat-tooltip');
        if (tip) tip.classList.add('visible');
      }, 400);
    }, 3000);

    /* Bubble toggle */
    document.getElementById('synex-chat-bubble').addEventListener('click', toggleChat);

    /* Close button */
    document.getElementById('synex-chat-close').addEventListener('click', closeChat);

    /* Input — Enter sends, Shift+Enter newline */
    var inputEl = document.getElementById('synex-chat-input');
    inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    });

    /* Auto-resize textarea */
    inputEl.addEventListener('input', function () {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 100) + 'px';
    });

    /* Send button */
    document.getElementById('synex-chat-send').addEventListener('click', handleSend);

    /* Dismiss tooltip on any click inside window */
    document.getElementById('synex-chat-window').addEventListener('click', function () {
      var tip = document.getElementById('synex-chat-tooltip');
      if (tip) tip.classList.remove('visible');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
