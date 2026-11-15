import { useCallback, useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { useTexture } from "@react-three/drei";
import Camera from "./Camera.jsx";
import { createGeodesicGrid } from "./HexGrid.jsx";
import AnalogExplorer from "./AnalogExplorer.jsx";
import earthScienceDataUrl from "../data/earth-tile-science-data.json?url";
import earthTileDataUrl from "../data/earth-tile-data.json?url";

const EARTH_GRID_DETAIL = 100;
const EARTH_GEOMETRY = new THREE.SphereGeometry(1, 128, 64);
const MAX_BLUE_FRACTION = 0.5;
const MAX_GREEN_FRACTION = 0.3;

function isBlue(red, green, blue) {
    return blue > red * 1.08 && blue > green * 0.98;
}

function isGreen(red, green, blue) {
    return green > red * 1.08 && green > blue * 0.82 && green > 55;
}

function terrainLevel({
    meanSlopeDegrees,
    reliefM,
    standardDeviation,
    roughnessStdDevM,
    maximumSlopeDegrees,
}) {
    const metrics = [
        meanSlopeDegrees,
        reliefM,
        standardDeviation ?? roughnessStdDevM,
        maximumSlopeDegrees ?? meanSlopeDegrees,
    ];
    const lowerQuartile = [1.6349, 777, 151.029, 10.215];
    const median = [3.2859, 1560, 340.348, 16.6337];
    const upperQuartile = [4.864, 2442.5, 583.126, 22.4692];
    const ninetiethPercentile = [6.2683, 3278, 854.757, 27.4117];
    const extremeThreshold = [10, 5000, 1400, 45];
    const exceeds = (threshold) =>
        metrics.filter((value, index) => value >= threshold[index]).length;

    if (metrics[0] >= extremeThreshold[0] && metrics[1] >= extremeThreshold[1]) {
        return "Extreme mountainous";
    }
    if (exceeds(ninetiethPercentile) > 0) return "Mountainous";
    if (exceeds(upperQuartile) > 0) return "Rugged";
    if (exceeds(median) > 0) return "Hilly";
    if (exceeds(lowerQuartile) > 0) return "Rolling";
    return "Flat";
}

function relativeSimilarity(first, second, scale) {
    return Math.max(0, 1 - Math.abs(first - second) / Math.max(scale, 1));
}

function terrainMatchTone(selected, analog) {
    const levels = [
        "Flat",
        "Rolling",
        "Hilly",
        "Rugged",
        "Mountainous",
        "Extreme mountainous",
    ];
    const distance = Math.abs(levels.indexOf(selected) - levels.indexOf(analog));
    return distance <= 1 ? "green" : distance === 2 ? "yellow" : "red";
}

function terrainCompatibility(selected, analog) {
    const levels = [
        "Flat",
        "Rolling",
        "Hilly",
        "Rugged",
        "Mountainous",
        "Extreme mountainous",
    ];
    const distance = Math.abs(levels.indexOf(selected) - levels.indexOf(analog));
    if (distance === 0) return 1;
    if (distance === 1) return 0.8;
    if (distance === 2) return 0.45;
    return 0.05;
}

function numericMatchTone(similarity) {
    return similarity >= 0.7 ? "green" : similarity >= 0.4 ? "yellow" : "red";
}

function isNorthAmerica(latitude, longitude) {
    return (
        latitude >= 7 &&
        latitude <= 85 &&
        longitude >= -170 &&
        longitude <= -50
    );
}

function isInternationalLocation(center) {
    return (
        center.latitude > -60 &&
        !isNorthAmerica(center.latitude, center.longitude)
    );
}

function scoreAnalog(tile, lunarTile) {
    const terrain = tile.data?.elevation;
    if (!terrain || !lunarTile?.elevation) return null;
    const lunar = lunarTile.elevation;
    const slopeScore = relativeSimilarity(
        terrain.meanSlopeDegrees,
        lunar.meanSlopeDegrees,
        Math.max(lunar.maximumSlopeDegrees, 5),
    );
    const reliefScore = relativeSimilarity(
        terrain.reliefM,
        lunar.elevationRange,
        Math.max(lunar.elevationRange, 100),
    );
    const roughnessScore = relativeSimilarity(
        terrain.roughnessStdDevM,
        lunar.standardDeviation,
        Math.max(lunar.standardDeviation, 100),
    );
    const selectedTerrain = terrainLevel(lunar);
    const analogTerrain = terrainLevel(terrain);
    const terrainScore =
        (slopeScore * 0.55 + reliefScore * 0.25 + roughnessScore * 0.2) *
        terrainCompatibility(selectedTerrain, analogTerrain);
    const internationalBonus = isInternationalLocation(tile.center) ? 2.4 : 0;
    const score = Math.min(1, terrainScore * (1 + internationalBonus));
    const climate = tile.data.climate;
    const biodiversity = tile.data.biodiversity;
    const temperatureRange =
        climate &&
        climate.warmestMonthTemperatureC - climate.coldestMonthTemperatureC;
    const benefits = [
        tile.data.engineering &&
        tile.data.engineering.traversabilityIndex >= 0.65
            ? "higher mobility potential"
            : null,
        climate && climate.precipitationMmDay <= 1
            ? "low precipitation and erosion risk"
            : null,
        climate && climate.windSpeedMPerS < 5
            ? "lower wind exposure"
            : null,
        climate && temperatureRange < 20
            ? "milder seasonal temperature range"
            : null,
        biodiversity && biodiversity.occurrenceCount > 0
            ? `${biodiversity.occurrenceCount} biodiversity observations`
            : null,
        tile.data.geology?.lithology
            ? `rock: ${tile.data.geology.lithology}`
            : null,
    ].filter(Boolean);
    const cons = [
    ].filter(Boolean);
    const climateOpportunities = [
        climate && climate.meanTemperatureC < 0
            ? "cold-environment testing opportunity"
            : null,
        climate && climate.meanTemperatureC > 25
            ? "heat-environment testing opportunity"
            : null,
        climate && temperatureRange >= 30
            ? "seasonal-extremes testing opportunity"
            : null,
        climate && climate.precipitationMmDay >= 3
            ? "water and weathering testing opportunity"
            : null,
        climate && climate.windSpeedMPerS >= 8
            ? "wind and dust testing opportunity"
            : null,
    ].filter(Boolean);
    return {
        ...tile,
        score,
        targetTerrainLabel: selectedTerrain,
        terrainLabel: analogTerrain,
        fieldMatches: [
            {
                label: "Terrain",
                selected: terrainLevel(lunar),
                analog: terrainLevel(terrain),
                tone: terrainMatchTone(
                    terrainLevel(lunar),
                    terrainLevel(terrain),
                ),
            },
            {
                label: "Slope",
                selected: `${lunar.meanSlopeDegrees.toFixed(1)}°`,
                analog: `${terrain.meanSlopeDegrees.toFixed(1)}°`,
                tone: numericMatchTone(slopeScore),
            },
            {
                label: "Relief",
                selected: `${lunar.elevationRange.toFixed(0)} m`,
                analog: `${terrain.reliefM.toFixed(0)} m`,
                tone: numericMatchTone(reliefScore),
            },
            {
                label: "Roughness",
                selected: `${lunar.standardDeviation.toFixed(0)} m`,
                analog: `${terrain.roughnessStdDevM.toFixed(0)} m`,
                tone: numericMatchTone(roughnessScore),
            },
        ],
        benefits: benefits.length ? benefits : ["Topographic similarity"],
        cons,
        climateOpportunities,
    };
}

function selectDiverseAnalogs(scoredTiles, count) {
    const selected = [];
    const remaining = [...scoredTiles];
    while (selected.length < count && remaining.length) {
        const nextIndex = remaining.findIndex((candidate) =>
            selected.every(
                (chosen) =>
                    candidate.terrainLabel !== chosen.terrainLabel ||
                    candidate.benefits.join("|") !== chosen.benefits.join("|") ||
                    candidate.cons.join("|") !== chosen.cons.join("|"),
            ),
        );
        const index = nextIndex === -1 ? 0 : nextIndex;
        selected.push(remaining.splice(index, 1)[0]);
    }
    return selected;
}

function FieldMatchGroup({ fields, tone }) {
    const matches = fields.filter((field) => field.tone === tone);
    if (!matches.length) return null;
    return (
        <span className={`analog-option-details is-${tone}`}>
            {matches.map((field) => (
                <span
                    className={`analog-option-match is-${field.tone}`}
                    key={field.label}
                >
                    {tone === "green" ? "+" : tone === "yellow" ? "≈" : "−"}{" "}
                    {field.label} · selected: {field.selected} · analog:{" "}
                    {field.analog}
                </span>
            ))}
        </span>
    );
}

function getRegionalPlaceName(address) {
    const broadRegion = [
        address.natural,
        address.desert,
        address.region,
        address.island,
        address.island_name,
        address.island_group,
        address.county,
        address.continent,
    ].find(Boolean);
    const stateOrProvince =
        address.state || address.province || address.state_district;
    const placeName = [broadRegion, stateOrProvince]
        .filter(Boolean)
        .join(", ");
    if (placeName) return placeName;
    if (address.continent?.toLowerCase().includes("antarctica")) {
        return "Antarctica";
    }
    return "";
}

function lunarSurfaceMaterial(elevation) {
    return elevation.averageElevation < 0
        ? "Basaltic / gravel-like"
        : "Anorthositic / highland-like";
}

async function reverseGeocode(analog, signal) {
    const query = new URLSearchParams({
        format: "jsonv2",
        zoom: "10",
        addressdetails: "1",
        lat: String(analog.center.latitude),
        lon: String(analog.center.longitude),
    });
    const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?${query}`,
        {
            headers: { accept: "application/json" },
            signal,
        },
    );
    if (!response.ok) {
        throw new Error(`Reverse geocoding failed: ${response.status}`);
    }
    const payload = await response.json();
    return (
        getRegionalPlaceName(payload.address ?? {}) ||
        "Antarctica"
    );
}

function getTexturePixels(image) {
    const canvas = document.createElement("canvas");
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(image, 0, 0);
    return {
        width,
        height,
        pixels: context.getImageData(0, 0, width, height).data,
    };
}

function getSurfaceFractions(cell, texturePixels) {
    if (!texturePixels) return null;
    const samples = [
        ...cell.points,
        cell.points.reduce(
            (center, point) => center.add(point),
            new THREE.Vector3(),
        ),
    ];
    let blueSamples = 0;
    let greenSamples = 0;
    samples.forEach((point) => {
        const normalized = point.clone().normalize();
        const longitude = Math.atan2(-normalized.z, normalized.x);
        const latitude = Math.asin(normalized.y);
        const x = Math.min(
            texturePixels.width - 1,
            Math.max(
                0,
                Math.floor(
                    (longitude / (Math.PI * 2) + 0.5) * texturePixels.width,
                ),
            ),
        );
        const y = Math.min(
            texturePixels.height - 1,
            Math.max(
                0,
                Math.floor(
                    (0.5 - latitude / Math.PI) * texturePixels.height,
                ),
            ),
        );
        const pixelIndex = (y * texturePixels.width + x) * 4;
        const red = texturePixels.pixels[pixelIndex];
        const green = texturePixels.pixels[pixelIndex + 1];
        const blue = texturePixels.pixels[pixelIndex + 2];
        if (isBlue(red, green, blue)) blueSamples += 1;
        if (isGreen(red, green, blue)) greenSamples += 1;
    });
    return {
        blueFraction: blueSamples / samples.length,
        greenFraction: greenSamples / samples.length,
    };
}

function createLandLineGeometry(cells, landCellIds) {
    const positions = [];
    cells.forEach((cell, cellIndex) => {
        if (!landCellIds.has(cellIndex)) return;
        cell.points.forEach((point, pointIndex) => {
            positions.push(
                ...point.toArray(),
                ...cell.points[(pointIndex + 1) % cell.points.length].toArray(),
            );
        });
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(positions, 3),
    );
    return geometry;
}

function createCellSurfaceGeometry(cell) {
    const positions = cell.points.flatMap((point) => point.toArray());
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(positions, 3),
    );
    const indices = [];
    for (let index = 1; index < cell.points.length - 1; index += 1) {
        indices.push(0, index, index + 1);
    }
    geometry.setIndex(indices);
    return geometry;
}

function EarthHexGrid({
    textureImage,
    onReady,
    onLandTilesReady,
    selectedCellId,
}) {
    const grid = useMemo(
        () => createGeodesicGrid(EARTH_GRID_DETAIL, false),
        [],
    );
    const texturePixels = useMemo(
        () => getTexturePixels(textureImage),
        [textureImage],
    );
    const landCellIds = useMemo(() => {
        const ids = new Set();
        grid.cells.forEach((cell, cellIndex) => {
            const fractions = getSurfaceFractions(cell, texturePixels);
            if (
                fractions &&
                fractions.blueFraction <= MAX_BLUE_FRACTION &&
                fractions.greenFraction <= MAX_GREEN_FRACTION
            ) {
                ids.add(cellIndex);
            }
        });
        return ids;
    }, [grid.cells, texturePixels]);
    const lineGeometry = useMemo(
        () => createLandLineGeometry(grid.cells, landCellIds),
        [grid.cells, landCellIds],
    );
    const selectedCell = selectedCellId == null ? null : grid.cells[selectedCellId];
    const selectedSurfaceGeometry = useMemo(
        () => (selectedCell ? createCellSurfaceGeometry(selectedCell) : null),
        [selectedCell],
    );

    useEffect(() => {
        onReady();
        onLandTilesReady(landCellIds);
    }, [landCellIds, lineGeometry, onLandTilesReady, onReady]);

    return (
        <>
            <lineSegments geometry={lineGeometry} renderOrder={3}>
                <lineBasicMaterial
                    color="#ffffff"
                    transparent
                    opacity={0.62}
                    depthWrite={false}
                />
            </lineSegments>
            {selectedSurfaceGeometry && (
                <mesh geometry={selectedSurfaceGeometry} renderOrder={5}>
                    <meshBasicMaterial
                        color="#ff4949"
                        transparent
                        opacity={0.5}
                        depthWrite={false}
                        side={THREE.DoubleSide}
                    />
                </mesh>
            )}
        </>
    );
}

function EarthSurface({ onReady, onLandTilesReady, selectedCellId }) {
    const texture = useTexture("/textures/earth.jpg", (loadedTexture) => {
        loadedTexture.anisotropy = 4;
        loadedTexture.colorSpace = THREE.SRGBColorSpace;
        loadedTexture.wrapS = THREE.RepeatWrapping;
        loadedTexture.wrapT = THREE.ClampToEdgeWrapping;
        loadedTexture.minFilter = THREE.LinearMipmapLinearFilter;
    });

    return (
        <>
            <mesh geometry={EARTH_GEOMETRY}>
                <meshStandardMaterial
                    map={texture}
                    roughness={0.92}
                    metalness={0}
                />
            </mesh>
            <EarthHexGrid
                textureImage={texture.image}
                onReady={onReady}
                onLandTilesReady={onLandTilesReady}
                selectedCellId={selectedCellId}
            />
        </>
    );
}

function EarthAnalogMap({ selectedTile }) {
    const [surfaceReady, setSurfaceReady] = useState(false);
    const [isVisible, setIsVisible] = useState(false);
    const [scienceData, setScienceData] = useState(null);
    const [webTileIds, setWebTileIds] = useState(null);
    const [renderedTileIds, setRenderedTileIds] = useState(null);
    const [scienceError, setScienceError] = useState(null);
    const [focusedAnalog, setFocusedAnalog] = useState(null);
    const [focusRequest, setFocusRequest] = useState(0);
    const [placeNames, setPlaceNames] = useState({});
    const [explorerOpen, setExplorerOpen] = useState(false);
    const handleSurfaceReady = useCallback(() => {
        setSurfaceReady(true);
    }, []);
    const handleLandTilesReady = useCallback((tileIds) => {
        setRenderedTileIds(tileIds);
    }, []);

    useEffect(() => {
        let active = true;
        Promise.all(
            [earthScienceDataUrl, earthTileDataUrl].map((url) =>
                fetch(url).then((response) => {
                    if (!response.ok) {
                        throw new Error(
                            `Earth data request failed: ${response.status}`,
                        );
                    }
                    return response.json();
                }),
            ),
        )
            .then(([science, earthTiles]) => {
                if (!active) return;
                setScienceData(science);
                setWebTileIds(new Set(earthTiles.tiles.map((tile) => tile.tileId)));
            })
            .catch((error) => {
                if (active) setScienceError(error.message);
            });
        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        if (!surfaceReady) return undefined;
        let firstFrame;
        let secondFrame;
        firstFrame = requestAnimationFrame(() => {
            secondFrame = requestAnimationFrame(() => {
                setIsVisible(true);
            });
        });
        return () => {
            cancelAnimationFrame(firstFrame);
            if (secondFrame) cancelAnimationFrame(secondFrame);
        };
    }, [surfaceReady]);

    const analogs = useMemo(() => {
        if (
            !selectedTile ||
            !scienceData?.tiles ||
            !webTileIds ||
            !renderedTileIds
        ) {
            return [];
        }
        const scoredTiles = scienceData.tiles
            .filter(
                (tile) =>
                    webTileIds.has(tile.tileId) &&
                    renderedTileIds.has(tile.tileId) &&
                    tile.data?.elevation &&
                    tile.data?.climate &&
                    tile.data?.engineering,
            )
            .map((tile) => scoreAnalog(tile, selectedTile))
            .filter(Boolean)
            .sort((first, second) => second.score - first.score);
        return selectDiverseAnalogs(scoredTiles, 5);
    }, [scienceData, selectedTile, webTileIds, renderedTileIds]);
    const activeFocusedAnalog =
        analogs.find((analog) => analog.tileId === focusedAnalog?.tileId) ?? null;

    useEffect(() => {
        const controller = new AbortController();
        let active = true;
        const loadPlaceNames = async () => {
            const resolved = {};
            for (const analog of analogs) {
                try {
                    resolved[analog.tileId] = await reverseGeocode(
                        analog,
                        controller.signal,
                    );
                } catch (error) {
                    if (error.name === "AbortError") return;
                    resolved[analog.tileId] = "Earth location";
                }
                await new Promise((resolve) => setTimeout(resolve, 1100));
            }
            if (active) setPlaceNames(resolved);
        };
        loadPlaceNames();
        return () => {
            active = false;
            controller.abort();
        };
    }, [analogs]);

    return (
        <section className="earth-view" aria-label="Earth analog globe">
            {!explorerOpen && (
                <Camera
                    bright
                    focus={activeFocusedAnalog?.center}
                    focusRequest={focusRequest}
                >
                    <EarthSurface
                        onReady={handleSurfaceReady}
                        onLandTilesReady={handleLandTilesReady}
                        selectedCellId={activeFocusedAnalog?.tileId}
                    />
                </Camera>
            )}
            <div
                className={`earth-loading${isVisible ? " is-complete" : ""}`}
                role="status"
                aria-live="polite"
                aria-hidden={isVisible}
            >
                <span>Loading Earth analogs…</span>
            </div>
            <div className="earth-status">
                <p className="earth-status-kicker">EARTH ANALOGS</p>
                <h2>
                    {selectedTile
                        ? `Compared with lunar tile ${selectedTile.tileId}`
                        : "Select a lunar tile first"}
                </h2>
                <p>
                    Land-only geodesic tiles · detail 100
                    {selectedTile &&
                        ` · ${lunarSurfaceMaterial(selectedTile.elevation)}`}
                </p>
            </div>
            <aside className="location-bar analog-bar" aria-label="Earth analogs">
                <div className="location-bar-heading">
                    <p className="location-bar-title">Top 5 analogs</p>
                </div>
                {scienceError && (
                    <p className="tile-panel-error">{scienceError}</p>
                )}
                {!scienceData && !scienceError && (
                    <p className="analog-empty">Loading science data…</p>
                )}
                {scienceData && !selectedTile && (
                    <p className="analog-empty">
                        Select a lunar tile to compare analogs.
                    </p>
                )}
                {scienceData && selectedTile && !analogs.length && (
                    <p className="analog-empty">
                        No complete science entries are available for this tile.
                    </p>
                )}
                <div className="location-list analog-list">
                    {analogs.map((analog, index) => (
                        <button
                            type="button"
                            className={`location-option${
                                activeFocusedAnalog?.tileId === analog.tileId
                                    ? " is-selected"
                                    : ""
                            }`}
                            key={analog.tileId}
                            onClick={() => {
                                setFocusedAnalog(analog);
                                setFocusRequest((request) => request + 1);
                            }}
                            aria-pressed={activeFocusedAnalog?.tileId === analog.tileId}
                        >
                            <span className="location-option-main">
                                <strong>
                                    {index + 1}.{" "}
                                    {placeNames[analog.tileId] || "Locating region…"}
                                </strong>
                            </span>
                            <span className="location-option-type">
                                {analog.center.latitude.toFixed(2)}°{" "}
                                {analog.center.latitude >= 0 ? "N" : "S"},{" "}
                                {Math.abs(analog.center.longitude).toFixed(2)}°{" "}
                                {analog.center.longitude >= 0 ? "E" : "W"}
                            </span>
                            <FieldMatchGroup
                                fields={analog.fieldMatches}
                                tone="green"
                            />
                            <span className="analog-option-benefit">
                                + {analog.benefits.join(" · ")}
                            </span>
                            <FieldMatchGroup
                                fields={analog.fieldMatches}
                                tone="yellow"
                            />
                            {analog.climateOpportunities.length > 0 && (
                                <span className="analog-option-climate">
                                    ≈{" "}
                                    {analog.climateOpportunities.join(" · ")}
                                </span>
                            )}
                            <FieldMatchGroup
                                fields={analog.fieldMatches}
                                tone="red"
                            />
                            {analog.cons.length > 0 && (
                                <span className="analog-option-con">
                                    − {analog.cons.join(" · ")}
                                </span>
                            )}
                        </button>
                    ))}
                </div>
            </aside>
            {activeFocusedAnalog && (
                <button
                    type="button"
                    className="explore-button"
                    onClick={() => setExplorerOpen(true)}
                >
                    Explore selected analog in 3D
                </button>
            )}
            {explorerOpen && activeFocusedAnalog && (
                <AnalogExplorer
                    analog={activeFocusedAnalog}
                    isAntarctic={
                        placeNames[activeFocusedAnalog.tileId] === "Antarctica"
                    }
                    onClose={() => setExplorerOpen(false)}
                />
            )}
        </section>
    );
}

export default EarthAnalogMap;
