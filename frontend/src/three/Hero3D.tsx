import { Canvas, useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';

import { useThemeColors } from '../components/Theme';

/** Cluster sizes: eleven pages that are really four voices. */
const CLUSTERS = [4, 3, 2, 2] as const;

interface NodeSpec {
  cluster: number;
  base: THREE.Vector3;
  center: THREE.Vector3;
}

function buildNodes(): NodeSpec[] {
  const total = CLUSTERS.reduce((sum, size) => sum + size, 0);
  const golden = Math.PI * (3 - Math.sqrt(5));
  const bases: THREE.Vector3[] = [];
  for (let i = 0; i < total; i += 1) {
    const y = 1 - (i / (total - 1)) * 2;
    const radius = Math.sqrt(1 - y * y);
    const theta = golden * i;
    bases.push(new THREE.Vector3(Math.cos(theta) * radius, y, Math.sin(theta) * radius).multiplyScalar(2.35));
  }
  // Pages that echo each other sit near one another on the sphere.
  const order = bases
    .map((vector, index) => ({ vector, index }))
    .sort((a, b) => Math.atan2(a.vector.z, a.vector.x) - Math.atan2(b.vector.z, b.vector.x));
  const nodes: NodeSpec[] = [];
  let cursor = 0;
  CLUSTERS.forEach((size, cluster) => {
    const members = order.slice(cursor, cursor + size).map((item) => item.vector);
    cursor += size;
    const center = members
      .reduce((acc, vector) => acc.add(vector), new THREE.Vector3())
      .multiplyScalar(1 / size)
      .multiplyScalar(0.55);
    members.forEach((base) => nodes.push({ cluster, base: base.clone(), center: center.clone() }));
  });
  return nodes;
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const CYCLE = 11;

function Scene({ onPhase, reduced }: { onPhase: (collapsed: boolean) => void; reduced: boolean }) {
  const colors = useThemeColors();
  const nodes = useMemo(buildNodes, []);
  const clusterColors = useMemo(
    () => [
      new THREE.Color(colors.accent),
      new THREE.Color(colors.accent2),
      new THREE.Color('#7aaeff'),
      new THREE.Color('#ff7b9c'),
    ],
    [colors.accent, colors.accent2],
  );
  const group = useRef<THREE.Group>(null);
  const shell = useRef<THREE.Mesh>(null);
  const core = useRef<THREE.Mesh>(null);
  const meshes = useRef<(THREE.Mesh | null)[]>([]);
  const positions = useRef(nodes.map((node) => node.base.clone()));
  const lines = useRef<THREE.LineSegments>(null);
  const collapsed = useRef(false);

  // Edges join every pair inside one cluster.
  const pairs = useMemo(() => {
    const list: [number, number][] = [];
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        if (nodes[i]?.cluster === nodes[j]?.cluster) list.push([i, j]);
      }
    }
    return list;
  }, [nodes]);
  const linePositions = useMemo(() => new Float32Array(pairs.length * 6), [pairs]);

  const stars = useMemo(() => {
    const array = new Float32Array(240 * 3);
    for (let i = 0; i < 240; i += 1) {
      const radius = 4 + Math.random() * 3.5;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      array[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      array[i * 3 + 1] = radius * Math.cos(phi);
      array[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
    }
    return array;
  }, []);

  useFrame((state, delta) => {
    const time = reduced ? CYCLE * 0.6 : state.clock.elapsedTime;
    const phase = (time % CYCLE) / CYCLE;
    const k = smooth(0.3, 0.5, phase) * (1 - smooth(0.82, 0.98, phase));
    const isCollapsed = k > 0.55;
    if (isCollapsed !== collapsed.current) {
      collapsed.current = isCollapsed;
      onPhase(isCollapsed);
    }

    nodes.forEach((node, index) => {
      const target = positions.current[index];
      const mesh = meshes.current[index];
      if (!target || !mesh) return;
      target.copy(node.base).lerp(node.center, k * 0.94);
      mesh.position.copy(target);
      const scale = 0.17 + k * 0.05 * (CLUSTERS[node.cluster] ?? 1) * 0.35;
      mesh.scale.setScalar(scale / 0.17);
    });

    pairs.forEach(([i, j], index) => {
      const a = positions.current[i];
      const b = positions.current[j];
      if (!a || !b) return;
      linePositions.set([a.x, a.y, a.z, b.x, b.y, b.z], index * 6);
    });
    const line = lines.current;
    if (line) {
      (line.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (line.material as THREE.LineBasicMaterial).opacity = 0.15 + k * 0.7;
    }

    if (group.current && !reduced) {
      group.current.rotation.y += delta * 0.18;
      const px = state.pointer.x * 0.35;
      const py = state.pointer.y * 0.2;
      group.current.rotation.x += (py - group.current.rotation.x) * 0.04;
      group.current.rotation.z += (-px * 0.3 - group.current.rotation.z) * 0.04;
    }
    if (shell.current && !reduced) {
      shell.current.rotation.x += delta * 0.3;
      shell.current.rotation.y -= delta * 0.22;
    }
    if (core.current) {
      const s = 1 + Math.sin(state.clock.elapsedTime * 2.4) * 0.12 + k * 0.5;
      core.current.scale.setScalar(s);
    }
  });

  return (
    <>
      <ambientLight intensity={0.8} />
      <pointLight position={[4, 4, 5]} intensity={60} color={colors.accent} />
      <pointLight position={[-5, -3, -4]} intensity={40} color={colors.accent2} />
      <group ref={group}>
        <mesh ref={shell}>
          <icosahedronGeometry args={[1.25, 1]} />
          <meshBasicMaterial color={colors.ink} wireframe transparent opacity={0.22} />
        </mesh>
        <mesh ref={core}>
          <octahedronGeometry args={[0.32, 0]} />
          <meshStandardMaterial
            color={colors.accent2}
            emissive={colors.accent2}
            emissiveIntensity={1.3}
            roughness={0.3}
          />
        </mesh>
        {nodes.map((node, index) => (
          <mesh
            key={index}
            ref={(mesh) => {
              meshes.current[index] = mesh;
            }}
            position={node.base}
          >
            <sphereGeometry args={[0.17, 24, 24]} />
            <meshStandardMaterial
              color={clusterColors[node.cluster]}
              emissive={clusterColors[node.cluster]}
              emissiveIntensity={0.55}
              metalness={0.2}
              roughness={0.35}
            />
          </mesh>
        ))}
        <lineSegments ref={lines}>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              array={linePositions}
              count={pairs.length * 2}
              itemSize={3}
            />
          </bufferGeometry>
          <lineBasicMaterial color={colors.ink} transparent opacity={0.2} />
        </lineSegments>
        <points>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" array={stars} count={240} itemSize={3} />
          </bufferGeometry>
          <pointsMaterial color={colors.ink} size={0.03} transparent opacity={0.55} sizeAttenuation />
        </points>
      </group>
    </>
  );
}

function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

export default function Hero3D() {
  const [collapsed, setCollapsed] = useState(false);
  const [supported] = useState(webglAvailable);
  const [visible, setVisible] = useState(true);
  const holder = useRef<HTMLDivElement>(null);
  const reduced =
    typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    const node = holder.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry?.isIntersecting ?? true), {
      threshold: 0.05,
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const total = CLUSTERS.reduce((sum, size) => sum + size, 0);
  return (
    <div
      className="hero-canvas"
      ref={holder}
      role="img"
      aria-label={`Animation: ${total} pages collapse into ${CLUSTERS.length} independent voices.`}
    >
      {supported ? (
        <Canvas
          camera={{ position: [0, 0, 7.2], fov: 45 }}
          dpr={[1, 2]}
          frameloop={visible ? 'always' : 'never'}
          gl={{ antialias: true, alpha: true }}
        >
          <Scene onPhase={setCollapsed} reduced={reduced} />
        </Canvas>
      ) : (
        <div className="loading-block">3D view unavailable on this device.</div>
      )}
      <div className="caption">
        <span>{collapsed ? `${CLUSTERS.length} origins` : `${total} pages`}</span>
        <span>
          {collapsed ? 'echoes collapsed into one voice each' : 'every page looks like a separate witness'}
        </span>
      </div>
    </div>
  );
}
