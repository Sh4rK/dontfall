// Keyboard input handling (arrows for movement, space for dash)

export class Input {
  constructor() {
    this._keys = new Set();
    this._dashEdge = false;

    this._onKeyDown = (e) => {
      const k = e.key;
      if (k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight' || k === ' ') {
        e.preventDefault();
      }
      if (k === ' ') {
        // edge trigger
        if (!this._keys.has('Space')) this._dashEdge = true;
        this._keys.add('Space');
      } else {
        this._keys.add(k);
      }
    };

    this._onKeyUp = (e) => {
      const k = e.key;
      if (k === ' ') {
        this._keys.delete('Space');
      } else {
        this._keys.delete(k);
      }
    };

    window.addEventListener('keydown', this._onKeyDown, { passive: false });
    window.addEventListener('keyup', this._onKeyUp, { passive: false });
  }

  getMoveVec() {
    const left = this._keys.has('ArrowLeft');
    const right = this._keys.has('ArrowRight');
    const up = this._keys.has('ArrowUp');
    const down = this._keys.has('ArrowDown');

    let x = (right ? 1 : 0) + (left ? -1 : 0);
    let y = (up ? -1 : 0) + (down ? 1 : 0);

    // normalize to length <= 1 to avoid faster diagonals
    const m = Math.hypot(x, y);
    if (m > 1e-6 && m > 1) {
      x /= m;
      y /= m;
    }
    return { x, y };
  }

  consumeDash() {
    if (this._dashEdge) {
      this._dashEdge = false;
      return true;
    }
    return false;
  }

  destroy() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
  }
}