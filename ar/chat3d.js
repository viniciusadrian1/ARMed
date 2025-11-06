// ar/chat3d.js - Módulo independente do Chat 3D para AR
import * as THREE from 'three';

export class Chat3D {
  constructor(params) {
    this.scene = params.scene;
    this.renderer = params.renderer;
    this.raycaster = params.raycaster || new THREE.Raycaster();
    this.tempMatrix = params.tempMatrix || new THREE.Matrix4();

    this.chatPanel = null;
    this.chatIsVisible = false;
    this.chatMessages = [];
    this.chatToggleButton = null;
    this.chatSendButton = null;

    this.chatCanvas = null;
    this.chatContext = null;
  }

  get config() {
    return {
      panel: { width: 1.2, height: 1.6, depth: 0.05, position: { x: -1.5, y: 0.8, z: 0 } },
      text: { fontSize: 24, lineHeight: 30, padding: 20, maxLines: 20, maxChars: 100 },
      colors: { panel: 0x1e293b, border: 0x334155, text: 0xf1f5f9, userText: 0x10b981, botText: 0x64748b, button: 0x059669 }
    };
  }

  create() {
    if (this.chatPanel) return;
    const cfg = this.config;

    const chatGroup = new THREE.Group();
    chatGroup.name = 'ChatSystem';

    const panelGeometry = new THREE.BoxGeometry(cfg.panel.width, cfg.panel.height, cfg.panel.depth);
    const panelMaterial = new THREE.MeshLambertMaterial({ color: cfg.colors.panel, transparent: true, opacity: 0.95 });
    this.chatPanel = new THREE.Mesh(panelGeometry, panelMaterial);
    this.chatPanel.position.set(cfg.panel.position.x, cfg.panel.position.y, cfg.panel.position.z);

    const border = new THREE.LineSegments(new THREE.EdgesGeometry(panelGeometry), new THREE.LineBasicMaterial({ color: cfg.colors.border, linewidth: 2 }));
    this.chatPanel.add(border);

    this.#createCanvas();
    const chatTexture = new THREE.CanvasTexture(this.chatCanvas);
    chatTexture.needsUpdate = true;
    const textMaterial = new THREE.MeshBasicMaterial({ map: chatTexture, transparent: true, opacity: 1 });
    const textGeometry = new THREE.PlaneGeometry(cfg.panel.width - 0.1, cfg.panel.height - 0.2);
    const textMesh = new THREE.Mesh(textGeometry, textMaterial);
    textMesh.position.z = cfg.panel.depth / 2 + 0.001;
    this.chatPanel.add(textMesh);

    this.#createButtons(chatGroup);
    this.#createToggle(chatGroup);

    chatGroup.add(this.chatPanel);
    chatGroup.visible = false;
    this.scene.add(chatGroup);
  }

  addMessage(text, type = 'bot') {
    if (!text || typeof text !== 'string') return;
    const cfg = this.config;
    this.chatMessages.push({ text: text.trim(), type, timestamp: Date.now() });
    if (this.chatMessages.length > cfg.text.maxLines * 2) {
      this.chatMessages.splice(0, this.chatMessages.length - cfg.text.maxLines * 2);
    }
    this.#updateCanvas();
  }

  handleInteraction(controller) {
    if (!controller || !this.renderer.xr.isPresenting) return false;

    this.tempMatrix.identity().extractRotation(controller.matrixWorld);
    this.raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this.tempMatrix);

    const chatGroup = this.scene.getObjectByName('ChatSystem');
    if (!chatGroup) return false;

    const intersects = this.raycaster.intersectObjects(chatGroup.children, true);
    if (intersects.length === 0) return false;

    const parent = intersects[0].object.parent;
    if (parent && parent.name === 'ChatToggleButton') {
      this.toggle();
      const gp = controller.gamepad;
      if (gp?.hapticActuators?.length) gp.hapticActuators[0].pulse(0.5, 100);
      return true;
    }
    if (parent && parent.name === 'ChatSendButton' && this.chatIsVisible) {
      this.startVoiceRecording();
      const gp = controller.gamepad;
      if (gp?.hapticActuators?.length) gp.hapticActuators[0].pulse(0.7, 150);
      return true;
    }
    return false;
  }

  toggle() {
    if (!this.chatPanel) return;
    const chatGroup = this.scene.getObjectByName('ChatSystem');
    if (!chatGroup) return;
    this.chatIsVisible = !this.chatIsVisible;
    this.chatPanel.visible = this.chatIsVisible;
    if (this.chatIsVisible) {
      this.chatPanel.scale.set(0.01, 0.01, 0.01);
      const target = new THREE.Vector3(1, 1, 1);
      this.#animateScale(this.chatPanel, target, 300);
    }
  }

  async startVoiceRecording() {
    if (this._recording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this._mediaRecorder = new MediaRecorder(stream);
      this._chunks = [];
      this.addMessage('🎤 Gravando...', 'user');
      this._mediaRecorder.ondataavailable = (e) => { this._chunks.push(e.data); };
      this._mediaRecorder.onstop = async () => {
        const blob = new Blob(this._chunks, { type: 'audio/webm' });
        await this.#sendVoice(blob);
        try { stream.getTracks().forEach(t => t.stop()); } catch(_){}
      };
      this._mediaRecorder.start();
      this._recording = true;
      setTimeout(() => { if (this._recording) this.stopVoiceRecording(); }, 10000);
    } catch(err) {
      console.error('Mic error', err);
      this.addMessage('Erro: Não foi possível acessar o microfone', 'bot');
    }
  }

  stopVoiceRecording() {
    if (!this._recording || !this._mediaRecorder) return;
    this._recording = false;
    this._mediaRecorder.stop();
    this.addMessage('⏹️ Processando...', 'user');
  }

  // ======== privados ========
  #createCanvas() {
    this.chatCanvas = document.createElement('canvas');
    this.chatCanvas.width = 512;
    this.chatCanvas.height = 683;
    this.chatContext = this.chatCanvas.getContext('2d');
    this.chatContext.font = `${this.config.text.fontSize}px Arial, sans-serif`;
    this.chatContext.textAlign = 'left';
    this.chatContext.textBaseline = 'top';
    this.#updateCanvas();
  }

  #updateCanvas() {
    const ctx = this.chatContext;
    const cfg = this.config;
    if (!ctx) return;
    ctx.clearRect(0, 0, this.chatCanvas.width, this.chatCanvas.height);
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, 0, this.chatCanvas.width, this.chatCanvas.height);
    ctx.fillStyle = '#334155';
    ctx.fillRect(0, 0, this.chatCanvas.width, 60);
    ctx.fillStyle = '#f1f5f9';
    ctx.font = 'bold 28px Arial';
    ctx.fillText('Assistente Pulmonar', 20, 20);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '18px Arial';
    ctx.fillText('Especializado em pulmão', 20, 45);
    const messageAreaY = 80;
    const messageAreaHeight = this.chatCanvas.height - 140;
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(10, messageAreaY, this.chatCanvas.width - 20, messageAreaHeight);
    let y = messageAreaY + 10;
    const maxWidth = this.chatCanvas.width - 40;
    for (let i = Math.max(0, this.chatMessages.length - cfg.text.maxLines); i < this.chatMessages.length; i++) {
      const m = this.chatMessages[i];
      if (!m) continue;
      const isUser = m.type === 'user';
      ctx.fillStyle = isUser ? '#10b981' : '#f1f5f9';
      ctx.font = `${isUser ? 'bold ' : ''}20px Arial`;
      const words = m.text.split(' ');
      let line = '';
      for (let n = 0; n < words.length; n++) {
        const testLine = line + words[n] + ' ';
        const testWidth = ctx.measureText(testLine).width;
        if (testWidth > maxWidth && n > 0) { ctx.fillText(line, 20, y); line = words[n] + ' '; y += cfg.text.lineHeight; }
        else { line = testLine; }
      }
      ctx.fillText(line, 20, y);
      y += cfg.text.lineHeight + 5;
      if (y > messageAreaY + messageAreaHeight - 30) break;
    }
    const inputY = this.chatCanvas.height - 50;
    ctx.fillStyle = '#334155';
    ctx.fillRect(10, inputY, this.chatCanvas.width - 20, 40);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '16px Arial';
    ctx.fillText('Use controles VR ou voz para interagir', 20, inputY + 15);
    if (this.chatPanel) {
      const textMesh = this.chatPanel.children.find(c => c.material && c.material.map);
      if (textMesh?.material?.map) textMesh.material.map.needsUpdate = true;
    }
  }

  #createButtons(chatGroup) {
    const cfg = this.config;
    const sendButtonGeometry = new THREE.BoxGeometry(0.15, 0.08, 0.03);
    const sendButtonMaterial = new THREE.MeshLambertMaterial({ color: cfg.colors.button });
    this.chatSendButton = new THREE.Mesh(sendButtonGeometry, sendButtonMaterial);
    this.chatSendButton.position.set(cfg.panel.position.x + 0.4, cfg.panel.position.y - 0.7, cfg.panel.position.z + 0.1);
    this.chatSendButton.name = 'ChatSendButton';
    const sendLabelCanvas = document.createElement('canvas');
    sendLabelCanvas.width = 128; sendLabelCanvas.height = 64;
    const sendCtx = sendLabelCanvas.getContext('2d');
    sendCtx.fillStyle = '#ffffff'; sendCtx.font = 'bold 24px Arial'; sendCtx.textAlign = 'center';
    sendCtx.fillText('🎤', 64, 35);
    const sendLabelTexture = new THREE.CanvasTexture(sendLabelCanvas);
    const sendLabelMaterial = new THREE.MeshBasicMaterial({ map: sendLabelTexture, transparent: true });
    const sendLabelGeometry = new THREE.PlaneGeometry(0.12, 0.06);
    const sendLabel = new THREE.Mesh(sendLabelGeometry, sendLabelMaterial);
    sendLabel.position.z = 0.02;
    this.chatSendButton.add(sendLabel);
    chatGroup.add(this.chatSendButton);
  }

  #createToggle(chatGroup) {
    const cfg = this.config;
    const toggleButtonGeometry = new THREE.SphereGeometry(0.05, 16, 8);
    const toggleButtonMaterial = new THREE.MeshLambertMaterial({ color: cfg.colors.button });
    this.chatToggleButton = new THREE.Mesh(toggleButtonGeometry, toggleButtonMaterial);
    this.chatToggleButton.position.set(cfg.panel.position.x + 0.8, cfg.panel.position.y + 0.6, cfg.panel.position.z);
    this.chatToggleButton.name = 'ChatToggleButton';
    const iconCanvas = document.createElement('canvas'); iconCanvas.width = 64; iconCanvas.height = 64;
    const ic = iconCanvas.getContext('2d'); ic.fillStyle = '#ffffff'; ic.font = 'bold 32px Arial'; ic.textAlign = 'center';
    ic.fillText('💬', 32, 40);
    const iconTex = new THREE.CanvasTexture(iconCanvas);
    const iconMat = new THREE.MeshBasicMaterial({ map: iconTex, transparent: true });
    const iconGeo = new THREE.PlaneGeometry(0.08, 0.08);
    const icon = new THREE.Mesh(iconGeo, iconMat); icon.position.z = 0.02;
    this.chatToggleButton.add(icon);
    chatGroup.add(this.chatToggleButton);
  }

  #animateScale(object, targetScale, duration) {
    const startScale = object.scale.clone();
    const startTime = Date.now();
    const step = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      object.scale.lerpVectors(startScale, targetScale, eased);
      if (progress < 1) requestAnimationFrame(step);
    };
    step();
  }

  async #sendVoice(audioBlob) {
    try {
      const fd = new FormData();
      fd.append('file', audioBlob, 'recording.webm');
      const r = await fetch('/api/voice/chat', { method: 'POST', body: fd });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (j.transcript) this.addMessage(j.transcript, 'user');
      if (j.reply) this.addMessage(j.reply, 'bot');
      if (j.audio_base64) this.#playAudio(j.audio_base64);
    } catch(err) {
      console.error('voice error', err);
      this.addMessage('Erro ao processar áudio. Tente novamente.', 'bot');
    }
  }

  #playAudio(audioBase64) {
    try {
      const blob = this.#b64ToBlob(audioBase64, 'audio/mpeg');
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.play().catch(() => {});
      audio.onended = () => URL.revokeObjectURL(url);
    } catch(_){}
  }

  #b64ToBlob(b64, type) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type });
  }
}

export default Chat3D;

