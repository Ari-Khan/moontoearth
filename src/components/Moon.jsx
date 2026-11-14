import { useState } from "react";
import * as THREE from "three";
import { useTexture } from "@react-three/drei";
import Camera from "./Camera.jsx";
import Marker from "./Marker.jsx";

const GEOMETRY = new THREE.SphereGeometry(1, 128, 64);

function MoonSurface() {
    const texture = useTexture("/textures/physical.jpg", (loadedTexture) => {
        loadedTexture.anisotropy = 4;
        loadedTexture.colorSpace = THREE.SRGBColorSpace;
        loadedTexture.wrapS = THREE.RepeatWrapping;
        loadedTexture.wrapT = THREE.ClampToEdgeWrapping;
        loadedTexture.minFilter = THREE.LinearMipmapLinearFilter;
    });

    return (
        <Marker>
            <mesh geometry={GEOMETRY}>
                <meshStandardMaterial
                    map={texture}
                    roughness={0.92}
                    metalness={0}
                    envMapIntensity={0.2}
                />
            </mesh>
        </Marker>
    );
}

function Moon() {
    const [mapOpen, setMapOpen] = useState(false);
    const [bright, setBright] = useState(true);

    return (
        <main className="viewer">
            <Camera bright={bright}>
                <MoonSurface />
            </Camera>
            <button
                type="button"
                className={`map-button${mapOpen ? " is-active" : ""}`}
                onClick={() => setMapOpen((open) => !open)}
                aria-pressed={mapOpen}
            >
                Map
            </button>
            <button
                type="button"
                className={`light-button${bright ? " is-bright" : ""}`}
                onClick={() => setBright((on) => !on)}
                aria-pressed={bright}
                aria-label={bright ? "Switch to dark lighting" : "Switch to bright lighting"}
                title={bright ? "Switch to dark lighting" : "Switch to bright lighting"}
            >
                <svg
                    className="light-icon"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    focusable="false"
                >
                    {bright ? (
                        <>
                            <circle cx="12" cy="12" r="4.2" />
                            <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6M6.8 17.2l-1.6 1.6" />
                        </>
                    ) : (
                        <path d="M20 14.5A8 8 0 0 1 9.5 4a8.3 8.3 0 1 0 10.5 10.5Z" />
                    )}
                </svg>
            </button>
        </main>
    );
}

export default Moon;
