import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

const GRID_RADIUS = 1.01;
const ICOSAHEDRON_DETAIL = 85;

function createPolygonGeometry(points) {
    const positions = [];
    points.forEach((point) => positions.push(...point.toArray()));
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(positions, 3),
    );
    const indices = [];
    for (let index = 1; index < points.length - 1; index += 1) {
        indices.push(0, index, index + 1);
    }
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
}

export function createGeodesicGrid(
    detail = ICOSAHEDRON_DETAIL,
    includeHitGeometry = true,
) {
    const raw = new THREE.IcosahedronGeometry(1, detail);
    // UVs/normals differ across the wrap seam and prevent welding
    raw.deleteAttribute("uv");
    raw.deleteAttribute("normal");
    const source = mergeVertices(raw, 1e-5);
    raw.dispose();

    const positions = source.getAttribute("position");
    const index = source.getIndex();
    const faceCenters = [];
    const facesByVertex = Array.from({ length: positions.count }, () => []);
    const edgeKeys = new Set();
    const edgePositions = [];

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

    const cells = [];
    const hitPositions = [];
    const hitIndices = [];
    const hitCellIndices = [];

    facesByVertex.forEach((faceIndices, vertexIndex) => {
        const center = new THREE.Vector3()
            .fromBufferAttribute(positions, vertexIndex)
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
        const points = sortedFaces.map(({ point }) =>
            point.clone().multiplyScalar(GRID_RADIUS),
        );
        const cellIndex = cells.length;
        const vertexOffset = hitPositions.length / 3;

        if (includeHitGeometry) {
            points.forEach((point) => hitPositions.push(...point.toArray()));
            for (
                let pointIndex = 1;
                pointIndex < points.length - 1;
                pointIndex += 1
            ) {
                hitIndices.push(
                    vertexOffset,
                    vertexOffset + pointIndex,
                    vertexOffset + pointIndex + 1,
                );
                hitCellIndices.push(cellIndex);
            }
        }

        sortedFaces.forEach(({ faceIndex }, edgeIndex) => {
            const nextFace =
                sortedFaces[(edgeIndex + 1) % sortedFaces.length].faceIndex;
            const key = [faceIndex, nextFace].sort((a, b) => a - b).join(":");
            if (edgeKeys.has(key)) return;
            edgeKeys.add(key);
            edgePositions.push(
                ...points[edgeIndex].toArray(),
                ...points[(edgeIndex + 1) % points.length].toArray(),
            );
        });

        cells.push({ points });
    });

    source.dispose();

    const hitGeometry = includeHitGeometry ? new THREE.BufferGeometry() : null;
    if (hitGeometry) {
        hitGeometry.setAttribute(
            "position",
            new THREE.Float32BufferAttribute(hitPositions, 3),
        );
        hitGeometry.setIndex(hitIndices);
        hitGeometry.computeVertexNormals();
    }

    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(edgePositions, 3),
    );

    const cellCenters = cells.map(({ points }) =>
        points
            .reduce((center, point) => center.add(point), new THREE.Vector3())
            .normalize(),
    );

    return { cells, cellCenters, hitCellIndices, hitGeometry, lineGeometry };
}

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

function findClosestCell(cellCenters, location) {
    const target = locationToVector(location);
    let closestCell = 0;
    let closestDot = -Infinity;
    cellCenters.forEach((center, cellIndex) => {
        const dot = center.dot(target);
        if (dot > closestDot) {
            closestDot = dot;
            closestCell = cellIndex;
        }
    });
    return closestCell;
}

function HexGrid({ visible, onTileSelect, highlightLocation }) {
    const grid = useMemo(() => createGeodesicGrid(), []);
    const [selectedCell, setSelectedCell] = useState(null);
    const highlightedCell = useMemo(
        () =>
            highlightLocation
                ? findClosestCell(grid.cellCenters, highlightLocation)
                : null,
        [grid.cellCenters, highlightLocation],
    );
    const activeCell = highlightLocation ? highlightedCell : selectedCell;
    const selectedGeometry = useMemo(
        () =>
            activeCell === null
                ? null
                : createPolygonGeometry(grid.cells[activeCell].points),
        [activeCell, grid.cells],
    );

    useEffect(() => {
        if (highlightedCell !== null) onTileSelect(highlightedCell);
    }, [highlightedCell, onTileSelect]);

    if (!visible) return null;

    return (
        <group>
            <lineSegments geometry={grid.lineGeometry} renderOrder={3}>
                <lineBasicMaterial
                    color="#d9e5ff"
                    transparent
                    opacity={0.38}
                    depthWrite={false}
                />
            </lineSegments>
            <mesh
                geometry={grid.hitGeometry}
                renderOrder={4}
                onClick={(event) => {
                    event.stopPropagation();
                    if (event.delta <= 4 && event.faceIndex !== undefined) {
                        const tileId = grid.hitCellIndices[event.faceIndex];
                        setSelectedCell(tileId);
                        onTileSelect(tileId, true);
                    }
                }}
            >
                <meshBasicMaterial
                    transparent
                    opacity={0}
                    depthWrite={false}
                    side={THREE.DoubleSide}
                />
            </mesh>
            {selectedGeometry && (
                <mesh geometry={selectedGeometry} renderOrder={5}>
                    <meshBasicMaterial
                        color="#ff4949"
                        transparent
                        opacity={0.5}
                        depthWrite={false}
                        side={THREE.DoubleSide}
                    />
                </mesh>
            )}
        </group>
    );
}

export default HexGrid;