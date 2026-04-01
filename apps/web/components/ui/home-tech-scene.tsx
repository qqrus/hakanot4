"use client";

import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, Float, Sphere, Sparkles, Torus } from "@react-three/drei";
import * as THREE from "three";

type ExecutionStatus = "idle" | "running" | "success" | "error" | "timeout";

export interface HomeTechSceneProps {
  collaborationIndex: number;
  suggestionLoad: number;
  stabilityIndex: number;
  executionStatus: ExecutionStatus;
  throughputPerMinute: number;
  highSeverityCount: number;
  recentEventsCount: number;
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

function RoomPlanet(props: HomeTechSceneProps) {
  const planetRef = useRef<THREE.Mesh>(null);
  const orbitInnerRef = useRef<THREE.Mesh>(null);
  const orbitMidRef = useRef<THREE.Mesh>(null);
  const orbitOuterRef = useRef<THREE.Mesh>(null);
  const satelliteRef = useRef<THREE.Mesh>(null);
  const warningMoonRef = useRef<THREE.Mesh>(null);

  const tone = useMemo(() => statusTone(props.executionStatus), [props.executionStatus]);
  const planetScale = 0.85 + props.collaborationIndex * 0.6;
  const orbitSpeed = 0.2 + Math.min(props.throughputPerMinute / 8, 1.8);
  const eventIntensity = Math.min(1, props.recentEventsCount / 10);
  const riskPulse = Math.min(1.2, 0.15 + props.highSeverityCount * 0.22);
  const haloOpacity = 0.12 + props.stabilityIndex * 0.42;
  const sparklesCount = 26 + Math.round(eventIntensity * 50) + Math.round(props.suggestionLoad * 40);

  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    const danger = props.executionStatus === "error" || props.executionStatus === "timeout";
    const jitter = danger ? Math.sin(t * 26) * 0.02 : 0;

    if (planetRef.current) {
      planetRef.current.rotation.y = t * (0.16 + props.collaborationIndex * 0.85);
      const pulse = planetScale * (1 + Math.sin(t * 1.6) * (0.03 + eventIntensity * 0.06));
      planetRef.current.scale.setScalar(pulse + jitter);
    }

    if (orbitInnerRef.current) {
      orbitInnerRef.current.rotation.x = Math.PI / 2;
      orbitInnerRef.current.rotation.z = t * orbitSpeed;
    }

    if (orbitMidRef.current) {
      orbitMidRef.current.rotation.x = Math.PI / 2.2;
      orbitMidRef.current.rotation.z = -t * (orbitSpeed * 0.76 + 0.06);
    }

    if (orbitOuterRef.current) {
      orbitOuterRef.current.rotation.x = Math.PI / 1.9;
      orbitOuterRef.current.rotation.z = t * (orbitSpeed * 0.58 + 0.04);
    }

    if (satelliteRef.current) {
      const r = 1.05 + props.suggestionLoad * 0.45;
      satelliteRef.current.position.x = Math.cos(t * (1.1 + eventIntensity)) * r;
      satelliteRef.current.position.z = Math.sin(t * (1.1 + eventIntensity)) * r;
      satelliteRef.current.position.y = Math.sin(t * 1.2) * 0.22;
      const satScale = 0.17 + eventIntensity * 0.16;
      satelliteRef.current.scale.setScalar(satScale);
    }

    if (warningMoonRef.current) {
      const r = 1.4;
      warningMoonRef.current.position.x = Math.cos(-t * 0.8) * r;
      warningMoonRef.current.position.z = Math.sin(-t * 0.8) * r;
      warningMoonRef.current.position.y = Math.cos(t * 1.6) * 0.16 - 0.18;
      const pulse = 0.08 + riskPulse * (0.35 + Math.sin(t * 4) * 0.1);
      warningMoonRef.current.scale.setScalar(Math.max(0.08, pulse));
    }
  });

  return (
    <>
      <ambientLight intensity={0.95} />
      <pointLight position={[2.2, 2, 2]} intensity={1.45} color={tone} />
      <pointLight position={[-2.4, -1.8, -1.2]} intensity={0.85} color="#FFFFFF" />

      <Float speed={1.05} rotationIntensity={0.22} floatIntensity={0.28}>
        <Sphere ref={planetRef} args={[0.6, 64, 64]} position={[0, 0, 0]}>
          <meshStandardMaterial
            color={tone}
            roughness={0.2}
            metalness={0.72}
            emissive={tone}
            emissiveIntensity={0.16 + props.collaborationIndex * 0.35}
          />
        </Sphere>
      </Float>

      <Torus ref={orbitInnerRef} args={[1.05, 0.03, 18, 180]} position={[0, 0, 0]}>
        <meshStandardMaterial color="#38BDF8" emissive="#38BDF8" emissiveIntensity={0.22} metalness={0.82} roughness={0.28} />
      </Torus>

      <Torus ref={orbitMidRef} args={[1.28, 0.022, 18, 190]} position={[0, 0, 0]}>
        <meshStandardMaterial color="#CBD5E1" emissive="#CBD5E1" emissiveIntensity={0.12} metalness={0.78} roughness={0.35} />
      </Torus>

      <Torus ref={orbitOuterRef} args={[1.5, 0.016, 18, 200]} position={[0, 0, 0]}>
        <meshStandardMaterial
          color="#FFFFFF"
          transparent
          opacity={haloOpacity}
          emissive="#E2E8F0"
          emissiveIntensity={0.14}
          metalness={0.3}
          roughness={0.42}
        />
      </Torus>

      <Sphere ref={satelliteRef} args={[0.12, 32, 32]} position={[1.1, 0.1, 0]}>
        <meshStandardMaterial
          color="#38BDF8"
          emissive="#38BDF8"
          emissiveIntensity={0.42}
          roughness={0.22}
          metalness={0.6}
        />
      </Sphere>

      <Sphere ref={warningMoonRef} args={[0.1, 24, 24]} position={[-1.3, -0.2, 0]}>
        <meshStandardMaterial
          color={props.highSeverityCount > 0 ? "#FB7185" : "#A5B4FC"}
          emissive={props.highSeverityCount > 0 ? "#FB7185" : "#A5B4FC"}
          emissiveIntensity={0.35 + riskPulse * 0.35}
          roughness={0.25}
          metalness={0.45}
        />
      </Sphere>

      <Sparkles
        count={sparklesCount}
        size={2}
        speed={0.45 + eventIntensity * 1.7}
        scale={4.8}
        color={props.highSeverityCount > 0 ? "#FB7185" : tone}
        opacity={props.highSeverityCount > 0 ? 0.78 : 0.48}
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
        <RoomPlanet {...props} />
      </Canvas>
    </div>
  );
}
