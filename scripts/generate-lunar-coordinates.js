import { mkdir, writeFile } from "node:fs/promises";
import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

const GRID_RADIUS = 1.01;
const ICOSAHEDRON_DETAIL = 85;

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

    let longitude = Math.atan2(-center.z, center.x) * (180 / Math.PI);
    if (longitude < -180) longitude += 360;

    return {
        tileId,
        latitude: Number((Math.asin(center.y) * (180 / Math.PI)).toFixed(12)),
        longitude: Number(longitude.toFixed(12)),
        unitVector: {
            x: Number(center.x.toFixed(15)),
            y: Number(center.y.toFixed(15)),
            z: Number(center.z.toFixed(15)),
        },
        vertexCount: faceIndices.length,
    };
});

await mkdir("src/data", { recursive: true });
await writeFile(
    "src/data/lunar-tile-coordinates.json",
    `${JSON.stringify(
        {
            coordinateSystem: {
                longitude: "degrees, east-positive, range [-180, 180)",
                latitude: "degrees, north-positive, range [-90, 90]",
                longitudeZero: "texture center u=0.5 / lunar longitude 0 degrees",
                longitudeRange: "texture u=0 is -180 degrees; u=1 is +180 degrees",
                latitudeZero: "lunar equator / Three.js XZ plane",
                latitudePositive: "Three.js +Y axis / texture v decreases",
            },
            gridRadius: GRID_RADIUS,
            icosahedronDetail: ICOSAHEDRON_DETAIL,
            tileCount: tiles.length,
            tiles,
        },
        null,
        2,
    )}\n`,
);

source.dispose();
