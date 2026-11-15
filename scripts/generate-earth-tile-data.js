import { readFile, writeFile } from "node:fs/promises";
import jpeg from "jpeg-js";
import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

const GRID_RADIUS = 1.01;
const ICOSAHEDRON_DETAIL = 100;
const EARTH_RADIUS_KM = 6371.0088;
const TEXTURE_FILE = "public/textures/earth.jpg";
const OUTPUT_FILE = "src/data/earth-tile-data.json";
const COORDINATE_OUTPUT_FILE = "src/data/earth-tile-coordinates.json";
const MAX_BLUE_FRACTION = 0.5;
const MAX_GREEN_FRACTION = 0.3;
const degrees = 180 / Math.PI;

function round(value, digits = 6) {
    return Number(value.toFixed(digits));
}

function wrapLongitude(longitude) {
    let wrapped = longitude;
    while (wrapped < -180) wrapped += 360;
    while (wrapped >= 180) wrapped -= 360;
    return wrapped;
}

function toCoordinates(point) {
    return {
        latitude: round(Math.asin(point.y) * degrees),
        longitude: round(
            wrapLongitude(Math.atan2(-point.z, point.x) * degrees),
        ),
    };
}

function buildCells() {
    const raw = new THREE.IcosahedronGeometry(1, ICOSAHEDRON_DETAIL);
    raw.deleteAttribute("uv");
    raw.deleteAttribute("normal");
    const source = mergeVertices(raw, 1e-5);
    raw.dispose();

    const positions = source.getAttribute("position");
    const index = source.getIndex();
    const faceCenters = [];
    const facesByVertex = Array.from({ length: positions.count }, () => []);

    for (let face = 0; face < index.count; face += 3) {
        const vertexIndices = [
            index.getX(face),
            index.getX(face + 1),
            index.getX(face + 2),
        ];
        const center = new THREE.Vector3();
        vertexIndices.forEach((vertexIndex) => {
            center.add(
                new THREE.Vector3().fromBufferAttribute(
                    positions,
                    vertexIndex,
                ),
            );
        });
        center.normalize();
        const faceIndex = face / 3;
        faceCenters.push(center);
        vertexIndices.forEach((vertexIndex) => {
            facesByVertex[vertexIndex].push(faceIndex);
        });
    }

    const cells = facesByVertex.map((faceIndices, tileId) => {
        const center = new THREE.Vector3()
            .fromBufferAttribute(positions, tileId)
            .normalize();
        const tangent = new THREE.Vector3(0, 1, 0);
        if (Math.abs(center.dot(tangent)) > 0.9) tangent.set(1, 0, 0);
        tangent
            .addScaledVector(center, -center.dot(tangent))
            .normalize();
        const bitangent = new THREE.Vector3().crossVectors(center, tangent);
        const points = faceIndices
            .map((faceIndex) => ({
                faceIndex,
                point: faceCenters[faceIndex],
            }))
            .sort(
                (a, b) =>
                    Math.atan2(
                        a.point.dot(bitangent),
                        a.point.dot(tangent),
                    ) -
                    Math.atan2(
                        b.point.dot(bitangent),
                        b.point.dot(tangent),
                    ),
            )
            .map(({ point }) => point.clone());

        return { tileId, center, points };
    });

    source.dispose();
    return cells;
}

function textureSample(texture, latitude, longitude) {
    const x = Math.min(
        texture.width - 1,
        Math.max(0, Math.floor(((longitude / 360 + 0.5) * texture.width))),
    );
    const y = Math.min(
        texture.height - 1,
        Math.max(0, Math.floor((0.5 - latitude / 180) * texture.height)),
    );
    const offset = (y * texture.width + x) * 4;
    return [
        texture.data[offset],
        texture.data[offset + 1],
        texture.data[offset + 2],
    ];
}

function isBlue([red, green, blue]) {
    return blue > red * 1.08 && blue > green * 0.98;
}

function isGreen([red, green, blue]) {
    return green > red * 1.08 && green > blue * 0.82 && green > 55;
}

function classifyCell(cell, texture) {
    const samplePoints = [
        cell.center,
        ...cell.points,
        cell.points.reduce(
            (center, point) => center.add(point),
            new THREE.Vector3(),
        ).normalize(),
    ];
    const blueSamples = samplePoints.filter((point) => {
        const { latitude, longitude } = toCoordinates(point);
        return isBlue(textureSample(texture, latitude, longitude));
    }).length;
    const greenSamples = samplePoints.filter((point) => {
        const { latitude, longitude } = toCoordinates(point);
        return isGreen(textureSample(texture, latitude, longitude));
    }).length;
    const blueFraction = blueSamples / samplePoints.length;
    const greenFraction = greenSamples / samplePoints.length;
    return {
        surface:
            blueFraction <= MAX_BLUE_FRACTION &&
            greenFraction <= MAX_GREEN_FRACTION
                ? "land"
                : "excluded",
        blueFraction: round(blueFraction, 3),
        greenFraction: round(greenFraction, 3),
        sampleCount: samplePoints.length,
    };
}

function sphericalTriangleArea(a, b, c) {
    const numerator = Math.abs(
        a.dot(new THREE.Vector3().crossVectors(b, c)),
    );
    const denominator =
        1 + a.dot(b) + b.dot(c) + c.dot(a);
    return 2 * Math.atan2(numerator, denominator);
}

function cellAreaSteradians(points) {
    let area = 0;
    for (let index = 1; index < points.length - 1; index += 1) {
        area += sphericalTriangleArea(points[0], points[index], points[index + 1]);
    }
    return area;
}

function getBounds(points) {
    const coordinates = points.map(toCoordinates);
    return {
        latitudeMin: round(Math.min(...coordinates.map(({ latitude }) => latitude))),
        latitudeMax: round(Math.max(...coordinates.map(({ latitude }) => latitude))),
        longitudeMin: round(
            Math.min(...coordinates.map(({ longitude }) => longitude)),
        ),
        longitudeMax: round(
            Math.max(...coordinates.map(({ longitude }) => longitude)),
        ),
    };
}

function getArgumentValue(name) {
    return argumentsList
        .find((argument) => argument.startsWith(`${name}=`))
        ?.slice(name.length + 1);
}

function annualValue(parameter) {
    return parameter?.ANN ?? parameter?.annual ?? null;
}

async function fetchPowerData(tile) {
    const parameters = [
        "T2M",
        "T2M_MAX",
        "T2M_MIN",
        "ALLSKY_SFC_SW_DWN",
        "WS10M",
        "PRECTOTCORR",
    ].join(",");
    const query = new URLSearchParams({
        parameters,
        community: "AG",
        longitude: String(tile.center.longitude),
        latitude: String(tile.center.latitude),
        format: "JSON",
    });
    const response = await fetch(
        `https://power.larc.nasa.gov/api/temporal/climatology/point?${query}`,
    );
    if (!response.ok) {
        throw new Error(`NASA POWER request failed: ${response.status}`);
    }
    const payload = await response.json();
    const values = payload.properties?.parameter;
    if (!values) throw new Error("NASA POWER response had no parameters.");
    return {
        meanTemperatureC: annualValue(values.T2M),
        maximumTemperatureC: annualValue(values.T2M_MAX),
        minimumTemperatureC: annualValue(values.T2M_MIN),
        solarRadiationKwhM2Day: annualValue(values.ALLSKY_SFC_SW_DWN),
        windSpeedMPerS: annualValue(values.WS10M),
        precipitationMmDay: annualValue(values.PRECTOTCORR),
    };
}

const [, , ...argumentsList] = process.argv;
const outputFile =
    argumentsList.find((argument) => argument.startsWith("--output="))?.slice(9) ??
    OUTPUT_FILE;
const powerEnabled = argumentsList.includes("--power");
const powerLimit = Number(
    getArgumentValue("--power-limit") ?? Number.POSITIVE_INFINITY,
);
const texture = jpeg.decode(await readFile(TEXTURE_FILE), {
    maxMemoryUsageInMB: 1024,
    useTArray: true,
});
const cells = buildCells();
const cellAreaKm2 = (4 * Math.PI * EARTH_RADIUS_KM ** 2) / cells.length;
const tiles = [];

for (const cell of cells) {
    const classification = classifyCell(cell, texture);
    if (classification.surface !== "land") continue;

    const areaSteradians = cellAreaSteradians(cell.points);
    const areaKm2 = areaSteradians * EARTH_RADIUS_KM ** 2;
    const center = toCoordinates(cell.center);
    tiles.push({
        tileId: cell.tileId,
        center,
        bounds: getBounds(cell.points),
        surface: classification,
        geometry: {
            vertexCount: cell.points.length,
            areaKm2: round(areaKm2, 2),
            equivalentWidthKm: round(2 * Math.sqrt(areaKm2 / Math.PI), 2),
            nominalAreaKm2: round(cellAreaKm2, 2),
        },
        data: {},
    });
}

let powerRequests = 0;
let powerFailures = 0;
if (powerEnabled) {
    const limit = Number.isFinite(powerLimit)
        ? Math.min(Math.max(powerLimit, 0), tiles.length)
        : tiles.length;
    for (let index = 0; index < limit; index += 1) {
        try {
            tiles[index].data.nasaPower = await fetchPowerData(tiles[index]);
            powerRequests += 1;
        } catch (error) {
            powerFailures += 1;
            console.warn(
                `Skipped NASA POWER data for tile ${tiles[index].tileId}: ${error.message}`,
            );
        }
        if ((index + 1) % 100 === 0) {
            console.log(`Fetched NASA POWER data for ${index + 1}/${limit} tiles`);
        }
    }
}

await writeFile(
    outputFile,
    `${JSON.stringify(
        {
            version: 1,
            description:
                "Land/shaded Earth cells from the visual geodesic grid. External datasets can enrich each tile's data object.",
            coordinateSystem: {
                latitude: "degrees, north-positive, range [-90, 90]",
                longitude: "degrees, east-positive, range [-180, 180)",
            },
            grid: {
                icosahedronDetail: ICOSAHEDRON_DETAIL,
                gridRadius: GRID_RADIUS,
                totalCellCount: cells.length,
                shadedTileCount: tiles.length,
                nominalCellWidthKm: round(
                    2 * Math.sqrt(cellAreaKm2 / Math.PI),
                    2,
                ),
            },
            tileCount: tiles.length,
            source: {
                image: TEXTURE_FILE,
                classification:
                    "Sampled cell center, vertices, and centroid; excluded cells have more than 50% blue samples or more than 30% green samples.",
                externalData: powerEnabled
                    ? {
                          provider: "NASA POWER",
                          requestsCompleted: powerRequests,
                          requestsFailed: powerFailures,
                          note: "Only requested tiles are enriched; failed fields are omitted.",
                      }
                    : "Not downloaded; unavailable fields are omitted.",
            },
            tiles,
        },
        null,
        2,
    )}\n`,
);

await writeFile(
    COORDINATE_OUTPUT_FILE,
    `${JSON.stringify(
        {
            coordinateSystem: {
                latitude: "degrees, north-positive, range [-90, 90]",
                longitude: "degrees, east-positive, range [-180, 180)",
            },
            grid: {
                icosahedronDetail: ICOSAHEDRON_DETAIL,
                gridRadius: GRID_RADIUS,
                totalCellCount: cells.length,
                shadedTileCount: tiles.length,
            },
            tileCount: tiles.length,
            tiles: tiles.map((tile) => ({
                tileId: tile.tileId,
                latitude: tile.center.latitude,
                longitude: tile.center.longitude,
                bounds: tile.bounds,
            })),
        },
        null,
        2,
    )}\n`,
);

console.log(`Wrote ${tiles.length} shaded Earth tiles to ${outputFile}`);
