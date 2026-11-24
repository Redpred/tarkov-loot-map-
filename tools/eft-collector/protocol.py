"""Bounded 48146 response decoder. Protocol references: docs/COLLECTOR.md."""
import json
import struct
import zlib

MAX_BYTES = 64 * 1024 * 1024
CLIENT_AES_KEY = b"7*YabV3MfOfyE*lhI*l*Qx*q"


def frame_request(payload, padding=6):
    """Experimental inverse of SPT f6c19b2a DeShuffleAsync; not request AES.

    Fixed repeated-payload padding makes the comparison reproducible. SPT uses
    6..16 bytes on responses; official request padding is not yet established.
    Only the explicit experimental POST option enables this encoding.
    """
    if not isinstance(payload, bytes) or not payload:
        raise ValueError("request-payload-must-be-nonempty-bytes")
    if type(padding) is not int or not 6 <= padding <= 16:
        raise ValueError("request-padding-out-of-range")
    if len(payload) + 4 + padding > MAX_BYTES:
        raise ValueError("framed-request-too-large")
    repeats = (padding + len(payload) - 1) // len(payload)
    data = bytearray(struct.pack("<i", len(payload)) + payload + (payload * repeats)[:padding])
    start = len(data) % 0xAAB
    for index in range(len(data) - 1, 0, -1):
        swap = ((1624453 * (0x65F6D + start + index) + 1023920427) % 0x8ED7A18D) % index
        data[index], data[swap] = data[swap], data[index]
    return bytes(data)


def inflate_bounded(data, window_bits=15, aes_padding=False):
    inflater = zlib.decompressobj(window_bits)
    value = inflater.decompress(data, MAX_BYTES + 1)
    if len(value) > MAX_BYTES or inflater.unconsumed_tail:
        raise ValueError("Decoded response exceeds bound")
    if not inflater.eof:
        raise ValueError("Incomplete compressed response")
    # The live error response has PKCS7 bytes; the client's Zeros decryptor
    # leaves them for its inflater to ignore. Accept only recognized padding.
    tail = inflater.unused_data
    valid_padding = (aes_padding and 0 < len(tail) <= 16 and
                     (not tail.strip(b"\0") or tail == bytes([len(tail)]) * len(tail)))
    if tail and not valid_padding:
        raise ValueError("Unexpected bytes after compressed response")
    return value


def unframe_response(raw):
    """Undo the current response permutation and its little-endian length.

    Independently implemented from the metadata framing algorithm in the cached
    glitter-n-shine source; verified on retained 48146 PC and Ubuntu locations.
    There is no magic marker: callers MUST still validate the decrypted JSON.
    """
    if not 4 <= len(raw) <= MAX_BYTES:
        raise ValueError("Invalid framed response size")
    data = bytearray(raw)
    start = len(data) % 0xAAB
    for index in range(1, len(data)):
        swap = ((1624453 * (0x65F6D + start + index) + 1023920427) % 0x8ED7A18D) % index
        data[index], data[swap] = data[swap], data[index]
    size = struct.unpack_from("<i", data)[0]
    if size <= 0 or size > len(data) - 4:
        raise ValueError("Invalid framed payload size")
    return bytes(data[4:4 + size])


def _decode_payload(data, encryption):
    if encryption:
        if encryption != "aes":
            return None, "encrypted-unsupported-algorithm", data
        if len(data) < 32 or (len(data) - 16) % 16:
            return None, "encrypted-unsupported-length", data
        try:
            from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
        except ImportError:
            return None, "encrypted-decoder-unavailable", data
        decryptor = Cipher(algorithms.AES(CLIENT_AES_KEY), modes.CBC(data[:16])).decryptor()
        data = decryptor.update(data[16:]) + decryptor.finalize()
    # The launcher's ZlibContent wrapper is used even without HTTP encoding headers.
    for codec in ["utf8", "zlib"]:
        try:
            candidate = (data.rstrip(b"\0") if encryption else data) if codec == "utf8" else inflate_bounded(data, aes_padding=bool(encryption))
            if len(candidate) > MAX_BYTES:
                raise ValueError("Decoded response too large")
            return json.loads(candidate.decode("utf-8-sig")), ("aes-cbc+" if encryption else "") + codec, candidate
        except (ValueError, UnicodeError, zlib.error):
            pass
    return None, "encrypted-unparsed" if encryption else "unparsed", data


def decoded_json(raw, headers):
    if len(raw) > MAX_BYTES:
        raise ValueError("Response exceeds bound")
    data = raw
    encoding = headers.get("content-encoding", "").lower()
    if encoding == "gzip":
        data = inflate_bounded(data, 31)
    elif encoding in ["deflate", "zlib"]:
        data = inflate_bounded(data)
    encryption = headers.get("x-encryption", "").lower()
    direct = _decode_payload(data, encryption)
    if direct[0] is not None or encryption not in ["", "aes"]:
        return direct
    try:
        framed = _decode_payload(unframe_response(data), encryption)
        if framed[0] is not None:
            return framed[0], "framed+" + framed[1], framed[2]
    except (ValueError, zlib.error):
        pass
    return direct
