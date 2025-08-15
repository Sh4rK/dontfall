// Touch joystick + dash button for mobile (pointer: coarse)

export class TouchControls {
  constructor(input) {
    this.input = input;
    this.active = false;
    this.radius = 60; // px knob travel radius
    this.center = { x: 0, y: 0 };
    this.moveVec = { x: 0, y: 0 };

    this.root = document.getElementById('touchControls');
    this.joyArea = document.getElementById('joyArea');
    this.joyKnob = document.getElementById('joyKnob');
    this.dashBtn = document.getElementById('dashBtn');

    this._onJoyDown = (e) => {
      e.preventDefault();
      this.active = true;
      this._recalcCenter();
      this.joyArea.setPointerCapture?.(e.pointerId);
      this._onJoyMove(e);
    };
    this._onJoyMove = (e) => {
      if (!this.active) return;
      const { x, y } = this._eventXY(e);
      const dx = x - this.center.x;
      const dy = y - this.center.y;
      const m = Math.hypot(dx, dy);
      const clamped = m > this.radius ? this.radius : m;

      // Snap angle to 8 directions (cardinal + 45°)
      const step = Math.PI / 4; // 45 degrees
      let sx = 0, sy = 0, nx = 0, ny = 0;
      if (m > 1e-6) {
        const ang = Math.atan2(dy, dx);
        const snapped = Math.round(ang / step) * step;
        const ux = Math.cos(snapped);
        const uy = Math.sin(snapped);
        // Visual offset in px
        sx = ux * clamped;
        sy = uy * clamped;
        // Normalized move vector -1..1
        nx = sx / this.radius;
        ny = sy / this.radius;
      }

      // Visual knob (snapped)
      this.joyKnob.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -50%)`;

      this.moveVec = { x: nx, y: ny };
      this.input.setTouchMove(this.moveVec);
    };
    this._onJoyUp = (e) => {
      e.preventDefault();
      this.active = false;
      this.joyKnob.style.transform = 'translate(-50%, -50%)';
      this.moveVec = { x: 0, y: 0 };
      this.input.setTouchMove(this.moveVec);
    };

    this._onDash = (e) => {
      e.preventDefault();
      this.input.triggerDash();
    };

    // Show only on coarse pointers (mobile/tablet)
    const show = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    this.root.style.display = show ? 'block' : 'none';
    this.input.setTouchEnabled(show);

    if (show) {
      // Pointer events
      this.joyArea.addEventListener('pointerdown', this._onJoyDown, { passive: false });
      this.joyArea.addEventListener('pointermove', this._onJoyMove, { passive: false });
      this.joyArea.addEventListener('pointerup', this._onJoyUp, { passive: false });
      this.joyArea.addEventListener('pointercancel', this._onJoyUp, { passive: false });
      this.joyArea.addEventListener('lostpointercapture', this._onJoyUp);

      this.dashBtn.addEventListener('pointerdown', this._onDash, { passive: false });

      // Recompute center on resize/orientation
      window.addEventListener('resize', () => this._recalcCenter());
      setTimeout(() => this._recalcCenter(), 0);
    }
  }

  _recalcCenter() {
    const rect = this.joyArea.getBoundingClientRect();
    this.center.x = rect.left + rect.width / 2;
    this.center.y = rect.top + rect.height / 2;
  }

  _eventXY(e) {
    return { x: e.clientX, y: e.clientY };
  }

  destroy() {
    try {
      this.joyArea.removeEventListener('pointerdown', this._onJoyDown);
      this.joyArea.removeEventListener('pointermove', this._onJoyMove);
      this.joyArea.removeEventListener('pointerup', this._onJoyUp);
      this.joyArea.removeEventListener('pointercancel', this._onJoyUp);
      this.dashBtn.removeEventListener('pointerdown', this._onDash);
    } catch {}
  }
}