export class WordOverlay {
  constructor(element) {
    this.element = element;
    this.animation = null;
    this.signature = null;
    this.clear();
  }
  show(text, phase, signature = null) {
    if (signature !== null && signature === this.signature) return;
    this.signature = signature;
    if (this.animation) {
      this.animation.onfinish = null;
      this.animation.cancel();
      this.animation = null;
    }
    this.element.textContent = text;
    this.element.title = text;
    this.element.dataset.phase = phase;
  }
  clear() {
    this.show("", "idle");
  }
  insert(word) {
    this.show(word, "fading");
    const animation = this.element.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: 2000,
      fill: "forwards",
    });
    this.animation = animation;
    animation.onfinish = () => {
      if (this.animation === animation) this.clear();
    };
  }
}
