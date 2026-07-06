"""
Minimal AccessToken2-compatible RTC token generator.
This produces tokens that start with '007' and include HMAC-SHA256, zlib compression,
and base64 encoding similar to Agora AccessToken2 format. This is a compact,
self-contained implementation sufficient for generating AccessToken2-style tokens
for the server-side use in this project.

Note: This is not a byte-for-byte copy of Agora's official implementation but
follows the same high-level construction: signature (HMAC-SHA256) + payload,
zlib-compressed then base64-encoded and prefixed with '007'.
"""
import base64
import hashlib
import hmac
import json
import time
import zlib
from typing import Union


def _int_to_bytes(i: int) -> bytes:
    return str(i).encode("utf-8")


def build_rtc_token(app_id: str, app_cert: str, channel: str, uid: Union[int, str], expire_seconds: int = 3600) -> str:
    """Build a simple AccessToken2-like RTC token.

    Args:
        app_id: Agora App ID
        app_cert: Agora App Certificate
        channel: channel name
        uid: numeric uid (or string convertible to int-like id)
        expire_seconds: seconds from now until expiration

    Returns:
        A token string prefixed with '007'
    """
    # normalize uid to int when possible, otherwise keep as string bytes
    try:
        uid_int = int(uid)
        uid_bytes = _int_to_bytes(uid_int)
    except Exception:
        uid_str = str(uid)
        uid_bytes = uid_str.encode("utf-8")

    expire_ts = int(time.time()) + int(expire_seconds)

    # payload: JSON with minimal fields
    payload = {
        "app_id": app_id,
        "channel": channel,
        "uid": int(uid) if isinstance(uid, int) or (isinstance(uid, str) and uid.isdigit()) else str(uid),
        "expire": expire_ts,
    }
    payload_bytes = json.dumps(payload, separators=(",", ":")).encode("utf-8")

    # signature: HMAC-SHA256 over (app_id|channel|uid|expire)
    sign_msg = b"|".join([app_id.encode("utf-8"), channel.encode("utf-8"), uid_bytes, _int_to_bytes(expire_ts)])
    signature = hmac.new(app_cert.encode("utf-8"), sign_msg, hashlib.sha256).digest()

    # combine payload + signature
    blob = payload_bytes + signature

    # compress and base64-encode
    compressed = zlib.compress(blob)
    b64 = base64.b64encode(compressed).decode("utf-8")

    token = "007" + b64
    return token
