import zlib from "node:zlib";

export interface ZipInputEntry {
    /** Relative POSIX path inside archive (e.g. `story.msk`, `locales/en-US.i18n.json`). */
    path: string;
    data: Uint8Array | Buffer | string;
    /** Force STORE (method 0) instead of DEFLATE (method 8). Auto-enabled for compressed audio. */
    store?: boolean;
    mtime?: Date;
}

export interface ZipEntrySummary {
    path: string;
    compressionMethod: number;
    crc32: number;
    compressedSize: number;
    uncompressedSize: number;
}

const PRECOMPRESSED_EXTENSIONS = new Set([".mp3", ".ogg", ".m4a", ".flac", ".webm", ".webp", ".png", ".jpg", ".jpeg", ".zip"]);

// Precomputed standard IEEE 802.3 CRC-32 table.
const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
        c = (c & 1) !== 0 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    CRC32_TABLE[i] = c >>> 0;
}

export function crc32(buf: Uint8Array): number {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
        crc = CRC32_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function toDosTimeDate(date: Date): { dosTime: number; dosDate: number } {
    const year = Math.max(1980, Math.min(2107, date.getUTCFullYear()));
    const month = date.getUTCMonth() + 1;
    const day = date.getUTCDate();
    const hours = date.getUTCHours();
    const minutes = date.getUTCMinutes();
    const seconds = Math.floor(date.getUTCSeconds() / 2);

    const dosTime = ((hours & 0x1f) << 11) | ((minutes & 0x3f) << 5) | (seconds & 0x1f);
    const dosDate = (((year - 1980) & 0x7f) << 9) | ((month & 0x0f) << 5) | (day & 0x1f);
    return { dosTime, dosDate };
}

function validateArchiveEntryPath(rawPath: string): string {
    if (!rawPath || rawPath.includes("\0") || rawPath.includes("\\")) {
        throw new Error(`Invalid zip entry path: "${rawPath}"`);
    }
    const trimmed = rawPath.replace(/^\/+/, "");
    if (!trimmed || trimmed.endsWith("/")) {
        throw new Error(`Zip entry path must name a file: "${rawPath}"`);
    }
    const segments = trimmed.split("/");
    for (const seg of segments) {
        if (!seg || seg === "." || seg === ".." || /^[a-zA-Z]:/.test(seg)) {
            throw new Error(`Unsafe zip entry path segment "${seg}" in "${rawPath}"`);
        }
    }
    return segments.join("/");
}

function isPrecompressed(filePath: string): boolean {
    const dot = filePath.lastIndexOf(".");
    if (dot < 0) return false;
    return PRECOMPRESSED_EXTENSIONS.has(filePath.slice(dot).toLowerCase());
}

/**
 * Pure-TS deterministic ZIP archive builder (PKZIP 2.0 compatible, UTF-8 names, DEFLATE/STORE).
 */
export function createZipBuffer(entries: ZipInputEntry[]): Buffer {
    const localParts: Buffer[] = [];
    const centralParts: Buffer[] = [];
    const seenPaths = new Set<string>();
    let offset = 0;

    for (const entry of entries) {
        const cleanPath = validateArchiveEntryPath(entry.path);
        if (seenPaths.has(cleanPath)) {
            throw new Error(`Duplicate zip entry path: "${cleanPath}"`);
        }
        seenPaths.add(cleanPath);

        const nameBuf = Buffer.from(cleanPath, "utf8");
        const rawBuf = typeof entry.data === "string"
            ? Buffer.from(entry.data, "utf8")
            : Buffer.from(entry.data.buffer, entry.data.byteOffset, entry.data.byteLength);

        const checksum = crc32(rawBuf);
        const preferStore = entry.store === true || rawBuf.length < 64 || isPrecompressed(cleanPath);

        let method = 0;
        let payloadBuf: Buffer = rawBuf;
        if (!preferStore) {
            const deflated = zlib.deflateRawSync(rawBuf, { level: 6 });
            if (deflated.length < rawBuf.length) {
                method = 8;
                payloadBuf = deflated;
            }
        }

        const { dosTime, dosDate } = toDosTimeDate(entry.mtime ?? new Date());
        const flags = 0x0800; // UTF-8 filename encoding

        // Local File Header (30 bytes + filename)
        const localHeader = Buffer.alloc(30);
        localHeader.writeUInt32LE(0x04034b50, 0);
        localHeader.writeUInt16LE(20, 4); // version needed: 2.0
        localHeader.writeUInt16LE(flags, 6);
        localHeader.writeUInt16LE(method, 8);
        localHeader.writeUInt16LE(dosTime, 10);
        localHeader.writeUInt16LE(dosDate, 12);
        localHeader.writeUInt32LE(checksum, 14);
        localHeader.writeUInt32LE(payloadBuf.length, 18);
        localHeader.writeUInt32LE(rawBuf.length, 22);
        localHeader.writeUInt16LE(nameBuf.length, 26);
        localHeader.writeUInt16LE(0, 28); // extra len

        localParts.push(localHeader, nameBuf, payloadBuf);

        // Central Directory Header (46 bytes + filename)
        const centralHeader = Buffer.alloc(46);
        centralHeader.writeUInt32LE(0x02014b50, 0);
        centralHeader.writeUInt16LE(20, 4); // version made by
        centralHeader.writeUInt16LE(20, 6); // version needed
        centralHeader.writeUInt16LE(flags, 8);
        centralHeader.writeUInt16LE(method, 10);
        centralHeader.writeUInt16LE(dosTime, 12);
        centralHeader.writeUInt16LE(dosDate, 14);
        centralHeader.writeUInt32LE(checksum, 16);
        centralHeader.writeUInt32LE(payloadBuf.length, 20);
        centralHeader.writeUInt32LE(rawBuf.length, 24);
        centralHeader.writeUInt16LE(nameBuf.length, 28);
        centralHeader.writeUInt16LE(0, 30); // extra len
        centralHeader.writeUInt16LE(0, 32); // comment len
        centralHeader.writeUInt16LE(0, 34); // disk number
        centralHeader.writeUInt16LE(0, 36); // internal attrs
        centralHeader.writeUInt32LE(0, 38); // external attrs
        centralHeader.writeUInt32LE(offset, 42); // local header offset

        centralParts.push(centralHeader, nameBuf);

        offset += localHeader.length + nameBuf.length + payloadBuf.length;
    }

    const centralDirSize = centralParts.reduce((sum, part) => sum + part.length, 0);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4); // disk num
    eocd.writeUInt16LE(0, 6); // cd disk
    eocd.writeUInt16LE(seenPaths.size, 8);
    eocd.writeUInt16LE(seenPaths.size, 10);
    eocd.writeUInt32LE(centralDirSize, 12);
    eocd.writeUInt32LE(offset, 16);
    eocd.writeUInt16LE(0, 20); // comment len

    return Buffer.concat([...localParts, ...centralParts, eocd]);
}

/**
 * Parses central directory entries from a ZIP buffer (useful for verification & tests).
 */
export function listZipEntries(zipBuffer: Buffer): ZipEntrySummary[] {
    let eocdOffset = -1;
    for (let i = zipBuffer.length - 22; i >= Math.max(0, zipBuffer.length - 65557); i--) {
        if (zipBuffer.readUInt32LE(i) === 0x06054b50) {
            eocdOffset = i;
            break;
        }
    }
    if (eocdOffset < 0) {
        throw new Error("Invalid ZIP archive: EOCD signature not found.");
    }

    const totalEntries = zipBuffer.readUInt16LE(eocdOffset + 10);
    const cdOffset = zipBuffer.readUInt32LE(eocdOffset + 16);

    const results: ZipEntrySummary[] = [];
    let pos = cdOffset;
    for (let i = 0; i < totalEntries; i++) {
        if (zipBuffer.readUInt32LE(pos) !== 0x02014b50) {
            throw new Error(`Invalid central directory header at offset ${pos}`);
        }
        const compressionMethod = zipBuffer.readUInt16LE(pos + 10);
        const entryCrc = zipBuffer.readUInt32LE(pos + 16);
        const compressedSize = zipBuffer.readUInt32LE(pos + 20);
        const uncompressedSize = zipBuffer.readUInt32LE(pos + 24);
        const nameLen = zipBuffer.readUInt16LE(pos + 28);
        const extraLen = zipBuffer.readUInt16LE(pos + 30);
        const commentLen = zipBuffer.readUInt16LE(pos + 32);
        const entryPath = zipBuffer.subarray(pos + 46, pos + 46 + nameLen).toString("utf8");

        results.push({
            path: entryPath,
            compressionMethod,
            crc32: entryCrc,
            compressedSize,
            uncompressedSize,
        });

        pos += 46 + nameLen + extraLen + commentLen;
    }

    return results;
}

/**
 * Extracts and verifies (via CRC-32) a single named entry from a ZIP buffer.
 */
export function extractZipEntry(zipBuffer: Buffer, targetPath: string): Buffer | null {
    let eocdOffset = -1;
    for (let i = zipBuffer.length - 22; i >= Math.max(0, zipBuffer.length - 65557); i--) {
        if (zipBuffer.readUInt32LE(i) === 0x06054b50) {
            eocdOffset = i;
            break;
        }
    }
    if (eocdOffset < 0) return null;

    const totalEntries = zipBuffer.readUInt16LE(eocdOffset + 10);
    const cdOffset = zipBuffer.readUInt32LE(eocdOffset + 16);

    let pos = cdOffset;
    for (let i = 0; i < totalEntries; i++) {
        if (zipBuffer.readUInt32LE(pos) !== 0x02014b50) return null;
        const method = zipBuffer.readUInt16LE(pos + 10);
        const expectedCrc = zipBuffer.readUInt32LE(pos + 16);
        const compressedSize = zipBuffer.readUInt32LE(pos + 20);
        const nameLen = zipBuffer.readUInt16LE(pos + 28);
        const extraLen = zipBuffer.readUInt16LE(pos + 30);
        const commentLen = zipBuffer.readUInt16LE(pos + 32);
        const localOffset = zipBuffer.readUInt32LE(pos + 42);
        const entryPath = zipBuffer.subarray(pos + 46, pos + 46 + nameLen).toString("utf8");

        if (entryPath === targetPath) {
            if (zipBuffer.readUInt32LE(localOffset) !== 0x04034b50) {
                throw new Error(`Corrupted local header for ${targetPath}`);
            }
            const localNameLen = zipBuffer.readUInt16LE(localOffset + 26);
            const localExtraLen = zipBuffer.readUInt16LE(localOffset + 28);
            const dataStart = localOffset + 30 + localNameLen + localExtraLen;
            const compressed = zipBuffer.subarray(dataStart, dataStart + compressedSize);
            const content = method === 0
                ? Buffer.from(compressed)
                : method === 8
                    ? zlib.inflateRawSync(compressed)
                    : (() => {
                        throw new Error(`Unsupported ZIP compression method ${method}`);
                    })();

            if (crc32(content) !== expectedCrc) {
                throw new Error(`CRC-32 mismatch while extracting ${targetPath}`);
            }
            return content;
        }

        pos += 46 + nameLen + extraLen + commentLen;
    }

    return null;
}
