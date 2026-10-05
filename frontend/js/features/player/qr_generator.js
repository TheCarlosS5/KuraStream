/**
 * KuraStream v2.0 - Self-Contained In-Browser QR Code Generator
 * Generates pure SVG QR codes without any external network dependencies or APIs.
 * Byte-mode (UTF-8) encoding, error correction level L, versions 1-6 (up to 134 bytes).
 */

// Galois Field GF(256) tables for QR Reed-Solomon
const GF256_EXP = new Uint8Array(512);
const GF256_LOG = new Uint8Array(256);
(function initGF() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF256_EXP[i] = x;
    GF256_EXP[i + 255] = x;
    GF256_LOG[x] = i;
    x = (x << 1) ^ ((x & 0x80) ? 0x11D : 0);
  }
})();

function gfMul(x, y) {
  if (x === 0 || y === 0) return 0;
  return GF256_EXP[GF256_LOG[x] + GF256_LOG[y]];
}

function rsGeneratorPoly(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= gfMul(poly[j], GF256_EXP[i]);
      next[j + 1] ^= poly[j];
    }
    poly = next;
  }
  return poly;
}

function rsCalculateEcc(data, eccLength) {
  // rsGeneratorPoly is little-endian (gen[k] multiplies x^k); the division walks it from the
  // highest power down, skipping the implicit leading 1.
  const gen = rsGeneratorPoly(eccLength);
  const res = new Array(eccLength).fill(0);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ res[0];
    res.shift();
    res.push(0);
    for (let j = 0; j < eccLength; j++) {
      res[j] ^= gfMul(gen[eccLength - 1 - j], factor);
    }
  }
  return res;
}

// Error correction level L (ISO/IEC 18004 table 9). V1-V5 use a single block; V6 splits the data
// into two equal blocks whose codewords are interleaved.
const VERSIONS = [
  null,
  { size: 21, blocks: 1, dataPerBlock: 19, eccPerBlock: 7, align: [] },
  { size: 25, blocks: 1, dataPerBlock: 34, eccPerBlock: 10, align: [6, 18] },
  { size: 29, blocks: 1, dataPerBlock: 55, eccPerBlock: 15, align: [6, 22] },
  { size: 33, blocks: 1, dataPerBlock: 80, eccPerBlock: 20, align: [6, 26] },
  { size: 37, blocks: 1, dataPerBlock: 108, eccPerBlock: 26, align: [6, 30] },
  { size: 41, blocks: 2, dataPerBlock: 68, eccPerBlock: 18, align: [6, 34] }
];

// 15-bit format word for level L (01) with mask 0, BCH-encoded and XORed with 0x5412.
const FORMAT_BITS_L_MASK0 = 0b111011111000100;

export function createQRCodeMatrix(text) {
  // Encode text as UTF-8 bytes
  const encoder = new TextEncoder();
  const rawBytes = encoder.encode(text);

  // Smallest version that fits mode (4 bits) + 8-bit count + payload; longer text is truncated to V6.
  let vNum = VERSIONS.length - 1;
  for (let v = 1; v < VERSIONS.length; v++) {
    if (12 + rawBytes.length * 8 <= VERSIONS[v].blocks * VERSIONS[v].dataPerBlock * 8) {
      vNum = v;
      break;
    }
  }
  const version = VERSIONS[vNum];

  const dataCap = version.blocks * version.dataPerBlock;
  const bitStream = [];

  function pushBits(val, len) {
    for (let i = len - 1; i >= 0; i--) {
      bitStream.push((val >> i) & 1);
    }
  }

  // Byte mode indicator: 0100
  pushBits(0b0100, 4);
  // Character count indicator (8 bits for V1-V9 in byte mode)
  const actualLen = Math.min(rawBytes.length, Math.floor((dataCap * 8 - 12) / 8));
  pushBits(actualLen, 8);

  // Bytes data
  for (let i = 0; i < actualLen; i++) {
    pushBits(rawBytes[i], 8);
  }

  // Terminator (up to 4 zeroes)
  const termLen = Math.min(4, dataCap * 8 - bitStream.length);
  pushBits(0, termLen);

  // Pad to byte boundary
  while (bitStream.length % 8 !== 0) {
    bitStream.push(0);
  }

  // Pad bytes 0xEC, 0x11
  const padBytes = [0xEC, 0x11];
  let padIdx = 0;
  while (bitStream.length < dataCap * 8) {
    pushBits(padBytes[padIdx % 2], 8);
    padIdx++;
  }

  // Convert bits to data array
  const dataBytes = [];
  for (let i = 0; i < bitStream.length; i += 8) {
    let byte = 0;
    for (let b = 0; b < 8; b++) {
      byte = (byte << 1) | bitStream[i + b];
    }
    dataBytes.push(byte);
  }

  // ECC per block, then interleave: data codewords column by column, then ECC the same way.
  const dataBlocks = [];
  const eccBlocks = [];
  for (let b = 0; b < version.blocks; b++) {
    const block = dataBytes.slice(b * version.dataPerBlock, (b + 1) * version.dataPerBlock);
    dataBlocks.push(block);
    eccBlocks.push(rsCalculateEcc(block, version.eccPerBlock));
  }
  const allCodewords = [];
  for (let i = 0; i < version.dataPerBlock; i++) {
    for (const block of dataBlocks) allCodewords.push(block[i]);
  }
  for (let i = 0; i < version.eccPerBlock; i++) {
    for (const block of eccBlocks) allCodewords.push(block[i]);
  }

  // Initialize matrix
  const N = version.size;
  const matrix = Array.from({ length: N }, () => new Array(N).fill(null));
  const reserved = Array.from({ length: N }, () => new Array(N).fill(false));

  // Finder pattern helper
  function placeFinder(r, c) {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr >= 0 && nr < N && nc >= 0 && nc < N) {
          reserved[nr][nc] = true;
          if (dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6) {
            const isBorder = dr === 0 || dr === 6 || dc === 0 || dc === 6;
            const isCenter = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
            matrix[nr][nc] = (isBorder || isCenter) ? 1 : 0;
          } else {
            matrix[nr][nc] = 0; // Separator
          }
        }
      }
    }
  }

  placeFinder(0, 0);
  placeFinder(0, N - 7);
  placeFinder(N - 7, 0);

  // Timing patterns
  for (let i = 8; i < N - 8; i++) {
    if (!reserved[6][i]) {
      matrix[6][i] = (i % 2 === 0) ? 1 : 0;
      reserved[6][i] = true;
    }
    if (!reserved[i][6]) {
      matrix[i][6] = (i % 2 === 0) ? 1 : 0;
      reserved[i][6] = true;
    }
  }

  // Dark module
  matrix[4 * vNum + 9][8] = 1;
  reserved[4 * vNum + 9][8] = true;

  // Alignment patterns
  if (version.align.length > 0) {
    for (const r of version.align) {
      for (const c of version.align) {
        if (reserved[r][c]) continue;
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            reserved[r + dr][c + dc] = true;
            const isEdge = Math.abs(dr) === 2 || Math.abs(dc) === 2;
            const isDot = dr === 0 && dc === 0;
            matrix[r + dr][c + dc] = (isEdge || isDot) ? 1 : 0;
          }
        }
      }
    }
  }

  // Reserve format information areas
  for (let i = 0; i < 9; i++) {
    if (i !== 6) {
      reserved[8][i] = true;
      reserved[i][8] = true;
    }
  }
  for (let i = 0; i < 8; i++) {
    reserved[8][N - 1 - i] = true;
    reserved[N - 1 - i][8] = true;
  }

  // Place codewords in zigzag
  const allBits = [];
  for (const b of allCodewords) {
    for (let i = 7; i >= 0; i--) {
      allBits.push((b >> i) & 1);
    }
  }

  let bitIdx = 0;
  let up = true;
  for (let col = N - 1; col > 0; col -= 2) {
    if (col === 6) col--; // Skip vertical timing column
    const rows = [];
    if (up) {
      for (let r = N - 1; r >= 0; r--) rows.push(r);
    } else {
      for (let r = 0; r < N; r++) rows.push(r);
    }
    up = !up;

    for (const row of rows) {
      for (let c = 0; c < 2; c++) {
        const x = col - c;
        if (!reserved[row][x]) {
          const bit = bitIdx < allBits.length ? allBits[bitIdx++] : 0;
          // Mask pattern 0: (row + col) % 2 === 0
          const mask = ((row + x) % 2 === 0) ? 1 : 0;
          matrix[row][x] = bit ^ mask;
        }
      }
    }
  }

  // Format information; bit i counts from the least significant end.
  const fmt = i => (FORMAT_BITS_L_MASK0 >> i) & 1;
  // First copy, around the top-left finder
  for (let i = 0; i <= 5; i++) matrix[i][8] = fmt(i);
  matrix[7][8] = fmt(6);
  matrix[8][8] = fmt(7);
  matrix[8][7] = fmt(8);
  for (let i = 9; i < 15; i++) matrix[8][14 - i] = fmt(i);
  // Second copy, split between the top-right and bottom-left finders
  for (let i = 0; i < 8; i++) matrix[8][N - 1 - i] = fmt(i);
  for (let i = 8; i < 15; i++) matrix[N - 15 + i][8] = fmt(i);

  return matrix;
}

/**
 * Generate standalone SVG string for QR Code
 */
export function generateQRCodeSVG(text, size = 180) {
  const matrix = createQRCodeMatrix(text);
  const n = matrix.length;
  const padding = 2;
  const total = n + padding * 2;

  let pathData = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (matrix[r][c] === 1) {
        pathData += `M${c + padding},${r + padding}h1v1h-1z `;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${size}" height="${size}" shape-rendering="crispEdges" aria-label="QR Code" role="img">
    <rect width="${total}" height="${total}" fill="#ffffff" rx="2" />
    <path d="${pathData}" fill="#090d0e" />
  </svg>`;
}

/**
 * Renders QR Code directly into a DOM container or sets image src to data URL
 */
export function renderQRCodeToElement(target, text, size = 180) {
  if (!target) return;
  const svg = generateQRCodeSVG(text, size);
  if (target.tagName.toLowerCase() === 'img') {
    target.src = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  } else {
    target.innerHTML = svg;
  }
}
