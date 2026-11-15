import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { PointerLockControls, Sparkles } from "@react-three/drei";
import * as THREE from "three";

function terrainKind(analog, isAntarctic) {
    const climate = analog.data.climate;
    const elevation = analog.data.elevation;
    const lithology = analog.data.geology?.lithology?.toLowerCase() ?? "";
    if (isAntarctic || analog.center.latitude <= -60) return "icy";
    if (
        climate?.precipitationMmDay >= 3 &&
        elevation.meanSlopeDegrees < 4
    ) {
        return "marshy";
    }
    if (
        elevation.meanSlopeDegrees >= 6 ||
        elevation.roughnessStdDevM >= 500 ||
        lithology.includes("basalt") ||
        lithology.includes("igneous")
    ) {
        return "rocky";
    }
    if (climate?.precipitationMmDay <= 1) return "arid";
    return "grassy";
}

function createTerrainModel(analog, isAntarctic) {
    const elevation = analog.data.elevation;
    const seed = (analog.tileId * 0.017) % (Math.PI * 2);
    const kind = terrainKind(analog, isAntarctic);
    const amplitude = Math.min(
        kind === "rocky" ? 11 : 7,
        Math.max(kind === "marshy" ? 0.8 : 1.5, elevation.reliefM / 120),
    );
    const roughness = Math.min(
        1,
        Math.max(0.15, elevation.roughnessStdDevM / 900),
    );
    const heightAt = (x, z) => {
        const broad =
            kind === "rocky"
                ? Math.abs(Math.sin(x * 0.13 + seed)) *
                  Math.cos(z * 0.11 - seed * 0.7)
                : Math.sin(x * 0.13 + seed) *
                  Math.cos(z * 0.11 - seed * 0.7);
        const detail =
            Math.sin(x * 0.42 + seed * 2) *
            Math.cos(z * 0.36 - seed) *
            roughness;
        const fineDetail =
            Math.sin(x * 1.15 - seed) *
            Math.cos(z * 0.92 + seed * 1.7) *
            roughness *
            0.16;
        const ridge =
            kind === "rocky"
                ? Math.pow(Math.abs(Math.sin(x * 0.24 + z * 0.08 + seed)), 3) *
                  0.3
                : 0;
        const marshRipple =
            kind === "marshy" ? Math.sin(x * 0.8 + z * 0.2) * 0.08 : 0;
        return (
            broad * 0.62 +
            detail * 0.22 +
            fineDetail +
            ridge +
            marshRipple
        ) * amplitude;
    };
    const geometry = new THREE.PlaneGeometry(80, 80, 128, 128);
    const positions = geometry.attributes.position;
    for (let index = 0; index < positions.count; index += 1) {
        const x = positions.getX(index);
        const z = -positions.getY(index);
        positions.setZ(index, heightAt(x, z));
    }
    positions.needsUpdate = true;
    geometry.rotateX(-Math.PI / 2);
    geometry.computeVertexNormals();
    return { geometry, heightAt, amplitude, kind, seed };
}

function Terrain({ model, analog }) {
    const colors = {
        arid: "#a8895f",
        grassy: "#71835c",
        marshy: "#536e61",
        rocky: "#806e59",
        icy: "#dce9ed",
    };
    const material = useMemo(
        () =>
            new THREE.MeshStandardMaterial({
                color: colors[model.kind],
                roughness: 1,
                metalness: 0,
            }),
        [model.kind],
    );
    return <mesh geometry={model.geometry} material={material} receiveShadow />;
}

function RockField({ model, analog }) {
    const rocks = useMemo(() => {
        const count = Math.round(
            30 + Math.min(110, analog.data.elevation.roughnessStdDevM / 10),
        );
        return Array.from({ length: count }, (_, index) => {
            const angle = index * 2.399 + model.seed;
            const radius = 5 + ((index * 17) % 310) / 10;
            const x = Math.cos(angle) * radius;
            const z = Math.sin(angle) * radius;
            const cluster = index % 5 === 0 ? 1.8 : 1;
            const size = (0.18 + ((index * 13) % 12) / 10) * cluster;
            return {
                position: [x, model.heightAt(x, z) + size * 0.45, z],
                rotation: [angle * 0.7, angle, angle * 0.3],
                scale: [size * 1.2, size, size * 0.9],
            };
        });
    }, [analog.data.elevation.roughnessStdDevM, model]);
    return (
        <group>
            {rocks.map((rock, index) => (
                <mesh
                    key={index}
                    position={rock.position}
                    rotation={rock.rotation}
                    scale={rock.scale}
                    castShadow
                >
                    <dodecahedronGeometry args={[1, 0]} />
                    <meshStandardMaterial color="#5e5147" roughness={1} />
                </mesh>
            ))}
        </group>
    );
}

function ArtifactField({ model }) {
    const positions = [
        [-9, -8],
        [12, -16],
        [-18, 14],
        [22, 8],
        [-27, -20],
        [5, 27],
    ];
    return (
        <group>
            {positions.map(([x, z], index) => (
                <mesh
                    key={index}
                    position={[x, model.heightAt(x, z) + 1.1, z]}
                    rotation={[0, index * 0.8, 0]}
                    castShadow
                >
                    <cylinderGeometry args={[0.12, 0.16, 2.2, 6]} />
                    <meshStandardMaterial
                        color="#b4a98d"
                        metalness={0.45}
                        roughness={0.55}
                    />
                </mesh>
            ))}
        </group>
    );
}

function BackgroundMountains({ model, analog }) {
    if (!["Mountainous", "Extreme mountainous"].includes(analog.terrainLabel)) {
        return null;
    }
    const peaks = [
        ...[8, 15, 23, 31, 39, 47, 55, 63].map((x, index) => ({
            x: x - 36,
            z: -31,
            height: 15 + (index % 4) * 3,
            width: 6 + (index % 3) * 2,
            depth: 5 + (index % 2) * 2,
        })),
        ...[-22, -8, 8, 22].map((z, index) => ({
            x: -31,
            z,
            height: 13 + (index % 3) * 4,
            width: 5 + (index % 2) * 2,
            depth: 7,
        })),
        ...[-22, -8, 8, 22].map((z, index) => ({
            x: 31,
            z,
            height: 14 + (index % 3) * 3,
            width: 5 + (index % 2) * 2,
            depth: 7,
        })),
    ];
    return (
        <group>
            {peaks.map((peak, index) => (
                <mesh
                    key={index}
                    position={[
                        peak.x,
                        model.heightAt(peak.x, peak.z) + peak.height / 2,
                        peak.z,
                    ]}
                    rotation={[0, (index % 2) * 0.16, 0]}
                    scale={[peak.width, peak.height, peak.depth]}
                >
                    <coneGeometry args={[1, 1, 8, 2]} />
                    <meshStandardMaterial color="#596b76" roughness={1} />
                </mesh>
            ))}
        </group>
    );
}

function ExplorerMotion({ terrain }) {
    const controlsRef = useRef(null);
    const keys = useRef(new Set());
    const velocity = useRef(new THREE.Vector3());
    const { camera } = useThree();
    const cameraPosition = useRef(camera.position);

    useEffect(() => {
        const down = (event) => {
            keys.current.add(event.code);
        };
        const up = (event) => {
            keys.current.delete(event.code);
        };
        window.addEventListener("keydown", down);
        window.addEventListener("keyup", up);
        return () => {
            window.removeEventListener("keydown", down);
            window.removeEventListener("keyup", up);
        };
    }, []);

    useFrame((_, delta) => {
        const step = Math.min(delta, 0.05);
        const groundedHeight =
            terrain.heightAt(cameraPosition.current.x, cameraPosition.current.z) +
            1.7;
        const grounded = cameraPosition.current.y <= groundedHeight + 0.04;
        const direction = new THREE.Vector3();
        const right = new THREE.Vector3();
        if (controlsRef.current?.isLocked) {
            controlsRef.current.getDirection(direction);
            direction.y = 0;
            direction.normalize();
            right.crossVectors(direction, new THREE.Vector3(0, 1, 0)).normalize();
            const movement = new THREE.Vector3();
            if (keys.current.has("KeyW")) movement.add(direction);
            if (keys.current.has("KeyS")) movement.sub(direction);
            if (keys.current.has("KeyD")) movement.add(right);
            if (keys.current.has("KeyA")) movement.sub(right);
            if (movement.lengthSq() > 0) {
                movement.normalize().multiplyScalar(8);
                velocity.current.x = THREE.MathUtils.lerp(
                    velocity.current.x,
                    movement.x,
                    Math.min(1, step * 10),
                );
                velocity.current.z = THREE.MathUtils.lerp(
                    velocity.current.z,
                    movement.z,
                    Math.min(1, step * 10),
                );
            } else {
                velocity.current.x = THREE.MathUtils.damp(
                    velocity.current.x,
                    0,
                    8,
                    step,
                );
                velocity.current.z = THREE.MathUtils.damp(
                    velocity.current.z,
                    0,
                    8,
                    step,
                );
            }
            if (keys.current.has("Space") && grounded) {
                velocity.current.y = 7;
            }
        }
        velocity.current.y -= 18 * step;
        cameraPosition.current.x += velocity.current.x * step;
        cameraPosition.current.z += velocity.current.z * step;
        cameraPosition.current.x = THREE.MathUtils.clamp(
            cameraPosition.current.x,
            -38,
            38,
        );
        cameraPosition.current.z = THREE.MathUtils.clamp(
            cameraPosition.current.z,
            -38,
            38,
        );
        const floor =
            terrain.heightAt(cameraPosition.current.x, cameraPosition.current.z) +
            1.7;
        cameraPosition.current.y += velocity.current.y * step;
        if (cameraPosition.current.y < floor) {
            cameraPosition.current.y = floor;
            velocity.current.y = 0;
        }
    });

    return <PointerLockControls ref={controlsRef} />;
}

function ExplorerScene({ analog, isAntarctic }) {
    const model = useMemo(
        () => createTerrainModel(analog, isAntarctic),
        [analog, isAntarctic],
    );
    const climate = analog.data.climate;
    const sparkleCount = Math.min(
        900,
        Math.max(100, 150 + (climate?.precipitationMmDay ?? 0) * 90),
    );
    return (
        <>
            <color attach="background" args={["#83b9dc"]} />
            <fog attach="fog" args={["#83b9dc", 34, 86]} />
            <hemisphereLight
                args={["#d9efff", "#5a493b", 1.35]}
            />
            <directionalLight
                position={[-12, 24, 8]}
                intensity={2.5}
                castShadow
            />
            <Terrain model={model} analog={analog} />
            <mesh
                rotation={[-Math.PI / 2, 0, 0]}
                position={[0, -model.amplitude - 1.5, 0]}
            >
                <planeGeometry args={[110, 110]} />
                <meshStandardMaterial
                    color={model.kind === "icy" ? "#9eb5bf" : "#302a24"}
                    roughness={1}
                />
            </mesh>
            <RockField model={model} analog={analog} />
            <ArtifactField model={model} />
            <BackgroundMountains model={model} analog={analog} />
            <Sparkles
                count={sparkleCount}
                scale={[70, 18, 70]}
                size={climate?.windSpeedMPerS >= 8 ? 2.8 : 1.5}
                speed={climate?.windSpeedMPerS ?? 0.4}
                color={
                    model.kind === "icy"
                        ? "#f5fbff"
                        : climate?.precipitationMmDay >= 3
                          ? "#b9d8e8"
                          : "#d6b98c"
                }
                opacity={0.45}
            />
            <ExplorerMotion terrain={model} />
        </>
    );
}

function AnalogExplorer({ analog, isAntarctic, onClose }) {
    return (
        <div className="analog-explorer" role="dialog" aria-label="3D analog explorer">
            <Canvas
                camera={{ fov: 72, position: [0, 4, 10] }}
                dpr={[1, 2]}
                shadows
            >
                <ExplorerScene analog={analog} isAntarctic={isAntarctic} />
            </Canvas>
            <div className="analog-explorer-hud">
                <div>
                    <strong>3D analog explorer</strong>
                    <span>WASD move · Space jump · click to look</span>
                </div>
                <button type="button" onClick={onClose}>
                    Exit explorer
                </button>
            </div>
        </div>
    );
}

export default AnalogExplorer;
