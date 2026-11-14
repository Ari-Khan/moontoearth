import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";

function Camera({ bright = true, children }) {
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
            <OrbitControls
                enableDamping
                enablePan={false}
                minDistance={1.025}
                maxDistance={5.5}
            />
        </Canvas>
    );
}

export default Camera;
