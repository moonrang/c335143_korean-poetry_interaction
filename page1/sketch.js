window.onerror = function (msg, url, lineNo, columnNo, error) {
  console.error("Error:", msg, error);
  return false;
};

function createSoftBrush(r, g, b, aBase) {
  const size = 64;
  const cvs = document.createElement("canvas");
  cvs.width = size;
  cvs.height = size;
  const ctx = cvs.getContext("2d");
  const grd = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2
  );
  grd.addColorStop(0, `rgba(${r},${g},${b},${aBase})`);
  grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, size, size);
  return cvs;
}

function createRoughBrush(color, isDry) {
  const size = 128;
  const cvs = document.createElement("canvas");
  cvs.width = size;
  cvs.height = size;
  const ctx = cvs.getContext("2d");
  const cx = size / 2;
  const cy = size / 2;
  ctx.fillStyle = color;
  ctx.beginPath();

  for (let i = 0; i <= 24; i++) {
    const angle = (Math.PI * 2 * i) / 24;
    const r = size * 0.35 + (Math.random() - 0.5) * (size * 0.25);
    const px = cx + Math.cos(angle) * r;
    const py = cy + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.fill();

  ctx.globalCompositeOperation = "destination-out";
  const grains = isDry ? 1200 : 400;
  for (let i = 0; i < grains; i++) {
    const angle = Math.random() * Math.PI * 2;
    const r = Math.random() * size * 0.5;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    ctx.beginPath();
    ctx.arc(x, y, Math.random() * (isDry ? 4 : 2.5), 0, Math.PI * 2);
    ctx.fill();
  }
  return cvs;
}

window.addEventListener("load", () => {
  const Engine = Matter.Engine,
    Runner = Matter.Runner,
    World = Matter.World,
    Bodies = Matter.Bodies,
    Body = Matter.Body,
    Mouse = Matter.Mouse,
    MouseConstraint = Matter.MouseConstraint,
    Events = Matter.Events,
    Query = Matter.Query;

  const engine = Engine.create();
  const world = engine.world;
  engine.gravity.y = 1;

  const canvas = document.getElementById("ink-canvas");
  const ctx = canvas.getContext("2d");

  const softBlackBrush = createSoftBrush(0, 0, 0, 0.8);
  const softRedBrush = createSoftBrush(180, 40, 50, 0.6);
  const wetBlackBrush = createRoughBrush("rgba(10, 10, 10, 0.9)", false);
  const dryBlackBrush = createRoughBrush("rgba(20, 20, 20, 0.6)", true);
  const redPlumBrush = createRoughBrush("rgba(200, 40, 60, 0.7)", false);
  const palePlumBrush = createRoughBrush("rgba(220, 80, 90, 0.5)", false);
  const rippleBrush = createSoftBrush(160, 50, 60, 0.15);
  const rootBrush = createSoftBrush(10, 10, 10, 0.3);

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  window.addEventListener("resize", resize);
  resize();

  const poemContainer = document.getElementById("poem-container");
  let physicsBodies = [];
  let flowers = [];
  let ripples = [];
  let isPressing = false;
  let pressStartTime = 0;
  let pressPosition = { x: 0, y: 0 };
  const LONG_PRESS_DURATION = 1500;
  let hasTriggeredShockwave = false;

  class InkRipple {
    constructor(x, y) {
      this.x = x;
      this.y = y;
      this.age = 0;
      this.maxAge = 120;
      this.particles = [];
      const particleCount = 40;
      for (let i = 0; i < particleCount; i++) {
        const angle = (Math.PI * 2 * i) / particleCount;
        this.particles.push({
          angle: angle + (Math.random() - 0.5) * 0.2,
          currentDist: 10 + Math.random() * 10,
          speed: 2 + Math.random() * 1.5,
          size: 30 + Math.random() * 20,
          wobble: (Math.random() - 0.5) * 0.05,
        });
      }
    }
    update() {
      this.age++;
      this.particles.forEach((p) => {
        p.speed *= 0.96;
        p.currentDist += p.speed;
        p.angle += p.wobble;
        p.size += 0.3;
      });
    }
    draw(ctx) {
      const alpha = 1 - this.age / this.maxAge;
      if (alpha <= 0) return;
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.globalCompositeOperation = "multiply";
      ctx.globalAlpha = alpha;
      this.particles.forEach((p) => {
        const px = Math.cos(p.angle) * p.currentDist;
        const py = Math.sin(p.angle) * p.currentDist;
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(p.angle + this.age * 0.01);
        ctx.drawImage(rippleBrush, -p.size / 2, -p.size / 2, p.size, p.size);
        ctx.restore();
      });
      ctx.restore();
    }
  }

  const poemText = `흔들리며 피는 꽃
도종환

흔들리지 않고 피는 꽃이 어디 있으랴
이 세상 그 어떤 아름다운 꽃들도
다 흔들리면서 피었나니
흔들리면서 줄기를 곧게 세웠나니
흔들리지 않고 가는 사랑이 어디 있으랴

젖지 않고 피는 꽃이 어디 있으랴
이 세상 그 어떤 빛나는 꽃들도
다 젖으며 젖으며 피었나니
바람과 비에 젖으며 꽃잎 따뜻하게 피웠나니
젖지 않고 가는 삶이 어디 있으랴`;

  function initPoem() {
    const lines = poemText.split("\n");
    const charSize = 32;
    const lineHeight = 40;
    const totalH = lines.length * lineHeight;
    let startY = (window.innerHeight - totalH) / 2;

    let maxBodyLen = 0;
    for (let i = 2; i < lines.length; i++) {
      if (lines[i].length > maxBodyLen) maxBodyLen = lines[i].length;
    }
    const bodyBlockWidth = maxBodyLen * (charSize * 0.95);
    const bodyStartX = (window.innerWidth - bodyBlockWidth) / 2;

    lines.forEach((line, index) => {
      const chars = line.split("");
      let startX =
        index < 2
          ? (window.innerWidth - chars.length * (charSize * 0.95)) / 2
          : bodyStartX;

      chars.forEach((char, i) => {
        if (char.trim() !== "") {
          const div = document.createElement("div");
          div.className = "char-box";
          div.innerText = char;
          const x = startX + i * (charSize * 0.95);
          const y = startY;
          div.style.left = x + "px";
          div.style.top = y + "px";
          div.style.width = charSize + "px";
          div.style.height = charSize + "px";
          poemContainer.appendChild(div);

          const body = Bodies.rectangle(
            x + charSize / 2,
            y + charSize / 2,
            charSize,
            charSize,
            {
              isStatic: true,
              restitution: 0.5,
              frictionAir: 0.08,
              label: "char",
              density: 0.002,
            }
          );
          World.add(world, body);
          physicsBodies.push({
            body,
            element: div,
            initialX: x,
            initialY: y,
            w: charSize,
            h: charSize,
            isDragging: false,
          });
        }
      });
      startY += lineHeight;
    });
  }

  const ground = Bodies.rectangle(
    window.innerWidth / 2,
    window.innerHeight + 50,
    window.innerWidth * 2,
    200,
    { isStatic: true, label: "ground" }
  );
  World.add(world, ground);

  let mouse = Mouse.create(canvas);
  const mouseConstraint = MouseConstraint.create(engine, {
    mouse: mouse,
    constraint: { stiffness: 1, damping: 0.1, render: { visible: false } },
  });
  World.add(world, mouseConstraint);

  function startPress(e) {
    isPressing = true;
    hasTriggeredShockwave = false;
    pressStartTime = Date.now();
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    pressPosition = { x: cx, y: cy };
  }
  function checkMove(e) {
    if (!isPressing) return;
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    if (Math.hypot(cx - pressPosition.x, cy - pressPosition.y) > 20)
      isPressing = false;
  }
  window.addEventListener("mousedown", startPress);
  window.addEventListener("touchstart", startPress, { passive: false });
  window.addEventListener("mouseup", () => (isPressing = false));
  window.addEventListener("touchend", () => (isPressing = false));
  window.addEventListener("mousemove", checkMove);
  window.addEventListener("touchmove", checkMove);

  function triggerShockwave(ox, oy) {
    ripples.push(new InkRipple(ox, oy));
    physicsBodies.forEach((obj) => {
      const b = obj.body;
      if (b.isRemoved) return;
      if (b.isStatic) Body.setStatic(b, false);
      const dx = b.position.x - ox;
      const dy = b.position.y - oy;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = 0.05 * b.mass * Math.max(0.1, 1000 / dist);
      Body.applyForce(b, b.position, {
        x: (dx / dist) * force,
        y: (dy / dist) * force,
      });
    });
  }

  Events.on(mouseConstraint, "mousedown", (e) => {
    Query.point(
      physicsBodies.map((p) => p.body),
      e.mouse.position
    ).forEach((b) => {
      if (b.isStatic) Body.setStatic(b, false);
    });
  });
  Events.on(mouseConstraint, "startdrag", (e) => {
    const obj = physicsBodies.find((p) => p.body === e.body);
    if (obj) {
      obj.isDragging = true;
      isPressing = false;
    }
  });
  Events.on(mouseConstraint, "enddrag", (e) => {
    const obj = physicsBodies.find((p) => p.body === e.body);
    if (obj) obj.isDragging = false;
  });

  const runner = Runner.create();
  Runner.run(runner, engine);

  Events.on(engine, "collisionStart", (event) => {
    event.pairs.forEach((pair) => {
      const { bodyA, bodyB } = pair;
      if (
        (bodyA.label === "char" && bodyB.label === "ground") ||
        (bodyB.label === "char" && bodyA.label === "ground")
      ) {
        const tBody = bodyA.label === "char" ? bodyA : bodyB;
        if (!tBody.isRemoved) {
          tBody.isRemoved = true;
          const obj = physicsBodies.find((o) => o.body === tBody);
          if (obj) obj.element.style.display = "none";
          World.remove(world, tBody);

          if (Math.random() < 0.9)
            flowers.push(
              new SimpleSumiFlower(tBody.position.x, window.innerHeight)
            );
          else
            flowers.push(
              new ComplexSumiTree(tBody.position.x, window.innerHeight)
            );
        }
      }
    });
  });

  class SimpleSumiFlower {
    constructor(x, y) {
      this.x = x;
      this.y = y;
      this.age = 0;
      this.growPeriod = 60;
      this.finished = false;
      this.scale = 0.8 + Math.random() * 1.0;
      this.stemCurve = (Math.random() - 0.5) * 40;
      this.height = (60 + Math.random() * 40) * this.scale;
      this.petals = [];
      for (let i = 0; i < 5; i++) {
        this.petals.push({
          angle: ((Math.PI * 2) / 5) * i + Math.random() * 0.5,
          dist: (10 + Math.random() * 5) * this.scale,
          size: (15 + Math.random() * 10) * this.scale,
        });
      }
      this.cacheCanvas = null;
      this.cacheWidth = Math.ceil(800 * this.scale);
      this.cacheHeight = Math.ceil(this.height * 2 + 400 * this.scale);
      this.rootX = this.cacheWidth / 2;
      this.rootY = this.cacheHeight - 100 * this.scale;

      this.lifeTime = 300;
      this.fadeTime = 60;
      this.currentLife = 0;
      this.isDead = false;
    }

    draw(ctx) {
      if (this.age < this.growPeriod) {
        this.age++;
      } else if (!this.finished) {
        this.finished = true;
      } else {
        this.currentLife++;
        if (this.currentLife > this.lifeTime + this.fadeTime) {
          this.isDead = true;
          return;
        }
      }

      let alpha = 1.0;
      if (this.currentLife > this.lifeTime) {
        alpha = 1.0 - (this.currentLife - this.lifeTime) / this.fadeTime;
        if (alpha < 0) alpha = 0;
      }

      if (this.finished && this.cacheCanvas) {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.globalCompositeOperation = "multiply";
        ctx.drawImage(
          this.cacheCanvas,
          this.x - this.rootX,
          this.y - this.rootY
        );
        ctx.restore();
        return;
      }

      let targetCtx = ctx;
      let drawOriginX = this.x;
      let drawOriginY = this.y;

      if (this.finished) {
        this.cacheCanvas = document.createElement("canvas");
        this.cacheCanvas.width = this.cacheWidth;
        this.cacheCanvas.height = this.cacheHeight;
        targetCtx = this.cacheCanvas.getContext("2d");
        drawOriginX = this.rootX;
        drawOriginY = this.rootY;
      }

      const prog = this.age / this.growPeriod;
      const ease = 1 - Math.pow(1 - prog, 3);

      targetCtx.save();
      if (!this.finished) targetCtx.globalAlpha = alpha;
      targetCtx.translate(drawOriginX, drawOriginY);

      if (prog > 0.1) {
        targetCtx.save();
        targetCtx.globalAlpha = 0.3 * ease;
        targetCtx.drawImage(
          rootBrush,
          -20 * this.scale,
          -20 * this.scale,
          40 * this.scale,
          40 * this.scale
        );
        targetCtx.restore();
      }

      targetCtx.beginPath();
      targetCtx.moveTo(0, 0);
      targetCtx.quadraticCurveTo(
        this.stemCurve * ease,
        -this.height * 0.5 * ease,
        this.stemCurve * ease,
        -this.height * ease
      );
      targetCtx.strokeStyle = "rgba(40, 40, 40, 0.5)";
      targetCtx.lineWidth = 5 * this.scale;
      targetCtx.lineCap = "round";
      targetCtx.stroke();

      targetCtx.save();
      targetCtx.translate(this.stemCurve * ease, -this.height * ease);
      targetCtx.globalAlpha = 0.6 * ease * (this.finished ? 1 : alpha);
      targetCtx.drawImage(
        softBlackBrush,
        -15 * this.scale,
        -15 * this.scale,
        30 * this.scale,
        30 * this.scale
      );
      targetCtx.restore();

      if (prog > 0.3) {
        const bloom = (prog - 0.3) / 0.7;
        const bloomEase = 1 - Math.pow(1 - bloom, 3);

        targetCtx.save();
        targetCtx.translate(this.stemCurve * ease, -this.height * ease);
        targetCtx.globalCompositeOperation = "multiply";

        this.petals.forEach((p) => {
          targetCtx.save();
          const dist = p.dist * bloomEase;
          const x = Math.cos(p.angle) * dist;
          const y = Math.sin(p.angle) * dist;
          targetCtx.translate(x, y);
          const s = p.size * bloomEase;
          targetCtx.globalAlpha = 0.7 * bloomEase * (this.finished ? 1 : alpha);
          targetCtx.drawImage(softRedBrush, -s, -s, s * 2, s * 2);
          targetCtx.restore();
        });
        targetCtx.restore();
      }
      targetCtx.restore();

      if (this.finished && this.cacheCanvas) {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.globalCompositeOperation = "multiply";
        ctx.drawImage(
          this.cacheCanvas,
          this.x - this.rootX,
          this.y - this.rootY
        );
        ctx.restore();
      }
    }
  }

  class ComplexSumiTree {
    constructor(x, y) {
      this.x = x;
      this.y = y;
      this.scale = 0.5 + Math.random() * 0.4;
      this.canvas = document.createElement("canvas");
      this.ctx = this.canvas.getContext("2d");

      const size = 1800 * this.scale;
      this.canvas.width = size;
      this.canvas.height = size;

      this.offsetX = size / 2;
      this.offsetY = size * 0.85;

      this.isGrowing = true;
      this.activeBranches = [];
      this.startBranch(0, 0, -90, 22, 0);

      this.lifeTime = 300;
      this.fadeTime = 60;
      this.currentLife = 0;
      this.isDead = false;
    }

    startBranch(x, y, angle, width, depth) {
      const len = (70 + Math.random() * 80) * this.scale;
      const rad = (angle * Math.PI) / 180;
      const endX = x + Math.cos(rad) * len;
      const endY = y + Math.sin(rad) * len;
      const dist = Math.hypot(endX - x, endY - y);
      const totalSteps = Math.ceil(dist / 3);
      this.activeBranches.push({
        x,
        y,
        startX: x,
        startY: y,
        endX,
        endY,
        angle,
        width,
        depth,
        currentStep: 0,
        totalSteps: totalSteps,
      });
    }

    grow() {
      if (!this.isGrowing) return;
      const c = this.ctx;
      c.save();
      c.translate(this.offsetX, this.offsetY);

      if (
        this.activeBranches.length > 0 &&
        this.activeBranches[0].depth === 0 &&
        this.activeBranches[0].currentStep < 5
      ) {
        c.save();
        c.globalAlpha = 0.1;
        c.drawImage(
          rootBrush,
          -40 * this.scale,
          -20 * this.scale,
          80 * this.scale,
          40 * this.scale
        );
        c.restore();
      }

      for (let i = this.activeBranches.length - 1; i >= 0; i--) {
        const b = this.activeBranches[i];
        const t = b.currentStep / b.totalSteps;
        const currX = b.startX + (b.endX - b.startX) * t;
        const currY = b.startY + (b.endY - b.startY) * t;
        const currWidth = b.width * (1 - t * 0.2);

        c.save();
        c.translate(currX, currY);
        c.rotate(Math.random() * Math.PI * 2);
        const isDry = Math.random() > 0.7 || b.depth > 2;
        const brush = isDry ? dryBlackBrush : wetBlackBrush;
        const alpha = isDry ? 0.7 : 0.9;
        c.globalAlpha = alpha;
        c.globalCompositeOperation = "source-over";
        const scale = (currWidth / 40) * (Math.random() * 0.4 + 0.8);
        c.drawImage(brush, -64 * scale, -64 * scale, 128 * scale, 128 * scale);
        c.restore();

        b.currentStep++;
        if (b.currentStep >= b.totalSteps) {
          this.activeBranches.splice(i, 1);
          if (b.depth < 6 && b.width > 2) {
            const splitChance = 0.6 - b.depth * 0.05;
            const branchCount = Math.random() < splitChance ? 2 : 1;
            for (let k = 0; k < branchCount; k++) {
              const angleChange = (Math.random() - 0.5) * 80;
              this.startBranch(
                b.endX,
                b.endY,
                b.angle + angleChange,
                b.width * 0.8,
                b.depth + 1
              );
            }
            if (Math.random() < 0.4) this.drawFlowerCluster(c, b.endX, b.endY);
          } else {
            this.drawFlowerCluster(c, b.endX, b.endY);
          }
        }
      }
      c.restore();
      if (this.activeBranches.length === 0) this.isGrowing = false;
    }

    drawFlowerCluster(ctx, x, y) {
      const count = 3 + Math.floor(Math.random() * 4);
      for (let i = 0; i < count; i++) {
        ctx.save();
        const ox = x + (Math.random() - 0.5) * 30;
        const oy = y + (Math.random() - 0.5) * 30;
        ctx.translate(ox, oy);
        const size = 15 + Math.random() * 25;
        const scale = size / 64;
        const brush = Math.random() > 0.5 ? redPlumBrush : palePlumBrush;
        ctx.rotate(Math.random() * Math.PI * 2);
        ctx.globalCompositeOperation = "multiply";
        ctx.globalAlpha = 0.7;
        ctx.drawImage(
          brush,
          -64 * scale,
          -64 * scale,
          128 * scale,
          128 * scale
        );
        ctx.restore();
      }
    }

    draw(ctx) {
      this.grow();

      if (!this.isGrowing) {
        this.currentLife++;
        if (this.currentLife > this.lifeTime + this.fadeTime) {
          this.isDead = true;
          return;
        }
      }

      let alpha = 1.0;
      if (this.currentLife > this.lifeTime) {
        alpha = 1.0 - (this.currentLife - this.lifeTime) / this.fadeTime;
      }

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.globalCompositeOperation = "multiply";
      ctx.drawImage(this.canvas, this.x - this.offsetX, this.y - this.offsetY);
      ctx.restore();
    }
  }

  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (isPressing) {
      const now = Date.now();
      const prog = Math.min((now - pressStartTime) / LONG_PRESS_DURATION, 1);
      ctx.save();
      ctx.translate(pressPosition.x, pressPosition.y);
      ctx.globalCompositeOperation = "multiply";

      const size = 60 + prog * 80;
      ctx.globalAlpha = 0.1 + prog * 0.2;
      ctx.drawImage(softRedBrush, -size / 2, -size / 2, size, size);
      ctx.globalAlpha = 0.3 + prog * 0.4;
      const coreSize = 30;
      ctx.drawImage(
        softRedBrush,
        -coreSize / 2,
        -coreSize / 2,
        coreSize,
        coreSize
      );
      ctx.restore();

      if (prog >= 1 && !hasTriggeredShockwave) {
        triggerShockwave(pressPosition.x, pressPosition.y);
        hasTriggeredShockwave = true;
      }
    }

    physicsBodies.forEach((obj) => {
      if (!obj.body.isRemoved) {
        const { x, y } = obj.body.position;
        const angle = obj.body.angle;
        const tx = x - (obj.initialX + obj.w / 2);
        const ty = y - (obj.initialY + obj.h / 2);
        obj.element.style.transform = `translate(${tx}px, ${ty}px) rotate(${angle}rad) ${
          obj.isDragging ? "scale(1.2)" : ""
        }`;
      }
    });

    const time = Date.now();
    physicsBodies.forEach((obj) => {
      const b = obj.body;
      if (b.isStatic || b.isRemoved || obj.isDragging) return;
      Body.applyForce(b, b.position, {
        x: Math.sin(time * 0.002 + b.id) * 0.001,
        y: -0.0001,
      });
    });

    for (let i = ripples.length - 1; i >= 0; i--) {
      ripples[i].update();
      ripples[i].draw(ctx);
      if (ripples[i].age >= ripples[i].maxAge) ripples.splice(i, 1);
    }

    for (let i = flowers.length - 1; i >= 0; i--) {
      flowers[i].draw(ctx);
      if (flowers[i].isDead) {
        flowers.splice(i, 1);
      }
    }

    requestAnimationFrame(animate);
  }

  initPoem();
  animate();
  console.log("init done (Edges & Blending Fixed)");
});
