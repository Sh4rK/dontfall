// Minimal UI utilities: join modal, lobby list, countdown, cooldown, status, leaderboard

import { PASTEL_PALETTE, clamp01 } from './constants.js';

export class UI {
  constructor() {
    // Root elements
    this.statusText = document.getElementById('statusText');
    this.readyBtn = document.getElementById('readyBtn');
    this.playerList = document.getElementById('playerList');
    this.lobbyPanel = document.getElementById('lobbyPanel');

    this.countdownEl = document.getElementById('countdown');

    this.cooldownBar = document.getElementById('cooldownBar');
    this.cooldownFill = document.getElementById('cooldownFill');

    // Join modal
    this.joinModal = document.getElementById('joinModal');
    this.nameInput = document.getElementById('nameInput');
    this.colorRow = document.getElementById('colorRow');
    this.joinBtn = document.getElementById('joinBtn');

    // Leaderboard modal
    this.leaderboardModal = document.getElementById('leaderboardModal');
    this.leaderboardBody = document.getElementById('leaderboardBody');
    this.leaderboardClose = document.getElementById('leaderboardClose');

    this._ready = false;
    this._onReadyToggle = null;

    this._selectedColor = null;
    this._onJoin = null;

    // Ready button
    this.readyBtn.addEventListener('click', () => {
      if (!this._onReadyToggle) return;
      this._ready = !this._ready;
      this._applyReadyVisual();
      this._onReadyToggle(this._ready);
    });

    // Leaderboard close
    this.leaderboardClose.addEventListener('click', () => {
      this.hideLeaderboard();
    });
  }

  // ----- Status / HUD -----

  setStatus({ roomId = '-', ping = null, fps = null } = {}) {
    const pingStr = ping == null ? '-' : `${ping}ms`;
    const fpsStr = fps == null ? '-' : `${fps}`;
    this.statusText.textContent = `Room: ${roomId}, Ping: ${pingStr}, FPS: ${fpsStr}`;
  }

  setReadyHandler(fn) {
    this._onReadyToggle = fn;
  }

  setReadyState(ready) {
    this._ready = !!ready;
    this._applyReadyVisual();
  }

  _applyReadyVisual() {
    this.readyBtn.classList.toggle('ready', this._ready);
    this.readyBtn.textContent = this._ready ? 'Ready ✓' : 'Ready';
  }

  setCountdownVisible(visible) {
    this.countdownEl.style.display = visible ? 'flex' : 'none';
  }

  setCountdownText(txt) {
    this.countdownEl.textContent = txt;
  }

  setCooldownProgress(frac) {
    const f = clamp01(frac);
    this.cooldownFill.style.width = `${Math.round(f * 100)}%`;
  }

  // ----- Lobby -----

  renderLobby(players, selfId) {
    this.playerList.innerHTML = '';
    for (const p of players) {
      const li = document.createElement('li');
      const dot = document.createElement('div');
      dot.className = 'dot';
      if (p.color) dot.style.background = p.color;
      li.appendChild(dot);

      const name = document.createElement('div');
      name.textContent = p.name;
      li.appendChild(name);

      if (p.ready) {
        const ready = document.createElement('div');
        ready.className = 'readyTag';
        ready.textContent = 'READY';
        li.appendChild(ready);
      }

      if (p.id === selfId) {
        const you = document.createElement('div');
        you.className = 'you';
        you.textContent = '(you)';
        li.appendChild(you);
      }

      this.playerList.appendChild(li);
    }
  }

  // ----- Join Modal -----

  showJoinModal(palette = PASTEL_PALETTE) {
    this.joinModal.style.display = 'flex';
    this.colorRow.innerHTML = '';
    const first = palette[0] || '#A8D8FF';
    this._selectedColor = first;

    for (const col of palette) {
      const sw = document.createElement('div');
      sw.className = 'color';
      sw.style.background = col;
      if (col === this._selectedColor) sw.classList.add('selected');
      sw.addEventListener('click', () => {
        this._selectedColor = col;
        for (const c of this.colorRow.children) c.classList.remove('selected');
        sw.classList.add('selected');
      });
      this.colorRow.appendChild(sw);
    }

    this.joinBtn.onclick = () => {
      const name = (this.nameInput.value || '').trim();
      if (!name) {
        this.nameInput.focus();
        return;
      }
      if (this._onJoin) this._onJoin({ name, color: this._selectedColor });
    };
  }

  hideJoinModal() {
    this.joinModal.style.display = 'none';
  }

  onJoin(handler) {
    this._onJoin = handler;
  }

  // ----- Leaderboard -----

  showLeaderboard(entries, youWon = false) {
    this.leaderboardBody.innerHTML = '';
    for (const e of entries) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(e.name)}</td>
        <td>${e.wins}</td>
        <td>${e.games}</td>
        <td>${e.avgPlace.toFixed(2)}</td>
      `;
      this.leaderboardBody.appendChild(tr);
    }
    // Banner text
    const card = this.leaderboardModal.querySelector('.card');
    let banner = card.querySelector('#winBanner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'winBanner';
      card.insertBefore(banner, card.firstChild);
    }
    banner.textContent = youWon ? 'YOU WON!' : 'Round Over';
    banner.style.cssText = 'margin-bottom:8px;font-weight:800;font-size:18px;color:#e74c3c;text-align:center;';
    this.leaderboardModal.style.display = 'flex';
  }

  hideLeaderboard() {
    this.leaderboardModal.style.display = 'none';
  }
}

// Simple HTML escape
function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&')
    .replaceAll('<', '<')
    .replaceAll('>', '>')
    .replaceAll('"', '"')
    .replaceAll("'", '&#039;');
}