import { useEffect, useState } from "react";
import * as THREE from "three";
import { useTexture } from "@react-three/drei";
import Camera from "./Camera.jsx";
import HexGrid from "./HexGrid.jsx";
import EarthAnalogMap from "./EarthAnalogMap.jsx";
import lunarLocations from "../data/lunar-locations.js";
import lunarDataUrl from "../data/lunar-tile-data.json?url";

const GEOMETRY = new THREE.SphereGeometry(1, 128, 64);

function formatCoordinate(value, positive, negative) {
    return `${Math.abs(value).toFixed(6)}° ${value >= 0 ? positive : negative}`;
}

function MoonSurface({
    gridVisible,
    onTileSelect,
    textureName,
    highlightLocation,
}) {
    const texture = useTexture(`/textures/${textureName}`, (loadedTexture) => {
        loadedTexture.anisotropy = 4;
        loadedTexture.colorSpace = THREE.SRGBColorSpace;
        loadedTexture.wrapS = THREE.RepeatWrapping;
        loadedTexture.wrapT = THREE.ClampToEdgeWrapping;
        loadedTexture.minFilter = THREE.LinearMipmapLinearFilter;
    });

    return (
        <>
            <mesh geometry={GEOMETRY}>
                <meshStandardMaterial
                    map={texture}
                    roughness={0.92}
                    metalness={0}
                    envMapIntensity={0.2}
                />
            </mesh>
            <HexGrid
                visible={gridVisible}
                onTileSelect={onTileSelect}
                highlightLocation={highlightLocation}
            />
        </>
    );
}

function Moon() {
    const [mapOpen, setMapOpen] = useState(false);
    const [bright, setBright] = useState(true);
    const [gridVisible, setGridVisible] = useState(false);
    const [surfaceMode, setSurfaceMode] = useState("physical");
    const [lunarData, setLunarData] = useState(null);
    const [selectedTileId, setSelectedTileId] = useState(null);
    const [selectedLocation, setSelectedLocation] = useState(null);
    const [focusRequest, setFocusRequest] = useState(0);
    const [dataError, setDataError] = useState(null);
    const handleTileSelect = (tileId, isManualSelection = false) => {
        setSelectedTileId(tileId);
        if (isManualSelection) setSelectedLocation(null);
    };

    useEffect(() => {
        if (!gridVisible || lunarData) return undefined;
        let active = true;
        fetch(lunarDataUrl)
            .then((response) => {
                if (!response.ok) {
                    throw new Error(`Elevation data request failed: ${response.status}`);
                }
                return response.json();
            })
            .then((data) => {
                if (active) setLunarData(data);
            })
            .catch((error) => {
                if (active) setDataError(error.message);
            });
        return () => {
            active = false;
        };
    }, [gridVisible, lunarData]);

    const selectedTile = lunarData?.tiles?.[selectedTileId] ?? null;

    return (
        <main className="viewer">
            {!mapOpen && (
                <>
                    <Camera
                        bright={bright}
                        focus={selectedLocation}
                        focusRequest={focusRequest}
                    >
                        <MoonSurface
                            gridVisible={gridVisible}
                            onTileSelect={handleTileSelect}
                            highlightLocation={selectedLocation}
                            textureName={
                                surfaceMode === "physical"
                                    ? "physical.jpg"
                                    : "displacement.jpg"
                            }
                        />
                    </Camera>
                    {gridVisible && (
                        <aside className="tile-panel" aria-live="polite">
                            {dataError && (
                                <p className="tile-panel-error">{dataError}</p>
                            )}
                            {!lunarData && !dataError && <p>Loading tile data…</p>}
                            {selectedTile && (
                                <>
                                    <h2>Tile Information</h2>
                                    <p className="tile-panel-coordinates">
                                        {formatCoordinate(
                                            selectedTile.latitude,
                                            "N",
                                            "S",
                                        )}
                                        ,{" "}
                                        {formatCoordinate(
                                            selectedTile.longitude,
                                            "E",
                                            "W",
                                        )}
                                    </p>
                                    <dl>
                                        <div>
                                            <dt>Surface material</dt>
                                            <dd>
                                                {selectedTile.elevation
                                                    .averageElevation < 0
                                                    ? "Basaltic / gravel-like"
                                                    : "Anorthositic / highland-like"}
                                            </dd>
                                        </div>
                                        {Object.entries(
                                            selectedTile.elevation,
                                        ).map(([key, value]) => (
                                            <div key={key}>
                                                <dt>
                                                    {key
                                                        .replace(
                                                            /([A-Z])/g,
                                                            " $1",
                                                        )
                                                        .replace(
                                                            /^./,
                                                            (letter) =>
                                                                letter.toUpperCase(),
                                                        )}
                                                </dt>
                                                <dd>
                                                    {value === null
                                                        ? "—"
                                                        : `${value}${key.includes("Slope") ? "°" : " m"}`}
                                                </dd>
                                            </div>
                                        ))}
                                    </dl>
                                </>
                            )}
                        </aside>
                    )}
                    <aside
                        className="location-bar"
                        aria-label="Lunar landing locations"
                    >
                <div className="location-bar-heading">
                    <p className="location-bar-title">Landings and prospects</p>
                </div>
                <div className="location-list">
                    {lunarLocations.map((location) => {
                        const selected = selectedLocation?.id === location.id;
                        return (
                            <button
                                type="button"
                                className={`location-option${selected ? " is-selected" : ""}`}
                                key={location.id}
                                onClick={() => {
                                    setSelectedLocation(location);
                                    setGridVisible(true);
                                    setFocusRequest((request) => request + 1);
                                }}
                                aria-pressed={selected}
                            >
                                <span className="location-option-main">
                                    <strong>{location.name}</strong>
                                    <small>{location.date}</small>
                                </span>
                                <span className="location-option-type">
                                    {location.type}
                                    {location.approximate ? " · approximate" : ""}
                                </span>
                            </button>
                        );
                    })}
                </div>
                    </aside>
                </>
            )}
            {mapOpen && <EarthAnalogMap selectedTile={selectedTile} />}
            <button
                type="button"
                className={`map-button${mapOpen ? " is-active" : ""}`}
                onClick={() => setMapOpen((open) => !open)}
                aria-pressed={mapOpen}
                title="Identify Analogs"
            >
                {mapOpen ? "Back to Moon" : "Identify Analogs"}
            </button>
            {!mapOpen && <div className="left-controls">
                <button
                    type="button"
                    className={`surface-button${surfaceMode === "displacement" ? " is-displacement" : ""}`}
                    onClick={() =>
                        setSurfaceMode((mode) =>
                            mode === "physical" ? "displacement" : "physical",
                        )
                    }
                    aria-pressed={surfaceMode === "displacement"}
                    aria-label={
                        surfaceMode === "physical"
                            ? "Show displacement texture"
                            : "Show physical texture"
                    }
                    title={
                        surfaceMode === "physical"
                            ? "Show displacement texture"
                            : "Show physical texture"
                    }
                >
                    <svg
                        className="surface-icon"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                    >
                        <path d="M4 7.5 12 4l8 3.5L12 11 4 7.5Zm0 4.5 8 3.5 8-3.5M4 16.5l8 3.5 8-3.5" />
                    </svg>
                </button>
                <button
                    type="button"
                    className={`light-button${bright ? " is-bright" : ""}`}
                    onClick={() => setBright((on) => !on)}
                    aria-pressed={bright}
                    aria-label={bright ? "Switch to dark lighting" : "Switch to bright lighting"}
                    title={bright ? "Switch to dark lighting" : "Switch to bright lighting"}
                >
                    <svg className="light-icon" viewBox="0 0 24 24" aria-hidden="true">
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
                <button
                    type="button"
                    className={`grid-button${gridVisible ? " is-active" : ""}`}
                    onClick={() => setGridVisible((visible) => !visible)}
                    aria-pressed={gridVisible}
                    aria-label={gridVisible ? "Hide hex grid" : "Show hex grid"}
                    title={gridVisible ? "Hide hex grid" : "Show hex grid"}
                >
                    <svg className="grid-icon" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="m7 4 5-2 5 2v5l-5 2-5-2V4Zm0 11 5-2 5 2v5l-5 2-5-2v-5ZM2 7l5-2m10 0 5 2M2 17l5-2m10 0 5 2M12 11v2" />
                    </svg>
                </button>
            </div>}
        </main>
    );
}

export default Moon;
