"use client";

import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, Float, Icosahedron, Sparkles, Sphere, Torus } from "@react-three/drei";
import * as THREE from "three";

type ExecutionStatus = "idle" | "running" | "success" | "error" | "timeout";

export interface HomeTechSceneProps {
  collaborationIndex: number;
  suggestionLoad: number;
  stabilityIndex: number;
  executionStatus: ExecutionStatus;
  throughputPerMinute: number;
  highSeverityCount: number;
}

function statusTone(status: ExecutionStatus): string {
  switch (status) {
    case "running":
      return "#38BDF8";
    case "success":
      return "#34D399";
    case "error":
      return "#FB7185";
    case "timeout":
      return "#FBBF24";
    case "idle":
    default:
      return "#94A3B8";
  }
}

function SignalCore(props: HomeTechSceneProps) {
  const coreRef = useRef<THREE.Mesh>(null);
  const flowRingRef = useRef<THREE.Mesh>(null);
  const riskShellRef = useRef<THREE.Mesh>(null);
  const stabilityRef = useRef<THREE.Mesh>(null);

  const tone = useMemo(() => statusTone(props.executionStatus), [props.executionStatus]);
  const coreScale = 0.65 + props.collaborationIndex * 0.75;
  const flowSpeed = 0.25 + Math.min(props.throughputPerMinute / 10, 2.2);
  const riskDistort = Math.min(0.12 + props.highSeverityCount * 0.16, 0.85);
  const riskDetail = Math.min(4, Math.max(1, 1 + props.highSeverityCount));
  const shieldOpacity = 0.15 + props.stabilityIndex * 0.35;
  const sparkles = 24 + Math.round(props.suggestionLoad * 120);

  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    const isCritical = props.executionStatus === "error" || props.executionStatus === "timeout";
    const jitter = isCritical ? Math.sin(t * 24) * 0.035 : 0;

    if (coreRef.current) {
      coreRef.current.rotation.y = t * (0.15 + props.collaborationIndex * 0.9);
      const pulse = coreScale * (1 + Math.sin(t * 1.8) * (0.03 + props.collaborationIndex * 0.08));
      coreRef.current.scale.setScalar(pulse + jitter);
      coreRef.current.position.x = jitter;
    }

    if (flowRingRef.current) {
      flowRingRef.current.rotation.x = Math.PI / 2;
      flowRingRef.current.rotation.z = t * flowSpeed;
    }

    if (riskShellRef.current) {
      riskShellRef.current.rotation.x = t * (0.25 + riskDistort * 0.9);
      riskShellRef.current.rotation.y = t * (0.4 + riskDistort * 0.8);
      const drift = Math.sin(t * 1.2) * (0.04 + riskDistort * 0.08);
      riskShellRef.current.position.set(0.7 + drift + jitter * 0.8, -0.1, 0.15);
    }

    if (stabilityRef.current) {
      stabilityRef.current.rotation.y = t * 0.18;
      stabilityRef.current.rotation.x = Math.PI / 2;
    }
  });

  return (
    <>
      <ambientLight intensity={0.85} />
      <pointLight position={[2.2, 2, 2]} intensity={1.35} color={tone} />
      <pointLight position={[-2, -1.6, -1]} intensity={0.75} color="#FFFFFF" />

      <Float speed={1.2} rotationIntensity={0.2} floatIntensity={0.3}>
        <Sphere ref={coreRef} args={[0.55, 48, 48]} position={[0, -0.05, 0]}>
          <meshStandardMaterial
            color={tone}
            roughness={0.22}
            metalness={0.68}
            emissive={tone}
            emissiveIntensity={0.2 + props.collaborationIndex * 0.35}
          />
        </Sphere>
      </Float>

      <Torus ref={flowRingRef} args={[1.05, 0.08, 24, 140]} position={[0, -0.05, 0]}>
        <meshStandardMaterial color="#38BDF8" emissive="#38BDF8" emissiveIntensity={0.2} metalness={0.75} roughness={0.35} />
      </Torus>

      <Icosahedron ref={riskShellRef} key={riskDetail} args={[0.36, riskDetail]} position={[0.7, -0.1, 0.15]}>
        <meshStandardMaterial
          color={props.highSeverityCount > 0 ? "#FB7185" : "#CBD5E1"}
          roughness={0.18}
          metalness={0.55}
          emissive={props.highSeverityCount > 0 ? "#FB7185" : "#CBD5E1"}
          emissiveIntensity={0.1 + riskDistort * 0.7}
          wireframe={props.highSeverityCount > 2}
        />
      </Icosahedron>

      <Torus ref={stabilityRef} args={[1.55, 0.03, 10, 200]} position={[0, -0.05, -0.2]}>
        <meshStandardMaterial
          color="#FFFFFF"
          transparent
          opacity={shieldOpacity}
          emissive="#E2E8F0"
          emissiveIntensity={0.12}
        />
      </Torus>

      <Sparkles
        count={sparkles}
        size={2}
        speed={0.45 + props.suggestionLoad * 1.8}
        scale={4.8}
        color={props.executionStatus === "error" ? "#FB7185" : tone}
        opacity={props.executionStatus === "error" ? 0.72 : 0.45}
      />
    </>
  );
}

export function HomeTechScene(props: HomeTechSceneProps) {
  return (
    <div className="h-full min-h-[260px] w-full">
      <Canvas
        dpr={[1, 1.5]}
        camera={{ position: [0, 0, 4.2], fov: 42 }}
        fallback={
          <div className="flex h-full min-h-[260px] items-center justify-center rounded-2xl bg-gradient-to-br from-accent/20 via-primary/15 to-success/20">
            <div className="h-20 w-20 animate-spin rounded-full border-4 border-accent/70 border-t-transparent" />
          </div>
        }
      >
        <Environment preset="city" />
        <SignalCore {...props} />
      </Canvas>
    </div>
  );
}
