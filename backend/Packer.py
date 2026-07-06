import struct

def pack_uint16(x):
    return struct.pack("<H", x)

def pack_uint32(x):
    return struct.pack("<I", x)

def pack_string(string):
    return pack_uint16(len(string)) + string.encode('utf-8')
