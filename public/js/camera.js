// The weigh-in booth on the home page: a webcam snapshot (or an uploaded image)
// cropped to a small square JPEG, small enough to broadcast to the room.

const SIZE = 192;
const QUALITY = 0.72;
const KEY = 'arena-photo';

export function savedPhoto() {
  try { return localStorage.getItem(KEY) || null; } catch { return null; }
}

function savePhoto(photo) {
  try { localStorage.setItem(KEY, photo); } catch {}
}

// Draws the centre square of a video or image onto a SIZE x SIZE canvas.
function toSquare(source, w, h, mirror) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  const side = Math.min(w, h);
  if (mirror) {
    ctx.translate(SIZE, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(source, (w - side) / 2, (h - side) / 2, side, side, 0, 0, SIZE, SIZE);
  return canvas.toDataURL('image/jpeg', QUALITY);
}

export class Booth {
  constructor(root, onChange) {
    this.root = root;
    this.onChange = onChange;
    this.video = root.querySelector('video');
    this.img = root.querySelector('.booth-photo');
    this.status = root.querySelector('.booth-status');
    this.btnCam = root.querySelector('[data-cam]');
    this.btnSnap = root.querySelector('[data-snap]');
    this.file = root.querySelector('input[type=file]');
    this.stream = null;
    this.photo = savedPhoto();

    this.btnCam.onclick = () => this.start();
    this.btnSnap.onclick = () => this.snap();
    this.file.onchange = () => this.upload(this.file.files[0]);
    this._render();
  }

  async start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      this._say('No camera here. Upload a photo instead.');
      return;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 480, height: 480 }, audio: false });
    } catch {
      this._say('Camera blocked. Allow it, or upload a photo instead.');
      return;
    }
    this.video.srcObject = this.stream;
    await this.video.play().catch(() => {});
    this._say('');
    this._render();
  }

  stop() {
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }

  snap() {
    if (!this.stream || !this.video.videoWidth) return;
    this.root.classList.remove('flash');
    void this.root.offsetWidth;
    this.root.classList.add('flash');
    this._set(toSquare(this.video, this.video.videoWidth, this.video.videoHeight, true));
    this.stop();
  }

  upload(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      this._set(toSquare(img, img.naturalWidth, img.naturalHeight, false));
      URL.revokeObjectURL(url);
      this.stop();
    };
    img.onerror = () => this._say("Couldn't read that image.");
    img.src = url;
    this.file.value = '';
  }

  _set(photo) {
    this.photo = photo;
    savePhoto(photo);
    this._render();
    this.onChange?.(photo);
  }

  _say(msg) {
    this.status.textContent = msg;
  }

  _render() {
    const live = !!this.stream;
    this.root.classList.toggle('live', live);
    this.root.classList.toggle('has-photo', !!this.photo && !live);
    if (this.photo) this.img.src = this.photo;
    this.btnCam.textContent = this.photo ? 'Retake' : 'Turn on camera';
    this.btnCam.classList.toggle('hidden', live);
    this.btnSnap.classList.toggle('hidden', !live);
  }
}
