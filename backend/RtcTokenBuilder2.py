import os
import sys
from AccessToken2 import AccessToken, kRtcServiceType

Role_Publisher = 1
Role_Subscriber = 2

class RtcTokenBuilder:
    @staticmethod
    def build_token_with_uid(app_id, app_certificate, channel_name, uid, role, token_expire, privilege_expire=0):
        token = AccessToken(app_id, app_certificate, token_expire)
        token.add_privilege(kRtcServiceType, privilege_expire)
        return token.build()
