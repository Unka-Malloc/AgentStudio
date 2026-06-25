# Pactium Canonical Encoding

Pactium Canonical Value is the only byte encoding used for protocol hashes, CIDs, proof material, ledger leaves, index nodes, manifests, and bundle headers. It is Pactium-specific and is not RFC 8785 JCS.

## Value Model

Allowed values:

- `null`
- `boolean`
- finite IEEE 754 safe-integer `number`
- `string`
- arrays
- plain objects with string keys
- binary data represented before normalization as `Buffer` or `Uint8Array`

Rejected values:

- `NaN`, `Infinity`, `-Infinity`
- non-safe integers and fractional numbers
- functions, symbols, bigint, dates as special objects, maps, sets, and class instances with non-plain semantics
- user objects containing the reserved `$bytes` key

`undefined` is normalized to `null` when it is the value itself and omitted when it is an object property.

## Normalization

Normalization is recursive and bounded:

- maximum nesting depth: 256
- maximum normalized node count per call: 100000
- strings are normalized to Unicode NFC
- `-0` is normalized to `0`
- object keys are sorted lexicographically by JavaScript string order
- object properties whose value is `undefined` are omitted
- `Buffer` and `Uint8Array` become `{ "$bytes": "<base64>" }`
- arrays preserve order

Each call to `normalizeCanonicalValue`, `canonicalString`, or `canonicalEncode` uses a fresh per-call normalization context. Node counts do not leak across calls or concurrent coroutines.

## Byte Encoding

`canonicalString(value)` is `JSON.stringify(normalizeCanonicalValue(value))` with no whitespace.

`canonicalEncode(value)` is UTF-8 bytes of `canonicalString(value)`.

`canonicalDecode(bytes)` parses the UTF-8 JSON bytes and returns the JSON value. It does not reinterpret `{ "$bytes": ... }` back into a `Buffer`; `$bytes` is the canonical JSON representation.

## Hash Binding

Protocol hashes prepend Pactium protocol and hash-domain bytes before canonical bytes:

```text
sha256("pactium.v0.2:" || domainSeparator || 0x00 || canonicalEncode(value))
```

Ledger tree hashes use RFC 9162 / RFC 6962 Merkle domain separation over Pactium canonical leaf bytes:

```text
leafHash = sha256(0x00 || canonicalEncode(leaf))
nodeHash = sha256(0x01 || leftHashBytes || rightHashBytes)
emptyTreeHash = sha256("")
```

## Interop Boundary

Pactium CIDs are `cid:sha256:<hex>` identifiers over Pactium canonical bytes. They are not multiformat CIDs. Proof Bundles are CAR-like content-addressed archives, not CARv1/CARv2 byte-compatible archives.
