/* Premium 3D hero — progressive enhancement.
   Falls back silently to the static <img id="heroImg"> if WebGL / CDN / device
   is not capable, or if the user prefers reduced motion.
   To swap the procedural cup for a real model later: replace buildCup() with a
   GLTFLoader load of a .glb (see comment in buildCup). */
(() => {
  const canvas = document.getElementById('hero3d');
  const heroImg = document.getElementById('heroImg');
  if (!canvas) return;

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const smallOrWeak = innerWidth < 720 || (navigator.deviceMemory && navigator.deviceMemory < 4)
                      || (navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4);

  function hasWebGL() {
    try { const c = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')));
    } catch (e) { return false; }
  }
  // Keep the fast static image on mobile/weak/reduced-motion. 3D only enhances capable desktops.
  if (reduce || smallOrWeak || !hasWebGL()) return;

  import('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js')
    .then(init)
    .catch(() => { /* CDN blocked -> static image stays */ });

  function init(THREE) {
    const wrap = canvas.parentElement;
    const W = () => wrap.clientWidth, H = () => wrap.clientHeight;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(W(), H(), false);

    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(34, W() / H(), 0.1, 100);
    cam.position.set(0, 0.2, 6.4);

    // Lighting — warm key + cream fill + clay rim (brand)
    scene.add(new THREE.HemisphereLight(0xffffff, 0xb8a98c, 0.75));
    const key = new THREE.DirectionalLight(0xffffff, 1.15); key.position.set(3, 5, 4); scene.add(key);
    const rim = new THREE.DirectionalLight(0xC0664A, 0.55); rim.position.set(-4, 2, -3); scene.add(rim);

    const cup = buildCup(THREE);
    scene.add(cup);

    let mx = 0, my = 0;
    addEventListener('pointermove', e => {
      mx = e.clientX / innerWidth - 0.5; my = e.clientY / innerHeight - 0.5;
    }, { passive: true });

    addEventListener('resize', () => {
      renderer.setSize(W(), H(), false); cam.aspect = W() / H(); cam.updateProjectionMatrix();
    }, { passive: true });

    // pause when off-screen (perf)
    let visible = true;
    new IntersectionObserver(es => { visible = es[0].isIntersecting; }, { threshold: 0 }).observe(wrap);

    let t = 0;
    (function loop() {
      requestAnimationFrame(loop);
      if (!visible) return;
      t += 0.006;
      cup.rotation.y += 0.0045;
      cup.position.y = Math.sin(t * 2) * 0.05;
      cam.position.x += (mx * 0.7 - cam.position.x) * 0.05;
      cam.position.y += ((0.2 - my * 0.45) - cam.position.y) * 0.05;
      cam.lookAt(0, 0, 0);
      renderer.render(scene, cam);
    })();

    // cross-fade: reveal canvas, fade out static image
    let o = 0;
    const fade = setInterval(() => {
      o += 0.05; canvas.style.opacity = Math.min(o, 1);
      if (heroImg) heroImg.style.opacity = Math.max(1 - o, 0);
      if (o >= 1) clearInterval(fade);
    }, 30);
  }

  // ---- Procedural Quencher-style cup. Replace with GLTFLoader('.glb') to use a real model. ----
  function buildCup(THREE) {
    const g = new THREE.Group();
    const cream = new THREE.MeshStandardMaterial({ color: 0xefe9da, metalness: 0.35, roughness: 0.38 });
    const steel = new THREE.MeshStandardMaterial({ color: 0xd0cabd, metalness: 0.95, roughness: 0.22 });
    const clay  = new THREE.MeshStandardMaterial({ color: 0xC0664A, metalness: 0.1, roughness: 0.5 });

    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.72, 2.4, 64), cream); g.add(body);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.56, 0.5, 64), cream); base.position.y = -1.45; g.add(base);
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.97, 0.95, 0.18, 64), steel); collar.position.y = 1.22; g.add(collar);
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.99, 0.97, 0.34, 64), steel); lid.position.y = 1.45; g.add(lid);
    const straw = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.5, 24), clay); straw.position.set(0.42, 2.05, 0); straw.rotation.z = 0.06; g.add(straw);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.12, 20, 44, Math.PI * 1.25), cream);
    handle.position.set(1.02, 0.15, 0); handle.rotation.z = -0.35; g.add(handle);

    g.rotation.x = 0.08; g.scale.setScalar(1.05);
    return g;
  }
})();
