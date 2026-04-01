"use client";

import { useRef, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Sphere, Float, Sparkles } from "@react-three/drei";
import * as THREE from "three";

interface PulseSphereProps {
  activityLevel: "idle" | "active" | "error";
}

function Scene({ activityLevel }: PulseSphereProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  
  // Dynamic properties based on activity - Pastel Light theme
  const { color, speed, distort } = useMemo(() => {
    switch (activityLevel) {
      case "active":
        return { color: "#38BDF8", speed: 4, distort: 0.1 }; // Soft Sky Blue
      case "error":
        return { color: "#FB7185", speed: 6, distort: 0.2 }; // Soft Rose
      case "idle":
      default:
        return { color: "#FFFFFF", speed: 2, distort: 0.05 }; // Clean White/Glass
    }
  }, [activityLevel]);

  // Gentle breathing scale
  useFrame((state) => {
    if (meshRef.current) {
      const t = state.clock.getElapsedTime();
      const scale = 1 + Math.sin(t * speed * 0.5) * 0.03;
      meshRef.current.scale.set(scale, scale, scale);
    }
  });

  return (
    <>
      <ambientLight intensity={1.5} />
      <directionalLight position={[10, 10, 5]} intensity={2.5} color="#FFFFFF" />
      <pointLight position={[-10, -10, -5]} intensity={1} color={color} />
      
      <Float speed={speed} rotationIntensity={0.8} floatIntensity={1.5}>
        <Sphere ref={meshRef} args={[1, 64, 64]} scale={1.2}>
          <meshStandardMaterial
            color={color}
            roughness={0.22}
            metalness={0.62}
            emissive={color}
            emissiveIntensity={activityLevel === "active" ? 0.32 : 0.18}
          />
        </Sphere>
      </Float>

      {/* Adding light sparkles */}
      <Sparkles 
        count={60} 
        scale={6} 
        size={3} 
        speed={speed * 0.5} 
        color={color === "#FFFFFF" ? "#38BDF8" : color} 
        opacity={0.6} 
      />
    </>
  );
}

export function PulseSphere({ activityLevel = "idle" }: PulseSphereProps) {
  return (
    <div className="w-full h-full min-h-[220px] relative pointer-events-none overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900/30 via-slate-800/10 to-accent/20">
      <Canvas
        dpr={[1, 1.5]}
        camera={{ position: [0, 0, 4.2], fov: 44 }}
        fallback={
          <div className="flex h-full min-h-[220px] items-center justify-center rounded-2xl">
            <div className="h-16 w-16 animate-pulse rounded-full bg-accent/30" />
          </div>
        }
      >
        <Scene activityLevel={activityLevel} />
      </Canvas>
    </div>
  );
}
