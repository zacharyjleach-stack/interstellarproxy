import * as THREE from 'three'

// A 3D arrow lying on a ground disc. setAngle(deg) turns it clockwise from "straight ahead";
// null puts it in an idle spin. pulse(ok) flashes it green or red.
export function createArrow(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100)
  camera.position.set(0, 3.4, 3.6)
  camera.lookAt(0, 0, -0.2)

  scene.add(new THREE.HemisphereLight(0xbcd4ff, 0x10141a, 1.4))
  const sun = new THREE.DirectionalLight(0xffffff, 2.2)
  sun.position.set(2, 5, 3)
  scene.add(sun)

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(1.55, 1.6, 96),
    new THREE.MeshBasicMaterial({ color: 0x30363d, side: THREE.DoubleSide }),
  )
  ring.rotation.x = -Math.PI / 2
  scene.add(ring)
  const ahead = new THREE.Mesh(new THREE.CircleGeometry(0.06, 24), new THREE.MeshBasicMaterial({ color: 0x8b949e }))
  ahead.rotation.x = -Math.PI / 2
  ahead.position.set(0, 0.001, -1.575)
  scene.add(ahead)

  const shape = new THREE.Shape()
  shape.moveTo(0, 1.3)
  shape.lineTo(0.7, 0.35)
  shape.lineTo(0.25, 0.35)
  shape.lineTo(0.25, -1.0)
  shape.lineTo(-0.25, -1.0)
  shape.lineTo(-0.25, 0.35)
  shape.lineTo(-0.7, 0.35)
  shape.closePath()
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.22,
    bevelEnabled: true,
    bevelThickness: 0.06,
    bevelSize: 0.05,
    bevelSegments: 4,
  })
  geo.center()
  geo.rotateX(-Math.PI / 2) // lay flat, tip pointing away from the viewer (-Z)
  const material = new THREE.MeshStandardMaterial({ color: 0x2f81f7, metalness: 0.3, roughness: 0.35 })
  const arrow = new THREE.Mesh(geo, material)
  arrow.position.y = 0.3
  scene.add(arrow)

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(1, 48),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 }),
  )
  shadow.rotation.x = -Math.PI / 2
  shadow.scale.set(0.9, 1.3, 1)
  scene.add(shadow)

  let target = null
  let current = 0
  let flash = 0
  let flashColor = new THREE.Color(0x3fb950)
  const base = new THREE.Color(0x2f81f7)
  const idle = new THREE.Color(0x6e7681)

  function resize() {
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    if (canvas.width !== Math.round(w * renderer.getPixelRatio()) || canvas.height !== Math.round(h * renderer.getPixelRatio())) {
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
  }

  const clock = new THREE.Clock()
  renderer.setAnimationLoop(() => {
    resize()
    const dt = Math.min(clock.getDelta(), 0.1)
    const t = clock.elapsedTime
    if (target === null) {
      current += dt * 40
    } else {
      // Turn the short way round, smoothly.
      const diff = ((target - current + 540) % 360) - 180
      current += diff * Math.min(1, dt * 8)
    }
    current = ((current % 360) + 360) % 360
    arrow.rotation.y = THREE.MathUtils.degToRad(-current)
    shadow.rotation.z = THREE.MathUtils.degToRad(-current)
    arrow.position.y = 0.3 + Math.sin(t * 2.2) * 0.06

    flash = Math.max(0, flash - dt * 2.5)
    material.color.copy(target === null ? idle : base).lerp(flashColor, flash)
    material.emissive.copy(flashColor).multiplyScalar(flash * 0.6)
    renderer.render(scene, camera)
  })

  return {
    setAngle(deg) {
      target = deg === null ? null : ((deg % 360) + 360) % 360
    },
    pulse(ok) {
      flashColor = new THREE.Color(ok ? 0x3fb950 : 0xf85149)
      flash = 1
    },
  }
}
