export class ImageViewport {
  constructor(host, onChange) {
    this.host = host; this.onChange = onChange; this.scale = 1; this.x = 0; this.y = 0; this.mode = 'fit';
    host.addEventListener('wheel', event => {
      if (!this.image) return;
      event.preventDefault(); const box = host.getBoundingClientRect();
      this.zoom(this.scale * Math.exp(-event.deltaY * .0015), event.clientX - box.left, event.clientY - box.top);
    }, {passive: false});
    host.addEventListener('pointerdown', event => {
      if (!this.image || ![0, 1].includes(event.button)) return;
      event.preventDefault(); this.mode = 'manual'; this.drag = {id: event.pointerId, x: event.clientX - this.x, y: event.clientY - this.y};
      host.setPointerCapture(event.pointerId); host.classList.add('dragging');
    });
    host.addEventListener('pointermove', event => {
      if (this.drag?.id !== event.pointerId) return;
      this.x = event.clientX - this.drag.x; this.y = event.clientY - this.drag.y; this.draw();
    });
    const release = event => {if (this.drag?.id === event.pointerId) {this.drag = null; host.classList.remove('dragging'); if (host.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId);}};
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) host.addEventListener(name, release);
    host.addEventListener('dblclick', () => this.fit());
    new ResizeObserver(() => {if (this.mode === 'fit') this.fit();}).observe(host);
  }
  show(url) {
    if (url === this.url) return;
    this.url = url; const image = new Image(); this.image = image; this.mode = 'fit'; this.host.replaceChildren();
    image.alt = 'Asset texture preview'; image.draggable = false;
    image.onload = () => {if (this.image === image) {this.host.replaceChildren(image); this.fit();}};
    image.onerror = () => {if (this.image === image) this.host.textContent = 'Texture preview could not be loaded.';};
    image.src = url;
  }
  fit() {
    if (!this.image?.naturalWidth || !this.host.clientWidth || !this.host.clientHeight) return;
    this.mode = 'fit'; this.scale = Math.min((this.host.clientWidth - 24) / this.image.naturalWidth, (this.host.clientHeight - 24) / this.image.naturalHeight);
    this.x = (this.host.clientWidth - this.image.naturalWidth * this.scale) / 2;
    this.y = (this.host.clientHeight - this.image.naturalHeight * this.scale) / 2; this.draw();
  }
  zoom(value, x = this.host.clientWidth / 2, y = this.host.clientHeight / 2) {
    if (!this.image?.naturalWidth) return;
    const scale = Math.max(1 / 64, Math.min(32, value)), ratio = scale / this.scale;
    this.mode = 'manual'; this.x = x - (x - this.x) * ratio; this.y = y - (y - this.y) * ratio; this.scale = scale; this.draw();
  }
  draw() {
    if (!this.image) return;
    this.image.style.transform = `translate(${this.x}px, ${this.y}px) scale(${this.scale})`;
    this.host.classList.toggle('pixel-view', this.scale >= 1); this.onChange(this.scale);
  }
}
