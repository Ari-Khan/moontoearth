import { useState } from "react";
import * as THREE from "three";

const MARKER_RADIUS = 0.01;

function Marker({ children }) {
    const [position, setPosition] = useState(null);

    return (
        <group
            onClick={(event) => {
                event.stopPropagation();
                if (event.delta > 4) return;
                setPosition(event.point.clone().normalize().toArray());
            }}
        >
            {children}
            {position && (
                <mesh
                    position={position}
                    renderOrder={2}
                    onClick={(event) => event.stopPropagation()}
                >
                    <sphereGeometry args={[MARKER_RADIUS, 20, 20]} />
                    <meshBasicMaterial
                        color="#ff3b30"
                        transparent={true}
                        opacity={0.7}
                        depthTest={true}
                        depthWrite={false}
                        blending={THREE.NormalBlending}
                    />
                </mesh>
            )}
        </group>
    );
}

export default Marker;
