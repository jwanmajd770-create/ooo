import hmac
import hashlib
import base64
import struct
import random
import time
from Packer import pack_string, pack_uint32

kRtcServiceType = 1

def get_version():
    return "007"

class AccessToken:
    def __init__(self, app_id, app_certificate, expire=900):
        self.app_id = app_id
        self.app_certificate = app_certificate
        self.expire = expire
        self.issue_ts = int(time.time())
        self.salt = random.randint(1, 4294967295)
        self.privileges = {}

    def add_privilege(self, privilege, expire):
        self.privileges[privilege] = expire

    def build(self):
        ret = struct.pack("<I", self.issue_ts)
        ret += struct.pack("<I", self.expire)
        ret += struct.pack("<I", self.salt)
        ret += pack_string(self.app_id)
        ret += pack_uint32(len(self.privileges))
        for privilege, expire in self.privileges.items():
            ret += pack_uint32(privilege)
            ret += pack_uint32(expire)
        signature = hmac.new(self.app_certificate.encode('utf-8'), ret, hashlib.sha256).digest()
        return get_version() + base64.b64encode(signature + ret).decode('utf-8')
