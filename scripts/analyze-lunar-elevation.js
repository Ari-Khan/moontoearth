import { readFile, writeFile } from "node:fs/promises";
import * as THREE from "three";
import { fromFile } from "geotiff";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

const GRID_RADIUS = 1.01;
const ICOSAHEDRON_DETAIL = 85;
const MOON_RADIUS_KM = 1737.4;
const SOURCE_ELEVATION_UNIT = "kilometers";
const OUTPUT_ELEVATION_UNIT = "meters";
const COORDINATE_FILE = "src/data/lunar-tile-coordinates.json";
const OUTPUT_FILE = "src/data/lunar-tile-data.json";
const TIFF_FILE = "public/textures/ldem_16.tif";

const degrees = 180 / Math.PI;
const radians = Math.PI / 180;

function wrapLongitude(longitude) {
    let wrapped = longitude;
    while (wrapped < -180) wrapped += 360;
    while (wrapped >= 180) wrapped -= 360;
    return wrapped;
}

function vectorFromCoordinates(latitude, longitude) {
    const lat = latitude * radians;
    const lon = longitude * radians;
    return new THREE.Vector3(
        Math.cos(lat) * Math.cos(lon),
        Math.sin(lat),
        -Math.cos(lat) * Math.sin(lon),
    );
}

function pointInCell(point, polygon, center) {
    const tangent = new THREE.Vector3(0, 1, 0);
    if (Math.abs(center.dot(tangent)) > 0.9) tangent.set(1, 0, 0);
    tangent
        .addScaledVector(center, -center.dot(tangent))
        .normalize();
    const bitangent = new THREE.Vector3().crossVectors(center, tangent);
    const project = (value) => {
        const denominator = Math.max(value.dot(center), 1e-8);
        return {
            x: value.dot(tangent) / denominator,
            y: value.dot(bitangent) / denominator,
        };
    };
    const projectedPoint = project(point);
    const projectedPolygon = polygon.map(project);
    let inside = false;

    for (let index = 0, previous = projectedPolygon.length - 1; index < projectedPolygon.length; previous = index, index += 1) {
        const current = projectedPolygon[index];
        const prior = projectedPolygon[previous];
        const crossesRay =
            current.y > projectedPoint.y !== prior.y > projectedPoint.y;
        if (
            crossesRay &&
            projectedPoint.x <
                ((prior.x - current.x) * (projectedPoint.y - current.y)) /
                    (prior.y - current.y) +
                    current.x
        ) {
            inside = !inside;
        }
    }
    return inside;
}

function weightedPercentile(sortedSamples, fraction, totalWeight) {
    const target = totalWeight * fraction;
    let accumulated = 0;
    for (const sample of sortedSamples) {
        accumulated += sample.weight;
        if (accumulated >= target) return sample.value;
    }
    return sortedSamples.at(-1).value;
}

function round(value, digits = 3) {
    return Number(value.toFixed(digits));
}

function buildTilePolygons() {
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
                new THREE.Vector3().fromBufferAttribute(positions, vertexIndex),
            );
        });
        center.normalize();
        const faceIndex = face / 3;
        faceCenters.push(center);
        vertexIndices.forEach((vertexIndex) => {
            facesByVertex[vertexIndex].push(faceIndex);
        });
    }

    const tiles = facesByVertex.map((faceIndices, tileId) => {
        const center = new THREE.Vector3()
            .fromBufferAttribute(positions, tileId)
            .normalize();
        const tangent = new THREE.Vector3(0, 1, 0);
        if (Math.abs(center.dot(tangent)) > 0.9) tangent.set(1, 0, 0);
        tangent
            .addScaledVector(center, -center.dot(tangent))
            .normalize();
        const bitangent = new THREE.Vector3().crossVectors(center, tangent);
        const sortedFaces = faceIndices
            .map((faceIndex) => ({ faceIndex, point: faceCenters[faceIndex] }))
            .sort((a, b) => {
                const angleA = Math.atan2(
                    a.point.dot(bitangent),
                    a.point.dot(tangent),
                );
                const angleB = Math.atan2(
                    b.point.dot(bitangent),
                    b.point.dot(tangent),
                );
                return angleA - angleB;
            });
        const polygon = sortedFaces.map(({ point }) => point.clone());
        return { tileId, center, polygon };
    });

    source.dispose();
    return tiles;
}

function collectTileSamples(tile, raster, width, height, coordinate) {
    const polygonCoordinates = tile.polygon.map((point) => ({
        latitude: Math.asin(point.y) * degrees,
        longitude: wrapLongitude(
            Math.atan2(-point.z, point.x) * degrees,
        ),
    }));
    const latitudeMin = Math.min(
        ...polygonCoordinates.map(({ latitude }) => latitude),
    );
    const latitudeMax = Math.max(
        ...polygonCoordinates.map(({ latitude }) => latitude),
    );
    const longitudeOffsets = polygonCoordinates.map(({ longitude }) =>
        wrapLongitude(longitude - coordinate.longitude),
    );
    const longitudeMin = coordinate.longitude + Math.min(...longitudeOffsets);
    const longitudeMax = coordinate.longitude + Math.max(...longitudeOffsets);
    const rowStart = Math.max(
        0,
        Math.floor(((90 - latitudeMax) / 180) * height) - 1,
    );
    const rowEnd = Math.min(
        height - 1,
        Math.ceil(((90 - latitudeMin) / 180) * height) + 1,
    );
    const columnStart = Math.floor(((longitudeMin + 180) / 360) * width) - 1;
    const columnEnd = Math.ceil(((longitudeMax + 180) / 360) * width) + 1;
    const samples = [];

    for (let row = rowStart; row <= rowEnd; row += 1) {
        const latitude = 90 - ((row + 0.5) / height) * 180;
        for (let column = columnStart; column <= columnEnd; column += 1) {
            const wrappedColumn = ((column % width) + width) % width;
            const longitude = -180 + ((wrappedColumn + 0.5) / width) * 360;
            const point = vectorFromCoordinates(latitude, longitude);
            if (!pointInCell(point, tile.polygon, tile.center)) continue;
            const value = raster[row * width + wrappedColumn];
            if (Number.isFinite(value)) {
                samples.push({
                    row,
                    column: wrappedColumn,
                    latitude,
                    longitude,
                    value,
                });
            }
        }
    }

    return samples;
}

function calculateMetrics(samples, raster, width, height) {
    const weightedSamples = samples.map((sample) => ({
        value: sample.value,
        weight: Math.max(Math.cos(sample.latitude * radians), 1e-8),
    }));
    const sortedSamples = [...weightedSamples].sort(
        (a, b) => a.value - b.value,
    );
    const totalWeight = weightedSamples.reduce(
        (total, sample) => total + sample.weight,
        0,
    );
    const meanKm =
        weightedSamples.reduce(
            (total, sample) => total + sample.value * sample.weight,
            0,
        ) / totalWeight;
    const varianceKm2 =
        weightedSamples.reduce(
            (total, sample) =>
                total + (sample.value - meanKm) ** 2 * sample.weight,
            0,
        ) / totalWeight;
    const averageAbsoluteDeviationKm =
        weightedSamples.reduce(
            (total, sample) =>
                total + Math.abs(sample.value - meanKm) * sample.weight,
            0,
        ) / totalWeight;
    const slopeDegrees = [];
    const sampleKeys = new Set(
        samples.map(({ row, column }) => `${row}:${column}`),
    );

    for (const sample of samples) {
        for (const [rowOffset, columnOffset] of [[0, 1], [1, 0]]) {
            const neighborRow = sample.row + rowOffset;
            const neighborColumn = (sample.column + columnOffset) % width;
            if (
                neighborRow >= height ||
                !sampleKeys.has(`${neighborRow}:${neighborColumn}`)
            ) {
                continue;
            }
            const neighborValue = raster[neighborRow * width + neighborColumn];
            const latitude = sample.latitude * radians;
            const horizontalDistanceKm =
                MOON_RADIUS_KM *
                Math.cos(latitude) *
                ((360 / width) * radians);
            const verticalDistanceKm =
                MOON_RADIUS_KM * ((180 / height) * radians);
            const distanceKm = Math.hypot(
                rowOffset * verticalDistanceKm,
                columnOffset * horizontalDistanceKm,
            );
            slopeDegrees.push(
                {
                    value:
                        Math.atan2(
                            Math.abs(neighborValue - sample.value),
                            distanceKm,
                        ) * degrees,
                    weight: Math.max(
                        Math.cos(sample.latitude * radians),
                        1e-8,
                    ),
                },
            );
        }
    }

    const toMeters = (value) => value * 1000;
    return {
        sampleCount: samples.length,
        minimumElevation: round(toMeters(sortedSamples[0].value)),
        maximumElevation: round(toMeters(sortedSamples.at(-1).value)),
        elevationRange: round(
            toMeters(sortedSamples.at(-1).value - sortedSamples[0].value),
        ),
        averageElevation: round(toMeters(meanKm)),
        medianElevation: round(
            toMeters(weightedPercentile(sortedSamples, 0.5, totalWeight)),
        ),
        interquartileRange: round(
            toMeters(
                weightedPercentile(sortedSamples, 0.75, totalWeight) -
                    weightedPercentile(sortedSamples, 0.25, totalWeight),
            ),
        ),
        averageAbsoluteDeviation: round(toMeters(averageAbsoluteDeviationKm)),
        standardDeviation: round(toMeters(Math.sqrt(varianceKm2))),
        meanSlopeDegrees: slopeDegrees.length
            ? round(
                  slopeDegrees.reduce(
                      (total, sample) => total + sample.value * sample.weight,
                      0,
                  ) /
                      slopeDegrees.reduce(
                          (total, sample) => total + sample.weight,
                          0,
                      ),
                  4,
              )
            : null,
        maximumSlopeDegrees: slopeDegrees.length
            ? round(
                  Math.max(...slopeDegrees.map((sample) => sample.value)),
                  4,
              )
            : null,
    };
}

const coordinateData = JSON.parse(await readFile(COORDINATE_FILE, "utf8"));
const tilePolygons = buildTilePolygons();
if (tilePolygons.length !== coordinateData.tiles.length) {
    throw new Error("Tile geometry and coordinate data have different lengths.");
}

const tiff = await fromFile(TIFF_FILE);
const image = await tiff.getImage();
const width = image.getWidth();
const height = image.getHeight();
const raster = await image.readRasters({ interleave: true });
const tileData = [];

for (let index = 0; index < tilePolygons.length; index += 1) {
    const tile = tilePolygons[index];
    const coordinate = coordinateData.tiles[index];
    const samples = collectTileSamples(
        tile,
        raster,
        width,
        height,
        coordinate,
    );
    if (samples.length === 0) {
        throw new Error(`Tile ${index} has no elevation samples.`);
    }
    tileData.push({
        tileId: coordinate.tileId,
        latitude: coordinate.latitude,
        longitude: coordinate.longitude,
        unitVector: coordinate.unitVector,
        vertexCount: coordinate.vertexCount,
        elevation: calculateMetrics(samples, raster, width, height),
    });
    if ((index + 1) % 5000 === 0) {
        console.log(`Analyzed ${index + 1}/${tilePolygons.length} tiles`);
    }
}

await writeFile(
    OUTPUT_FILE,
    `${JSON.stringify(
        {
            coordinateSystem: coordinateData.coordinateSystem,
            source: {
                file: TIFF_FILE,
                width,
                height,
                projection: "equirectangular",
                sourceElevationUnit: SOURCE_ELEVATION_UNIT,
                outputElevationUnit: OUTPUT_ELEVATION_UNIT,
                moonRadiusKm: MOON_RADIUS_KM,
            },
            gridRadius: GRID_RADIUS,
            icosahedronDetail: ICOSAHEDRON_DETAIL,
            tileCount: tileData.length,
            tiles: tileData,
        },
        null,
        2,
    )}\n`,
);

console.log(`Wrote ${tileData.length} tiles to ${OUTPUT_FILE}`);
