import { readFile, writeFile } from "node:fs/promises";

const INPUT_FILE = "src/data/earth-tile-data.json";
const OUTPUT_FILE = "src/data/earth-tile-science-data.json";
const OPENTOPO_URL = "https://portal.opentopography.org/API/v1/elevation";
const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";
const NASA_POWER_URL =
    "https://power.larc.nasa.gov/api/temporal/climatology/point";
const MACROSTRAT_URL =
    "https://macrostrat.org/api/v2/geologic_units/map";
const GBIF_URL = "https://api.gbif.org/v1/occurrence/search";

const args = process.argv.slice(2);
const argumentValue = (name, fallback) =>
    args.find((argument) => argument.startsWith(`${name}=`))?.slice(name.length + 1) ??
    fallback;
const sourceNames = new Set(
    argumentValue("--sources", "opentopo,nasa-power,macrostrat,gbif")
        .split(",")
        .map((source) => source.trim())
        .filter(Boolean),
);
const limit = Math.max(0, Number(argumentValue("--limit", 10)));
const offset = Math.max(0, Number(argumentValue("--offset", 0)));
const delayMs = Math.max(0, Number(argumentValue("--delay-ms", 250)));
const concurrency = Math.max(1, Number(argumentValue("--concurrency", 8)));
const stride = Math.max(1, Number(argumentValue("--stride", 1)));
const phase = Math.max(
    0,
    Math.min(stride - 1, Number(argumentValue("--phase", 0))),
);
const prioritizeIncomplete =
    argumentValue("--prioritize-incomplete", "false") === "true";
const excludeNorthAmerica =
    argumentValue("--exclude-north-america", "false") === "true";
const regionNames = argumentValue("--regions", "")
    .split(",")
    .map((region) => region.trim().toLowerCase())
    .filter(Boolean);
const regionBounds = {
    sahara: { minLatitude: 15, maxLatitude: 35, minLongitude: -17, maxLongitude: 35 },
    china: { minLatitude: 18, maxLatitude: 54, minLongitude: 73, maxLongitude: 135 },
    "south-africa": {
        minLatitude: -35,
        maxLatitude: -22,
        minLongitude: 16,
        maxLongitude: 33,
    },
    chukotka: [
        { minLatitude: 62, maxLatitude: 72, minLongitude: 160, maxLongitude: 180 },
        { minLatitude: 62, maxLatitude: 72, minLongitude: -180, maxLongitude: -160 },
    ],
};
const inputFile = argumentValue("--input", INPUT_FILE);
const outputFile = argumentValue("--output", OUTPUT_FILE);

function round(value, digits = 3) {
    return Number(value.toFixed(digits));
}

function sleep(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function finiteValues(values) {
    return values.filter((value) => Number.isFinite(value));
}

async function requestJson(url, options = {}) {
    const response = await fetch(url, {
        headers: { accept: "application/json" },
        ...options,
    });
    if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
    }
    return response.json();
}

function sampleCoordinates(tile) {
    const latitudeStep = Math.max(
        (tile.bounds.latitudeMax - tile.bounds.latitudeMin) / 3,
        0.01,
    );
    const longitudeStep = Math.max(
        (tile.bounds.longitudeMax - tile.bounds.longitudeMin) / 3,
        0.01,
    );
    return [
        [tile.center.latitude, tile.center.longitude],
        [tile.center.latitude + latitudeStep, tile.center.longitude],
        [tile.center.latitude - latitudeStep, tile.center.longitude],
        [tile.center.latitude, tile.center.longitude + longitudeStep],
        [tile.center.latitude, tile.center.longitude - longitudeStep],
    ].map(([latitude, longitude]) => [
        Math.max(-89.9, Math.min(89.9, latitude)),
        ((longitude + 180) % 360) - 180,
    ]);
}

async function getOpenTopographyElevation(latitude, longitude, apiKey) {
    const query = new URLSearchParams({
        latitude: String(latitude),
        longitude: String(longitude),
        dataset: "NASADEM",
        API_Key: apiKey,
    });
    const payload = await requestJson(`${OPENTOPO_URL}?${query}`);
    const elevation =
        payload.elevation ??
        payload.value ??
        payload.results?.[0]?.elevation ??
        payload.data?.[0]?.elevation;
    if (!Number.isFinite(Number(elevation))) {
        throw new Error("OpenTopography response had no elevation value.");
    }
    return Number(elevation);
}

async function getElevationData(tile, apiKey) {
    const values = [];
    for (const [latitude, longitude] of sampleCoordinates(tile)) {
        values.push(await getOpenTopographyElevation(latitude, longitude, apiKey));
        await sleep(delayMs);
    }
    const valid = finiteValues(values);
    if (valid.length < 3) throw new Error("Fewer than three elevation samples.");
    const mean = valid.reduce((sum, value) => sum + value, 0) / valid.length;
    const relief = Math.max(...valid) - Math.min(...valid);
    const latitudeDistanceKm =
        (tile.bounds.latitudeMax - tile.bounds.latitudeMin) * 111.32;
    const longitudeDistanceKm =
        (tile.bounds.longitudeMax - tile.bounds.longitudeMin) *
        111.32 *
        Math.cos((tile.center.latitude * Math.PI) / 180);
    const horizontalDistanceKm = Math.max(
        Math.min(latitudeDistanceKm, longitudeDistanceKm),
        0.1,
    );
    const slopeDegrees =
        (Math.atan2(relief, horizontalDistanceKm) * 180) / Math.PI;
    const variance =
        valid.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
        valid.length;
    return {
        source: "OpenTopography NASADEM",
        sampleCount: valid.length,
        meanM: round(mean),
        minimumM: round(Math.min(...valid)),
        maximumM: round(Math.max(...valid)),
        reliefM: round(relief),
        meanSlopeDegrees: round(slopeDegrees, 4),
        roughnessStdDevM: round(Math.sqrt(variance)),
    };
}

async function getOpenMeteoElevationData(tile) {
    const coordinates = sampleCoordinates(tile);
    const query = new URLSearchParams({
        latitude: coordinates.map(([latitude]) => latitude).join(","),
        longitude: coordinates.map(([, longitude]) => longitude).join(","),
        current: "temperature_2m",
        forecast_days: "1",
        timezone: "UTC",
    });
    const payload = await requestJson(`${OPEN_METEO_URL}?${query}`);
    const responses = Array.isArray(payload) ? payload : [payload];
    const values = finiteValues(responses.map((response) => response.elevation));
    if (values.length < 3) {
        throw new Error("Open-Meteo response had fewer than three elevations.");
    }
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const relief = Math.max(...values) - Math.min(...values);
    const latitudeDistanceKm =
        (tile.bounds.latitudeMax - tile.bounds.latitudeMin) * 111.32;
    const longitudeDistanceKm =
        (tile.bounds.longitudeMax - tile.bounds.longitudeMin) *
        111.32 *
        Math.cos((tile.center.latitude * Math.PI) / 180);
    const horizontalDistanceKm = Math.max(
        Math.min(latitudeDistanceKm, longitudeDistanceKm),
        0.1,
    );
    const variance =
        values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
        values.length;
    return {
        source: "Open-Meteo elevation model",
        sampleCount: values.length,
        meanM: round(mean),
        minimumM: round(Math.min(...values)),
        maximumM: round(Math.max(...values)),
        reliefM: round(relief),
        meanSlopeDegrees: round(
            (Math.atan2(relief, horizontalDistanceKm) * 180) / Math.PI,
            4,
        ),
        roughnessStdDevM: round(Math.sqrt(variance)),
    };
}

function annualValue(parameter) {
    return parameter?.ANN ?? parameter?.annual ?? null;
}

async function getNasaPowerData(tile) {
    const query = new URLSearchParams({
        parameters:
            "T2M,T2M_MAX,T2M_MIN,ALLSKY_SFC_SW_DWN,WS10M,PRECTOTCORR,EVPTRNS",
        community: "AG",
        longitude: String(tile.center.longitude),
        latitude: String(tile.center.latitude),
        format: "JSON",
    });
    const payload = await requestJson(`${NASA_POWER_URL}?${query}`);
    const values = payload.properties?.parameter;
    if (!values) throw new Error("NASA POWER response had no parameters.");
    return {
        source: "NASA POWER climatology",
        meanTemperatureC: annualValue(values.T2M),
        warmestMonthTemperatureC: annualValue(values.T2M_MAX),
        coldestMonthTemperatureC: annualValue(values.T2M_MIN),
        solarRadiationKwhM2Day: annualValue(values.ALLSKY_SFC_SW_DWN),
        windSpeedMPerS: annualValue(values.WS10M),
        precipitationMmDay: annualValue(values.PRECTOTCORR),
        evapotranspirationMmDay: annualValue(values.EVPTRNS),
    };
}

async function getGeologyData(tile) {
    const query = new URLSearchParams({
        lat: String(tile.center.latitude),
        lng: String(tile.center.longitude),
        scale: "large",
    });
    const payload = await requestJson(`${MACROSTRAT_URL}?${query}`);
    const units = payload.success?.data ?? payload.data ?? [];
    const unit = units[0];
    if (!unit) throw new Error("Macrostrat returned no mapped unit.");
    return {
        source: "Macrostrat integrated geologic map",
        lithology: unit.lith ?? null,
        unitName: unit.name ?? null,
        description: unit.descrip ?? null,
        mapId: unit.map_id ?? null,
    };
}

async function getBiodiversityData(tile) {
    const query = new URLSearchParams({
        decimalLatitude: String(tile.center.latitude),
        decimalLongitude: String(tile.center.longitude),
        radius: "25",
        hasCoordinate: "true",
        limit: "0",
    });
    const payload = await requestJson(`${GBIF_URL}?${query}`);
    return {
        source: "GBIF occurrence search",
        occurrenceCount: payload.count ?? null,
        radiusKm: 25,
    };
}

function getEngineeringData(tile) {
    const terrain = tile.data?.elevation;
    const climate = tile.data?.climate;
    if (!terrain) return null;
    const slopePenalty = Math.min(terrain.meanSlopeDegrees / 45, 1);
    const roughnessPenalty = Math.min(terrain.roughnessStdDevM / 250, 1);
    const heatPenalty = climate
        ? Math.min(Math.max((climate.warmestMonthTemperatureC - 30) / 30, 0), 1)
        : 0;
    const traversability = 1 - slopePenalty * 0.55 - roughnessPenalty * 0.45;
    return {
        traversabilityIndex: round(Math.max(0, traversability), 4),
        constructionSuitabilityIndex: round(
            Math.max(0, traversability * (1 - heatPenalty * 0.2)),
            4,
        ),
        calculation:
            "Derived from NASADEM relief/slope/roughness and NASA POWER heat when available; lithology and water penalties are not applied until those layers exist.",
    };
}

async function processTile(tile, apiKey, status) {
    tile.data = tile.data ?? {};
    const runSource = async (source, key, callback) => {
        if (!sourceNames.has(source)) return;
        try {
            tile.data[key] = await callback();
        } catch (error) {
            status.failures.push({
                tileId: tile.tileId,
                source,
                message: error.message,
            });
        }
    };
    await runSource("opentopo", "elevation", () =>
        getElevationData(tile, apiKey),
    );
    await runSource("open-meteo-elevation", "elevation", () =>
        getOpenMeteoElevationData(tile),
    );
    await runSource("nasa-power", "climate", () =>
        getNasaPowerData(tile),
    );
    await runSource("macrostrat", "geology", () => getGeologyData(tile));
    await runSource("gbif", "biodiversity", () =>
        getBiodiversityData(tile),
    );
    const engineering = getEngineeringData(tile);
    if (engineering) tile.data.engineering = engineering;
}

const dataset = JSON.parse(await readFile(inputFile, "utf8"));
const apiKey = process.env.OPENTOPO_API_KEY;
if (sourceNames.has("opentopo") && !apiKey) {
    throw new Error(
        "OPENTOPO_API_KEY is required for OpenTopography. Set it in the local environment; do not put it in source code.",
    );
}

function isNorthAmerica(tile) {
    return (
        tile.center.latitude >= 7 &&
        tile.center.latitude <= 85 &&
        tile.center.longitude >= -170 &&
        tile.center.longitude <= -50
    );
}

function isInRequestedRegion(tile) {
    if (!regionNames.length) return true;
    return regionNames.some((regionName) => {
        const bounds = regionBounds[regionName];
        const regions = Array.isArray(bounds) ? bounds : [bounds];
        return regions.some(
            (region) =>
                region &&
                tile.center.latitude >= region.minLatitude &&
                tile.center.latitude <= region.maxLatitude &&
                tile.center.longitude >= region.minLongitude &&
                tile.center.longitude <= region.maxLongitude,
        );
    });
}

const candidates = dataset.tiles
    .map((tile, index) => ({ tile, index }))
    .filter(({ index }) => index % stride === phase)
    .filter(({ tile }) => !excludeNorthAmerica || !isNorthAmerica(tile));
if (regionNames.length) {
    candidates.splice(
        0,
        candidates.length,
        ...candidates.filter(({ tile }) => isInRequestedRegion(tile)),
    );
}
if (prioritizeIncomplete) {
    const sourceDataKeys = [
        sourceNames.has("opentopo") || sourceNames.has("open-meteo-elevation")
            ? "elevation"
            : null,
        sourceNames.has("nasa-power") ? "climate" : null,
        sourceNames.has("macrostrat") ? "geology" : null,
        sourceNames.has("gbif") ? "biodiversity" : null,
    ].filter(Boolean);
    const incompleteCandidates = candidates.filter(({ tile }) => {
        const completedSources = sourceDataKeys.filter((key) => tile.data?.[key]);
        return completedSources.length < sourceDataKeys.length;
    });
    incompleteCandidates.sort((first, second) => {
        const firstCount = Object.keys(first.tile.data ?? {}).length;
        const secondCount = Object.keys(second.tile.data ?? {}).length;
        return secondCount - firstCount || first.index - second.index;
    });
    candidates.length = 0;
    candidates.push(...incompleteCandidates);
}
const selectedTiles = candidates
    .slice(offset, offset + limit)
    .map(({ tile }) => tile);
const status = {
    requestedSources: [...sourceNames],
    processedTiles: selectedTiles.length,
    failures: [],
    unavailable: {
        "GLiM/OneGeology": "No stable public point-query API configured.",
        "WorldClim/MODIS LST": "Requires raster download or Google Earth Engine.",
        "NSIDC permafrost/snow": "Requires NSIDC raster/service credentials or download.",
        "JRC Global Surface Water": "Requires Earth Engine or raster download.",
        "ERA5 wind vectors": "Requires Copernicus CDS credentials or bulk download.",
        "NASA NEO/NDVI": "Requires raster download or Earth Engine.",
        "US Global Karst Map/lava tubes":
            "Requires source GIS downloads; no stable point API configured.",
    },
};

let nextIndex = 0;
const workers = Array.from(
    { length: Math.min(concurrency, selectedTiles.length) },
    async () => {
        while (nextIndex < selectedTiles.length) {
            const index = nextIndex;
            nextIndex += 1;
            await processTile(selectedTiles[index], apiKey, status);
            if ((index + 1) % 100 === 0) {
                console.log(
                    `Enriched ${index + 1}/${selectedTiles.length} tiles`,
                );
            }
        }
    },
);
await Promise.all(workers);

await writeFile(
    outputFile,
    `${JSON.stringify(
        {
            ...dataset,
            version: 2,
            source: {
                ...dataset.source,
                enrichment:
                    "Run this CLI in bounded batches. Protected credentials are read from environment variables and never written to output.",
                status,
            },
            tiles: dataset.tiles,
        },
        null,
        2,
    )}\n`,
);

console.log(
    `Wrote enriched data for ${selectedTiles.length} tiles to ${outputFile}`,
);
