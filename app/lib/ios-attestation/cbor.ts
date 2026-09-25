// A decoder for the CBOR subset Apple's App Attest payloads actually use:
// unsigned/negative integers, byte strings, text strings, arrays and maps,
// all with definite lengths.
//
// WHY NOT A DEPENDENCY: this parses attacker-reachable bytes on an
// authentication path, so it is deliberately small enough to read in full and
// refuses everything it does not explicitly understand -- indefinite lengths,
// tags, floats, simple values. A general-purpose decoder accepts far more of
// the format than Apple ever sends, and every extra branch is attack surface
// on a path that must fail closed.

export class CborError extends Error {}

type Decoded = {
  value: unknown;
  offset: number;
};

const MAJOR_UNSIGNED = 0;
const MAJOR_NEGATIVE = 1;
const MAJOR_BYTES = 2;
const MAJOR_TEXT = 3;
const MAJOR_ARRAY = 4;
const MAJOR_MAP = 5;

// Bounds every allocation on a length the input itself supplies, so a hostile
// header cannot ask for gigabytes before the data runs out.
function need(buffer: Buffer, offset: number, length: number) {
  if (length < 0 || offset + length > buffer.length) {
    throw new CborError("CBOR input ended in the middle of a value");
  }
}

function readArgument(buffer: Buffer, offset: number, additional: number): Decoded {
  if (additional < 24) {
    return { value: additional, offset };
  }

  if (additional === 24) {
    need(buffer, offset, 1);
    return { value: buffer.readUInt8(offset), offset: offset + 1 };
  }

  if (additional === 25) {
    need(buffer, offset, 2);
    return { value: buffer.readUInt16BE(offset), offset: offset + 2 };
  }

  if (additional === 26) {
    need(buffer, offset, 4);
    return { value: buffer.readUInt32BE(offset), offset: offset + 4 };
  }

  if (additional === 27) {
    need(buffer, offset, 8);
    const big = buffer.readBigUInt64BE(offset);

    // Beyond Number.MAX_SAFE_INTEGER the value silently loses precision, and
    // nothing App Attest sends is ever this large.
    if (big > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new CborError("CBOR integer is too large to represent exactly");
    }

    return { value: Number(big), offset: offset + 8 };
  }

  // 28-30 are reserved; 31 is an indefinite length, which Apple never emits.
  throw new CborError(`Unsupported CBOR additional information: ${additional}`);
}

function decodeItem(buffer: Buffer, offset: number, depth: number): Decoded {
  if (depth > 16) {
    throw new CborError("CBOR nesting is too deep");
  }

  need(buffer, offset, 1);
  const initial = buffer.readUInt8(offset);
  const major = initial >> 5;
  const additional = initial & 0x1f;
  const argument = readArgument(buffer, offset + 1, additional);
  const length = argument.value as number;
  let cursor = argument.offset;

  if (major === MAJOR_UNSIGNED) {
    return { value: length, offset: cursor };
  }

  if (major === MAJOR_NEGATIVE) {
    return { value: -1 - length, offset: cursor };
  }

  if (major === MAJOR_BYTES) {
    need(buffer, cursor, length);
    // Copied, not sliced: a Buffer view would keep the whole input alive and
    // let a later caller mutate shared memory.
    return {
      value: Buffer.from(buffer.subarray(cursor, cursor + length)),
      offset: cursor + length,
    };
  }

  if (major === MAJOR_TEXT) {
    need(buffer, cursor, length);
    return {
      value: buffer.subarray(cursor, cursor + length).toString("utf8"),
      offset: cursor + length,
    };
  }

  if (major === MAJOR_ARRAY) {
    const items: unknown[] = [];

    for (let index = 0; index < length; index += 1) {
      const item = decodeItem(buffer, cursor, depth + 1);
      items.push(item.value);
      cursor = item.offset;
    }

    return { value: items, offset: cursor };
  }

  if (major === MAJOR_MAP) {
    // A null-prototype object: a key called "__proto__" or "constructor" in
    // decoded input must never reach Object.prototype.
    const entries: Record<string, unknown> = Object.create(null);

    for (let index = 0; index < length; index += 1) {
      const key = decodeItem(buffer, cursor, depth + 1);

      if (typeof key.value !== "string") {
        throw new CborError("CBOR map keys must be text strings");
      }

      if (key.value in entries) {
        throw new CborError(`Duplicate CBOR map key: ${key.value}`);
      }

      const value = decodeItem(buffer, key.offset, depth + 1);
      entries[key.value] = value.value;
      cursor = value.offset;
    }

    return { value: entries, offset: cursor };
  }

  throw new CborError(`Unsupported CBOR major type: ${major}`);
}

/**
 * Decodes exactly one CBOR item and requires it to consume the whole input.
 *
 * Trailing bytes are rejected rather than ignored: accepting them would let
 * the same payload be read two different ways.
 */
export function decodeCbor(input: Buffer): unknown {
  const { value, offset } = decodeItem(input, 0, 0);

  if (offset !== input.length) {
    throw new CborError("CBOR input has trailing bytes");
  }

  return value;
}
