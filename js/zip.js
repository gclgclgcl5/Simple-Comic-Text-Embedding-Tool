/* ZIP 读写：字体包解压 + 批量导出打包 */
(function (App) {
  "use strict";

  function readZipEntries(buf) {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    const min = Math.max(0, bytes.length - 65557);
    for (let i = bytes.length - 22; i >= min; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('不是有效的 ZIP 文件');
    const count = dv.getUint16(eocd + 10, true);
    const cdOff = dv.getUint32(eocd + 16, true);
    const dec = new TextDecoder();
    const entries = [];
    let p = cdOff;
    for (let k = 0; k < count; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('ZIP 目录损坏');
      const method = dv.getUint16(p + 10, true);
      const compSize = dv.getUint32(p + 20, true);
      const uncompSize = dv.getUint32(p + 24, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const commentLen = dv.getUint16(p + 32, true);
      const localOff = dv.getUint32(p + 42, true);
      const name = dec.decode(new Uint8Array(bytes.buffer, bytes.byteOffset + p + 46, nameLen));
      if (dv.getUint32(localOff, true) !== 0x04034b50) throw new Error('ZIP 数据损坏');
      const lNameLen = dv.getUint16(localOff + 26, true);
      const lExtraLen = dv.getUint16(localOff + 28, true);
      const dataStart = localOff + 30 + lNameLen + lExtraLen;
      const data = new Uint8Array(bytes.buffer, bytes.byteOffset + dataStart, compSize);
      entries.push({ name, method, compSize, uncompSize, data });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }

  async function inflateEntry(en) {
    if (en.method === 0) return en.data.slice(0, en.uncompSize);
    if (en.method === 8) {
      if (typeof DecompressionStream === 'undefined') throw new Error('当前浏览器不支持解压 ZIP，请改用 Chrome/Edge');
      const ds = new DecompressionStream('deflate-raw');
      const stream = new Blob([en.data]).stream().pipeThrough(ds);
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    throw new Error('不支持的压缩方式：' + en.method);
  }

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  async function makeZip(files) {
    const enc = new TextEncoder();
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const chunks = [], central = [];
    let offset = 0;
    for (const f of files) {
      const nameBuf = enc.encode(f.name);
      const data = new Uint8Array(await f.blob.arrayBuffer());
      const crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);
      lh.setUint16(4, 20, true);
      lh.setUint16(6, 0x0800, true);
      lh.setUint16(8, 0, true);
      lh.setUint16(10, dosTime, true);
      lh.setUint16(12, dosDate, true);
      lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true);
      lh.setUint32(22, data.length, true);
      lh.setUint16(26, nameBuf.length, true);
      lh.setUint16(28, 0, true);
      chunks.push(lh.buffer, nameBuf, data);
      central.push({ nameBuf, crc, size: data.length, offset });
      offset += 30 + nameBuf.length + data.length;
    }
    const cdStart = offset, cdChunks = [];
    for (const c of central) {
      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true);
      cd.setUint16(4, 20, true);
      cd.setUint16(6, 20, true);
      cd.setUint16(8, 0x0800, true);
      cd.setUint16(10, 0, true);
      cd.setUint16(12, dosTime, true);
      cd.setUint16(14, dosDate, true);
      cd.setUint32(16, c.crc, true);
      cd.setUint32(20, c.size, true);
      cd.setUint32(24, c.size, true);
      cd.setUint16(28, c.nameBuf.length, true);
      cd.setUint16(30, 0, true);
      cd.setUint16(32, 0, true);
      cd.setUint16(34, 0, true);
      cd.setUint16(36, 0, true);
      cd.setUint32(38, 0, true);
      cd.setUint32(42, c.offset, true);
      cdChunks.push(cd.buffer, c.nameBuf);
    }
    const cdSize = cdChunks.reduce((s, x) => s + x.byteLength, 0);
    const eocd = new DataView(new ArrayBuffer(22));
    eocd.setUint32(0, 0x06054b50, true);
    eocd.setUint16(4, 0, true);
    eocd.setUint16(6, 0, true);
    eocd.setUint16(8, central.length, true);
    eocd.setUint16(10, central.length, true);
    eocd.setUint32(12, cdSize, true);
    eocd.setUint32(16, cdStart, true);
    eocd.setUint16(20, 0, true);
    return new Blob([...chunks, ...cdChunks, eocd], { type: 'application/zip' });
  }

  App.Zip = { readZipEntries, inflateEntry, makeZip };
})(window.App = window.App || {});
