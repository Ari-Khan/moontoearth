import { useMemo, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { PointerLockControls, Stars } from "@react-three/drei";
import { buildLunarSiteData } from "../utils/lunarTerrain.js";

function TerrainMesh({ site }) {
    const { terrainSize, craters, boulders, getHeightAt } = useMemo(
        () => buildLunarSiteData(site),
        [site],
    );

    const { geometry, boulderPositions, beaconY } = useMemo(() => {
        const segments = 280;
        const geo = new THREE.PlaneGeometry(terrainSize, terrainSize, segments, segments);
        geo.rotateX(-Math.PI / 2);

        const pos = geo.attributes.position;
        const colors = new Float32Array(pos.count * 3);

        const baseAlbedo = 0.24 + site.characteristics.albedo * 0.42;
        const color = new THREE.Color();
        const half = terrainSize / 2;

        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i);
            const z = pos.getZ(i);
            
            // Apply slight downward curvature near edges to integrate seamlessly with horizon fog
            const distFromCenter = Math.hypot(x, z);
            const edgeRatio = Math.max(0, (distFromCenter - (half - 20)) / 20);
            const edgeDrop = edgeRatio * edgeRatio * 2.8;

            const y = getHeightAt(x, z) - edgeDrop;
            pos.setY(i, y);

            const shade = Math.max(0.12, Math.min(0.88, baseAlbedo + y * 0.08));
            color.setRGB(shade, shade * 0.98, shade * 0.95);
            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;
        }

        geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
        geo.computeVertexNormals();

        const placedBoulders = boulders.map((b) => ({
            ...b,
            y: getHeightAt(b.x, b.z) + b.scale * 0.35,
        }));

        return {
            geometry: geo,
            boulderPositions: placedBoulders,
            beaconY: getHeightAt(0, 0),
        };
    }, [terrainSize, craters, boulders, getHeightAt, site.characteristics.albedo]);

    const rockColor = useMemo(() => {
        const v = Math.round((0.28 + site.characteristics.albedo * 0.32) * 255);
        return `rgb(${v}, ${Math.round(v * 0.98)}, ${Math.round(v * 0.95)})`;
    }, [site.characteristics.albedo]);

    return (
        <>
            <mesh geometry={geometry} receiveShadow castShadow>
                <meshStandardMaterial
                    vertexColors
                    roughness={0.94}
                    metalness={0.02}
                />
            </mesh>

            {boulderPositions.map((b, idx) => (
                <mesh
                    key={idx}
                    position={[b.x, b.y, b.z]}
                    rotation={[b.rotX, b.rotY, 0]}
                    scale={b.scale}
                    castShadow
                    receiveShadow
                >
                    <dodecahedronGeometry args={[1, 0]} />
                    <meshStandardMaterial color={rockColor} roughness={0.96} metalness={0.04} />
                </mesh>
            ))}

            {/* Landing beacon marker */}
            <group position={[0, beaconY, 0]}>
                <mesh position={[0, 0.4, 0]}>
                    <cylinderGeometry args={[0.02, 0.02, 0.8, 10]} />
                    <meshStandardMaterial color="#d8d4cc" metalness={0.5} roughness={0.3} />
                </mesh>
                <mesh position={[0, 0.85, 0]}>
                    <sphereGeometry args={[0.08, 16, 16]} />
                    <meshBasicMaterial color="#ff3b30" />
                </mesh>
            </group>
        </>
    );
}

function FirstPersonCharacter({ site, controlsRef, isLocked }) {
    const { camera } = useThree();
    const { terrainSize, getHeightAt } = useMemo(() => buildLunarSiteData(site), [site]);

    const positionRef = useRef(new THREE.Vector3(0, 0, 5));
    const velocityYRef = useRef(0);
    const isGroundedRef = useRef(true);

    const keysRef = useRef({
        forward: false,
        backward: false,
        left: false,
        right: false,
        jump: false,
    });

    const eyeHeight = 1.25;
    const halfBoundary = terrainSize / 2 - 1.2;

    useEffect(() => {
        const initialY = getHeightAt(0, 5) + eyeHeight;
        positionRef.current.set(0, initialY, 5);
        camera.position.set(0, initialY, 5);
        camera.lookAt(0, initialY, 0);
    }, [site, camera, getHeightAt, eyeHeight]);

    useEffect(() => {
        const handleKeyDown = (e) => {
            switch (e.code) {
                case "KeyW":
                case "ArrowUp":
                    keysRef.current.forward = true;
                    break;
                case "KeyS":
                case "ArrowDown":
                    keysRef.current.backward = true;
                    break;
                case "KeyA":
                case "ArrowLeft":
                    keysRef.current.left = true;
                    break;
                case "KeyD":
                case "ArrowRight":
                    keysRef.current.right = true;
                    break;
                case "Space":
                    keysRef.current.jump = true;
                    break;
                default:
                    break;
            }
        };

        const handleKeyUp = (e) => {
            switch (e.code) {
                case "KeyW":
                case "ArrowUp":
                    keysRef.current.forward = false;
                    break;
                case "KeyS":
                case "ArrowDown":
                    keysRef.current.backward = false;
                    break;
                case "KeyA":
                case "ArrowLeft":
                    keysRef.current.left = false;
                    break;
                case "KeyD":
                case "ArrowRight":
                    keysRef.current.right = false;
                    break;
                case "Space":
                    keysRef.current.jump = false;
                    break;
                default:
                    break;
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("keyup", handleKeyUp);

        return () => {
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("keyup", handleKeyUp);
        };
    }, []);

    useFrame((_, delta) => {
        if (!isLocked) return;

        const dt = Math.min(delta, 0.1);
        const keys = keysRef.current;

        // Lunar gravity (~1.62 m/s^2 scaled)
        const gravity = 8.5;
        const jumpSpeed = 4.2;
        const moveSpeed = 5.2;

        const forwardDir = new THREE.Vector3();
        camera.getWorldDirection(forwardDir);
        forwardDir.y = 0;
        forwardDir.normalize();

        const rightDir = new THREE.Vector3();
        rightDir.crossVectors(forwardDir, new THREE.Vector3(0, 1, 0)).normalize();

        const moveDir = new THREE.Vector3();
        if (keys.forward) moveDir.add(forwardDir);
        if (keys.backward) moveDir.sub(forwardDir);
        if (keys.right) moveDir.add(rightDir);
        if (keys.left) moveDir.sub(rightDir);

        if (moveDir.lengthSq() > 0) {
            moveDir.normalize();
            positionRef.current.addScaledVector(moveDir, moveSpeed * dt);
        }

        // Keep inside terrain bounds
        positionRef.current.x = Math.max(-halfBoundary, Math.min(halfBoundary, positionRef.current.x));
        positionRef.current.z = Math.max(-halfBoundary, Math.min(halfBoundary, positionRef.current.z));

        const terrainY = getHeightAt(positionRef.current.x, positionRef.current.z);
        const minHeight = terrainY + eyeHeight;

        if (isGroundedRef.current && keys.jump) {
            velocityYRef.current = jumpSpeed;
            isGroundedRef.current = false;
        }

        velocityYRef.current -= gravity * dt;
        positionRef.current.y += velocityYRef.current * dt;

        if (positionRef.current.y <= minHeight) {
            positionRef.current.y = minHeight;
            velocityYRef.current = 0;
            isGroundedRef.current = true;
        }

        camera.position.copy(positionRef.current);
    });

    return null;
}

function LunarTerrain({ site, bright = true }) {
    const controlsRef = useRef(null);
    const [isLocked, setIsLocked] = useState(false);

    return (
        <div className="terrain-container">
            {!isLocked && (
                <div
                    className="terrain-overlay-prompt"
                    onClick={() => controlsRef.current?.lock()}
                >
                    <div className="prompt-card">
                        <h3>Click to Explore Location</h3>
                        <p><strong>WASD / Arrow keys</strong> — Walk</p>
                        <p><strong>Space</strong> — Jump (Lunar low gravity)</p>
                        <p><strong>Mouse</strong> — Look around</p>
                        <p><strong>ESC</strong> — Pause / Unlock mouse</p>
                        <button type="button" className="prompt-start-btn">
                            Enter First-Person Map
                        </button>
                    </div>
                </div>
            )}

            <div className="crosshair" aria-hidden="true">+</div>

            <Canvas
                shadows
                camera={{ fov: 68, near: 0.08, far: 300 }}
                dpr={[1, 2]}
                gl={{ antialias: true }}
            >
                <color attach="background" args={["#010204"]} />
                <fog attach="fog" args={["#010204", 22, 44]} />
                <Stars radius={60} depth={30} count={2200} factor={2.5} saturation={0} fade />

                <ambientLight intensity={bright ? 0.6 : 0.15} />
                <directionalLight
                    position={[-18, 14, 10]}
                    intensity={bright ? 2.0 : 2.8}
                    castShadow
                    shadow-mapSize-width={2048}
                    shadow-mapSize-height={2048}
                    shadow-camera-near={1}
                    shadow-camera-far={60}
                    shadow-camera-left={-20}
                    shadow-camera-right={20}
                    shadow-camera-top={20}
                    shadow-camera-bottom={-20}
                />

                <TerrainMesh site={site} />
                <FirstPersonCharacter site={site} controlsRef={controlsRef} isLocked={isLocked} />

                <PointerLockControls
                    ref={controlsRef}
                    onLock={() => setIsLocked(true)}
                    onUnlock={() => setIsLocked(false)}
                />
            </Canvas>
        </div>
    );
}

export default LunarTerrain;
