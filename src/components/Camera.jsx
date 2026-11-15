import { Suspense, useEffect, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";

const FLY_DURATION_MS = 1100;
const ORIGIN = new THREE.Vector3(0, 0, 0);
const IDENTITY = new THREE.Quaternion();

function locationToVector({ latitude, longitude }) {
    const latitudeRadians = THREE.MathUtils.degToRad(latitude);
    const longitudeRadians = THREE.MathUtils.degToRad(longitude);
    const latitudeCosine = Math.cos(latitudeRadians);
    return new THREE.Vector3(
        latitudeCosine * Math.cos(longitudeRadians),
        Math.sin(latitudeRadians),
        -latitudeCosine * Math.sin(longitudeRadians),
    );
}

function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function CameraFlight({ focus, focusRequest, controlsRef }) {
    const { camera } = useThree();
    const flight = useRef(null);

    useEffect(() => {
        if (!focus) return;
        const startDirection = camera.position.clone().normalize();
        const targetDirection = locationToVector(focus);
        flight.current = {
            startDirection,
            rotation: new THREE.Quaternion().setFromUnitVectors(
                startDirection,
                targetDirection,
            ),
            distance: camera.position.length(),
            startedAt: null,
        };
    }, [camera, focus, focusRequest]);

    useEffect(() => {
        const controls = controlsRef.current;
        if (!controls) return undefined;
        const cancel = () => {
            flight.current = null;
        };
        controls.addEventListener("start", cancel);
        return () => controls.removeEventListener("start", cancel);
    }, [controlsRef]);

    useFrame(() => {
        const active = flight.current;
        if (!active) return;
        // Start the clock on the first rendered frame, so a long main-thread
        // block (e.g. building the hex grid) doesn't eat the whole animation.
        if (active.startedAt === null) active.startedAt = performance.now();
        const progress = Math.min(
            (performance.now() - active.startedAt) / FLY_DURATION_MS,
            1,
        );
        const eased = easeInOutCubic(progress);
        const rotation = new THREE.Quaternion().slerpQuaternions(
            IDENTITY,
            active.rotation,
            eased,
        );
        camera.position
            .copy(active.startDirection)
            .applyQuaternion(rotation)
            .multiplyScalar(active.distance);
        camera.lookAt(controlsRef.current?.target ?? ORIGIN);
        if (progress >= 1) flight.current = null;
    });

    return null;
}

function Camera({ bright = true, focus = null, focusRequest = 0, children }) {
    const controlsRef = useRef(null);

    return (
        <Canvas
            camera={{ fov: 42, position: [0, 0, 3.2] }}
            dpr={[1, 2]}
            gl={{ antialias: true }}
        >
            <color attach="background" args={["#000000"]} />
            <ambientLight intensity={bright ? 1.15 : 0.18} />
            <directionalLight
                position={[-2, 3, 4]}
                intensity={bright ? 1.1 : 2.2}
            />
            <Suspense fallback={null}>{children}</Suspense>
            <CameraFlight
                focus={focus}
                focusRequest={focusRequest}
                controlsRef={controlsRef}
            />
            <OrbitControls
                ref={controlsRef}
                enableDamping
                enablePan={false}
                minDistance={1.15}
                maxDistance={6}
            />
        </Canvas>
    );
}

export default Camera;
