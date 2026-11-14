import { useState } from "react";
import * as THREE from "three";
import { useTexture } from "@react-three/drei";
import Camera from "./Camera.jsx";
import LunarTerrain from "./LunarTerrain.jsx";
import { pointToLatLon, sampleLunarCharacteristics } from "../utils/lunarTerrain.js";

const GEOMETRY = new THREE.SphereGeometry(1, 256, 128);
const MARKER_RADIUS = 0.012;

function MoonSurface({ selectedPoint, onSelectSite }) {
  const texture = useTexture("/textures/physical.jpg", (loadedTexture) => {
    loadedTexture.anisotropy = 16;
    loadedTexture.colorSpace = THREE.SRGBColorSpace;
    loadedTexture.wrapS = THREE.RepeatWrapping;
    loadedTexture.wrapT = THREE.ClampToEdgeWrapping;
    loadedTexture.minFilter = THREE.LinearMipmapLinearFilter;
    loadedTexture.generateMipmaps = true;
    loadedTexture.needsUpdate = true;
  });

  return (
    <>
      <mesh
        geometry={GEOMETRY}
        onClick={(event) => {
          event.stopPropagation();
          const surfacePoint = event.point
            .clone()
            .normalize()
            .multiplyScalar(1 + MARKER_RADIUS)
            .toArray();
          const coords = pointToLatLon(surfacePoint);
          const characteristics = sampleLunarCharacteristics(texture, event.uv);
          onSelectSite({ point: surfacePoint, ...coords, characteristics });
        }}
      >
        <meshStandardMaterial
          map={texture}
          roughness={0.92}
          metalness={0}
          envMapIntensity={0.2}
        />
      </mesh>
      {selectedPoint && (
        <mesh position={selectedPoint} renderOrder={2}>
          <sphereGeometry args={[MARKER_RADIUS, 20, 20]} />
          <meshBasicMaterial color="#ff3b30" />
        </mesh>
      )}
    </>
  );
}

function Moon() {
  const [mapOpen, setMapOpen] = useState(false);
  const [bright, setBright] = useState(true);
  const [selectedSite, setSelectedSite] = useState(null);
  const [generatedSite, setGeneratedSite] = useState(null);

  return (
    <main className="viewer">
      {generatedSite ? (
        <LunarTerrain site={generatedSite} bright={bright} />
      ) : (
        <Camera bright={bright}>
          <MoonSurface
            selectedPoint={selectedSite?.point ?? null}
            onSelectSite={setSelectedSite}
          />
        </Camera>
      )}

      {generatedSite ? (
        <>
          <button
            type="button"
            className="back-button"
            onClick={() => {
              if (document.pointerLockElement) {
                document.exitPointerLock();
              }
              setGeneratedSite(null);
            }}
          >
            ← Back to Moon
          </button>
          <div className="terrain-hud" role="status">
            <div className="terrain-hud-title">
              {generatedSite.characteristics.terrainType}
            </div>
            <div className="terrain-hud-meta">
              {generatedSite.label} • Drag to orbit, right-drag to pan, scroll to zoom
            </div>
          </div>
        </>
      ) : (
        <>
          {selectedSite && (
            <div className="site-popup" role="dialog" aria-label="Selected lunar location">
              <div className="site-popup-header">
                <span className="site-popup-kicker">Selected Location</span>
                <button
                  type="button"
                  className="site-popup-close"
                  onClick={() => setSelectedSite(null)}
                  aria-label="Close popup"
                >
                  ×
                </button>
              </div>
              <div className="site-popup-coords">{selectedSite.label}</div>
              <div className="site-popup-type">
                {selectedSite.characteristics.terrainType}
              </div>
              <div className="site-popup-stats">
                <span>
                  Crater density: {Math.round(selectedSite.characteristics.craterDensity * 100)}%
                </span>
                <span>
                  Roughness: {Math.round(selectedSite.characteristics.roughness * 100)}%
                </span>
              </div>
              <button
                type="button"
                className="generate-button"
                onClick={() => setGeneratedSite(selectedSite)}
              >
                Generate 3D Model
              </button>
            </div>
          )}
          <button
            type="button"
            className={`map-button${mapOpen ? " is-active" : ""}`}
            onClick={() => setMapOpen((open) => !open)}
            aria-pressed={mapOpen}
          >
            Map
          </button>
        </>
      )}

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
