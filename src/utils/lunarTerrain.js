export function pointToLatLon(point) {
    const [x, y, z] = point;
    const r = Math.hypot(x, y, z) || 1;
    const lat = (Math.asin(Math.max(-1, Math.min(1, y / r))) * 180) / Math.PI;
    const lon = (Math.atan2(x, z) * 180) / Math.PI;

    const latStr = `${Math.abs(lat).toFixed(1)}° ${lat >= 0 ? "N" : "S"}`;
    const lonStr = `${Math.abs(lon).toFixed(1)}° ${lon >= 0 ? "E" : "W"}`;

    return {
        lat,
        lon,
        label: `${latStr}, ${lonStr}`,
    };
}

export function sampleLunarCharacteristics(texture, uv) {
    const fallback = {
        albedo: 0.5,
        variance: 0.15,
        terrainType: "Cratered Transition Zone",
        craterDensity: 0.6,
        roughness: 0.65,
    };

    if (!texture?.image || !uv) return fallback;

    try {
        const img = texture.image;
        const width = img.naturalWidth || img.width;
        const height = img.naturalHeight || img.height;
        if (!width || !height) return fallback;

        const canvas = document.createElement("canvas");
        const sampleSize = 15;
        canvas.width = sampleSize;
        canvas.height = sampleSize;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return fallback;

        const u = ((uv.x % 1) + 1) % 1;
        const v = Math.max(0, Math.min(1, 1 - uv.y));
        const cx = Math.floor(u * (width - 1));
        const cy = Math.floor(v * (height - 1));
        const half = Math.floor(sampleSize / 2);

        const sx = Math.max(0, Math.min(width - sampleSize, cx - half));
        const sy = Math.max(0, Math.min(height - sampleSize, cy - half));

        ctx.drawImage(img, sx, sy, sampleSize, sampleSize, 0, 0, sampleSize, sampleSize);
        const { data } = ctx.getImageData(0, 0, sampleSize, sampleSize);

        let sum = 0;
        const values = [];
        for (let i = 0; i < data.length; i += 4) {
            const lum = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
            sum += lum;
            values.push(lum);
        }

        const albedo = sum / values.length;
        const variance =
            values.reduce((acc, val) => acc + (val - albedo) ** 2, 0) / values.length;
        const stdDev = Math.sqrt(variance);

        let terrainType = "Cratered Transition Zone";
        if (albedo < 0.36) {
            terrainType = "Lunar Mare (Basalt Plain)";
        } else if (albedo > 0.56) {
            terrainType = "Lunar Highlands";
        }

        const craterDensity = Math.min(1, Math.max(0.2, albedo * 0.85 + stdDev * 2.2));
        const roughness = Math.min(1, Math.max(0.25, albedo * 0.6 + stdDev * 3.0));

        return {
            albedo,
            variance: stdDev,
            terrainType,
            craterDensity,
            roughness,
        };
    } catch {
        return fallback;
    }
}

export function createSeededRng(lat, lon) {
    let seed =
        Math.floor((lat + 90) * 1000) * 73856093 ^
        Math.floor((lon + 180) * 1000) * 19349663;
    seed = (seed >>> 0) || 123456789;

    return () => {
        seed ^= seed << 13;
        seed ^= seed >>> 17;
        seed ^= seed << 5;
        return (seed >>> 0) / 4294967296;
    };
}

function hash2D(ix, iz, seedOffset) {
    let n = Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seedOffset, 1442695041);
    n = (n ^ (n >>> 13)) >>> 0;
    n = Math.imul(n, 1274126177) >>> 0;
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function valueNoise2D(x, z, seedOffset) {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const fx = x - ix;
    const fz = z - iz;

    const ux = fx * fx * (3 - 2 * fx);
    const uz = fz * fz * (3 - 2 * fz);

    const a = hash2D(ix, iz, seedOffset);
    const b = hash2D(ix + 1, iz, seedOffset);
    const c = hash2D(ix, iz + 1, seedOffset);
    const d = hash2D(ix + 1, iz + 1, seedOffset);

    return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

function fbm2D(x, z, seedOffset, octaves = 4) {
    let value = 0;
    let amplitude = 0.5;
    let frequency = 1;

    for (let i = 0; i < octaves; i++) {
        value += amplitude * (valueNoise2D(x * frequency, z * frequency, seedOffset + i * 31) * 2 - 1);
        frequency *= 2.05;
        amplitude *= 0.5;
    }

    return value;
}

export function buildLunarSiteData(site) {
    const { lat, lon, characteristics } = site;
    const rng = createSeededRng(lat, lon);
    const seedOffset = Math.floor(rng() * 100000);

    const terrainSize = 90;
    const halfSize = terrainSize / 2;
    const craterCount = Math.round(28 + characteristics.craterDensity * 45);

    const craters = [];
    for (let i = 0; i < craterCount; i++) {
        const isLarge = i < 7;
        const radius = isLarge
            ? 3.5 + rng() * (4.5 + characteristics.craterDensity * 3.5)
            : 0.6 + rng() * 2.2;
        const margin = radius * 0.4;
        const x = (rng() * 2 - 1) * (halfSize - margin);
        const z = (rng() * 2 - 1) * (halfSize - margin);
        const depth = radius * (0.22 + rng() * 0.16);
        const rimHeight = depth * (0.26 + rng() * 0.18);

        craters.push({ x, z, radius, depth, rimHeight });
    }

    const boulderCount = Math.round(35 + characteristics.roughness * 60);
    const boulders = [];
    for (let i = 0; i < boulderCount; i++) {
        const x = (rng() * 2 - 1) * (halfSize - 3);
        const z = (rng() * 2 - 1) * (halfSize - 3);
        const scale = 0.08 + rng() * (0.22 + characteristics.roughness * 0.22);
        const rotY = rng() * Math.PI * 2;
        const rotX = rng() * Math.PI;
        boulders.push({ x, z, scale, rotX, rotY });
    }

    const macroAmplitude = 0.35 + characteristics.roughness * 0.95;
    const microAmplitude = 0.08 + characteristics.roughness * 0.14;

    const getHeightAt = (x, z) => {
        let h =
            fbm2D(x * 0.14, z * 0.14, seedOffset, 4) * macroAmplitude +
            fbm2D(x * 0.65, z * 0.65, seedOffset + 77, 3) * microAmplitude;

        for (let i = 0; i < craters.length; i++) {
            const c = craters[i];
            const dx = x - c.x;
            const dz = z - c.z;
            const dist = Math.hypot(dx, dz);
            const r = c.radius;

            if (dist < r * 1.55) {
                const t = dist / r;
                if (t < 1) {
                    // Parabolic crater bowl
                    const bowl = (t * t - 1) * c.depth;
                    const rim = Math.exp(-((t - 1) * (t - 1)) / 0.04) * c.rimHeight;
                    h += bowl + rim;
                } else {
                    // Outer ejecta slope & rim falloff
                    const rim = Math.exp(-((t - 1) * (t - 1)) / 0.06) * c.rimHeight;
                    h += rim;
                }
            }
        }

        return h;
    };

    return {
        terrainSize,
        craters,
        boulders,
        getHeightAt,
    };
}
