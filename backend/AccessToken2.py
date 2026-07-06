import hmac
import hashlib
import base64
import struct
import random
import time

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
        ret += struct.pack("<H", len(self.app_id)) + self.app_id.encode('utf-8')
        ret += struct.pack("<I", len(self.privileges))
        for privilege, expire in self.privileges.items():
            ret += struct.pack("<I", privilege)
            ret += struct.pack("<I", expire)
        signature = hmac.new(self.app_certificate.encode('utf-8'), ret, hashlib.sha256).digest()
        return get_version() + base64.b64encode(signature + ret).decode('utf-8')
