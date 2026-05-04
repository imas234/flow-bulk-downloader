// Minimal stored-mode ZIP writer. No compression — Flow images are already
// JPEG, and avoiding DEFLATE means zero dependencies and deterministic output.
(() => {
  const FB = (window.__FlowBulk ||= {});

  const w16 = (view, offset, value) => view.setUint16(offset, value, true);
  const w32 = (view, offset, value) => view.setUint32(offset, value, true);

  function crc32(buf) {
    let table = crc32.table;
    if (!table) {
      table = crc32.table = [];
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
          c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[n] = c;
      }
    }
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function buildZip(entries) {
    const encoder = new TextEncoder();
    const meta = [];
    const parts = [];
    let offset = 0;

    for (const entry of entries) {
      const nameBytes = encoder.encode(entry.name);
      const fileData = new Uint8Array(entry.data);
      const crc = crc32(fileData);
      const header = new ArrayBuffer(30 + nameBytes.length);
      const hv = new DataView(header);
      w32(hv, 0, 0x04034b50);
      w16(hv, 4, 20);
      w16(hv, 6, 0);
      w16(hv, 8, 0);
      w16(hv, 10, 0);
      w16(hv, 12, 0);
      w32(hv, 14, crc);
      w32(hv, 18, fileData.length);
      w32(hv, 22, fileData.length);
      w16(hv, 26, nameBytes.length);
      w16(hv, 28, 0);
      new Uint8Array(header).set(nameBytes, 30);
      meta.push({ localOffset: offset, nameBytes, crc, size: fileData.length });
      parts.push(header, fileData.buffer);
      offset += header.byteLength + fileData.length;
    }

    const cdStart = offset;
    for (const m of meta) {
      const cd = new ArrayBuffer(46 + m.nameBytes.length);
      const cv = new DataView(cd);
      w32(cv, 0, 0x02014b50);
      w16(cv, 4, 20);
      w16(cv, 6, 20);
      w16(cv, 8, 0);
      w16(cv, 10, 0);
      w16(cv, 12, 0);
      w16(cv, 14, 0);
      w32(cv, 16, m.crc);
      w32(cv, 20, m.size);
      w32(cv, 24, m.size);
      w16(cv, 28, m.nameBytes.length);
      w16(cv, 30, 0);
      w16(cv, 32, 0);
      w16(cv, 34, 0);
      w16(cv, 36, 0);
      w32(cv, 38, 0);
      w32(cv, 42, m.localOffset);
      new Uint8Array(cd).set(m.nameBytes, 46);
      parts.push(cd);
      offset += cd.byteLength;
    }

    const cdSize = offset - cdStart;
    const eocd = new ArrayBuffer(22);
    const ev = new DataView(eocd);
    w32(ev, 0, 0x06054b50);
    w16(ev, 4, 0);
    w16(ev, 6, 0);
    w16(ev, 8, entries.length);
    w16(ev, 10, entries.length);
    w32(ev, 12, cdSize);
    w32(ev, 16, cdStart);
    w16(ev, 20, 0);
    parts.push(eocd);

    return new Blob(parts, { type: "application/zip" });
  }

  FB.zip = { buildZip };
})();
